-- FICTIONAL ONLY. Included within the calling suite transaction; no real accounts.
INSERT INTO auth.users(id) SELECT ('82000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(2,9) n;
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id,phone)
SELECT ('82000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'Fictional employee account '||n,'employee-fixture-'||n||'@example.invalid',
 (CASE n WHEN 2 THEN 'po_admin' WHEN 3 THEN 'co_admin' WHEN 4 THEN 'sales_person' WHEN 5 THEN 'sales_manager' WHEN 6 THEN 'sales_head' WHEN 7 THEN 'executive' ELSE 'sales_person' END)::public.user_role,
 n<>7,CASE WHEN n=4 THEN '82000000-0000-0000-0000-000000000005'::uuid END,'PRIVATE_PHONE_SENTINEL'
FROM generate_series(2,8) n;
INSERT INTO private.employee_records(id,name,employee_number,job_title,team,recorded_status,version)
VALUES ('81000000-0000-0000-0000-000000000001','Ayu % Literal','EMP-001','Engineer','Fictional','ended',1),
 ('81000000-0000-0000-0000-000000000002','Ayu Other','EMP-002',NULL,NULL,'active',2),
 ('81000000-0000-0000-0000-000000000003','Zoë 李 👩🏽‍💻','EMP-003',NULL,NULL,'draft',1),
 ('81000000-0000-0000-0000-000000000004','Ayu Other',NULL,NULL,NULL,'draft',1);
INSERT INTO private.employee_number_claims(normalized_number,employee_id)
SELECT lower(employee_number),id FROM private.employee_records WHERE employee_number IS NOT NULL;
INSERT INTO private.employee_episodes(employee_id,start_date,end_date,source_reference)
VALUES('81000000-0000-0000-0000-000000000001',NULL,NULL,NULL);
INSERT INTO private.employee_account_links(employee_id,user_id,quarantined)
VALUES('81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000004',true),
 ('81000000-0000-0000-0000-000000000002','82000000-0000-0000-0000-000000000007',false);
INSERT INTO private.employee_reporting_revisions(employee_id,revision,mode,actor_id)
VALUES('81000000-0000-0000-0000-000000000001',1,'schedule','82000000-0000-0000-0000-000000000001');
INSERT INTO private.employee_reporting_intervals(employee_id,revision,ordinal,manager_employee_id,from_date,until_date)
VALUES('81000000-0000-0000-0000-000000000001',1,0,'81000000-0000-0000-0000-000000000003','2026-01-01',NULL);
UPDATE private.employee_records SET reporting_revision=1 WHERE id='81000000-0000-0000-0000-000000000001';
INSERT INTO private.employee_audit_events(id,employee_id,actor_id,actor_name,recorded_at,action,reason,before_data,after_data)
VALUES('83000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','Fictional Director','2026-10-01T00:00:00Z','edit_employee','Fictional test reason',
 '{"fields":{"name":"Before","privateLeaveReason":"PRIVATE_AUDIT_SENTINEL"},"privateLeaveReason":"PRIVATE_AUDIT_SENTINEL"}',
 '{"fields":{"name":"After","password":"PRIVATE_AUDIT_SENTINEL"},"episode":{"startDate":null,"endDate":null,"sourceReference":null,"private":"PRIVATE_AUDIT_SENTINEL"},"account":{"userId":"82000000-0000-0000-0000-000000000004","token":"PRIVATE_AUDIT_SENTINEL"},"reporting":[{"managerEmployeeId":null,"from":"2026-01-01","until":null,"private":"PRIVATE_AUDIT_SENTINEL"}]}'),
 ('83000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','Fictional Director','2026-10-01T00:00:00Z','edit_employee','Second fictional reason','{}','{}');
