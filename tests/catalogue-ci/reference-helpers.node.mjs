// Unit containment/evidence tests. No fake process result proves SQL behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync,mkdtempSync,writeFileSync,mkdirSync,copyFileSync,rmSync,symlinkSync,readdirSync,existsSync } from 'node:fs';
import { resolve,dirname,join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { cataloguePublicSourcePaths,catalogueCaptureSourceIdentity,catalogueCompositionSha256 } from '../../scripts/catalogue-capture-source.mjs';
let runner;try {runner=await import('../../scripts/catalogue-reference-helpers.mjs');}catch {}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const need=()=>assert.ok(runner,'Bound reference helper runtime runner is not implemented');
const sha=x=>createHash('sha256').update(x).digest('hex');
const ci={repository:'pl0203/lou_erp',workflow:'Pilot safety checks',workflowRef:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/30/merge',job:'catalogue-baseline',event:'pull_request',ref:'refs/pull/30/merge',eventSha:'d'.repeat(40),runId:'9',runAttempt:'1',headRef:'feat/catalogue-mutations-20261014',baseRef:'fix/pilot-database'};
const identity={profile:'github-catalogue-baseline-v1',source:{clean:true,commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64)},serverAddress:'172.18.0.2',serverPort:5432,serverVersion:'170011',systemIdentifier:'123456789',runIdentity:'00000000-0000-4000-8000-000000000001',ci};
const paths={promotionCandidate:'supabase/catalogue/v1/02-promotion-owner-extraction.sql',promotionSuite:'tests/database/catalogue/promotion-owner-extraction.sql',retiredCandidate:'supabase/catalogue/v1/02-retired-co-line-resolution.sql',retiredSuite:'tests/database/catalogue/retired-co-line-resolution.sql',poCandidate:'supabase/catalogue/v1/02-po-reference-extraction.sql',poSuite:'tests/database/catalogue/po-reference-extraction.sql'};
const parts=()=>Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,readFileSync(join(root,path),'utf8')]));
const expected=[
 ['CATALOGUE_REFERENCE_PROMOTION_RED_PASSED','PCE01'],
 ['CATALOGUE_REFERENCE_RETIRED_RED_PASSED','P0001'],
 ['CATALOGUE_REFERENCE_PO_RED_PASSED','42883'],
 ['CATALOGUE_REFERENCE_CANDIDATES_APPLIED','00000'],
 ['CATALOGUE_REFERENCE_PROMOTION_SEMANTICS_PASSED','00000'],
 ['CATALOGUE_REFERENCE_RETIRED_SEMANTICS_PASSED','00000'],
 ['CATALOGUE_REFERENCE_PO_SEMANTICS_PASSED','00000'],
 ['CATALOGUE_REFERENCE_ACL_PASSED','00000'],
 ['CATALOGUE_REFERENCE_ROLLBACK_VERIFIED','00000'],
];
const markers=()=>expected.map(([name,state])=>`${name} 412 827 ${state}`).join('\n')+'\n';

test('one guarded session proves exact missing-helper REDs before all three installations and rolls all back',()=>{
 need();assert.deepEqual(runner.referenceSqlPaths,paths);
 const input=parts(),sql=runner.buildCatalogueReferenceSession(identity,input);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);assert.equal((sql.match(/^ROLLBACK;/gm)||[]).length,1);
 assert.ok(sql.indexOf('SELECT 1/0 AS catalogue_identity_refused;')<sql.indexOf('BEGIN;'));
 assert.ok(sql.indexOf('BEGIN;')<sql.indexOf('CATALOGUE_REFERENCE_PROMOTION_RED_PASSED'));
 for(const candidate of [input.promotionCandidate,input.retiredCandidate,input.poCandidate]){
  assert.equal(sql.split(candidate).length,2);
  assert.ok(sql.indexOf('CATALOGUE_REFERENCE_PO_RED_PASSED')<sql.indexOf(candidate));
  assert.ok(sql.indexOf(candidate)<sql.indexOf('CATALOGUE_REFERENCE_CANDIDATES_APPLIED'));
 }
 assert.ok(sql.indexOf('CATALOGUE_REFERENCE_CANDIDATES_APPLIED')<sql.indexOf('CATALOGUE_REFERENCE_PROMOTION_SEMANTICS_PASSED'));
 assert.ok(sql.indexOf('CATALOGUE_REFERENCE_RETIRED_SEMANTICS_PASSED')<sql.indexOf('CATALOGUE_REFERENCE_PO_SEMANTICS_PASSED'));
 assert.ok(sql.indexOf('CATALOGUE_REFERENCE_PO_SEMANTICS_PASSED')<sql.indexOf('CATALOGUE_REFERENCE_ACL_PASSED'));
 assert.ok(sql.indexOf('CATALOGUE_REFERENCE_ACL_PASSED')<sql.lastIndexOf('ROLLBACK;'));
 assert.ok(sql.lastIndexOf('ROLLBACK;')<sql.indexOf('CATALOGUE_REFERENCE_ROLLBACK_VERIFIED'));
 assert.match(sql,/pg_backend_pid\(\)/);assert.match(sql,/txid_current\(\)/);
 assert.match(sql,/SET LOCAL statement_timeout = '30s'/);assert.match(sql,/SET LOCAL lock_timeout = '3s'/);
 assert.doesNotMatch(sql,/^COMMIT;|ON_ERROR_STOP (?:off|0)|WHEN OTHERS THEN/gm);
});
test('RED acceptance catches only each exact missing SQLSTATE and message, including actual server state evidence',()=>{
 need();const sql=runner.buildCatalogueReferenceSession(identity,parts());
 for(const [state,message] of [['PCE01','CATALOGUE_PROMOTION_OWNER_MISSING_FUNCTION'],['P0001','MISSING_RETIRED_CO_LINE_RESOLVER'],['42883','function private.catalog_por_extract_event_v1(regclass, text, jsonb, jsonb, jsonb) does not exist']]){
  assert.ok(sql.includes(`EXCEPTION WHEN SQLSTATE '${state}' THEN`));
  assert.ok(sql.includes(`observed_message IS DISTINCT FROM '${message}'`));
  assert.ok(sql.includes(`observed_state IS DISTINCT FROM '${state}'`));
 }
 assert.match(sql,/GET STACKED DIAGNOSTICS observed_state = RETURNED_SQLSTATE, observed_message = MESSAGE_TEXT/);
 assert.match(sql,/CATALOGUE_REFERENCE_UNEXPECTED_PASS/);
 assert.match(sql,/promotion_sqlstate = observed_state/);assert.match(sql,/retired_sqlstate = observed_state/);assert.match(sql,/po_sqlstate = observed_state/);
 assert.match(sql,/promotion_sqlstate AS catalogue_reference_red_state/);
 assert.match(sql,/retired_sqlstate AS catalogue_reference_red_state/);
 assert.match(sql,/po_sqlstate AS catalogue_reference_red_state/);
});
test('only the two exact known promotion echo lines are removed; every other client or transaction command is refused',()=>{
 need();const input=parts();
 const normalized=runner.referenceSuiteSql('promotionSuite',input.promotionSuite);
 assert.equal(normalized,input.promotionSuite.replace('\\echo CATALOGUE_PROMOTION_OWNER_FIXTURE_READY\n','').replace('\\echo CATALOGUE_PROMOTION_OWNER_CONTRACT_PASSED\n',''));
 assert.equal(runner.referenceSuiteSql('retiredSuite',input.retiredSuite),input.retiredSuite);
 assert.equal(runner.referenceSuiteSql('poSuite',input.poSuite),input.poSuite);
 for(const extra of ['COMMIT;','BEGIN;','ROLLBACK;','\\i outside.sql','\\echo EXTRA','SELECT 1;\n\\quit',"SELECT '\\'; COMMIT; --';",'-- comment\rCOMMIT;']){
  for(const key of Object.keys(input))assert.throws(()=>runner.buildCatalogueReferenceSession(identity,{...input,[key]:input[key]+'\n'+extra}));
 }
 for(const echo of ['\\echo CATALOGUE_PROMOTION_OWNER_FIXTURE_READY\n','\\echo CATALOGUE_PROMOTION_OWNER_CONTRACT_PASSED\n']){
  assert.throws(()=>runner.buildCatalogueReferenceSession(identity,{...input,promotionSuite:input.promotionSuite.replace(echo,'')}));
  assert.throws(()=>runner.buildCatalogueReferenceSession(identity,{...input,promotionSuite:input.promotionSuite+echo}));
 }
 for(const key of Object.keys(input)){const changed={...input};delete changed[key];assert.throws(()=>runner.buildCatalogueReferenceSession(identity,changed));}
});
const signatures=[
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
];
test('ACL SQL requires exact twenty-six signatures and specifies omission, overload and family-lookalike refusal',()=>{
 need();assert.deepEqual(runner.referenceHelperSignatures,signatures);assert.ok(Object.isFrozen(runner.referenceHelperSignatures));
 assert.equal(new Set(signatures).size,26);const sql=runner.buildCatalogueReferenceSession(identity,parts());
 for(const signature of signatures)assert.ok(sql.includes(`'${signature}'`),signature);
 assert.match(sql,/pg_catalog\.to_regprocedure\(signature\)::oid/);
 assert.match(sql,/FULL JOIN actual USING\(oid\)/);
 assert.match(sql,/expected\.oid IS NULL OR actual\.oid IS NULL/);
 const runtimeAcl=sql.slice(sql.indexOf('DO $catalogue_reference_acl$'),sql.indexOf('DO $catalogue_reference_api_acl$'));
 assert.doesNotMatch(runtimeAcl,/proname LIKE|count\(\*\) = 15/);
 for(const prefix of ['catalog_po_','catalog_por_','catalog_rcl_'])assert.ok(sql.includes(`pg_catalog.starts_with(p.proname,'${prefix}')`));
 for(const text of ['prosecdef','provolatile','proconfig','proowner','aclexplode','has_function_privilege',"ARRAY['anon','authenticated','service_role']","WHEN insufficient_privilege THEN",'SET LOCAL ROLE','RESET ROLE'])assert.ok(sql.includes(text),text);
 const probe='SELECT private.catalog_por_extract_event_v1(NULL::regclass,NULL::text,NULL::jsonb,NULL::jsonb,NULL::jsonb)';
 for(const role of ['anon','authenticated','service_role'])assert.ok(sql.slice(sql.indexOf(`SET LOCAL ROLE ${role};`),sql.indexOf('RESET ROLE;',sql.indexOf(`SET LOCAL ROLE ${role};`))).includes(probe));
 assert.match(sql,/catalogue_reference_rollback_refused/);assert.match(sql,/pg_temp\.catalogue_reference_session_v1'\) IS NULL/);
});
test('unchanged PO suite returning normally cannot qualify RED without an actual exact typed missing-entrypoint failure',()=>{
 need();const input=parts(),sql=runner.buildCatalogueReferenceSession(identity,input);
 const escaped=input.poSuite.replaceAll("'","''");
 const probe='SELECT private.catalog_por_extract_event_v1(NULL::regclass,NULL::text,NULL::jsonb,NULL::jsonb,NULL::jsonb)';
 assert.equal(sql.split(input.poSuite).length,2,'Frozen suite executes unchanged for GREEN');
 const red=sql.slice(sql.indexOf(escaped),sql.indexOf('CATALOGUE_REFERENCE_PO_RED_PASSED'));
 assert.ok(red.indexOf(escaped)<red.indexOf(probe),'Probe follows successful reviewed RED suite');
 assert.ok(red.indexOf(probe)<red.indexOf("RAISE EXCEPTION 'CATALOGUE_REFERENCE_UNEXPECTED_PASS'"));
 assert.ok(red.includes("EXCEPTION WHEN SQLSTATE '42883' THEN"));
 assert.ok(red.includes("observed_message IS DISTINCT FROM 'function private.catalog_por_extract_event_v1(regclass, text, jsonb, jsonb, jsonb) does not exist'"));
 assert.ok(sql.indexOf("SELECT 1/0 AS catalogue_reference_po_entrypoint_refused;")<sql.indexOf(input.poSuite));
 assert.match(sql,/pg_catalog\.to_regprocedure\('private\.catalog_por_extract_event_v1\(regclass,text,jsonb,jsonb,jsonb\)'\) IS NOT NULL/);
});
test('only all nine ordered state-bound same-session markers with verified rollback are accepted',()=>{
 need();assert.deepEqual(runner.parseCatalogueReferenceOutput(markers()),{backendPid:'412',transactionId:'827'});
 for(const output of ['',markers().trim(),markers()+'PRIVATE_CANARY\n',markers().replace('PCE01','PCE00'),markers().replace('P0001','42P01'),markers().replace('42883','42601'),markers().replace('412 827','413 827'),markers().replace('412 827','412 828'),markers().replace('412','0'),markers().split('\n').slice(0,-2).join('\n')+'\n',markers().split('\n').reverse().join('\n')])assert.throws(()=>runner.parseCatalogueReferenceOutput(output));
});
function fixture(){
 need();const directory=mkdtempSync(join(tmpdir(),'catalogue-reference-unit-'));
 const composition=JSON.parse(readFileSync(join(root,'supabase/catalogue/ci/composition.json'),'utf8'));
 for(const path of new Set([...cataloguePublicSourcePaths,...Object.values(paths),...composition.composition.map(x=>x.path)])){
  const destination=join(directory,path);mkdirSync(dirname(destination),{recursive:true});copyFileSync(join(root,path),destination);
 }
 let dirty=false;
 const git=(command,args,options)=>{assert.equal(command,'git');assert.equal(options.env.GIT_NO_LAZY_FETCH,'1');return args.includes('HEAD^{tree}')?'b'.repeat(40):args.includes('HEAD')?'a'.repeat(40):dirty?' M changed':'';};
 const source=catalogueCaptureSourceIdentity(directory,git),boundIdentity={...identity,source};
 const capture={format:'catalogue-baseline-capture-v1',status:'captured-unverified',scope:'synthetic-composed-source-only',task1Complete:false,hostedVerified:false,identity:boundIdentity,compositionSha256:catalogueCompositionSha256,compositionPhases:42,refusalProbe:'verified-on-error-stop',implementationSuitesRun:[],catalog:{}};
 const captured=join(directory,'scale-results/catalogue-baseline');mkdirSync(captured,{recursive:true});
 const writeCapture=()=>{const bytes=JSON.stringify(capture);writeFileSync(join(captured,'capture.json'),bytes);writeFileSync(join(captured,'manifest.json'),JSON.stringify({format:'catalogue-capture-manifest-v1',status:'captured-unverified',source,ci,files:[{path:'capture.json',sha256:sha(bytes)}]}));};writeCapture();
 const output=join(directory,'action-output');writeFileSync(output,'');
 const env={PATH:process.env.PATH,GIT_NO_LAZY_FETCH:'1',CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:ci.repository,GITHUB_WORKFLOW:ci.workflow,GITHUB_WORKFLOW_REF:ci.workflowRef,GITHUB_JOB:ci.job,GITHUB_EVENT_NAME:ci.event,GITHUB_REF:ci.ref,GITHUB_SHA:ci.eventSha,GITHUB_RUN_ID:ci.runId,GITHUB_RUN_ATTEMPT:ci.runAttempt,CATALOGUE_CI_PROFILE:boundIdentity.profile,CATALOGUE_CI_HEAD_REPOSITORY:ci.repository,CATALOGUE_CI_BASE_REPOSITORY:ci.repository,CATALOGUE_CI_HEAD_REF:ci.headRef,CATALOGUE_CI_BASE_REF:ci.baseRef,CATALOGUE_CI_SOURCE_SHA:source.commit,CATALOGUE_CI_CANDIDATE_SHA256:source.candidate,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only',GITHUB_OUTPUT:output};
 const calls=[];let behavior,afterBehavior,observedChange;
 const execute=(command,args,options)=>{
  if(command==='git')return git(command,args,options);
  assert.equal(command,'psql');calls.push({args,options});
  assert.equal(options.env.GIT_NO_LAZY_FETCH,'1');assert.equal(options.env.PGDATABASE,'pilot_catalogue_test');assert.equal(options.env.HOME,undefined);assert.equal(options.env.PGSERVICE,undefined);
  assert.ok(options.input.includes('SELECT 1/0 AS catalogue_identity_refused;'));
  assert.deepEqual(args,['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']);
  assert.equal(options.shell,false);assert.ok(options.timeout<=180000);assert.ok(options.maxBuffer<=512*1024);
  if(options.input.includes('CATALOGUE_FIXTURE_OBSERVATION')){
   const observed={database:'pilot_catalogue_test',operator:'postgres',database_owner:'postgres',system_identifier:boundIdentity.systemIdentifier,server_version_num:boundIdentity.serverVersion,server_address:boundIdentity.serverAddress,server_port:5432,marker:{kind:'r',owner:'postgres',rows:[{singleton:true,purpose:'disposable-catalogue-ci-v1',identity:boundIdentity}]}};
   observedChange?.(observed,calls.length);return JSON.stringify(observed);
  }
  const result=behavior?behavior(options.input):markers();afterBehavior?.();return result;
 };
 return {directory,env,capture,writeCapture,output,calls,execute,setDirty:()=>dirty=true,setBehavior:x=>behavior=x,setAfterBehavior:x=>afterBehavior=x,setObservedChange:x=>observedChange=x,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
const withFixture=fn=>{const f=fixture();try{return fn(f);}finally{f.cleanup();}};
test('bound runner publishes checksummed narrow helper-only evidence only after one session and both identity checks',()=>withFixture(f=>{
 const report=runner.runCatalogueReferenceHelpers({repoRoot:f.directory,env:f.env,execute:f.execute});
 assert.equal(f.calls.length,3);const session=f.calls[1].options.input;
 for(const key of ['promotionCandidate','retiredCandidate','poCandidate'])assert.ok(session.includes(readFileSync(join(f.directory,paths[key]),'utf8')));
 assert.equal(report.status,'BOUNDED_REFERENCE_HELPERS_PASSED');
 for(const key of ['task1Complete','implementationAccepted','hostedVerified','trackingReady'])assert.equal(report[key],false);
 assert.equal(report.executionGeneration,1);assert.equal(report.referenceTracking,'NOT_IMPLEMENTED');assert.equal(report.collectorCompleteness,'UNPROVEN');assert.equal(report.fullReferenceClosure,'UNPROVEN');
 assert.deepEqual(report.tests,{promotionMissing:{status:'EXPECTED_RED',sqlstate:'PCE01'},retiredMissing:{status:'EXPECTED_RED',sqlstate:'P0001'},poMissing:{status:'EXPECTED_RED',sqlstate:'42883'},promotionSemantics:'PASSED',retiredSemantics:'PASSED',poSemantics:'PASSED',ownerAndEffectiveAcl:'PASSED',actualApiRoleDenial:'PASSED',rollback:'VERIFIED'});
 assert.deepEqual(report.session,{backendPid:'412',transactionId:'827'});
 assert.deepEqual(report.files,Object.values(paths).map(path=>({path,sha256:sha(readFileSync(join(f.directory,path)))})));
 const out=join(f.directory,'scale-results/catalogue-reference-helpers');assert.deepEqual(readdirSync(out).sort(),['manifest.json','results.json']);
 const bytes=readFileSync(join(out,'results.json'),'utf8');assert.deepEqual(JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')).files,[{path:'results.json',sha256:sha(bytes)}]);
 assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\nbundle_ready=true\n');
}));
test('any SQL failure including a missing-helper error escaping its exact checkpoint refuses publication',()=>{
 for(const state of ['PCE01','P0001','42883','PCE00','42P01','42601','42501','57014'])withFixture(f=>{
  f.setBehavior(()=>{throw Object.assign(new Error('PRIVATE_CANARY'),{status:3,signal:null,stdout:'',stderr:`ERROR:  ${state}: PRIVATE_CANARY\nCONTEXT: SQL PRIVATE_CANARY\n`});});
  assert.throws(()=>runner.runCatalogueReferenceHelpers({repoRoot:f.directory,env:f.env,execute:f.execute}),error=>{
   assert.equal(error.message,'CATALOGUE_REFERENCE_HELPERS_REFUSED');assert.deepEqual(error.diagnostic,{phase:'session',completedMarkerIndex:-1,sqlstate:state});assert.ok(!JSON.stringify(error).includes('CANARY'));return true;
  });
  assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\n');assert.equal(existsSync(join(f.directory,'scale-results/catalogue-reference-helpers/results.json')),false);
 });
});
test('partial or wrong-state markers, source/run/server drift and ambient target overrides never authorize upload',()=>{
 for(const change of [
  f=>f.setBehavior(()=>markers().split('\n').slice(0,-2).join('\n')+'\n'),
  f=>f.setBehavior(()=>markers().replace('PCE01','PCE00')),
  f=>f.setBehavior(()=>markers().replace('42883','42P01')),
  f=>f.setBehavior(()=>markers().split('\n').filter(line=>!line.startsWith('CATALOGUE_REFERENCE_PO_RED_PASSED')).join('\n')),
  ...Object.values(paths).map(path=>f=>f.setAfterBehavior(()=>writeFileSync(join(f.directory,path),'SELECT 1;'))),
  f=>f.setAfterBehavior(()=>writeFileSync(join(f.directory,'scripts/catalogue-reference-helpers.mjs'),'// drift')),
  f=>f.setAfterBehavior(f.setDirty),
  f=>f.setObservedChange((observed,count)=>{if(count===3)observed.server_address='172.18.0.3';}),
  f=>f.setObservedChange((observed,count)=>{if(count===1)observed.system_identifier='999';}),
  f=>{f.capture.identity.ci={...ci,runAttempt:'2'};f.writeCapture();},
  f=>f.env.PGHOST='remote.invalid',f=>f.env.PGSERVICE='PRIVATE_CANARY',f=>f.env.DATABASE_URL='PRIVATE_CANARY',
 ])withFixture(f=>{
  change(f);assert.throws(()=>runner.runCatalogueReferenceHelpers({repoRoot:f.directory,env:f.env,execute:f.execute}),/^Error: CATALOGUE_REFERENCE_HELPERS_REFUSED$/);
  assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\n');assert.equal(existsSync(join(f.directory,'scale-results/catalogue-reference-helpers/results.json')),false);
 });
});
test('stale evidence, symlink source, altered fragments and missing inputs fail before SQL',()=>{
 for(const change of [
  f=>mkdirSync(join(f.directory,'scale-results/catalogue-reference-helpers')),
  f=>mkdirSync(join(f.directory,'scale-results/catalogue-reference-helpers-pending')),
  f=>symlinkSync(join(f.directory,'absent'),join(f.directory,'scale-results/catalogue-reference-helpers')),
  f=>{const path=join(f.directory,paths.promotionCandidate);rmSync(path);symlinkSync(join(root,paths.promotionCandidate),path);},
  f=>writeFileSync(join(f.directory,paths.retiredCandidate),'COMMIT;'),
  f=>rmSync(join(f.directory,paths.retiredSuite)),
 ])withFixture(f=>{
  change(f);assert.throws(()=>runner.runCatalogueReferenceHelpers({repoRoot:f.directory,env:f.env,execute:f.execute}),/CATALOGUE_REFERENCE_HELPERS_REFUSED/);
  assert.equal(f.calls.length,0);assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\n');
 });
});
test('diagnostics expose only bounded phase, SQLSTATE and complete same-session marker prefix',()=>{
 need();const error={status:3,signal:null,stdout:expected.slice(0,2).map(([name,state])=>`${name} 412 827 ${state}`).join('\n')+'\n',stderr:'ERROR:  42601: PRIVATE_CANARY\nLINE 1: SECRET_SQL\n'};
 assert.deepEqual(runner.referenceFailureDiagnostic('session',error),{phase:'session',completedMarkerIndex:1,sqlstate:'42601'});
 for(const change of [{stdout:error.stdout.replace('P0001','42P01')},{stdout:error.stdout.replace('412','413')},{stdout:'PRIVATE_CANARY\n'},{status:2},{signal:'SIGTERM'},{code:'ENOENT'},{stderr:error.stderr+'ERROR: P0001: another\n'}]){
  const diagnostic=runner.referenceFailureDiagnostic('session',{...error,...change});assert.equal(diagnostic.completedMarkerIndex,null);assert.ok(!JSON.stringify(diagnostic).includes('CANARY'));
 }
 assert.deepEqual(runner.referenceFailureDiagnostic('PRIVATE_CANARY',error),{phase:'unknown',completedMarkerIndex:null,sqlstate:null});
});
test('CLI has no target/apply/output override and refuses outside CI without leaking user input',()=>{
 need();for(const args of [[],['--url','PRIVATE_CANARY'],['--apply'],['--output','PRIVATE_CANARY']]){
  const result=spawnSync(process.execPath,[join(root,'scripts/catalogue-reference-helpers.mjs'),...args],{env:{PATH:'/intentionally-absent-executables',GIT_NO_LAZY_FETCH:'1'},encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'CATALOGUE_REFERENCE_HELPERS_REFUSED\n');
 }
});
test('all nine frozen candidate files and shared harness participate in source identity without changing reviewed inputs',()=>{
 need();for(const [path,digest] of [
 [paths.promotionCandidate,'d53ad17d77fbafbf8542c29fbcd04a3b3457916d296d0f2bf28df78a1389affc'],
 [paths.promotionSuite,'0fe9f8cd7930120014f0eaf86393c913106ec91c9e0fa64ff970a59f24da3f41'],
 ['tests/catalogue-ci/promotion-owner-extraction.node.mjs','f14add017e194827cd1ac8496d90ad0c4c91b36e0161f7b82ae1a03429b9d402'],
 [paths.poCandidate,'9e3cc414e49d6a7f1765b514c4292a796f626fe94a3ded7c8d32e5e97fd36668'],
 [paths.poSuite,'78a0d7a7d21b8b0dadd4f6ca52fd0e08c197c4ce8793ef255e9eca418712c2c0'],
 ['tests/catalogue-ci/po-reference-extraction.node.mjs','63ecc58da3f7ed7225f2cf2bc8307740d3a88b55f5933d19b69742f2f6073df6'],
 [paths.retiredCandidate,'361e4089150bc338268926e5c48db2e76afedff024f4b684118d022990238591'],
 [paths.retiredSuite,'77f2862cc9a0cf850aa67b43675cf6afdfb8d658da61b0ba67ce91567840b12f'],
 ['tests/catalogue/retired-co-line-resolution.source.mjs','bb7e80280053193c1f97e3624ef0d862de4922a354ad838479c8056387507e65'],
 ]){assert.equal(sha(readFileSync(join(root,path))),digest,path);assert.ok(cataloguePublicSourcePaths.includes(path),path);}
 for(const path of ['scripts/catalogue-reference-helpers.mjs','tests/catalogue-ci/reference-helpers.node.mjs'])assert.ok(cataloguePublicSourcePaths.includes(path),path);
 assert.equal(new Set(cataloguePublicSourcePaths).size,cataloguePublicSourcePaths.length);
});
test('public PG17 CI preserves foundation failure and independently gates helper evidence on successful baseline capture',()=>{
 need();const workflow=readFileSync(join(root,'.github/workflows/pilot-safety.yml'),'utf8'),split=workflow.indexOf('\n  catalogue-baseline:'),job=workflow.slice(split);
 assert.equal(sha(workflow.slice(0,split)),'32b1e9ded0e18c707af5e2bdc15c7730a0a61634da296b078240b2d2ad6cf505');
 assert.ok(job.includes('image: postgres:17'));assert.ok(job.includes('persist-credentials: false'));
 assert.match(job,/id: catalogue-baseline-capture\n\s+run: node scripts\/catalogue-capture-baseline\.mjs/);
 assert.ok(job.indexOf('node --test tests/catalogue-ci/reference-helpers.node.mjs')<job.indexOf('Bind clean candidate bytes before capture'));
 for(const path of ['tests/catalogue-ci/promotion-owner-extraction.node.mjs','tests/catalogue/retired-co-line-resolution.source.mjs','tests/catalogue-ci/po-reference-extraction.node.mjs'])assert.ok(job.includes(path));
 assert.ok(job.indexOf('node scripts/catalogue-reference-helpers.mjs')>job.indexOf('node scripts/catalogue-foundation.mjs'));
 assert.match(job,/if: \$\{\{ !cancelled\(\) && steps\.catalogue-baseline-capture\.outcome == 'success' \}\}\n\s+id: catalogue-reference-helpers\n\s+run: node scripts\/catalogue-reference-helpers\.mjs/);
 assert.ok(job.includes("if: ${{ always() && steps.catalogue-reference-helpers.outputs.bundle_ready == 'true' }}"));
 assert.ok(job.includes('path: scale-results/catalogue-reference-helpers'));assert.ok(job.includes('name: catalogue-reference-helpers-${{ github.run_id }}-${{ github.run_attempt }}'));
 assert.doesNotMatch(job,/continue-on-error|pull_request_target|secrets\.|--url|--reset/);
 assert.equal(job.split('run: node scripts/catalogue-foundation.mjs').length,2);
});
