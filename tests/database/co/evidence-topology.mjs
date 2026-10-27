// Rollback-only synthetic drift probes. The fixed runner invokes this before migration08.
import assert from 'node:assert/strict'
import { stripMigrationTransaction } from '../../../scripts/assemble-read-rollout.mjs'
const literal = value => `'${value.replaceAll("'", "''")}'`
export function buildEvidenceTopologyChecks(migration) {
 const body=stripMigrationTransaction(migration,true)
 assert.ok(!body.includes('$co_evidence_topology$'),'Test delimiter collision')
 return `BEGIN;
SET LOCAL standard_conforming_strings=on;
CREATE TEMP TABLE co_evidence_topology_original ON COMMIT DROP AS SELECT oid,to_jsonb(p) metadata FROM pg_proc p;
DO $co_evidence_topology$
DECLARE candidate text:=${literal(body)}; signature text; original text; definition text; altered text; variant integer; rejected boolean; observed jsonb; cases integer:=0;
BEGIN
 FOREACH signature IN ARRAY ARRAY['private.co_monthly_transaction_v1(uuid,text,jsonb)','private.co_publish_reviewed_v1(uuid,uuid,uuid,text,jsonb,text)'] LOOP
  SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid=signature::regprocedure;
  definition:=pg_get_functiondef(signature::regprocedure);
  RAISE NOTICE 'Original publication metadata %: %',signature,(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=signature::regprocedure);
  FOR variant IN 1..10 LOOP
   altered:=CASE variant WHEN 1 THEN '/* BEGIN misleading executable site */'||chr(10)||original WHEN 2 THEN '/* outer /* UPDATE private.co_report_heads nested */ comment */'||chr(10)||original ELSE original||chr(10)||'-- Unreviewed drift' END;
   IF variant=4 THEN EXECUTE format('ALTER FUNCTION %s SET search_path=public',signature);
   ELSIF variant=5 THEN EXECUTE format('ALTER FUNCTION %s OWNER TO service_role',signature);
   ELSIF variant=6 THEN EXECUTE format('ALTER FUNCTION %s STRICT',signature);
   ELSIF variant=7 THEN EXECUTE format('ALTER FUNCTION %s PARALLEL SAFE',signature);
   ELSIF variant=8 THEN EXECUTE format('ALTER FUNCTION %s LEAKPROOF',signature);
   ELSIF variant=9 THEN EXECUTE format('ALTER FUNCTION %s COST 101',signature);
   ELSIF variant=10 THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',signature);
   ELSE EXECUTE replace(definition,original,altered); END IF;
   SELECT to_jsonb(p) INTO observed FROM pg_proc p WHERE oid=signature::regprocedure;
   rejected:=false;
   BEGIN EXECUTE candidate;
   EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> (CASE WHEN variant>=4 THEN 'Unreviewed evidence publication metadata: ' ELSE 'Unreviewed evidence publication body: ' END||signature) THEN RAISE; END IF;
    rejected:=true;
   END;
   IF NOT rejected THEN RAISE EXCEPTION 'Evidence topology drift accepted: %, %',signature,variant; END IF;
   IF (SELECT to_jsonb(p) FROM pg_proc p WHERE oid=signature::regprocedure) IS DISTINCT FROM observed THEN RAISE EXCEPTION 'Rejected migration mutated drifted function'; END IF;
   IF EXISTS(SELECT 1 FROM co_evidence_topology_original b JOIN pg_proc p ON p.oid=b.oid WHERE p.oid<>signature::regprocedure AND to_jsonb(p) IS DISTINCT FROM b.metadata) OR to_regclass('private.co_evidence') IS NOT NULL OR EXISTS(SELECT 1 FROM storage.buckets WHERE id='co-evidence') THEN RAISE EXCEPTION 'Rejected migration leaked changes'; END IF;
   EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',signature);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role',signature);
   EXECUTE definition;
   IF (SELECT to_jsonb(p) FROM pg_proc p WHERE oid=signature::regprocedure) IS DISTINCT FROM (SELECT metadata FROM co_evidence_topology_original WHERE oid=signature::regprocedure) THEN RAISE EXCEPTION 'Probe failed to restore original metadata'; END IF;
   cases:=cases+1;
  END LOOP;
 END LOOP;
 RAISE NOTICE 'Verified % evidence publication drift cases',cases;
END $co_evidence_topology$;
ROLLBACK;
SELECT 'CO_EVIDENCE_TOPOLOGY_PASSED';
`
}
