-- Fictional fixtures only. Run inside a disposable database transaction and roll back.
BEGIN;
\ir quote-seed.sql
CREATE FUNCTION pg_temp.week_start() RETURNS date LANGUAGE sql STABLE AS $$ SELECT pg_temp.quote_friday()-4 $$;
UPDATE public.users SET full_name=CASE right(id::text,2)::int
 WHEN 1 THEN 'Zulu Pending' WHEN 8 THEN 'Alpha Peer' WHEN 5 THEN 'No Leave Setup' ELSE full_name END,
 manager_id=CASE WHEN right(id::text,2)::int IN(1,5,8,18) THEN '71000000-0000-0000-0000-000000000003'::uuid
 WHEN right(id::text,2)::int IN(11,12) THEN '71000000-0000-0000-0000-000000000010'::uuid ELSE NULL END;
UPDATE public.users SET role='sales_manager' WHERE id='71000000-0000-0000-0000-000000000010';
UPDATE public.users SET role='co_admin' WHERE id='71000000-0000-0000-0000-000000000013';
CREATE FUNCTION pg_temp.week_request(n integer,employee integer,state text,day_offset integer,minutes integer DEFAULT 450,capacity integer DEFAULT 450) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE target uuid:=('71000000-0000-0000-0000-'||lpad(employee::text,12,'0'))::uuid;
 request_id uuid:=('82000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
 assignment public.ihr_leave_approvers%ROWTYPE;account uuid;
BEGIN
 SELECT * INTO assignment FROM public.ihr_leave_approvers a WHERE a.employee_id=target AND a.revoked_at IS NULL ORDER BY a.id LIMIT 1;
 IF assignment.id IS NULL THEN SELECT * INTO assignment FROM public.ihr_leave_approvers a WHERE a.employee_id='71000000-0000-0000-0000-000000000001' LIMIT 1; END IF;
 SELECT id INTO account FROM public.ihr_leave_accounts a WHERE a.employee_id='71000000-0000-0000-0000-000000000001' ORDER BY a.year LIMIT 1;
 INSERT INTO public.ihr_leave_requests(id,employee_id,status,start_date,end_date,duration,total_minutes,reason,approver_id,approver_name,
 assignment_id,assignment_version,policy_id,policy_version,member_version,source_snapshot,source_kind,source_id,submitted_at,created_by)
 SELECT request_id,target,state,pg_temp.week_start()+day_offset,pg_temp.week_start()+day_offset,'{"mode":"full_scheduled_day"}',minutes,
 'NEVER_PROJECT_PRIVATE_REASON',assignment.approver_id,'NEVER_PROJECT_APPROVER_NAME',assignment.id,assignment.version,
 '79000000-0000-0000-0000-000000000001',1,m.version,'{}','submission',request_id,statement_timestamp(),target
 FROM public.ihr_leave_members m WHERE m.user_id=target;
 INSERT INTO public.ihr_leave_request_days(request_id,day,scheduled_minutes,charged_minutes,account_id,source_snapshot)
 VALUES(request_id,pg_temp.week_start()+day_offset,capacity,minutes,account,'{}');
 RETURN request_id;
END;
$$;
SELECT pg_temp.week_request(1,1,'submitted',0);
SELECT pg_temp.week_request(2,8,'approved',1,60);
SELECT pg_temp.week_request(3,1,'cancellation_pending',2,120);
SELECT pg_temp.week_request(4,8,'submitted',10);
SELECT pg_temp.week_request(5,1,'withdrawn',3);
SELECT pg_temp.week_request(6,1,'cancelled',4);
SELECT pg_temp.week_request(7,1,'rejected',5,60,225);
INSERT INTO private.ihr_leave_cancellation_attempts(id,request_id,attempt_number,requested_by,requested_at,reason,
 approver_id,approver_name,assignment_id,assignment_version,policy_id,policy_version,source_snapshot)
SELECT '82000000-0000-0000-0000-000000000301',r.id,1,r.employee_id,statement_timestamp(),'NEVER_PROJECT_CANCELLATION_REASON',
 r.approver_id,r.approver_name,r.assignment_id,r.assignment_version,r.policy_id,r.policy_version,jsonb_build_object('assignment',to_jsonb(a))
FROM public.ihr_leave_requests r JOIN public.ihr_leave_approvers a ON a.id=r.assignment_id WHERE r.id='82000000-0000-0000-0000-000000000003';
DO $$ DECLARE ns text;BEGIN SELECT nspname INTO ns FROM pg_namespace WHERE oid=pg_my_temp_schema();
 EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO authenticated,anon',ns);END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
-- RED before implementation: named API is absent, not an assertion against a mock.
SELECT pg_temp.assert_true(to_regprocedure('public.leave_team_calendar_v1(date,text,text,integer,integer)') IS NOT NULL,'weekly roster API exists');
SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,100) peer_week \gset
SELECT pg_temp.assert_true(:'peer_week'::jsonb->>'total'='4','peer roster includes self, same-manager peers and no-leave/unconfigured staff');
SELECT pg_temp.assert_true(:'peer_week'::jsonb->'rows'->0->>'employeeName'='Alpha Peer','other employee pending does not pin or reorder peer roster');
SELECT pg_temp.assert_true(NOT (:'peer_week' LIKE '%submitted%' OR :'peer_week' LIKE '%cancellation_pending%' OR :'peer_week' LIKE '%NEVER_PROJECT%'),'peer status and private fields do not leak');
SELECT pg_temp.assert_true((SELECT value->'days'->0->'absence'='null'::jsonb FROM jsonb_array_elements(:'peer_week'::jsonb->'rows') WHERE value->>'employeeId'='71000000-0000-0000-0000-000000000001'),'peer submitted cell absent');
SELECT pg_temp.assert_true((SELECT value->'days'->2->'absence'->>'status'='approved' FROM jsonb_array_elements(:'peer_week'::jsonb->'rows') WHERE value->>'employeeId'='71000000-0000-0000-0000-000000000001'),'pending cancellation remains approved availability to peers');
SELECT pg_temp.assert_true((SELECT bool_and(jsonb_array_length(value->'days')=7) FROM jsonb_array_elements(:'peer_week'::jsonb->'rows')),'every roster row has seven days');
SELECT pg_temp.assert_true((SELECT value->'days'->0->>'schedule'='unconfigured' AND value->'days'->0->'scheduledMinutes'='null'::jsonb FROM jsonb_array_elements(:'peer_week'::jsonb->'rows') WHERE value->>'employeeId'='71000000-0000-0000-0000-000000000005'),'staff without leave setup have no invented schedule');
SELECT pg_temp.assert_true((SELECT value->'days'->1->'absence'='{"status":"approved","minutes":60,"availabilityLabel":"partial_absence"}'::jsonb FROM jsonb_array_elements(:'peer_week'::jsonb->'rows') WHERE value->>'employeeId'='71000000-0000-0000-0000-000000000008'),'exact partial minutes without fabricated clock times');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,1) manager_week \gset
SELECT pg_temp.assert_true(:'manager_week'::jsonb->>'total'='6' AND :'manager_week'::jsonb->'rows'->0->>'employeeName'='Zulu Pending','authorized pending pins before server pagination');
SELECT pg_temp.assert_true(:'manager_week'::jsonb->'rows'->0->'days'->0->'absence'->>'status'='submitted','assigned request pending visible');
SELECT pg_temp.assert_true(:'manager_week'::jsonb->'rows'->0->'days'->2->'absence'->>'status'='cancellation_pending','assigned cancellation visible');
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start()+7,'week','sales_team',1,1)->'rows'->0->>'employeeName'='Alpha Peer','pending pin applies only to selected week');
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',100,100)->'rows'='[]'::jsonb,'out-of-range page stays empty with correct total');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1(pg_temp.week_start()+1,'week','sales_team',1,20)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',0,20)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,101)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_all',1,20)$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000012',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','granted',1,100)->'rows'->0->'days'->0->'absence'='null'::jsonb,'calendar-only grant does not reveal submitted request');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','director_all',1,100) director_week \gset
SELECT pg_temp.assert_true(:'director_week'::jsonb->>'total'='17','Director sees all active staff including honest unconfigured Director rows');
SELECT pg_temp.assert_true(NOT (public.leave_team_calendar_context_v1()->'calendarAudiences' ? 'own'),'Director has no own personal-leave audience');
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1()->>'defaultDateState'='ready' AND public.leave_team_calendar_context_v1()->>'defaultDate'=to_char(statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati','YYYY-MM-DD'),'unconfigured Director rows do not block unique confirmed employee timezone');
SELECT pg_temp.assert_true(:'director_week'::jsonb->'rows'->0->>'employeeName'='Zulu Pending','Director sees pending without gaining write-approval authority');
SELECT pg_temp.assert_true(public.leave_approval_counts_v1()->>'pendingLeave'='0','new calendar never expands Director approval inbox');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000014',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','director_all',1,100)$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000016',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1()->'calendarAudiences'->>0='sales_all','Sales Head defaults to all-sales scope');
SELECT pg_temp.assert_true(NOT (public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_all',1,100)::text LIKE '%cancellation_pending%'),'Sales Head org view is not request approval authority');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_context_v1()$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Independent local changes exercise revocation and current organization, not cached API mocks.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
SELECT public.leave_team_calendar_context_v1()->>'scopeVersion' before_transfer \gset
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1('own')->>'defaultDateState'='ready','own confirmed calendar supplies company-local default week');
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1('own')->>'defaultDate'=to_char(statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati','YYYY-MM-DD'),'default date uses authoritative calendar timezone not conflicting member or session timezone');
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1('sales_team')->>'defaultDateState'='ready','unconfigured rows do not override unique confirmed authorized timezone');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.leave_team_calendar_context_v1(text)','EXECUTE') AND NOT has_function_privilege('service_role','public.leave_team_calendar_v1(date,text,text,integer,integer)','EXECUTE'),'new endpoint execute limited to authenticated');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','private.ihr_leave_weekly_roster(uuid,text,timestamp with time zone)','EXECUTE'),'private scope helper not directly callable');
SELECT pg_temp.assert_denied($s$SELECT * FROM public.ihr_leave_requests$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT * FROM public.ihr_leave_members$s$,'42501');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET manager_id='71000000-0000-0000-0000-000000000010' WHERE id='71000000-0000-0000-0000-000000000008'$s$,'42501');
SELECT pg_temp.assert_true((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(:'peer_week'::jsonb) key)=ARRAY['page','pageSize','periodEnd','periodStart','rows','scopeVersion','total','view'],'exact top-level projection excludes pending counts');
SELECT pg_temp.assert_true((SELECT bool_and((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(row) key)=ARRAY['days','employeeId','employeeName']) FROM jsonb_array_elements(:'peer_week'::jsonb->'rows') row),'exact employee projection excludes request identifiers and managers');
SELECT pg_temp.assert_true((SELECT bool_and((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(cell) key)=ARRAY['absence','date','schedule','scheduledMinutes']) FROM jsonb_array_elements(:'peer_week'::jsonb->'rows') row CROSS JOIN LATERAL jsonb_array_elements(row->'days') cell),'exact cell projection excludes source snapshots');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET manager_id='71000000-0000-0000-0000-000000000010' WHERE id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1()->>'scopeVersion'<>:'before_transfer','manager transfer changes authority token');
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,100)->>'total'='3','old peers lose transferred employee immediately');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000010',true);
SELECT pg_temp.assert_true(NOT (public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,100)::text LIKE '%submitted%'),'new line manager does not gain request approval visibility');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','assigned_team',1,100)::text LIKE '%submitted%','unchanged explicit request assignment survives organization transfer');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET manager_id='71000000-0000-0000-0000-000000000003' WHERE id='71000000-0000-0000-0000-000000000001';
UPDATE public.ihr_leave_approvers SET revoked_at=statement_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE employee_id='71000000-0000-0000-0000-000000000001';
INSERT INTO public.ihr_leave_members(user_id,member_kind,active) VALUES('71000000-0000-0000-0000-000000000010','manager',true);
INSERT INTO public.ihr_leave_approvers(id,employee_id,approver_id,effective_from,assigned_by)
VALUES('82000000-0000-0000-0000-000000000401','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000010','2000-01-01','71000000-0000-0000-0000-000000000006');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(NOT (public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,100)::text LIKE '%submitted%' OR public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,100)::text LIKE '%cancellation_pending%'),'revoked request approver loses both pending channels even while line manager');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000010',true);
SELECT pg_temp.assert_true(NOT (public.leave_team_calendar_v1(pg_temp.week_start(),'week','assigned_team',1,100)::text LIKE '%submitted%' OR public.leave_team_calendar_v1(pg_temp.week_start(),'week','assigned_team',1,100)::text LIKE '%cancellation_pending%'),'new general assignment does not own earlier request or cancellation attempt');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Canonical append-only cancellation reassignment is attempt-specific; submitted request is untouched.
INSERT INTO private.ihr_leave_request_reassignments(request_id,request_version,assignment_source,created_by,reason)
SELECT '82000000-0000-0000-0000-000000000003',2,to_jsonb(a)||jsonb_build_object('cancellation_attempt_id','82000000-0000-0000-0000-000000000301','approver_name','Fictional replacement'),
 '71000000-0000-0000-0000-000000000006','Synthetic explicit cancellation reassignment' FROM public.ihr_leave_approvers a WHERE id='82000000-0000-0000-0000-000000000401';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000010',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','assigned_team',1,100)::text LIKE '%cancellation_pending%' AND NOT (public.leave_team_calendar_v1(pg_temp.week_start(),'week','assigned_team',1,100)::text LIKE '%submitted%'),'exact cancellation ownership used independently from submitted ownership');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','own',1,100)->'rows'->0->'days'->0->'absence'->>'status'='submitted','owner still sees own pending after approver revocation');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,100)-'scopeVersion' before_withdrawal \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_requests SET status='withdrawn',version=version+1 WHERE id='82000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,100)-'scopeVersion'=:'before_withdrawal'::jsonb,'hidden pending withdrawal cannot change peer projection, order or counts');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','own',1,100)->'rows'->0->'days'->0->'absence'='null'::jsonb,'withdrawn own request disappears');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET active=false WHERE user_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((SELECT bool_and(d->'absence'='null'::jsonb AND d->>'schedule'='unconfigured') FROM jsonb_array_elements(public.leave_team_calendar_v1(pg_temp.week_start(),'week','director_all',1,100)->'rows') r CROSS JOIN LATERAL jsonb_array_elements(r->'days') d WHERE r->>'employeeId'='71000000-0000-0000-0000-000000000001'),'revoked leave membership hides all absence facts while active staff remains on roster');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1()->'calendarAudiences'->>0='admin_team','PO Admin defaults to shared admin calendar');
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','admin_team',1,100)->>'total'='3','admin role-defined team includes PO/CO without inventing reporting links');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000013',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','admin_team',1,100)->>'total'='3','CO Admin shares same minimal roster');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_context_v1()$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1(current_date,'week','own',1,20)$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Per-employee calendars and frozen charge facts remain independent.
INSERT INTO public.ihr_leave_calendar_exceptions(calendar_version_id,day,kind)
VALUES('73000000-0000-0000-0000-000000000091',pg_temp.week_start()+1,'holiday');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','own',1,100) holiday_week \gset
SELECT pg_temp.assert_true(:'holiday_week'::jsonb->'rows'->0->'days'->1->>'schedule'='holiday' AND :'holiday_week'::jsonb->'rows'->0->'days'->1->>'scheduledMinutes'='0','configured calendar holiday uses actual zero capacity');
SELECT pg_temp.assert_true(:'holiday_week'::jsonb->'rows'->0->'days'->1->'absence'->>'minutes'='60' AND :'holiday_week'::jsonb->'rows'->0->'days'->1->'absence'->>'availabilityLabel'='partial_absence','new holiday does not rewrite frozen request charge or partial label');
SELECT pg_temp.assert_true(:'holiday_week'::jsonb->'rows'->0->'days'->5->>'schedule'='unconfigured','Saturday without employee rota is not guessed off duty');
SELECT pg_temp.assert_true(:'holiday_week'::jsonb->'rows'->0->'days'->6->>'schedule'='off_duty','confirmed Sunday reflects resolver zero capacity');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','director_all',1,100)->>'scopeVersion' before_roster_insert \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id) VALUES('71000000-0000-0000-0000-000000000020'),('71000000-0000-0000-0000-000000000021');
INSERT INTO public.users(id,full_name,email,role,manager_id) VALUES
 ('71000000-0000-0000-0000-000000000020','Alpha Peer','weekly20@example.invalid','sales_person','71000000-0000-0000-0000-000000000003'),
 ('71000000-0000-0000-0000-000000000021','Alpha Peer','weekly21@example.invalid','sales_person','71000000-0000-0000-0000-000000000003');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','director_all',1,100)->>'scopeVersion'<>:'before_roster_insert','new active staff invalidates roster scope');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,1)->'rows'->0->>'employeeId'='71000000-0000-0000-0000-000000000008','duplicate names use stable ID first page');
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',2,1)->'rows'->0->>'employeeId'='71000000-0000-0000-0000-000000000020','duplicate names use stable ID second page');
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',3,1)->'rows'->0->>'employeeId'='71000000-0000-0000-0000-000000000021','duplicate names use stable ID third page');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1('-infinity','week','own',1,20)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1(NULL,'week','own',1,20)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_context_v1('guessed_employee_id')$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_context_v1('director_all')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1('2026-02-01','month','own',1,100)->>'periodEnd'='2026-02-28' AND jsonb_array_length(public.leave_team_calendar_v1('2026-02-01','month','own',1,100)->'rows'->0->'days')=28,'February common year has 28 exact dates');
SELECT pg_temp.assert_true(public.leave_team_calendar_v1('2028-02-01','month','own',1,100)->>'periodEnd'='2028-02-29' AND jsonb_array_length(public.leave_team_calendar_v1('2028-02-01','month','own',1,100)->'rows'->0->'days')=29,'leap February has 29 exact dates');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_team_calendar_v1('2026-04-01','month','own',1,100)->'rows'->0->'days')=30,'April has 30 exact dates');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_team_calendar_v1('2026-01-01','month','own',1,100)->'rows'->0->'days')=31,'January is bounded at 31 exact dates');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1('2026-01-02','month','own',1,20)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1('2026-01-01','year','own',1,20)$s$,'22023');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Multiple confirmed authorized timezones require an explicit date instead of an arbitrary default.
INSERT INTO private.ihr_leave_calendar_registry(id,version) VALUES('73000000-0000-0000-0000-000000000092',1);
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
VALUES('73000000-0000-0000-0000-000000000093','73000000-0000-0000-0000-000000000092',1,'Fictional second calendar','2020-01-01','2040-01-01','Asia/Makassar',true,0,'71000000-0000-0000-0000-000000000006');
UPDATE public.ihr_leave_members SET active_calendar_id='73000000-0000-0000-0000-000000000092' WHERE user_id='71000000-0000-0000-0000-000000000008';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1()->>'defaultDateState'='timezone_mixed' AND public.leave_team_calendar_context_v1()->'defaultDate'='null'::jsonb,'mixed known timezones fail closed to explicit date');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1()->>'defaultDateState'='timezone_unconfirmed' AND public.leave_team_calendar_context_v1()->'defaultDate'='null'::jsonb,'no confirmed authorized source requires explicit date');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000012',true);
SELECT public.leave_team_calendar_context_v1()->>'scopeVersion' before_grant_revoke \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_access_grants SET revoked_at=statement_timestamp(),revoked_by='71000000-0000-0000-0000-000000000006' WHERE actor_id='71000000-0000-0000-0000-000000000012' AND capability='calendar';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000012',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_context_v1()->>'scopeVersion'<>:'before_grant_revoke','calendar grant revocation invalidates old read authority');
SELECT pg_temp.assert_denied($s$SELECT public.leave_team_calendar_v1(pg_temp.week_start(),'week','granted',1,100)$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=false WHERE id='71000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000008',true);
SELECT pg_temp.assert_true(public.leave_team_calendar_v1(pg_temp.week_start(),'week','sales_team',1,100)->>'total'='1','inactive manager cannot join otherwise unrelated peers into a current team');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK;
\echo IHR_WEEKLY_CALENDAR_PASSED
