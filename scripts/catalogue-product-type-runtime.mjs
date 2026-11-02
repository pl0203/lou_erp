// Synthetic terminal CI child only; caller supplies existing identity-bound sessions.
import assert from 'node:assert/strict';
import { foundationTopLevelSql } from './catalogue-foundation.mjs';
export const productTypeRuntimePaths=Object.freeze({
 before:'tests/database/catalogue/product-type-before.sql',
 storage:'supabase/catalogue/v2/product-type-storage.sql',
 audit:'supabase/catalogue/v2/product-type-audit.sql',
 grants:'supabase/catalogue/v2/product-type-grants.sql',
 reads:'supabase/catalogue/v2/product-type-reads.sql',
 writes:'supabase/catalogue/v2/product-type-writes.sql',
 legacy:'supabase/catalogue/v2/product-type-legacy-guard.sql',
 graph:'supabase/catalogue/v2/product-type-graph.sql',
 api:'tests/database/catalogue/product-type-api.sql',
});
const helpers="-- Prechange synthetic capture. The runner owns the one transaction and exact identity gate.\nCREATE FUNCTION pg_temp.foundation_assert(ok boolean, label text) RETURNS void\nLANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$\nBEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Foundation assertion failed: %', label; END IF; END $$;\nCREATE FUNCTION pg_temp.foundation_raises(statement text, expected_state text, label text) RETURNS void\nLANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$\nDECLARE actual text;\nBEGIN\n  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE; END;\n  IF actual IS DISTINCT FROM expected_state THEN RAISE EXCEPTION '%: expected %, got %', label, expected_state, coalesce(actual, 'success'); END IF;\nEND $$;\n-- Every probe rolls back its own attempted write, including successful writes.\nCREATE FUNCTION pg_temp.foundation_probe(statement text) RETURNS jsonb\nLANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$\nDECLARE affected bigint; outcome jsonb;\nBEGIN\n  IF current_user <> 'authenticated' OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN\n    RAISE EXCEPTION 'Actual application role required';\n  END IF;\n  IF NOT pg_catalog.row_security_active('public.customers') OR NOT pg_catalog.row_security_active('public.products') THEN\n    RAISE EXCEPTION 'Actual application role must have active RLS';\n  END IF;\n  BEGIN\n    BEGIN\n      EXECUTE statement;\n      GET DIAGNOSTICS affected = ROW_COUNT;\n      outcome := jsonb_build_object('state', '00000', 'rows', affected);\n    EXCEPTION WHEN OTHERS THEN outcome := jsonb_build_object('state', SQLSTATE); END;\n    RAISE EXCEPTION 'Rollback probe' USING ERRCODE = 'PZ001';\n  EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN outcome; END;\nEND $$;\nDO $$ DECLARE ns text; BEGIN\n  SELECT nspname INTO STRICT ns FROM pg_namespace WHERE oid = pg_my_temp_schema();\n  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated, anon', ns);\n  EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC', ns);\n  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO authenticated, anon', ns);\nEND $$;\n\n";
function validate(parts){assert.deepEqual(Object.keys(parts).sort(),Object.keys(productTypeRuntimePaths).sort());for(const sql of Object.values(parts))foundationTopLevelSql(sql);}
const install=parts=>['storage','audit','grants','reads','writes','legacy','graph'].map(k=>parts[k]).join('\n');
export function buildProductTypeAcceptance(parts){
 validate(parts);
 return `BEGIN;
SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1500ms'; SET LOCAL idle_in_transaction_session_timeout='30s';
${helpers}
${parts.before}
${install(parts)}
SET LOCAL ROLE authenticated;
SELECT pg_temp.foundation_assert(row_security_active('public.products') AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)),'native non-bypass application role');
RESET ROLE;
${parts.api}
ROLLBACK;
SELECT to_regprocedure('public.pilot_catalog_transaction_v2(uuid,text,jsonb)') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.products'::regclass AND attname='product_type' AND NOT attisdropped);
`;
}
/** One PostgreSQL statement; no API transaction splitting can partially commit its body. */
export function productTypeAtomicStatement(body){
 assert.equal(typeof body,'string');assert.ok(!body.includes('$tipe_body$')&&!body.includes('$tipe_atomic$'),'Reserved envelope delimiter');
 foundationTopLevelSql(body);
 return `DO $tipe_atomic$ BEGIN EXECUTE $tipe_body$${body}$tipe_body$; END $tipe_atomic$;`;
}
export function buildProductTypeRaceInstall(parts){validate(parts);return productTypeAtomicStatement(`SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1500ms';
${install(parts)}
`);}
// Generic synthetic transaction mechanics, not a forged live OID/profile test.
export const productTypeEnvelopeProbeSql=Object.freeze({
 success:productTypeAtomicStatement(`SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='8s';
CREATE FUNCTION pg_temp.tipe_envelope_assert(ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'synthetic envelope postflight failed' USING ERRCODE='PT901'; END IF; END $$;
CREATE TEMP TABLE tipe_envelope_temp(id integer) ON COMMIT DROP;
CREATE TABLE public.tipe_envelope_probe(id integer PRIMARY KEY);
INSERT INTO public.tipe_envelope_probe VALUES(1);
SELECT pg_temp.tipe_envelope_assert((SELECT count(*)=1 FROM public.tipe_envelope_probe) AND current_setting('lock_timeout')='1500ms');
`),
 failure:productTypeAtomicStatement(`SET LOCAL lock_timeout='1500ms';
CREATE FUNCTION pg_temp.tipe_envelope_failed() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE TEMP TABLE tipe_envelope_failed_temp(id integer) ON COMMIT DROP;
CREATE TABLE public.tipe_envelope_failed(id integer);
INSERT INTO public.tipe_envelope_probe VALUES(2);
SELECT pg_temp.tipe_envelope_assert(false);
`),
 successObservation:`SELECT (SELECT count(*)=1 FROM public.tipe_envelope_probe) AND to_regclass('pg_temp.tipe_envelope_temp') IS NULL AND to_regprocedure('pg_temp.tipe_envelope_assert(boolean)') IS NOT NULL;`,
 rollbackObservation:`SELECT (SELECT count(*)=1 AND min(id)=1 FROM public.tipe_envelope_probe) AND to_regclass('public.tipe_envelope_failed') IS NULL AND to_regclass('pg_temp.tipe_envelope_failed_temp') IS NULL AND to_regprocedure('pg_temp.tipe_envelope_failed()') IS NULL;`,
});
export async function executeProductTypeEnvelopeProbe({a,query,expectState,verify}){
 await verify();
 // Statement timeout must already be armed before the outer DO starts. SET LOCAL inside its body cannot arm it retroactively.
 assert.equal(await query(a,"SELECT current_setting('statement_timeout')='8s' AND current_setting('idle_in_transaction_session_timeout')='30s';"),'t','Existing native session budgets required');
 assert.equal(await query(a,"SELECT to_regclass('public.tipe_envelope_probe') IS NULL AND to_regclass('public.tipe_envelope_failed') IS NULL AND to_regprocedure('pg_temp.tipe_envelope_assert(boolean)') IS NULL;"),'t','Fresh synthetic envelope scope required');
 await query(a,productTypeEnvelopeProbeSql.success);
 assert.equal(await query(a,productTypeEnvelopeProbeSql.successObservation),'t','Single-statement commit and temporary cleanup');
 await expectState(a,productTypeEnvelopeProbeSql.failure,'PT901');
 assert.equal(await query(a,productTypeEnvelopeProbeSql.rollbackObservation),'t','Failed single statement must leave no partial table/function/row');
 await query(a,'DROP TABLE public.tipe_envelope_probe; DROP FUNCTION pg_temp.tipe_envelope_assert(boolean);');
 assert.equal(await query(a,"SELECT to_regclass('public.tipe_envelope_probe') IS NULL AND to_regprocedure('pg_temp.tipe_envelope_assert(boolean)') IS NULL;"),'t');
 await verify();return 'ATOMIC_STATEMENT_ROLLBACK_VERIFIED';
}
export async function executeProductTypeAcceptance({parts,a,b,observer,query,expectState,verify,runRaces}) {
 await verify();
 const envelope=await executeProductTypeEnvelopeProbe({a,query,expectState,verify});
 // Suppress fixture SELECT output; expose only a final rollback check.
 const acceptance=buildProductTypeAcceptance(parts);
 const split=acceptance.lastIndexOf('SELECT to_regprocedure');
 assert.equal(await query(a,'\\set ON_ERROR_STOP on\n\\o /dev/null\n'+acceptance.slice(0,split)+'\\o\n'+acceptance.slice(split)+'\\set ON_ERROR_STOP off\n'),'t');
 await verify();
 assert.equal(await query(a,"SELECT current_setting('statement_timeout')='8s';"),'t','Outer DO timeout must already be armed');
 await query(a,'\\set ON_ERROR_STOP on\n\\o /dev/null\n'+buildProductTypeRaceInstall(parts)+'\\o\n\\set ON_ERROR_STOP off\n');
 await verify();
 const races=await runRaces({a,b,observer,query,expectState,verify});
 await verify();
 return {status:'BOUNDED_PRODUCT_TYPE_ACCEPTANCE_PASSED',api:'ROLLBACK_VERIFIED',envelope,races,hostedParity:'UNVERIFIED'};
}
