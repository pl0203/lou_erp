-- Exact target discovery; no new authorization from application roles.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.ihr_leave_access_grants(actor_id,capability,scope_kind,employee_id,effective_from,granted_by,reason) VALUES
('71000000-0000-0000-0000-000000000009','configure','employee','71000000-0000-0000-0000-000000000002','2020-01-01','71000000-0000-0000-0000-000000000006','Fictional second target'),
('71000000-0000-0000-0000-000000000009','configure','employee','71000000-0000-0000-0000-000000000009','2020-01-01','71000000-0000-0000-0000-000000000006','Fictional self target denied'),
('71000000-0000-0000-0000-000000000018','manage_access','employee','71000000-0000-0000-0000-000000000001','2020-01-01','71000000-0000-0000-0000-000000000006','Fictional unevidenced access grant');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_targets_v1()$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_true(public.leave_admin_targets_v1(1,1)->>'total'='2','configure discovery excludes own authority and counts authorized targets only');
SELECT pg_temp.assert_true(public.leave_admin_targets_v1(1,1)->'rows'->0->>'id'<>public.leave_admin_targets_v1(2,1)->'rows'->0->>'id','pagination has distinct ordered targets');
SELECT pg_temp.assert_true(jsonb_array_length(public.leave_admin_targets_v1(3,1)->'rows')=0,'authorized out-of-range page is genuinely empty');
SELECT pg_temp.assert_true(public.leave_admin_targets_v1(1,1)->'rows'->0->'capabilities'='{"configure":true,"adjust":false,"readPrivate":false,"calendar":false,"manageAccess":false}'::jsonb,'configure grants do not confer other capabilities');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000010',true);
SELECT pg_temp.assert_true(public.leave_admin_targets_v1()->>'total'='1' AND public.leave_admin_targets_v1()->'rows'->0->>'id'='71000000-0000-0000-0000-000000000001','adjust-only cannot enumerate unrelated audience');
SELECT pg_temp.assert_true(public.leave_admin_targets_v1()->'rows'->0->'capabilities'='{"configure":false,"adjust":true,"readPrivate":false,"calendar":false,"manageAccess":false}'::jsonb,'adjust-only discovers exact independent target');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_targets_v1(0,25)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_targets_v1(1,101)$s$,'22023');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_true(public.leave_admin_targets_v1()->'rows'->0->'capabilities'='{"configure":false,"adjust":false,"readPrivate":true,"calendar":false,"manageAccess":false}'::jsonb,'private-read-only discovers exact independent target');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000012',true);
SELECT pg_temp.assert_true(public.leave_admin_targets_v1()->'rows'->0->'capabilities'='{"configure":false,"adjust":false,"readPrivate":false,"calendar":true,"manageAccess":false}'::jsonb,'calendar grant does not confer HR write or private read');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000013',true);
SELECT pg_temp.assert_true(public.leave_admin_targets_v1()->'rows'->0->'capabilities'='{"configure":false,"adjust":false,"readPrivate":false,"calendar":false,"manageAccess":true}'::jsonb,'evidenced management is independently scoped');
SELECT pg_temp.assert_true((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.leave_admin_targets_v1()->'rows'->0)k)=ARRAY['capabilities','id','name'],'directory exact minimized keys omit private detail/application role');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000018',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_targets_v1()$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_targets_v1()$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET is_active=false WHERE id='71000000-0000-0000-0000-000000000009';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000009',true);
SELECT pg_temp.assert_denied($s$SELECT public.leave_admin_targets_v1()$s$,'42501');
SELECT set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000005',true);
