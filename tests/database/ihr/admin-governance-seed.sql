-- FICTIONAL ONLY, owner-provisioned after quote-seed.sql. Never install actual approvals.
-- Caller must be owner with JWT cleared. This is a composed-suite dependency, not an RPC.
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE m public.ihr_leave_members%ROWTYPE;p public.ihr_leave_policies%ROWTYPE;new_id uuid;approval_id uuid;k text;BEGIN
 FOR m IN SELECT * FROM public.ihr_leave_members WHERE user_id IN('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002') LOOP
  SELECT * INTO STRICT p FROM public.ihr_leave_policies WHERE id=m.active_policy_id;
  new_id:=gen_random_uuid();
  INSERT INTO public.ihr_leave_policies(id,version,effective_from,effective_until,annual_policy_confirmed,created_by,minimum_notice_days,booking_horizon_days,reason_required,request_rules_confirmed,reserve_pending_accepted,single_date_rule_accepted,cancellation_rules_confirmed,cancellation_mode,cancellation_allow_past,cancellation_allow_repeat_declined,cancellation_reason_required,calendar_audience,calendar_audience_confirmed)
  VALUES(new_id,p.version+1,p.effective_from,p.effective_until,true,p.created_by,p.minimum_notice_days,p.booking_horizon_days,p.reason_required,true,true,true,true,'whole_request',false,false,true,'explicit_grants',true);
  INSERT INTO private.ihr_leave_policy_owners VALUES(new_id,m.user_id,p.id);
  UPDATE public.ihr_leave_members SET active_policy_id=new_id WHERE user_id=m.user_id;
  FOREACH k IN ARRAY ARRAY['retention','access_review'] LOOP
   approval_id:=gen_random_uuid();
   INSERT INTO private.ihr_leave_governance_approvals(id,employee_id,kind,rule_id,rule_version,rule_document,approved_by,approved_at,accountable_owner,cadence,capabilities,grant_ids,audience_ids,confirmed)
   VALUES(approval_id,m.user_id,k,gen_random_uuid(),1,jsonb_build_object('fictional',true,'rule',k),'71000000-0000-0000-0000-000000000014',clock_timestamp()-interval '1 day','71000000-0000-0000-0000-000000000006',CASE WHEN k='access_review' THEN 'Fictional cadence, test only' END,
    ARRAY['configure','adjust','read_private','calendar','manage_access'],ARRAY(SELECT id FROM public.ihr_leave_access_grants WHERE employee_id=m.user_id OR scope_kind='all_policy_members'),ARRAY[m.user_id],true);
   INSERT INTO private.ihr_leave_governance_references VALUES(m.user_id,k,1,approval_id,'71000000-0000-0000-0000-000000000006',clock_timestamp());
  END LOOP;
 END LOOP;
END $$;
-- Exact named bootstrap evidence is provisioned by the fixture owner, never by the application.
INSERT INTO private.ihr_leave_access_manifests(id,grant_id,actor_id,grantor_id,capability,scope_kind,employee_id,effective_from,effective_until,approved_by,approved_at,approval_reference,confirmed)
SELECT gen_random_uuid(),g.id,g.actor_id,g.granted_by,g.capability,g.scope_kind,g.employee_id,g.effective_from,g.effective_until,'71000000-0000-0000-0000-000000000014',clock_timestamp()-interval '1 day','Fictional external approval only',true
FROM public.ihr_leave_access_grants g WHERE g.capability='manage_access';
