-- Fixed rollback-only synthetic reporting assertions. No real identities.
SET LOCAL TimeZone='UTC';
INSERT INTO auth.users(id) VALUES('72000000-0000-0000-0000-000000000001'),('72000000-0000-0000-0000-000000000002');
INSERT INTO public.users(id,full_name,email,role,is_active) VALUES
 ('72000000-0000-0000-0000-000000000001','Reporting Director','reporting-director@example.invalid','executive',true),
 ('72000000-0000-0000-0000-000000000002','Inactive historical manager','reporting-ended@example.invalid','sales_person',false);
CREATE FUNCTION pg_temp.e(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('71000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
INSERT INTO private.employee_records(id,name,recorded_status) SELECT pg_temp.e(n),'Reporting employee '||n,CASE WHEN n=2 THEN 'ended' ELSE 'draft' END FROM generate_series(1,20)n;
INSERT INTO private.employee_account_links(user_id,employee_id) VALUES('72000000-0000-0000-0000-000000000002',pg_temp.e(2));
CREATE TEMP TABLE legacy_baseline AS SELECT md5(string_agg(to_jsonb(u)::text,',' ORDER BY id)) users,(SELECT version FROM private.ihr_leave_scope_revision WHERE singleton) scope FROM public.users u;
CREATE FUNCTION pg_temp.edge(manager integer,f text,u text DEFAULT NULL) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('managerEmployeeId',pg_temp.e(manager),'from',f,'until',u) $$;
CREATE FUNCTION pg_temp.proposal(i jsonb,mode text DEFAULT 'schedule') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('mode',mode,'intervals',i) $$;
CREATE FUNCTION pg_temp.preview(e integer,p jsonb,source text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.employee_preview_v1(pg_temp.e(e),(public.employee_detail_v1(pg_temp.e(e))->>'version')::bigint,'save_reporting',p,'Reporting fixture',NULL,source) $$;
CREATE FUNCTION pg_temp.save(e integer,p jsonb,source text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE preview jsonb; BEGIN preview:=pg_temp.preview(e,p,source); RETURN public.employee_command_v1(gen_random_uuid(),pg_temp.e(e),(preview->>'expectedVersion')::bigint,'save_reporting',p,'Reporting fixture',NULL,source,preview->>'previewFingerprint'); END $$;
CREATE FUNCTION pg_temp.expect_error(statement text,code text,reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_code text; actual_reason text; BEGIN
 PERFORM pg_temp.assert_true(true,'application-role assertions');
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_code=RETURNED_SQLSTATE,actual_reason=MESSAGE_TEXT; END;
 PERFORM pg_temp.assert_true(actual_code=code AND actual_reason=reason,format('expected %s/%s, got %s/%s',code,reason,actual_code,actual_reason)); END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000001',true);
-- First behavioral assertion must reach unsupported save_reporting, never setup failure.
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(1,pg_temp.proposal('[]'))$q$,'55000','WORKPLACE_TIMEZONE_UNCONFIRMED');
RESET ROLE;
UPDATE private.employee_settings SET timezone='Asia/Jakarta',version=version+1;
SET LOCAL ROLE authenticated;
-- Explicit empty timeline is valid, still unknown rather than invented root coverage.
SELECT pg_temp.assert_true(pg_temp.preview(1,pg_temp.proposal('[]'))->'normalizedPayload'=pg_temp.proposal('[]'),'empty replacement accepted');
SELECT pg_temp.assert_true(public.employee_detail_v1(pg_temp.e(1))->>'reportingRevision'='0','preview never creates history');
-- Strict interval objects, date types, bounds and modes.
DO $$ DECLARE bad jsonb; BEGIN
 FOREACH bad IN ARRAY ARRAY['null'::jsonb,'[]','{}','{"mode":"schedule","intervals":null}','{"mode":"schedule","intervals":{},"extra":1}',
  '{"mode":"schedule","intervals":[null]}','{"mode":"schedule","intervals":[{"managerEmployeeId":null,"from":null,"until":null}]}',
  '{"mode":"schedule","intervals":[{"managerEmployeeId":4,"from":"2026-11-01","until":null}]}',
  '{"mode":"schedule","intervals":[{"managerEmployeeId":"bad","from":"2026-11-01","until":null}]}',
  '{"mode":"schedule","intervals":[{"managerEmployeeId":null,"from":"2026-02-30","until":null}]}',
  '{"mode":"schedule","intervals":[{"managerEmployeeId":null,"from":"2026-11-01","until":"2026-11-01"}]}',
  '{"mode":"schedule","intervals":[{"managerEmployeeId":null,"from":"2026-11-02","until":"2026-11-01"}]}',
  '{"mode":"schedule","intervals":[{"managerEmployeeId":null,"from":"infinity","until":null}]}',
  '{"mode":"schedule","intervals":[{"managerEmployeeId":null,"from":"2026-11-01"}]}',
  '{"mode":"schedule","intervals":[{"managerEmployeeId":null,"from":"2026-11-01","until":null,"extra":1}]}',
  '{"mode":"unknown","intervals":[]}','{"mode":null,"intervals":[]}','{"mode":"schedule","intervals":[],"extra":1}'] LOOP
  PERFORM pg_temp.expect_error(format('SELECT pg_temp.preview(1,%L::jsonb)',bad),'22023','INVALID_INPUT');
 END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(1,pg_temp.proposal(jsonb_build_array(pg_temp.edge(1,'2026-11-01'))))$q$,'22023','REPORTING_SELF_REFERENCE');
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(1,pg_temp.proposal(jsonb_build_array(pg_temp.edge(2,'2026-11-01'),pg_temp.edge(NULL,'2026-12-01'))))$q$,'22023','REPORTING_OVERLAP');
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(1,pg_temp.proposal(jsonb_build_array(pg_temp.edge(99,'2026-11-01'))))$q$,'P0002','MANAGER_NOT_FOUND');
SELECT pg_temp.expect_error($q$SELECT public.employee_preview_v1(pg_temp.e(99),1,'save_reporting',pg_temp.proposal('[]'),'reason',NULL,NULL)$q$,'P0002','EMPLOYEE_NOT_FOUND');
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(1,pg_temp.proposal('[]','correction'),'   ')$q$,'22023','CORRECTION_SOURCE_REQUIRED');
SELECT pg_temp.expect_error($q$SELECT public.employee_preview_v1(pg_temp.e(1),1,'save_reporting',pg_temp.proposal('[]','correction'),' ',NULL,'Evidence')$q$,'22023','INVALID_INPUT');
-- Explicit root, an ended/inactive linked manager, and an unlinked manager are eligible.
SELECT pg_temp.save(3,pg_temp.proposal(jsonb_build_array(pg_temp.edge(NULL,'2026-11-01')),'correction'),'Root evidence');
SELECT pg_temp.save(1,pg_temp.proposal(jsonb_build_array(pg_temp.edge(2,'2026-11-01','2026-12-01')),'correction'),'Evidence A');
SELECT pg_temp.assert_true(public.employee_detail_v1(pg_temp.e(1))->'reporting'=jsonb_build_array(pg_temp.edge(2,'2026-11-01','2026-12-01')),'inactive historical manager retained');
-- November overlap cycles, December adjacency is a legal union-graph cycle.
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(2,pg_temp.proposal(jsonb_build_array(pg_temp.edge(1,'2026-11-20','2026-12-02')),'correction'),'Evidence')$q$,'22023','REPORTING_CYCLE');
SELECT pg_temp.save(2,pg_temp.proposal(jsonb_build_array(pg_temp.edge(1,'2026-12-01')),'correction'),'Evidence B');
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(1,pg_temp.proposal(jsonb_build_array(pg_temp.edge(2,'2026-11-01')),'correction'),'Evidence')$q$,'22023','REPORTING_CYCLE');
-- A three-edge future-only cycle with finite/infinite boundaries.
SELECT pg_temp.save(4,pg_temp.proposal(jsonb_build_array(pg_temp.edge(5,'9998-01-01','9999-01-01'))));
SELECT pg_temp.save(5,pg_temp.proposal(jsonb_build_array(pg_temp.edge(6,'9998-06-01'))));
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(6,pg_temp.proposal(jsonb_build_array(pg_temp.edge(4,'9998-12-31'))))$q$,'22023','REPORTING_CYCLE');
SELECT pg_temp.save(6,pg_temp.proposal(jsonb_build_array(pg_temp.edge(4,'9999-01-01'))));
-- Pairwise overlaps are insufficient: every edge must share a single instant.
SELECT pg_temp.save(7,pg_temp.proposal(jsonb_build_array(pg_temp.edge(8,'9997-01-01','9997-04-01'))));
SELECT pg_temp.save(8,pg_temp.proposal(jsonb_build_array(pg_temp.edge(9,'9997-03-01','9997-06-01'))));
SELECT pg_temp.save(9,pg_temp.proposal(jsonb_build_array(pg_temp.edge(7,'9997-05-01','9997-08-01'))));
-- Historical schedule semantics compare coverage, not raw segmentation.
SELECT pg_temp.save(10,pg_temp.proposal(jsonb_build_array(pg_temp.edge(NULL,'2020-01-01','2020-02-01'),pg_temp.edge(11,'2020-03-01')),'correction'),'Verified historic source');
SELECT pg_temp.save(10,pg_temp.proposal(jsonb_build_array(pg_temp.edge(11,'2020-04-01'),pg_temp.edge(NULL,'2020-01-01','2020-02-01'),pg_temp.edge(11,'2020-03-01','2020-04-01'))));
SELECT pg_temp.assert_true(public.employee_detail_v1(pg_temp.e(10))->'reporting'->0->>'from'='2020-01-01','timeline normalized into chronological order');
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(10,pg_temp.proposal(jsonb_build_array(pg_temp.edge(11,'2020-03-01'))))$q$,'55000','REPORTING_HISTORY_CHANGE');
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(10,pg_temp.proposal(jsonb_build_array(pg_temp.edge(NULL,'2020-01-01','2020-03-01'),pg_temp.edge(11,'2020-03-01'))))$q$,'55000','REPORTING_HISTORY_CHANGE');
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(10,pg_temp.proposal('[]'))$q$,'55000','REPORTING_HISTORY_CHANGE');
-- Correction can replace unknown gaps, with reason/source and old history retained.
SELECT pg_temp.save(10,pg_temp.proposal(jsonb_build_array(pg_temp.edge(NULL,'2020-01-01','2020-03-01'),pg_temp.edge(11,'2020-03-01')),'correction'),'  Historical source  ');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(public.employee_audit_v1(pg_temp.e(10),1,100)->'rows')a WHERE a->>'sourceReference'='Historical source' AND a->>'reason'='Reporting fixture' AND a->'before'->'reporting'<>a->'after'->'reporting'),'correction audit carries before/after and evidence');
-- Browser/session zones cannot change workplace civil today or previews.
DO $$ DECLARE local_today date:=(public.employee_context_v1()->>'today')::date; p jsonb; first jsonb; second jsonb; BEGIN
 p:=pg_temp.proposal(jsonb_build_array(pg_temp.edge(12,to_char(local_today,'YYYY-MM-DD'))));
 PERFORM set_config('TimeZone','Pacific/Kiritimati',true);first:=pg_temp.preview(13,p);
 PERFORM set_config('TimeZone','Etc/GMT+12',true);second:=pg_temp.preview(13,p);
 PERFORM pg_temp.assert_true(first=second AND (public.employee_context_v1()->>'today')::date=local_today,'timezone extremes do not change workplace dates');
 PERFORM pg_temp.save(13,p);
 PERFORM pg_temp.expect_error(format('SELECT pg_temp.preview(13,%L::jsonb)',pg_temp.proposal(jsonb_build_array(pg_temp.edge(12,to_char(local_today-1,'YYYY-MM-DD'))))),'55000','REPORTING_HISTORY_CHANGE');
END $$;
SET LOCAL TimeZone='UTC';
-- Global graph changes invalidate another employee's preview, not basic-edit previews.
CREATE TEMP TABLE pending AS SELECT pg_temp.preview(14,pg_temp.proposal(jsonb_build_array(pg_temp.edge(15,'9998-01-01')))) p;
SELECT pg_temp.save(16,pg_temp.proposal('[]'));
SELECT pg_temp.expect_error(format('SELECT public.employee_command_v1(gen_random_uuid(),%L,1,%L,%L::jsonb,%L,NULL,NULL,%L)',pg_temp.e(14),'save_reporting',(SELECT p->'normalizedPayload' FROM pending),'Reporting fixture',(SELECT p->>'previewFingerprint' FROM pending)),'40001','PREVIEW_CHANGED');
-- Same-operation replay remains exact even after further reporting revisions/graph edits.
CREATE TEMP TABLE replay AS SELECT pg_temp.preview(14,pg_temp.proposal(jsonb_build_array(pg_temp.edge(15,'9998-01-01')))) p,NULL::jsonb receipt;
UPDATE replay SET receipt=public.employee_command_v1('73000000-0000-0000-0000-000000000001',pg_temp.e(14),1,'save_reporting',p->'normalizedPayload','Reporting fixture',NULL,NULL,p->>'previewFingerprint');
SELECT pg_temp.save(14,pg_temp.proposal(jsonb_build_array(pg_temp.edge(NULL,'9998-01-01'))));
SELECT pg_temp.assert_true(public.employee_command_v1('73000000-0000-0000-0000-000000000001',pg_temp.e(14),1,'save_reporting',p->'normalizedPayload','Reporting fixture',NULL,NULL,p->>'previewFingerprint')=receipt,'exact completed replay survives changed graph') FROM replay;
SELECT pg_temp.assert_true(public.employee_detail_v1(pg_temp.e(14))->>'version'='3' AND public.employee_audit_v1(pg_temp.e(14),1,100)->>'total'='2','each accepted reporting operation advances once');
-- Downstream audit failure rolls back graph guard, revision, intervals, version and receipt.
RESET ROLE;
CREATE TEMP TABLE before_failure AS SELECT (SELECT revision FROM private.employee_reporting_guard) graph,(SELECT reporting_revision FROM private.employee_records WHERE id=pg_temp.e(17)) revision,(SELECT count(*) FROM private.employee_reporting_intervals) intervals;
CREATE FUNCTION pg_temp.fail_reporting_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_REPORTING_AUDIT_FAILURE'; END $$;
CREATE TRIGGER synthetic_reporting_failure BEFORE INSERT ON private.employee_audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_reporting_audit();
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT pg_temp.save(17,pg_temp.proposal(jsonb_build_array(pg_temp.edge(18,'9998-01-01'))))$q$,'P0001','SYNTHETIC_REPORTING_AUDIT_FAILURE');
SELECT pg_temp.assert_true(public.employee_detail_v1(pg_temp.e(17))->>'version'='1' AND public.employee_audit_v1(pg_temp.e(17),1,100)->>'total'='0','failed reporting command has no employee/audit residue');
RESET ROLE;
DROP TRIGGER synthetic_reporting_failure ON private.employee_audit_events;
DO $$ BEGIN
 IF NOT (SELECT b.graph=g.revision AND b.revision=e.reporting_revision AND b.intervals=(SELECT count(*) FROM private.employee_reporting_intervals) FROM before_failure b CROSS JOIN private.employee_reporting_guard g CROSS JOIN private.employee_records e WHERE e.id=pg_temp.e(17)) THEN RAISE EXCEPTION 'failed reporting command left graph/history residue'; END IF;
 IF (SELECT count(*) FROM private.employee_reporting_revisions WHERE employee_id=pg_temp.e(10))<>3 OR NOT EXISTS(SELECT 1 FROM private.employee_reporting_intervals WHERE employee_id=pg_temp.e(10) AND revision=1 AND from_date='2020-01-01' AND until_date='2020-02-01' AND manager_employee_id IS NULL) THEN RAISE EXCEPTION 'earlier revisions were mutated'; END IF;
 IF (SELECT revision FROM private.employee_reporting_guard)<>(SELECT count(*) FROM private.employee_reporting_revisions) THEN RAISE EXCEPTION 'graph revision must advance once per accepted operation'; END IF;
 IF (SELECT users FROM legacy_baseline)<>(SELECT md5(string_agg(to_jsonb(u)::text,',' ORDER BY id)) FROM public.users u) OR (SELECT scope FROM legacy_baseline)<>(SELECT version FROM private.ihr_leave_scope_revision) THEN RAISE EXCEPTION 'reporting changed legacy users/scope'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_denied($q$UPDATE private.employee_reporting_revisions SET source_reference='tamper'$q$,'42501');
SELECT pg_temp.assert_denied($q$DELETE FROM private.employee_reporting_intervals$q$,'42501');
SELECT set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.expect_error($q$SELECT public.employee_preview_v1(pg_temp.e(1),1,'save_reporting',pg_temp.proposal('[]'),'reason',NULL,NULL)$q$,'42501','DIRECTOR_REQUIRED');
RESET ROLE;
-- A missing serialization row must fail closed, not silently bypass graph locking.
DELETE FROM private.employee_reporting_guard;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.preview(20,pg_temp.proposal('[]'))$q$,'55000','REPORTING_GRAPH_UNAVAILABLE');
RESET ROLE;
