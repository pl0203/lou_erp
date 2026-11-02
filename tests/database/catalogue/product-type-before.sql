-- Run after the unchanged catalogue foundation, BEFORE the additive Tipe fragments.
-- Synthetic fixture within the identity-bound rollback-only runner; never hosted.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id) SELECT md5('tipe-actor-'||n)::uuid FROM generate_series(1,7)n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT md5('tipe-actor-'||n)::uuid,'Synthetic Tipe actor','tipe-'||n||'@example.invalid',
 (ARRAY['co_admin','po_admin','executive','sales_person','po_admin','sales_manager','sales_head'])[n]::public.user_role,n<>5 FROM generate_series(1,7)n;
CREATE TEMP TABLE tipe_receipts(actor integer,request_id uuid,payload jsonb,receipt jsonb) ON COMMIT DROP;
GRANT SELECT,INSERT ON pg_temp.tipe_receipts TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; payload jsonb; request uuid; BEGIN
 FOR n IN 1..3 LOOP
  PERFORM set_config('request.jwt.claim.sub',md5('tipe-actor-'||n)::uuid::text,true);
  payload:=jsonb_build_object('kind','product','values',jsonb_build_object('name','Legacy synthetic '||n,'sku','TIPE-LEGACY-'||n,'size',NULL,'harga_pokok',NULL,'luar_kota',12.34,'dalam_kota',NULL,'depo_bangunan',0));
  request:=md5('tipe-legacy-create-'||n)::uuid;
  INSERT INTO pg_temp.tipe_receipts VALUES(n,request,payload,public.pilot_catalog_transaction_v1(request,'create',payload));
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
