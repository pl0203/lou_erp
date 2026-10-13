-- Fictional UUID fixtures only; run through unchanged coordinator-owned guarded runner.
BEGIN;
\ir quote-seed.sql
CREATE FUNCTION pg_temp.reads_request(n integer,employee integer,state text,day_offset integer,minutes integer DEFAULT 450,capacity integer DEFAULT 450) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE target uuid:=('71000000-0000-0000-0000-'||lpad(employee::text,12,'0'))::uuid;
 request_id uuid:=('81000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
 assignment public.ihr_leave_approvers%ROWTYPE;account uuid;
BEGIN
 SELECT * INTO assignment FROM public.ihr_leave_approvers a WHERE a.employee_id=target AND a.revoked_at IS NULL ORDER BY a.version DESC LIMIT 1;
 -- Unrelated employee fixture deliberately points to a different employee's assignment.
 IF assignment.id IS NULL THEN SELECT * INTO assignment FROM public.ihr_leave_approvers a WHERE a.employee_id='71000000-0000-0000-0000-000000000001' LIMIT 1;END IF;
 INSERT INTO public.ihr_leave_requests(id,employee_id,status,start_date,end_date,duration,total_minutes,reason,approver_id,approver_name,
 assignment_id,assignment_version,policy_id,policy_version,member_version,source_snapshot,source_kind,source_id,submitted_at,created_by)
 SELECT request_id,target,state,pg_temp.quote_friday()+day_offset,pg_temp.quote_friday()+day_offset,'{"mode":"fixed_minutes","minutes":60}',minutes,
 'Never project fictional private reason',assignment.approver_id,'Never project fictional decision actor',assignment.id,assignment.version,
 '79000000-0000-0000-0000-000000000001',1,m.version,'{}','submission',request_id,statement_timestamp(),target
 FROM public.ihr_leave_members m WHERE m.user_id=target;
 SELECT id INTO account FROM public.ihr_leave_accounts a WHERE a.employee_id='71000000-0000-0000-0000-000000000001' ORDER BY a.year LIMIT 1;
 INSERT INTO public.ihr_leave_request_days(request_id,day,scheduled_minutes,charged_minutes,account_id,source_snapshot)
 VALUES(request_id,pg_temp.quote_friday()+day_offset,capacity,minutes,account,'{}');
 RETURN request_id;
END;
$$;
SELECT pg_temp.reads_request(1,1,'approved',0);
SELECT pg_temp.reads_request(2,1,'approved',1,60,225);
SELECT pg_temp.reads_request(3,1,'cancellation_pending',15,225,225);
SELECT pg_temp.reads_request(4,3,'approved',3);
SELECT pg_temp.reads_request(5,1,'cancelled',4);
SELECT pg_temp.reads_request(6,1,'rejected',5);
SELECT pg_temp.reads_request(7,1,'withdrawn',6);
SELECT pg_temp.reads_request(8,1,'submitted',7);
SELECT pg_temp.reads_request(9,18,'submitted',8);
SELECT pg_temp.reads_request(10,2,'approved',9);
SELECT pg_temp.reads_request(11,7,'approved',10);
-- An explicitly unconfirmed synthetic target blocks automatic broad defaults, not manual bounded reads.
UPDATE public.ihr_leave_members SET active_calendar_id=NULL WHERE user_id='71000000-0000-0000-0000-000000000018';
SELECT pg_temp.reads_request(100+n,1,'submitted',10+n) FROM generate_series(1,30) n;
SELECT pg_temp.reads_request(200,3,'submitted',50);
-- Match the canonical pending cancellation assignment; synthetic private rows remain inaccessible.
INSERT INTO private.ihr_leave_cancellation_attempts(id,request_id,attempt_number,requested_by,requested_at,reason,
 approver_id,approver_name,assignment_id,assignment_version,policy_id,policy_version,source_snapshot)
SELECT '81000000-0000-0000-0000-000000000301',r.id,1,r.employee_id,statement_timestamp(),'Never project fictional cancellation reason',
 r.approver_id,r.approver_name,r.assignment_id,r.assignment_version,r.policy_id,r.policy_version,jsonb_build_object('assignment',to_jsonb(a))
FROM public.ihr_leave_requests r JOIN public.ihr_leave_approvers a ON a.id=r.assignment_id
WHERE r.id='81000000-0000-0000-0000-000000000003';
-- Explicit synthetic assigned-team and broader grants; no production setup implied.
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason) VALUES
 ('71000000-0000-0000-0000-000000000003','calendar','employee','71000000-0000-0000-0000-000000000001','2000-01-01','71000000-0000-0000-0000-000000000006','Fictional assigned calendar grant'),
 ('71000000-0000-0000-0000-000000000012','calendar','all_policy_members',NULL,'2000-01-01','71000000-0000-0000-0000-000000000006','Fictional broad calendar grant');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,current_date)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_approval_counts_v1()$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92) own_calendar \gset
SELECT pg_temp.assert_true(jsonb_array_length(:'own_calendar'::jsonb)=3,'only approved and cancellation pending own days');
SELECT pg_temp.assert_true((SELECT bool_and((SELECT array_agg(name ORDER BY name) FROM jsonb_object_keys(item.value) key(name))=ARRAY['approvedMinutes','availabilityLabel','date','employeeId','employeeName']) FROM jsonb_array_elements(:'own_calendar'::jsonb) item(value)),'exact five availability fields');
SELECT pg_temp.assert_true(:'own_calendar'::jsonb->0->>'approvedMinutes'='450' AND :'own_calendar'::jsonb->0->>'availabilityLabel'='full_scheduled_absence','full label original frozen capacity');
SELECT pg_temp.assert_true(:'own_calendar'::jsonb->1->>'approvedMinutes'='60' AND :'own_calendar'::jsonb->1->>'availabilityLabel'='partial_absence','partial scheduled Saturday records no clock time');
SELECT pg_temp.assert_true(:'own_calendar'::jsonb->2->>'approvedMinutes'='225','cancellation pending retains approved availability');
SELECT pg_temp.assert_true(public.leave_calendar_v1(pg_temp.quote_friday()+90,pg_temp.quote_friday()+92)='[]'::jsonb,'empty authorized range');
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+93)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(pg_temp.quote_friday()+1,pg_temp.quote_friday())$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(NULL,current_date)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1('-infinity','infinity')$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,current_date,'81000000-0000-0000-0000-000000000009')$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,current_date,'granted')$s$,'42501');
SELECT pg_temp.assert_true(public.leave_approval_counts_v1()=jsonb_build_object('pendingLeave',0,'pendingCancellation',0),'no self or peer counts');
SELECT pg_temp.assert_denied($s$SELECT private.ihr_leave_calendar_can_read('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','own')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team'))=4,'assigned calendar is narrowed to currently explicitly assigned active employees');
SELECT pg_temp.assert_true(public.leave_approval_counts_v1()->>'pendingLeave'='31','full count exceeds inbox page size');
SELECT pg_temp.assert_true(public.leave_approval_counts_v1()->>'pendingCancellation'='1','full cancellation count shares canonical pending attempt assignment');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_assigned_inbox_v1(NULL,25)->'rows')=25,'inbox is bounded independently of count');
SELECT pg_temp.assert_true(public.leave_approval_counts_v1()->>'pendingLeave'='31','pagination does not alter full count');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_approval_counts_v1()->>'pendingLeave'='1','director counts only explicitly assigned manager');
SELECT pg_temp.assert_true(public.leave_reads_context_v1()->'calendarAudiences'=jsonb_build_array('assigned_team'),'director has only minimum assigned-manager calendar context');
SELECT pg_temp.assert_true(public.leave_reads_context_v1()->'defaultRange' IS NOT NULL AND public.leave_reads_context_v1()->'defaultRange'<> 'null'::jsonb,'director default month derives from assigned manager confirmed calendar');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team'))=1,'director calendar contains only assigned manager approved absence');
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,current_date,'own')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,current_date,'granted')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000012',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'granted'))=5,'explicit broad calendar grant includes only approved active policy members');
SELECT pg_temp.assert_true(public.leave_approval_counts_v1()->>'pendingLeave'='0','calendar grant does not grant approvals or private counts');
SELECT pg_temp.assert_true(public.leave_reads_context_v1()->'defaultRange'='null'::jsonb,'broad audience with unconfirmed target calendar has no guessed default month');
SELECT pg_temp.assert_true(public.leave_reads_context_v1('granted')->>'defaultRangeState'='timezone_unconfirmed','unconfirmed default has explicit state');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_calendar_v1(current_date,current_date,'granted')$s$,'42501');
SELECT pg_temp.assert_true(public.leave_approval_counts_v1()->>'pendingLeave'='0','configure alone does not grant approval counts');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_reads_context_v1()$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_approval_counts_v1()$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Two confirmed lineages are distinct; never pick one arbitrarily for an assigned audience.
INSERT INTO private.ihr_leave_calendar_registry(id,version) VALUES('73000000-0000-0000-0000-000000000092',1);
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
VALUES('73000000-0000-0000-0000-000000000093','73000000-0000-0000-0000-000000000092',1,'Fictional second timezone','2020-01-01','2040-01-01','Etc/UTC',true,0,'71000000-0000-0000-0000-000000000006');
UPDATE public.ihr_leave_members SET active_calendar_id='73000000-0000-0000-0000-000000000092' WHERE user_id='71000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_reads_context_v1('assigned_team')->>'defaultRangeState'='timezone_mixed' AND public.leave_reads_context_v1('assigned_team')->'defaultRange'='null'::jsonb,'mixed assigned lineages have explicit unavailable automatic month');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team'))=4,'manual bounded dates remain readable with mixed lineage timezones');
SELECT pg_temp.assert_true(public.leave_reads_context_v1('own')->>'defaultRangeState'='ready','own audience remains independent of mixed assigned default');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
\ir calendar-authorization-boundaries.sql
UPDATE public.ihr_leave_approvers SET revoked_at=statement_timestamp(),revoked_by='71000000-0000-0000-0000-000000000005' WHERE employee_id='71000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.leave_approval_counts_v1()=jsonb_build_object('pendingLeave',0,'pendingCancellation',0),'removed assignment revokes all corresponding full counts');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_assigned_inbox_v1()->'rows')=0,'removed assignment revokes inbox consistently');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_calendar_v1(pg_temp.quote_friday(),pg_temp.quote_friday()+92,'assigned_team'))=1,'removed assignment no longer appears while separately assigned employee remains');
RESET ROLE;
ROLLBACK;
\echo IHR_LEAVE_READS_PRIVACY_AND_COUNTS_PASSED
