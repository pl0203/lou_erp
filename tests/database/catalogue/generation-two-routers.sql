-- PUBLIC_ROUTER_DISPATCH_ONLY. Test-only fictional dispatch proof, never deploy.
-- NOT_GLOBAL_LIFETIME_CERTIFICATION / NO_RAW_COMPATIBILITY_PROOF /
-- NO_LOADED_LEGACY_RETIREMENT_PROOF / NO_CONCURRENCY_PROOF.
-- The existing identity-bound foundation runner owns the outer rollback-only
-- transaction. No public/private production definition or privilege is changed.
-- Only the two fictional cutover constraints/state are changed, inside an
-- exception subtransaction that MUST roll back every row and constraint change.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
DO $public_router_dispatch_only$
DECLARE
 saved_pid integer:=pg_backend_pid(); saved_xid bigint:=txid_current();
 saved_claim text:=current_setting('request.jwt.claim.sub',true);
 constraints_before jsonb; constraints_after jsonb; snapshot_before jsonb:='{}'; snapshot_after jsonb:='{}'; rows jsonb; relation text;
 touched text[]:=ARRAY['auth.users','public.users','storage.objects','public.customers','public.products','public.promotions',
  'public.customer_manager_assignments','public.purchase_orders','public.po_line_items','public.po_audit_log',
  'public.sales_schedules','public.outlet_visits','public.visit_photos',
  'private.catalog_identity_v1','private.catalog_cutover_v1','private.catalog_po_active_v2','private.catalog_co_active_v2','private.catalog_writer_active_v2',
  'private.pilot_order_requests','private.pilot_promotion_requests','private.pilot_promo_movements','private.pilot_promo_slices',
  'private.pilot_store_owner_audit_v1','private.pilot_schedule_requests','private.pilot_visit_requests','private.pilot_visit_workflow_audit',
  'private.co_customer_state','private.co_stock_keys','private.co_orders','private.co_order_lines','private.co_drafts','private.co_report_draft_lines',
  'private.co_commands','private.co_audit_events','private.co_evidence','private.co_evidence_verifications'];
 actor uuid; completed boolean:=false; message text; detail text;
 p_legacy_po jsonb; p_legacy_co jsonb; r_legacy_po jsonb; r_legacy_co jsonb;
 p_po jsonb; p_co jsonb; p_promotion jsonb; p_schedule jsonb; p_visit jsonb; p_register jsonb; p_finalize jsonb;
 r_po jsonb; r_co jsonb; r_promotion jsonb; r_owner jsonb; r_schedule jsonb; r_visit jsonb; r_report jsonb; r_register jsonb; r_finalize jsonb; r_attest jsonb;
BEGIN
 PERFORM pg_temp.foundation_assert(current_database()='pilot_catalogue_test' AND session_user='postgres' AND current_user='postgres',
  'fictional owned child and owner required for router test');
 PERFORM pg_temp.foundation_assert((SELECT count(*)=1 AND bool_and(backend_pid=saved_pid AND transaction_id=saved_xid)
  FROM pg_temp.catalogue_foundation_session_v1),'exact existing foundation session required');
 PERFORM pg_temp.foundation_assert((SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton),
  'router test starts with inactive production-equivalent fixture');
 SELECT jsonb_agg(to_jsonb(c) ORDER BY c.conname) INTO constraints_before FROM pg_constraint c WHERE c.conrelid='private.catalog_cutover_v1'::regclass;
 PERFORM pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid='private.catalog_cutover_v1'::regclass
  AND conname IN('catalog_foundation_generation_one','catalog_foundation_not_ready')),'both original validated fixture constraints required');
 FOREACH relation IN ARRAY touched LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM %s t',relation::regclass) INTO rows;
  snapshot_before:=snapshot_before||jsonb_build_object(relation,rows);
 END LOOP;
 BEGIN
  -- Owned fictional subtransaction. Any unexpected exception escapes and fails
  -- the outer test. Only the exact final sentinel is caught below.
  PERFORM set_config('request.jwt.claim.sub','',true);
  INSERT INTO auth.users(id) SELECT md5('router-actor-'||n)::uuid FROM generate_series(1,4)n;
  INSERT INTO public.users(id,full_name,email,role,is_active)
  SELECT md5('router-actor-'||n)::uuid,'Fictional router actor '||n,'router-'||n||'@example.invalid',
   (ARRAY['executive','po_admin','co_admin','sales_person'])[n]::public.user_role,true FROM generate_series(1,4)n;
  INSERT INTO public.customers(id,name) SELECT md5('router-customer-'||n)::uuid,'Fictional router customer '||n FROM generate_series(1,6)n;
  INSERT INTO public.products(id,name,sku) SELECT md5('router-product-'||n)::uuid,'Fictional router product '||n,'ROUTER-'||n FROM generate_series(1,6)n;
  -- Prior committed legacy receipts remain replayable after dispatch changes.
  p_legacy_po:=jsonb_build_object('customer_id',md5('router-customer-6')::uuid,'po_number','FICTIONAL-ROUTER-LEGACY',
   'items',jsonb_build_array(jsonb_build_object('product_id',md5('router-product-6')::uuid,'product_name','Legacy label','sku','ROUTER-6','quantity',1,'unit_price',0)));
  actor:=md5('router-actor-2')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(current_user='authenticated' AND auth.uid()=actor AND row_security_active('public.products')
   AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) AND pg_backend_pid()=saved_pid AND txid_current()=saved_xid,'actual PO role and same transaction');
  r_legacy_po:=public.pilot_order_transaction(md5('router-legacy-po')::uuid,'create_po',p_legacy_po);
  RESET ROLE;
  p_legacy_co:=jsonb_build_object('customer_id',md5('router-customer-6')::uuid,'expected_customer_version','1','co_number','FICTIONAL-ROUTER-LEGACY',
   'order_date',(clock_timestamp() AT TIME ZONE 'UTC')::date,'lines',jsonb_build_array(jsonb_build_object('id',md5('router-legacy-co-line')::uuid,
   'product_id',md5('router-product-6')::uuid,'sku','ROUTER-6','product_name','Legacy label','ordered_quantity',1,'unit_price','0')));
  actor:=md5('router-actor-3')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(current_user='authenticated' AND auth.uid()=actor AND row_security_active('public.customers')
   AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) AND pg_backend_pid()=saved_pid AND txid_current()=saved_xid,'actual CO role and same transaction');
  r_legacy_co:=public.pilot_co_transaction_v1(md5('router-legacy-co')::uuid,'create_co',p_legacy_co);
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT execution_version=1 FROM private.pilot_order_requests WHERE request_id=md5('router-legacy-po')::uuid)
   AND (SELECT execution_version=1 FROM private.co_commands WHERE request_id=md5('router-legacy-co')::uuid),'actual legacy public calls retain version one');
  ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_generation_one;
  ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_not_ready;
  UPDATE private.catalog_cutover_v1 SET execution_generation=2 WHERE singleton;
  -- Fresh PO/CO routes must not equate generation selection with readiness.
  p_po:=jsonb_build_object('customer_id',md5('router-customer-1')::uuid,'po_number','FICTIONAL-ROUTER-PO',
   'items',jsonb_build_array(jsonb_build_object('product_id',md5('router-product-1')::uuid,'product_name','Agreed zero-price label','sku','ROUTER-1','quantity',2,'unit_price',0)));
  actor:=md5('router-actor-2')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  BEGIN
   PERFORM public.pilot_order_transaction(md5('router-po')::uuid,'create_po',p_po);
   RAISE EXCEPTION 'Fresh PO escaped false tracking gate';
  EXCEPTION WHEN SQLSTATE '55000' THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
   PERFORM pg_temp.foundation_assert(detail='CATALOG_GENERATION_RETIRED','fresh public dispatch denied while fixture tracking is false'); END;
  PERFORM pg_temp.foundation_assert(public.pilot_order_transaction(md5('router-legacy-po')::uuid,'create_po',p_legacy_po)=r_legacy_po,'legacy public PO replay precedes new gate');
  RESET ROLE;
  p_co:=jsonb_build_object('customer_id',md5('router-customer-2')::uuid,'expected_customer_version','1','co_number','FICTIONAL-ROUTER-CO',
   'order_date',(clock_timestamp() AT TIME ZONE 'UTC')::date,'lines',jsonb_build_array(jsonb_build_object('id',md5('router-co-line')::uuid,
   'product_id',md5('router-product-2')::uuid,'sku','ROUTER-2','product_name','Agreed CO label','ordered_quantity',2,'unit_price','0')));
  actor:=md5('router-actor-3')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  BEGIN
   PERFORM public.pilot_co_transaction_v1(md5('router-co')::uuid,'create_co',p_co);
   RAISE EXCEPTION 'Fresh CO escaped false tracking gate';
  EXCEPTION WHEN SQLSTATE '55000' THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
   PERFORM pg_temp.foundation_assert(detail='CATALOG_GENERATION_RETIRED','fresh public CO dispatch denied while fixture tracking is false'); END;
  PERFORM pg_temp.foundation_assert(public.pilot_co_transaction_v1(md5('router-legacy-co')::uuid,'create_co',p_legacy_co)=r_legacy_co,'legacy public CO replay precedes new gate');
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='unknown') FROM private.catalog_identity_v1
   WHERE (kind='customer' AND id=md5('router-customer-6')::uuid) OR (kind='product' AND id=md5('router-product-6')::uuid)),'legacy replay does not mark unknown identities');
  UPDATE private.catalog_cutover_v1 SET tracking_ready=true WHERE singleton;
  -- This temporary true value only selects the existing production admission
  -- route. It is NOT a certification of the fictional or hosted raw writer graph.
  actor:=md5('router-actor-2')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(current_user='authenticated' AND auth.uid()=actor AND pg_backend_pid()=saved_pid AND txid_current()=saved_xid,'fresh PO dispatch retains actual application role');
  r_po:=public.pilot_order_transaction(md5('router-po')::uuid,'create_po',p_po);
  RESET ROLE;
  actor:=md5('router-actor-3')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  r_co:=public.pilot_co_transaction_v1(md5('router-co')::uuid,'create_co',p_co);
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_order_transaction(%L::uuid,%L,%L::jsonb)',md5('router-denied-co-po')::uuid,'create_po',p_po),'42501','CO cannot cross PO router authority');
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT execution_version=2 FROM private.pilot_order_requests WHERE request_id=md5('router-po')::uuid)
   AND (SELECT execution_version=2 FROM private.co_commands WHERE request_id=md5('router-co')::uuid),'fresh public PO and CO dispatch reaches explicit version two ledgers');
  PERFORM pg_temp.foundation_assert((SELECT unit_price=0 AND product_name='Agreed zero-price label' FROM public.po_line_items WHERE purchase_order_id=(r_po->>'id')::uuid),'public PO route preserves agreed price and label');
  -- Executive-only promotion and ledgerless owner routes.
  INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('promotion-images',
   'promotions/'||md5('router-actor-1')::uuid||'/'||md5('router-promotion')::uuid||'/'||md5('router-image')::uuid||'.png',md5('router-actor-1')::uuid::text,'{"size":1,"mimetype":"image/png"}');
  p_promotion:=jsonb_build_object('id',md5('router-promotion')::uuid,'product_id',md5('router-product-3')::uuid,'opening_quantity',5,
   'image_path','promotions/'||md5('router-actor-1')::uuid||'/'||md5('router-promotion')::uuid||'/'||md5('router-image')::uuid||'.png',
   'harga_pokok',NULL,'luar_kota',0,'dalam_kota',NULL,'depo_bangunan',NULL,'is_active',true);
  actor:=md5('router-actor-1')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(current_user='authenticated' AND auth.uid()=actor AND row_security_active('public.products')
   AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) AND pg_backend_pid()=saved_pid AND txid_current()=saved_xid,'actual executive role and same transaction');
  r_promotion:=public.pilot_promotion_transaction_v1(md5('router-promotion-create')::uuid,'create_promotion',p_promotion);
  r_owner:=public.pilot_assign_store_owner_v1(md5('router-customer-3')::uuid,md5('router-actor-4')::uuid,NULL,NULL);
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT lifetime_state='used' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('router-customer-3')::uuid),
   'owner route marks before any schedule can mask legacy dispatch');
  SET LOCAL ROLE authenticated;
  p_schedule:=jsonb_build_object('customer_id',md5('router-customer-3')::uuid,'sales_person_id',md5('router-actor-4')::uuid,'scheduled_date','2097-10-15','notes','Fictional public router');
  r_schedule:=public.pilot_schedule_transaction_v1(md5('router-schedule')::uuid,'create_schedule',p_schedule);
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT execution_version=2 FROM private.pilot_promotion_requests WHERE request_id=md5('router-promotion-create')::uuid)
   AND (SELECT execution_version=2 FROM private.pilot_schedule_requests WHERE request_id=md5('router-schedule')::uuid),'fresh public promotion and schedule reach version two');
  PERFORM pg_temp.foundation_assert((SELECT count(*)=1 FROM private.pilot_store_owner_audit_v1 WHERE customer_id=md5('router-customer-3')::uuid),'public owner route writes actual audit');
  -- Actual salesperson finalization invokes the original photo completion graph.
  INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('visits','visits/'||(r_schedule->>'id')||'/fictional.png',md5('router-actor-4')::uuid::text);
  p_visit:=jsonb_build_object('schedule_id',(r_schedule->>'id')::uuid,'expected_schedule_version',1,'customer_id',md5('router-customer-3')::uuid,
   'scheduled_date','2097-10-15','storage_path','visits/'||(r_schedule->>'id')||'/fictional.png','notes','Fictional visit');
  actor:=md5('router-actor-4')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(current_user='authenticated' AND auth.uid()=actor AND row_security_active('public.customers')
   AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) AND pg_backend_pid()=saved_pid AND txid_current()=saved_xid,'actual salesperson role and same transaction');
  r_visit:=public.pilot_finalize_visit(md5('router-visit')::uuid,'finalize_visit',p_visit);
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT execution_version=2 FROM private.pilot_visit_requests WHERE request_id=md5('router-visit')::uuid)
   AND (SELECT status='completed' FROM public.sales_schedules WHERE id=(r_schedule->>'id')::uuid)
   AND (SELECT last_visit_date IS NOT NULL FROM public.customers WHERE id=md5('router-customer-3')::uuid),'public visit route executes original photo completion');
  -- Public gen2 monthly dispatcher, separate evidence family and service API.
  actor:=md5('router-actor-3')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  r_report:=public.pilot_co_transaction_v1(md5('router-report')::uuid,'save_report_draft',jsonb_build_object('action','initialize',
   'customer_id',md5('router-customer-4')::uuid,'expected_customer_version','1','report_month',date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date));
  RESET ROLE;
  SELECT jsonb_build_object('draft_id',d.id,'expected_draft_version',d.version::text,'expected_customer_version',s.version::text,
   'filename','fictional.pdf','mime_type','application/pdf','byte_size',1,'sha256',repeat('a',64)) INTO p_register
  FROM private.co_drafts d JOIN private.co_customer_state s ON s.customer_id=d.customer_id WHERE d.id=(r_report->>'id')::uuid;
  SET LOCAL ROLE authenticated;
  r_register:=public.pilot_co_evidence_transaction_v1(md5('router-register')::uuid,'register_evidence',p_register);
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_co_transaction_v1(%L::uuid,%L,%L::jsonb)',md5('router-register')::uuid,'register_evidence',p_register),'22023','evidence receipt stays outside order replay family');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_co_evidence_attest_v1(%L::uuid,NULL,NULL,NULL,1,%L,%L)',actor,'application/pdf',repeat('a',64)),'42501','authenticated cannot call service attestation');
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT execution_version=2 FROM private.co_commands WHERE request_id=md5('router-report')::uuid)
   AND (SELECT execution_version=2 FROM private.co_commands WHERE request_id=md5('router-register')::uuid),'public monthly and evidence dispatch use explicit generation two');
  INSERT INTO storage.objects(id,bucket_id,name,owner_id,metadata,version) VALUES(md5('router-object')::uuid,'co-evidence',(r_register->>'id')||'.pdf',
   md5('router-actor-3')::uuid::text,'{"size":1,"mimetype":"application/pdf"}','fictional-router-version');
  PERFORM set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
  -- Service does not receive the authenticated-only temporary assertion helper.
  IF current_user<>'service_role' OR auth.uid() IS NOT NULL OR pg_backend_pid()<>saved_pid OR txid_current()<>saved_xid THEN RAISE EXCEPTION 'Actual clean service role and same transaction required'; END IF;
  r_attest:=public.pilot_co_evidence_attest_v1(md5('router-actor-3')::uuid,(r_register->>'id')::uuid,md5('router-object')::uuid,'fictional-router-version',1,'application/pdf',repeat('a',64));
  IF r_attest IS DISTINCT FROM jsonb_build_object('id',(r_register->>'id')::uuid,'state','verified') THEN RAISE EXCEPTION 'Actual public service attestation failed'; END IF;
  RESET ROLE;
  SELECT jsonb_build_object('evidence_id',e.id,'expected_evidence_version',e.version::text,'expected_draft_version',d.version::text,'expected_customer_version',s.version::text)
   INTO p_finalize FROM private.co_evidence e JOIN private.co_drafts d ON d.id=e.draft_id JOIN private.co_customer_state s ON s.customer_id=e.customer_id WHERE e.id=(r_register->>'id')::uuid;
  actor:=md5('router-actor-3')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  r_finalize:=public.pilot_co_evidence_transaction_v1(md5('router-finalize')::uuid,'finalize_evidence',p_finalize);
  RESET ROLE;
  PERFORM pg_temp.foundation_assert((SELECT execution_version=2 FROM private.co_commands WHERE request_id=md5('router-finalize')::uuid)
   AND (SELECT e.version=2 AND d.evidence_id=e.id FROM private.co_evidence e JOIN private.co_drafts d ON d.id=e.draft_id WHERE e.id=(r_register->>'id')::uuid),'public evidence finalize uses real verified object and report draft');
  PERFORM pg_temp.foundation_assert((SELECT count(*)=7 AND bool_and(lifetime_state='used') FROM private.catalog_identity_v1
   WHERE (kind='customer' AND id IN(md5('router-customer-1')::uuid,md5('router-customer-2')::uuid,md5('router-customer-3')::uuid,md5('router-customer-4')::uuid))
   OR (kind='product' AND id IN(md5('router-product-1')::uuid,md5('router-product-2')::uuid,md5('router-product-3')::uuid))),'public routes mark only actual named-path reference identities');
  PERFORM pg_temp.foundation_assert((SELECT count(*)=5 AND bool_and(lifetime_state='unknown') FROM private.catalog_identity_v1
   WHERE id IN(md5('router-customer-5')::uuid,md5('router-customer-6')::uuid,md5('router-product-4')::uuid,md5('router-product-5')::uuid,md5('router-product-6')::uuid)),'unrelated and replay-only identities remain unknown');
  -- Exact authorized replay/no-op remains available with new admission disabled.
  UPDATE private.catalog_cutover_v1 SET tracking_ready=false WHERE singleton;
  actor:=md5('router-actor-2')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(public.pilot_order_transaction(md5('router-po')::uuid,'create_po',p_po)=r_po,'public v2 PO replay precedes false admission gate');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_promotion_transaction_v1(%L::uuid,%L,%L::jsonb)',md5('router-promotion-create')::uuid,'create_promotion',p_promotion),'42501','PO role cannot use promotion router');
  RESET ROLE;
  actor:=md5('router-actor-3')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(public.pilot_co_transaction_v1(md5('router-co')::uuid,'create_co',p_co)=r_co,'public v2 CO replay precedes false admission gate');
  PERFORM pg_temp.foundation_assert(public.pilot_co_evidence_transaction_v1(md5('router-register')::uuid,'register_evidence',p_register)=r_register
   AND public.pilot_co_evidence_transaction_v1(md5('router-finalize')::uuid,'finalize_evidence',p_finalize)=r_finalize,'public evidence replay precedes false admission gate and changed draft');
  RESET ROLE;
  actor:=md5('router-actor-1')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(public.pilot_promotion_transaction_v1(md5('router-promotion-create')::uuid,'create_promotion',p_promotion)=r_promotion,'public promotion replay precedes false admission gate');
  PERFORM pg_temp.foundation_assert(public.pilot_schedule_transaction_v1(md5('router-schedule')::uuid,'create_schedule',p_schedule)=r_schedule,'public schedule replay precedes false admission gate');
  PERFORM pg_temp.foundation_assert(public.pilot_assign_store_owner_v1(md5('router-customer-3')::uuid,md5('router-actor-4')::uuid,(r_owner->>'id')::uuid,(r_owner->>'version')::bigint)=r_owner,'public ledgerless owner exact no-op precedes false admission gate');
  BEGIN
   PERFORM public.pilot_assign_store_owner_v1(md5('router-customer-3')::uuid,NULL,(r_owner->>'id')::uuid,(r_owner->>'version')::bigint);
   RAISE EXCEPTION 'Fresh owner mutation escaped false tracking gate';
  EXCEPTION WHEN SQLSTATE '55000' THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
   PERFORM pg_temp.foundation_assert(detail='CATALOG_GENERATION_RETIRED','fresh ledgerless owner dispatch denied while fixture tracking is false'); END;
  RESET ROLE;
  actor:=md5('router-actor-4')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(public.pilot_finalize_visit(md5('router-visit')::uuid,'finalize_visit',p_visit)=r_visit,'public visit replay retains exact schedule authority before gate');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub','',true); SET LOCAL ROLE service_role;
  IF NOT (current_user='service_role' AND auth.uid() IS NULL AND pg_backend_pid()=saved_pid AND txid_current()=saved_xid) THEN RAISE EXCEPTION 'Service replay role changed'; END IF;
  r_attest:=public.pilot_co_evidence_attest_v1(md5('router-actor-3')::uuid,(r_register->>'id')::uuid,md5('router-object')::uuid,'fictional-router-version',1,'application/pdf',repeat('a',64));
  IF r_attest IS DISTINCT FROM jsonb_build_object('id',(r_register->>'id')::uuid,'state','finalized') THEN RAISE EXCEPTION 'Public finalized attestation replay changed'; END IF;
  RESET ROLE;
  -- Revoke the receipt owner's own authority, not merely another actor's.
  PERFORM set_config('request.jwt.claim.sub','',true);
  UPDATE public.users SET role='po_admin' WHERE id=md5('router-actor-1')::uuid;
  actor:=md5('router-actor-1')::uuid; PERFORM set_config('request.jwt.claim.sub',actor::text,true); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.foundation_assert(auth.uid()=actor AND current_user='authenticated','revoked original actor remains the actual caller');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_promotion_transaction_v1(%L::uuid,%L,%L::jsonb)',md5('router-promotion-create')::uuid,'create_promotion',p_promotion),'42501','the original promotion receipt owner loses authority before replay');
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub','',true);
  UPDATE public.users SET role='executive' WHERE id=md5('router-actor-1')::uuid;
  PERFORM pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_po_active_v2) AND NOT EXISTS(SELECT 1 FROM private.catalog_co_active_v2)
   AND NOT EXISTS(SELECT 1 FROM private.catalog_writer_active_v2),'all private writer scopes empty');
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  completed:=true;
  RAISE EXCEPTION 'PUBLIC_ROUTER_DISPATCH_ONLY_ROLLBACK' USING ERRCODE='PGR02';
 EXCEPTION WHEN SQLSTATE 'PGR02' THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message IS DISTINCT FROM 'PUBLIC_ROUTER_DISPATCH_ONLY_ROLLBACK' OR NOT completed THEN RAISE; END IF;
 END;
 PERFORM pg_temp.foundation_assert(current_user='postgres' AND session_user='postgres' AND pg_backend_pid()=saved_pid AND txid_current()=saved_xid
  AND current_setting('request.jwt.claim.sub',true) IS NOT DISTINCT FROM saved_claim,'original role claim and transaction restored');
 SELECT jsonb_agg(to_jsonb(c) ORDER BY c.conname) INTO constraints_after FROM pg_constraint c WHERE c.conrelid='private.catalog_cutover_v1'::regclass;
 PERFORM pg_temp.foundation_assert(constraints_after=constraints_before,'exact original constraint rows and definitions restored');
 PERFORM pg_temp.foundation_assert((SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton),'fixture generation one and false restored');
 FOREACH relation IN ARRAY touched LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM %s t',relation::regclass) INTO rows;
  snapshot_after:=snapshot_after||jsonb_build_object(relation,rows);
 END LOOP;
 PERFORM pg_temp.foundation_assert(snapshot_after=snapshot_before,'all touched fictional rows restored');
 PERFORM pg_temp.foundation_assert(completed,'PUBLIC_ROUTER_DISPATCH_ONLY completed inside reverted fixture');
END $public_router_dispatch_only$;
