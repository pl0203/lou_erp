-- FICTIONAL ONLY. Race global-config grant: explicit full fictional policy-member audience.
-- Reinclude after owner adds a grant to record a new immutable exact evidence version.
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE employee uuid;approval uuid;k text;v bigint;BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Fictional governance seed requires fixture owner';END IF;
 FOREACH employee IN ARRAY ARRAY['71000000-0000-0000-0000-000000000001'::uuid,'71000000-0000-0000-0000-000000000002'::uuid,'71000000-0000-0000-0000-000000000003'::uuid,'71000000-0000-0000-0000-000000000008'::uuid] LOOP
  FOREACH k IN ARRAY ARRAY['retention','access_review'] LOOP
   approval:=gen_random_uuid();
   INSERT INTO private.ihr_leave_governance_approvals(id,employee_id,kind,rule_id,rule_version,rule_document,approved_by,approved_at,accountable_owner,cadence,capabilities,grant_ids,audience_ids,confirmed)
   VALUES(approval,employee,k,gen_random_uuid(),1,jsonb_build_object('fictional',true,'rule',k),'71000000-0000-0000-0000-000000000014','2020-01-01 00:00:00+00','71000000-0000-0000-0000-000000000006',CASE WHEN k='access_review' THEN 'Fictional cadence, test only' END,
    ARRAY['configure','adjust','read_private','calendar','manage_access'],ARRAY(SELECT id FROM public.ihr_leave_access_grants WHERE employee_id=employee OR scope_kind='all_policy_members'),ARRAY['71000000-0000-0000-0000-000000000001'::uuid,'71000000-0000-0000-0000-000000000002'::uuid,'71000000-0000-0000-0000-000000000003'::uuid,'71000000-0000-0000-0000-000000000007'::uuid,'71000000-0000-0000-0000-000000000008'::uuid,'71000000-0000-0000-0000-000000000018'::uuid],true);
   SELECT coalesce(max(version),0)+1 INTO v FROM private.ihr_leave_governance_references WHERE employee_id=employee AND kind=k;
   INSERT INTO private.ihr_leave_governance_references VALUES(employee,k,v,approval,'71000000-0000-0000-0000-000000000006','2020-01-01 00:00:00+00');
  END LOOP;
 END LOOP;
END $$;
