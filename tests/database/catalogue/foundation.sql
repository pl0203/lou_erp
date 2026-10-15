-- Behavior assertions inside the runner's identity-bound, rollback-only transaction.
-- Synthetic trusted evidence seeds exercise invariants; they do not certify tracker coverage.
SELECT pg_temp.foundation_assert((SELECT count(*) = 2 FROM private.catalog_identity_v1 WHERE
  ((kind = 'customer' AND id = md5('catalogue-existing-customer')::uuid)
   OR (kind = 'product' AND id = md5('catalogue-existing-product')::uuid))
  AND lifetime_state = 'unknown' AND last_version = 1 AND deleted_at IS NULL), 'existing identities begin unknown');
SELECT pg_temp.foundation_assert((SELECT is_enabled AND catalog_version = 1 FROM public.customers WHERE id = md5('catalogue-existing-customer')::uuid), 'existing customer enabled/version one');
SELECT pg_temp.foundation_assert((SELECT is_enabled AND catalog_version = 1 FROM public.products WHERE id = md5('catalogue-existing-product')::uuid), 'existing product enabled/version one');
SELECT pg_temp.foundation_assert((SELECT count(*) = 1 AND bool_and(execution_generation = 1 AND NOT tracking_ready) FROM private.catalog_cutover_v1), 'hard-false foundation readiness');
SELECT pg_temp.foundation_raises($$UPDATE private.catalog_cutover_v1 SET tracking_ready=true$$, '23514', 'cannot make foundation ready');
SELECT pg_temp.foundation_raises($$UPDATE private.catalog_cutover_v1 SET execution_generation=2$$, '23514', 'cannot cut over foundation');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE lifetime_state='unused'), 'foundation never invents unused provenance');

CREATE FUNCTION pg_temp.foundation_master_insert(kind text, key uuid, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF kind='customer' THEN INSERT INTO public.customers(id,name,customer_category) VALUES(key,label,'perorangan');
  ELSIF kind='product' THEN INSERT INTO public.products(id,name,sku) VALUES(key,label,'CATALOGUE-'||key::text);
  ELSE RAISE EXCEPTION 'Unexpected test kind'; END IF;
END $$;
CREATE FUNCTION pg_temp.foundation_master_row(kind text,key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF kind='customer' THEN SELECT to_jsonb(c) INTO result FROM public.customers c WHERE id=key;
  ELSIF kind='product' THEN SELECT to_jsonb(p) INTO result FROM public.products p WHERE id=key;
  ELSE RAISE EXCEPTION 'Unexpected test kind'; END IF;
  RETURN result;
END $$;
-- Fail after the real AFTER guard has inserted evidence. The entire statement,
-- including both the live master and identity evidence, must roll back.
CREATE FUNCTION pg_temp.foundation_fail_after_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.name='Fictional forced failure' THEN
    IF NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE id=NEW.id AND kind=CASE TG_TABLE_NAME WHEN 'customers' THEN 'customer' ELSE 'product' END) THEN
      RAISE EXCEPTION 'Evidence must exist before the injected failure' USING ERRCODE='PFC91';
    END IF;
    RAISE EXCEPTION 'Forced failure after evidence' USING ERRCODE='PFC90';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zzz_foundation_fail_after_evidence AFTER INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION pg_temp.foundation_fail_after_evidence();
CREATE TRIGGER zzz_foundation_fail_after_evidence AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION pg_temp.foundation_fail_after_evidence();

DO $lifecycle$
<<lifecycle>>
DECLARE kind text; relation text; key uuid; failed uuid; big uuid; maximum uuid; exhausted uuid;
  evidence jsonb; prior_tombstone timestamptz; prior_xmin text; prior_ctid tid;
BEGIN
  FOREACH kind IN ARRAY ARRAY['customer','product'] LOOP
    relation := 'public.'||CASE kind WHEN 'customer' THEN 'customers' ELSE 'products' END;
    key:=md5('catalogue-raw-'||kind)::uuid;
    PERFORM pg_temp.foundation_master_insert(kind,key,'Fictional raw master');
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,key) @> '{"is_enabled":true,"catalog_version":1}'::jsonb,kind||' raw master defaults');
    PERFORM pg_temp.foundation_assert((SELECT lifetime_state='unknown' AND last_version=1 AND deleted_at IS NULL FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=key),kind||' raw caller UUID does not certify non-use');
    EXECUTE format('UPDATE %s SET name=$1 WHERE id=$2',relation) USING 'Fictional changed',key;
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,key)->>'catalog_version'='2',kind||' real legacy update increments once');
    EXECUTE format('UPDATE %s SET name=name WHERE id=$1',relation) USING key;
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,key)->>'catalog_version'='2',kind||' no-op keeps version');
    EXECUTE format('UPDATE %s SET catalog_version=999 WHERE id=$1',relation) USING key;
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,key)->>'catalog_version'='2',kind||' caller cannot choose version');
    EXECUTE format('UPDATE %s SET is_enabled=false WHERE id=$1',relation) USING key;
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,key) @> '{"is_enabled":false,"catalog_version":3}'::jsonb,kind||' activation increments once');
    PERFORM pg_temp.foundation_assert((SELECT lifetime_state='unknown' AND last_version=3 FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=key),kind||' activation is not business use');
    EXECUTE format('DELETE FROM %s WHERE id=$1',relation) USING key;
    SELECT deleted_at INTO prior_tombstone FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=key;
    PERFORM pg_temp.foundation_assert(prior_tombstone IS NOT NULL,kind||' deletion retains a tombstone');
    PERFORM pg_temp.foundation_master_insert(kind,key,'Fictional recreated master');
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,key) @> '{"is_enabled":true,"catalog_version":4}'::jsonb,kind||' recreation advances version');
    PERFORM pg_temp.foundation_assert((SELECT lifetime_state='unknown' AND last_version=4 AND deleted_at=prior_tombstone FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=key),kind||' unknown recreation retains evidence and tombstone');
    UPDATE private.catalog_identity_v1 i SET lifetime_state='used' WHERE i.kind=lifecycle.kind AND i.id=key;
    EXECUTE format('DELETE FROM %s WHERE id=$1',relation) USING key;
    PERFORM pg_temp.foundation_master_insert(kind,key,'Fictional used recreation');
    PERFORM pg_temp.foundation_assert((SELECT lifetime_state='used' AND last_version=5 AND deleted_at=prior_tombstone FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=key),kind||' used recreation retains evidence');
    PERFORM pg_temp.foundation_raises(format('UPDATE %s SET id=%L::uuid WHERE id=%L::uuid',relation,md5('catalogue-reassigned-'||kind),key),'23514',kind||' primary key reassignment denied');
    PERFORM pg_temp.foundation_raises(format('UPDATE private.catalog_identity_v1 SET id=%L::uuid WHERE kind=%L AND id=%L::uuid',md5('catalogue-reassigned-'||kind),kind,key),'23514',kind||' evidence UUID immutable');
    PERFORM pg_temp.foundation_raises(format('UPDATE private.catalog_identity_v1 SET kind=%L WHERE kind=%L AND id=%L::uuid',CASE kind WHEN 'customer' THEN 'product' ELSE 'customer' END,kind,key),'23514',kind||' evidence kind immutable');
    PERFORM pg_temp.foundation_raises(format('UPDATE private.catalog_identity_v1 SET lifetime_state=''unknown'' WHERE kind=%L AND id=%L::uuid',kind,key),'23514',kind||' used cannot regress');
    PERFORM pg_temp.foundation_raises(format('UPDATE private.catalog_identity_v1 SET lifetime_state=''unused'' WHERE kind=%L AND id=%L::uuid',kind,key),'23514',kind||' used cannot become unused');
    PERFORM pg_temp.foundation_raises(format('UPDATE private.catalog_identity_v1 SET lifetime_state=''unused'' WHERE kind=%L AND id=%L::uuid',kind,md5('catalogue-existing-'||kind)),'23514',kind||' unknown cannot become unused');
    PERFORM pg_temp.foundation_raises(format('UPDATE private.catalog_identity_v1 SET last_version=1 WHERE kind=%L AND id=%L::uuid',kind,key),'23514',kind||' evidence version cannot regress');
    PERFORM pg_temp.foundation_raises(format('UPDATE private.catalog_identity_v1 SET deleted_at=NULL WHERE kind=%L AND id=%L::uuid',kind,key),'23514',kind||' tombstone cannot clear');
    PERFORM pg_temp.foundation_raises(format('UPDATE private.catalog_identity_v1 SET deleted_at=deleted_at+interval ''1 day'' WHERE kind=%L AND id=%L::uuid',kind,key),'23514',kind||' original tombstone cannot change');
    PERFORM pg_temp.foundation_raises(format('DELETE FROM private.catalog_identity_v1 WHERE kind=%L AND id=%L::uuid',kind,key),'23514',kind||' evidence cannot be deleted');
    PERFORM pg_temp.foundation_raises(format('INSERT INTO private.catalog_identity_v1 VALUES(%L,%L::uuid,''unused'',1,NULL)',kind,md5('catalogue-unused-'||kind)),'23514',kind||' fresh unused unavailable');

    SELECT to_jsonb(i),xmin::text,ctid INTO evidence,prior_xmin,prior_ctid FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=key;
    IF kind='customer' THEN
      INSERT INTO public.customers(id,name) VALUES(key,'Discarded conflict') ON CONFLICT(id) DO NOTHING;
      INSERT INTO public.customers(id,name) VALUES(key,'Discarded update') ON CONFLICT(id) DO UPDATE SET name=customers.name;
    ELSE
      INSERT INTO public.products(id,name,sku) VALUES(key,'Discarded conflict','CATALOGUE-'||key::text) ON CONFLICT(id) DO NOTHING;
      INSERT INTO public.products(id,name,sku) VALUES(key,'Discarded update','CATALOGUE-'||key::text) ON CONFLICT(id) DO UPDATE SET name=products.name;
    END IF;
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,key)->>'catalog_version'='5',kind||' conflict/no-op update does not bump version');
    PERFORM pg_temp.foundation_assert((SELECT to_jsonb(i)=evidence FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=key),kind||' conflict/no-op update preserves evidence');
    -- A separate discarded INSERT must not rewrite evidence (xmin alone is not
    -- sufficient within one transaction, so also compare the physical tuple).
    SELECT xmin::text,ctid INTO prior_xmin,prior_ctid FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=key;
    IF kind='customer' THEN INSERT INTO public.customers(id,name) VALUES(key,'Discarded conflict') ON CONFLICT(id) DO NOTHING;
    ELSE INSERT INTO public.products(id,name,sku) VALUES(key,'Discarded conflict','CATALOGUE-'||key::text) ON CONFLICT(id) DO NOTHING; END IF;
    PERFORM pg_temp.foundation_assert((SELECT xmin::text=prior_xmin AND ctid=prior_ctid FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=key),kind||' discarded insert never writes evidence');

    failed:=md5('catalogue-failed-create-'||kind)::uuid;
    PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.foundation_master_insert(%L,%L::uuid,''Fictional forced failure'')',kind,failed),'PFC90',kind||' failure is injected after evidence');
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,failed) IS NULL AND NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=failed),kind||' forced post-evidence failure rolls back both records');

    big:=md5('catalogue-large-version-'||kind)::uuid;
    INSERT INTO private.catalog_identity_v1 VALUES(kind,big,'used',9007199254740992,'2026-01-01');
    PERFORM pg_temp.foundation_master_insert(kind,big,'Fictional large version');
    PERFORM pg_temp.foundation_assert(to_jsonb(pg_temp.foundation_master_row(kind,big)->>'catalog_version')='"9007199254740993"'::jsonb,kind||' decimal string 9007199254740993 is exact');
    maximum:=md5('catalogue-live-max-version-'||kind)::uuid;
    INSERT INTO private.catalog_identity_v1 VALUES(kind,maximum,'used',9223372036854775806,'2026-01-01');
    PERFORM pg_temp.foundation_master_insert(kind,maximum,'Fictional live maximum');
    SELECT to_jsonb(i),ctid INTO evidence,prior_ctid FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=maximum;
    IF kind='customer' THEN
      INSERT INTO public.customers(id,name) VALUES(maximum,'Discarded live maximum') ON CONFLICT(id) DO NOTHING;
      INSERT INTO public.customers(id,name) VALUES(maximum,'Discarded live maximum') ON CONFLICT(id) DO UPDATE SET name=customers.name;
    ELSE
      INSERT INTO public.products(id,name,sku) VALUES(maximum,'Discarded live maximum','CATALOGUE-'||maximum::text) ON CONFLICT(id) DO NOTHING;
      INSERT INTO public.products(id,name,sku) VALUES(maximum,'Discarded live maximum','CATALOGUE-'||maximum::text) ON CONFLICT(id) DO UPDATE SET name=products.name;
    END IF;
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,maximum)->>'catalog_version'='9223372036854775807',kind||' live maximum discarded conflict stays a no-op');
    EXECUTE format('UPDATE %s SET name=name WHERE id=$1',relation) USING maximum;
    PERFORM pg_temp.foundation_assert((SELECT to_jsonb(i)=evidence FROM private.catalog_identity_v1 i WHERE i.kind=lifecycle.kind AND i.id=maximum),kind||' live maximum no-op preserves evidence');
    PERFORM pg_temp.foundation_raises(format('UPDATE %s SET name=''Overflowing edit'' WHERE id=%L::uuid',relation,maximum),'22003',kind||' real maximum-version update cannot wrap');
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,maximum)->>'name'='Fictional live maximum',kind||' overflowing update leaves prior master intact');
    exhausted:=md5('catalogue-exhausted-version-'||kind)::uuid;
    INSERT INTO private.catalog_identity_v1 VALUES(kind,exhausted,'used',9223372036854775807,'2026-01-01');
    PERFORM pg_temp.foundation_raises(format('SELECT pg_temp.foundation_master_insert(%L,%L::uuid,''Fictional exhausted'')',kind,exhausted),'22003',kind||' exhausted recreation fails');
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(kind,exhausted) IS NULL,kind||' exhausted recreation leaves no master');
  END LOOP;
END $lifecycle$;

-- Unique failures that occur before AFTER evidence are independently covered.
SELECT pg_temp.foundation_raises($$INSERT INTO public.products(id,name,sku) VALUES(md5('catalogue-unique-failure')::uuid,'Fictional duplicate SKU','CATALOGUE-EXISTING')$$,'23505','failed create preserves unique SKU semantics');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('catalogue-unique-failure')::uuid),'failed create rolls back evidence');
SELECT pg_temp.foundation_master_insert('customer',md5('catalogue-same-uuid')::uuid,'Fictional same UUID customer');
SELECT pg_temp.foundation_master_insert('product',md5('catalogue-same-uuid')::uuid,'Fictional same UUID product');
UPDATE public.customers SET name='Fictional same UUID customer changed' WHERE id=md5('catalogue-same-uuid')::uuid;
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(last_version=CASE kind WHEN 'customer' THEN 2 ELSE 1 END) FROM private.catalog_identity_v1 WHERE id=md5('catalogue-same-uuid')::uuid),'same UUID isolates identity kinds');
-- Every live identity must agree with its master after the complete lifecycle.
SELECT pg_temp.foundation_assert(NOT EXISTS(
 SELECT 1 FROM (SELECT 'customer'::text kind,id,catalog_version FROM public.customers UNION ALL SELECT 'product',id,catalog_version FROM public.products) m
 LEFT JOIN private.catalog_identity_v1 i USING(kind,id) WHERE i.id IS NULL OR i.last_version<>m.catalog_version),'every live master and same-UUID identity version agree');
DROP TRIGGER zzz_foundation_fail_after_evidence ON public.customers;
DROP TRIGGER zzz_foundation_fail_after_evidence ON public.products;

SELECT pg_temp.foundation_raises('TRUNCATE TABLE private.catalog_identity_v1','23514','identity truncate cannot erase retained evidence');
-- CASCADE reaches the trigger instead of failing earlier on an incoming FK.
-- foundation_raises rolls the whole failed statement back, including every target.
SELECT pg_temp.foundation_raises('TRUNCATE TABLE public.customers CASCADE','23514','customer truncate cannot bypass tombstones');
SELECT pg_temp.foundation_raises('TRUNCATE TABLE public.products CASCADE','23514','product truncate cannot bypass tombstones');
SELECT pg_temp.foundation_assert((SELECT count(*)=7 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND t.tgenabled='O' AND ((n.nspname='public' AND c.relname IN ('customers','products') AND t.tgname IN ('catalog_master_before_v1','catalog_master_after_v1','catalog_master_no_truncate_v1'))
 OR (n.nspname='private' AND c.relname='catalog_identity_v1' AND t.tgname='catalog_identity_no_truncate_v1'))),'both master lifecycle and no-truncate guards installed');

-- Sequential command proof under the actual non-bypass application role. These
-- assertions do not establish concurrent sessions or cross-commit recovery.
CREATE FUNCTION pg_temp.foundation_catalogue_raises(statement text, expected_state text, expected_detail text, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE actual_state text; actual_detail text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE, actual_detail = PG_EXCEPTION_DETAIL;
  END;
  IF actual_state IS DISTINCT FROM expected_state OR actual_detail IS DISTINCT FROM expected_detail THEN
    RAISE EXCEPTION '%: expected state/detail %/%, got %/%', label, expected_state, expected_detail, actual_state, actual_detail;
  END IF;
END $$;
REVOKE ALL ON FUNCTION pg_temp.foundation_catalogue_raises(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.foundation_catalogue_raises(text,text,text,text) TO authenticated, anon;
CREATE TEMP TABLE catalogue_status_cases_v1 (
  actor integer, kind text, id uuid, request_id uuid, payload jsonb, receipt jsonb,
  legacy_row jsonb, PRIMARY KEY (actor, kind)
) ON COMMIT DROP;
INSERT INTO catalogue_status_cases_v1(actor, kind, id, request_id, payload)
SELECT actor, kind, md5('catalogue-status-' || kind || '-' || actor)::uuid,
  md5('catalogue-status-request-' || kind || '-' || actor)::uuid,
  jsonb_build_object('kind', kind, 'id', md5('catalogue-status-' || kind || '-' || actor)::uuid,
    'expected_version', '1', 'is_enabled', false)
FROM generate_series(1,3) actor CROSS JOIN (VALUES ('customer'), ('product')) kinds(kind);
SELECT pg_temp.foundation_master_insert(kind, id, 'Fictional status master') FROM catalogue_status_cases_v1;
UPDATE catalogue_status_cases_v1 SET legacy_row = pg_temp.foundation_master_row(kind,id) - ARRAY['catalog_version','is_enabled'];
-- Status is allowed for both unknown and used lifetime evidence while readiness is false.
UPDATE private.catalog_identity_v1 i SET lifetime_state = 'used'
FROM catalogue_status_cases_v1 c WHERE c.actor = 3 AND i.kind = c.kind AND i.id = c.id;
GRANT SELECT, UPDATE ON catalogue_status_cases_v1 TO authenticated;

SET LOCAL ROLE authenticated;
DO $status_commands$
DECLARE c record; result jsonb; replay jsonb; before_row jsonb; before_ctid tid; after_ctid tid; keys text[];
  fresh uuid; invalid jsonb; bad_version text;
BEGIN
  PERFORM pg_temp.foundation_assert(current_user = 'authenticated'
    AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
    AND row_security_active('public.customers') AND row_security_active('public.products'), 'actual authenticated status command role');
  FOR c IN SELECT * FROM pg_temp.catalogue_status_cases_v1 ORDER BY actor, kind LOOP
    PERFORM set_config('request.jwt.claim.sub', md5('catalogue-foundation-actor-' || c.actor)::uuid::text, true);
    result := public.pilot_catalog_transaction_v1(c.request_id, 'set_enabled', c.payload);
    SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(result) k;
    PERFORM pg_temp.foundation_assert(keys = ARRAY['actor_id','after','before','committed_at','id','kind','operation','request_id','version'], 'exact minimal status receipt fields');
    PERFORM pg_temp.foundation_assert(result @> jsonb_build_object('version',1,'actor_id',auth.uid(),'request_id',c.request_id,
      'operation','set_enabled','kind',c.kind,'id',c.id,
      'before',jsonb_build_object('catalog_version','1','is_enabled',true),
      'after',jsonb_build_object('catalog_version','2','is_enabled',false))
      AND jsonb_typeof(result->'committed_at') = 'string'
      AND (result->>'committed_at')::timestamptz IS NOT NULL, 'disable returns exact status receipt');
    UPDATE pg_temp.catalogue_status_cases_v1 SET receipt = result WHERE actor = c.actor AND kind = c.kind;
    before_row := pg_temp.foundation_master_row(c.kind,c.id);
    EXECUTE format('SELECT ctid FROM public.%I WHERE id=$1', CASE c.kind WHEN 'customer' THEN 'customers' ELSE 'products' END) INTO before_ctid USING c.id;
    replay := public.pilot_catalog_transaction_v1(md5('catalogue-status-noop-' || c.kind || '-' || c.actor)::uuid,
      'set_enabled', c.payload || '{"expected_version":"2"}');
    EXECUTE format('SELECT ctid FROM public.%I WHERE id=$1', CASE c.kind WHEN 'customer' THEN 'customers' ELSE 'products' END) INTO after_ctid USING c.id;
    PERFORM pg_temp.foundation_assert(replay->'before' = replay->'after'
      AND replay->'after' = '{"catalog_version":"2","is_enabled":false}'::jsonb
      AND before_row = pg_temp.foundation_master_row(c.kind,c.id) AND before_ctid = after_ctid, 'status no-op does not UPDATE the master');
    replay := public.pilot_catalog_transaction_v1(md5('catalogue-status-enable-' || c.kind || '-' || c.actor)::uuid,
      'set_enabled', c.payload || '{"expected_version":"2","is_enabled":true}');
    PERFORM pg_temp.foundation_assert(replay->'before' = '{"catalog_version":"2","is_enabled":false}'::jsonb
      AND replay->'after' = '{"catalog_version":"3","is_enabled":true}'::jsonb, 'enable increments once through existing triggers');
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(c.kind,c.id) - ARRAY['catalog_version','is_enabled'] = c.legacy_row, 'status leaves every legacy business field unchanged');
    PERFORM pg_temp.foundation_assert(public.pilot_catalog_transaction_v1(c.request_id,'set_enabled',c.payload) = result, 'exact replay after later master change');
    PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(c.request_id,false) = jsonb_build_object('status','committed','receipt',result)
      AND public.pilot_reconcile_catalog_v1(c.request_id,true) = jsonb_build_object('status','committed','receipt',result), 'committed recovery returns original receipt even when abandon is requested');
    FOR invalid IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
      c.payload || '{"is_enabled":true}', c.payload || '{"expected_version":"2"}',
      c.payload || jsonb_build_object('id',md5('different-status-target')::uuid),
      c.payload || jsonb_build_object('kind',CASE c.kind WHEN 'customer' THEN 'product' ELSE 'customer' END))) LOOP
      PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',c.request_id,invalid),
        '22023','CATALOG_REQUEST_CONFLICT','same request with different binding refuses');
    END LOOP;
    fresh := md5('catalogue-status-stale-' || c.kind || '-' || c.actor)::uuid;
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',fresh,c.payload),
      '40001','CATALOG_VERSION_CONFLICT','new request with stale version refuses');
    PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(fresh,false) = '{"status":"unknown"}'::jsonb, 'failed command has no committed receipt');
    fresh := md5('catalogue-status-readonly-' || c.kind || '-' || c.actor)::uuid;
    PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(fresh,false) = '{"status":"unknown"}'::jsonb
      AND public.pilot_reconcile_catalog_v1(fresh,false) = '{"status":"unknown"}'::jsonb, 'readonly unknown recovery can be repeated without abandonment');
    fresh := md5('catalogue-status-abandoned-' || c.kind || '-' || c.actor)::uuid;
    PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(fresh,false) = '{"status":"unknown"}'::jsonb, 'readonly reconciliation leaves unknown request unknown');
    PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(fresh,true) = '{"status":"abandoned"}'::jsonb
      AND public.pilot_reconcile_catalog_v1(fresh,false) = '{"status":"abandoned"}'::jsonb
      AND public.pilot_reconcile_catalog_v1(fresh,true) = '{"status":"abandoned"}'::jsonb, 'abandon creates a permanent terminal fence');
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',fresh,c.payload || '{"expected_version":"3"}'),
      '22023','CATALOG_REQUEST_ABANDONED','abandonment fences delayed dispatch');
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(c.kind,c.id)->>'catalog_version' = '3', 'replays refusals and abandonment never mutate the master');
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
  FOR c IN SELECT * FROM pg_temp.catalogue_status_cases_v1 WHERE actor = 1 LOOP
    PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(c.request_id,false) = '{"status":"unknown"}'::jsonb, 'another actor cannot see the original receipt');
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',c.request_id,c.payload),
      '40001','CATALOG_VERSION_CONFLICT','another actor cannot replay the original receipt');
    result := public.pilot_catalog_transaction_v1(c.request_id,'set_enabled',c.payload || '{"expected_version":"3","is_enabled":true}');
    PERFORM pg_temp.foundation_assert(result->>'actor_id' = auth.uid()::text AND result <> c.receipt, 'same request UUID has independent actor binding');
  END LOOP;
  FOR c IN SELECT * FROM pg_temp.catalogue_status_cases_v1 WHERE actor = 2 LOOP
    fresh := md5('catalogue-status-invalid-' || c.kind)::uuid;
    FOREACH bad_version IN ARRAY ARRAY['','0','01','+1',' 1','1 ','-1','1.0','1e0','9223372036854775808','100000000000000000000'] LOOP
      PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',fresh,c.payload || jsonb_build_object('expected_version',bad_version)),
        '22023','CATALOG_INVALID_INPUT','noncanonical or overflowing version refuses');
    END LOOP;
    FOR invalid IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
      'null'::jsonb, '[]'::jsonb, '"payload"'::jsonb, c.payload - 'id', c.payload || '{"extra":true}',
      c.payload || '{"kind":"other"}', c.payload || '{"kind":null}', c.payload || '{"id":42}',
      c.payload || '{"id":"AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"}', c.payload || '{"id":"bad"}',
      c.payload || '{"expected_version":1}', c.payload || '{"expected_version":null}',
      c.payload || '{"is_enabled":"false"}', c.payload || '{"is_enabled":null}')) LOOP
      PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',fresh,invalid),
        '22023','CATALOG_INVALID_INPUT','malformed exact status payload refuses');
    END LOOP;
    FOREACH bad_version IN ARRAY ARRAY['create','edit','delete_unused','SET_ENABLED',''] LOOP
      PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,%L,%L::jsonb)',fresh,bad_version,c.payload),
        '22023','CATALOG_INVALID_INPUT','only set_enabled operation is implemented');
    END LOOP;
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(NULL,''set_enabled'',%L::jsonb)',c.payload),'22023','CATALOG_INVALID_INPUT','null request refuses');
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,NULL,%L::jsonb)',fresh,c.payload),'22023','CATALOG_INVALID_INPUT','null operation refuses');
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',NULL)',fresh),'22023','CATALOG_INVALID_INPUT','SQL null payload refuses');
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',fresh,c.payload || jsonb_build_object('id',md5('catalogue-status-missing')::uuid)),
      'P0002','CATALOG_NOT_FOUND','missing master refuses without a receipt');
    PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(fresh,false) = '{"status":"unknown"}'::jsonb, 'invalid requests never create a ledger entry');
  END LOOP;
  PERFORM pg_temp.foundation_catalogue_raises('SELECT public.pilot_reconcile_catalog_v1(NULL,false)','22023','CATALOG_INVALID_INPUT','null recovery request refuses');
  PERFORM pg_temp.foundation_catalogue_raises($q$SELECT public.pilot_reconcile_catalog_v1(md5('null-abandon')::uuid,NULL)$q$,'22023','CATALOG_INVALID_INPUT','null abandon flag refuses');
END $status_commands$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Real large-version masters were seeded above through the existing identity guards.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
DO $$ DECLARE kind text; result jsonb; payload jsonb; request_id uuid; BEGIN
  FOREACH kind IN ARRAY ARRAY['customer','product'] LOOP
    payload := jsonb_build_object('kind',kind,'id',md5('catalogue-large-version-' || kind)::uuid,'expected_version','9007199254740993','is_enabled',false);
    request_id := md5('catalogue-status-large-' || kind)::uuid;
    result := public.pilot_catalog_transaction_v1(request_id,'set_enabled',payload);
    PERFORM pg_temp.foundation_assert(result->'before'->'catalog_version' = '"9007199254740993"'::jsonb
      AND result->'after'->'catalog_version' = '"9007199254740994"'::jsonb
      AND public.pilot_catalog_transaction_v1(request_id,'set_enabled',payload) = result, 'status receipt preserves exact bigint text');
    payload := jsonb_build_object('kind',kind,'id',md5('catalogue-live-max-version-' || kind)::uuid,'expected_version','9223372036854775807','is_enabled',true);
    result := public.pilot_catalog_transaction_v1(md5('catalogue-status-max-noop-' || kind)::uuid,'set_enabled',payload);
    PERFORM pg_temp.foundation_assert(result->'before' = result->'after' AND result->'after'->>'catalog_version' = '9223372036854775807', 'maximum version permits status no-op');
    request_id := md5('catalogue-status-max-change-' || kind)::uuid;
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',request_id,payload || '{"is_enabled":false}'),
      '22003','CATALOG_VERSION_CONFLICT','maximum version change fails atomically');
    PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(request_id,false) = '{"status":"unknown"}'::jsonb, 'overflow creates no receipt');
  END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Every current legacy UPDATE column is required, including inherited grants.
DO $$ DECLARE col record; c record; BEGIN
  FOR col IN SELECT * FROM pg_temp.catalogue_legacy_column_privileges_v1
    WHERE principal = 'authenticated' AND privilege = 'UPDATE' AND allowed LOOP
    BEGIN
      SELECT * INTO STRICT c FROM pg_temp.catalogue_status_cases_v1
        WHERE actor = 2 AND kind = CASE col.relation WHEN 'public.customers' THEN 'customer' ELSE 'product' END;
      EXECUTE format('REVOKE UPDATE (%I) ON TABLE %s FROM authenticated',col.column_name,col.relation);
      IF c.kind = 'product' THEN EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.products FROM catalogue_foundation_inherited_probe',col.column_name); END IF;
      PERFORM pg_temp.foundation_assert(NOT has_column_privilege('authenticated',col.relation,col.column_name,'UPDATE'), 'status grant probe removes all effective paths');
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
      PERFORM pg_temp.foundation_assert(public.pilot_procurement_access_v2()->
        (CASE c.kind WHEN 'customer' THEN 'product_set_enabled' ELSE 'customer_set_enabled' END) = 'true'::jsonb,
        'the other kind remains authorized during stored-kind recovery denial');
      PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',md5('catalogue-revoked-' || col.column_name)::uuid,c.payload || '{"expected_version":"3"}'),
        '42501','CATALOG_ACCESS_DENIED','new command rechecks every effective legacy UPDATE column');
      PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',c.request_id,c.payload),
        '42501','CATALOG_ACCESS_DENIED','replay rechecks every effective legacy UPDATE column');
      PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_reconcile_catalog_v1(%L::uuid,false)',c.request_id),
        '42501','CATALOG_ACCESS_DENIED','recovery rechecks the stored kind capability');
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'Rollback status column probe' USING ERRCODE = 'PZ004';
    EXCEPTION WHEN SQLSTATE 'PZ004' THEN NULL;
    END;
  END LOOP;
  BEGIN
    REVOKE UPDATE(name) ON public.products FROM authenticated;
    PERFORM pg_temp.foundation_assert(has_column_privilege('authenticated','public.products','name','UPDATE'), 'status command retains an inherited UPDATE path');
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
    SELECT * INTO STRICT c FROM pg_temp.catalogue_status_cases_v1 WHERE actor = 2 AND kind = 'product';
    PERFORM pg_temp.foundation_assert(public.pilot_catalog_transaction_v1(c.request_id,'set_enabled',c.payload) = c.receipt
      AND public.pilot_catalog_transaction_v1(md5('catalogue-inherited-status')::uuid,'set_enabled',c.payload || '{"expected_version":"3"}')->'after' = '{"catalog_version":"4","is_enabled":false}'::jsonb,
      'status accepts inherited effective privilege without a direct grant');
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'Rollback inherited status probe' USING ERRCODE = 'PZ004';
  EXCEPTION WHEN SQLSTATE 'PZ004' THEN NULL;
  END;
END $$;

-- Current profile authority is required even for an already committed request.
DO $$ DECLARE c record; change text; BEGIN
  SELECT * INTO STRICT c FROM pg_temp.catalogue_status_cases_v1 WHERE actor = 1 AND kind = 'product';
  FOREACH change IN ARRAY ARRAY['role = ''sales_person''','is_active = false'] LOOP
    BEGIN
      PERFORM set_config('request.jwt.claim.sub','',true);
      EXECUTE 'UPDATE public.users SET ' || change || ' WHERE id = md5(''catalogue-foundation-actor-1'')::uuid';
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-1')::uuid::text,true);
      PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',c.request_id,c.payload),
        '42501','CATALOG_ACCESS_DENIED','same request under inactive profile is denied');
      PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_reconcile_catalog_v1(%L::uuid,true)',c.request_id),
        '42501','CATALOG_ACCESS_DENIED','recovery requires current maintainer profile');
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'Rollback status profile probe' USING ERRCODE = 'PZ004';
    EXCEPTION WHEN SQLSTATE 'PZ004' THEN NULL;
    END;
  END LOOP;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE actor integer; c record; BEGIN
  SELECT * INTO STRICT c FROM pg_temp.catalogue_status_cases_v1 cases WHERE cases.actor = 1 AND cases.kind = 'customer';
  FOR actor IN 4..9 LOOP
    PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-' || actor)::uuid::text,true);
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',c.request_id,c.payload),'42501','CATALOG_ACCESS_DENIED','Sales inactive and missing profiles cannot command');
    PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_reconcile_catalog_v1(%L::uuid,false)',c.request_id),'42501','CATALOG_ACCESS_DENIED','Sales inactive and missing profiles cannot recover');
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',c.request_id,c.payload),'42501','CATALOG_ACCESS_DENIED','missing auth actor cannot command');
  PERFORM pg_temp.foundation_catalogue_raises(format('SELECT public.pilot_reconcile_catalog_v1(%L::uuid,false)',c.request_id),'42501','CATALOG_ACCESS_DENIED','missing auth actor cannot recover');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-1')::uuid::text,true);
SELECT pg_temp.foundation_catalogue_raises($q$SELECT public.pilot_reconcile_catalog_v1(md5('catalogue-status-request-product-1')::uuid,false)$q$,'42501','CATALOG_ACCESS_DENIED','definer owner is not an authenticated caller');
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE anon;
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v1(md5('anon')::uuid,'set_enabled','{}')$q$,'42501','anon cannot execute status command');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_reconcile_catalog_v1(md5('anon')::uuid,false)$q$,'42501','anon cannot execute status recovery');
RESET ROLE;

-- Inject a failure after both master mutation and terminal receipt insertion.
CREATE FUNCTION pg_temp.foundation_fail_status_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.request_id IN (md5('catalogue-status-rollback-customer')::uuid,md5('catalogue-status-rollback-product')::uuid) THEN
    IF NEW.receipt->'after' <> '{"catalog_version":"4","is_enabled":false}'::jsonb
      OR (pg_temp.foundation_master_row(NEW.binding->>'kind',(NEW.binding->>'id')::uuid)->>'catalog_version') <> '4'
      OR NOT EXISTS (SELECT 1 FROM private.catalog_identity_v1 WHERE kind = NEW.binding->>'kind' AND id = (NEW.binding->>'id')::uuid AND last_version = 4) THEN
      RAISE EXCEPTION 'Status failure must follow master identity and receipt writes' USING ERRCODE = 'PFC91';
    END IF;
    RAISE EXCEPTION 'Forced terminal receipt failure' USING ERRCODE = 'PFC92';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zzz_foundation_fail_status_receipt AFTER INSERT ON private.catalog_requests_v1
  FOR EACH ROW EXECUTE FUNCTION pg_temp.foundation_fail_status_receipt();
DO $$ DECLARE c record; master_before jsonb; identity_before jsonb; failed_request_id uuid; BEGIN
  FOR c IN SELECT * FROM pg_temp.catalogue_status_cases_v1 WHERE actor = 2 LOOP
    master_before := pg_temp.foundation_master_row(c.kind,c.id);
    SELECT to_jsonb(i) INTO identity_before FROM private.catalog_identity_v1 i WHERE i.kind = c.kind AND i.id = c.id;
    failed_request_id := md5('catalogue-status-rollback-' || c.kind)::uuid;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')::uuid::text,true);
    PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''set_enabled'',%L::jsonb)',failed_request_id,c.payload || '{"expected_version":"3"}'),
      'PFC92','forced failure occurs after status and receipt writes');
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.foundation_assert(pg_temp.foundation_master_row(c.kind,c.id) = master_before
      AND (SELECT to_jsonb(i) = identity_before FROM private.catalog_identity_v1 i WHERE i.kind = c.kind AND i.id = c.id)
      AND NOT EXISTS (SELECT 1 FROM private.catalog_requests_v1 r WHERE r.actor_id = md5('catalogue-foundation-actor-2')::uuid AND r.request_id = failed_request_id),
      'receipt failure rolls back master identity and request');
    PERFORM set_config('request.jwt.claim.sub','',true);
  END LOOP;
END $$;
DROP TRIGGER zzz_foundation_fail_status_receipt ON private.catalog_requests_v1;

SELECT pg_temp.foundation_assert((SELECT count(*) = 6 AND bool_and(status = 'abandoned' AND binding IS NULL AND receipt IS NULL)
 FROM private.catalog_requests_v1 WHERE request_id IN (
 SELECT md5('catalogue-status-abandoned-' || kind || '-' || actor)::uuid FROM pg_temp.catalogue_status_cases_v1)), 'abandonment stores only the actor request fence');
SELECT pg_temp.foundation_assert(NOT EXISTS (SELECT 1 FROM private.catalog_requests_v1 WHERE request_id IN (
 SELECT md5(prefix || kind || '-' || actor)::uuid FROM pg_temp.catalogue_status_cases_v1
 CROSS JOIN (VALUES ('catalogue-status-stale-'), ('catalogue-status-readonly-')) prefixes(prefix))), 'readonly unknown reconciliation does not insert a ledger row');
SELECT pg_temp.foundation_assert(NOT EXISTS (SELECT 1 FROM private.catalog_requests_v1 r WHERE status = 'committed'
 AND (binding - ARRAY['operation','kind','id','expected_version','is_enabled'] <> '{}'::jsonb
   OR binding->>'operation' <> 'set_enabled')), 'request binding contains no business fields');
SELECT pg_temp.foundation_catalogue_raises('UPDATE private.catalog_requests_v1 SET status = status','23514','CATALOG_REQUEST_IMMUTABLE','terminal receipts and fences cannot be rewritten');
SELECT pg_temp.foundation_catalogue_raises($q$UPDATE private.catalog_requests_v1 SET status = 'committed' WHERE status = 'abandoned'$q$,'23514','CATALOG_REQUEST_IMMUTABLE','abandoned fences cannot be changed into committed requests');
SELECT pg_temp.foundation_catalogue_raises('DELETE FROM private.catalog_requests_v1','23514','CATALOG_REQUEST_IMMUTABLE','terminal receipts and fences cannot be deleted');
SELECT pg_temp.foundation_catalogue_raises($q$DELETE FROM private.catalog_requests_v1 WHERE status = 'abandoned'$q$,'23514','CATALOG_REQUEST_IMMUTABLE','abandoned fences cannot be deleted');
SELECT pg_temp.foundation_catalogue_raises('TRUNCATE private.catalog_requests_v1','23514','CATALOG_REQUEST_IMMUTABLE','terminal receipts and fences cannot be truncated');
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises('SELECT * FROM private.catalog_requests_v1','42501','request ledger cannot be read through raw API');
SELECT pg_temp.foundation_raises($q$INSERT INTO private.catalog_requests_v1(actor_id,request_id,status) VALUES(md5('raw')::uuid,md5('raw')::uuid,'abandoned')$q$,'42501','request ledger cannot be inserted through raw API');
SELECT pg_temp.foundation_raises('UPDATE private.catalog_requests_v1 SET status = status','42501','request ledger cannot be updated through raw API');
SELECT pg_temp.foundation_raises('DELETE FROM private.catalog_requests_v1','42501','request ledger cannot be deleted through raw API');
SELECT pg_temp.foundation_raises('TRUNCATE private.catalog_requests_v1','42501','request ledger cannot be truncated through raw API');
SELECT pg_temp.foundation_raises('SELECT private.catalog_authorize_v1(NULL,NULL)','42501','private command authorization helper is not callable through API');
SELECT pg_temp.foundation_assert(NOT has_function_privilege(current_user,'private.catalog_request_terminal_v1()','EXECUTE'), 'private terminal guard is not executable through API');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.foundation_assert((SELECT count(*) = 1 AND bool_and(NOT tracking_ready AND execution_generation = 1) FROM private.catalog_cutover_v1), 'status commands do not advance readiness or generation');
SELECT pg_temp.foundation_assert(NOT EXISTS (SELECT 1 FROM pg_temp.catalogue_status_cases_v1 c
 JOIN private.catalog_identity_v1 i ON i.kind = c.kind AND i.id = c.id
 WHERE i.last_version <> 3 OR i.lifetime_state <> CASE c.actor WHEN 3 THEN 'used' ELSE 'unknown' END), 'status preserves lifetime state and identity versions');
