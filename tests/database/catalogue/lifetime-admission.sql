-- Fictional actual-role integrated flows. Run only inside the existing reviewed
-- single-transaction synthetic harness after 01,04,new06 and new07. Never deploy.
CREATE FUNCTION pg_temp.catalog_writer_test_call(family text,request uuid,operation text,payload jsonb,admit boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 CASE family
 WHEN 'promotion' THEN RETURN private.catalog_promotion_core_v2(request,operation,payload,admit);
 WHEN 'schedule' THEN RETURN private.catalog_schedule_core_v2(request,operation,payload,admit);
 WHEN 'visit' THEN RETURN private.catalog_visit_core_v2(request,operation,payload,admit);
 WHEN 'evidence' THEN RETURN private.catalog_evidence_core_v2(request,operation,payload,admit);
 ELSE RAISE EXCEPTION 'Unknown test family'; END CASE;
END $$;
CREATE FUNCTION pg_temp.catalog_owner_test_call(customer uuid,owner uuid,assignment uuid,version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.catalog_owner_core_v2(customer,owner,assignment,version,false); END $$;
CREATE FUNCTION pg_temp.catalog_attest_test_call(actor uuid,evidence uuid,object uuid,version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN private.catalog_attest_core_v2(actor,evidence,object,version,1,'application/pdf',repeat('a',64),false); END $$;
REVOKE ALL ON FUNCTION pg_temp.catalog_writer_test_call(text,uuid,text,jsonb,boolean),pg_temp.catalog_owner_test_call(uuid,uuid,uuid,bigint),pg_temp.catalog_attest_test_call(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.catalog_writer_test_call(text,uuid,text,jsonb,boolean),pg_temp.catalog_owner_test_call(uuid,uuid,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.catalog_attest_test_call(uuid,uuid,uuid,text) TO service_role;
CREATE TEMP TABLE catalogue_writer_results(label text PRIMARY KEY,request uuid,operation text,payload jsonb,result jsonb) ON COMMIT DROP;
GRANT SELECT,INSERT,UPDATE ON pg_temp.catalogue_writer_results TO authenticated;
INSERT INTO auth.users(id) SELECT md5('lifetime-actor-'||n)::uuid FROM generate_series(1,4)n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT md5('lifetime-actor-'||n)::uuid,'Fictional lifetime actor '||n,'lifetime-'||n||'@example.invalid',
(CASE n WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_person' WHEN 3 THEN 'co_admin' ELSE 'po_admin' END)::public.user_role,true FROM generate_series(1,4)n;
INSERT INTO public.customers(id,name) SELECT md5('lifetime-customer-'||n)::uuid,'Fictional lifetime customer '||n FROM generate_series(1,8)n;
INSERT INTO public.products(id,name,sku) SELECT md5('lifetime-product-'||n)::uuid,'Fictional lifetime product '||n,'LIFETIME-'||n FROM generate_series(1,4)n;
SELECT set_config('request.jwt.claim.sub',md5('lifetime-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT private.catalog_promotion_core_v2(md5('denied-writer')::uuid,'set_active','{}',false)$q$,'42501','remaining private cores are not a public generation bypass');
SELECT pg_temp.foundation_raises($q$INSERT INTO private.catalog_writer_active_v2 VALUES(pg_backend_pid(),txid_current(),'promotion')$q$,'42501','client cannot manufacture writer scope');
SELECT pg_temp.foundation_assert(NOT private.catalog_writer_active_v2(),'writer predicate is callable but exposes no authority');
SELECT pg_temp.catalog_owner_test_call(md5('lifetime-customer-1')::uuid,md5('lifetime-actor-2')::uuid,NULL,NULL);
SELECT pg_temp.catalog_owner_test_call(md5('lifetime-customer-2')::uuid,md5('lifetime-actor-2')::uuid,NULL,NULL);
SELECT pg_temp.catalog_owner_test_call(md5('lifetime-customer-3')::uuid,md5('lifetime-actor-2')::uuid,NULL,NULL);
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('lifetime-customer-1')::uuid),'owner assignment actual customer reference is used');
-- Real promotion storage declaration, but synthetic metadata only, not provider bytes.
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('promotion-images','promotions/'||md5('lifetime-actor-1')::uuid||'/'||md5('lifetime-promotion')::uuid||'/'||md5('lifetime-image')::uuid||'.png',md5('lifetime-actor-1')::uuid::text,'{"size":1,"mimetype":"image/png"}');
INSERT INTO pg_temp.catalogue_writer_results(label,request,operation,payload) VALUES('promotion',md5('lifetime-promotion-create')::uuid,'create_promotion',jsonb_build_object('id',md5('lifetime-promotion')::uuid,'product_id',md5('lifetime-product-1')::uuid,'opening_quantity',8,'image_path','promotions/'||md5('lifetime-actor-1')::uuid||'/'||md5('lifetime-promotion')::uuid||'/'||md5('lifetime-image')::uuid||'.png','harga_pokok',NULL,'luar_kota',0,'dalam_kota',NULL,'depo_bangunan',NULL,'is_active',true));
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_writer_test_call('promotion',request,operation,payload,true) FROM pg_temp.catalogue_writer_results WHERE label='promotion'$q$,'55000','fresh remaining generation two remains gated');
UPDATE pg_temp.catalogue_writer_results SET result=pg_temp.catalog_writer_test_call('promotion',request,operation,payload) WHERE label='promotion';
SELECT pg_temp.catalog_writer_test_call('promotion',md5('lifetime-promotion-adjust')::uuid,'adjust_stock',jsonb_build_object('promotion_id',md5('lifetime-promotion')::uuid,'expected_stock_version',1,'quantity_delta',2,'reason','Fictional adjustment'));
SELECT pg_temp.catalog_writer_test_call('promotion',md5('lifetime-promotion-disable')::uuid,'set_active',jsonb_build_object('promotion_id',md5('lifetime-promotion')::uuid,'expected_stock_version',2,'is_active',false));
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('lifetime-product-1')::uuid),'promotion master and immutable movement are marked');
SELECT pg_temp.foundation_assert((SELECT execution_version=2 FROM private.pilot_promotion_requests WHERE request_id=md5('lifetime-promotion-create')::uuid),'promotion clone explicitly admits generation two');
SELECT pg_temp.foundation_assert((SELECT remaining_quantity=10 AND stock_version=3 AND NOT is_active FROM public.promotions WHERE id=md5('lifetime-promotion')::uuid),'promotion stock arithmetic and desired active state preserved');
UPDATE public.products SET is_enabled=false WHERE id=md5('lifetime-product-1')::uuid;
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_assert((SELECT public.pilot_promotion_transaction_v1(request,operation,payload)=result FROM pg_temp.catalogue_writer_results WHERE label='promotion'),'public legacy route replays committed v2 promotion without master checks');
SELECT pg_temp.foundation_assert((SELECT pg_temp.catalog_writer_test_call('promotion',request,operation,payload,true)=result FROM pg_temp.catalogue_writer_results WHERE label='promotion'),'authorized promotion replay precedes inactive admission gate');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('lifetime-actor-4')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_writer_test_call('promotion',request,operation,payload) FROM pg_temp.catalogue_writer_results WHERE label='promotion'$q$,'42501','stage07 PO promotion authority remains denied before replay');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('lifetime-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.catalogue_writer_results(label,request,operation,payload,result)
SELECT 'schedule',md5('lifetime-schedule-create')::uuid,'create_schedule',p,pg_temp.catalog_writer_test_call('schedule',md5('lifetime-schedule-create')::uuid,'create_schedule',p)
FROM (SELECT jsonb_build_object('customer_id',md5('lifetime-customer-1')::uuid,'sales_person_id',md5('lifetime-actor-2')::uuid,'scheduled_date','2097-10-15','notes','Initial') p) x;
INSERT INTO pg_temp.catalogue_writer_results(label,request,operation,payload,result)
SELECT 'schedule-edit',md5('lifetime-schedule-edit')::uuid,'edit_schedule',p,pg_temp.catalog_writer_test_call('schedule',md5('lifetime-schedule-edit')::uuid,'edit_schedule',p)
FROM (SELECT jsonb_build_object('schedule_id',(result->>'id')::uuid,'expected_version',1,'customer_id',md5('lifetime-customer-2')::uuid,'sales_person_id',md5('lifetime-actor-2')::uuid,'scheduled_date','2097-10-15','notes','Rebound') p FROM pg_temp.catalogue_writer_results WHERE label='schedule') x;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='used') FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(md5('lifetime-customer-1')::uuid,md5('lifetime-customer-2')::uuid)),'schedule replacement preserves actual OLD and NEW customer evidence');
-- Finalize real photo workflow, including the customer last_visit_date UPDATE.
INSERT INTO storage.objects(bucket_id,name,owner_id) SELECT 'visits','visits/'||(result->>'id')||'/fictional.png',md5('lifetime-actor-2')::uuid::text FROM pg_temp.catalogue_writer_results WHERE label='schedule';
SELECT set_config('request.jwt.claim.sub',md5('lifetime-actor-2')::uuid::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.catalogue_writer_results(label,request,operation,payload,result)
SELECT 'visit',md5('lifetime-visit')::uuid,'finalize_visit',p,pg_temp.catalog_writer_test_call('visit',md5('lifetime-visit')::uuid,'finalize_visit',p)
FROM (SELECT jsonb_build_object('schedule_id',(result->>'id')::uuid,'expected_schedule_version',2,'customer_id',md5('lifetime-customer-2')::uuid,'scheduled_date','2097-10-15','storage_path','visits/'||(result->>'id')||'/fictional.png','notes','Visited') p FROM pg_temp.catalogue_writer_results WHERE label='schedule') x;
SELECT pg_temp.foundation_assert((SELECT public.pilot_finalize_visit(request,operation,payload)=result FROM pg_temp.catalogue_writer_results WHERE label='visit'),'finalize visit replay retains original schedule authority');
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT status='completed' FROM public.sales_schedules WHERE id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_writer_results WHERE label='schedule')),'actual photo completes the held schedule');
SELECT pg_temp.foundation_assert((SELECT last_visit_date IS NOT NULL FROM public.customers WHERE id=md5('lifetime-customer-2')::uuid),'visit completion customer update preserves final lock mode');
-- Seed an orphan amendment through untouched generation-one public routes on
-- UNKNOWN identities. Only the final v2 rejection may mark the historical OLD
-- source customer seven and replacement customer eight; a removed collector
-- must fail this proof even though rejection itself remains authorized.
SELECT set_config('request.jwt.claim.sub',md5('lifetime-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT public.pilot_assign_store_owner_v1(md5('lifetime-customer-7')::uuid,md5('lifetime-actor-2')::uuid,NULL,NULL);
SELECT public.pilot_assign_store_owner_v1(md5('lifetime-customer-8')::uuid,md5('lifetime-actor-2')::uuid,NULL,NULL);
INSERT INTO pg_temp.catalogue_writer_results(label,request,operation,payload,result)
SELECT 'orphan-source',md5('lifetime-orphan-source')::uuid,'create_schedule',p,public.pilot_schedule_transaction_v1(md5('lifetime-orphan-source')::uuid,'create_schedule',p)
FROM (SELECT jsonb_build_object('customer_id',md5('lifetime-customer-7')::uuid,'sales_person_id',md5('lifetime-actor-2')::uuid,'scheduled_date','2097-10-16') p) x;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('lifetime-actor-2')::uuid::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.catalogue_writer_results(label,request,operation,payload,result)
SELECT 'amendment',md5('lifetime-amendment')::uuid,'amend_visit',p,public.pilot_schedule_transaction_v1(md5('lifetime-amendment')::uuid,'amend_visit',p)
FROM (SELECT jsonb_build_object('schedule_id',(result->>'id')::uuid,'expected_version',1,'customer_id',md5('lifetime-customer-8')::uuid,'scheduled_date','2097-10-17') p FROM pg_temp.catalogue_writer_results WHERE label='orphan-source') x;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('lifetime-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT public.pilot_schedule_transaction_v1(md5('lifetime-source-delete')::uuid,'delete_schedule',jsonb_build_object('schedule_id',(result->>'id')::uuid,'expected_version',1)) FROM pg_temp.catalogue_writer_results WHERE label='orphan-source';
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='unknown') FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(md5('lifetime-customer-7')::uuid,md5('lifetime-customer-8')::uuid)),'legacy orphan setup leaves both historical customer identities unknown');
SET LOCAL ROLE authenticated;
SELECT pg_temp.catalog_writer_test_call('schedule',md5('lifetime-orphan-reject')::uuid,'reject_request',jsonb_build_object('request_id',(result->>'id')::uuid,'expected_version',1)) FROM pg_temp.catalogue_writer_results WHERE label='amendment';
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT status='rejected' FROM public.visit_requests WHERE id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_writer_results WHERE label='amendment')),'deleted amendment source resolves retained workflow customers without breaking rejection');
SELECT pg_temp.foundation_assert((SELECT count(*)=2 AND bool_and(lifetime_state='used') FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(md5('lifetime-customer-7')::uuid,md5('lifetime-customer-8')::uuid)),'v2 rejection marks every retained historical source and replacement customer');
-- Evidence uses the real final stage08 report draft then registration, service
-- attestation and finalization, not owner-inserted finalized evidence.
SELECT set_config('request.jwt.claim.sub',md5('lifetime-actor-3')::uuid::text,true);
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.catalogue_writer_results(label,request,operation,payload,result)
SELECT 'report',md5('lifetime-report')::uuid,'save_report_draft',p,public.pilot_co_transaction_v1(md5('lifetime-report')::uuid,'save_report_draft',p)
FROM (SELECT jsonb_build_object('action','initialize','customer_id',md5('lifetime-customer-4')::uuid,'expected_customer_version','1','report_month',date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date) p) x;
RESET ROLE;
INSERT INTO pg_temp.catalogue_writer_results(label,request,operation,payload)
SELECT 'register',md5('lifetime-register')::uuid,'register_evidence',jsonb_build_object('draft_id',d.id,'expected_draft_version',d.version::text,'expected_customer_version',s.version::text,'filename','fictional.pdf','mime_type','application/pdf','byte_size',1,'sha256',repeat('a',64))
FROM private.co_drafts d JOIN private.co_customer_state s ON s.customer_id=d.customer_id WHERE d.id=(SELECT (result->>'id')::uuid FROM pg_temp.catalogue_writer_results WHERE label='report');
SET LOCAL ROLE authenticated;
UPDATE pg_temp.catalogue_writer_results SET result=pg_temp.catalog_writer_test_call('evidence',request,operation,payload) WHERE label='register';
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_co_transaction_v1(request,'create_co',payload) FROM pg_temp.catalogue_writer_results WHERE label='register'$q$,'22023','evidence receipt cannot cross order family');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_reconcile_co_v1(request,false) FROM pg_temp.catalogue_writer_results WHERE label='register'$q$,'22023','evidence reconcile family remains separate');
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT execution_version=2 FROM private.co_commands WHERE request_id=md5('lifetime-register')::uuid),'fresh evidence has explicit generation two not legacy shared default');
SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('lifetime-customer-4')::uuid),'evidence registration marks real customer lifetime');
INSERT INTO storage.objects(id,bucket_id,name,owner_id,metadata,version)
SELECT md5('lifetime-object')::uuid,'co-evidence',(result->>'id')||'.pdf',md5('lifetime-actor-3')::uuid::text,'{"size":1,"mimetype":"application/pdf"}','fictional-version' FROM pg_temp.catalogue_writer_results WHERE label='register';
CREATE TEMP TABLE lifetime_evidence_id AS SELECT (result->>'id')::uuid id FROM pg_temp.catalogue_writer_results WHERE label='register';
GRANT SELECT ON pg_temp.lifetime_evidence_id TO service_role;
SET LOCAL ROLE service_role;
SELECT pg_temp.catalog_attest_test_call(md5('lifetime-actor-3')::uuid,id,md5('lifetime-object')::uuid,'fictional-version') FROM pg_temp.lifetime_evidence_id;
SELECT pg_temp.catalog_attest_test_call(md5('lifetime-actor-3')::uuid,id,md5('lifetime-object')::uuid,'fictional-version') FROM pg_temp.lifetime_evidence_id;
RESET ROLE;
INSERT INTO pg_temp.catalogue_writer_results(label,request,operation,payload)
SELECT 'finalize',md5('lifetime-finalize')::uuid,'finalize_evidence',jsonb_build_object('evidence_id',e.id,'expected_evidence_version',e.version::text,'expected_draft_version',d.version::text,'expected_customer_version',s.version::text)
FROM private.co_evidence e JOIN private.co_drafts d ON d.id=e.draft_id JOIN private.co_customer_state s ON s.customer_id=e.customer_id WHERE e.id=(SELECT id FROM pg_temp.lifetime_evidence_id);
SET LOCAL ROLE authenticated;
UPDATE pg_temp.catalogue_writer_results SET result=pg_temp.catalog_writer_test_call('evidence',request,operation,payload) WHERE label='finalize';
SELECT pg_temp.foundation_assert((SELECT public.pilot_co_evidence_transaction_v1(request,operation,payload)=result FROM pg_temp.catalogue_writer_results WHERE label='register'),'committed evidence replay precedes changed draft and customer classification');
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_co_evidence_attest_v1(md5('lifetime-actor-3')::uuid,NULL,NULL,NULL,1,'application/pdf',repeat('a',64))$q$,'42501','ordinary authenticated cannot use service attestation');
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT e.version=2 AND d.evidence_id=e.id FROM private.co_evidence e JOIN private.co_drafts d ON d.id=e.draft_id WHERE e.id=(SELECT id FROM pg_temp.lifetime_evidence_id)),'real evidence finalization binds verified object to report draft');
-- Actual queued OLD-only and malformed snapshot failures, not helper-only proofs.
CREATE FUNCTION pg_temp.catalog_writer_assert_probe(mode text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.catalog_writer_enter_v2('schedule',false);
 IF mode='old' THEN
  UPDATE public.sales_schedules SET outlet_id=md5('lifetime-customer-1')::uuid WHERE id=md5('lifetime-unmarked-schedule')::uuid;
 ELSIF mode='shape' THEN
  INSERT INTO private.pilot_visit_workflow_audit(actor_id,request_id,operation,resource_id,old_value,new_value)
  VALUES(md5('lifetime-actor-1')::uuid,md5('lifetime-malformed')::uuid,'delete_schedule',md5('lifetime-unmarked-schedule')::uuid,'{"outlet_id":false}',NULL);
 ELSE
  SET CONSTRAINTS ALL IMMEDIATE;
 END IF;
 PERFORM private.catalog_writer_leave_v2();
 SET CONSTRAINTS ALL IMMEDIATE;
END $$;
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date)
VALUES(md5('lifetime-unmarked-schedule')::uuid,md5('lifetime-customer-5')::uuid,md5('lifetime-actor-2')::uuid,md5('lifetime-actor-3')::uuid,'2097-11-01');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_writer_assert_probe('old')$q$,'23514','actual OLD-only removed customer cannot escape missing lifetime mark');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_writer_assert_probe('shape')$q$,'23514','unknown actual workflow snapshot fails closed');
SELECT pg_temp.foundation_raises($q$SELECT pg_temp.catalog_writer_assert_probe('immediate')$q$,'23514','forced immediate remaining scope checks fail closed');
SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('lifetime-customer-5')::uuid),'assertion-only triggers never repair missing lifetime evidence');
-- Admission-only raw drain preserves existing raw service DML and PO direct delete.
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(md5('lifetime-customer-6')::uuid,'2097-12',md5('lifetime-actor-1')::uuid);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('lifetime-actor-4')::uuid::text,true);
SET LOCAL ROLE authenticated;
DELETE FROM public.products WHERE id=md5('lifetime-product-4')::uuid;
RESET ROLE;
SELECT pg_temp.foundation_assert((SELECT deleted_at IS NOT NULL FROM private.catalog_identity_v1 WHERE kind='product' AND id=md5('lifetime-product-4')::uuid),'PO direct product deletion retains identity tombstone without CO unused rule');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_writer_active_v2),'remaining cores clean every transaction scope');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.foundation_assert((SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton),'remaining writer work does not activate incomplete global coverage');
