-- Complete actual-role command/recovery/authority/preview fixtures, included by calendar.sql.
BEGIN;
\ir seed.sql
INSERT INTO public.ihr_leave_members(user_id,member_kind,active,employment_start,eligibility_date)
VALUES('71000000-0000-0000-0000-000000000005','manager',false,'2026-01-01','2026-06-01');
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason) VALUES
 ('71000000-0000-0000-0000-000000000006','configure','all_policy_members',NULL,'2000-01-01 00:00Z','71000000-0000-0000-0000-000000000005','Fictional independent admin'),
 ('71000000-0000-0000-0000-000000000005','configure','all_policy_members',NULL,'2000-01-01 00:00Z','71000000-0000-0000-0000-000000000006','Fictional scoped admin'),
 ('71000000-0000-0000-0000-000000000009','configure','employee','71000000-0000-0000-0000-000000000009','2000-01-01 00:00Z','71000000-0000-0000-0000-000000000006','Fictional self target'),
 ('71000000-0000-0000-0000-000000000006','configure','employee','71000000-0000-0000-0000-000000000004','2000-01-01 00:00Z','71000000-0000-0000-0000-000000000005','Fictional director target');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
DO $$ DECLARE v_before jsonb;v_after jsonb;p jsonb;v_before_found boolean;v_after_found boolean;BEGIN
 SELECT value INTO v_before FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000005';
 v_before_found:=FOUND;
 p:='{"employee_id":"71000000-0000-0000-0000-000000000005","member_kind":"manager","active":true,"employment_start":"2026-01-01","eligibility_date":"2026-06-01","calendar_id":null,"expected_version":1,"reason":"Fictional own activation"}';
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_member'',%L)',gen_random_uuid(),p::text),'42501');
 p:=p||'{"active":false,"employment_start":"2025-01-01","eligibility_date":"2025-06-01","reason":"Fictional own eligibility edit"}'::jsonb;
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_member'',%L)',gen_random_uuid(),p::text),'42501');
 SELECT value INTO v_after FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000005';
 v_after_found:=FOUND;
 RAISE NOTICE 'Fictional self-member before/after: %',jsonb_build_object('before',v_before,'after',v_after,'beforeRowFound',v_before_found,'afterRowFound',v_after_found,'beforeNonNull',v_before IS NOT NULL,'afterNonNull',v_after IS NOT NULL);
 PERFORM pg_temp.assert_true(v_before_found AND v_before IS NOT NULL,'self member before row is present and nonnull');
 PERFORM pg_temp.assert_true(v_after_found AND v_after IS NOT NULL,'self member after row is present and nonnull');
 PERFORM pg_temp.assert_true(v_before=v_after,'self member changes leave fields and version unchanged');
 PERFORM pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'request'='false','own activation cannot grant request capability');
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('78000000-0000-0000-0000-000000000001','set_member','{"employee_id":"71000000-0000-0000-0000-000000000009","member_kind":"employee","active":true,"employment_start":null,"eligibility_date":null,"calendar_id":null,"expected_version":0,"reason":"Fictional own enrollment"}')$s$,'42501');
SELECT pg_temp.assert_true(public.leave_admin_setup_v1('members',1,100)->'rows' @> '[{"id":"71000000-0000-0000-0000-000000000009","version":0,"active":false,"memberKind":null}]','self enrollment stays absent');
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'request'='false','self enrollment cannot grant capability');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
DO $$ DECLARE p jsonb;v_result jsonb;v_preview jsonb;v_before jsonb;v_after jsonb;v_membership uuid;v_assignment uuid;v_new_assignment uuid;v_variant jsonb;v_claim text;
 v_calendar uuid:='73000000-0000-0000-0000-000000000090';BEGIN
 p:='{"calendar_id":"73000000-0000-0000-0000-000000000090","name":"Fictional public calendar","effective_from":"2099-10-01","effective_until":null,"timezone":null,"holidays_confirmed":true,"sunday_minutes":null,"holidays":["2099-10-06"],"groups":[{"id":"74000000-0000-0000-0000-000000000091","name":"Fictional C"},{"id":"74000000-0000-0000-0000-000000000092","name":"Fictional D"}],"expected_version":0,"reason":"Fictional draft"}';
 p:=p||jsonb_build_object('preview_fingerprint',public.leave_calendar_preview_v1(p-'reason'-'preview_fingerprint')->>'fingerprint');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000002','save_calendar_version',p)->>'version'='1','explicit draft created');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000002','save_calendar_version',p)->>'version'='1','calendar command replay idempotent');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''save_calendar_version'',%L)','78000000-0000-0000-0000-000000000002',(p||'{"reason":"Changed"}'::jsonb)::text),'55000');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''save_calendar_version'',%L)',gen_random_uuid(),(p||'{"expected_version":1,"actor_id":"forged"}'::jsonb)::text),'22023');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000003','set_member','{"employee_id":"71000000-0000-0000-0000-000000000002","member_kind":"employee","active":true,"employment_start":null,"eligibility_date":null,"calendar_id":"73000000-0000-0000-0000-000000000090","expected_version":1,"reason":"Fictional independent enrollment"}')->>'version'='2','member may select unconfirmed draft without inference');
 PERFORM pg_temp.assert_denied($s$SELECT public.leave_roster_preview_v1('73000000-0000-0000-0000-000000000090','2099-10-03','[{"id":"74000000-0000-0000-0000-000000000091","on_anchor":true}]','2099-10-03','2099-11-01')$s$,'22023');
 p:=p||'{"timezone":"Asia/Jakarta","sunday_minutes":0,"expected_version":1,"reason":"Fictional same-start confirmation"}'::jsonb;
 p:=p||jsonb_build_object('preview_fingerprint',public.leave_calendar_preview_v1(p-'reason'-'preview_fingerprint')->>'fingerprint');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000004','save_calendar_version',p)->>'version'='2','same-start higher source confirms timezone');
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
 PERFORM pg_temp.assert_true(public.leave_context_v1()->>'timezone'='Asia/Jakarta','confirmed source resolves stale null member snapshot');
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
 FOREACH v_variant IN ARRAY ARRAY['{"effective_from":"2099-11-01","timezone":"Etc/UTC","expected_version":2}'::jsonb,'{"sunday_minutes":225,"expected_version":2}'::jsonb,'{"sunday_minutes":450,"expected_version":2}'::jsonb] LOOP
  PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''save_calendar_version'',%L)',gen_random_uuid(),(p||v_variant)::text),'22023');
 END LOOP;
 PERFORM pg_temp.assert_true(public.leave_admin_setup_v1('rota',1,100)->'rows' @> '[{"id":"73000000-0000-0000-0000-000000000090","version":2,"timezone":"Asia/Jakarta"}]','timezone/Sunday denial leaves source revision unchanged');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''save_calendar_version'',%L)',gen_random_uuid(),(p||'{"effective_from":"2000-01-01","expected_version":2}'::jsonb)::text),'55000');
 PERFORM pg_temp.assert_denied($s$SELECT public.leave_roster_preview_v1('73000000-0000-0000-0000-000000000090','2099-10-05','[{"id":"74000000-0000-0000-0000-000000000091","on_anchor":true}]','2099-10-03','2099-11-01')$s$,'22023');
 PERFORM pg_temp.assert_denied($s$SELECT public.leave_roster_preview_v1('73000000-0000-0000-0000-000000000090','2099-10-03','[{"id":"74000000-0000-0000-0000-000000000091","on_anchor":true}]','2099-10-03','2101-01-01')$s$,'22023');
 v_preview:=public.leave_roster_preview_v1(v_calendar,'2099-10-03','[{"id":"74000000-0000-0000-0000-000000000091","on_anchor":true},{"id":"74000000-0000-0000-0000-000000000092","on_anchor":false}]','2099-10-03','2099-10-24');
 PERFORM pg_temp.assert_true(v_preview->'rows' @> '[{"date":"2099-10-03","groupId":"74000000-0000-0000-0000-000000000091","capacityMinutes":225},{"date":"2099-10-03","groupId":"74000000-0000-0000-0000-000000000092","capacityMinutes":0}]','read-only preview computes explicit opposite parity');
 PERFORM pg_temp.assert_true(public.leave_admin_setup_v1('rota',1,100)->'rows' @> '[{"id":"73000000-0000-0000-0000-000000000090","version":2}]','preview does not publish or advance revision');
 p:=jsonb_build_object('calendar_id',v_calendar,'anchor','2099-10-03','groups','[{"id":"74000000-0000-0000-0000-000000000091","on_anchor":true},{"id":"74000000-0000-0000-0000-000000000092","on_anchor":false}]'::jsonb,'effective_from','2099-10-03','effective_until','2099-10-24','expected_version',2,'preview_fingerprint',v_preview->>'fingerprint','reason','Fictional publication');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000005','publish_roster',p)->>'version'='3','publication is a separate command');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000005','publish_roster',p)->>'version'='3','publication retry does not duplicate rows');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''publish_roster'',%L)',gen_random_uuid(),p::text),'55000');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''publish_roster'',%L)',gen_random_uuid(),(p||'{"expected_version":3,"preview_fingerprint":"forged"}'::jsonb)::text),'55000');
 p:='{"employee_id":"71000000-0000-0000-0000-000000000002","group_id":"74000000-0000-0000-0000-000000000091","effective_from":"2099-10-01","effective_until":"2099-11-01","replace_membership_id":null,"expected_version":2,"reason":"Fictional group"}';
 v_result:=public.leave_transaction_v1('78000000-0000-0000-0000-000000000006','set_group_membership',p);v_membership:=(v_result->>'id')::uuid;
 PERFORM pg_temp.assert_true(v_result->>'version'='3','membership increments member token');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_group_membership'',%L)',gen_random_uuid(),(p||'{"expected_version":3,"effective_from":"2099-10-10"}'::jsonb)::text),'55000');
 p:=p||jsonb_build_object('group_id','74000000-0000-0000-0000-000000000092','effective_from','2099-10-17','replace_membership_id',v_membership,'expected_version',3);
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000007','set_group_membership',p)->>'version'='4','explicit Saturday transfer closes predecessor at boundary');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000008','set_member','{"employee_id":"71000000-0000-0000-0000-000000000005","member_kind":"manager","active":true,"employment_start":"2026-01-01","eligibility_date":"2026-06-01","calendar_id":"73000000-0000-0000-0000-000000000090","expected_version":1,"reason":"Fictional independent activation"}')->>'version'='2','another admin may activate membership');
 PERFORM pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('78000000-0000-0000-0000-000000000009','set_member','{"employee_id":"71000000-0000-0000-0000-000000000004","member_kind":"employee","active":true,"employment_start":null,"eligibility_date":null,"calendar_id":null,"expected_version":1,"reason":"Fictional director relabel"}')$s$,'22023');
 p:='{"employee_id":"71000000-0000-0000-0000-000000000002","approver_id":"71000000-0000-0000-0000-000000000005","effective_from":"2099-10-03","effective_until":null,"replace_assignment_id":null,"expected_version":4,"reason":"Fictional own appointment"}';
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
 SELECT value INTO v_before FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000002';
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),p::text),'42501');
 SELECT value INTO v_after FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000002';
 PERFORM pg_temp.assert_true(v_before=v_after AND public.leave_context_v1()->'capabilities'->>'approve'='false','own appointment denied without state/scope change');
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
 p:=p||'{"approver_id":"71000000-0000-0000-0000-000000000003","reason":"Fictional independent approver"}'::jsonb;
 v_result:=public.leave_transaction_v1('78000000-0000-0000-0000-000000000010','set_approver',p);v_assignment:=(v_result->>'id')::uuid;
 PERFORM pg_temp.assert_true(v_result->>'version'='5','explicit valid one-step route');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),(p||'{"expected_version":5,"effective_from":"2099-10-10"}'::jsonb)::text),'55000');
 p:=p||jsonb_build_object('approver_id','71000000-0000-0000-0000-000000000005','effective_from','2099-10-10','replace_assignment_id',v_assignment,'expected_version',5);
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
 SELECT value INTO v_before FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000005';
 PERFORM pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('78000000-0000-0000-0000-000000000015','set_group_membership','{"employee_id":"71000000-0000-0000-0000-000000000005","group_id":"74000000-0000-0000-0000-000000000091","effective_from":"2099-10-01","effective_until":"2099-11-01","replace_membership_id":null,"expected_version":2,"reason":"Fictional own effective group edit"}')$s$,'42501');
 SELECT value INTO v_after FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000005';
 PERFORM pg_temp.assert_true(v_before=v_after,'own effective group edit leaves memberships and member version unchanged');
 SELECT value INTO v_before FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000002';
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),p::text),'42501');
 SELECT value INTO v_after FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000002';
 PERFORM pg_temp.assert_true(v_before=v_after,'own replacement leaves predecessor interval intact');
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
 v_result:=public.leave_transaction_v1('78000000-0000-0000-0000-000000000011','set_approver',p);v_new_assignment:=(v_result->>'id')::uuid;
 PERFORM pg_temp.assert_true(v_result->>'version'='6','independent admin may assign configuring manager');
 SELECT value INTO v_after FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000002';
 PERFORM pg_temp.assert_true((v_after->'assignments'->1->>'effectiveFrom')::timestamptz='2099-10-09 17:00Z'::timestamptz,'assignment boundary uses fixed Jakarta lineage timezone');
 PERFORM pg_temp.assert_true(v_after->'assignments'->0->>'effectiveUntil'=v_after->'assignments'->1->>'effectiveFrom','[from,to) replacement boundary exact');
 -- Revocation shape validation, wrong employee/ID, self revocation and stale member version.
 p:=jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000002','approver_id',NULL,'effective_from',NULL,'effective_until',NULL,'replace_assignment_id',v_new_assignment,'expected_version',6,'reason','Fictional explicit revoke');
 FOREACH v_variant IN ARRAY ARRAY['{"effective_from":"2099-10-17"}'::jsonb,'{"effective_until":"2099-10-20"}'::jsonb,'{"replace_assignment_id":null}'::jsonb,'{"approver_id":"71000000-0000-0000-0000-000000000003"}'::jsonb] LOOP
  PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),(p||v_variant)::text),'22023');
 END LOOP;
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),(p||'{"expected_version":5}'::jsonb)::text),'55000');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),(p||'{"employee_id":"71000000-0000-0000-0000-000000000001","expected_version":1}'::jsonb)::text),'55000');
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),p::text),'42501');
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
 -- Later null source keeps fixed lineage timezone, but its selected dates will block calculation.
 p:='{"calendar_id":"73000000-0000-0000-0000-000000000090","name":"Fictional later unconfirmed source","effective_from":"2099-12-01","effective_until":null,"timezone":null,"holidays_confirmed":true,"sunday_minutes":null,"holidays":[],"groups":[],"expected_version":3,"reason":"Fictional null overlay"}';
 p:=p||jsonb_build_object('preview_fingerprint',public.leave_calendar_preview_v1(p-'reason'-'preview_fingerprint')->>'fingerprint');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000012','save_calendar_version',p)->>'version'='4','null draft preserves lineage confirmation');
 p:=p||'{"effective_from":"2100-01-01","timezone":"Asia/Jakarta","expected_version":4}'::jsonb;
 p:=p||jsonb_build_object('preview_fingerprint',public.leave_calendar_preview_v1(p-'reason'-'preview_fingerprint')->>'fingerprint');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000013','save_calendar_version',p)->>'version'='5','new confirmed source still leaves Sunday unset');
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
 PERFORM pg_temp.assert_true(public.leave_context_v1()->>'timezone'='Asia/Jakarta','unrelated future source cannot change lineage zone');
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- OWNER-ONLY deterministic calculations using sources created by real public commands above.
DO $$ DECLARE e uuid:='71000000-0000-0000-0000-000000000002';BEGIN
 IF private.ihr_working_day_v1(e,'2099-10-03')->>'capacity_minutes' IS DISTINCT FROM '225' THEN RAISE EXCEPTION 'Published explicit duty row';END IF;
 IF private.ihr_working_day_v1(e,'2099-10-10')->>'exclusion' IS DISTINCT FROM 'off_duty' THEN RAISE EXCEPTION 'Explicit off row';END IF;
 IF private.ihr_working_day_v1(e,'2099-10-17')->>'capacity_minutes' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'Effective transfer boundary';END IF;
 IF private.ihr_working_day_v1(e,'2099-10-05')->>'capacity_minutes' IS DISTINCT FROM '450' THEN RAISE EXCEPTION 'Confirmed same-start weekday';END IF;
 IF private.ihr_working_day_v1(e,'2099-10-06')->>'exclusion' IS DISTINCT FROM 'holiday' THEN RAISE EXCEPTION 'Confirmed holiday source';END IF;
 IF private.ihr_working_day_v1(e,'2099-10-04')->>'capacity_minutes' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'Explicit Sunday zero';END IF;
 IF private.ihr_working_day_v1(e,'2099-12-07')->>'error' IS DISTINCT FROM 'TIMEZONE_UNCONFIRMED' THEN RAISE EXCEPTION 'Selected null source fails closed';END IF;
 IF private.ihr_working_day_v1(e,'2100-01-03')->>'error' IS DISTINCT FROM 'SUNDAY_UNCONFIGURED' THEN RAISE EXCEPTION 'Missing Sunday remains unconfigured';END IF;
END $$;
-- Independently controlled fictional endpoint deactivation; revocation must remain possible.
UPDATE public.users SET is_active=false WHERE id IN('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000005');
UPDATE public.ihr_leave_members SET active=false,active_calendar_id=NULL,timezone=NULL WHERE user_id IN('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000005');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
DO $$ DECLARE m jsonb;a jsonb;p jsonb;r jsonb;BEGIN
 SELECT value INTO m FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000002';
 SELECT value INTO a FROM jsonb_array_elements(m->'assignments') WHERE value->>'approverId'='71000000-0000-0000-0000-000000000005';
 p:=jsonb_build_object('employee_id',m->>'id','approver_id',NULL,'effective_from',NULL,'effective_until',NULL,'replace_assignment_id',a->>'id','expected_version',(m->>'version')::bigint,'reason','Fictional inactive endpoint revocation');
 r:=public.leave_transaction_v1('78000000-0000-0000-0000-000000000014','set_approver',p);
 PERFORM pg_temp.assert_true((r->>'version')::bigint=(m->>'version')::bigint+1,'revocation works with inactive endpoints and no timezone');
 PERFORM pg_temp.assert_true(public.leave_transaction_v1('78000000-0000-0000-0000-000000000014','set_approver',p)=r,'revocation replay is idempotent');
 PERFORM pg_temp.assert_true(public.leave_reconcile_request_v1('78000000-0000-0000-0000-000000000014',false)=jsonb_build_object('state','committed','result',r),'revocation recovery uses existing envelope');
 SELECT value INTO m FROM jsonb_array_elements(public.leave_admin_setup_v1('members',1,100)->'rows') WHERE value->>'id'='71000000-0000-0000-0000-000000000002';
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m->'assignments') x WHERE x->>'id'=a->>'id'),'revoked assignment no longer active in setup list');
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),(p||jsonb_build_object('expected_version',(m->>'version')::bigint))::text),'55000');
 p:=p||jsonb_build_object('approver_id','71000000-0000-0000-0000-000000000003','effective_from','2099-10-17','replace_assignment_id',NULL,'expected_version',(m->>'version')::bigint);
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),p::text),'22023');
END $$;
RESET ROLE;
ROLLBACK;
