-- Synthetic rollback proof of real installed HR triggers and already-issued sessions.
BEGIN;
SELECT set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
INSERT INTO auth.users(id) SELECT md5('workspace-current-actor-'||n)::uuid FROM generate_series(1,2)n;
INSERT INTO public.users(id,full_name,email,role,is_active)
 SELECT md5('workspace-current-actor-'||n)::uuid,'Synthetic current actor','current-'||n||'@example.invalid','co_admin',true FROM generate_series(1,2)n;
INSERT INTO private.employee_records(id,name,recorded_status)
 SELECT md5('workspace-current-employee-'||n)::uuid,'Synthetic current employee','active' FROM generate_series(1,2)n;
INSERT INTO private.employee_account_links(user_id,employee_id)
 SELECT md5('workspace-current-actor-'||n)::uuid,md5('workspace-current-employee-'||n)::uuid FROM generate_series(1,2)n;
SELECT set_config('request.jwt.claim.sub',md5('workspace-current-actor-1')::uuid::text,true);
SET LOCAL ROLE authenticated;
SELECT public.pilot_co_page_v1('all','',1,20,NULL);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',md5('co-user-1')::uuid::text,true);
UPDATE private.employee_records SET recorded_status='inactive' WHERE id=md5('workspace-current-employee-1')::uuid;
INSERT INTO private.employee_episodes(employee_id,end_date) VALUES(md5('workspace-current-employee-2')::uuid,'2000-01-01');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.users WHERE id IN(md5('workspace-current-actor-1')::uuid,md5('workspace-current-actor-2')::uuid) AND is_active)
 THEN RAISE EXCEPTION 'Real employee triggers must disable both accounts'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; denied boolean; BEGIN
 FOR n IN 1..2 LOOP
  PERFORM set_config('request.jwt.claim.sub',md5('workspace-current-actor-'||n)::uuid::text,true);
  denied:=false;
  BEGIN PERFORM public.pilot_co_page_v1('all','',1,20,NULL);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Restricted employee session read must fail'; END IF;
 END LOOP;
END $$;
RESET ROLE;
-- Service-role access reaches the actual function body for an allowed actor,
-- but rejects both disabled employees before looking up unknown evidence.
SET LOCAL ROLE service_role;
DO $$ DECLARE n int; denied boolean; reached_evidence boolean:=false; BEGIN
 BEGIN
  PERFORM public.pilot_co_evidence_manual_workbook_attest_v1(
   md5('co-user-1')::uuid,md5('workspace-current-unknown-evidence')::uuid,
   md5('workspace-current-unknown-object')::uuid,'synthetic-version',repeat('a',64),'{}'::jsonb);
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM <> 'Invalid evidence identity' THEN RAISE; END IF;
  reached_evidence:=true;
 END;
 IF NOT reached_evidence THEN RAISE EXCEPTION 'Allowed service actor must reach evidence validation'; END IF;
 FOR n IN 1..2 LOOP
  denied:=false;
  BEGIN
   PERFORM public.pilot_co_evidence_manual_workbook_attest_v1(
    md5('workspace-current-actor-'||n)::uuid,md5('workspace-current-unknown-evidence')::uuid,
    md5('workspace-current-unknown-object')::uuid,'synthetic-version',repeat('a',64),'{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN
   IF SQLERRM <> 'CO authority required' THEN RAISE; END IF;
   denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Restricted employee service attestation must fail before evidence work'; END IF;
 END LOOP;
END $$;
RESET ROLE;
SELECT 'CO_WORKSPACE_CURRENT_AUTHORITY_PASSED';
ROLLBACK;
