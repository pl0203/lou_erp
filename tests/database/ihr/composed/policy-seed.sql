-- FICTIONAL ONLY. Owner-provisioned explicit successors; no original policy/account is edited.
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE m public.ihr_leave_members%ROWTYPE;p public.ihr_leave_policies%ROWTYPE;new_id uuid;BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Fictional policy seed requires fixture owner';END IF;
 FOR m IN SELECT * FROM public.ihr_leave_members WHERE user_id IN('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000008') LOOP
  SELECT * INTO STRICT p FROM public.ihr_leave_policies WHERE id=m.active_policy_id;
  new_id:=('86000000-0000-0000-0000-'||right(m.user_id::text,12))::uuid;
  INSERT INTO public.ihr_leave_policies SELECT (jsonb_populate_record(NULL::public.ihr_leave_policies,to_jsonb(p)||jsonb_build_object(
   'id',new_id,'version',p.version+1,'cancellation_rules_confirmed',true,'cancellation_mode','whole_request',
   'cancellation_allow_past',false,'cancellation_allow_repeat_declined',false,'cancellation_reason_required',true,
   'calendar_audience','explicit_grants','calendar_audience_confirmed',true))).*;
  INSERT INTO private.ihr_leave_policy_owners VALUES(new_id,m.user_id,p.id);
  UPDATE public.ihr_leave_members SET active_policy_id=new_id WHERE user_id=m.user_id;
 END LOOP;
END $$;
