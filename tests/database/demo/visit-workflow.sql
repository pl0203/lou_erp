-- Disposable synthetic role/contract tests, not hosted RLS or concurrency evidence.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.pilot_schedule_transaction_v1(uuid,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'Missing versioned visit workflow'; END IF;
END $$;
INSERT INTO auth.users(id) SELECT ('a3100000-0000-0000-0000-00000000000'||n)::uuid FROM generate_series(1,5)n;
INSERT INTO public.users(id,full_name,email,role,manager_id) VALUES
('a3100000-0000-0000-0000-000000000001','Manager','visit-manager@tests.invalid','sales_manager',null),
('a3100000-0000-0000-0000-000000000002','Sales','visit-sales@tests.invalid','sales_person','a3100000-0000-0000-0000-000000000001'),
('a3100000-0000-0000-0000-000000000003','Other','visit-other@tests.invalid','sales_manager',null),
('a3100000-0000-0000-0000-000000000004','Other sales','visit-other-sales@tests.invalid','sales_person','a3100000-0000-0000-0000-000000000003'),
('a3100000-0000-0000-0000-000000000005','Exec','visit-exec@tests.invalid','executive',null);
INSERT INTO public.customers(id,name) SELECT ('c3100000-0000-0000-0000-00000000000'||n)::uuid,'Visit store '||n FROM generate_series(1,3)n;
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) SELECT id,'a3100000-0000-0000-0000-000000000001','a3100000-0000-0000-0000-000000000001' FROM public.customers WHERE id IN('c3100000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000002');
INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) SELECT id,'a3100000-0000-0000-0000-000000000002' FROM public.customers WHERE id IN('c3100000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000002');
CREATE FUNCTION pg_temp.denied(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Expected denial % for %',expected,statement;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000002',true);
DO $$ DECLARE proposal jsonb; approval jsonb; req uuid:=gen_random_uuid(); pay jsonb; sched uuid; amend jsonb; visit jsonb; binding jsonb; note jsonb; BEGIN
 pay:=jsonb_build_object('customer_id','c3100000-0000-0000-0000-000000000001','scheduled_date',current_date,'notes','Please visit');
 proposal:=public.pilot_schedule_transaction_v1(req,'propose_visit',pay);
 IF EXISTS(SELECT 1 FROM public.sales_schedules WHERE outlet_id='c3100000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'Proposal created executable schedule'; END IF;
 IF public.pilot_schedule_transaction_v1(req,'propose_visit',pay)<>proposal THEN RAISE EXCEPTION 'Replay changed result'; END IF;
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(%L,''propose_visit'',%L)',req,pay||'{"notes":"changed"}'),'22023');
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(gen_random_uuid(),''propose_visit'',%L)',pay||'{"sales_person_id":"a3100000-0000-0000-0000-000000000004"}'),'22023');
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(gen_random_uuid(),''propose_visit'',%L)',pay||'{"customer_id":"c3100000-0000-0000-0000-000000000003"}'),'42501');
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(gen_random_uuid(),''approve_request'',%L)',jsonb_build_object('request_id',proposal->>'id','expected_version',1)),'42501');
 PERFORM public.pilot_reconcile_visit(req,true);
 IF public.pilot_schedule_transaction_v1(req,'propose_visit',pay)<>proposal THEN RAISE EXCEPTION 'Wrong recovery endpoint affected schedule receipt'; END IF;
 PERFORM set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000003',true);
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(gen_random_uuid(),''approve_request'',%L)',jsonb_build_object('request_id',proposal->>'id','expected_version',1)),'42501');
 PERFORM set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000001',true);
 PERFORM pg_temp.denied('UPDATE public.sales_schedules SET notes=''raw''','42501');
 approval:=public.pilot_schedule_transaction_v1(gen_random_uuid(),'approve_request',jsonb_build_object('request_id',proposal->>'id','expected_version',1)); sched:=(approval->>'schedule_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.sales_schedules WHERE id=sched AND assigned_by=auth.uid() AND version=1) THEN RAISE EXCEPTION 'Missing approved schedule'; END IF;
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(gen_random_uuid(),''approve_request'',%L)',jsonb_build_object('request_id',proposal->>'id','expected_version',1)),'40001');
 PERFORM set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000002',true);
 amend:=public.pilot_schedule_transaction_v1(gen_random_uuid(),'amend_visit',jsonb_build_object('schedule_id',sched,'expected_version',1,'customer_id','c3100000-0000-0000-0000-000000000002','scheduled_date',current_date+1,'notes','Change'));
 IF NOT EXISTS(SELECT 1 FROM public.sales_schedules WHERE id=sched AND outlet_id='c3100000-0000-0000-0000-000000000001' AND version=1) THEN RAISE EXCEPTION 'Pending amendment changed effective schedule'; END IF;
 PERFORM set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000001',true);
 PERFORM public.pilot_schedule_transaction_v1(gen_random_uuid(),'approve_request',jsonb_build_object('request_id',amend->>'id','expected_version',1));
 IF NOT EXISTS(SELECT 1 FROM public.sales_schedules WHERE id=sched AND outlet_id='c3100000-0000-0000-0000-000000000002' AND version=2) THEN RAISE EXCEPTION 'Approved store amendment failed'; END IF;
 PERFORM set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000002',true);
 binding:=jsonb_build_object('schedule_id',sched,'expected_schedule_version',1,'customer_id','c3100000-0000-0000-0000-000000000001','scheduled_date',current_date,'storage_path','visits/'||sched||'/proof.webp','lat',1,'lng',2,'notes','Initial note');
 PERFORM pg_temp.denied(format('SELECT public.pilot_finalize_visit(gen_random_uuid(),''finalize_visit'',%L)',binding),'PVS01');
 PERFORM pg_temp.denied(format('SELECT public.pilot_finalize_visit(gen_random_uuid(),''finalize_visit'',%L)',binding-'expected_schedule_version'),'22023');
 -- Storage stubs are seeded below under owner before complete finalization tests.
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.sales_schedules','INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Direct manager write remains'; END IF;
END $$;
-- Atomic check-in notes and later note edits cannot mutate evidence.
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES
('53100000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000001','a3100000-0000-0000-0000-000000000002','a3100000-0000-0000-0000-000000000001',current_date+7),
('53100000-0000-0000-0000-000000000002','c3100000-0000-0000-0000-000000000001','a3100000-0000-0000-0000-000000000002','a3100000-0000-0000-0000-000000000001',current_date+8);
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('visits','visits/53100000-0000-0000-0000-000000000001/proof.webp','a3100000-0000-0000-0000-000000000002');
INSERT INTO public.purchase_orders(customer_id,created_by,po_number,status,order_date) VALUES
('c3100000-0000-0000-0000-000000000001','a3100000-0000-0000-0000-000000000005','VISIT-RECENT','cancelled',current_date),
('c3100000-0000-0000-0000-000000000001','a3100000-0000-0000-0000-000000000005','VISIT-BOUNDARY','shipped',(current_date-interval '2 months')::date),
('c3100000-0000-0000-0000-000000000001','a3100000-0000-0000-0000-000000000005','VISIT-OLD','draft',(current_date-interval '2 months')::date-1),
('c3100000-0000-0000-0000-000000000002','a3100000-0000-0000-0000-000000000005','VISIT-ONLY-OLD','draft',current_date-365);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000002',true);
DO $$ DECLARE req uuid:=gen_random_uuid(); note_req uuid:=gen_random_uuid(); payload jsonb; receipt jsonb; evidence jsonb; response jsonb; tomb uuid:=gen_random_uuid(); wrong uuid:=gen_random_uuid(); BEGIN
 payload:=jsonb_build_object('schedule_id','53100000-0000-0000-0000-000000000001','expected_schedule_version',1,'customer_id','c3100000-0000-0000-0000-000000000001','scheduled_date',current_date+7,'storage_path','visits/53100000-0000-0000-0000-000000000001/proof.webp','lat',0,'lng',0,'notes','Atomic original');
 receipt:=public.pilot_finalize_visit(req,'finalize_visit',payload);
 SELECT to_jsonb(v)-'notes'-'note_version' INTO evidence FROM public.outlet_visits v WHERE id=(receipt->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.outlet_visits v JOIN public.visit_photos p ON p.visit_id=v.id WHERE v.id=(receipt->>'id')::uuid AND v.notes='Atomic original' AND v.checked_in_at=p.taken_at AND v.lat=0 AND p.lat=0) THEN RAISE EXCEPTION 'Atomic note/evidence missing'; END IF;
 PERFORM public.pilot_schedule_transaction_v1(note_req,'edit_visit_note',jsonb_build_object('visit_id',receipt->>'id','expected_version',1,'notes','Edited text <script> is plain text'));
 IF EXISTS(SELECT 1 FROM public.outlet_visits v WHERE v.id=(receipt->>'id')::uuid AND (to_jsonb(v)-'notes'-'note_version')<>evidence) THEN RAISE EXCEPTION 'Notes rewrote evidence'; END IF;
 IF public.pilot_finalize_visit(req,'finalize_visit',payload)<>receipt OR public.pilot_reconcile_visit(req,true)->'result'<>receipt THEN RAISE EXCEPTION 'Note edit invalidated committed check-in recovery'; END IF;
 IF public.pilot_reconcile_schedule_v1(note_req,true)->>'state'<>'committed' THEN RAISE EXCEPTION 'Note recovery failed'; END IF;
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(gen_random_uuid(),''edit_visit_note'',%L)',jsonb_build_object('visit_id',receipt->>'id','expected_version',1,'notes','stale')),'40001');
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(gen_random_uuid(),''edit_visit_note'',%L)',jsonb_build_object('visit_id',receipt->>'id','expected_version',2,'notes',repeat('x',2001))),'22023');
 PERFORM pg_temp.denied(format('UPDATE public.outlet_visits SET notes=''raw'' WHERE id=%L',receipt->>'id'),'42501');
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(gen_random_uuid(),''edit_visit_note'',%L)',jsonb_build_object('visit_id',receipt->>'id','expected_version',2,'notes','rewrite','checked_in_at',clock_timestamp(),'outlet_id','c3100000-0000-0000-0000-000000000002','storage_path','changed.webp')),'22023');
 PERFORM set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000004',true);
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(gen_random_uuid(),''edit_visit_note'',%L)',jsonb_build_object('visit_id',receipt->>'id','expected_version',2,'notes','foreign')),'42501');
 PERFORM set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000002',true);
 -- Unknown IDs are namespaced: an order/visit tombstone cannot cancel schedule work.
 PERFORM public.pilot_reconcile_request(wrong,true); PERFORM public.pilot_reconcile_visit(wrong,true);
 PERFORM public.pilot_schedule_transaction_v1(wrong,'propose_visit',jsonb_build_object('customer_id','c3100000-0000-0000-0000-000000000001','scheduled_date',current_date+10));
 PERFORM public.pilot_reconcile_schedule_v1(tomb,true);
 PERFORM pg_temp.denied(format('SELECT public.pilot_schedule_transaction_v1(%L,''propose_visit'',%L)',tomb,jsonb_build_object('customer_id','c3100000-0000-0000-0000-000000000001','scheduled_date',current_date+11)),'55000');
 response:=public.pilot_store_po_context_v1('c3100000-0000-0000-0000-000000000001',1,1);
 IF (response->>'total')::int<>2 OR jsonb_array_length(response->'items')<>1 OR response->'items'->0->>'status'<>'cancelled' OR response->>'range_from'<>((current_date-interval '2 months')::date)::text OR response->>'range_through'<>current_date::text THEN RAISE EXCEPTION 'Store projection/window/status/page mismatch: %',response; END IF;
 response:=public.pilot_store_po_context_v1('c3100000-0000-0000-0000-000000000001',2,1);
 IF response->'items'->0->>'status'<>'shipped' THEN RAISE EXCEPTION 'Legacy status hidden'; END IF;
 response:=public.pilot_store_po_context_v1('c3100000-0000-0000-0000-000000000002',1,20);
 IF (response->>'total')::int<>0 OR response->>'latest_po_date'<>(current_date-365)::text THEN RAISE EXCEPTION 'Latest date incorrectly restricted to recent range'; END IF;
 PERFORM pg_temp.denied('SELECT public.pilot_store_po_context_v1(''c3100000-0000-0000-0000-000000000003'',1,20)','42501');
 PERFORM pg_temp.denied('SELECT public.pilot_store_po_context_v1(''c3100000-0000-0000-0000-000000000001'',0,20)','22023');
 PERFORM pg_temp.denied('SELECT public.pilot_store_po_context_v1(''c3100000-0000-0000-0000-000000000001'',1,51)','22023');
 -- Missing storage object leaves neither note nor check-in evidence.
 PERFORM pg_temp.denied(format('SELECT public.pilot_finalize_visit(gen_random_uuid(),''finalize_visit'',%L)',payload||jsonb_build_object('schedule_id','53100000-0000-0000-0000-000000000002','scheduled_date',current_date+8,'storage_path','visits/53100000-0000-0000-0000-000000000002/missing.webp')),'42501');
 IF EXISTS(SELECT 1 FROM public.outlet_visits WHERE schedule_id='53100000-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'Failed finalize left note/evidence'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.pilot_visit_workflow_audit WHERE operation='edit_visit_note' AND old_value->>'notes'='Atomic original' AND new_value->>'notes'='Edited text <script> is plain text') THEN RAISE EXCEPTION 'Note edit audit missing'; END IF;
END $$;
-- Only a proposal (no effective schedule) never retains customer access after assignment is lost.
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.customers(id,name) VALUES('c3100000-0000-0000-0000-000000000004','Proposal only');
INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES('c3100000-0000-0000-0000-000000000004','a3100000-0000-0000-0000-000000000002');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000002',true);
SELECT public.pilot_schedule_transaction_v1('e3100000-0000-0000-0000-000000000001','propose_visit',jsonb_build_object('customer_id','c3100000-0000-0000-0000-000000000004','scheduled_date',current_date));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DELETE FROM public.customer_sales_rep_assignments WHERE customer_id='c3100000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000002',true);
DO $$ BEGIN
 IF private.pilot_can_access_customer('c3100000-0000-0000-0000-000000000004') THEN RAISE EXCEPTION 'Proposal granted customer access'; END IF;
 PERFORM pg_temp.denied('SELECT public.pilot_reconcile_schedule_v1(''e3100000-0000-0000-0000-000000000001'',true)','42501');
END $$;
RESET ROLE;
-- A manager losing current team authority cannot recover their earlier committed decision.
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET manager_id='a3100000-0000-0000-0000-000000000003' WHERE id='a3100000-0000-0000-0000-000000000002';
DO $$ DECLARE prior uuid; BEGIN
 SELECT request_id INTO prior FROM private.pilot_schedule_requests WHERE actor_id='a3100000-0000-0000-0000-000000000001' AND operation='approve_request' LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000001',true);
 PERFORM pg_temp.denied(format('SELECT public.pilot_reconcile_schedule_v1(%L,true)',prior),'42501');
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=false WHERE id='a3100000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3100000-0000-0000-0000-000000000002',true);
SELECT pg_temp.denied('SELECT public.pilot_reconcile_schedule_v1(gen_random_uuid(),true)','42501');
SELECT pg_temp.denied('SELECT public.pilot_store_po_context_v1(''c3100000-0000-0000-0000-000000000001'',1,20)','42501');
RESET ROLE;

ROLLBACK;
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.pilot_store_po_context_v1(uuid,integer,integer)') IS NULL THEN RAISE EXCEPTION 'Missing narrow store context'; END IF;
 IF ('2026-10-08'::date-interval '2 months')::date<>'2026-08-08' OR ('2026-04-30'::date-interval '2 months')::date<>'2026-02-28' THEN RAISE EXCEPTION 'Two-month clamp failed'; END IF;
END $$;
ROLLBACK;

-- Review regression: only substantive replanning reopens a missed, unvisited schedule.
BEGIN;
INSERT INTO auth.users(id) VALUES('a3200000-0000-0000-0000-000000000001'),('a3200000-0000-0000-0000-000000000002');
INSERT INTO public.users(id,full_name,email,role,manager_id) VALUES
('a3200000-0000-0000-0000-000000000001','Replan manager','replan-manager@tests.invalid','sales_manager',null),
('a3200000-0000-0000-0000-000000000002','Replan sales','replan-sales@tests.invalid','sales_person','a3200000-0000-0000-0000-000000000001');
INSERT INTO public.customers(id,name) VALUES('c3200000-0000-0000-0000-000000000001','Replan store');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES('c3200000-0000-0000-0000-000000000001','a3200000-0000-0000-0000-000000000001','a3200000-0000-0000-0000-000000000001');
INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES('c3200000-0000-0000-0000-000000000001','a3200000-0000-0000-0000-000000000002');
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date,status) VALUES
('53200000-0000-0000-0000-000000000001','c3200000-0000-0000-0000-000000000001','a3200000-0000-0000-0000-000000000002','a3200000-0000-0000-0000-000000000001',current_date-2,'missed'),
('53200000-0000-0000-0000-000000000002','c3200000-0000-0000-0000-000000000001','a3200000-0000-0000-0000-000000000002','a3200000-0000-0000-0000-000000000001',current_date-1,'missed');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('visits','visits/53200000-0000-0000-0000-000000000001/replan.webp','a3200000-0000-0000-0000-000000000002');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3200000-0000-0000-0000-000000000001',true);
DO $$ DECLARE p jsonb; proposal jsonb; BEGIN
 p:=jsonb_build_object('schedule_id','53200000-0000-0000-0000-000000000001','expected_version',1,'customer_id','c3200000-0000-0000-0000-000000000001','sales_person_id','a3200000-0000-0000-0000-000000000002','scheduled_date',current_date-2,'notes','notes only');
 PERFORM public.pilot_schedule_transaction_v1(gen_random_uuid(),'edit_schedule',p);
 IF (SELECT status FROM public.sales_schedules WHERE id='53200000-0000-0000-0000-000000000001')<>'missed' THEN RAISE EXCEPTION 'Notes-only manager edit reopened missed schedule'; END IF;
 PERFORM public.pilot_schedule_transaction_v1(gen_random_uuid(),'edit_schedule',p||jsonb_build_object('expected_version',2,'scheduled_date',current_date));
 IF (SELECT status FROM public.sales_schedules WHERE id='53200000-0000-0000-0000-000000000001')<>'pending' THEN RAISE EXCEPTION 'Substantive manager replan did not become pending'; END IF;
 PERFORM set_config('request.jwt.claim.sub','a3200000-0000-0000-0000-000000000002',true);
 proposal:=public.pilot_schedule_transaction_v1(gen_random_uuid(),'amend_visit',jsonb_build_object('schedule_id','53200000-0000-0000-0000-000000000002','expected_version',1,'customer_id','c3200000-0000-0000-0000-000000000001','scheduled_date',current_date-1,'notes','notes only'));
 PERFORM set_config('request.jwt.claim.sub','a3200000-0000-0000-0000-000000000001',true);
 PERFORM public.pilot_schedule_transaction_v1(gen_random_uuid(),'approve_request',jsonb_build_object('request_id',proposal->>'id','expected_version',1));
 IF (SELECT status FROM public.sales_schedules WHERE id='53200000-0000-0000-0000-000000000002')<>'missed' THEN RAISE EXCEPTION 'Notes-only approved amendment reopened missed schedule'; END IF;
 PERFORM set_config('request.jwt.claim.sub','a3200000-0000-0000-0000-000000000002',true);
 proposal:=public.pilot_schedule_transaction_v1(gen_random_uuid(),'amend_visit',jsonb_build_object('schedule_id','53200000-0000-0000-0000-000000000002','expected_version',2,'customer_id','c3200000-0000-0000-0000-000000000001','scheduled_date',current_date+1,'notes','substantive'));
 PERFORM set_config('request.jwt.claim.sub','a3200000-0000-0000-0000-000000000001',true);
 PERFORM public.pilot_schedule_transaction_v1(gen_random_uuid(),'approve_request',jsonb_build_object('request_id',proposal->>'id','expected_version',1));
 IF (SELECT status FROM public.sales_schedules WHERE id='53200000-0000-0000-0000-000000000002')<>'pending' THEN RAISE EXCEPTION 'Substantive approved amendment did not become pending'; END IF;
 PERFORM set_config('request.jwt.claim.sub','a3200000-0000-0000-0000-000000000002',true);
 PERFORM public.pilot_finalize_visit(gen_random_uuid(),'finalize_visit',jsonb_build_object('schedule_id','53200000-0000-0000-0000-000000000001','expected_schedule_version',3,'customer_id','c3200000-0000-0000-0000-000000000001','scheduled_date',current_date,'storage_path','visits/53200000-0000-0000-0000-000000000001/replan.webp','notes','Replanned visit'));
 PERFORM set_config('request.jwt.claim.sub','a3200000-0000-0000-0000-000000000001',true);
 BEGIN PERFORM public.pilot_schedule_transaction_v1(gen_random_uuid(),'edit_schedule',p||jsonb_build_object('expected_version',4,'scheduled_date',current_date+20)); RAISE EXCEPTION 'Completed replan reopened'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.pilot_visit_workflow_audit WHERE operation='edit_schedule' AND old_value->>'status'='missed' AND new_value->>'status'='pending') THEN RAISE EXCEPTION 'Manager replan audit lost prior status'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.pilot_visit_workflow_audit WHERE operation='approve_request' AND old_value->'schedule'->>'status'='missed' AND new_value->'schedule'->>'status'='pending') THEN RAISE EXCEPTION 'Approved replan audit lost prior schedule status'; END IF;
END $$;
ROLLBACK;
