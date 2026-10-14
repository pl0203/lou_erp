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
});
export const foundationExpectedMarkers=Object.freeze([
 'CATALOGUE_FOUNDATION_BEFORE_CAPTURED','CATALOGUE_FOUNDATION_CANDIDATE_APPLIED',
 'CATALOGUE_FOUNDATION_BEHAVIOR_PASSED','CATALOGUE_FOUNDATION_LEGACY_PASSED',
 'CATALOGUE_FOUNDATION_ROLES_PASSED','CATALOGUE_FOUNDATION_ROLLBACK_VERIFIED',
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
const noFoundationPredicate=`pg_catalog.to_regclass('private.catalog_identity_v1') IS NULL
 AND pg_catalog.to_regclass('private.catalog_cutover_v1') IS NULL
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
 for(const sql of Object.values(parts))foundationTopLevelSql(sql);
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
${sessionGate()}${mark(1)}${parts.foundation}
${sessionGate()}${mark(2)}${parts.legacy}
${sessionGate()}${mark(3)}${parts.roles}
${sessionGate()}${mark(4)}ROLLBACK;
${catalogueCiIdentityGateSql(identity)}${booleanGate(`${noFoundationPredicate}\n AND pg_catalog.pg_backend_pid()=:'catalogue_foundation_pid'::integer\n AND pg_catalog.to_regclass('pg_temp.catalogue_foundation_session_v1') IS NULL`,'catalogue_foundation_rollback_refused')}${mark(5)}\\o
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
export function runCatalogueFoundation({repoRoot=defaultRoot,env=process.env,execute=execFileSync}={}) {
 let descriptor;
 try {
  assert.equal(typeof env.GITHUB_OUTPUT,'string');
  descriptor=openSync(env.GITHUB_OUTPUT,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);
  assert.ok(fstatSync(descriptor).isFile());writeFileSync(descriptor,'bundle_ready=false\n');
  const binding=catalogueFailfastBinding(repoRoot,env,execute),identity=binding.identity;
  const connection={...catalogueCiConnection(env,identity.source),PGDATABASE:'pilot_catalogue_test',LC_ALL:'C'};
  const bytes=Object.fromEntries(Object.entries(foundationSqlPaths).map(([name,path])=>[name,catalogueCaptureSourceBytes(repoRoot,path)]));
  const parts=Object.fromEntries(Object.entries(bytes).map(([name,body])=>[name,body.toString('utf8')]));
  const sql=buildCatalogueFoundationSession(identity,parts);
  const parent=resolve(repoRoot,'scale-results');directory(parent);
  const output=resolve(parent,'catalogue-foundation'),pending=resolve(parent,'catalogue-foundation-pending');
  mkdirSync(output);const reserved=directory(output);mkdirSync(pending);directory(pending);
  const checkSource=()=>assert.deepEqual(catalogueFailfastBinding(repoRoot,env,execute),binding);
  const run=input=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{
   cwd:repoRoot,env:connection,input,encoding:'utf8',timeout:180000,maxBuffer:512*1024,shell:false,stdio:['pipe','pipe','pipe']});
  const verify=()=>verifyCatalogueCiObservation(JSON.parse(run(catalogueCiIdentityGateSql(identity)+catalogueObservationSql('pilot_catalogue_test'))),identity,'pilot_catalogue_test');
  checkSource();verify();
  // Prechange capture, exact fragment, behavior/role/ACL probes and rollback all
  // execute in this one psql session. Unit fakes never constitute SQL evidence.
  const session=parseCatalogueFoundationOutput(run(sql));
  checkSource();verify();
  const report={format:'catalogue-foundation-v1',status:'BOUNDED_FOUNDATION_BEHAVIOR_PASSED',scope:'synthetic-foundation-only',
   task1Complete:false,implementationAccepted:false,hostedVerified:false,trackingReady:false,executionGeneration:1,
   identity,session,files:Object.entries(foundationSqlPaths).map(([name,path])=>({path,sha256:sha(bytes[name])})),
   tests:{prechange:'PASSED',foundation:'PASSED',legacyColumns:'PASSED',roles:'PASSED',rollback:'VERIFIED'},
   targetParity:'SYNTHETIC_SAME_SESSION_ONLY',broaderLockGraph:'UNPROVEN',referenceTracking:'NOT_IMPLEMENTED',commandAndReplaySuites:'UNRUN'};
  checkSource();directory(parent);directory(pending);const current=directory(output);
  assert.equal(current.ino,reserved.ino);assert.equal(current.dev,reserved.dev);assert.deepEqual(readdirSync(output),[]);
  const result=JSON.stringify(report,null,2)+'\n';
  writeFileSync(resolve(pending,'results.json'),result,{flag:'wx'});
  writeFileSync(resolve(pending,'manifest.json'),JSON.stringify({format:'catalogue-foundation-manifest-v1',status:report.status,files:[{path:'results.json',sha256:sha(result)}]})+'\n',{flag:'wx'});
  checkSource();renameSync(pending,output);writeFileSync(descriptor,'bundle_ready=true\n');return report;
 } catch {throw new Error('CATALOGUE_FOUNDATION_REFUSED');}
 finally {if(descriptor!==undefined)closeSync(descriptor);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {assert.deepEqual(process.argv.slice(2),[]);const report=runCatalogueFoundation();console.log(JSON.stringify({status:report.status,task1Complete:false,implementationAccepted:false,hostedVerified:false,trackingReady:false}));}
 catch {process.stderr.write('CATALOGUE_FOUNDATION_REFUSED\n');process.exitCode=1;}
}
