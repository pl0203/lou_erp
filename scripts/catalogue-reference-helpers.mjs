// Bounded pure-helper proof only: no collector, writer hooks, readiness or cutover.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync,mkdirSync,writeFileSync,renameSync,readdirSync,openSync,fstatSync,closeSync,constants } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { catalogueFailfastBinding } from './catalogue-failfast-probe.mjs';
import { catalogueCaptureSourceBytes } from './catalogue-capture-source.mjs';
import { foundationTopLevelSql } from './catalogue-foundation.mjs';
import { catalogueCiConnection,catalogueCiIdentityGateSql,catalogueObservationSql,verifyCatalogueCiObservation } from './catalogue-ci-profile.mjs';
const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>`'${x.replaceAll("'","''")}'`;
const directory=path=>{const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());return stat;};
export const referenceSqlPaths=Object.freeze({
 promotionCandidate:'supabase/catalogue/v1/02-promotion-owner-extraction.sql',
 promotionSuite:'tests/database/catalogue/promotion-owner-extraction.sql',
 retiredCandidate:'supabase/catalogue/v1/02-retired-co-line-resolution.sql',
 retiredSuite:'tests/database/catalogue/retired-co-line-resolution.sql',
 poCandidate:'supabase/catalogue/v1/02-po-reference-extraction.sql',
 poSuite:'tests/database/catalogue/po-reference-extraction.sql',
 visitCandidate:'supabase/catalogue/v1/new02-visit-reference-extraction.sql',
 visitSuite:'tests/database/catalogue/visit-reference-extraction.sql',
 coCandidate:'supabase/catalogue/v1/02-co-reference-extraction.sql',
 coSuite:'tests/database/catalogue/co-reference-extraction.sql',
});
const markers=Object.freeze([
 ['CATALOGUE_REFERENCE_PROMOTION_RED_PASSED','PCE01'],
 ['CATALOGUE_REFERENCE_RETIRED_RED_PASSED','P0001'],
 ['CATALOGUE_REFERENCE_PO_RED_PASSED','42883'],
 ['CATALOGUE_REFERENCE_VISIT_RED_PASSED','PCV01'],
 ['CATALOGUE_REFERENCE_CO_RED_PASSED','PCE01'],
 ['CATALOGUE_REFERENCE_CANDIDATES_APPLIED','00000'],
 ['CATALOGUE_REFERENCE_PROMOTION_SEMANTICS_PASSED','00000'],
 ['CATALOGUE_REFERENCE_RETIRED_SEMANTICS_PASSED','00000'],
 ['CATALOGUE_REFERENCE_PO_SEMANTICS_PASSED','00000'],
 ['CATALOGUE_REFERENCE_VISIT_SEMANTICS_PASSED','00000'],
 ['CATALOGUE_REFERENCE_CO_SEMANTICS_PASSED','00000'],
 ['CATALOGUE_REFERENCE_ACL_PASSED','00000'],
 ['CATALOGUE_REFERENCE_ROLLBACK_VERIFIED','00000'],
]);
export function referenceSuiteSql(name,sql) {
 assert.ok(['promotionSuite','retiredSuite','poSuite','visitSuite','coSuite'].includes(name));assert.equal(typeof sql,'string');
 // Preserve the frozen file. Its two exact presentation-only psql lines are
 // runner-owned here so the SAME SQL can execute inside the RED subtransaction.
 const presentationLines={promotionSuite:['\\echo CATALOGUE_PROMOTION_OWNER_FIXTURE_READY\n','\\echo CATALOGUE_PROMOTION_OWNER_CONTRACT_PASSED\n'],coSuite:['\\echo CATALOGUE_CO_COMMAND_FIXTURE_READY\n','\\echo CATALOGUE_CO_COMMAND_ASSERTIONS_PASSED\n']};
 for(const line of presentationLines[name]||[]) {
  assert.equal(sql.split(line).length,2,'Exact reviewed suite marker required');
  assert.ok(sql.startsWith(line)||sql.includes('\n'+line),'Suite marker must be a complete line');
  sql=sql.replace(line,'');
 }
 foundationTopLevelSql(sql);return sql;
}
export const referenceHelperSignatures=Object.freeze([
 'private.catalog_po_require_v1(boolean,text,text)',
 'private.catalog_po_keys_v1(jsonb,text[])',
 'private.catalog_po_uuid_v1(jsonb,text,boolean)',
 'private.catalog_po_number_v1(jsonb,numeric,numeric,boolean,text,text,boolean)',
 'private.catalog_po_sorted_refs_v1(jsonb)',
 'private.catalog_extract_promotion_owner_event_v1(regclass,text,jsonb,jsonb)',
 'private.catalog_resolve_promotion_edges_v1(jsonb,jsonb)',
 'private.catalog_validate_promotion_owner_event_v1(regclass,text,jsonb,jsonb,jsonb)',
 'private.catalog_rcl_fail_v1(text,text)',
 'private.catalog_rcl_keys_v1(jsonb,text[],text)',
 'private.catalog_rcl_uuid_v1(jsonb,text,boolean)',
 'private.catalog_rcl_text_v1(jsonb,text,boolean)',
 'private.catalog_rcl_number_v1(jsonb,numeric,numeric,boolean,text)',
 'private.catalog_rcl_version_v1(jsonb,text)',
 'private.catalog_resolve_retired_co_line_v1(uuid,uuid,uuid,jsonb)',
 'private.catalog_por_require_v1(boolean,text,text)',
 'private.catalog_por_allowed_v1(jsonb,text[],text[])',
 'private.catalog_por_keys_v1(jsonb,text[])',
 'private.catalog_por_uuid_v1(jsonb,text,boolean,boolean)',
 'private.catalog_por_number_v1(jsonb,numeric,numeric,boolean,text)',
 'private.catalog_por_ref_v1(jsonb,text,text,text,text)',
 'private.catalog_por_edge_v1(jsonb,text,text,text,text,text,jsonb)',
 'private.catalog_por_items_v1(jsonb,jsonb,text,text,text,text,text)',
 'private.catalog_por_ack_v1(jsonb,jsonb,text,text)',
 'private.catalog_por_text_array_v1(jsonb,text)',
 'private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)',
 'private.catalog_vr_require_v1(boolean,text,text)',
 'private.catalog_vr_keys_v1(jsonb,text[],text[])',
 'private.catalog_vr_uuid_v1(jsonb,text,boolean)',
 'private.catalog_vr_version_v1(jsonb,text,boolean)',
 'private.catalog_vr_text_v1(jsonb,text,boolean,integer)',
 'private.catalog_vr_date_v1(jsonb,text)',
 'private.catalog_vr_coordinates_v1(jsonb,text)',
 'private.catalog_vr_edge_v1(text,text,text,jsonb,text)',
 'private.catalog_vr_snapshot_v1(text,jsonb,text,text)',
 'private.catalog_vr_workflow_v1(text,jsonb,jsonb,text,text,text,text)',
 'private.catalog_extract_visit_reference_event_v1(regclass,text,jsonb,jsonb)',
 'private.catalog_co_decimal_version_v1(jsonb,text)',
 'private.catalog_extract_co_command_event_v1(regclass,text,jsonb,jsonb)',
]);
// Family membership uses literal prefixes, never LIKE wildcards. In particular,
// catalog_por_* must not accidentally satisfy catalog_po_* membership.
const helperPredicate=`n.nspname='private' AND (pg_catalog.starts_with(p.proname,'catalog_po_')
 OR pg_catalog.starts_with(p.proname,'catalog_rcl_') OR pg_catalog.starts_with(p.proname,'catalog_por_')
 OR pg_catalog.starts_with(p.proname,'catalog_vr_') OR pg_catalog.starts_with(p.proname,'catalog_co_')
 OR p.proname IN ('catalog_extract_promotion_owner_event_v1','catalog_resolve_promotion_edges_v1',
 'catalog_validate_promotion_owner_event_v1','catalog_resolve_retired_co_line_v1',
 'catalog_extract_visit_reference_event_v1','catalog_extract_co_command_event_v1'))`;
const absentPredicate=`NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE ${helperPredicate})`;
const booleanGate=(predicate,label)=>`SELECT (${predicate}) AS catalogue_reference_gate\n\\gset\n\\if :catalogue_reference_gate\n\\else\nSELECT 1/0 AS ${label};\n\\endif\n`;
const sessionGate=()=>booleanGate(`current_user='postgres' AND pg_catalog.pg_backend_pid()=:'catalogue_reference_pid'::integer
 AND pg_catalog.txid_current()=:'catalogue_reference_xid'::bigint
 AND (SELECT count(*)=1 AND bool_and(backend_pid=pg_catalog.pg_backend_pid() AND transaction_id=pg_catalog.txid_current()) FROM pg_temp.catalogue_reference_session_v1)`,'catalogue_reference_session_refused');
function missingCheckpoint(sql,family,state,message) {
 // The subtransaction catches only this SQLSTATE AND exact message. A fixture,
 // syntax, permission, cancellation or later assertion error propagates. A
 // successful pre-install suite is explicitly refused, never accepted as RED.
 return `DO $catalogue_reference_red$
DECLARE observed_state text; observed_message text;
BEGIN
 BEGIN
  EXECUTE ${quote(sql)};
  RAISE EXCEPTION 'CATALOGUE_REFERENCE_UNEXPECTED_PASS' USING ERRCODE='PCH01';
 EXCEPTION WHEN SQLSTATE '${state}' THEN
  GET STACKED DIAGNOSTICS observed_state = RETURNED_SQLSTATE, observed_message = MESSAGE_TEXT;
  IF observed_state IS DISTINCT FROM '${state}' OR observed_message IS DISTINCT FROM '${message}' THEN RAISE; END IF;
 END;
 IF observed_state IS DISTINCT FROM '${state}' THEN
  RAISE EXCEPTION 'CATALOGUE_REFERENCE_MISSING_RED' USING ERRCODE='PCH01';
 END IF;
 UPDATE pg_temp.catalogue_reference_session_v1 SET ${family}_sqlstate = observed_state;
END $catalogue_reference_red$;
${sessionGate()}SELECT ${family}_sqlstate AS catalogue_reference_red_state FROM pg_temp.catalogue_reference_session_v1
\\gset
`;
}
const aclSql=`DO $catalogue_reference_acl$
DECLARE f record; role_name text;
BEGIN
 -- Match both directions by exact signature/OID. A missing signature, overload,
 -- unexpected family member or same-count replacement cannot satisfy this gate.
 IF EXISTS (
  WITH expected AS (
   SELECT pg_catalog.to_regprocedure(signature)::oid AS oid
   FROM pg_catalog.unnest(ARRAY[${referenceHelperSignatures.map(quote).join(',')}]) AS inventory(signature)
  ), actual AS (
   SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE ${helperPredicate}
  )
  SELECT 1 FROM expected FULL JOIN actual USING(oid) WHERE expected.oid IS NULL OR actual.oid IS NULL
 ) THEN
  RAISE EXCEPTION 'CATALOGUE_REFERENCE_FUNCTION_SET_REFUSED';
 END IF;
 FOR f IN SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE ${helperPredicate} LOOP
  IF f.prosecdef OR f.provolatile<>'i' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
   OR f.proowner<>'postgres'::regrole
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner) THEN
   RAISE EXCEPTION 'CATALOGUE_REFERENCE_OWNER_ACL_REFUSED';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF pg_catalog.has_function_privilege(role_name,f.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'CATALOGUE_REFERENCE_EFFECTIVE_ACL_REFUSED';
   END IF;
  END LOOP;
 END LOOP;
END $catalogue_reference_acl$;
`;
const apiCalls=[
 'SELECT private.catalog_extract_promotion_owner_event_v1(NULL::regclass,NULL::text,NULL::jsonb,NULL::jsonb)',
 'SELECT private.catalog_resolve_promotion_edges_v1(NULL::jsonb,NULL::jsonb)',
 'SELECT private.catalog_validate_promotion_owner_event_v1(NULL::regclass,NULL::text,NULL::jsonb,NULL::jsonb,NULL::jsonb)',
 'SELECT private.catalog_resolve_retired_co_line_v1(NULL::uuid,NULL::uuid,NULL::uuid,NULL::jsonb)',
 'SELECT private.catalog_por_extract_event_v1(NULL::regclass,NULL::text,NULL::jsonb,NULL::jsonb,NULL::jsonb)',
 'SELECT private.catalog_extract_visit_reference_event_v1(NULL::regclass,NULL::text,NULL::jsonb,NULL::jsonb)',
 'SELECT private.catalog_extract_co_command_event_v1(NULL::regclass,NULL::text,NULL::jsonb,NULL::jsonb)',
];
const actualApiAclSql=['anon','authenticated','service_role'].map(role=>`SET LOCAL ROLE ${role};
DO $catalogue_reference_api_acl$
DECLARE statement text;
BEGIN
 FOREACH statement IN ARRAY ARRAY[${apiCalls.map(quote).join(',')}] LOOP
  BEGIN
   EXECUTE statement;
   RAISE EXCEPTION 'CATALOGUE_REFERENCE_API_CALL_NOT_DENIED' USING ERRCODE='PCH02';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;
END $catalogue_reference_api_acl$;
RESET ROLE;
`).join('');
export function buildCatalogueReferenceSession(identity,parts) {
 assert.deepEqual(Object.keys(parts).sort(),Object.keys(referenceSqlPaths).sort());
 for(const name of ['promotionCandidate','retiredCandidate','poCandidate','visitCandidate','coCandidate'])foundationTopLevelSql(parts[name]);
 const promotion=referenceSuiteSql('promotionSuite',parts.promotionSuite),retired=referenceSuiteSql('retiredSuite',parts.retiredSuite),po=referenceSuiteSql('poSuite',parts.poSuite),visit=referenceSuiteSql('visitSuite',parts.visitSuite),co=referenceSuiteSql('coSuite',parts.coSuite);
 // The reviewed PO suite classifies its missing entrypoint and returns normally.
 // Execute it unchanged, then require a real typed missing-entrypoint failure.
 // Catching that failure rolls back the suite's temporary functions as well.
 const poRed=po+'\n'+apiCalls[4]+';';
 const mark=index=>`\\echo ${markers[index][0]} :catalogue_reference_pid :catalogue_reference_xid ${markers[index][1]!=='00000'?':catalogue_reference_red_state':markers[index][1]}\n`;
 return `\\set ON_ERROR_STOP on
\\o /dev/null
${catalogueCiIdentityGateSql(identity)}${booleanGate(absentPredicate,'catalogue_reference_preexisting_refused')}BEGIN;
SET LOCAL search_path = '';
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SELECT pg_catalog.pg_backend_pid() AS catalogue_reference_pid, pg_catalog.txid_current() AS catalogue_reference_xid
\\gset
CREATE TEMP TABLE catalogue_reference_session_v1 ON COMMIT DROP AS
 SELECT pg_catalog.pg_backend_pid() AS backend_pid,pg_catalog.txid_current() AS transaction_id,
 NULL::text AS promotion_sqlstate,NULL::text AS retired_sqlstate,NULL::text AS po_sqlstate,NULL::text AS visit_sqlstate,NULL::text AS co_sqlstate;
${missingCheckpoint(promotion,'promotion','PCE01','CATALOGUE_PROMOTION_OWNER_MISSING_FUNCTION')}${mark(0)}${missingCheckpoint(retired,'retired','P0001','MISSING_RETIRED_CO_LINE_RESOLVER')}${mark(1)}${missingCheckpoint(poRed,'po','42883','function private.catalog_por_extract_event_v1(regclass, text, jsonb, jsonb, jsonb) does not exist')}${mark(2)}${missingCheckpoint(visit,'visit','PCV01','CATALOGUE_VISIT_REFERENCE_MISSING_FUNCTION')}${mark(3)}${missingCheckpoint(co,'co','PCE01','CATALOGUE_CO_COMMAND_MISSING_FUNCTION')}${mark(4)}${parts.promotionCandidate}
${parts.retiredCandidate}
${parts.poCandidate}
${parts.visitCandidate}
${parts.coCandidate}
${sessionGate()}${mark(5)}${promotion}
${sessionGate()}${mark(6)}${retired}
${sessionGate()}${mark(7)}${booleanGate("pg_catalog.to_regprocedure('private.catalog_por_extract_event_v1(regclass,text,jsonb,jsonb,jsonb)') IS NOT NULL",'catalogue_reference_po_entrypoint_refused')}${po}
${sessionGate()}${mark(8)}${visit}
${sessionGate()}${mark(9)}${co}
${sessionGate()}${mark(10)}${aclSql}${actualApiAclSql}${sessionGate()}${mark(11)}ROLLBACK;
${catalogueCiIdentityGateSql(identity)}${booleanGate(`${absentPredicate}
 AND pg_catalog.pg_backend_pid()=:'catalogue_reference_pid'::integer
 AND pg_catalog.to_regclass('pg_temp.catalogue_reference_session_v1') IS NULL
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema())`,'catalogue_reference_rollback_refused')}${mark(12)}\\o
`;
}
function parsePrefix(output) {
 assert.equal(typeof output,'string');if(output==='')return {count:0};assert.ok(output.endsWith('\n'));
 const lines=output.slice(0,-1).split('\n');assert.ok(lines.length<=markers.length);
 let backendPid,transactionId;
 for(let index=0;index<lines.length;index++) {
  const match=lines[index].match(/^([A-Z_]+) ([1-9][0-9]*) ([1-9][0-9]*) ([A-Z0-9]{5})$/);assert.ok(match);
  assert.equal(match[1],markers[index][0]);assert.equal(match[4],markers[index][1]);
  if(index===0){backendPid=match[2];transactionId=match[3];}
  assert.equal(match[2],backendPid);assert.equal(match[3],transactionId);
 }
 return {count:lines.length,backendPid,transactionId};
}
export function parseCatalogueReferenceOutput(output) {
 const {count,backendPid,transactionId}=parsePrefix(output);assert.equal(count,markers.length);return {backendPid,transactionId};
}
const failurePhases=['initialization','binding','containment','workspace','source-preflight','identity-preflight','session','source-postflight','identity-postflight','publication'];
export function referenceFailureDiagnostic(phase,error) {
 const safePhase=failurePhases.includes(phase)?phase:'unknown',result={phase:safePhase,completedMarkerIndex:null,sqlstate:null};
 if(!['identity-preflight','session','identity-postflight'].includes(safePhase)||!error||error.status!==3||error.signal!==null||error.code!==undefined||typeof error.stderr!=='string')return Object.freeze(result);
 const errors=error.stderr.split('\n').filter(line=>line.startsWith('ERROR:'));if(errors.length!==1)return Object.freeze(result);
 const state=errors[0].match(/^ERROR:\s+([A-Z0-9]{5}):/);if(!state)return Object.freeze(result);result.sqlstate=state[1];
 if(safePhase==='session')try {result.completedMarkerIndex=parsePrefix(error.stdout).count-1;}catch {}
 return Object.freeze(result);
}
export function runCatalogueReferenceHelpers({repoRoot=defaultRoot,env=process.env,execute=execFileSync}={}) {
 let descriptor,phase='initialization';
 try {
  assert.equal(typeof env.GITHUB_OUTPUT,'string');descriptor=openSync(env.GITHUB_OUTPUT,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);
  assert.ok(fstatSync(descriptor).isFile());writeFileSync(descriptor,'bundle_ready=false\n');
  phase='binding';const binding=catalogueFailfastBinding(repoRoot,env,execute),identity=binding.identity;
  const connection={...catalogueCiConnection(env,identity.source),PGDATABASE:'pilot_catalogue_test',LC_ALL:'C'};
  phase='containment';const bytes=Object.fromEntries(Object.entries(referenceSqlPaths).map(([name,path])=>[name,catalogueCaptureSourceBytes(repoRoot,path)]));
  const sql=buildCatalogueReferenceSession(identity,Object.fromEntries(Object.entries(bytes).map(([name,body])=>[name,body.toString('utf8')])));
  phase='workspace';const parent=resolve(repoRoot,'scale-results');directory(parent);
  const output=resolve(parent,'catalogue-reference-helpers'),pending=resolve(parent,'catalogue-reference-helpers-pending');
  mkdirSync(output);const reserved=directory(output);mkdirSync(pending);directory(pending);
  const checkSource=()=>assert.deepEqual(catalogueFailfastBinding(repoRoot,env,execute),binding);
  const run=input=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{
   cwd:repoRoot,env:connection,input,encoding:'utf8',timeout:180000,maxBuffer:512*1024,shell:false,stdio:['pipe','pipe','pipe']});
  const verify=()=>verifyCatalogueCiObservation(JSON.parse(run(catalogueCiIdentityGateSql(identity)+catalogueObservationSql('pilot_catalogue_test'))),identity,'pilot_catalogue_test');
  phase='source-preflight';checkSource();phase='identity-preflight';verify();
  // One live psql session is required for all five REDs, installations and
  // semantic suites, effective/actual-role ACL checks and verified rollback.
  phase='session';const session=parseCatalogueReferenceOutput(run(sql));
  phase='source-postflight';checkSource();phase='identity-postflight';verify();
  phase='publication';const report={format:'catalogue-reference-helpers-v1',status:'BOUNDED_REFERENCE_HELPERS_PASSED',scope:'synthetic-pure-reference-helpers-only',
   task1Complete:false,implementationAccepted:false,hostedVerified:false,trackingReady:false,executionGeneration:1,identity,session,
   files:Object.entries(referenceSqlPaths).map(([name,path])=>({path,sha256:sha(bytes[name])})),
   tests:{promotionMissing:{status:'EXPECTED_RED',sqlstate:'PCE01'},retiredMissing:{status:'EXPECTED_RED',sqlstate:'P0001'},poMissing:{status:'EXPECTED_RED',sqlstate:'42883'},visitMissing:{status:'EXPECTED_RED',sqlstate:'PCV01'},coMissing:{status:'EXPECTED_RED',sqlstate:'PCE01'},
    promotionSemantics:'PASSED',retiredSemantics:'PASSED',poSemantics:'PASSED',visitSemantics:'PASSED',coSemantics:'PASSED',ownerAndEffectiveAcl:'PASSED',actualApiRoleDenial:'PASSED',rollback:'VERIFIED'},
   referenceTracking:'NOT_IMPLEMENTED',collectorCompleteness:'UNPROVEN',fullReferenceClosure:'UNPROVEN',
   trustedInputAssumption:'AUTHENTICATED_COMPLETE_SOURCE_PROFILE_VALIDATED_FROZEN_HISTORY',
   targetParity:'SYNTHETIC_SAME_SESSION_ONLY',foundationStatus:'SEPARATE_EVIDENCE',broaderLockGraph:'UNPROVEN',commandAndReplaySuites:'UNRUN'};
  checkSource();directory(parent);directory(pending);const current=directory(output);
  assert.equal(current.ino,reserved.ino);assert.equal(current.dev,reserved.dev);assert.deepEqual(readdirSync(output),[]);
  const result=JSON.stringify(report,null,2)+'\n';writeFileSync(resolve(pending,'results.json'),result,{flag:'wx'});
  writeFileSync(resolve(pending,'manifest.json'),JSON.stringify({format:'catalogue-reference-helpers-manifest-v1',status:report.status,files:[{path:'results.json',sha256:sha(result)}]})+'\n',{flag:'wx'});
  checkSource();renameSync(pending,output);writeFileSync(descriptor,'bundle_ready=true\n');return report;
 }catch(error){const refused=new Error('CATALOGUE_REFERENCE_HELPERS_REFUSED');refused.diagnostic=referenceFailureDiagnostic(phase,error);throw refused;}
 finally {if(descriptor!==undefined)closeSync(descriptor);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {assert.deepEqual(process.argv.slice(2),[]);const report=runCatalogueReferenceHelpers();console.log(JSON.stringify({status:report.status,task1Complete:false,implementationAccepted:false,hostedVerified:false,trackingReady:false,executionGeneration:1}));}
 catch(error){process.stderr.write('CATALOGUE_REFERENCE_HELPERS_REFUSED\n');if(process.env.GITHUB_ACTIONS==='true'&&error?.diagnostic)process.stderr.write(JSON.stringify({status:'CATALOGUE_REFERENCE_HELPERS_REFUSED',...error.diagnostic,implementationAccepted:false})+'\n');process.exitCode=1;}
}
