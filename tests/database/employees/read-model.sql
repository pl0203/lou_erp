-- Transaction-neutral body; run only through run-reads.sql.
-- Disposable fictional data only. Assertions run as actual non-bypass API roles.
INSERT INTO auth.users(id) VALUES('82000000-0000-0000-0000-000000000001');
INSERT INTO public.users(id,full_name,email,role,is_active)
VALUES('82000000-0000-0000-0000-000000000001','Fictional Director','employee-director@example.invalid','executive',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
-- No leave membership, no calendar grant and no confirmed timezone is needed.
SELECT pg_temp.assert_true(public.employee_page_v1('',NULL,1,25)->>'total'='0','new employee tables start empty');
SELECT pg_temp.assert_true(public.employee_context_v1()->>'canMaintainBasic'='true','current active executive independent of leave membership');
SELECT pg_temp.assert_true(public.employee_context_v1()->'timezone'='null'::jsonb AND public.employee_context_v1()->'today'='null'::jsonb,'timezone and today remain explicitly unknown');
SELECT pg_temp.assert_true(public.employee_context_v1()->'setupBlockers'='["WORKPLACE_TIMEZONE_UNCONFIRMED"]'::jsonb,'unconfirmed workplace setup is explicit');
RESET ROLE;
\ir seed.sql
SET LOCAL ROLE anon;
SELECT pg_temp.assert_denied('SELECT public.employee_context_v1()','42501');
SELECT pg_temp.assert_denied($s$SELECT public.employee_page_v1('',NULL,1,25)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.employee_detail_v1('81000000-0000-0000-0000-000000000001')$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.employee_audit_v1('81000000-0000-0000-0000-000000000001',1,25)$s$,'42501');
SELECT pg_temp.assert_denied($s$SELECT public.employee_account_candidates_v1('',1,25)$s$,'42501');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['employee_records','employee_number_claims','employee_account_links','employee_episodes','employee_reporting_revisions','employee_reporting_intervals','employee_audit_events','employee_operations','employee_settings','employee_reporting_guard'] LOOP
  PERFORM pg_temp.assert_denied(format('SELECT * FROM private.%I',t),'42501');
 END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; t text; BEGIN
 FOR n IN 2..9 LOOP
  PERFORM set_config('request.jwt.claim.sub',('82000000-0000-0000-0000-'||lpad(n::text,12,'0')),true);
  -- Token metadata lies deliberately: authorization must read current public.users.
  PERFORM set_config('request.jwt.claims','{"role":"executive","user_metadata":{"role":"executive"}}',true);
  PERFORM pg_temp.assert_true(public.employee_context_v1()->>'canMaintainBasic'='false','non-Director/inactive/missing profile denied');
  PERFORM pg_temp.assert_denied($s$SELECT public.employee_page_v1('',NULL,1,25)$s$,'42501');
  PERFORM pg_temp.assert_denied($s$SELECT public.employee_detail_v1('81000000-0000-0000-0000-000000000001')$s$,'42501');
  PERFORM pg_temp.assert_denied($s$SELECT public.employee_detail_v1('81000000-0000-0000-0000-000000000999')$s$,'42501');
  PERFORM pg_temp.assert_denied($s$SELECT public.employee_audit_v1('81000000-0000-0000-0000-000000000001',1,25)$s$,'42501');
  PERFORM pg_temp.assert_denied($s$SELECT public.employee_account_candidates_v1('',1,25)$s$,'42501');
  FOREACH t IN ARRAY ARRAY['employee_records','employee_number_claims','employee_account_links','employee_episodes','employee_reporting_revisions','employee_reporting_intervals','employee_audit_events','employee_operations','employee_settings','employee_reporting_guard'] LOOP
   PERFORM pg_temp.assert_denied(format('SELECT * FROM private.%I',t),'42501');
   PERFORM pg_temp.assert_denied(format('DELETE FROM private.%I',t),'42501');
  END LOOP;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['employee_records','employee_number_claims','employee_account_links','employee_episodes','employee_reporting_revisions','employee_reporting_intervals','employee_audit_events','employee_operations','employee_settings','employee_reporting_guard'] LOOP
  PERFORM pg_temp.assert_denied(format('SELECT * FROM private.%I',t),'42501');
  PERFORM pg_temp.assert_denied(format('DELETE FROM private.%I',t),'42501');
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM pg_temp.assert_denied('SELECT public.employee_context_v1()','42501');
END $$;
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['employee_records','employee_number_claims','employee_account_links','employee_episodes','employee_reporting_revisions','employee_reporting_intervals','employee_audit_events','employee_operations','employee_settings','employee_reporting_guard'] LOOP
  PERFORM pg_temp.assert_denied(format('SELECT * FROM private.%I',t),'42501');
 END LOOP;
END $$;
SELECT pg_temp.assert_true(public.employee_page_v1('%',NULL,1,25)->>'total'='1','percent searched literally');
SELECT pg_temp.assert_true(public.employee_page_v1('_',NULL,1,25)->>'total'='0','underscore searched literally');
SELECT pg_temp.assert_true(public.employee_page_v1(E'\\',NULL,1,25)->>'total'='0','backslash searched literally');
SELECT pg_temp.assert_true(public.employee_page_v1('李',NULL,1,25)->'rows'->0->>'name'='Zoë 李 👩🏽‍💻','Unicode preserved');
SELECT pg_temp.assert_true(public.employee_page_v1('emp-001',NULL,1,25)->>'total'='1','employee number matched case-insensitively');
SELECT pg_temp.assert_true(public.employee_page_v1('','draft',1,25)->>'total'='2','recorded status filter');
SELECT pg_temp.assert_true(public.employee_page_v1('',NULL,1,2)->'rows'->1->>'id'='81000000-0000-0000-0000-000000000002','stable name/id paging');
SELECT pg_temp.assert_true(public.employee_page_v1('',NULL,2,2)->'rows'->0->>'id'='81000000-0000-0000-0000-000000000004','no duplicate or missing page boundary');
SELECT pg_temp.assert_true(public.employee_page_v1('',NULL,999999999,100)->'rows'='[]'::jsonb,'large page offset is safe');
SELECT pg_temp.assert_denied($s$SELECT public.employee_page_v1('',NULL,0,25)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.employee_page_v1('',NULL,1,101)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.employee_page_v1('',NULL,NULL,25)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.employee_page_v1('', 'unknown',1,25)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.employee_page_v1(repeat('李',121),NULL,1,25)$s$,'22023');
SELECT pg_temp.assert_denied($s$SELECT public.employee_detail_v1('81000000-0000-0000-0000-000000000999')$s$,'P0002');
SELECT pg_temp.assert_denied($s$SELECT public.employee_detail_v1(NULL)$s$,'22023');
SELECT pg_temp.assert_true(public.employee_detail_v1('81000000-0000-0000-0000-000000000001')->'episode'='{"startDate":null,"endDate":null,"sourceReference":null}'::jsonb,'unknown episode dates remain unknown');
SELECT pg_temp.assert_true(public.employee_detail_v1('81000000-0000-0000-0000-000000000001')->'warnings' ? 'ENDED_EMPLOYMENT_ACTIVE_LOGIN','ended employment does not switch active login');
SELECT pg_temp.assert_true(public.employee_detail_v1('81000000-0000-0000-0000-000000000002')->'warnings' ? 'ACTIVE_EMPLOYMENT_INACTIVE_LOGIN','inactive login mismatch labelled');
SELECT pg_temp.assert_true(public.employee_detail_v1('81000000-0000-0000-0000-000000000001')->'warnings' ? 'ACCOUNT_LINK_QUARANTINED','quarantine labelled');
SELECT pg_temp.assert_true(public.employee_detail_v1('81000000-0000-0000-0000-000000000001')->'warnings' ? 'REPORTING_COMPARISON_UNAVAILABLE','unknown workplace date never assumed equal');
SELECT pg_temp.assert_true(public.employee_detail_v1('81000000-0000-0000-0000-000000000001')::text NOT LIKE '%PRIVATE_PHONE_SENTINEL%','detail has no arbitrary profile columns');
SELECT pg_temp.assert_true(public.employee_audit_v1('81000000-0000-0000-0000-000000000001',1,1)->'rows'->0->>'id'='83000000-0000-0000-0000-000000000002','audit recordedAt/id descending');
SELECT pg_temp.assert_true(public.employee_audit_v1('81000000-0000-0000-0000-000000000001',1,25)::text NOT LIKE '%PRIVATE_AUDIT_SENTINEL%','audit recursively allowlists safe sections');
SELECT pg_temp.assert_true(public.employee_account_candidates_v1('employee-fixture-7',1,25)->'rows'->0->>'active'='false','inactive accounts are visible for explicit checked selection');
SELECT pg_temp.assert_true(public.employee_account_candidates_v1('employee-fixture-4',1,25)->'rows'->0->>'linkState'='quarantined','candidate quarantine explicit');
SELECT pg_temp.assert_true(public.employee_account_candidates_v1('',1,25)::text NOT LIKE '%PRIVATE_PHONE_SENTINEL%','candidate has no arbitrary profile columns');
SELECT pg_temp.assert_denied($s$SELECT public.employee_audit_v1('81000000-0000-0000-0000-000000000999',1,25)$s$,'P0002');
SELECT pg_temp.assert_denied($s$SELECT public.employee_account_candidates_v1('',1,0)$s$,'22023');
RESET ROLE;
-- Workplace configuration is owner-only; this is a rolled-back local fixture, never an activation.
UPDATE private.employee_settings SET timezone='Asia/Jakarta',version=2 WHERE singleton;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.employee_context_v1()->>'today'=to_char(statement_timestamp() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD'),'today is workplace civil date');
SELECT pg_temp.assert_true(public.employee_detail_v1('81000000-0000-0000-0000-000000000001')->'warnings' ? 'REPORTING_ACCESS_MANAGER_UNCOMPARABLE','unlinked HR manager is incomparable');
RESET ROLE;
-- Owner-only synthetic state proves a comparable manager mismatch is labelled.
UPDATE private.employee_account_links SET quarantined=false WHERE employee_id='81000000-0000-0000-0000-000000000001';
INSERT INTO private.employee_account_links(employee_id,user_id)
VALUES('81000000-0000-0000-0000-000000000003','82000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.employee_detail_v1('81000000-0000-0000-0000-000000000001')->'warnings' ? 'REPORTING_ACCESS_MANAGER_MISMATCH','distinct comparable HR and operational managers are labelled');
SELECT pg_temp.assert_denied('SELECT private.employee_require_director()','42501');
SELECT pg_temp.assert_denied($s$SELECT private.employee_audit_projection('{}')$s$,'42501');
SELECT pg_temp.assert_true((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(public.employee_detail_v1('81000000-0000-0000-0000-000000000001')) key)=ARRAY['account','episode','fields','id','reporting','reportingRevision','version','warnings'],'detail exact allowlisted envelope');
SELECT pg_temp.assert_true(public.employee_audit_v1('81000000-0000-0000-0000-000000000001',1,25)->'rows'->0->>'recordedAt' LIKE '%Z','audit timestamp explicit UTC');
RESET ROLE;
-- Lifetime and history FKs deny cascading identity loss. This owner-level fixture
-- verifies storage invariants, not the permission assertions above.
DO $$ BEGIN
 BEGIN INSERT INTO private.employee_number_claims(normalized_number,employee_id) VALUES('emp-001','81000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'duplicate lifetime number accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN INSERT INTO private.employee_account_links(employee_id,user_id) VALUES('81000000-0000-0000-0000-000000000004','82000000-0000-0000-0000-000000000004'); RAISE EXCEPTION 'account reused'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN INSERT INTO private.employee_account_links(employee_id,user_id) VALUES('81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000005'); RAISE EXCEPTION 'second link accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN INSERT INTO private.employee_episodes(employee_id,episode_number) VALUES('81000000-0000-0000-0000-000000000004',2); RAISE EXCEPTION 'rehire storage accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM private.employee_records WHERE id='81000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'employee cascaded history'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN DELETE FROM public.users WHERE id='82000000-0000-0000-0000-000000000004'; RAISE EXCEPTION 'linked account deletion cascaded'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
-- RLS stays deny-all even if a future accidental SELECT grant is added.
GRANT SELECT ON private.employee_records TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM private.employee_records)=0,'RLS denies direct reads even for Director with accidental grant');
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.employee_context_v1(); RAISE EXCEPTION 'service_role executed employee context'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.employee_page_v1('',NULL,1,25); RAISE EXCEPTION 'service_role executed employee page'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.employee_detail_v1('81000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'service_role executed employee detail'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.employee_audit_v1('81000000-0000-0000-0000-000000000001',1,25); RAISE EXCEPTION 'service_role executed employee audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.employee_account_candidates_v1('',1,25); RAISE EXCEPTION 'service_role executed employee candidates'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM private.employee_records; RAISE EXCEPTION 'service_role read private employees'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
