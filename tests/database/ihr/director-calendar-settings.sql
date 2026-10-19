-- FICTIONAL, rollback-only fixture. Load candidate and helpers inside one guarded local transaction.
\ir quote-seed.sql
\ir admin-governance-seed.sql
SELECT (statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date today, pg_temp.quote_friday()+8 boundary, pg_temp.quote_friday()+36 finishes \gset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))->>'fingerprint') request_payload \gset
SELECT public.leave_transaction_v1('86000000-0000-0000-0000-000000000001','submit_request',:'request_payload') request_receipt \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Existing broad configure authority remains supported independently of Director authority.
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,effective_from,granted_by,reason)
VALUES('71000000-0000-0000-0000-000000000006','configure','all_policy_members','2000-01-01','71000000-0000-0000-0000-000000000005','Synthetic global calendar operator');
CREATE TEMP TABLE frozen_request AS SELECT to_jsonb(r) request,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY day) FROM public.ihr_leave_request_days d WHERE d.request_id=r.id) days,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY account_id) FROM public.ihr_leave_request_allocations a WHERE a.request_id=r.id) allocations,
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.ihr_leave_ledger l) ledger
 FROM public.ihr_leave_requests r WHERE r.id=(:'request_receipt'::jsonb->>'id')::uuid;
UPDATE public.ihr_saturday_memberships SET effective_until=:'boundary'::date WHERE employee_id IN('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002');
CREATE TEMP TABLE frozen_member AS SELECT to_jsonb(m) original FROM public.ihr_leave_members m WHERE user_id='71000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE frozen_predecessors AS SELECT id,to_jsonb(s) original FROM public.ihr_saturday_memberships s;
GRANT SELECT ON frozen_request,frozen_predecessors TO authenticated;
-- No client role can invoke internal helper seams or read/write setup tables directly.
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,20)$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'calendarConfigure'='true','active executive plus active IHR director has calendar capability');
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'configure'='false' AND public.leave_context_v1()->'capabilities'->>'manageAccess'='false' AND public.leave_context_v1()->'capabilities'->>'request'='false','Director gains no generic setup, access or personal request capability');
SELECT pg_temp.assert_true(public.leave_admin_setup_v1('rota',1,20)->>'total'='1','Director can read calendar-only setup');
SELECT pg_temp.assert_true(public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090')->>'authorityKey' IS NOT NULL,'Director has source-bound rota context');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('people',1,20)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('members',1,20)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('approvers',1,20)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_settings_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_balance_accounts_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_access_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT private.ihr_leave_calendar_config('71000000-0000-0000-0000-000000000004')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT private.ihr_leave_can_continue_roster('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001','79000000-0000-0000-0000-000000000021',current_date+1,current_date+2,now())$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT * FROM public.ihr_saturday_memberships$s$,'42501');
SELECT pg_temp.assert_denied($s$INSERT INTO public.ihr_saturday_memberships DEFAULT VALUES$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_own_history_v1()$s$,'42501');
-- Valid unrelated commands must reach authorization denial, not just malformed-input rejection.
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('86000000-0000-0000-0000-000000000002','set_member','{"employee_id":"71000000-0000-0000-0000-000000000008","member_kind":"employee","active":true,"employment_start":null,"eligibility_date":null,"calendar_id":null,"expected_version":1,"reason":"Synthetic denied enrollment"}')$s$,'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_approver'',%L)',gen_random_uuid(),jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','approver_id','71000000-0000-0000-0000-000000000003','effective_from',:'boundary','effective_until',NULL,'replace_assignment_id',NULL,'expected_version',1,'reason','Synthetic forbidden approval route')::text),'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('86000000-0000-0000-0000-000000000003','adjust_balance','{"employee_id":"71000000-0000-0000-0000-000000000001","year":2026,"source_id":"86000000-0000-0000-0000-000000000004","delta_minutes":60,"expected_version":1,"reason":"Synthetic denied balance"}')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('86000000-0000-0000-0000-000000000005','grant_leave_access','{"manifest_id":"86000000-0000-0000-0000-000000000006","expected_version":0,"reason":"Synthetic denied grant"}')$s$,'42501');
-- Strict two-part identity, existing scoped grants and ordinary members cannot impersonate a calendar Director.
DO $$ DECLARE id uuid;BEGIN
 FOREACH id IN ARRAY ARRAY['71000000-0000-0000-0000-000000000001'::uuid,'71000000-0000-0000-0000-000000000003'::uuid,'71000000-0000-0000-0000-000000000005'::uuid,'71000000-0000-0000-0000-000000000014'::uuid,'71000000-0000-0000-0000-000000000017'::uuid] LOOP
  PERFORM set_config('request.jwt.claim.sub',id::text,true);
  PERFORM pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'calendarConfigure'='false','no implicit calendar admin from partial identity or scoped configure');
  PERFORM pg_temp.assert_denied($s$SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090')$s$,'42501');
  PERFORM pg_temp.assert_denied($s$SELECT public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,20)$s$,'42501');
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'calendarConfigure'='true' AND public.leave_admin_setup_v1('rota',1,20)->>'total'='1','existing global configure operator retains calendar access');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,20)->>'total'='0','unbounded or overlong source does not offer a continuation');
-- Publish a finite prospective source through real Director preview and command endpoints.
SELECT jsonb_build_object('calendar_id','73000000-0000-0000-0000-000000000090','name','Synthetic Director calendar','effective_from',:'boundary','effective_until',:'finishes','timezone','Pacific/Kiritimati','holidays_confirmed',true,'sunday_minutes',0,'holidays','[]'::jsonb,'groups','[]'::jsonb,'expected_version',1) proposal \gset
SELECT public.leave_calendar_preview_v1(:'proposal') calendar_preview \gset
SELECT (:'proposal'::jsonb||jsonb_build_object('reason','Synthetic prospective setup','preview_fingerprint',:'calendar_preview'::jsonb->>'fingerprint')) calendar_payload \gset
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''save_calendar_version'',%L)',gen_random_uuid(),(:'calendar_payload'::jsonb||'{"preview_fingerprint":"stale"}'::jsonb)::text),'55000');
SELECT public.leave_transaction_v1('86000000-0000-0000-0000-000000000010','save_calendar_version',:'calendar_payload') calendar_receipt \gset
SELECT pg_temp.assert_true(:'calendar_receipt'::jsonb->>'version'='2','Director publishes a new calendar source');
SELECT pg_temp.assert_true(public.leave_transaction_v1('86000000-0000-0000-0000-000000000010','save_calendar_version',:'calendar_payload')=:'calendar_receipt'::jsonb,'calendar retry is idempotent');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''save_calendar_version'',%L)',gen_random_uuid(),:'calendar_payload'),'55000');
SELECT pg_temp.assert_true(public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,20)->>'total'='0','calendar publication alone does not invent Saturday coverage');
SELECT jsonb_build_array(jsonb_build_object('id','79000000-0000-0000-0000-000000000021','on_anchor',true),jsonb_build_object('id','79000000-0000-0000-0000-000000000022','on_anchor',false)) groups \gset
SELECT public.leave_roster_preview_v1('73000000-0000-0000-0000-000000000090',:'boundary'::date,:'groups',:'boundary'::date,:'finishes'::date) roster_preview \gset
SELECT jsonb_build_object('calendar_id','73000000-0000-0000-0000-000000000090','anchor',:'boundary','groups',:'groups'::jsonb,'effective_from',:'boundary','effective_until',:'finishes','expected_version',2,'preview_fingerprint',:'roster_preview'::jsonb->>'fingerprint','reason','Synthetic published roster') roster_payload \gset
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''publish_roster'',%L)',gen_random_uuid(),(:'roster_payload'::jsonb||'{"preview_fingerprint":"stale"}'::jsonb)::text),'55000');
SELECT public.leave_transaction_v1('86000000-0000-0000-0000-000000000011','publish_roster',:'roster_payload') roster_receipt \gset
SELECT pg_temp.assert_true(:'roster_receipt'::jsonb->>'version'='3','Director publishes reviewed Saturday roster');
SELECT pg_temp.assert_true(public.leave_transaction_v1('86000000-0000-0000-0000-000000000011','publish_roster',:'roster_payload')=:'roster_receipt'::jsonb,'roster retry is idempotent');
SELECT public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,1) first_page \gset
SELECT public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',2,1) second_page \gset
-- Optional synthetic cross-layer receipt, supplied only by the guarded local review runner.
\if :{?director_fixture_output}
\pset format unaligned
\pset tuples_only on
\o :director_fixture_output
SELECT jsonb_build_object('context',public.leave_context_v1(),'rota',public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090'),'continuations',public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,20));
\o
\pset format aligned
\pset tuples_only off
\endif
SELECT pg_temp.assert_true(:'first_page'::jsonb->>'total'='2' AND jsonb_array_length(:'first_page'::jsonb->'rows')=1 AND :'first_page'::jsonb->'rows'->0->>'employeeId'='71000000-0000-0000-0000-000000000001' AND :'second_page'::jsonb->'rows'->0->>'employeeId'='71000000-0000-0000-0000-000000000002','stable bounded continuation directory covers only eligible current members');
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k)=ARRAY['continuationFingerprint','effectiveFrom','effectiveUntil','employeeId','employeeName','groupId','groupName','memberVersion'] FROM jsonb_object_keys(:'first_page'::jsonb->'rows'->0) k),'continuation row exposes schedule identity and version only');
SELECT pg_temp.assert_denied($s$SELECT public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',0,20)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,101)$s$,'22023');
SELECT pg_temp.assert_true(public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',3,1)->'rows'='[]'::jsonb,'out-of-range continuation page is empty');
SELECT jsonb_build_object('employee_id',:'first_page'::jsonb->'rows'->0->>'employeeId','group_id',:'first_page'::jsonb->'rows'->0->>'groupId','effective_from',:'boundary','effective_until',:'finishes','replace_membership_id',NULL,'expected_version',(:'first_page'::jsonb->'rows'->0->>'memberVersion')::bigint,'reason','Synthetic same-group continuation','continuation_fingerprint',:'first_page'::jsonb->'rows'->0->>'continuationFingerprint') continuation \gset
-- No arbitrary group, new member, replacement, gap, current/past boundary, unbounded range or overrun.
SELECT set_config('test.continuation',:'continuation',true);
DO $$ DECLARE p jsonb:=current_setting('test.continuation')::jsonb;v jsonb;BEGIN
 FOREACH v IN ARRAY ARRAY[
 '{"group_id":"79000000-0000-0000-0000-000000000022"}'::jsonb,
 '{"employee_id":"71000000-0000-0000-0000-000000000008"}'::jsonb,
 '{"employee_id":"71000000-0000-0000-0000-000000000004"}'::jsonb,
 '{"replace_membership_id":"79000000-0000-0000-0000-000000000031"}'::jsonb,
 jsonb_build_object('effective_from',(p->>'effective_from')::date+1),
 jsonb_build_object('effective_from',(statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date),
 jsonb_build_object('effective_from',(statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date-1),
 '{"effective_until":null}'::jsonb,
 jsonb_build_object('effective_until',(p->>'effective_until')::date+1)
 ] LOOP
  PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_group_membership'',%L)',gen_random_uuid(),(p||v)::text),'42501');
 END LOOP;
 PERFORM pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_group_membership'',%L)',gen_random_uuid(),(p||jsonb_build_object('expected_version',(p->>'expected_version')::int-1))::text),'55000');
END $$;
-- A valid-shaped but forged token and an actually changed source are both rejected.
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_group_membership'',%L)',gen_random_uuid(),(:'continuation'::jsonb-'continuation_fingerprint')::text),'22023');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_group_membership'',%L)',gen_random_uuid(),(:'continuation'::jsonb||'{"continuation_fingerprint":null}'::jsonb)::text),'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_group_membership'',%L)',gen_random_uuid(),(:'continuation'::jsonb||jsonb_build_object('continuation_fingerprint',repeat('a',64)))::text),'55000');
SELECT public.leave_roster_preview_v1('73000000-0000-0000-0000-000000000090',:'boundary'::date,:'groups',:'boundary'::date,:'finishes'::date) revised_preview \gset
SELECT (:'roster_payload'::jsonb||jsonb_build_object('expected_version',3,'preview_fingerprint',:'revised_preview'::jsonb->>'fingerprint')) revised_roster \gset
SELECT public.leave_transaction_v1('86000000-0000-0000-0000-000000000013','publish_roster',:'revised_roster');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_group_membership'',%L)',gen_random_uuid(),:'continuation'),'55000');
SELECT public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,1) refreshed_page \gset
SELECT pg_temp.assert_true(:'refreshed_page'::jsonb->'rows'->0->>'continuationFingerprint'<>:'first_page'::jsonb->'rows'->0->>'continuationFingerprint','published source change invalidates saved continuation token');
SELECT (:'continuation'::jsonb||jsonb_build_object('continuation_fingerprint',:'refreshed_page'::jsonb->'rows'->0->>'continuationFingerprint')) continuation \gset
SELECT :'refreshed_page'::jsonb->>'scopeVersion' before_append_scope \gset
SELECT public.leave_transaction_v1('86000000-0000-0000-0000-000000000012','set_group_membership',:'continuation') continuation_receipt \gset
SELECT pg_temp.assert_true(:'continuation_receipt'::jsonb->>'operation'='set_group_membership','Director appends exact same-group continuation');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_group_membership'',%L)',gen_random_uuid(),:'continuation'),'55000');
SELECT pg_temp.assert_true(public.leave_transaction_v1('86000000-0000-0000-0000-000000000012','set_group_membership',:'continuation')=:'continuation_receipt'::jsonb,'same-group retry returns original receipt without duplicate');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('86000000-0000-0000-0000-000000000012',false)=jsonb_build_object('state','committed','result',:'continuation_receipt'::jsonb),'continuation uncertain-outcome recovery remains available');
SELECT pg_temp.assert_true(public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,20)->>'total'='1','already continued employee no longer offered');
SELECT pg_temp.assert_true(public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,20)->>'scopeVersion'<>:'before_append_scope','schedule append bumps read authority scope without a member edit');
SELECT public.leave_roster_preview_v1('73000000-0000-0000-0000-000000000090',:'boundary'::date,:'groups',:'boundary'::date,:'finishes'::date) post_commit_preview \gset
SELECT public.leave_transaction_v1('86000000-0000-0000-0000-000000000014','publish_roster',:'roster_payload'::jsonb||jsonb_build_object('expected_version',4,'preview_fingerprint',:'post_commit_preview'::jsonb->>'fingerprint'));
SELECT pg_temp.assert_true(public.leave_transaction_v1('86000000-0000-0000-0000-000000000012','set_group_membership',:'continuation')=:'continuation_receipt'::jsonb,'committed replay survives a later benign published source revision');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1('86000000-0000-0000-0000-000000000012',false)=jsonb_build_object('state','committed','result',:'continuation_receipt'::jsonb),'committed recovery survives later source revision');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE unchanged_observations AS SELECT
 (SELECT to_jsonb(m)=f.original FROM public.ihr_leave_members m CROSS JOIN frozen_member f WHERE m.user_id='71000000-0000-0000-0000-000000000001') member_unchanged,
 NOT EXISTS(SELECT 1 FROM frozen_predecessors f LEFT JOIN public.ihr_saturday_memberships s ON s.id=f.id WHERE to_jsonb(s) IS DISTINCT FROM f.original) predecessors,
 (SELECT count(*)=1 FROM public.ihr_saturday_memberships WHERE id=(:'continuation_receipt'::jsonb->>'id')::uuid AND employee_id='71000000-0000-0000-0000-000000000001' AND group_id='79000000-0000-0000-0000-000000000021' AND effective_from=:'boundary'::date AND effective_until=:'finishes'::date) exact_append,
 (SELECT f.request=to_jsonb(r) AND f.days=(SELECT jsonb_agg(to_jsonb(d) ORDER BY day) FROM public.ihr_leave_request_days d WHERE d.request_id=r.id)
 AND f.allocations=(SELECT jsonb_agg(to_jsonb(a) ORDER BY account_id) FROM public.ihr_leave_request_allocations a WHERE a.request_id=r.id)
 AND f.ledger=(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.ihr_leave_ledger l) FROM frozen_request f JOIN public.ihr_leave_requests r ON r.id=(f.request->>'id')::uuid) request_unchanged,
 NOT private.ihr_leave_has_grant('71000000-0000-0000-0000-000000000004','configure') AND NOT private.ihr_leave_has_grant('71000000-0000-0000-0000-000000000004','manage_access') grants_unchanged;
GRANT SELECT ON unchanged_observations TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(member_unchanged AND predecessors AND exact_append AND request_unchanged AND grants_unchanged,'old membership and request/charge history are byte-preserved with no privilege grant') FROM unchanged_observations;
SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090') before_revocation \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Independently controlled authority revocation must immediately deny reads, commands and recovery.
UPDATE public.ihr_leave_members SET active=false WHERE user_id='71000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'calendarConfigure'='false','member revocation removes calendar capability');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_rota_context_v1('73000000-0000-0000-0000-000000000090')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,20)$s$,'42501');
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,''set_group_membership'',%L)','86000000-0000-0000-0000-000000000012',:'continuation'),'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_reconcile_request_v1('86000000-0000-0000-0000-000000000012',false)$s$,'22023');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.ihr_leave_members SET active=true WHERE user_id='71000000-0000-0000-0000-000000000004';
UPDATE public.users SET role='sales_person' WHERE id='71000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.leave_context_v1()->'capabilities'->>'calendarConfigure'='false','role revocation removes capability even with active director membership');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_setup_v1('rota',1,20)$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET role='executive',is_active=false WHERE id='71000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_context_v1()$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_roster_continuations_v1('73000000-0000-0000-0000-000000000090',1,20)$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
ROLLBACK;
\echo IHR_DIRECTOR_CALENDAR_SECURITY_PASSED
