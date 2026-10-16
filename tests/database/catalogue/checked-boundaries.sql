-- Fictional owner-controlled rollback fixture only. Actual PostgreSQL execution
-- belongs to approved CI, not local startup or a hosted/private target.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
DO $checked_boundaries$
DECLARE saved_claim text:=current_setting('request.jwt.claim.sub',true); receipt jsonb; replay jsonb;
 first_tombstone timestamptz; recreated_customer_tombstone timestamptz; complete boolean:=false; detail text; before_constraints jsonb; after_constraints jsonb; relation text;
BEGIN
 PERFORM pg_temp.foundation_assert(current_database()='pilot_catalogue_test' AND session_user='postgres' AND current_user='postgres','checked boundary fictional owner required');
 PERFORM pg_temp.foundation_assert((SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton),'checked boundaries start inactive');
 SELECT jsonb_agg(to_jsonb(c) ORDER BY conname) INTO before_constraints FROM pg_catalog.pg_constraint c WHERE conrelid='private.catalog_cutover_v1'::regclass;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  INSERT INTO auth.users(id) VALUES(md5('checked-boundary-exec')::uuid);
  INSERT INTO public.users(id,full_name,email,role,is_active) VALUES(md5('checked-boundary-exec')::uuid,'Fictional boundary executive','checked-boundary@example.invalid','executive',true);
  INSERT INTO public.customers(id,name) VALUES(md5('checked-boundary-target')::uuid,'Fictional target'),(md5('checked-boundary-unused')::uuid,'Unrelated fictional target');
  INSERT INTO public.customers(id,name) VALUES(md5('checked-boundary-recreated-customer')::uuid,'Fictional first customer');
  DELETE FROM public.customers WHERE id=md5('checked-boundary-recreated-customer')::uuid;
  SELECT deleted_at INTO recreated_customer_tombstone FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('checked-boundary-recreated-customer')::uuid;
  INSERT INTO public.customers(id,name) VALUES(md5('checked-boundary-recreated-customer')::uuid,'Fictional recreated customer');
  INSERT INTO public.products(id,name,sku) VALUES(md5('checked-boundary-native')::uuid,'Fictional native delete','CHECKED-BOUNDARY-NATIVE');
  INSERT INTO public.products(id,name,sku) VALUES(md5('checked-boundary-blocked')::uuid,'Fictional referenced product','CHECKED-BOUNDARY-BLOCKED'),(md5('checked-boundary-cascade')::uuid,'Fictional cascade product','CHECKED-BOUNDARY-CASCADE');
  INSERT INTO public.promotions(id,product_id,start_date,end_date,created_by) VALUES
   (md5('checked-boundary-promo-blocked')::uuid,md5('checked-boundary-blocked')::uuid,current_date,current_date,md5('checked-boundary-exec')::uuid),
   (md5('checked-boundary-promo-cascade')::uuid,md5('checked-boundary-cascade')::uuid,current_date,current_date,md5('checked-boundary-exec')::uuid);
  PERFORM set_config('request.jwt.claim.sub',md5('checked-boundary-exec')::uuid::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(public.pilot_customer_target_write_access_v1()=jsonb_build_object('version',1,'actor_id',md5('checked-boundary-exec')::uuid,'mode','legacy'),'target capability preserves legacy mode');
  INSERT INTO public.customer_targets(customer_id,year_month,target_value,set_by) VALUES(md5('checked-boundary-target')::uuid,'2097-01',2,auth.uid());
  PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_customer_target_upsert_v1(md5('checked-target-before')::uuid,md5('checked-boundary-target')::uuid,'2097-01',3)$q$,'55000','checked target cannot activate generation one');
  RESET ROLE;
  ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_generation_one;
  ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_not_ready;
  UPDATE private.catalog_cutover_v1 SET execution_generation=2,tracking_ready=true WHERE singleton;
  PERFORM private.catalog_assert_checked_graph_v2();
  PERFORM pg_temp.foundation_assert(true,'CATALOG_CHECKED_EXACT_TRIGGER_GRAPH_PASSED');
  PERFORM private.catalog_assert_history_contract_v1();
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(public.pilot_customer_target_write_access_v1()->>'mode'='checked','target capability returns checked only after ready generation two');
  replay:=public.pilot_customer_target_upsert_v1(md5('checked-target-recreated-customer')::uuid,md5('checked-boundary-recreated-customer')::uuid,'2097-01',4);
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT last_version=2 AND lifetime_state='used' AND deleted_at=recreated_customer_tombstone
   FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('checked-boundary-recreated-customer')::uuid),'checked target uses present recreated customer without erasing retained tombstone');
  SET LOCAL ROLE authenticated;
  receipt:=public.pilot_customer_target_upsert_v1(md5('checked-target-request')::uuid,md5('checked-boundary-target')::uuid,'2097-01',0);
  replay:=public.pilot_customer_target_upsert_v1(md5('checked-target-request')::uuid,md5('checked-boundary-target')::uuid,'2097-01',0);
  PERFORM pg_temp.foundation_assert(receipt=replay AND receipt->>'target_value'='0.00','target exact replay preserves immutable decimal receipt');
  PERFORM pg_temp.foundation_assert(public.pilot_reconcile_customer_target_v1(md5('checked-target-request')::uuid)=jsonb_build_object('status','committed','receipt',receipt),'target reconciliation proves receipt not target presence');
  replay:=public.pilot_customer_target_upsert_v1(md5('checked-target-null')::uuid,md5('checked-boundary-target')::uuid,'2097-02',NULL);
  PERFORM pg_temp.foundation_assert(replay->'target_value'='null'::jsonb,'checked target nullable value retained');
  PERFORM pg_temp.foundation_assert(public.pilot_reconcile_customer_target_v1(md5('checked-target-unknown')::uuid)=jsonb_build_object('status','unknown'),'unknown is not successful target mutation');
  PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_customer_target_upsert_v1(md5('checked-target-missing')::uuid,md5('checked-target-no-customer')::uuid,'2097-01',0)$q$,'42501','zero-row target cannot return receipt');
  PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_customer_target_upsert_v1(md5('checked-target-invalid')::uuid,md5('checked-boundary-target')::uuid,'2097-13',0)$q$,'22023','invalid checked month refused');
  PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_customer_target_upsert_v1(md5('checked-target-nan')::uuid,md5('checked-boundary-target')::uuid,'2097-01','NaN'::numeric)$q$,'22023','nonfinite target refused');
  PERFORM pg_temp.foundation_raises($q$DELETE FROM public.products WHERE id=md5('checked-boundary-blocked')::uuid$q$,'23503','native baseline product NO ACTION still refuses linked promotion');
  PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_customer_target_upsert_v1(md5('checked-target-request')::uuid,md5('checked-boundary-target')::uuid,'2097-01',1)$q$,'22023','target request mismatch fails');
  PERFORM pg_temp.foundation_raises($q$INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(md5('checked-boundary-unused')::uuid,'2097-02',auth.uid())$q$,'42501','raw authenticated target cannot escape generation two');
  PERFORM pg_temp.foundation_raises($q$UPDATE public.customer_targets SET target_value=9 WHERE customer_id=md5('checked-boundary-target')::uuid$q$,'42501','raw target update rejected');
  PERFORM pg_temp.foundation_raises($q$DELETE FROM public.customer_targets WHERE customer_id=md5('checked-boundary-target')::uuid$q$,'42501','raw target delete rejected');
  PERFORM pg_temp.foundation_raises($q$INSERT INTO private.catalog_target_active_v1 VALUES(pg_backend_pid(),txid_current(),gen_random_uuid(),auth.uid(),gen_random_uuid(),gen_random_uuid(),'2097-01',gen_random_uuid(),0)$q$,'42501','target scope cannot be spoofed');
  DELETE FROM public.products WHERE id=md5('checked-boundary-native')::uuid;
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT lifetime_state='unknown' AND deleted_at IS NOT NULL FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('checked-boundary-native')::uuid),'native unused delete retains unknown lifetime and writes tombstone');
  SELECT deleted_at INTO first_tombstone FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('checked-boundary-native')::uuid;
  INSERT INTO public.products(id,name,sku) VALUES(md5('checked-boundary-native')::uuid,'Fictional recreated native identity','CHECKED-BOUNDARY-NATIVE');
  SET LOCAL ROLE authenticated;
  DELETE FROM public.products WHERE id=md5('checked-boundary-native')::uuid;
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT last_version=2 AND deleted_at=first_tombstone FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('checked-boundary-native')::uuid),'native second deletion after raw UUID recreation preserves original tombstone');
  PERFORM pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('checked-boundary-unused')::uuid),'refused target write does not falsely mark unrelated customer');
  SET LOCAL ROLE service_role;
  BEGIN
   INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(md5('checked-boundary-unused')::uuid,'2097-02',md5('checked-boundary-exec')::uuid);
   RAISE EXCEPTION 'Raw service target unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
   GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
  END;
  RESET ROLE;
  PERFORM pg_temp.foundation_assert(detail='CATALOG_GENERATION_RETIRED','actual raw service target cannot escape generation two');
  FOREACH relation IN ARRAY ARRAY['public.customer_targets','public.purchase_orders','public.promotions','public.visit_requests','public.customer_manager_assignments'] LOOP
   PERFORM pg_temp.foundation_raises(format('TRUNCATE %s CASCADE',relation),'42501','generation two business truncate fails before clearing');
  END LOOP;
  PERFORM pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_target_requests_v1 WHERE status='pending'),'target never leaves pending request');
  PERFORM pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_target_active_v1) AND NOT EXISTS(SELECT 1 FROM private.catalog_product_delete_scope_v2) AND NOT EXISTS(SELECT 1 FROM private.catalog_product_delete_rows_v2),'exact scopes are empty after completed commands');
  -- Fictional promotion-only CASCADE is named synthetic, never a recovered FK.
  ALTER TABLE public.promotions DROP CONSTRAINT promotions_product_id_fkey;
  ALTER TABLE public.promotions ADD CONSTRAINT catalogue_fictional_promotion_product_cascade_v2 FOREIGN KEY(product_id) REFERENCES public.products(id) ON DELETE CASCADE;
  SET LOCAL ROLE authenticated;
  DELETE FROM public.products WHERE id=md5('checked-boundary-cascade')::uuid;
  RESET ROLE;
  PERFORM pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM public.promotions WHERE id=md5('checked-boundary-promo-cascade')::uuid)
   AND (SELECT lifetime_state='used' AND deleted_at IS NOT NULL FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('checked-boundary-cascade')::uuid),'actual promotion cascade marks only its deleted product before tombstone');
  PERFORM pg_temp.foundation_assert((SELECT lifetime_state='unknown' AND deleted_at IS NULL FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('checked-boundary-blocked')::uuid),'failed baseline delete and unrelated cascade do not falsely mark other product');
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  ALTER TABLE public.promotions DROP CONSTRAINT catalogue_fictional_promotion_product_cascade_v2;
  ALTER TABLE public.promotions ADD CONSTRAINT catalogue_fictional_promotion_product_cascade_v2 FOREIGN KEY(product_id) REFERENCES public.products(id) ON DELETE SET NULL;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_raises($q$DELETE FROM public.products WHERE id=md5('checked-boundary-blocked')::uuid$q$,'55000','wider SET NULL native topology refused before mutation');
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT deleted_at IS NULL FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('checked-boundary-blocked')::uuid),'unsupported topology leaves no partial tombstone');
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'checked-boundary-fixture-rollback' USING ERRCODE='PZB01';
 EXCEPTION WHEN SQLSTATE 'PZB01' THEN
  GET STACKED DIAGNOSTICS detail=MESSAGE_TEXT;
  IF detail<>'checked-boundary-fixture-rollback' THEN RAISE; END IF;
  complete:=true;
 END;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',saved_claim,true);
 PERFORM pg_temp.foundation_assert(complete,'checked boundaries reached exact rollback sentinel');
 SELECT jsonb_agg(to_jsonb(c) ORDER BY conname) INTO after_constraints FROM pg_catalog.pg_constraint c WHERE conrelid='private.catalog_cutover_v1'::regclass;
 PERFORM pg_temp.foundation_assert(before_constraints=after_constraints AND (SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1),'checked boundaries restore exact inactive cutover constraints');
 PERFORM pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM public.users WHERE id=md5('checked-boundary-exec')::uuid) AND NOT EXISTS(SELECT 1 FROM private.catalog_target_requests_v1 WHERE request_id=md5('checked-target-request')::uuid),'checked boundary actors and ledger rows rollback');
END $checked_boundaries$;
SET CONSTRAINTS ALL DEFERRED;
