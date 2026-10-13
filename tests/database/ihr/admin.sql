-- Assertions run as actual non-bypass roles; all fictional setup rolls back.
BEGIN;
\ir quote-seed.sql
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_settings_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_admin_readiness_v1('71000000-0000-0000-0000-000000000001')->>'ready'='false','unconfirmed governance blocks readiness');
SELECT pg_temp.assert_denied($s$SELECT * FROM private.ihr_leave_governance_approvals$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT * FROM private.ihr_leave_access_manifests$s$,'42501');
SELECT pg_temp.assert_denied($s$INSERT INTO private.ihr_leave_policy_owners VALUES('81000000-0000-0000-0000-000000000080','71000000-0000-0000-0000-000000000001','79000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_settings_v1('71000000-0000-0000-0000-000000000002')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_settings_v1('81000000-0000-0000-0000-000000000099')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()))$s$,'55000');
RESET ROLE;
\ir admin-governance-seed.sql
-- Provision incomplete external evidence variants without changing approved immutable originals.
CREATE TEMP TABLE admin_missing_evidence(id uuid,field text,kind text);
DO $$ DECLARE base jsonb;field text;id uuid;k text;BEGIN
 FOREACH k IN ARRAY ARRAY['retention','access_review'] LOOP
 SELECT to_jsonb(a) INTO base FROM private.ihr_leave_governance_approvals a WHERE employee_id='71000000-0000-0000-0000-000000000001' AND kind=k LIMIT 1;
 FOREACH field IN ARRAY ARRAY['rule_id','rule_version','rule_document','approved_by','approved_at','accountable_owner','cadence','capabilities','grant_ids','audience_ids','confirmed'] LOOP
  IF k='retention' AND field='cadence' THEN CONTINUE;END IF;
  id:=gen_random_uuid();
  INSERT INTO private.ihr_leave_governance_approvals SELECT (jsonb_populate_record(NULL::private.ihr_leave_governance_approvals,jsonb_set(jsonb_set(base,'{id}',to_jsonb(id)),ARRAY[field],CASE WHEN field='confirmed' THEN 'false'::jsonb ELSE 'null'::jsonb END))).*;
  INSERT INTO admin_missing_evidence VALUES(id,field,k);
 END LOOP;
 END LOOP;
END $$;
GRANT SELECT ON admin_missing_evidence TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(public.leave_admin_readiness_v1('71000000-0000-0000-0000-000000000001')->>'ready'='true','complete explicitly approved synthetic setup is ready');
SELECT public.leave_admin_settings_v1('71000000-0000-0000-0000-000000000001')->'governance' valid_governance \gset
DO $$ DECLARE r record;v bigint;BEGIN
 FOR r IN SELECT * FROM admin_missing_evidence ORDER BY kind,field LOOP
  SELECT coalesce(max((a->>'referenceVersion')::bigint),0) INTO v FROM jsonb_array_elements(public.leave_admin_settings_v1('71000000-0000-0000-0000-000000000001')->'governance') a WHERE a->>'kind'=r.kind;
  PERFORM public.leave_transaction_v1(gen_random_uuid(),'set_governance_reference',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','kind',r.kind,'approval_id',r.id,'expected_version',v,'reason','Fictional missing evidence test'));v:=v+1;
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(public.leave_admin_readiness_v1('71000000-0000-0000-0000-000000000001')->'blockers') b WHERE b->>'code'=upper(r.kind)||'_UNCONFIRMED'),'missing '||r.kind||' field blocks: '||r.field);
 END LOOP;
END $$;
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000001','set_governance_reference',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','kind','access_review','approval_id',(SELECT item->>'id' FROM jsonb_array_elements(:'valid_governance'::jsonb)item WHERE item->>'kind'='access_review' AND item->>'selected'='true'),'expected_version',12,'reason','Restore fictional approved reference'));
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000004','set_governance_reference',jsonb_build_object('employee_id','71000000-0000-0000-0000-000000000001','kind','retention','approval_id',(SELECT item->>'id' FROM jsonb_array_elements(:'valid_governance'::jsonb)item WHERE item->>'kind'='retention' AND item->>'selected'='true'),'expected_version',11,'reason','Restore fictional approved retention'));
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_requests_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_access_v1('71000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000013',true);
SELECT pg_temp.assert_true(public.leave_admin_access_v1('71000000-0000-0000-0000-000000000001')->>'employeeId'='71000000-0000-0000-0000-000000000001','evidenced management exact audience');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_access_v1('71000000-0000-0000-0000-000000000002')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000002','grant_leave_access','{"manifest_id":"81000000-0000-0000-0000-000000000099","expected_version":0,"reason":"fictional"}')$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
SELECT public.leave_quote_v1(pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday())) quote \gset
SELECT public.leave_transaction_v1('81000000-0000-0000-0000-000000000003','submit_request',jsonb_build_object('input',pg_temp.quote_input(pg_temp.quote_friday(),pg_temp.quote_friday()),'quote_fingerprint',:'quote'::jsonb->>'fingerprint')) receipt \gset
SELECT pg_temp.assert_true(public.leave_own_request_v1((:'receipt'::jsonb->>'id')::uuid)->>'totalMinutes'='450','authorized owned policy successor reuses original account');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(NOT(public.leave_admin_requests_v1('71000000-0000-0000-0000-000000000001')->'rows'->0 ? 'reason'),'admin reassignment list omits private reason');
SELECT pg_temp.assert_true(public.leave_admin_settings_v1('71000000-0000-0000-0000-000000000001')->'impacts'->>'pendingCount'='1','impact previews are exact target counts');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE admin_lineage_observations AS SELECT
 private.ihr_leave_policy_account_compatible('71000000-0000-0000-0000-000000000001','79000000-0000-0000-0000-000000000001',(SELECT active_policy_id FROM public.ihr_leave_members WHERE user_id='71000000-0000-0000-0000-000000000001')) owned,
 private.ihr_leave_policy_account_compatible('71000000-0000-0000-0000-000000000002','79000000-0000-0000-0000-000000000001',(SELECT active_policy_id FROM public.ihr_leave_members WHERE user_id='71000000-0000-0000-0000-000000000001')) crossed,
 private.ihr_leave_policy_account_compatible('71000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000090',(SELECT active_policy_id FROM public.ihr_leave_members WHERE user_id='71000000-0000-0000-0000-000000000001')) unrelated;
GRANT SELECT ON admin_lineage_observations TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.assert_true(owned AND NOT crossed AND NOT unrelated,'policy compatibility is exact per-employee predecessor lineage') FROM admin_lineage_observations;
\ir admin-commands.sql
\ir admin-midyear-denials.sql
\ir hr-private-review.sql
\ir admin-write-context.sql
\ir admin-targets.sql
\ir admin-mixed-grants.sql
\ir admin-rota-context.sql
RESET ROLE;
ROLLBACK;
\echo IHR_ADMIN_SCOPED_SETTINGS_PASSED
