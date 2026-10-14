import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
let runner; try { runner = await import('../../scripts/catalogue-foundation.mjs'); } catch {}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const need = () => assert.ok(runner, 'Same-session foundation behavior runner is not implemented');
const identity = {profile:'github-catalogue-baseline-v1',source:{clean:true,commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64)},serverAddress:'172.18.0.2',serverPort:5432,serverVersion:'170011',systemIdentifier:'123456789',runIdentity:'00000000-0000-4000-8000-000000000001',ci:{}};
const fixtureParts = () => Object.fromEntries([
 ['before','CREATE TEMP TABLE expected_before(id integer) ON COMMIT DROP;'],
 ['candidate','ALTER TABLE public.customers ADD COLUMN is_enabled boolean NOT NULL DEFAULT true;'],
 ['foundation','SELECT pg_temp.foundation_assert(true, \'behavior\');'],
 ['legacy','SELECT pg_temp.foundation_assert(true, \'legacy\');'],
 ['roles','SELECT pg_temp.foundation_assert(true, \'roles\');'],
]);
test('one guarded SQL session applies exact candidate between prechange and postchange suites, then rolls back', () => {
 need(); const parts=fixtureParts(), sql=runner.buildCatalogueFoundationSession(identity, parts);
 assert.ok(sql.includes('SELECT 1/0 AS catalogue_identity_refused;'));
 assert.ok(sql.indexOf('BEGIN;') < sql.indexOf(parts.before));
 assert.ok(sql.indexOf(parts.before) < sql.indexOf(parts.candidate));
 assert.ok(sql.indexOf(parts.candidate) < sql.indexOf(parts.foundation));
 assert.ok(sql.indexOf(parts.foundation) < sql.indexOf(parts.legacy));
 assert.ok(sql.indexOf(parts.legacy) < sql.indexOf(parts.roles));
 assert.ok(sql.indexOf(parts.roles) < sql.lastIndexOf('ROLLBACK;'));
 assert.ok(sql.lastIndexOf('ROLLBACK;') < sql.indexOf('CATALOGUE_FOUNDATION_ROLLBACK_VERIFIED'));
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
 assert.equal((sql.match(/^ROLLBACK;/gm)||[]).length,1);
 assert.match(sql,/pg_backend_pid\(\)/); assert.match(sql,/txid_current\(\)/);
 assert.ok(!/^COMMIT;/m.test(sql));
});
test('candidate transaction boundaries, client commands, and missing suites are refused before execution', () => {
 need();for(const candidate of ['COMMIT;','BEGIN; SELECT 1; ROLLBACK;','END;','START TRANSACTION;','PREPARE TRANSACTION \'x\';','\\i outside.sql','SELECT 1;\n\\quit','CREATE FUNCTION x() RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$; COMMIT;']) {
  assert.throws(()=>runner.buildCatalogueFoundationSession(identity,{...fixtureParts(),candidate}));
 }
 for(const key of ['before','candidate','foundation','legacy','roles']) {const parts=fixtureParts();delete parts[key];assert.throws(()=>runner.buildCatalogueFoundationSession(identity,parts));}
 // PL/pgSQL blocks and literals are not top-level transaction commands.
 assert.doesNotThrow(()=>runner.buildCatalogueFoundationSession(identity,{...fixtureParts(),candidate:"CREATE FUNCTION x() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'COMMIT'; END $$;"}));
});
test('only complete ordered live-session markers and verified rollback constitute bounded behavior evidence', () => {
 need();const output=runner.foundationExpectedMarkers.map(x=>`${x} 412 827`).join('\n')+'\n';
 assert.deepEqual(runner.parseCatalogueFoundationOutput(output),{backendPid:'412',transactionId:'827'});
 for(const changed of [output.replace('412 827','413 827'),output.replace('412 827','412 828'),output.replace('CATALOGUE_FOUNDATION_ROLLBACK_VERIFIED 412 827\n',''),output+'UNEXPECTED\n',output.replace('412','0'),output.split('\n').reverse().join('\n')]) assert.throws(()=>runner.parseCatalogueFoundationOutput(changed));
});
test('behavior suites are real DML and actual-role probes rather than source-contract assertions',()=>{
 need();const read=name=>readFileSync(resolve(root,`tests/database/catalogue/${name}.sql`),'utf8');
 const before=read('before-foundation'),foundation=read('foundation'),legacy=read('legacy-columns'),roles=read('roles');
 assert.match(before,/foundation_probe/);assert.match(before,/SET LOCAL ROLE authenticated/);
 for(const label of ['positive salesperson/manager baseline writes required','salesperson out-of-scope baseline remains zero rows','positive Executive raw target API baseline required'])assert.ok(before.includes(label));
 for(const label of ['failed create rolls back evidence','9007199254740993','same UUID isolates identity kinds','forced post-evidence failure rolls back both records','live maximum discarded conflict stays a no-op'])assert.ok(foundation.includes(label));
 assert.match(legacy,/has_column_privilege/);assert.match(legacy,/catalogue_target_topology_v1/);assert.match(legacy,/foundation_probe\(test.statement\)/);
 assert.match(roles,/row_security_active/);assert.match(roles,/SET LOCAL ROLE anon/);
 for(const sql of [before,foundation,legacy,roles])assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK);/m.test(sql));
});

// These dependency-injected unit tests prove runner containment and evidence
// classification. Only an actual guarded PG17 invocation can prove SQL behavior.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,mkdirSync,copyFileSync,rmSync,symlinkSync,readdirSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cataloguePublicSourcePaths,catalogueCaptureSourceIdentity,catalogueCompositionSha256 } from '../../scripts/catalogue-capture-source.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const ci={repository:'pl0203/lou_erp',workflow:'Pilot safety checks',workflowRef:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/30/merge',job:'catalogue-baseline',event:'pull_request',ref:'refs/pull/30/merge',eventSha:'d'.repeat(40),runId:'9',runAttempt:'1',headRef:'feat/catalogue-mutations-20261014',baseRef:'fix/pilot-database'};
function fixture() {
 need();const directory=mkdtempSync(join(tmpdir(),'catalogue-foundation-unit-'));
 const composition=JSON.parse(readFileSync(join(root,'supabase/catalogue/ci/composition.json'),'utf8'));
 for(const path of new Set([...cataloguePublicSourcePaths,...Object.values(runner.foundationSqlPaths),...composition.composition.map(x=>x.path)])) {
  const destination=join(directory,path);mkdirSync(dirname(destination),{recursive:true});copyFileSync(join(root,path),destination);
 }
 const git=(command,args,options)=>{assert.equal(command,'git');assert.equal(options.env.GIT_NO_LAZY_FETCH,'1');return args.includes('HEAD^{tree}')?'b'.repeat(40):args.includes('HEAD')?'a'.repeat(40):'';};
 const source=catalogueCaptureSourceIdentity(directory,git);
 const boundIdentity={...identity,source,ci};
 const capture={format:'catalogue-baseline-capture-v1',status:'captured-unverified',scope:'synthetic-composed-source-only',task1Complete:false,hostedVerified:false,identity:boundIdentity,compositionSha256:catalogueCompositionSha256,compositionPhases:42,refusalProbe:'verified-on-error-stop',implementationSuitesRun:[],catalog:{}};
 const captured=join(directory,'scale-results/catalogue-baseline');mkdirSync(captured,{recursive:true});
 const writeCapture=()=>{const bytes=JSON.stringify(capture);writeFileSync(join(captured,'capture.json'),bytes);writeFileSync(join(captured,'manifest.json'),JSON.stringify({format:'catalogue-capture-manifest-v1',status:'captured-unverified',source,ci,files:[{path:'capture.json',sha256:sha(bytes)}]}));};writeCapture();
 const output=join(directory,'action-output');writeFileSync(output,'');
 const env={PATH:process.env.PATH,GIT_NO_LAZY_FETCH:'1',CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:ci.repository,GITHUB_WORKFLOW:ci.workflow,GITHUB_WORKFLOW_REF:ci.workflowRef,GITHUB_JOB:ci.job,GITHUB_EVENT_NAME:ci.event,GITHUB_REF:ci.ref,GITHUB_SHA:ci.eventSha,GITHUB_RUN_ID:ci.runId,GITHUB_RUN_ATTEMPT:ci.runAttempt,CATALOGUE_CI_PROFILE:boundIdentity.profile,CATALOGUE_CI_HEAD_REPOSITORY:ci.repository,CATALOGUE_CI_BASE_REPOSITORY:ci.repository,CATALOGUE_CI_HEAD_REF:ci.headRef,CATALOGUE_CI_BASE_REF:ci.baseRef,CATALOGUE_CI_SOURCE_SHA:source.commit,CATALOGUE_CI_CANDIDATE_SHA256:source.candidate,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only',GITHUB_OUTPUT:output};
 const calls=[];let behavior,afterBehavior,observedChange;
 const execute=(command,args,options)=>{
  if(command==='git')return git(command,args,options);
  assert.equal(command,'psql');calls.push({args,options});
  assert.equal(options.env.GIT_NO_LAZY_FETCH,'1');assert.equal(options.env.PGDATABASE,'pilot_catalogue_test');assert.equal(options.env.HOME,undefined);
  assert.ok(options.input.includes('SELECT 1/0 AS catalogue_identity_refused;'));
  assert.deepEqual(args,['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']);
  if(options.input.includes('CATALOGUE_FIXTURE_OBSERVATION')) {
   const observed={database:'pilot_catalogue_test',operator:'postgres',database_owner:'postgres',system_identifier:boundIdentity.systemIdentifier,server_version_num:boundIdentity.serverVersion,server_address:boundIdentity.serverAddress,server_port:5432,marker:{kind:'r',owner:'postgres',rows:[{singleton:true,purpose:'disposable-catalogue-ci-v1',identity:boundIdentity}]}};
   if(observedChange)observedChange(observed,calls.length);return JSON.stringify(observed);
  }
  const output=behavior ? behavior(options.input) : runner.foundationExpectedMarkers.map(x=>`${x} 412 827`).join('\n')+'\n';
  afterBehavior?.();return output;
 };
 return {directory,env,capture,writeCapture,output,calls,execute,setBehavior:x=>behavior=x,setAfterBehavior:x=>afterBehavior=x,setObservedChange:x=>observedChange=x,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
const withFixture=fn=>{const f=fixture();try{return fn(f);}finally{f.cleanup();}};
test('bound runner uses one behavior process and emits checksummed strictly bounded evidence after verified rollback',()=>withFixture(f=>{
 const report=runner.runCatalogueFoundation({repoRoot:f.directory,env:f.env,execute:f.execute});
 assert.equal(f.calls.length,3);const session=f.calls[1].options.input;
 for(const path of Object.values(runner.foundationSqlPaths))assert.ok(session.includes(readFileSync(join(f.directory,path),'utf8')));
 assert.equal(report.status,'BOUNDED_FOUNDATION_BEHAVIOR_PASSED');
 for(const key of ['task1Complete','implementationAccepted','hostedVerified','trackingReady'])assert.equal(report[key],false);
 assert.equal(report.executionGeneration,1);assert.equal(report.targetParity,'SYNTHETIC_SAME_SESSION_ONLY');assert.equal(report.broaderLockGraph,'UNPROVEN');
 assert.equal(report.tests.rollback,'VERIFIED');assert.deepEqual(report.session,{backendPid:'412',transactionId:'827'});
 assert.deepEqual(report.files,Object.values(runner.foundationSqlPaths).map(path=>({path,sha256:sha(readFileSync(join(f.directory,path)))})));
 const out=join(f.directory,'scale-results/catalogue-foundation');assert.deepEqual(readdirSync(out).sort(),['manifest.json','results.json']);
 const bytes=readFileSync(join(out,'results.json'),'utf8');assert.deepEqual(JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')).files,[{path:'results.json',sha256:sha(bytes)}]);
 assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\nbundle_ready=true\n');
}));
test('SQL failure, partial markers, source drift and post-session identity drift never authorize upload',()=>{
 for(const change of [
  f=>f.setBehavior(()=>{throw Object.assign(new Error('PRIVATE_CANARY'),{status:3,stderr:'PRIVATE_CANARY'});}),
  f=>f.setBehavior(()=>runner.foundationExpectedMarkers.slice(0,-1).map(x=>`${x} 412 827`).join('\n')+'\n'),
  f=>f.setAfterBehavior(()=>writeFileSync(join(f.directory,'tests/database/catalogue/foundation.sql'),'SELECT 1;')),
  f=>f.setObservedChange((observed,count)=>{if(count===3)observed.server_address='172.18.0.3';}),
  f=>{f.capture.identity.ci={...ci,runAttempt:'2'};f.writeCapture();},
  f=>f.env.PGHOST='remote.invalid',
  f=>f.env.PGSERVICE='PRIVATE_CANARY',
 ])withFixture(f=>{
  change(f);assert.throws(()=>runner.runCatalogueFoundation({repoRoot:f.directory,env:f.env,execute:f.execute}),/^Error: CATALOGUE_FOUNDATION_REFUSED$/);
  assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\n');assert.equal(existsSync(join(f.directory,'scale-results/catalogue-foundation/results.json')),false);
 });
});
test('preexisting evidence, symlinks, and dirty transaction fragments fail before any SQL process',()=>{
 for(const change of [
  f=>mkdirSync(join(f.directory,'scale-results/catalogue-foundation')),
  f=>symlinkSync(join(f.directory,'absent'),join(f.directory,'scale-results/catalogue-foundation')),
  f=>mkdirSync(join(f.directory,'scale-results/catalogue-foundation-pending')),
  f=>writeFileSync(join(f.directory,runner.foundationSqlPaths.candidate),'COMMIT;'),
 ])withFixture(f=>{
  change(f);assert.throws(()=>runner.runCatalogueFoundation({repoRoot:f.directory,env:f.env,execute:f.execute}),/CATALOGUE_FOUNDATION_REFUSED/);
  assert.equal(f.calls.length,0);assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\n');
 });
});
test('CLI has no target/apply override and refuses local execution without leaking input',()=>{
 for(const args of [[],['--url','PRIVATE_CANARY'],['--apply']]) {
  const result=spawnSync(process.execPath,[join(root,'scripts/catalogue-foundation.mjs'),...args],{env:{PATH:'/intentionally-absent-executables',GIT_NO_LAZY_FETCH:'1'},encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'CATALOGUE_FOUNDATION_REFUSED\n');
 }
});
test('all executable behavior and preserved RED inputs participate in exact candidate binding',()=>{
 for(const path of [...Object.values(runner.foundationSqlPaths),'scripts/catalogue-foundation.mjs','tests/catalogue-ci/foundation.node.mjs','tests/database/catalogue/foundation-red.sql'])assert.ok(cataloguePublicSourcePaths.includes(path),`Unbound runtime input: ${path}`);
 const red=readFileSync(join(root,'tests/database/catalogue/foundation-red.sql'));
 assert.equal(sha(red),'5953413767a8ec63df2ff82c5364db11c5154b13dbe4f9d30e1bfe1fe0bd0106');
});
test('standard SQL string backslashes cannot conceal transaction boundaries',()=>{
 need();assert.throws(()=>runner.foundationTopLevelSql("SELECT '\\'; COMMIT; --';"));
 assert.doesNotThrow(()=>runner.foundationTopLevelSql("SELECT E'quote\\\' and COMMIT text';"));
 assert.doesNotThrow(()=>runner.foundationTopLevelSql("SELECT 'COMMIT'; /* outer /* COMMIT; */ comment */ SELECT $$ROLLBACK;$$;"));
 assert.throws(()=>runner.foundationTopLevelSql("SELECT 'unclosed"));
 assert.throws(()=>runner.foundationTopLevelSql("/* unclosed"));
});
test('identifier dollar signs and carriage-return comments cannot conceal transaction boundaries',()=>{
 need();
 for(const sql of ['SELECT 1 AS alias$$; COMMIT; SELECT 1 AS alias$$;', 'SELECT 1 AS α$$; COMMIT; SELECT 1 AS α$$;', '-- comment\rCOMMIT;'])assert.throws(()=>runner.foundationTopLevelSql(sql));
 assert.doesNotThrow(()=>runner.foundationTopLevelSql('DO $body$ BEGIN NULL; END $body$;'));
});

test('dedicated public CI runs bound foundation after capture and RED with output-gated narrow evidence',()=>{
 need();
 const workflow=readFileSync(resolve(root,'.github/workflows/pilot-safety.yml'),'utf8');
 const split=workflow.indexOf('\n  catalogue-baseline:');assert.ok(split>0);
 const sha=value=>createHash('sha256').update(value).digest('hex');
 // Preserve the historical application/CO prefix; separately pin both reviewed additions.
 const scheduling='    needs: catalogue-baseline\n    if: ${{ always() }}\n';
 assert.equal(workflow.split(scheduling).length,2);
 assert.ok(workflow.includes(`  synthetic-safety:\n${scheduling}    runs-on: ubuntu-latest`));
 const prefix=workflow.slice(0,split).replace(scheduling,'');
 const decoderStart=prefix.indexOf('      - name: Bind independent read decoder source');
 const commentStart=prefix.indexOf('  # Independent of synthetic-safety:');
 assert.ok(decoderStart>0&&commentStart>decoderStart);
 assert.equal(sha(prefix.slice(decoderStart,commentStart)),'8921961b19dff1f49d74cf285076cab79c8a3d3467a8e7bd8b1b7453f8980e73');
 assert.equal(sha(prefix.slice(0,decoderStart)+prefix.slice(commentStart)),'32b1e9ded0e18c707af5e2bdc15c7730a0a61634da296b078240b2d2ad6cf505');
 const job=workflow.slice(split);
 const unit='node --test tests/catalogue-ci/foundation.node.mjs';
 const runtime='node scripts/catalogue-foundation.mjs';
 assert.equal(job.split(unit).length,2);assert.equal(job.split(runtime).length,2);
 assert.ok(job.indexOf(unit)<job.indexOf('Bind clean candidate bytes before capture'));
 assert.ok(job.indexOf(runtime)>job.indexOf('node scripts/catalogue-capture-baseline.mjs'));
 assert.ok(job.indexOf(runtime)>job.indexOf('node scripts/catalogue-foundation-red.mjs'));
 assert.match(job,/id: catalogue-foundation\n\s+run: node scripts\/catalogue-foundation\.mjs/);
 assert.ok(job.includes("if: ${{ always() && steps.catalogue-foundation.outputs.bundle_ready == 'true' }}"));
 assert.ok(job.includes('name: catalogue-foundation-${{ github.run_id }}-${{ github.run_attempt }}'));
 assert.ok(job.includes('path: scale-results/catalogue-foundation\n'));
 assert.ok(job.includes('--log-driver=none'));assert.ok(job.includes('timeout-minutes: 20'));
 assert.ok(job.includes('if-no-files-found: error'));assert.ok(job.includes('retention-days: 7'));
 assert.ok(!job.includes('continue-on-error:'));assert.ok(!/path:\s*(?:scale-results\s*$|.*\.log\b)/m.test(job));
 for(const path of Object.values(runner.foundationSqlPaths))assert.ok(cataloguePublicSourcePaths.includes(path),`Unbound executable input ${path}`);
});


test('failure diagnostics expose only fixed phase, ordered marker index and SQLSTATE',()=>{
 need();const error={status:3,signal:null,stdout:runner.foundationExpectedMarkers.slice(0,2).map(x=>`${x} 412 827`).join('\n')+'\n',stderr:'ERROR:  42501: PRIVATE_CANARY\nDETAIL: SECRET_CANARY\n'};
 assert.equal(typeof runner.foundationFailureDiagnostic,'function');
 assert.deepEqual(runner.foundationFailureDiagnostic('session',error),{phase:'session',completedMarkerIndex:1,sqlstate:'42501'});
 assert.deepEqual(runner.foundationFailureDiagnostic('session',{...error,stdout:''}),{phase:'session',completedMarkerIndex:-1,sqlstate:'42501'});
 assert.deepEqual(runner.foundationFailureDiagnostic('PRIVATE_CANARY',error),{phase:'unknown',completedMarkerIndex:null,sqlstate:null});
 assert.ok(!JSON.stringify(runner.foundationFailureDiagnostic('session',error)).includes('CANARY'));
});
test('failure diagnostics reject malformed mixed or fabricated marker progress',()=>{
 need();assert.equal(typeof runner.foundationFailureDiagnostic,'function');
 const marker=runner.foundationExpectedMarkers[0]+' 412 827\n';
 for(const stdout of ['PRIVATE_CANARY\n',marker+'PRIVATE_CANARY\n',runner.foundationExpectedMarkers[1]+' 412 827\n',marker+runner.foundationExpectedMarkers[1]+' 413 827\n',marker+marker,marker.trim(),runner.foundationExpectedMarkers[0]+' 0 827\n']) {
  assert.deepEqual(runner.foundationFailureDiagnostic('session',{status:3,signal:null,stdout,stderr:'ERROR:  P0001: PRIVATE_CANARY\n'}),{phase:'session',completedMarkerIndex:null,sqlstate:'P0001'});
 }
});
test('failure diagnostics do not mistake timeout spawn or mixed ERROR output for SQLSTATE',()=>{
 need();assert.equal(typeof runner.foundationFailureDiagnostic,'function');
 for(const change of [{status:1},{signal:'SIGTERM'},{code:'ENOENT'},{stderr:'ERROR:  P0001: x\nERROR:  42501: y\n'},{stderr:'prefix ERROR: P0001: PRIVATE_CANARY\n'},{stderr:'ERROR: PRIVATE_CANARY\n'}, {stdout:Buffer.from('PRIVATE_CANARY')}]) {
  const error={status:3,signal:null,stdout:'',stderr:'ERROR:  P0001: PRIVATE_CANARY\n',...change};
  const expected=change.stdout?{phase:'session',completedMarkerIndex:null,sqlstate:'P0001'}:{phase:'session',completedMarkerIndex:null,sqlstate:null};
  assert.deepEqual(runner.foundationFailureDiagnostic('session',error),expected);
 }
});
test('failure diagnostics preserve refusal and never authorize a failure bundle',()=>withFixture(f=>{
 f.setBehavior(()=>{throw Object.assign(new Error('PRIVATE_CANARY'),{status:3,signal:null,stdout:runner.foundationExpectedMarkers[0]+' 412 827\n',stderr:'ERROR:  P0001: SECRET_CANARY\n'});});
 assert.throws(()=>runner.runCatalogueFoundation({repoRoot:f.directory,env:f.env,execute:f.execute}),error=>{
  assert.equal(error.message,'CATALOGUE_FOUNDATION_REFUSED');
  assert.deepEqual(error.diagnostic,{phase:'session',completedMarkerIndex:0,sqlstate:'P0001'});
  assert.ok(!JSON.stringify(error).includes('CANARY'));return true;
 });
 assert.equal(readFileSync(f.output,'utf8'),'bundle_ready=false\n');
 assert.equal(existsSync(join(f.directory,'scale-results/catalogue-foundation/results.json')),false);
}));
