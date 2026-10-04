-- Owner fixture only; never install. Deliberately conflicting member timezone tests lineage authority.
INSERT INTO private.ihr_leave_calendar_registry(id,version) VALUES('73000000-0000-0000-0000-000000000090',1);
INSERT INTO public.ihr_leave_calendars(id,calendar_id,version,name,effective_from,effective_until,timezone,holidays_confirmed,sunday_minutes,created_by)
VALUES('73000000-0000-0000-0000-000000000091','73000000-0000-0000-0000-000000000090',1,'Fictional annual calendar','2020-01-01','2040-01-01','Pacific/Kiritimati',true,0,'71000000-0000-0000-0000-000000000006');
INSERT INTO public.ihr_leave_policies(id,version,effective_from,effective_until,annual_policy_confirmed,created_by)
VALUES('76000000-0000-0000-0000-000000000090',1,'2020-01-01','2040-01-01',true,'71000000-0000-0000-0000-000000000006');
UPDATE public.ihr_leave_members SET active_calendar_id='73000000-0000-0000-0000-000000000090',active_policy_id='76000000-0000-0000-0000-000000000090',timezone='America/Los_Angeles',employment_start='2020-01-01',eligibility_date='2021-01-01',annual_policy_confirmed=true,cycle_state='established_calendar'
WHERE user_id IN('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000008');
UPDATE public.ihr_leave_members SET active_calendar_id='73000000-0000-0000-0000-000000000090',active_policy_id='76000000-0000-0000-0000-000000000090',employment_start='2026-02-01',eligibility_date='2026-07-01',annual_policy_confirmed=true,cycle_state='established_calendar' WHERE user_id='71000000-0000-0000-0000-000000000018';
