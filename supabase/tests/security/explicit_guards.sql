-- Synthetic explicit-guard smoke test. Can execute in standalone PostgreSQL.
-- DOES NOT VALIDATE RLS, GRANTS, JWT VERIFICATION, OR CONCURRENT SESSIONS.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.assert_denied(statement text,label text,allow_zero_rows boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE affected bigint;
BEGIN
 BEGIN EXECUTE statement; GET DIAGNOSTICS affected=ROW_COUNT;
 IF allow_zero_rows AND affected=0 THEN RETURN; END IF;
 EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'FAIL (explicit guard missing): %',label;
END $$;
INSERT INTO auth.users(id) VALUES ('11000000-0000-0000-0000-000000000001'),('11000000-0000-0000-0000-000000000002'),('11000000-0000-0000-0000-000000000003');
INSERT INTO public.users(id,full_name,email,role,is_active) VALUES
('11000000-0000-0000-0000-000000000001','Synthetic salesperson','sales@guard.invalid','sales_person',true),
('11000000-0000-0000-0000-000000000002','Synthetic executive','exec@guard.invalid','executive',true),
('11000000-0000-0000-0000-000000000003','Synthetic inactive executive','inactive@guard.invalid','executive',false);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.current_user_role()='sales_person','active role resolved');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET role='executive' WHERE id=auth.uid()$s$,'self privilege escalation blocked');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET manager_id='11000000-0000-0000-0000-000000000002' WHERE id=auth.uid()$s$,'self scope change blocked');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET is_active=false WHERE id=auth.uid()$s$,'self status change blocked');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET email='different@guard.invalid' WHERE id=auth.uid()$s$,'identity email immutable');
UPDATE public.users SET full_name='Safe edited name',phone='synthetic' WHERE id=auth.uid();
SELECT pg_temp.assert_true((SELECT full_name='Safe edited name' FROM public.pilot_my_profile()),'safe self profile edit retained');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.pilot_my_profile()),'profile RPC returns one own row');
SELECT pg_temp.assert_denied($s$SELECT * FROM public.pilot_list_users()$s$,'sales cannot read full directory through RPC');
SELECT pg_temp.assert_denied($s$SELECT * FROM public.pilot_team_directory()$s$,'sales cannot read management contacts through RPC');
SELECT set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(public.current_user_role() IS NULL,'inactive loses role');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.pilot_my_profile()),'inactive profile RPC denied');
SELECT pg_temp.assert_denied($s$UPDATE public.users SET is_active=true WHERE id=auth.uid()$s$,'inactive cannot reactivate itself',true);
SELECT pg_temp.assert_denied($s$SELECT * FROM public.pilot_list_users()$s$,'inactive executive denied admin directory');
SELECT set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
UPDATE public.users SET role='sales_manager',full_name='Executive edited' WHERE id='11000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT role='sales_manager' FROM public.users WHERE id='11000000-0000-0000-0000-000000000001'),'executive can manage another profile');
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.pilot_list_users()),'active executive can read admin directory');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT is_active=false FROM public.users WHERE id='11000000-0000-0000-0000-000000000003'),'privileged postcheck: inactive profile remains inactive');
ROLLBACK;
