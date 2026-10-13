-- Important review regression I2: each external manifest and target audience must match one grant row.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.ihr_leave_access_grants(id,actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason) VALUES
('82000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000006','manage_access','all_policy_members',NULL,'2020-01-01','71000000-0000-0000-0000-000000000014','Fictional evidenced policy audience A'),
('82000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000006','manage_access','employee','71000000-0000-0000-0000-000000000005','2020-01-01','71000000-0000-0000-0000-000000000014','Fictional unevidenced nonmember audience B'),
('82000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000015','calendar','employee','71000000-0000-0000-0000-000000000005','2020-01-01','71000000-0000-0000-0000-000000000014','Fictional nonmember grant C');
INSERT INTO private.ihr_leave_access_manifests(id,grant_id,actor_id,grantor_id,capability,scope_kind,employee_id,effective_from,approved_by,approved_at,approval_reference,confirmed) VALUES
('82000000-0000-0000-0000-000000000011','82000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000014','manage_access','all_policy_members',NULL,'2020-01-01','71000000-0000-0000-0000-000000000014',clock_timestamp()-interval '1 day','Fictional all-policy approval A',true),
('82000000-0000-0000-0000-000000000012','82000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000015','71000000-0000-0000-0000-000000000006','calendar','employee','71000000-0000-0000-0000-000000000005','2020-01-01','71000000-0000-0000-0000-000000000014',clock_timestamp()-interval '1 day','Fictional candidate cannot confer grantor authority',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.leave_admin_targets_v1(1,100)->'rows') r WHERE r->>'id'='71000000-0000-0000-0000-000000000005'),'mixed grants must not enumerate nonmember X');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_access_v1('71000000-0000-0000-0000-000000000005')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000021','revoke_leave_access','{"grant_id":"82000000-0000-0000-0000-000000000003","expected_version":1,"reason":"Mixed grant revocation denied"}')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000022','grant_leave_access','{"manifest_id":"82000000-0000-0000-0000-000000000012","expected_version":0,"reason":"Mixed grant application denied"}')$s$,'42501');
SELECT pg_temp.assert_true(public.leave_admin_access_v1('71000000-0000-0000-0000-000000000001')->>'employeeId'='71000000-0000-0000-0000-000000000001','manifested all-policy grant covers actual employee');
SELECT pg_temp.assert_true(public.leave_admin_access_v1('71000000-0000-0000-0000-000000000002')->>'employeeId'='71000000-0000-0000-0000-000000000002','existing manifested exact employee management still works');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_access_v1('71000000-0000-0000-0000-000000000004')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Only this later exact external evidence may authorize X, independently of the all-policy row.
INSERT INTO private.ihr_leave_access_manifests(id,grant_id,actor_id,grantor_id,capability,scope_kind,employee_id,effective_from,approved_by,approved_at,approval_reference,confirmed) VALUES
('82000000-0000-0000-0000-000000000013','82000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000014','manage_access','employee','71000000-0000-0000-0000-000000000005','2020-01-01','71000000-0000-0000-0000-000000000014',clock_timestamp()-interval '1 day','Fictional exact nonmember approval B',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true(public.leave_admin_access_v1('71000000-0000-0000-0000-000000000005')->>'employeeId'='71000000-0000-0000-0000-000000000005','exact manifested employee branch supports its named user');
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000023','grant_leave_access','{"manifest_id":"82000000-0000-0000-0000-000000000012","expected_version":0,"reason":"Exact manifested grantor authority"}');
SELECT public.leave_transaction_v1('82000000-0000-0000-0000-000000000024','revoke_leave_access','{"grant_id":"82000000-0000-0000-0000-000000000003","expected_version":1,"reason":"Exact manifested revocation authority"}');
