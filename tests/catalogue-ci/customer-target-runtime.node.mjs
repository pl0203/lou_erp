import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
let runner;try{runner=await import('../../scripts/catalogue-customer-target-runtime.mjs');}catch{}
const need=()=>assert.ok(runner,'Guarded raw target runtime harness missing');
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const expectedLifecyclePhases=["FOUNDATION","TARGET_SETUP","TARGET_INSTALL","TARGET_AUTHORITY","TARGET_EVENTS","TARGET_CASCADE_DROP","TARGET_CASCADE_ADD","TARGET_CASCADE_EVENTS","TARGET_AUTHENTICATED","TARGET_MISSING_IDENTITY","TARGET_ASSERTION_ONLY","TARGET_SESSION_GATE","VARIANTS_AND_ROLES","ROLLBACK","COMPLETE"];
const identity={profile:'github-catalogue-baseline-v1',source:{clean:true,commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64)},serverAddress:'172.18.0.2',serverPort:5432,serverVersion:'170011',systemIdentifier:'123456789',runIdentity:'00000000-0000-4000-8000-000000000001',ci:{}};
const parts=()=>Object.fromEntries(Object.entries(runner.targetRuntimePaths).map(([k,p])=>[k,read(p)]));
test('joined target ACL assertion qualifies live columns against the saved baseline',()=>{
 need();const p=parts();
 const assertion="SELECT pg_temp.foundation_assert((SELECT c.relacl IS NOT DISTINCT FROM b.relacl AND c.relrowsecurity=b.relrowsecurity AND c.relforcerowsecurity=b.relforcerowsecurity FROM pg_class c JOIN target_acl_before b USING(oid)),'target table ACL and RLS unchanged');";
 for(const sql of [p.lifecycle,runner.expandTargetLifecycle(p.lifecycle,p.target,p.authority),runner.buildTargetLifecycleSession(identity,p)]){
  assert.deepEqual(sql.split('\n').filter(line=>line.includes('FROM pg_class c JOIN target_acl_before b USING(oid)')),[assertion]);
 }
});
test('frozen lifecycle is expanded exactly once; altered savepoints, meta commands and boundaries are refused',()=>{
 need();const p=parts();const sql=runner.expandTargetLifecycle(p.lifecycle,p.target);
 assert.ok(sql.includes(p.target));assert.ok(!sql.includes('\\ir'));assert.match(sql,/SAVEPOINT target_rollback/);
 for(const suffix of ['\nCOMMIT;','\n\\quit','\nSAVEPOINT arbitrary;'])assert.throws(()=>runner.expandTargetLifecycle(p.lifecycle+suffix,p.target));
 assert.throws(()=>runner.expandTargetLifecycle(p.lifecycle.replace('ROLLBACK TO SAVEPOINT target_rollback;','COMMIT;'),p.target));
 assert.throws(()=>runner.expandTargetLifecycle(p.lifecycle,p.target+'\nCOMMIT;'));
});
test('cascade fixture drains queued target assertions before DDL and restores deferred event checks',()=>{
 need();const p=parts();
 const boundary=[
  'SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE;',
  'ALTER TABLE public.customer_targets DROP CONSTRAINT customer_targets_customer_id_fkey;',
  'ALTER TABLE public.customer_targets ADD CONSTRAINT customer_targets_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;',
  'SET CONSTRAINTS public.catalog_customer_targets_assert_v1 DEFERRED;',
  "INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(md5('target-fiction-4')::uuid,'2099-01',md5('catalogue-foundation-actor-3')::uuid);",
 ].join('\n');
 for(const sql of [p.lifecycle,runner.expandTargetLifecycle(p.lifecycle,p.target,p.authority),runner.buildTargetLifecycleSession(identity,p)]){
  const unmarked=sql.split('\n').filter(line=>!line.startsWith('\\echo ')).join('\n');
  assert.equal(unmarked.split(boundary).length,2,'One named drain/DDL/defer boundary before cascade events required');
 }
});
test('lifecycle, authority parity and NULL variants stay in one source-bound rollback session',()=>{
 need();const p=parts(),sql=runner.buildTargetLifecycleSession(identity,p);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);assert.equal((sql.match(/^ROLLBACK;/gm)||[]).length,1);assert.doesNotMatch(sql,/^COMMIT;/m);
 assert.ok(sql.indexOf(p.before)<sql.indexOf(p.foundation));assert.ok(sql.indexOf(p.legacy)<sql.indexOf(p.target));assert.ok(sql.indexOf(p.target)<sql.indexOf(p.authority));
 assert.ok(sql.includes(p.roles));assert.ok(sql.includes(p.variants));
 assert.match(sql,/pg_backend_pid/);assert.match(sql,/txid_current/);assert.match(sql,/catalogue_fixture_identity_v1/);
 assert.ok(sql.indexOf('ROLLBACK;')<sql.indexOf('CATALOGUE_TARGET_ROLLBACK_VERIFIED'));
});
test('only exact complete same-session markers accepted',()=>{
 need();const out=runner.targetMarkers.map(x=>`${x} 123 456`).join('\n')+'\n';assert.deepEqual(runner.parseTargetOutput(out),{backendPid:'123',transactionId:'456'});
 for(const s of [out+'raw result\n',out.replace('123 456','124 456'),out.replace('123 456','123 457'),out.slice(0,-1),''])assert.throws(()=>runner.parseTargetOutput(s));
});
test('race lock identity includes exact typed key, current database and one-bigint key form',()=>{
 need();const sql=runner.targetAdvisoryBarrierSql(123,'11111111-1111-4111-8111-111111111111');
 for(const fragment of ['catalog_identity_v1:customer:','1801427913','classid','objid','objsubid=1','current_database()','pg_blocking_pids'])assert.ok(sql.includes(fragment));
 assert.throws(()=>runner.targetAdvisoryBarrierSql('123 OR true','11111111-1111-4111-8111-111111111111'));
 assert.throws(()=>runner.targetAdvisoryBarrierSql(123,"x'; SELECT 1"));
});
test('all real clients must have distinct actual server PIDs',()=>{
 need();assert.deepEqual(runner.requireTargetPids([123,124,125]),[123,124,125]);
 for(const p of [[123,123,124],[123,124],[0,1,2],[123,'124',125]])assert.throws(()=>runner.requireTargetPids(p));
});
test('source hardening of both reusable race cases refuses same backend and binds exact advisory identities',()=>{
 const s=read('tests/database/catalogue/customer-target-races.mjs');
 assert.match(s,/objsubid\s*=\s*1/);assert.match(s,/1801427913/);assert.match(s,/classid/);assert.match(s,/objid/);
 assert.equal((s.match(/await distinctBackends\(/g)||[]).length,2);
});
test('NULL-only and SET NULL variants explicitly assert no synthetic null identity and retained lifetime/tombstone',()=>{
 need();const s=read(runner.targetRuntimePaths.variants);
 for(const x of ['DROP NOT NULL','ON DELETE SET NULL','customer_id=NULL','null images create no identity','SET NULL retains used tombstone','version retained'])assert.ok(s.includes(x));
});
test('terminal disposal name is fixed, root and child identity guarded, no private env/dependency loading',()=>{
 need();const s=read('scripts/catalogue-customer-target-runtime.mjs');
 assert.match(s,/DROP DATABASE pilot_catalogue_test/);assert.match(s,/catalogueCiIdentityGateSql\(identity,'pilot_test'\)/);
 assert.match(s,/verifyCatalogueCiObservation/);assert.match(s,/catalogueFailfastBinding/);assert.match(s,/PsqlSession/);
 assert.doesNotMatch(s,/import\(['"]pg['"]\)|from ['"]pg['"]|dotenv|readFileSync/);
 assert.match(s,/CLEANUP_UNPROVEN/);assert.match(s,/COMMITTED_SYNTHETIC_CHILD_DISPOSED/);
});
test('authority parity precedes role mutation and checks actual roles/activity/missing profile',()=>{
 need();const p=parts(),sql=runner.buildTargetLifecycleSession(identity,p);
 assert.ok(sql.indexOf(p.authority)<sql.indexOf(p.roles));
 for(const x of ['expected_role','expected_active','is_active','LEFT JOIN public.users','profile_exists'])assert.ok(p.authority.includes(x));
});
test('all explicit target constraints are schema-qualified under empty search path',()=>{
 need();for(const key of ['lifecycle','variants'])assert.doesNotMatch(parts()[key],/SET CONSTRAINTS catalog_customer_targets_assert_v1/);
});
test('committed race fixture is minimal and never creates or grants cluster roles',()=>{
 need();const sql=runner.buildTargetRaceSetup(identity,parts());
 assert.doesNotMatch(sql,/CREATE ROLE|ALTER ROLE|GRANT\s+catalogue_foundation_inherited_probe|catalogue_legacy_probe_cases_v1|foundation_assert/);
 assert.match(sql,/INSERT INTO auth.users/);assert.match(sql,/Fictional race executive/);assert.match(sql,/COMMIT;/);
});
const env={PATH:'/usr/bin',CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'Pilot safety checks',GITHUB_JOB:'catalogue-baseline',GITHUB_EVENT_NAME:'pull_request',CATALOGUE_CI_PROFILE:'github-catalogue-baseline-v1',CATALOGUE_CI_HEAD_REPOSITORY:'pl0203/lou_erp',CATALOGUE_CI_BASE_REPOSITORY:'pl0203/lou_erp',CATALOGUE_CI_HEAD_REF:'feat/catalogue-mutations-20261014',CATALOGUE_CI_BASE_REF:'fix/pilot-database',CATALOGUE_CI_SOURCE_SHA:'a'.repeat(40),CATALOGUE_CI_CANDIDATE_SHA256:'c'.repeat(64),PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'d'.repeat(40),GITHUB_REF:'refs/pull/30/merge',GITHUB_WORKFLOW_REF:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/30/merge'};
const observation={database:'pilot_catalogue_test',operator:'postgres',database_owner:'postgres',server_address:'172.18.0.2',server_port:5432,server_version_num:'170011',system_identifier:'123456789',marker:{kind:'r',owner:'postgres',rows:[{singleton:true,purpose:'disposable-catalogue-ci-v1',identity}]}};
async function orchestrateFailure(kind,prefixCount=1){
 const calls=[];let setup=false;const bind=()=>({identity});
 const execute=(cmd,args,opts)=>{assert.equal(cmd,'psql');calls.push(opts.input);assert.ok(!opts.input.includes('DROP DATABASE'),'failed phases never dispose');
  if(opts.input.includes('CATALOGUE_FIXTURE_OBSERVATION'))return JSON.stringify(kind==='identity'?{...observation,system_identifier:'99'}:observation);
  if(opts.input.includes('CATALOGUE_TARGET_ROLLBACK_VERIFIED')){if(kind==='lifecycle-exec')throw Object.assign(new Error('PRIVATE SQL'),{status:3,signal:null,stdout:runner.targetMarkers.slice(0,prefixCount).map(m=>m+' 123 456\n').join(''),stderr:'ERROR:  55006: PRIVATE SQL\n'});return runner.targetMarkers.map(m=>`${m} 123 456`).join('\n')+'\n'+(kind==='output'?'unexpected\n':'');}
  if(opts.input.includes('target_race_preexisting_refused')){setup=true;if(kind==='uncertain')throw new Error('uncertain setup');return 'unexpected setup output\n';}
  throw new Error('Unexpected test adapter call');
 };
 let caught;try{await runner.runCatalogueCustomerTargetRuntime({repoRoot:'.',env,execute,bind,readSource:(_,p)=>Buffer.from(read(p)),Session:class{constructor(){throw new Error('Must not create sessions');}}});}catch(e){caught=e;}
 assert.equal(caught?.message,'CATALOGUE_TARGET_RUNTIME_REFUSED');assert.equal(caught.cleanup,setup?'CLEANUP_UNPROVEN':'NOT_NEEDED');
 if(kind==='identity')assert.ok(calls.every(sql=>!sql.includes('BEGIN;')));
 if(kind==='output')assert.equal(setup,false);
 if(kind==='lifecycle-exec'){assert.equal(setup,false);assert.deepEqual(caught.diagnostic,{phase:'lifecycle',lifecyclePhase:expectedLifecyclePhases[prefixCount],processExit:'SCRIPT_ERROR',sqlstate:'55006'});}
 if(kind==='uncertain')assert.equal(caught.diagnostic.phase,'race-setup');
 return calls;
}
test('identity mismatch refuses before lifecycle mutations or disposal',async()=>{need();await orchestrateFailure('identity');});
test('unexpected lifecycle output refuses before committed setup or disposal',async()=>{need();await orchestrateFailure('output');});
test('failed/uncertain setup never blindly tears down',async()=>{need();await orchestrateFailure('uncertain');});
test('unexpected committed setup output refuses and leaves cleanup explicitly unproven',async()=>{need();await orchestrateFailure('setup-output');});

test('refusal diagnostics use only exact complete marker-prefix phases',()=>{
 need();const prefix=n=>runner.targetMarkers.slice(0,n).map(m=>m+' 123 456').join('\n')+(n?'\n':'');
 const expected=expectedLifecyclePhases;
 for(let n=0;n<=runner.targetMarkers.length;n++){
  const cause={status:3,signal:null,stdout:prefix(n),stderr:'ERROR:  55006: PRIVATE SQL\nCONTEXT: PRIVATE DATA\n'};
  assert.deepEqual(runner.targetFailureDiagnostic('lifecycle',cause),{phase:'lifecycle',lifecyclePhase:expected[n],processExit:'SCRIPT_ERROR',sqlstate:'55006'});
 }
 for(const stdout of [prefix(1)+'PRIVATE\n',prefix(2).replace('123 456\n','124 456\n'),prefix(1).trimEnd(),runner.targetMarkers[1]+' 123 456\n','PRIVATE\n',undefined]){
  const d=runner.targetFailureDiagnostic('lifecycle',{status:3,signal:null,stdout,stderr:'ERROR:  55006: PRIVATE\n'});
  assert.equal(d.lifecyclePhase,'UNKNOWN');assert.ok(!JSON.stringify(d).includes('PRIVATE'));
 }
 assert.equal(runner.targetFailureDiagnostic('lifecycle-parse',null,prefix(runner.targetMarkers.indexOf('CATALOGUE_TARGET_LIFECYCLE_PASSED')+1)).lifecyclePhase,'VARIANTS_AND_ROLES');
 assert.equal(runner.targetFailureDiagnostic('not-a-phase',{message:'PRIVATE'}).phase,'unknown');
});
test('SQLSTATE requires one strict script-error record and refuses mixed or untrusted errors',()=>{
 need();const base={status:3,signal:null,stdout:'',stderr:'ERROR:  55006: PRIVATE\n'};
 assert.equal(runner.targetFailureDiagnostic('lifecycle',base).sqlstate,'55006');
 const mutations=[
  {status:1},{status:2},{status:0},{signal:'SIGTERM'},{signal:undefined},{code:'ETIMEDOUT'},{code:'PRIVATE'},
  {stderr:'55006'},{stderr:'ERROR: PRIVATE'},{stderr:'ERROR:  55006 PRIVATE\n'},
  {stderr:'ERROR:  lower: PRIVATE\n'},{stderr:'ERROR:  550060: PRIVATE\n'},
  {stderr:'NOTICE:  55006: PRIVATE\n'},{stderr:'prefix ERROR:  55006: PRIVATE\n'},
  {stderr:'ERROR:  55006: PRIVATE\nERROR:  23514: PRIVATE\n'},
  {stderr:'ERROR:  55006: PRIVATE\nFATAL:  08006: PRIVATE\n'},
  {stderr:'ERROR:  55006: PRIVATE\nPANIC:  XX000: PRIVATE\n'},
  {stderr:'ERROR:  55006: PRIVATE\npsql: error: PRIVATE\n'},
  {stderr:Buffer.from('ERROR:  55006: PRIVATE\n')},{stderr:'x'.repeat(512*1024+1)},
  {stderr:'ERROR:  55006: PRIVATE'},{stderr:'ERROR:  55006: PRIVATE\nPRIVATE\n'},
  {stderr:'NOTICE: PRIVATE\nERROR:  55006: PRIVATE\n'},{stderr:'ERROR:  55006: PRIVATE\nNOTICE: PRIVATE\n'},
  {stderr:'ERROR:  55006: PRIVATE\n\n'},{stderr:'ERROR:  55006: PRIVATE\r\n'},
  {stderr:'ERROR:  55006: PRIVATE\nDETAIL: PRIVATE\nDETAIL: PRIVATE\n'},
  {stderr:'ERROR:  55006: PRIVATE\nLOCATION: PRIVATE\nDETAIL: PRIVATE\n'},
  {stderr:'ERROR:  23502: PRIVATE\nSCHEMA NAME: PRIVATE\nTABLE NAME: PRIVATE\nCOLUMN NAME: PRIVATE\nLOCATION: PRIVATE\n'},
  {stderr:'ERROR:  23514: PRIVATE\nCONTEXT: PRIVATE\nPRIVATE continuation\nLOCATION: PRIVATE\n'},
 ];
 for(const change of mutations){
  const d=runner.targetFailureDiagnostic('lifecycle',{...base,...change});
  assert.equal(d.sqlstate,null);assert.ok(!JSON.stringify(d).includes('PRIVATE'));
 }
 assert.equal(runner.targetFailureDiagnostic('lifecycle',{...base,stderr:'ERROR:  55006: PRIVATE\nDETAIL: PRIVATE\nHINT: PRIVATE\nCONTEXT: PRIVATE\nLOCATION: PRIVATE\n'}).sqlstate,'55006');
 assert.equal(runner.targetFailureDiagnostic('binding',base).sqlstate,null);
 assert.equal(runner.targetFailureDiagnostic('races',{...base,sqlstate:'55006',targetSqlstate:'55006'}).sqlstate,null);
});
test('process exits use fixed classes without messages, signal names or arbitrary codes',()=>{
 need();
 for(const [value,expected] of [
  [{status:0,signal:null},'EXIT_0'],[{status:1,signal:null},'EXIT_1'],[{status:2,signal:null},'EXIT_2'],[{status:3,signal:null},'SCRIPT_ERROR'],
  [{status:7,signal:null},'OTHER_NONZERO'],[{signal:'PRIVATE'},'SIGNAL'],[{code:'ETIMEDOUT'},'TIMEOUT'],
  [{code:'ENOBUFS'},'BUFFER_LIMIT'],[{code:'ENOENT'},'SPAWN_FAILURE'],[{code:'PRIVATE'},'UNKNOWN'],[null,'UNKNOWN'],
 ])assert.equal(runner.targetProcessExit(value),expected);
});
test('framed awaited-session SQLSTATE is propagated only on an actual state mismatch',async()=>{
 need();let caught;
 class FailureSession{async query(){return {stdout:'PRIVATE',sqlstate:'55006'};}async close(){}}
 try{await runner.executeTargetRaces({identity,connection:{},checkSource(){},Session:FailureSession});}catch(error){caught=error;}
 assert.ok(caught);const d=runner.targetFailureDiagnostic('races',caught);
 assert.deepEqual(d,{phase:'races',lifecyclePhase:'NOT_APPLICABLE',processExit:'SESSION_SQLSTATE',sqlstate:'55006'});
 assert.ok(!JSON.stringify(d).includes('PRIVATE'));
 class MalformedSession{async query(){return {stdout:'PRIVATE',sqlstate:'PRIVATE'};}async close(){}}
 try{await runner.executeTargetRaces({identity,connection:{},checkSource(){},Session:MalformedSession});}catch(error){caught=error;}
 assert.equal(runner.targetFailureDiagnostic('races',caught).sqlstate,null);
});
test('diagnostic validator refuses extra fields, arbitrary labels and cross-field overclaims',()=>{
 need();const base={phase:'lifecycle',lifecyclePhase:'TARGET_SETUP',processExit:'SCRIPT_ERROR',sqlstate:'55006'};
 assert.deepEqual(runner.validateTargetFailureDiagnostic(base),base);
 for(const change of [{extra:'PRIVATE'},{phase:'PRIVATE'},{lifecyclePhase:'PRIVATE'},{processExit:'PRIVATE'},{sqlstate:'PRIVATE'},{processExit:'TIMEOUT'},{processExit:'SESSION_SQLSTATE'},{phase:'binding'}]){
  assert.throws(()=>runner.validateTargetFailureDiagnostic({...base,...change}));
 }
});

test('actual synchronous refusal retains bounded phase and NOT_NEEDED before committed setup',async()=>{need();await orchestrateFailure('lifecycle-exec');});

test('diagnostic phase process and SQLSTATE combinations match the producer matrix',()=>{
 need();
 const nonExecution=['initialization','binding','source-preflight','lifecycle-parse','source-post-lifecycle','race-setup-parse','source-pre-races','source-post-races','source-post-disposal','unknown'];
 const synchronous=['identity-preflight','lifecycle','identity-post-lifecycle','race-setup','identity-pre-races','identity-post-races','disposal'];
 const processKinds=['UNKNOWN','EXIT_0','EXIT_1','EXIT_2','SCRIPT_ERROR','OTHER_NONZERO','SIGNAL','TIMEOUT','BUFFER_LIMIT','SPAWN_FAILURE'];
 const diagnostic=(phase,processExit,sqlstate)=>({phase,lifecyclePhase:['lifecycle','lifecycle-parse'].includes(phase)?'UNKNOWN':'NOT_APPLICABLE',processExit,sqlstate});
 for(const phase of nonExecution){
  assert.deepEqual(runner.validateTargetFailureDiagnostic(diagnostic(phase,'NOT_APPLICABLE',null)),diagnostic(phase,'NOT_APPLICABLE',null));
  for(const kind of [...processKinds,'SESSION_SQLSTATE'])for(const state of [null,'55006'])assert.throws(()=>runner.validateTargetFailureDiagnostic(diagnostic(phase,kind,state)));
  assert.throws(()=>runner.validateTargetFailureDiagnostic(diagnostic(phase,'NOT_APPLICABLE','55006')));
 }
 for(const phase of synchronous){
  for(const kind of processKinds){
   runner.validateTargetFailureDiagnostic(diagnostic(phase,kind,null));
   if(kind==='SCRIPT_ERROR')runner.validateTargetFailureDiagnostic(diagnostic(phase,kind,'55006'));
   else assert.throws(()=>runner.validateTargetFailureDiagnostic(diagnostic(phase,kind,'55006')));
  }
  for(const state of [null,'55006'])assert.throws(()=>runner.validateTargetFailureDiagnostic(diagnostic(phase,'SESSION_SQLSTATE',state)));
 }
 for(const kind of processKinds){
  runner.validateTargetFailureDiagnostic(diagnostic('races',kind,null));
  assert.throws(()=>runner.validateTargetFailureDiagnostic(diagnostic('races',kind,'55006')));
 }
 assert.throws(()=>runner.validateTargetFailureDiagnostic(diagnostic('races','SESSION_SQLSTATE',null)));
 for(const state of ['00000','55006'])runner.validateTargetFailureDiagnostic(diagnostic('races','SESSION_SQLSTATE',state));
 assert.throws(()=>runner.validateTargetFailureDiagnostic({...diagnostic('lifecycle-parse','NOT_APPLICABLE',null),lifecyclePhase:'COMPLETE'}));
 const complete=runner.targetMarkers.map(m=>m+' 123 456').join('\n')+'\n';
 assert.equal(runner.targetFailureDiagnostic('lifecycle-parse',null,complete).lifecyclePhase,'UNKNOWN');
});

test('fixed target milestones are unique exact insertions without changing reviewed SQL bytes or order',()=>{
 need();const p=parts(),plain=runner.expandTargetLifecycle(p.lifecycle,p.target,p.authority),sql=runner.instrumentTargetLifecycle(p.lifecycle,p.target,p.authority);
 const expected=["CATALOGUE_TARGET_FOUNDATION_PASSED","CATALOGUE_TARGET_SETUP_PASSED","CATALOGUE_TARGET_INSTALL_PASSED","CATALOGUE_TARGET_AUTHORITY_PASSED","CATALOGUE_TARGET_EVENTS_PASSED","CATALOGUE_TARGET_CASCADE_DROP_PASSED","CATALOGUE_TARGET_CASCADE_ADD_PASSED","CATALOGUE_TARGET_CASCADE_PASSED","CATALOGUE_TARGET_AUTHENTICATED_PASSED","CATALOGUE_TARGET_MISSING_IDENTITY_PASSED","CATALOGUE_TARGET_ASSERTION_ONLY_PASSED","CATALOGUE_TARGET_LIFECYCLE_PASSED","CATALOGUE_TARGET_VARIANTS_PASSED","CATALOGUE_TARGET_ROLLBACK_VERIFIED"];
 assert.deepEqual(runner.targetMarkers,expected);
 let restored=sql,last=-1;
 for(const marker of expected.slice(1,-3)){
  const line='\\echo '+marker+' :target_pid :target_xid\n';
  assert.equal(sql.split(line).length,2);assert.ok(sql.indexOf(line)>last);last=sql.indexOf(line);restored=restored.replace(line,'');
 }
 assert.equal(restored,plain);
 assert.ok(sql.indexOf('CATALOGUE_TARGET_SETUP_PASSED')<sql.indexOf(p.target));
 assert.ok(sql.indexOf(p.target)<sql.indexOf('CATALOGUE_TARGET_INSTALL_PASSED'));
 assert.ok(sql.indexOf('CATALOGUE_TARGET_INSTALL_PASSED')<sql.indexOf(p.authority));
 assert.ok(sql.indexOf(p.authority)<sql.indexOf('CATALOGUE_TARGET_AUTHORITY_PASSED'));
 const boundaries=[
  ["'savepoint rolls evidence back with target');",'CATALOGUE_TARGET_EVENTS_PASSED'],
  ['ALTER TABLE public.customer_targets DROP CONSTRAINT customer_targets_customer_id_fkey;','CATALOGUE_TARGET_CASCADE_DROP_PASSED'],
  ['ALTER TABLE public.customer_targets ADD CONSTRAINT customer_targets_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;','CATALOGUE_TARGET_CASCADE_ADD_PASSED'],
  ["'cascade OLD and parent tombstone retained');",'CATALOGUE_TARGET_CASCADE_PASSED'],
  ["'no new unused allocation');",'CATALOGUE_TARGET_AUTHENTICATED_PASSED'],
  ['ROLLBACK TO SAVEPOINT missing_target_identity;','CATALOGUE_TARGET_MISSING_IDENTITY_PASSED'],
  ['ROLLBACK TO SAVEPOINT assertion_only;','CATALOGUE_TARGET_ASSERTION_ONLY_PASSED'],
 ];
 for(const [anchor,marker]of boundaries){assert.equal(sql.split(anchor).length,2);assert.ok(sql.includes(anchor+'\n\\echo '+marker+' :target_pid :target_xid\n'));}
 const full=runner.buildTargetLifecycleSession(identity,p);
 for(const marker of expected)assert.equal(full.split('\\echo '+marker+' :target_pid :target_xid\n').length,2);
 assert.ok(full.indexOf('CATALOGUE_TARGET_ASSERTION_ONLY_PASSED')<full.indexOf('CATALOGUE_TARGET_LIFECYCLE_PASSED'));
 for(const changed of [p.lifecycle.replace('ROLLBACK TO SAVEPOINT assertion_only;',''),p.lifecycle+'\nROLLBACK TO SAVEPOINT assertion_only;\n'])assert.throws(()=>runner.instrumentTargetLifecycle(changed,p.target,p.authority));
});
test('complete milestone output rejects missing duplicate reordered partial noisy or cross-session lines',()=>{
 need();const lines=runner.targetMarkers.map(m=>m+' 123 456\n'),complete=lines.join('');
 assert.deepEqual(runner.parseTargetOutput(complete),{backendPid:'123',transactionId:'456'});
 for(let i=0;i<lines.length;i++){
  assert.throws(()=>runner.parseTargetOutput(lines.filter((_,j)=>j!==i).join('')));
  assert.throws(()=>runner.parseTargetOutput([...lines.slice(0,i),lines[i],...lines.slice(i)].join('')));
  if(i+1<lines.length){const swapped=[...lines];[swapped[i],swapped[i+1]]=[swapped[i+1],swapped[i]];assert.throws(()=>runner.parseTargetOutput(swapped.join('')));}
  for(const changed of ['124 456','123 457']){const mismatched=[...lines];mismatched[i]=lines[i].replace('123 456',changed);assert.throws(()=>runner.parseTargetOutput(mismatched.join('')));}
  const prefix=lines.slice(0,i+1).join('');
  for(const stdout of [prefix.slice(0,-1),prefix+'PRIVATE\n',prefix+lines[i],prefix.replace(lines[0],lines[i])]){
   if(stdout===prefix)continue;
   assert.equal(runner.targetFailureDiagnostic('lifecycle',{status:3,signal:null,stdout,stderr:'PRIVATE\n'}).lifecyclePhase,'UNKNOWN');
  }
 }
 assert.throws(()=>runner.parseTargetOutput(complete+'PRIVATE\n'));
});
test('every target subinterval refusal stays before committed setup and claims no disposal',async()=>{
 need();for(let n=1;n<=11;n++)await orchestrateFailure('lifecycle-exec',n);
});

test('status request barrier binds the exact actor request namespace and real backend',()=>{
 need();assert.equal(typeof runner.statusRequestBarrierSql,'function','Status request barrier missing');
 const actor='20000000-0000-4000-8000-000000000073',request='30000000-0000-4000-8000-000000000101';
 const sql=runner.statusRequestBarrierSql(123,actor,request);
 for(const part of ['catalog_request_v1:',actor,request,'1801427914','objsubid=1','classid','objid','current_database()','pg_blocking_pids'])assert.ok(sql.includes(part),part);
 for(const args of [['123 OR true',actor,request],[123,"x'; SELECT 1",request],[123,actor,'bad']])assert.throws(()=>runner.statusRequestBarrierSql(...args));
});
test('status clients use actual authenticated role JWT and bounded transactions',()=>{
 need();assert.equal(typeof runner.statusBeginSql,'function','Status real-role begin missing');
 const actor='20000000-0000-4000-8000-000000000073';
 for(const isolation of ['READ COMMITTED','REPEATABLE READ']){
  const sql=runner.statusBeginSql(actor,isolation);
  for(const part of [`BEGIN ISOLATION LEVEL ${isolation}`,'SET LOCAL ROLE authenticated','request.jwt.claim.sub',actor,"statement_timeout='8s'","lock_timeout='1500ms'","idle_in_transaction_session_timeout='30s'"])assert.ok(sql.includes(part),part);
 }
 assert.throws(()=>runner.statusBeginSql(actor,'SERIALIZABLE; COMMIT;'));
 assert.throws(()=>runner.statusBeginSql('bad'));
});
test('status receipt proof refuses changed identity transitions extra fields and missing timestamp',()=>{
 need();assert.equal(typeof runner.validateStatusReceipt,'function','Exact status receipt validation missing');
 const expected={actorId:'20000000-0000-4000-8000-000000000073',requestId:'30000000-0000-4000-8000-000000000101',targetId:'10000000-0000-4000-8000-000000000073',beforeVersion:'1',beforeEnabled:true,afterVersion:'2',afterEnabled:false};
 const receipt={version:1,request_id:expected.requestId,actor_id:expected.actorId,operation:'set_enabled',kind:'customer',id:expected.targetId,before:{catalog_version:'1',is_enabled:true},after:{catalog_version:'2',is_enabled:false},committed_at:'2026-10-15T12:00:00+00:00'};
 assert.deepEqual(runner.validateStatusReceipt(receipt,expected),receipt);
 for(const mutate of [r=>{r.actor_id=expected.requestId;},r=>{r.request_id=expected.actorId;},r=>{r.after.catalog_version='3';},r=>{r.after.is_enabled=true;},r=>{r.before.catalog_version=1;},r=>{r.committed_at='';},r=>{delete r.committed_at;},r=>{r.extra=true;}]){const value=structuredClone(receipt);mutate(value);assert.throws(()=>runner.validateStatusReceipt(value,expected));}
});
test('status committed setup adds only two fictional masters and one existing-role actor',()=>{
 need();const sql=runner.buildTargetRaceSetup(identity,parts());
 for(const part of ['Fictional status race A','Fictional status race B','Fictional status race executive','status-race@example.invalid'])assert.ok(sql.includes(part),part);
 assert.doesNotMatch(sql,/CREATE ROLE|ALTER ROLE|GRANT\s+catalogue_foundation_inherited_probe/);
});
test('status race proof requires fresh connection terminal safety and unchanged bounded cleanup',()=>{
 need();assert.deepEqual(runner.statusRecoveryCases,['inflight_dispatch_and_recovery_busy','committed_fresh_session_replay','replay_after_later_status_change','abandonment_fences_delayed_dispatch','actor_request_namespace_isolation','stale_master_version_refuses','repeatable_read_terminal_safety']);
 const s=read('scripts/catalogue-customer-target-runtime.mjs');
 for(const part of ['target_status_replay','statusRequestBarrierSql(pids[0]','statusRecovery','catalog_requests_v1_pkey',"schema IS DISTINCT FROM 'private'","relation IS DISTINCT FROM 'catalog_requests_v1'",'REPEATABLE READ',"'CATALOG_REQUEST_BUSY'","'CATALOG_REQUEST_ABANDONED'","'CATALOG_VERSION_CONFLICT'",'row_security_active',"'25P02'"])assert.ok(s.includes(part),part);
 assert.match(s,/await b\.close\(\);[\s\S]*new Session\(\{name:'target_status_replay',env:connection\}\);sessions\.push\(replay\)/);
 assert.match(s,/new Set\(\[\.\.\.pids,replayPid\]\)\.size,4/);
 assert.ok(s.includes('sessions.filter(s=>s!==retiredSession)'));assert.doesNotMatch(s,/sessions\.filter\(s=>!s\.closed\)/);
 assert.ok(s.includes('finally{await Promise.allSettled(sessions.map(s=>s.close()));}'));
});

test('status replacement connection failure closes every owned client without claiming success',async()=>{
 need();const clients=[];let statusCommitted=false,statusDispatched=false,busy=0,sourceChecks=0;
 const actorId='5e186f1c-c18f-6670-7b74-d7d2f4e8a28e',requestId='30000000-0000-4000-8000-000000000101',targetId='10000000-0000-4000-8000-000000000073';
 class ReplacementFailureSession{
  constructor({name}){this.name=name;this.pid=201+clients.length;this.closed=false;this.aborted=false;clients.push(this);if(name==='target_status_replay'){assert.equal(clients[1].closed,true);assert.equal(statusCommitted,true);assert.equal(busy,3);}}
  async query(sql){
   assert.equal(this.closed,false);const result=(stdout='',sqlstate='00000')=>({stdout:stdout+'\n',sqlstate});
   if(this.name==='target_status_replay')return result('','55006');
   if(sql==='SELECT pg_backend_pid();')return result(String(this.pid));
   if(sql.includes('CATALOGUE_FIXTURE_OBSERVATION'))return result(JSON.stringify(observation));
   if(sql==='SELECT 1;'&&this.aborted)return result('','25P02');
   if(sql==='ROLLBACK;'){this.aborted=false;return result();}
   if(sql==='COMMIT;'){if(statusDispatched&&this.name==='target_a')statusCommitted=true;return result();}
   if(sql.startsWith('DO $target_contention$')){this.aborted=true;return result('','55P03');}
   if(sql.startsWith('DO $status_refusal$')){assert.ok(sql.includes("'CATALOG_REQUEST_BUSY'"));this.aborted=true;busy++;return result('','55P03');}
   if(sql.startsWith('SELECT public.pilot_catalog_transaction_v1(')){
    assert.equal(this.name,'target_a');assert.ok(sql.includes(requestId));statusDispatched=true;
    return result(JSON.stringify({version:1,request_id:requestId,actor_id:actorId,operation:'set_enabled',kind:'customer',id:targetId,before:{catalog_version:'1',is_enabled:true},after:{catalog_version:'2',is_enabled:false},committed_at:'2026-10-15T12:00:00+00:00'}));
   }
   if(sql.startsWith("SELECT jsonb_build_object('masters'"))return result('{"unchanged":true}');
   if(sql.startsWith('SELECT current_database()='))return result('1');
   if(sql.startsWith('BEGIN')||sql.startsWith('INSERT INTO public.customer_targets')||sql.startsWith('SET CONSTRAINTS'))return result();
   if(sql.startsWith('WITH k AS')||sql.startsWith('SELECT EXISTS(')||sql.startsWith('SELECT (SELECT')||sql.startsWith('SELECT count(*)=0')||sql.startsWith("SELECT current_user='authenticated'"))return result('t');
   assert.fail('Unexpected source/mock query');
  }
  async close(){this.closed=true;}
 }
 let caught;try{await runner.executeTargetRaces({identity,connection:{},checkSource(){sourceChecks++;},Session:ReplacementFailureSession});}catch(error){caught=error;}
 assert.deepEqual(clients.map(s=>s.name),['target_a','target_b','target_observer','target_status_replay']);
 assert.ok(clients.every(s=>s.closed));assert.equal(statusCommitted,true);assert.equal(busy,3);assert.ok(sourceChecks>=4);
 assert.deepEqual(runner.targetFailureDiagnostic('races',caught),{phase:'races',lifecyclePhase:'NOT_APPLICABLE',processExit:'SESSION_SQLSTATE',sqlstate:'55006'});
});
test('terminal setup installs full lifetime prerequisites before drain races without a new target',()=>{
 const p=parts(),sql=runner.buildTargetRaceSetup(identity,p);
 for(const key of ['orderCandidate','coOrderCandidate','promotionOwnerGrammar','visitGrammar','lifetimeCandidate'])assert.ok(sql.includes(p[key]),key);
 assert.ok(sql.indexOf(p.foundation)<sql.indexOf(p.orderCandidate));assert.ok(sql.indexOf(p.coOrderCandidate)<sql.indexOf(p.lifetimeCandidate));
 assert.ok(sql.indexOf(p.lifetimeCandidate)<sql.indexOf('COMMIT;'));
 const runtime=read('scripts/catalogue-customer-target-runtime.mjs');
 assert.match(runtime,/executeLifetimeAdmissionRaces\(\{a,b:replay,observer,query:ok,verify\}\)/);
 assert.ok(runtime.indexOf('const statusRecovery=')<runtime.indexOf('const lifetimeAdmission='));
 const race=read('tests/database/catalogue/lifetime-admission-races.mjs');
 assert.match(race,/pg_blocking_pids/);assert.match(race,/locktype='transactionid' AND NOT granted/);assert.match(race,/catalog_cutover_v1'::regclass/);
 assert.match(race,/public\.pilot_order_transaction/);assert.match(race,/public\.pilot_assign_store_owner_v1/);assert.match(race,/SET LOCAL ROLE service_role/);
 assert.doesNotMatch(race,/new Session|new Client|process\.env|connect\(/);
});
test('terminal create edit races share checked clients and install new08 only after lifetime',()=>{
 const p=parts();assert.equal(runner.targetRuntimePaths.createEditCandidate,'supabase/catalogue/v1/new08-catalogue-create-edit.sql');
 const sql=runner.buildTargetRaceSetup(identity,p);assert.ok(sql.indexOf(p.lifetimeCandidate)<sql.indexOf(p.createEditCandidate));assert.ok(sql.indexOf(p.createEditCandidate)<sql.indexOf('COMMIT;'));
 const runtime=read('scripts/catalogue-customer-target-runtime.mjs');
 assert.match(runtime,/executeCatalogueCreateEditRaces\(\{a,b:replay,observer,query:ok,expectState:expected,verify\}\)/);
 assert.ok(runtime.indexOf('const lifetimeAdmission=')<runtime.indexOf('const createEdit='));
 assert.match(runtime,/statusRecovery,lifetimeAdmission,createEdit/);
});
