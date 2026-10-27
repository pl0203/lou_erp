-- Independently fictional behavioral fixture. Run only inside the composed,
-- identity-bound rollback-only runner after new09/new10/new11. No live cutover.
SAVEPOINT guarded_delete_fixture;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id) VALUES(md5('guarded-delete-fictional-co')::uuid),(md5('guarded-delete-fictional-po')::uuid);
INSERT INTO public.users(id,full_name,email,role,is_active) VALUES
 (md5('guarded-delete-fictional-co')::uuid,'Fictional guarded CO','guarded-co@example.invalid','co_admin',true),
 (md5('guarded-delete-fictional-po')::uuid,'Fictional guarded PO','guarded-po@example.invalid','po_admin',true);
CREATE TEMP TABLE guarded_delete_receipts_v1(kind text PRIMARY KEY,created jsonb,edited jsonb,deleted jsonb,payload jsonb) ON COMMIT DROP;
GRANT SELECT,INSERT,UPDATE ON pg_temp.guarded_delete_receipts_v1 TO authenticated;

-- Generation one stays hard-false, and raw/master privileges are not widened.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
SELECT pg_temp.foundation_assert(public.pilot_catalog_delete_access_v1()=jsonb_build_object('version',1,'actor_id',auth.uid(),'customer_delete',false,'product_delete',false),'generation-one readiness read is false and actor-bound');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v1(md5('guarded-gen1-request')::uuid,'delete_unused',
 jsonb_build_object('kind','product','id',md5('guarded-never-existing')::uuid,'expected_version','1'))$q$,'55000','generation-one guarded delete unavailable');
SELECT pg_temp.foundation_raises('SELECT * FROM private.catalog_create_scope_v1','42501','birth scope private');
SELECT pg_temp.foundation_raises($q$SELECT private.catalog_create_scope_enter_v1(gen_random_uuid(),'product',gen_random_uuid())$q$,'42501','client cannot forge birth scope');
SELECT pg_temp.foundation_raises('DELETE FROM public.customers','42501','CO customer raw deletion still unavailable');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_generation_one, DROP CONSTRAINT catalog_foundation_not_ready;
UPDATE private.catalog_cutover_v1 SET execution_generation=2,tracking_ready=true WHERE singleton;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
SELECT pg_temp.foundation_assert(public.pilot_catalog_delete_access_v1()=jsonb_build_object('version',1,'actor_id',auth.uid(),'customer_delete',true,'product_delete',true),'ready generation-two CO current authority');
DO $birth$
DECLARE kind text; payload jsonb; created jsonb; edited jsonb; deleted jsonb; target uuid; request uuid;
BEGIN
 FOREACH kind IN ARRAY ARRAY['customer','product'] LOOP
  payload:=jsonb_build_object('kind',kind,'values',CASE kind WHEN 'customer' THEN jsonb_build_object(
    'name','Fictional unused customer','address',NULL,'city',NULL,'phone',NULL,'email',NULL,'pricing_tier','luar_kota','customer_category','perorangan')
   ELSE jsonb_build_object('name','Fictional unused product','sku','FICTIONAL-GUARDED-UNUSED','size',NULL,
    'harga_pokok',NULL,'luar_kota',0,'dalam_kota',NULL,'depo_bangunan',NULL) END);
  created:=public.pilot_catalog_transaction_v1(md5('guarded-birth-'||kind)::uuid,'create',payload);
  target:=(created->>'id')::uuid;
  edited:=public.pilot_catalog_transaction_v1(md5('guarded-edit-'||kind)::uuid,'edit',jsonb_build_object(
    'kind',kind,'id',target,'expected_version','1','values',jsonb_build_object('name','Fictional edited unused '||kind)));
  payload:=jsonb_build_object('kind',kind,'id',target,'expected_version','2');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''delete_unused'',%L::jsonb)',
    md5('guarded-stale-'||kind),jsonb_set(payload,'{expected_version}','"1"')),'40001','stale delete version refused');
  request:=md5('guarded-delete-'||kind)::uuid;
  deleted:=public.pilot_catalog_transaction_v1(request,'delete_unused',payload);
  PERFORM pg_temp.foundation_assert(deleted @> jsonb_build_object('version',1,'actor_id',auth.uid(),'request_id',request,
    'operation','delete_unused','kind',kind,'id',target,'before',edited->'after','after',NULL),'exact delete receipt and decimal before');
  PERFORM pg_temp.foundation_assert(public.pilot_catalog_transaction_v1(request,'delete_unused',payload)=deleted,'lost-response exact delete replay after target gone');
  PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(request,false)=jsonb_build_object('status','committed','receipt',deleted),'delete reconcile target independent');
  PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(request,true)=jsonb_build_object('status','committed','receipt',deleted),'abandon never overwrites committed delete');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''delete_unused'',%L::jsonb)',
    md5('guarded-missing-'||kind),payload),'P0002','missing target is not a receipt');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''delete_unused'',%L::jsonb)',
    request,jsonb_set(payload,'{expected_version}','"3"')),'22023','delete payload mismatch refused');
  INSERT INTO pg_temp.guarded_delete_receipts_v1 VALUES(kind,created,edited,deleted,payload);
 END LOOP;
END $birth$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.foundation_assert((SELECT count(*)=2 FROM private.catalog_identity_v1 i JOIN pg_temp.guarded_delete_receipts_v1 r
 ON i.kind=r.kind AND i.id=(r.created->>'id')::uuid WHERE i.lifetime_state='unused' AND i.last_version=2 AND i.deleted_at IS NOT NULL),
 'catalogue-only edit preserves real unused birth and delete tombstones');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_create_scope_v1),'successful creates leave no private scope');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE status='pending'),'no pending catalogue requests');
SELECT pg_temp.foundation_raises($q$UPDATE private.catalog_requests_v1 SET receipt='{}' WHERE binding->>'operation'='delete_unused'$q$,'23514','delete receipts immutable');

-- Former CO must not probe the stored deletion through ANY dispatcher, including
-- invalid create/edit/status input. Reauthorization comes before error metadata.
UPDATE public.users SET role='po_admin' WHERE id=md5('guarded-delete-fictional-co')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
SELECT pg_temp.foundation_assert(public.pilot_catalog_delete_access_v1()=jsonb_build_object('version',1,'actor_id',auth.uid(),'customer_delete',false,'product_delete',false),'former CO readiness becomes false while direct product mode remains separate');
DO $$ DECLARE operation text; BEGIN
 FOREACH operation IN ARRAY ARRAY['delete_unused','create','edit','set_enabled','bogus'] LOOP
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,%L,''{}''::jsonb)',
   md5('guarded-delete-product'),operation),'42501','stored CO-only delete reauthorized before every dispatch');
 END LOOP;
 PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_reconcile_catalog_v1(md5('guarded-delete-product')::uuid,false)$q$,'42501','former CO cannot reconcile delete');
 PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_reconcile_catalog_v1(md5('guarded-delete-product')::uuid,true)$q$,'42501','former CO cannot abandon/probe delete');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET role='co_admin' WHERE id=md5('guarded-delete-fictional-co')::uuid;

-- A retained unused tombstone is not a new birth, and raw UUID inserts never gain
-- unused provenance even when generation two is ready.
INSERT INTO public.products(id,name,sku) SELECT (created->>'id')::uuid,'Fictional recreated product','FICTIONAL-RECREATED' FROM pg_temp.guarded_delete_receipts_v1 WHERE kind='product';
INSERT INTO public.products(id,name,sku) VALUES(md5('guarded-raw-unknown')::uuid,'Fictional raw product','FICTIONAL-RAW-UNKNOWN');
SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('guarded-raw-unknown')::uuid),'ready raw insert remains unknown');
SELECT pg_temp.foundation_raises($q$UPDATE private.catalog_identity_v1 SET lifetime_state='unused' WHERE kind='product' AND id=md5('guarded-raw-unknown')::uuid$q$,'23514','unknown never promoted to unused');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v1(md5('guarded-unknown-delete')::uuid,'delete_unused',jsonb_build_object(
 'kind','product','id',md5('guarded-raw-unknown')::uuid,'expected_version','1'))$q$,'23514','unknown evidence blocks deletion');
DO $$ DECLARE payload jsonb; BEGIN
 SELECT jsonb_set(r.payload,'{expected_version}','"3"') INTO payload FROM pg_temp.guarded_delete_receipts_v1 r WHERE kind='product';
 PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''delete_unused'',%L::jsonb)',md5('guarded-recreate-delete'),payload),'23514','recreated tombstone cannot be deleted as fresh unused');
END $$;
SELECT pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(md5('guarded-unbound-abandoned')::uuid,true)='{"status":"abandoned"}'::jsonb,'unknown request can be abandoned');
SELECT pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(md5('guarded-unbound-abandoned')::uuid,false)='{"status":"abandoned"}'::jsonb,'unbound abandonment stays unbound');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v1(md5('guarded-unbound-abandoned')::uuid,'delete_unused',jsonb_build_object(
 'kind','product','id',md5('guarded-raw-unknown')::uuid,'expected_version','1'))$q$,'22023','abandoned request cannot resend');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Force a failure after the real birth evidence, not before INSERT. Everything
-- including birth scope, catalogue row and pending ledger must roll back.
CREATE FUNCTION pg_temp.guarded_fail_after_birth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.name='Fictional failed guarded birth' THEN
  IF NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE kind='product' AND id=NEW.id AND lifetime_state='unused') THEN
   RAISE EXCEPTION 'Expected actual unused evidence' USING ERRCODE='PGB91'; END IF;
  RAISE EXCEPTION 'Fictional forced birth rollback' USING ERRCODE='PGB90';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_guarded_fail_after_birth AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION pg_temp.guarded_fail_after_birth();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v1(md5('guarded-failed-birth')::uuid,'create',jsonb_build_object('kind','product','values',
 jsonb_build_object('name','Fictional failed guarded birth','sku','FICTIONAL-FAILED-BIRTH','size',NULL,'harga_pokok',NULL,'luar_kota',0,'dalam_kota',NULL,'depo_bangunan',NULL)))$q$,'PGB90','failure after actual birth rolls back');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DROP TRIGGER zzz_guarded_fail_after_birth ON public.products;
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE request_id=md5('guarded-failed-birth')::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.products WHERE sku='FICTIONAL-FAILED-BIRTH') AND NOT EXISTS(SELECT 1 FROM private.catalog_create_scope_v1),'failed birth leaves no data or scope');
-- The readiness read has no service shortcut and never leaks private gate data.
DO $service_readiness$
DECLARE denied boolean:=false;
BEGIN
 SET LOCAL ROLE service_role;
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Actual service role required'; END IF;
 BEGIN
  PERFORM public.pilot_catalog_delete_access_v1();
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 RESET ROLE;
 PERFORM pg_temp.foundation_assert(denied,'service cannot read guarded readiness');
END $service_readiness$;
UPDATE private.catalog_cutover_v1 SET tracking_ready=false WHERE singleton;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
SELECT pg_temp.foundation_assert(public.pilot_catalog_delete_access_v1()=jsonb_build_object('version',1,'actor_id',auth.uid(),'customer_delete',false,'product_delete',false),'not-ready generation-two read is false');
DO $replay_while_not_ready$ DECLARE saved record; BEGIN
 SELECT * INTO saved FROM pg_temp.guarded_delete_receipts_v1 WHERE kind='customer';
 PERFORM pg_temp.foundation_assert(public.pilot_catalog_transaction_v1(md5('guarded-delete-customer')::uuid,'delete_unused',saved.payload)=saved.deleted,'authorized committed delete replay does not revisit current readiness');
 PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(md5('guarded-delete-customer')::uuid,false)=jsonb_build_object('status','committed','receipt',saved.deleted),'delete reconciliation is independent of readiness');
END $replay_while_not_ready$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE private.catalog_cutover_v1 SET tracking_ready=true WHERE singleton;
-- Readiness is per-kind current authority, not merely role plus a cached flag.
DO $readiness_grant$ BEGIN
 BEGIN
  REVOKE SELECT ON public.products FROM authenticated;
  PERFORM set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.foundation_assert(public.pilot_catalog_delete_access_v1()=jsonb_build_object('version',1,'actor_id',auth.uid(),'customer_delete',true,'product_delete',false),'lost product SELECT prevents only product guarded readiness');
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'Restore fictional read grant' USING ERRCODE='PGD81';
 EXCEPTION WHEN SQLSTATE 'PGD81' THEN NULL;
 END;
END $readiness_grant$;
UPDATE public.users SET is_active=false WHERE id=md5('guarded-delete-fictional-co')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
SELECT pg_temp.foundation_raises('SELECT public.pilot_catalog_delete_access_v1()','42501','inactive actor cannot read guarded readiness');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=true WHERE id=md5('guarded-delete-fictional-co')::uuid;
-- Exact bigint text survives delete receipt and target-independent recovery.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
INSERT INTO pg_temp.guarded_delete_receipts_v1(kind,created)
SELECT 'large',public.pilot_catalog_transaction_v1(md5('guarded-large-create')::uuid,'create',jsonb_build_object('kind','product','values',
 jsonb_build_object('name','Fictional large version','sku','FICTIONAL-LARGE-VERSION','size',NULL,'harga_pokok',NULL,'luar_kota',0,'dalam_kota',NULL,'depo_bangunan',NULL)));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ALTER TABLE public.products DISABLE TRIGGER catalog_master_before_v1;
ALTER TABLE public.products DISABLE TRIGGER catalog_master_after_v1;
UPDATE public.products SET catalog_version=9007199254740993 WHERE id=(SELECT (created->>'id')::uuid FROM pg_temp.guarded_delete_receipts_v1 WHERE kind='large');
UPDATE private.catalog_identity_v1 SET last_version=9007199254740993 WHERE kind='product' AND id=(SELECT (created->>'id')::uuid FROM pg_temp.guarded_delete_receipts_v1 WHERE kind='large');
ALTER TABLE public.products ENABLE TRIGGER catalog_master_before_v1;
ALTER TABLE public.products ENABLE TRIGGER catalog_master_after_v1;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
DO $$ DECLARE key uuid; receipt jsonb; payload jsonb; BEGIN
 SELECT (created->>'id')::uuid INTO key FROM pg_temp.guarded_delete_receipts_v1 WHERE kind='large';
 payload:=jsonb_build_object('kind','product','id',key,'expected_version','9007199254740993');
 receipt:=public.pilot_catalog_transaction_v1(md5('guarded-large-delete')::uuid,'delete_unused',payload);
 PERFORM pg_temp.foundation_assert(receipt->'before'->'catalog_version'='"9007199254740993"'::jsonb,'delete large version is exact decimal text');
 PERFORM pg_temp.foundation_assert(public.pilot_catalog_transaction_v1(md5('guarded-large-delete')::uuid,'delete_unused',payload)=receipt,'large version replay immutable');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Used and absent identity evidence both refuse. These owner-only fixture probes
-- do not certify a business writer; assembled completion tests cover real uses.
UPDATE private.catalog_identity_v1 SET lifetime_state='used' WHERE kind='product' AND id=md5('guarded-raw-unknown')::uuid;
ALTER TABLE public.products DISABLE TRIGGER catalog_master_after_v1;
INSERT INTO public.products(id,name,sku) VALUES(md5('guarded-missing-evidence')::uuid,'Fictional missing evidence','FICTIONAL-MISSING-EVIDENCE');
ALTER TABLE public.products ENABLE TRIGGER catalog_master_after_v1;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v1(md5('guarded-used-delete')::uuid,'delete_unused',jsonb_build_object(
 'kind','product','id',md5('guarded-raw-unknown')::uuid,'expected_version','1'))$q$,'23514','used provenance blocks deletion');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v1(md5('guarded-missing-evidence-delete')::uuid,'delete_unused',jsonb_build_object(
 'kind','product','id',md5('guarded-missing-evidence')::uuid,'expected_version','1'))$q$,'23514','missing evidence blocks deletion');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Even an exact trusted scope cannot allocate for a discarded INSERT candidate.
-- Entering intent is not proof; only an actual AFTER INSERT event may stamp it.
SELECT set_config('request.jwt.claim.sub',md5('guarded-delete-fictional-co')::uuid::text,true);
INSERT INTO private.catalog_requests_v1(actor_id,request_id,status,binding,fingerprint,write_columns)
 VALUES(md5('guarded-delete-fictional-co')::uuid,md5('guarded-conflict-candidate-request')::uuid,'pending',
 '{"operation":"create","kind":"product"}',repeat('a',64),ARRAY['id','name','sku']);
SELECT private.catalog_create_scope_enter_v1(md5('guarded-conflict-candidate-request')::uuid,'product',md5('guarded-conflict-candidate')::uuid);
INSERT INTO public.products(id,name,sku) VALUES(md5('guarded-conflict-candidate')::uuid,'Fictional discarded birth','FICTIONAL-RAW-UNKNOWN') ON CONFLICT(sku) DO NOTHING;
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('guarded-conflict-candidate')::uuid),'discarded candidate has no identity evidence');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_create_scope_v1 WHERE birth_verified),'discarded candidate never verifies birth');
SELECT private.catalog_create_scope_leave_v1();
UPDATE private.catalog_requests_v1 SET status='abandoned' WHERE actor_id=md5('guarded-delete-fictional-co')::uuid AND request_id=md5('guarded-conflict-candidate-request')::uuid;
SELECT set_config('request.jwt.claim.sub','',true);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
ROLLBACK TO SAVEPOINT guarded_delete_fixture;
RELEASE SAVEPOINT guarded_delete_fixture;
