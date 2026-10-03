BEGIN;
\ir quote-seed.sql
-- Use established fictional manager 3, whose current approver is fictional director 4.
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason)
VALUES('71000000-0000-0000-0000-000000000006','configure','employee','71000000-0000-0000-0000-000000000003','2020-01-01','71000000-0000-0000-0000-000000000005','Fictional import fixture');
CREATE FUNCTION pg_temp.opening_payload(lines jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000003','year',extract(year FROM statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::integer,
  'allowance_minutes',5400,'past_used_minutes',120,'future_approved',lines,'as_of',(statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date,
  'source_id','80000000-0000-0000-0000-000000000020','expected_version',0,'reason','Fictional opening reconciliation')
$$;
CREATE FUNCTION pg_temp.opening_line(n integer,days_ahead integer,total integer DEFAULT 450) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('source_id',('80000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'start_date',pg_temp.quote_friday()+days_ahead,'end_date',pg_temp.quote_friday()+days_ahead,'duration',jsonb_build_object('mode','full_scheduled_day'),'total_minutes',total)
$$;
DO $$ DECLARE ns text;BEGIN SELECT nspname INTO ns FROM pg_namespace WHERE oid=pg_my_temp_schema();EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO authenticated',ns);END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
-- First valid line must also roll back when the later line has a mismatched total.
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('80000000-0000-0000-0000-000000000021','reconcile_opening',pg_temp.opening_payload(jsonb_build_array(pg_temp.opening_line(31,3),pg_temp.opening_line(32,4,451))))$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('80000000-0000-0000-0000-000000000022','reconcile_opening',pg_temp.opening_payload(jsonb_build_array(pg_temp.opening_line(31,3),pg_temp.opening_line(31,4))))$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('80000000-0000-0000-0000-000000000023','reconcile_opening',pg_temp.opening_payload(jsonb_build_array(pg_temp.opening_line(31,3),pg_temp.opening_line(32,3))))$s$,'55000');
RESET ROLE;
CREATE TEMP TABLE opening_atomic_observation AS SELECT
 NOT EXISTS(SELECT 1 FROM public.ihr_leave_requests) AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_occupancy)
 AND NOT EXISTS(SELECT 1 FROM public.ihr_leave_accounts WHERE employee_id='71000000-0000-0000-0000-000000000003')
 AND NOT EXISTS(SELECT 1 FROM private.ihr_leave_commands) empty;
GRANT SELECT ON opening_atomic_observation TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(empty,'entire rejected opening batch rolls back account, grant, command, requests and occupancy') FROM opening_atomic_observation;
SELECT public.leave_transaction_v1('80000000-0000-0000-0000-000000000024','reconcile_opening',pg_temp.opening_payload(jsonb_build_array(pg_temp.opening_line(31,3),pg_temp.opening_line(32,4)))) opening_receipt \gset
SELECT pg_temp.assert_true(public.leave_transaction_v1('80000000-0000-0000-0000-000000000024','reconcile_opening',pg_temp.opening_payload(jsonb_build_array(pg_temp.opening_line(31,3),pg_temp.opening_line(32,4))))=:'opening_receipt'::jsonb,'opening batch replay is source unique');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_own_history_v1()->'rows')=2 AND public.leave_own_history_v1()->'rows'->0->>'status'='approved','imported approved history available to owner');
SELECT public.leave_own_history_v1()->'rows'->0->>'id' imported_id \gset
SELECT public.leave_own_request_v1(:'imported_id') frozen_import \gset
SELECT pg_temp.assert_true(public.leave_own_request_v1(:'imported_id')->'allocations'->0->>'chargedMinutes'='450','original imported allocation frozen');
SELECT pg_temp.assert_true(public.leave_context_v1()->'balances'->0->>'approvedMinutes'='1020','opening ledger includes past 120 plus future 900 exactly once');
SELECT pg_temp.assert_true(public.leave_context_v1()->'balances'->0->>'pendingMinutes'='0','import does not reserve or double charge usage');
SELECT jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3),'quote_fingerprint',public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday()+3,pg_temp.quote_friday()+3))->>'fingerprint') imported_duplicate_date \gset
SELECT pg_temp.assert_denied(format('SELECT public.leave_transaction_v1(%L,%L,%L::jsonb)','80000000-0000-0000-0000-000000000025','submit_request',:'imported_duplicate_date'::jsonb),'55000');
RESET ROLE;
CREATE TEMP TABLE opening_observation AS SELECT
 (SELECT count(*)=1 AND sum(used_delta)=1020 FROM public.ihr_leave_ledger WHERE kind='opening') exactly_one_usage,
 (SELECT count(*)=2 FROM public.ihr_leave_occupancy) occupancy,
 (SELECT count(*)=2 FROM private.ihr_leave_request_events WHERE event='opening_imported') audited;
GRANT SELECT ON opening_observation TO authenticated;
UPDATE public.users SET full_name='Changed fictional director name' WHERE id='71000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(exactly_one_usage AND occupancy AND audited,'import uses one original opening ledger and occupied dates') FROM opening_observation;
SELECT pg_temp.assert_true(public.leave_own_request_v1(:'imported_id')=:'frozen_import'::jsonb,'import snapshot does not recalculate after source changes');
RESET ROLE;
ROLLBACK;
