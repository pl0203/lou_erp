-- Full integration acceptance; NOT run in standalone PostgreSQL (RLS bypasses there).
-- Execute after product-type-before.sql and all additive fragments, in same rollback-only session.
SELECT pg_temp.foundation_assert((SELECT count(*)=3 FROM public.products p JOIN pg_temp.tipe_receipts r ON p.id=(r.receipt->>'id')::uuid WHERE p.product_type IS NULL),'migration does not backfill legacy types');
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; old record; payload jsonb; created jsonb; edited jsonb; same jsonb; request uuid; key uuid; BEGIN
 FOR n IN 1..3 LOOP
  PERFORM set_config('request.jwt.claim.sub',md5('tipe-actor-'||n)::uuid::text,true);
  SELECT * INTO old FROM pg_temp.tipe_receipts WHERE actor=n;
  PERFORM pg_temp.foundation_assert(public.pilot_catalog_transaction_v1(old.request_id,'create',old.payload)=old.receipt,'historical committed NULL receipt replays unchanged');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''create'',%L::jsonb)',md5('tipe-v1-fresh-'||n),old.payload),'22023','fresh v1 create requires refresh');
  payload:=jsonb_build_object('kind','product','id',old.receipt->'id','expected_version','1','values',jsonb_build_object('name','Unclassified save'));
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''edit'',%L::jsonb)',md5('tipe-v1-edit-'||n),payload),'22023','v1 unclassified edit requires refresh');
  same:=public.pilot_catalog_transaction_v1(md5('tipe-status-'||n)::uuid,'set_enabled',jsonb_build_object('kind','product','id',old.receipt->'id','expected_version','1','is_enabled',false));
  PERFORM pg_temp.foundation_assert((SELECT product_type IS NULL AND NOT is_enabled FROM public.products WHERE id=(old.receipt->>'id')::uuid),'legacy status-only remains allowed');
  payload:=jsonb_set(old.payload,'{values,product_type}','"Mosaic"'::jsonb);
  payload:=jsonb_set(payload,'{values,sku}',to_jsonb('TIPE-NEW-'||n));
  request:=md5('tipe-v2-create-'||n)::uuid;
  created:=public.pilot_catalog_transaction_v2(request,'create',payload);key:=(created->>'id')::uuid;
  PERFORM pg_temp.foundation_assert(created->'after'='{"catalog_version":"1","is_enabled":true}'::jsonb,'v2 create receipt keeps exact version');
  PERFORM pg_temp.foundation_assert(public.pilot_catalog_transaction_v2(request,'create',payload)=created,'v2 create exact replay');
  PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(request,false)=jsonb_build_object('status','committed','receipt',created),'v2 uses existing durable reconciliation');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''create'',%L::jsonb)',request,payload#-'{values,product_type}'),'22023','v1 cannot collide with v2 request binding');
  payload:=jsonb_build_object('kind','product','id',key,'expected_version','1','values',jsonb_build_object('product_type','Wastafel'));
  edited:=public.pilot_catalog_transaction_v2(md5('tipe-v2-edit-'||n)::uuid,'edit',payload);
  PERFORM pg_temp.foundation_assert(edited->'after'->>'catalog_version'='2','type-only edit advances catalogue version exactly once');
  PERFORM pg_temp.foundation_assert((SELECT product_type='Wastafel' AND luar_kota=12.34 AND depo_bangunan=0 AND unit_price IS NULL FROM public.products WHERE id=key),'type edit preserves every price');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v2(%L::uuid,''edit'',%L::jsonb)',md5('tipe-stale-'||n),payload),'40001','stale version refused');
  same:=public.pilot_catalog_transaction_v1(md5('tipe-v1-typed-'||n)::uuid,'edit',jsonb_build_object('kind','product','id',key,'expected_version','2','values',jsonb_build_object('name','Typed legacy client')));
  PERFORM pg_temp.foundation_assert((SELECT product_type='Wastafel' FROM public.products WHERE id=key),'allowed v1 typed edit cannot clear metadata');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v2(%L::uuid,''edit'',%L::jsonb)',md5('tipe-null-'||n),jsonb_build_object('kind','product','id',key,'expected_version','3','values',jsonb_build_object('product_type',NULL))),'22023','v2 NULL refused');
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.foundation_assert((SELECT count(*)=6 FROM private.catalog_product_type_audit_v2),'exactly one audit per create/type transition, no replay/name/status duplicate');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE status='pending'),'no pending command residue');
SELECT pg_temp.foundation_assert(NOT has_table_privilege('authenticated','private.catalog_product_type_audit_v2','SELECT'),'audit not exposed to end-user role');
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 FOR n IN 4..7 LOOP
  PERFORM set_config('request.jwt.claim.sub',md5('tipe-actor-'||n)::uuid::text,true);
  PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v2(md5('tipe-denied')::uuid,'create','{"kind":"product","values":{"name":"Denied","sku":"DENIED","size":null,"harga_pokok":null,"luar_kota":null,"dalam_kota":null,"depo_bangunan":null,"product_type":"Mosaic"}}'::jsonb)$q$,'42501','sales/inactive actor denied');
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Current labels and strict metadata are read under actual RLS for every allowed role.
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; page jsonb; BEGIN
 FOR n IN 1..7 LOOP
  PERFORM set_config('request.jwt.claim.sub',md5('tipe-actor-'||n)::uuid::text,true);
  IF n=5 THEN
   PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_catalog_page_v2('product','all-for-history','all','TIPE-',1,250)$q$,'42501','inactive read denied');
  ELSE
   page:=public.pilot_catalog_page_v2('product','all-for-history','all','TIPE-',1,250);
   PERFORM pg_temp.foundation_assert(page->>'version'='2' AND page->>'actor_id'=auth.uid()::text AND page->>'total_count'='6','v2 read exact actor/version/count');
   PERFORM pg_temp.foundation_assert((SELECT count(*)=3 FROM jsonb_array_elements(page->'rows') r WHERE r->>'product_type'='Wastafel'),'current classified labels');
   PERFORM pg_temp.foundation_assert((SELECT count(*)=3 FROM jsonb_array_elements(page->'rows') r WHERE r ? 'product_type' AND r->'product_type'='null'::jsonb),'legacy NULL is explicit');
  END IF;
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_catalog_page_v2('product','all-for-history','all','',1,250)$q$,'42501','missing identity read denied');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_product_type_audit_v2 WHERE actor_id IS NULL OR actor_id IS DISTINCT FROM (SELECT md5('tipe-actor-'||right(p.sku,1))::uuid FROM public.products p WHERE p.id=product_id) OR (old_type IS NULL AND (new_type<>'Mosaic' OR new_catalog_version<>1 OR old_catalog_version IS NOT NULL)) OR (old_type IS NOT NULL AND (old_type<>'Mosaic' OR new_type<>'Wastafel' OR old_catalog_version IS DISTINCT FROM 1 OR new_catalog_version<>2))),'audit actual actor and exact transition versions');
SELECT private.catalog_assert_checked_graph_v2();
-- Alterations below are subtransactions: each negative probe restores its DDL/grants.
DO $$ BEGIN
 BEGIN
  ALTER TABLE public.products DISABLE TRIGGER catalog_record_product_type_v2;
  PERFORM pg_temp.foundation_raises('SELECT private.catalog_assert_checked_graph_v2()','55000','disabled audit trigger fails closed');
  RAISE EXCEPTION 'restore probe' USING ERRCODE='PT001';
 EXCEPTION WHEN SQLSTATE 'PT001' THEN NULL; END;
 BEGIN
  GRANT EXECUTE ON FUNCTION private.catalog_record_product_type_v2() TO authenticated;
  PERFORM pg_temp.foundation_raises('SELECT private.catalog_assert_checked_graph_v2()','55000','extra helper execute grant fails closed');
  RAISE EXCEPTION 'restore probe' USING ERRCODE='PT001';
 EXCEPTION WHEN SQLSTATE 'PT001' THEN NULL; END;
END $$;
SELECT private.catalog_assert_checked_graph_v2();
DO $$ DECLARE target uuid; BEGIN
 SELECT id INTO STRICT target FROM public.products WHERE sku='TIPE-NEW-1';
 BEGIN
  REVOKE UPDATE(product_type) ON public.products FROM authenticated;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',md5('tipe-actor-1')::uuid::text,true);
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v2(%L::uuid,''edit'',%L::jsonb)',md5('tipe-revoked-column'),jsonb_build_object('kind','product','id',target,'expected_version','3','values',jsonb_build_object('product_type','Mosaic'))),'42501','revoked column UPDATE blocks fresh type command');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v2(%L::uuid,''edit'',%L::jsonb)',md5('tipe-v2-edit-1'),jsonb_build_object('kind','product','id',target,'expected_version','1','values',jsonb_build_object('product_type','Wastafel'))),'42501','revoked type UPDATE blocks committed replay');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_reconcile_catalog_v1(%L::uuid,false)',md5('tipe-v2-edit-1')),'42501','revoked type UPDATE blocks receipt recovery');
  RESET ROLE;
  RAISE EXCEPTION 'restore probe' USING ERRCODE='PT001';
 EXCEPTION WHEN SQLSTATE 'PT001' THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.foundation_assert((SELECT count(*)=6 FROM private.catalog_product_type_audit_v2),'negative probes create no audit');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE request_id=md5('tipe-revoked-column')::uuid),'revoked write leaves no receipt');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v2(md5('tipe-missing-actor')::uuid,'create','{"kind":"product","values":{"name":"Denied","sku":"MISSING-ACTOR","size":null,"harga_pokok":null,"luar_kota":null,"dalam_kota":null,"depo_bangunan":null,"product_type":"Mosaic"}}'::jsonb)$q$,'42501','missing identity write denied');
SELECT set_config('request.jwt.claim.sub',md5('tipe-actor-1')::uuid::text,true);
SELECT pg_temp.foundation_assert(pg_temp.foundation_probe($q$INSERT INTO public.products(name,sku) VALUES('Native NULL','TIPE-RAW-NULL')$q$)->>'state'='23514','raw NULL create denied');
SELECT pg_temp.foundation_assert(pg_temp.foundation_probe($q$UPDATE public.products SET name=name WHERE sku='TIPE-LEGACY-1'$q$)->>'state'='23514','raw no-op legacy edit requires type');
SELECT pg_temp.foundation_assert(pg_temp.foundation_probe($q$UPDATE public.products SET product_type=NULL WHERE sku='TIPE-NEW-1'$q$)->>'state'='23514','raw typed clearing denied');
SELECT pg_temp.foundation_assert(pg_temp.foundation_probe($q$UPDATE public.products SET is_enabled=true WHERE sku='TIPE-LEGACY-1'$q$)->>'state'='42501','raw status mutation remains forbidden; status RPC tested above');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
