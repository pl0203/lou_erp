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
