// Bounded synthetic foundation behavior only. Not Task 1 parity, cutover, or deployment.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync,mkdirSync,writeFileSync,renameSync,readdirSync,openSync,fstatSync,closeSync,constants } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { catalogueFailfastBinding } from './catalogue-failfast-probe.mjs';
import { catalogueCaptureSourceBytes } from './catalogue-capture-source.mjs';
import { catalogueCiConnection,catalogueCiIdentityGateSql,catalogueObservationSql,verifyCatalogueCiObservation } from './catalogue-ci-profile.mjs';
const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const directory=path=>{const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());return stat;};
export const foundationSqlPaths=Object.freeze({
 before:'tests/database/catalogue/before-foundation.sql',
 candidate:'supabase/catalogue/v1/01-foundation.sql',
 foundation:'tests/database/catalogue/foundation.sql',
 legacy:'tests/database/catalogue/legacy-columns.sql',
 roles:'tests/database/catalogue/roles.sql',
 orderCandidate:'supabase/catalogue/v1/04-order-boundaries.sql',
 orders:'tests/database/catalogue/orders.sql',
 coOrderCandidate:'supabase/catalogue/v1/new06-co-order-boundaries.sql',
 coOrders:'tests/database/catalogue/co-orders.sql',
 promotionOwnerGrammar:'supabase/catalogue/v1/02-promotion-owner-extraction.sql',
 poGrammar:'supabase/catalogue/v1/02-po-reference-extraction.sql',
 coGrammar:'supabase/catalogue/v1/02-co-reference-extraction.sql',
 coDraftGrammar:'supabase/catalogue/v1/02-co-draft-reference-extraction.sql',
 retiredCoGrammar:'supabase/catalogue/v1/02-retired-co-line-resolution.sql',
 visitGrammar:'supabase/catalogue/v1/new02-visit-reference-extraction.sql',
 noncoGrammar:'supabase/catalogue/v1/new02-nonco-lineage-resolution.sql',
 lifetimeCandidate:'supabase/catalogue/v1/new07-lifetime-admission.sql',
 lifetime:'tests/database/catalogue/lifetime-admission.sql',
 createEditCandidate:'supabase/catalogue/v1/new08-catalogue-create-edit.sql',
 targetTrackingCandidate:'supabase/catalogue/v1/02-customer-target-tracking.sql',
 checkedBoundariesCandidate:'supabase/catalogue/v1/new09-checked-boundaries.sql',
 guardedDeleteCandidate:'supabase/catalogue/v1/new10-guarded-delete.sql',
 masterCompletionCandidate:'supabase/catalogue/v1/new11-master-completion-hooks.sql',
 createEdit:'tests/database/catalogue/create-edit.sql',
 publicRouters:'tests/database/catalogue/generation-two-routers.sql',
 checkedBoundaries:'tests/database/catalogue/checked-boundaries.sql',
 guardedDelete:'tests/database/catalogue/guarded-delete.sql',
 guardedDeleteHistory:'tests/database/catalogue/guarded-delete-history.sql',
});
export const foundationExpectedMarkers=Object.freeze([
 'CATALOGUE_FOUNDATION_BEFORE_CAPTURED','CATALOGUE_FOUNDATION_CANDIDATE_APPLIED',
 'CATALOGUE_FOUNDATION_BEHAVIOR_PASSED','CATALOGUE_FOUNDATION_LEGACY_PASSED',
 'CATALOGUE_FOUNDATION_ROLES_PASSED','CATALOGUE_ORDERS_CORE_PASSED','CATALOGUE_CO_ORDERS_CORE_PASSED','CATALOGUE_LIFETIME_WRITERS_PASSED','CATALOGUE_CREATE_EDIT_CORE_PASSED','CATALOGUE_PUBLIC_ROUTER_DISPATCH_ONLY_PASSED','CATALOGUE_CHECKED_BOUNDARIES_PASSED','CATALOGUE_GUARDED_DELETE_PASSED','CATALOGUE_GUARDED_DELETE_HISTORY_PASSED','CATALOGUE_FOUNDATION_ROLLBACK_VERIFIED',
]);
// Erase SQL comments/quoted values before examining top-level statements. This
// is a containment check, not a PostgreSQL grammar/behavior substitute.
export function foundationTopLevelSql(sql) {
 assert.equal(typeof sql,'string');assert.ok(sql.trim());let result='',index=0;
 while(index<sql.length) {
  if(sql.startsWith('--',index)){const end=sql.slice(index).search(/[\r\n]/);index=end<0?sql.length:index+end;result+=' ';continue;}
  if(sql.startsWith('/*',index)) {let depth=1;index+=2;while(depth&&index<sql.length){if(sql.startsWith('/*',index)){depth++;index+=2;}else if(sql.startsWith('*/',index)){depth--;index+=2;}else index++;}assert.equal(depth,0,'Unclosed SQL comment');result+=' ';continue;}
  if(sql[index]==="'"||sql[index]==='"') {
   const escapeString=sql[index]==="'"&&/[eE]/.test(sql[index-1]??'')&&!/[A-Za-z0-9_$\u0080-\uffff]/.test(sql[index-2]??'');
   const quote=sql[index++];let closed=false;
   while(index<sql.length){if(sql[index]===quote){if(sql[index+1]===quote){index+=2;continue;}index++;closed=true;break;}if(sql[index]==='\\'&&escapeString){index+=2;continue;}index++;}
   assert.ok(closed,'Unclosed SQL quote');result+=' ';continue;
  }
  if(sql[index]==='$'&&!/[A-Za-z0-9_$\u0080-\uffff]/.test(sql[index-1]??'')) {const tag=sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];if(tag){const end=sql.indexOf(tag,index+tag.length);assert.ok(end>=0,'Unclosed dollar quote');index=end+tag.length;result+=' ';continue;}}
  assert.notEqual(sql[index],'\\','Client commands are runner-owned');result+=sql[index++];
 }
 for(const statement of result.split(';'))assert.ok(!/^\s*(?:BEGIN\b|START\s+TRANSACTION\b|COMMIT\b|END\b|ROLLBACK\b|ABORT\b|SAVEPOINT\b|RELEASE\b|PREPARE\s+TRANSACTION\b)/i.test(statement),'Transaction boundaries are runner-owned');
 return result;
}
// Only this finite, source-bound test owns a nested rollback envelope. Its
// captured bytes are inserted unchanged; arbitrary savepoints remain refused.
export function catalogueCompletionSuiteSql(name,sql) {
 const scopes=name==='guardedDelete'?['guarded_delete_fixture']:name==='guardedDeleteHistory'?['guarded_delete_history_fixture','trusted_history_fixture','trusted_history_topology','trusted_history_removed_visit','trusted_history_retired_co']:null;
 if(!scopes)return foundationTopLevelSql(sql);
 assert.equal(typeof sql,'string');assert.ok(!sql.includes('catalogue_fixture_boundary_guard_'));
 const lines=sql.split('\n'),positions=[];let checked=sql;
 for(const scope of scopes){
  let previous=-1;const order=[];
  for(const boundary of [`SAVEPOINT ${scope};`,`ROLLBACK TO SAVEPOINT ${scope};`,`RELEASE SAVEPOINT ${scope};`]){
   assert.equal(lines.filter(line=>line===boundary).length,1,'Exact completion rollback boundary required');
   const position=lines.indexOf(boundary);assert.ok(position>previous,'Completion rollback boundaries must be ordered');previous=position;order.push(position);
   checked=checked.replace(boundary,`SELECT 1 AS catalogue_fixture_boundary_guard_${positions.length};`);positions.push(position);
  }
  if(scope===scopes[0]){
   assert.equal(foundationTopLevelSql(lines.slice(0,order[0]).join('\n')+'\nSELECT 1;').trim(),'SELECT 1;','Completion fixture must begin inside its rollback envelope');
   assert.equal(foundationTopLevelSql(lines.slice(order[2]+1).join('\n')+'\nSELECT 1;').trim(),'SELECT 1;','Completion fixture must end inside its rollback envelope');
  }else assert.ok(order[0]>positions[0]&&order[2]<positions[1],'Nested fixture must stay inside its outer rollback');
 }
 const topLevel=foundationTopLevelSql(checked);
 for(let i=0;i<positions.length;i++)assert.equal(topLevel.split(`catalogue_fixture_boundary_guard_${i};`).length,2,'Every fixture boundary must be top-level SQL');
 return topLevel;
}
export const catalogueCompletionAbsentPredicate=`pg_catalog.to_regclass('private.catalog_target_requests_v1') IS NULL
 AND pg_catalog.to_regclass('private.catalog_target_active_v1') IS NULL
 AND pg_catalog.to_regclass('private.catalog_target_policy_contract_v1') IS NULL
 AND pg_catalog.to_regclass('private.catalog_product_delete_scope_v2') IS NULL
 AND pg_catalog.to_regclass('private.catalog_product_delete_rows_v2') IS NULL
 AND pg_catalog.to_regclass('private.catalog_checked_scope_v2') IS NULL
 AND pg_catalog.to_regclass('private.catalog_create_scope_v1') IS NULL
 AND pg_catalog.to_regprocedure('public.pilot_customer_target_upsert_v1(uuid,uuid,text,numeric)') IS NULL
 AND pg_catalog.to_regprocedure('public.pilot_reconcile_customer_target_v1(uuid)') IS NULL
 AND pg_catalog.to_regprocedure('public.pilot_customer_target_write_access_v1()') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_assert_no_links_v1(text,uuid)') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_delete_unused_v1(uuid,jsonb)') IS NULL
 AND pg_catalog.to_regprocedure('public.pilot_catalog_delete_access_v1()') IS NULL
 AND pg_catalog.to_regclass('pg_temp.catalogue_completion_cutover_before_v1') IS NULL`;
export const catalogueCompletionCutoverSnapshotSql=`CREATE TEMP TABLE catalogue_completion_cutover_before_v1 ON COMMIT DROP AS
 SELECT jsonb_agg(to_jsonb(c) ORDER BY c.conname) AS constraint_rows FROM pg_catalog.pg_constraint c
 WHERE c.conrelid='private.catalog_cutover_v1'::regclass;`;
// This is a post-suite restoration gate, not a production readiness check.
export const catalogueCompletionRestoredPredicate=`(SELECT constraint_rows FROM pg_temp.catalogue_completion_cutover_before_v1)
 IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.conname) FROM pg_catalog.pg_constraint c WHERE c.conrelid='private.catalog_cutover_v1'::regclass)
 AND (SELECT count(*)=1 AND bool_and(execution_generation=1 AND NOT tracking_ready) FROM private.catalog_cutover_v1)
 AND (SELECT count(*)=2 AND bool_and(convalidated) FROM pg_catalog.pg_constraint
 WHERE conrelid='private.catalog_cutover_v1'::regclass AND conname IN ('catalog_foundation_generation_one','catalog_foundation_not_ready'))
 AND NOT EXISTS(SELECT 1 FROM private.catalog_checked_scope_v2)
 AND NOT EXISTS(SELECT 1 FROM private.catalog_target_active_v1)
 AND NOT EXISTS(SELECT 1 FROM private.catalog_product_delete_scope_v2)
 AND NOT EXISTS(SELECT 1 FROM private.catalog_product_delete_rows_v2)
 AND NOT EXISTS(SELECT 1 FROM private.catalog_create_scope_v1)`;
export const catalogueCheckedCompletionProof=Object.freeze({status:'BOUNDED_CHECKED_COMPLETION_SUITES_PASSED',scope:'FUTURE_GENERATION_TWO_SYNTHETIC_ONLY',suites:Object.freeze(['checked-boundaries','guarded-delete','guarded-delete-history']),historyScanner:'GENERATION_ONE_OWNER_PRIVATE_ONLY',executionGeneration:2,trackingReady:true,fixtureRestoration:'GENERATION_ONE_TRACKING_FALSE_CONSTRAINTS_VERIFIED',productionGeneration:1,productionTrackingReady:false,concurrency:'UNRUN',hostedParity:'UNVERIFIED',implementationAccepted:false});
const noFoundationPredicate=`${catalogueCompletionAbsentPredicate}
 AND pg_catalog.to_regclass('private.catalog_identity_v1') IS NULL
 AND pg_catalog.to_regclass('private.catalog_cutover_v1') IS NULL
 AND pg_catalog.to_regclass('private.catalog_requests_v1') IS NULL
 AND pg_catalog.to_regclass('private.catalog_po_active_v2') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_po_transaction_core_v2(uuid,text,jsonb)') IS NULL
 AND pg_catalog.to_regclass('private.catalog_writer_active_v2') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_promotion_core_v2(uuid,text,jsonb,boolean)') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_extract_visit_reference_event_v1(regclass,text,jsonb,jsonb)') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_extract_promotion_owner_event_v1(regclass,text,jsonb,jsonb)') IS NULL
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid IN('private.pilot_promotion_requests'::regclass,'private.pilot_schedule_requests'::regclass,'private.pilot_visit_requests'::regclass) AND attname IN ('execution_version') AND NOT attisdropped)
 AND pg_catalog.to_regclass('private.catalog_co_active_v2') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_co_transaction_core_v2(uuid,text,jsonb)') IS NULL
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='private.co_commands'::regclass AND attname='execution_version' AND NOT attisdropped)
 AND (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.pilot_co_transaction_v1(uuid,text,jsonb)'::regprocedure)='253ac5728e67fa26e1736bca30ccc4b0'
 AND (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.pilot_order_transaction(uuid,text,jsonb)'::regprocedure)='0b1e19441a499ae9c864b2d21aef28ba'
 AND pg_catalog.to_regclass('private.catalog_write_policy_contract_v1') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_status_transaction_v1(uuid,text,jsonb)') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_status_reconcile_v1(uuid,boolean)') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_request_terminal_v1()') IS NULL
 AND pg_catalog.to_regprocedure('private.catalog_authorize_v1(text,uuid)') IS NULL
 AND pg_catalog.to_regprocedure('public.pilot_catalog_transaction_v1(uuid,text,jsonb)') IS NULL
 AND pg_catalog.to_regprocedure('public.pilot_reconcile_catalog_v1(uuid,boolean)') IS NULL
 AND pg_catalog.to_regprocedure('public.pilot_procurement_access_v2()') IS NULL
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid IN ('public.customers'::regclass,'public.products'::regclass)
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN ('is_enabled','catalog_version'))
 AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=md5('catalogue-foundation-actor-1')::uuid)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='catalogue_foundation_inherited_probe')`;
const booleanGate=(predicate,label)=>`SELECT (${predicate}) AS catalogue_foundation_gate\n\\gset\n\\if :catalogue_foundation_gate\n\\else\nSELECT 1/0 AS ${label};\n\\endif\n`;
const sessionGate=()=>booleanGate(`current_user='postgres' AND pg_catalog.pg_backend_pid()=:'catalogue_foundation_pid'::integer
 AND pg_catalog.txid_current()=:'catalogue_foundation_xid'::bigint
 AND (SELECT count(*)=1 AND bool_and(backend_pid=pg_catalog.pg_backend_pid() AND transaction_id=pg_catalog.txid_current()) FROM pg_temp.catalogue_foundation_session_v1)`,'catalogue_foundation_session_refused');
export function buildCatalogueFoundationSession(identity,parts) {
 assert.deepEqual(Object.keys(parts).sort(),Object.keys(foundationSqlPaths).sort());
 for(const [name,sql]of Object.entries(parts))catalogueCompletionSuiteSql(name,sql);
 const mark=index=>`\\echo ${foundationExpectedMarkers[index]} :catalogue_foundation_pid :catalogue_foundation_xid\n`;
 return `\\set ON_ERROR_STOP on
\\o /dev/null
${catalogueCiIdentityGateSql(identity)}${booleanGate(noFoundationPredicate,'catalogue_foundation_preexisting_refused')}BEGIN;
SET LOCAL search_path = '';
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SELECT pg_catalog.pg_backend_pid() AS catalogue_foundation_pid, pg_catalog.txid_current() AS catalogue_foundation_xid
\\gset
CREATE TEMP TABLE catalogue_foundation_session_v1 ON COMMIT DROP AS
 SELECT pg_catalog.pg_backend_pid() AS backend_pid,pg_catalog.txid_current() AS transaction_id;
${parts.before}
${sessionGate()}${mark(0)}${parts.candidate}
${sessionGate()}${catalogueCompletionCutoverSnapshotSql}
${sessionGate()}${mark(1)}${parts.foundation}
${sessionGate()}${mark(2)}${parts.legacy}
${sessionGate()}${mark(3)}${parts.roles}
${sessionGate()}${mark(4)}${parts.orderCandidate}
${sessionGate()}SAVEPOINT catalogue_po_behavior_fixture;
${parts.orders}
${sessionGate()}SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK TO SAVEPOINT catalogue_po_behavior_fixture;
RELEASE SAVEPOINT catalogue_po_behavior_fixture;
${sessionGate()}${mark(5)}${parts.coOrderCandidate}
${sessionGate()}SAVEPOINT catalogue_co_behavior_fixture;
${parts.coOrders}
${sessionGate()}SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK TO SAVEPOINT catalogue_co_behavior_fixture;
RELEASE SAVEPOINT catalogue_co_behavior_fixture;
${sessionGate()}${mark(6)}${parts.promotionOwnerGrammar}
${sessionGate()}${parts.poGrammar}
${sessionGate()}${parts.coGrammar}
${sessionGate()}${parts.coDraftGrammar}
${sessionGate()}${parts.retiredCoGrammar}
${sessionGate()}${parts.visitGrammar}
${sessionGate()}${parts.noncoGrammar}
${sessionGate()}${parts.lifetimeCandidate}
${sessionGate()}${parts.lifetime}
${sessionGate()}${mark(7)}${parts.createEditCandidate}
${sessionGate()}${parts.targetTrackingCandidate}
${sessionGate()}${parts.checkedBoundariesCandidate}
${sessionGate()}${parts.guardedDeleteCandidate}
${sessionGate()}${parts.masterCompletionCandidate}
${sessionGate()}${parts.createEdit}
${sessionGate()}${mark(8)}${parts.publicRouters}
${sessionGate()}${mark(9)}${booleanGate(catalogueCompletionRestoredPredicate,'catalogue_completion_restoration_refused')}${parts.checkedBoundaries}
${sessionGate()}${booleanGate(catalogueCompletionRestoredPredicate,'catalogue_completion_restoration_refused')}${mark(10)}${parts.guardedDelete}
${sessionGate()}${booleanGate(catalogueCompletionRestoredPredicate,'catalogue_completion_restoration_refused')}${mark(11)}${parts.guardedDeleteHistory}
${sessionGate()}${booleanGate(catalogueCompletionRestoredPredicate,'catalogue_completion_restoration_refused')}${mark(12)}ROLLBACK;
${catalogueCiIdentityGateSql(identity)}${booleanGate(`${noFoundationPredicate}\n AND pg_catalog.pg_backend_pid()=:'catalogue_foundation_pid'::integer\n AND pg_catalog.to_regclass('pg_temp.catalogue_foundation_session_v1') IS NULL`,'catalogue_foundation_rollback_refused')}${mark(13)}\\o
`;
}
export function parseCatalogueFoundationOutput(output) {
 assert.equal(typeof output,'string');assert.ok(output.endsWith('\n'));
 const lines=output.slice(0,-1).split('\n');assert.equal(lines.length,foundationExpectedMarkers.length);
 let backendPid,transactionId;
 for(let index=0;index<lines.length;index++) {
  const match=lines[index].match(/^([A-Z_]+) ([1-9][0-9]*) ([1-9][0-9]*)$/);assert.ok(match);
  assert.equal(match[1],foundationExpectedMarkers[index]);
  if(index===0){backendPid=match[2];transactionId=match[3];}
  assert.equal(match[2],backendPid);assert.equal(match[3],transactionId);
 }
 return {backendPid,transactionId};
}
const sourceMaps=new WeakSet();
// Only exact captured fragments in the exact generated stdin can supply a
// public source location. No filename, SQL text or context comes from stderr.
export function foundationSessionSourceMap(sql,parts) {
 assert.equal(typeof sql,'string');assert.ok(!sql.includes('\r'));
 assert.deepEqual(Object.keys(parts).sort(),Object.keys(foundationSqlPaths).sort());
 const lineAt=index=>sql.slice(0,index).split('\n').length;
 const ranges=Object.entries(foundationSqlPaths).map(([name,path])=>{
  const part=parts[name];assert.equal(typeof part,'string');assert.ok(part.trim());
  const start=sql.indexOf(part);assert.ok(start>=0);assert.equal(sql.indexOf(part,start+1),-1);
  return Object.freeze({path,sha256:sha(part),firstLine:lineAt(start),lastLine:lineAt(start+part.trimEnd().length)});
 });
 const markerLines=foundationExpectedMarkers.map(marker=>{
  const text=`\\echo ${marker} :catalogue_foundation_pid :catalogue_foundation_xid\n`;
  const start=sql.indexOf(text);assert.ok(start>=0);assert.equal(sql.indexOf(text,start+1),-1);return lineAt(start);
 });
 for(let i=1;i<ranges.length;i++)assert.ok(ranges[i-1].lastLine<ranges[i].firstLine);
 for(let i=1;i<markerLines.length;i++)assert.ok(markerLines[i-1]<markerLines[i]);
 const map=Object.freeze({sqlSha256:sha(sql),lineCount:sql.split('\n').length-(sql.endsWith('\n')?1:0),ranges:Object.freeze(ranges),markerLines:Object.freeze(markerLines)});
 sourceMaps.add(map);return map;
}
const failurePhases=Object.freeze(['initialization','binding','containment','workspace','source-preflight','identity-preflight','session','source-postflight','identity-postflight','publication']);
// Diagnostics never classify acceptance or reproduce SQL, rows or exception text.
export function foundationFailureDiagnostic(phase,error,sourceMap) {
 const safePhase=failurePhases.includes(phase)?phase:'unknown';
 const result={phase:safePhase,completedMarkerIndex:null,sqlstate:null};
 if(!['identity-preflight','session','identity-postflight'].includes(safePhase)
   // psql can exit on its first SQL error before consuming a large session.
   // Node then reports EPIPE as well as the completed exit status and streams.
   // This is diagnostic-only: every other spawn/timeout/buffer error is refused.
   || !error || error.status!==3 || error.signal!==null || ![undefined,'EPIPE'].includes(error.code)
   || typeof error.stderr!=='string'||!error.stderr.endsWith('\n')||Buffer.byteLength(error.stderr)>512*1024)return Object.freeze(result);
 const errors=error.stderr.split('\n').filter(line=>line.includes('ERROR:'));
 if(errors.length!==1||(error.stderr.match(/ERROR:/g)??[]).length!==1)return Object.freeze(result);
 const state=errors[0].match(/^(?:ERROR:\s+([A-Z0-9]{5}):|psql:<stdin>:([1-9][0-9]{0,6}): ERROR:\s+([A-Z0-9]{5}):)/);
 if(!state)return Object.freeze(result);
 const inputLine=state[2]===undefined?null:Number(state[2]);
 if(inputLine!==null&&(safePhase!=='session'||!sourceMaps.has(sourceMap)||inputLine>sourceMap.lineCount))return Object.freeze(result);
 result.sqlstate=state[1]??state[3];
 if(safePhase!=='session'||typeof error.stdout!=='string')return Object.freeze(result);
 if(Buffer.byteLength(error.stdout)>4096||!error.stdout.endsWith('\n')&&error.stdout!=='')return Object.freeze(result);
 const lines=error.stdout===''?[]:error.stdout.slice(0,-1).split('\n');
 if(lines.length>foundationExpectedMarkers.length)return Object.freeze(result);
 let pid,xid;
 for(let index=0;index<lines.length;index++){
  const match=lines[index].match(/^([A-Z_]+) ([1-9][0-9]*) ([1-9][0-9]*)$/);
  if(!match||match[1]!==foundationExpectedMarkers[index])return Object.freeze(result);
  if(index===0){pid=match[2];xid=match[3];}
  if(match[2]!==pid||match[3]!==xid)return Object.freeze(result);
 }
 if(inputLine!==null) {
  const previous=sourceMap.markerLines[lines.length-1]??0,next=sourceMap.markerLines[lines.length]??sourceMap.lineCount+1;
  if(inputLine<=previous||inputLine>=next)return Object.freeze(result);
  const range=sourceMap.ranges.find(range=>inputLine>=range.firstLine&&inputLine<=range.lastLine);
  if(range)result.source=Object.freeze({path:range.path,sha256:range.sha256,line:inputLine-range.firstLine+1});
 }
 result.completedMarkerIndex=lines.length-1;return Object.freeze(result);
}
export function runCatalogueFoundation({repoRoot=defaultRoot,env=process.env,execute=execFileSync}={}) {
 let descriptor,sourceMap,phase='initialization';
 try {
  assert.equal(typeof env.GITHUB_OUTPUT,'string');
  descriptor=openSync(env.GITHUB_OUTPUT,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);
  assert.ok(fstatSync(descriptor).isFile());writeFileSync(descriptor,'bundle_ready=false\n');
  phase='binding';
  const binding=catalogueFailfastBinding(repoRoot,env,execute),identity=binding.identity;
  const connection={...catalogueCiConnection(env,identity.source),PGDATABASE:'pilot_catalogue_test',LC_ALL:'C'};
  phase='containment';
  const bytes=Object.fromEntries(Object.entries(foundationSqlPaths).map(([name,path])=>[name,catalogueCaptureSourceBytes(repoRoot,path)]));
  const parts=Object.fromEntries(Object.entries(bytes).map(([name,body])=>[name,body.toString('utf8')]));
  const sql=buildCatalogueFoundationSession(identity,parts);
  sourceMap=foundationSessionSourceMap(sql,parts);
  phase='workspace';
  const parent=resolve(repoRoot,'scale-results');directory(parent);
  const output=resolve(parent,'catalogue-foundation'),pending=resolve(parent,'catalogue-foundation-pending');
  mkdirSync(output);const reserved=directory(output);mkdirSync(pending);directory(pending);
  const checkSource=()=>assert.deepEqual(catalogueFailfastBinding(repoRoot,env,execute),binding);
  const run=input=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-f','-'],{
   cwd:repoRoot,env:connection,input,encoding:'utf8',timeout:180000,maxBuffer:512*1024,shell:false,stdio:['pipe','pipe','pipe']});
  const verify=()=>verifyCatalogueCiObservation(JSON.parse(run(catalogueCiIdentityGateSql(identity)+catalogueObservationSql('pilot_catalogue_test'))),identity,'pilot_catalogue_test');
  phase='source-preflight';checkSource();phase='identity-preflight';verify();
  // Prechange capture, exact fragment, behavior/role/ACL probes and rollback all
  // execute in this one psql session. Unit fakes never constitute SQL evidence.
  phase='session';
  const session=parseCatalogueFoundationOutput(run(sql));
  phase='source-postflight';checkSource();phase='identity-postflight';verify();
  phase='publication';
  const report={format:'catalogue-foundation-v1',status:'BOUNDED_FOUNDATION_BEHAVIOR_PASSED',scope:'synthetic-foundation-only',
   task1Complete:false,implementationAccepted:false,hostedVerified:false,trackingReady:false,executionGeneration:1,
   identity,session,files:Object.entries(foundationSqlPaths).map(([name,path])=>({path,sha256:sha(bytes[name])})),
   tests:{prechange:'PASSED',foundation:'PASSED',legacyColumns:'PASSED',roles:'PASSED',rollback:'VERIFIED'},
   targetParity:'SYNTHETIC_SAME_SESSION_ONLY',broaderLockGraph:'UNPROVEN',referenceTracking:'NOT_IMPLEMENTED',
   orderProof:{privateCore:'SEQUENTIAL_SAME_SESSION_PASSED',productionAdmission:'REFUSED_FOUNDATION_NOT_READY',
    actualEventAssertions:'DIRECT_EVENTS_AND_CORE_PARENT_CHAIN_PASSED',globalWriterTracking:'INCOMPLETE',globalDrain:'UNPROVEN',concurrency:'UNRUN'},
   coOrderProof:{privateCore:'SEQUENTIAL_SAME_SESSION_PASSED',productionAdmission:'REFUSED_FOUNDATION_NOT_READY',
    finalComposition:'STAGE04_ORDERS_DISPATCH_AND_STAGE08_MONTHLY_PUBLICATION',
    actualEventAssertions:'DIRECT_EVENTS_IMMUTABLE_STOCK_AND_RETIRED_LINE_SNAPSHOTS_PASSED',
    globalWriterTracking:'INCOMPLETE',globalDrain:'UNPROVEN',concurrency:'UNRUN'},
   remainingWriterProof:{privateCores:'SEQUENTIAL_SAME_SESSION_PASSED',families:['promotion','owner','schedule','visit','evidence','attest'],
    productionAdmission:'REFUSED_FOUNDATION_NOT_READY',actualEventAssertions:'SCOPED_OLD_NEW_AND_RETAINED_VISIT_SOURCE_PASSED',
    legacyAdmission:'TRANSACTION_HELD_DRAIN_INSTALLED',rawPublicDml:'ADMISSION_ONLY_NO_LIFETIME_CERTIFICATION',
    directProductDelete:'PO_EXISTING_PATH_AND_TOMBSTONE_PASSED',globalWriterTracking:'INCOMPLETE',concurrency:'UNRUN'},
   createEditProof:{operations:['create','edit'],role:'authenticated',authorization:'VERIFIED_SYNTHETIC_POLICY_ONLY',
    sequentialReplay:'PASSED',sequentialRecovery:'PASSED',rollbackAtomicity:'PASSED',
    createsRemainUnknown:true,productionGeneration:1,trackingReady:false,concurrency:'UNRUN',hostedPolicyParity:'UNVERIFIED'},
   publicRouterProof:{scope:'PUBLIC_ROUTER_DISPATCH_ONLY',routers:['po','co','promotion','owner','schedule','visit','evidence','attest'],
    roles:['authenticated','service_role'],dispatch:'SEQUENTIAL_SAME_SESSION_PASSED',replay:'EXACT_PUBLIC_RECEIPTS_AND_OWNER_NOOP_PASSED',
    fixtureSubtransactionRestoration:'ROWS_CONSTRAINTS_SESSION_VERIFIED',freshNotReadyRefusals:['po','co','owner'],
    productionGeneration:1,trackingReady:false,globalLifetimeCertification:'NOT_PROVEN',rawCompatibility:'UNPROVEN',
    loadedLegacyRetirement:'UNPROVEN',concurrency:'UNRUN',hostedParity:'UNVERIFIED'},
   checkedCompletionProof:catalogueCheckedCompletionProof,
   commandAndReplaySuites:'SET_ENABLED_SEQUENTIAL_SAME_SESSION_PASSED',
   commandProof:{operations:['set_enabled'],role:'authenticated',authorization:'VERIFIED_SYNTHETIC_POLICY_ONLY',
    sequentialReplay:'PASSED',sequentialAbandonment:'PASSED',rollbackAtomicity:'PASSED',
    concurrentCommandReconcile:'UNRUN',committedCrossSessionRecovery:'UNRUN',hostedPolicyParity:'UNVERIFIED'}};
  checkSource();directory(parent);directory(pending);const current=directory(output);
  assert.equal(current.ino,reserved.ino);assert.equal(current.dev,reserved.dev);assert.deepEqual(readdirSync(output),[]);
  const result=JSON.stringify(report,null,2)+'\n';
  writeFileSync(resolve(pending,'results.json'),result,{flag:'wx'});
  writeFileSync(resolve(pending,'manifest.json'),JSON.stringify({format:'catalogue-foundation-manifest-v1',status:report.status,files:[{path:'results.json',sha256:sha(result)}]})+'\n',{flag:'wx'});
  checkSource();renameSync(pending,output);writeFileSync(descriptor,'bundle_ready=true\n');return report;
 } catch(error) {const refused=new Error('CATALOGUE_FOUNDATION_REFUSED');refused.diagnostic=foundationFailureDiagnostic(phase,error,sourceMap);throw refused;}
 finally {if(descriptor!==undefined)closeSync(descriptor);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {assert.deepEqual(process.argv.slice(2),[]);const report=runCatalogueFoundation();console.log(JSON.stringify({status:report.status,task1Complete:false,implementationAccepted:false,hostedVerified:false,trackingReady:false}));}
 catch(error) {process.stderr.write('CATALOGUE_FOUNDATION_REFUSED\n');if(process.env.GITHUB_ACTIONS==='true'&&error?.diagnostic)process.stderr.write(JSON.stringify({status:'CATALOGUE_FOUNDATION_REFUSED',...error.diagnostic,implementationAccepted:false})+'\n');process.exitCode=1;}
}
