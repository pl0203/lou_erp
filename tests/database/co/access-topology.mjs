// Test packet construction only; executed by the fixed fresh-Postgres runner.
import assert from 'node:assert/strict'
import { stripMigrationTransaction } from '../../../scripts/assemble-read-rollout.mjs'
const literal = value => `'${value.replaceAll("'", "''")}'`
export const accessRewriteSignatures = Object.freeze([
 'public.pilot_athel_summary_v1(date,date,date,text,text)',
 'public.pilot_athel_daily_v1(date,date,date,text,text,integer,integer)',
 'public.pilot_promotions_v1(boolean)',
 'public.pilot_promotion_image_v1(uuid)',
 'public.pilot_promotion_transaction_v1(uuid,text,jsonb)',
 'public.pilot_reconcile_promotion_v1(uuid,boolean)',
 'public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid)',
 'public.pilot_customer_stats_v1(uuid[],date,integer)',
 'public.pilot_revenue_v1(timestamptz,timestamptz,integer,integer)',
 'public.pilot_customer_performance_v1(uuid,text,timestamptz,timestamptz,integer,integer)',
 'public.pilot_sales_performance_v1(uuid,date,date,timestamptz,timestamptz,text,integer,integer)',
 'public.pilot_sales_report_months_v1(uuid)',
 'public.pilot_team_activity_v1(uuid[],date,timestamptz,timestamptz,timestamptz)',
 'public.pilot_manager_customers_v1(uuid,timestamptz,timestamptz,integer,integer)',
 'public.pilot_store_po_context_v1(uuid,integer,integer)',
 'private.pilot_admin_sales_source_v1(timestamptz,timestamptz)',
 'private.pilot_canonical_sales_source_v1(timestamptz,timestamptz)',
 'private.pilot_admin_sales_start_v1(uuid)',
 'private.pilot_performance_scope_v1(uuid,text)',
 'public.pilot_po_page_v1(text,text,integer,integer)',
 'public.pilot_po_lines_v1(uuid,integer,integer,timestamptz)',
 'public.pilot_order_transaction(uuid,text,jsonb)',
 'public.pilot_reconcile_request(uuid,boolean)',
])
export function buildAccessTopologyChecks(migration) {
 const body = stripMigrationTransaction(migration, true)
 assert.ok(!body.includes('$co_topology_cases$'), 'Test delimiter collision')
 return `BEGIN;
SET LOCAL standard_conforming_strings=on;
CREATE TEMP TABLE co_topology_original ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p) AS metadata FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private');
DO $co_topology_cases$
DECLARE
 candidate text := ${literal(body)};
 signatures text[] := ARRAY[${accessRewriteSignatures.map(literal).join(',')}];
 signature text; original text; definition text; altered text; variant integer;
 rejected boolean; observed jsonb; cases integer := 0;
BEGIN
 FOREACH signature IN ARRAY signatures LOOP
  SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid=signature::regprocedure;
  definition:=pg_get_functiondef(signature::regprocedure);
  IF (length(definition)-length(replace(definition,original,'')))/length(original)<>1 THEN RAISE EXCEPTION 'Test fixture body must be unique'; END IF;
  FOR variant IN 1..3 LOOP
   altered:=CASE variant
    WHEN 1 THEN '/* BEGIN records the routine entry marker. */'||chr(10)||original
    WHEN 2 THEN '/* outer /* BEGIN nested entry marker */ comment */'||chr(10)||original
    ELSE original||chr(10)||'-- Unreviewed trailing body drift'
   END;
   EXECUTE replace(definition,original,altered);
   SELECT to_jsonb(p) INTO observed FROM pg_proc p WHERE oid=signature::regprocedure;
   IF observed-'prosrc' IS DISTINCT FROM (SELECT metadata-'prosrc' FROM pg_temp.co_topology_original WHERE oid=signature::regprocedure) THEN RAISE EXCEPTION 'Fixture changed owner/security/volatility/config/ACL'; END IF;
   rejected:=false;
   BEGIN
    EXECUTE candidate;
   EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Unreviewed access function body: '||signature THEN RAISE; END IF;
    rejected:=true;
   END;
   IF NOT rejected THEN RAISE EXCEPTION 'Access topology drift was accepted: %, variant %',signature,variant; END IF;
   IF (SELECT to_jsonb(p) FROM pg_proc p WHERE oid=signature::regprocedure) IS DISTINCT FROM observed THEN RAISE EXCEPTION 'Rejected migration changed drifted function metadata/body'; END IF;
   IF EXISTS(SELECT 1 FROM pg_temp.co_topology_original before JOIN pg_proc p ON p.oid=before.oid WHERE p.oid<>signature::regprocedure AND to_jsonb(p) IS DISTINCT FROM before.metadata) THEN RAISE EXCEPTION 'Rejected migration changed other function metadata/body'; END IF;
   EXECUTE definition;
   cases:=cases+1;
  END LOOP;
 END LOOP;
 RAISE NOTICE 'Verified % legal body-drift cases',cases;
END $co_topology_cases$;
${body}
DO $co_topology_normal$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.co_topology_original before JOIN pg_proc p ON p.oid=before.oid WHERE (to_jsonb(p)-'prosrc') IS DISTINCT FROM (before.metadata-'prosrc')) THEN RAISE EXCEPTION 'Normal rewrite changed owner/security/volatility/config/ACL'; END IF;
END $co_topology_normal$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('co-user-3')::uuid::text,true);
DO $co_topology_executable$ BEGIN
 BEGIN
  PERFORM public.pilot_promotions_v1(false);
  RAISE EXCEPTION 'Known-body guard was not executable for PO';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $co_topology_executable$;
RESET ROLE;
ROLLBACK;
SELECT 'CO_ACCESS_TOPOLOGY_PASSED';
`
}
