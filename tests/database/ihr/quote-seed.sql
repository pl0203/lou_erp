-- Fictional, owner-only fixtures. All rules below are explicit TEST choices, not real HR setup.
\ir seed.sql
\ir accounts-seed.sql
INSERT INTO public.ihr_leave_policies(id,version,effective_from,effective_until,annual_policy_confirmed,created_by,
 minimum_notice_days,booking_horizon_days,reason_required,request_rules_confirmed,reserve_pending_accepted,single_date_rule_accepted)
VALUES('79000000-0000-0000-0000-000000000001',1,'2020-01-01','2040-01-01',true,'71000000-0000-0000-0000-000000000006',0,366,true,true,true,true);
UPDATE public.ihr_leave_members SET active_policy_id='79000000-0000-0000-0000-000000000001',reserve_pending_accepted=true,single_date_rule_accepted=true
WHERE user_id IN('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000008');
INSERT INTO public.ihr_leave_approvers(id,employee_id,approver_id,effective_from,assigned_by)
SELECT ('79000000-0000-0000-0000-'||lpad((10+n)::text,12,'0'))::uuid,('71000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '71000000-0000-0000-0000-000000000003','2020-01-01','71000000-0000-0000-0000-000000000006' FROM unnest(ARRAY[2,8]) n;
INSERT INTO public.ihr_saturday_groups(id,calendar_id,name) VALUES
('79000000-0000-0000-0000-000000000021','73000000-0000-0000-0000-000000000090','Fictional Amber'),
('79000000-0000-0000-0000-000000000022','73000000-0000-0000-0000-000000000090','Fictional Blue');
INSERT INTO public.ihr_saturday_memberships(id,employee_id,group_id,effective_from,effective_until,created_by) VALUES
('79000000-0000-0000-0000-000000000031','71000000-0000-0000-0000-000000000001','79000000-0000-0000-0000-000000000021','2020-01-01','2040-01-01','71000000-0000-0000-0000-000000000006'),
('79000000-0000-0000-0000-000000000032','71000000-0000-0000-0000-000000000002','79000000-0000-0000-0000-000000000022','2020-01-01','2040-01-01','71000000-0000-0000-0000-000000000006');
-- Next Friday strictly after company today; the following Saturday is Amber's anchor.
-- Current-day calendar edits are intentionally denied, including when CI runs on Friday.
CREATE FUNCTION pg_temp.quote_friday() RETURNS date LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT (statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date + ((5-extract(isodow FROM statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::integer+6)%7)+1
$$;
CREATE FUNCTION pg_temp.quote_input(starts date,ends date,duration jsonb DEFAULT '{"mode":"full_scheduled_day"}') RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT jsonb_build_object('start_date',starts,'end_date',ends,'duration',duration,'reason','Fictional private reason')
$$;
INSERT INTO public.ihr_saturday_roster(calendar_version_id,group_id,version,day,capacity_minutes,anchor,on_anchor,effective_from,effective_until,published_by)
SELECT '73000000-0000-0000-0000-000000000091',g.id,1,d::date,
 CASE WHEN (mod((d::date-(pg_temp.quote_friday()+1))/7,2)=0)=(g.name='Fictional Amber') THEN 225 ELSE 0 END,
 pg_temp.quote_friday()+1,g.name='Fictional Amber','2020-01-01','2040-01-01','71000000-0000-0000-0000-000000000006'
FROM generate_series('2020-01-04'::timestamp,'2039-12-31'::timestamp,'7 days') d CROSS JOIN public.ihr_saturday_groups g WHERE g.id IN('79000000-0000-0000-0000-000000000021','79000000-0000-0000-0000-000000000022');
-- Explicit synthetic grants/openings for this local year and next; public quote must never create these.
DO $$ DECLARE yr integer;n integer;a public.ihr_leave_accounts%ROWTYPE;BEGIN
 FOR yr IN SELECT extract(year FROM statement_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::integer+gs.step FROM generate_series(0,1) gs(step) LOOP
  FOREACH n IN ARRAY ARRAY[1,2,8] LOOP
   a:=private.ihr_leave_prepare_account(('71000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,make_date(yr,1,2)::timestamp AT TIME ZONE 'Pacific/Kiritimati');
   UPDATE public.ihr_leave_accounts SET opening_reconciled=true,opening_as_of=make_date(yr,1,1),opening_source_id=gen_random_uuid() WHERE id=a.id;
  END LOOP;
 END LOOP;
END $$;
-- Temporary test helpers are not persistent product APIs. Permission assertions still use actual roles.
DO $$ DECLARE ns text;BEGIN
 SELECT nspname INTO ns FROM pg_namespace WHERE oid=pg_my_temp_schema();
 EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO authenticated,anon',ns);
END $$;
