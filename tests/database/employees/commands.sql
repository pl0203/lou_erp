-- Fixed rollback-only synthetic command assertions, never production fixtures.
INSERT INTO auth.users(id) SELECT ('92000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,9) n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT ('92000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Command fixture '||n,'command-'||n||'@example.invalid',
 (CASE n WHEN 1 THEN 'executive' WHEN 2 THEN 'executive' WHEN 3 THEN 'po_admin' WHEN 4 THEN 'co_admin' WHEN 5 THEN 'sales_person' WHEN 6 THEN 'sales_manager' WHEN 7 THEN 'sales_head' ELSE 'executive' END)::public.user_role,n<>8 FROM generate_series(1,8)n;
CREATE TEMP TABLE baseline AS SELECT md5(string_agg(to_jsonb(u)::text,',' ORDER BY id)) users, (SELECT version FROM private.ihr_leave_scope_revision WHERE singleton) leave_scope FROM public.users u;
CREATE FUNCTION pg_temp.fields(n text,num text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('name',n,'employeeNumber',num,'jobTitle',NULL,'team',NULL,'recordedStatus','draft') $$;
CREATE FUNCTION pg_temp.save(op uuid,e uuid,v bigint,a text,p jsonb,reason text DEFAULT 'Fixture reason',effective date DEFAULT NULL,source text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE preview jsonb; BEGIN preview:=public.employee_preview_v1(e,v,a,p,reason,effective,source);
 RETURN public.employee_command_v1(op,e,v,a,p,reason,effective,source,preview->>'previewFingerprint'); END $$;
CREATE FUNCTION pg_temp.expect_error(statement text, code text, reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_code text; actual_reason text; BEGIN
 PERFORM pg_temp.assert_true(true,'assertion executes under app role');
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_code=RETURNED_SQLSTATE,actual_reason=MESSAGE_TEXT; END;
 PERFORM pg_temp.assert_true(actual_code=code AND actual_reason=reason,format('expected %s/%s, got %s/%s',code,reason,actual_code,actual_reason)); END $$;
GRANT SELECT ON baseline TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000001',true);
-- Fails here before commands implementation: actual connection and schema exist.
SELECT pg_temp.assert_true(public.employee_preview_v1('91000000-0000-0000-0000-000000000001',0,'create_employee',pg_temp.fields('  Zoë 李 😀  ',' A-1 '),' fixture ',NULL,NULL)->'normalizedPayload'=pg_temp.fields('Zoë 李 😀','A-1'),'preview uses canonical normalization');
DO $$ DECLARE p jsonb; first jsonb; replay jsonb; before_version bigint; before_events bigint; after_version bigint; new_events bigint;
BEGIN
 p:=public.employee_preview_v1('91000000-0000-0000-0000-000000000001',0,'create_employee',pg_temp.fields('Zoë 李 😀','A-1'),'Fixture reason',NULL,NULL);
 PERFORM pg_temp.assert_true(public.employee_page_v1('',NULL,1,25)->>'total'='0','preview is read only');
 first:=public.employee_command_v1('93000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',0,'create_employee',pg_temp.fields('Zoë 李 😀','A-1'),'Fixture reason',NULL,NULL,p->>'previewFingerprint');
 replay:=public.employee_command_v1('93000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',0,'create_employee',pg_temp.fields(' Zoë 李 😀 ',' A-1 '),' Fixture reason ',NULL,NULL,p->>'previewFingerprint');
 PERFORM pg_temp.assert_true(replay=first,'same operation returns identical receipt');
 PERFORM pg_temp.assert_true(public.employee_operation_v1('93000000-0000-0000-0000-000000000001','read')->'result'=first,'lost response recovers exact receipt');
 PERFORM pg_temp.assert_true(public.employee_operation_v1('93000000-0000-0000-0000-000000000001','abandon')->>'state'='completed','completed operation cannot be abandoned');
 before_version:=(public.employee_detail_v1('91000000-0000-0000-0000-000000000001')->>'version')::bigint;
 before_events:=(public.employee_audit_v1('91000000-0000-0000-0000-000000000001',1,100)->>'total')::bigint;
 PERFORM pg_temp.save('93000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001',1,'edit_employee',pg_temp.fields('Corrected','A-2'));
 after_version:=(public.employee_detail_v1('91000000-0000-0000-0000-000000000001')->>'version')::bigint;
 new_events:=(public.employee_audit_v1('91000000-0000-0000-0000-000000000001',1,100)->>'total')::bigint-before_events;
 PERFORM pg_temp.assert_true(after_version=before_version+1 AND new_events=1,'one change and one audit event');
 replay:=public.employee_command_v1('93000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',0,'create_employee',pg_temp.fields('Zoë 李 😀','A-1'),'Fixture reason',NULL,NULL,p->>'previewFingerprint');
 PERFORM pg_temp.assert_true(replay=first,'completed replay survives later record state changes');
 PERFORM pg_temp.expect_error(format('SELECT public.employee_command_v1(%L,%L,0,%L,%L::jsonb,%L,NULL,NULL,%L)','93000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','create_employee',pg_temp.fields('Different'),'Fixture reason',p->>'previewFingerprint'),'22023','OPERATION_REUSED');
END $$;
SELECT pg_temp.expect_error($q$SELECT pg_temp.save(gen_random_uuid(),'91000000-0000-0000-0000-000000000001',1,'edit_employee',pg_temp.fields('Stale'))$q$,'40001','VERSION_CONFLICT');
SELECT pg_temp.expect_error($q$SELECT pg_temp.save(gen_random_uuid(),'91000000-0000-0000-0000-000000000002',0,'create_employee',pg_temp.fields('Duplicate',' a-1 '))$q$,'23505','NUMBER_CLAIMED');
SELECT pg_temp.save('93000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000002',0,'create_employee',pg_temp.fields('Second'));
SELECT pg_temp.save('93000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000001',2,'save_initial_episode','{"startDate":null,"endDate":null,"sourceReference":null}');
SELECT pg_temp.expect_error($q$SELECT pg_temp.save(gen_random_uuid(),'91000000-0000-0000-0000-000000000001',3,'save_initial_episode','{"startDate":"2026-01-01","endDate":null,"sourceReference":"Verified fixture"}')$q$,'55000','WORKPLACE_TIMEZONE_UNCONFIRMED');
SELECT pg_temp.expect_error($q$SELECT pg_temp.save(gen_random_uuid(),'91000000-0000-0000-0000-000000000001',3,'add_employment_episode','{}')$q$,'22023','REHIRE_DEFERRED');
SELECT pg_temp.expect_error($q$SELECT public.employee_command_v1('93000000-0000-0000-0000-000000000099','91000000-0000-0000-0000-000000000001',3,'add_employment_episode','{}','Fixture reason',NULL,NULL,'irrelevant')$q$,'22023','REHIRE_DEFERRED');
SELECT pg_temp.assert_true(public.employee_operation_v1('93000000-0000-0000-0000-000000000099','read')->>'state'='absent','deferred request makes no operation');
RESET ROLE;
UPDATE private.employee_settings SET timezone='Asia/Jakarta',version=version+1;
SET LOCAL ROLE authenticated;
SELECT pg_temp.save('93000000-0000-0000-0000-000000000005','91000000-0000-0000-0000-000000000001',3,'save_initial_episode','{"startDate":"2026-01-01","endDate":"2026-10-01","sourceReference":null}', 'Correction reason','2026-01-01',NULL);
SELECT pg_temp.assert_true(public.employee_detail_v1('91000000-0000-0000-0000-000000000001')->'episode'->>'startDate'='2026-01-01','initial episode corrected without append');
CREATE TEMP TABLE linked_receipt AS SELECT public.employee_preview_v1('91000000-0000-0000-0000-000000000001',4,'link_account','{"userId":"92000000-0000-0000-0000-000000000005"}','Fixture reason',NULL,NULL) preview,NULL::jsonb receipt;
UPDATE linked_receipt SET receipt=public.employee_command_v1('93000000-0000-0000-0000-000000000006','91000000-0000-0000-0000-000000000001',4,'link_account','{"userId":"92000000-0000-0000-0000-000000000005"}','Fixture reason',NULL,NULL,preview->>'previewFingerprint');
SELECT pg_temp.expect_error($q$SELECT pg_temp.save(gen_random_uuid(),'91000000-0000-0000-0000-000000000002',1,'link_account','{"userId":"92000000-0000-0000-0000-000000000005"}')$q$,'23505','ACCOUNT_ALREADY_LINKED');
SELECT pg_temp.expect_error($q$SELECT pg_temp.save(gen_random_uuid(),'91000000-0000-0000-0000-000000000001',5,'link_account','{"userId":"92000000-0000-0000-0000-000000000006"}')$q$,'23505','EMPLOYEE_ALREADY_LINKED');
SELECT pg_temp.save('93000000-0000-0000-0000-000000000007','91000000-0000-0000-0000-000000000001',5,'quarantine_account_link','{"userId":"92000000-0000-0000-0000-000000000005"}');
SELECT pg_temp.assert_true(public.employee_detail_v1('91000000-0000-0000-0000-000000000001')->'account'->>'quarantined'='true','quarantine retains account');
SELECT pg_temp.assert_true(public.employee_command_v1('93000000-0000-0000-0000-000000000006','91000000-0000-0000-0000-000000000001',4,'link_account','{"userId":"92000000-0000-0000-0000-000000000005"}','Fixture reason',NULL,NULL,preview->>'previewFingerprint')=receipt,'completed link replay survives ownership/quarantine change') FROM linked_receipt;
SELECT pg_temp.expect_error($q$SELECT pg_temp.save(gen_random_uuid(),'91000000-0000-0000-0000-000000000002',1,'link_account','{"userId":"92000000-0000-0000-0000-000000000005"}')$q$,'23505','ACCOUNT_ALREADY_LINKED');
RESET ROLE;
UPDATE private.employee_settings SET timezone=NULL,version=version+1;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT public.employee_preview_v1('91000000-0000-0000-0000-000000000001',6,'save_initial_episode','{"startDate":null,"endDate":null,"sourceReference":null}','reason',NULL,NULL)$q$,'55000','WORKPLACE_TIMEZONE_UNCONFIRMED');
RESET ROLE;
UPDATE private.employee_settings SET timezone='Asia/Jakarta',version=version+1;
SET LOCAL ROLE authenticated;
-- Strict JSON shape, bounds, civil dates, explicit rejection-only action.
DO $$ DECLARE bad jsonb; BEGIN
 FOREACH bad IN ARRAY ARRAY['{}'::jsonb,'null','[]',pg_temp.fields('') ,pg_temp.fields(repeat('😀',161)),pg_temp.fields('Valid')||'{"extra":1}',pg_temp.fields('Valid')||'{"name":5}',pg_temp.fields('Valid')-'team'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT public.employee_preview_v1(%L,1,%L,%L::jsonb,%L,NULL,NULL)','91000000-0000-0000-0000-000000000002','edit_employee',bad,'Fixture reason'),'22023','INVALID_INPUT');
 END LOOP;
 FOREACH bad IN ARRAY ARRAY['{"startDate":"2026-02-30","endDate":null,"sourceReference":null}'::jsonb,'{"startDate":"2026-01-02","endDate":"2026-01-01","sourceReference":null}','{"startDate":5,"endDate":null,"sourceReference":null}','{"startDate":"infinity","endDate":null,"sourceReference":null}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT public.employee_preview_v1(%L,1,%L,%L::jsonb,%L,NULL,NULL)','91000000-0000-0000-0000-000000000002','save_initial_episode',bad,'Fixture reason'),'22023','INVALID_INPUT');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT public.employee_preview_v1('91000000-0000-0000-0000-000000000002',1,'activate_login','{}','reason',NULL,NULL)$q$,'22023','INVALID_ACTION');
SELECT pg_temp.assert_true(public.employee_operation_v1('93000000-0000-0000-0000-000000000008','read')->>'state'='absent','unknown outcome absent is explicit');
SELECT pg_temp.assert_true(public.employee_operation_v1('93000000-0000-0000-0000-000000000008','abandon')->>'state'='abandoned','abandon fences late create');
SELECT pg_temp.expect_error($q$SELECT pg_temp.save('93000000-0000-0000-0000-000000000008','91000000-0000-0000-0000-000000000003',0,'create_employee',pg_temp.fields('Late'))$q$,'55000','OPERATION_ABANDONED');
-- Preview changed account facts and configuration are rejected after preview.
CREATE TEMP TABLE previews AS SELECT public.employee_preview_v1('91000000-0000-0000-0000-000000000002',1,'link_account','{"userId":"92000000-0000-0000-0000-000000000006"}','Fixture reason',NULL,NULL) p;
RESET ROLE;
UPDATE public.users SET full_name='Changed account selection' WHERE id='92000000-0000-0000-0000-000000000006';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.employee_command_v1(%L,%L,1,%L,%L::jsonb,%L,NULL,NULL,%L)','93000000-0000-0000-0000-000000000009','91000000-0000-0000-0000-000000000002','link_account','{"userId":"92000000-0000-0000-0000-000000000006"}','Fixture reason',(SELECT p->>'previewFingerprint' FROM previews)),'40001','PREVIEW_CHANGED');
RESET ROLE;
UPDATE public.users SET full_name='Command fixture 6' WHERE id='92000000-0000-0000-0000-000000000006';
SET LOCAL ROLE authenticated;
UPDATE previews SET p=public.employee_preview_v1('91000000-0000-0000-0000-000000000002',1,'edit_employee',pg_temp.fields('Second updated'),'Fixture reason',NULL,NULL);
RESET ROLE;
UPDATE private.employee_settings SET version=version+1;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.employee_command_v1(%L,%L,1,%L,%L::jsonb,%L,NULL,NULL,%L)','93000000-0000-0000-0000-000000000009','91000000-0000-0000-0000-000000000002','edit_employee',pg_temp.fields('Second updated'),'Fixture reason',(SELECT p->>'previewFingerprint' FROM previews)),'40001','PREVIEW_CHANGED');
-- A genuine downstream audit failure must roll back every preceding command write.
RESET ROLE;
CREATE FUNCTION pg_temp.fail_employee_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END $$;
CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON private.employee_audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_employee_audit();
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.save('93000000-0000-0000-0000-000000000010','91000000-0000-0000-0000-000000000004',0,'create_employee',pg_temp.fields('Rollback','ROLLBACK-NUMBER'))$q$,'P0001','SYNTHETIC_AUDIT_FAILURE');
SELECT pg_temp.assert_true(public.employee_operation_v1('93000000-0000-0000-0000-000000000010','read')->>'state'='absent','audit failure leaves no receipt');
SELECT pg_temp.expect_error($q$SELECT pg_temp.save('93000000-0000-0000-0000-000000000011','91000000-0000-0000-0000-000000000002',1,'link_account','{"userId":"92000000-0000-0000-0000-000000000006"}')$q$,'P0001','SYNTHETIC_AUDIT_FAILURE');
SELECT pg_temp.expect_error($q$SELECT pg_temp.save('93000000-0000-0000-0000-000000000012','91000000-0000-0000-0000-000000000002',1,'save_initial_episode','{"startDate":null,"endDate":null,"sourceReference":null}')$q$,'P0001','SYNTHETIC_AUDIT_FAILURE');
SELECT pg_temp.assert_true(public.employee_detail_v1('91000000-0000-0000-0000-000000000002')->>'version'='1' AND public.employee_detail_v1('91000000-0000-0000-0000-000000000002')->'account'='null'::jsonb AND public.employee_detail_v1('91000000-0000-0000-0000-000000000002')->'episode'='null'::jsonb,'audit failures roll back account/episode/version');
SELECT pg_temp.expect_error($q$SELECT public.employee_detail_v1('91000000-0000-0000-0000-000000000004')$q$,'P0002','Employee not found');
RESET ROLE;
DROP TRIGGER synthetic_audit_failure ON private.employee_audit_events;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM private.employee_number_claims WHERE normalized_number='rollback-number') THEN RAISE EXCEPTION 'failed audit left number claim'; END IF; END $$;
SET LOCAL ROLE authenticated;
-- Whitespace follows JS trim, including Unicode; length is code points, not UTF-16 units.
SELECT pg_temp.assert_true(public.employee_preview_v1('91000000-0000-0000-0000-000000000002',1,'edit_employee',pg_temp.fields(chr(160)||E'\tName\n'||chr(65279),chr(12288)),' reason ',NULL,NULL)->'normalizedPayload'=pg_temp.fields('Name'),'Unicode outer whitespace normalized');
SELECT pg_temp.assert_true(public.employee_preview_v1('91000000-0000-0000-0000-000000000002',1,'edit_employee',pg_temp.fields(repeat('😀',160)),'reason',NULL,NULL)->'normalizedPayload'->>'name'=repeat('😀',160),'160 astral code points accepted');
SELECT pg_temp.expect_error($q$SELECT public.employee_preview_v1('91000000-0000-0000-0000-000000000002',1,'save_initial_episode','{"startDate":null,"endDate":null,"sourceReference":"One"}','reason',NULL,'Other')$q$,'22023','INVALID_INPUT');
-- Other actor cannot see receipt; current authority enforced before validation.
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(public.employee_operation_v1('93000000-0000-0000-0000-000000000001','read')->>'state'='absent','different actor has no receipt');
DO $$ DECLARE n integer; BEGIN FOR n IN 3..9 LOOP
 PERFORM set_config('request.jwt.claim.sub','92000000-0000-0000-0000-'||lpad(n::text,12,'0'),true);
 PERFORM pg_temp.expect_error($q$SELECT public.employee_preview_v1(NULL,NULL,'add_employment_episode',NULL,NULL,NULL,NULL)$q$,'42501','DIRECTOR_REQUIRED');
 PERFORM pg_temp.expect_error($q$SELECT public.employee_command_v1(NULL,NULL,NULL,'add_employment_episode',NULL,NULL,NULL,NULL,NULL)$q$,'42501','DIRECTOR_REQUIRED');
 PERFORM pg_temp.expect_error($q$SELECT public.employee_operation_v1('93000000-0000-0000-0000-000000000001','read')$q$,'42501','DIRECTOR_REQUIRED');
END LOOP; END $$;
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_denied('UPDATE private.employee_audit_events SET reason=''tampered''','42501');
SELECT pg_temp.assert_denied('DELETE FROM private.employee_operations','42501');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT users FROM baseline) IS DISTINCT FROM (SELECT md5(string_agg(to_jsonb(u)::text,',' ORDER BY id)) FROM public.users u) THEN RAISE EXCEPTION 'account access/profile side effect'; END IF;
 IF (SELECT leave_scope FROM baseline) IS DISTINCT FROM (SELECT version FROM private.ihr_leave_scope_revision WHERE singleton) THEN RAISE EXCEPTION 'leave scope changed'; END IF;
 IF (SELECT count(*) FROM private.employee_episodes)<>1 THEN RAISE EXCEPTION 'additional episode inserted'; END IF;
 IF (SELECT count(*) FROM private.employee_number_claims WHERE employee_id='91000000-0000-0000-0000-000000000001')<>2 THEN RAISE EXCEPTION 'number claims not retained'; END IF;
 IF (SELECT count(*) FROM private.employee_audit_events)<>7 OR (SELECT count(*) FROM private.employee_operations WHERE state='completed')<>7 THEN RAISE EXCEPTION 'failed command left changes'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied($q$SELECT public.employee_operation_v1(gen_random_uuid(),'read')$q$,'42501');
RESET ROLE;
