// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, symlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const load = async (name:string) => existsSync(`scripts/${name}.mjs`) ? import(pathToFileURL(resolve(`scripts/${name}.mjs`)).href) : {}
const profile = await load('catalogue-ci-profile')
const capture = await load('catalogue-capture-baseline')
const source = { commit:'a'.repeat(40), tree:'b'.repeat(40), candidate:'c'.repeat(64), clean:true }
const env:any = {
 PATH:'/usr/bin', PGHOST:'127.0.0.1', PGPORT:'5432', PGUSER:'postgres', PGDATABASE:'pilot_test', PGPASSWORD:'synthetic-ci-only',
 CI:'true', GITHUB_ACTIONS:'true', GITHUB_REPOSITORY:'pl0203/lou_erp', GITHUB_WORKFLOW:'Pilot safety checks', GITHUB_JOB:'catalogue-baseline',
 GITHUB_EVENT_NAME:'pull_request', GITHUB_REF:'refs/pull/30/merge', GITHUB_SHA:'d'.repeat(40), GITHUB_RUN_ID:'1234', GITHUB_RUN_ATTEMPT:'1',
 GITHUB_WORKFLOW_REF:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/30/merge',
 CATALOGUE_CI_PROFILE:'github-catalogue-baseline-v1', CATALOGUE_CI_SOURCE_SHA:source.commit, CATALOGUE_CI_CANDIDATE_SHA256:source.candidate,
 CATALOGUE_CI_HEAD_REPOSITORY:'pl0203/lou_erp', CATALOGUE_CI_BASE_REPOSITORY:'pl0203/lou_erp',
 CATALOGUE_CI_HEAD_REF:'feat/catalogue-mutations-20261014', CATALOGUE_CI_BASE_REF:'fix/pilot-database',
}
const server:any={database:'pilot_test',operator:'postgres',database_owner:'postgres',server_address:'172.18.0.2',server_port:5432,server_version_num:'170011',system_identifier:'1234567890'}
const identity:any={profile:'github-catalogue-baseline-v1',source,ci:{repository:env.GITHUB_REPOSITORY,workflow:env.GITHUB_WORKFLOW,workflowRef:env.GITHUB_WORKFLOW_REF,job:env.GITHUB_JOB,event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,eventSha:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,headRef:env.CATALOGUE_CI_HEAD_REF,baseRef:env.CATALOGUE_CI_BASE_REF},runIdentity:'00000000-0000-4000-8000-000000000001',serverAddress:server.server_address,serverPort:5432,serverVersion:server.server_version_num,systemIdentifier:server.system_identifier}

describe('strict independent GitHub catalogue capture profile',()=>{
 test('exports fixed CI connection, identity and capture entrypoint',()=>{
  expect(profile.catalogueCiConnection).toBeTypeOf('function')
  expect(profile.catalogueCiIdentity).toBeTypeOf('function')
  expect(capture.captureCatalogueBaseline).toBeTypeOf('function')
 })
 test('allows public synthetic password only and strips unrelated data',()=>{
  const connection=profile.catalogueCiConnection({...env,SECRET:'not-for-child',HOME:'/unsafe'},source)
  expect(connection).toEqual({PATH:'/usr/bin',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only',PGCONNECT_TIMEOUT:'5',PGTZ:'UTC',PGPASSFILE:'/dev/null/catalogue-no-password',PGSYSCONFDIR:'/dev/null',GIT_NO_LAZY_FETCH:'1'})
 })
 test.each([
  ['PGHOST','localhost'],['PGPORT','65437'],['PGUSER','service_role'],['PGDATABASE','postgres'],['PGPASSWORD','private'],
  ['PGSERVICE','anything'],['PGHOSTADDR','127.0.0.1'],['PGOPTIONS','-c role=other'],['PGPASSFILE','/tmp/pass'],['PGSSLMODE','disable'],
  ['DATABASE_URL','postgres://hosted'],['SUPABASE_DB_URL','postgres://hosted'],['SUPABASE_DB_PASSWORD','private'],['LD_PRELOAD','x'],['LD_LIBRARY_PATH','x'],['NODE_OPTIONS','--require x'],
  ['CI','false'],['GITHUB_ACTIONS','false'],['GITHUB_REPOSITORY','other/repo'],['GITHUB_WORKFLOW','other'],['GITHUB_JOB','synthetic-safety'],
  ['GITHUB_EVENT_NAME','pull_request_target'],['GITHUB_REF','refs/heads/main'],['GITHUB_WORKFLOW_REF','other'],['GITHUB_RUN_ID','0'],['GITHUB_RUN_ATTEMPT','x'],
  ['CATALOGUE_CI_PROFILE','local'],['CATALOGUE_CI_SOURCE_SHA','d'.repeat(40)],['CATALOGUE_CI_CANDIDATE_SHA256','d'.repeat(64)],
  ['CATALOGUE_CI_HEAD_REPOSITORY','fork/repo'],['CATALOGUE_CI_BASE_REPOSITORY','fork/repo'],['CATALOGUE_CI_HEAD_REF','main'],['CATALOGUE_CI_BASE_REF','main'],
 ])('rejects changed %s before connecting',(key,value)=>{
  expect(profile.catalogueCiConnection).toBeTypeOf('function')
  expect(()=>profile.catalogueCiConnection({...env,[key]:value},source)).toThrow()
 })
 test('requires clean source, exact tree and candidate bytes',()=>{
  for(const changed of [{...source,clean:false},{...source,tree:'bad'},{...source,candidate:'bad'}])expect(()=>profile.catalogueCiConnection(env,changed)).toThrow()
 })
 test('binds Docker private service address and immutable run identity',()=>{
  expect(profile.catalogueCiIdentity(env,source,server,identity.runIdentity)).toEqual(identity)
  for(const changed of [{database:'other'},{operator:'other'},{database_owner:'other'},{server_address:'8.8.8.8'},{server_address:'::1'},{server_port:65437},{server_version_num:'160001'},{system_identifier:'0'}])expect(()=>profile.catalogueCiIdentity(env,source,{...server,...changed},identity.runIdentity)).toThrow()
 })
 test('same-session gates bind exact service, owner, version, run, source, and markers',()=>{
  const sql=profile.catalogueCiIdentityGateSql(identity,'pilot_catalogue_test')
  for(const value of [identity.serverAddress,identity.systemIdentifier,identity.runIdentity,source.candidate,"current_database()='pilot_catalogue_test'",'catalogue_fixture_identity_v1','SELECT 1/0 AS catalogue_identity_refused;'])expect(sql).toContain(value)
  expect(sql).toContain('inet_server_port()=5432')
  expect(()=>profile.catalogueCiIdentityGateSql(identity,'postgres')).toThrow()
  const bootstrap=profile.catalogueCiBootstrapSql(identity)
  expect(bootstrap.indexOf('SELECT 1/0 AS catalogue_identity_refused;')).toBeLessThan(bootstrap.indexOf('CREATE TABLE'))
  expect(bootstrap).toContain('no reuse/reset')
 })
 test('fresh root marker creation is gated in same session and refuses existing markers or child',()=>{
  const sql=profile.catalogueCiRootBootstrapSql(identity)
  expect(sql.indexOf('SELECT 1/0 AS catalogue_identity_refused;')).toBeLessThan(sql.indexOf('CREATE TABLE'))
  expect(sql).toContain("datname='pilot_catalogue_test'")
  expect(sql).toContain("n.nspname IN ('public','private','auth','storage')")
  expect(sql).not.toMatch(/DROP|TRUNCATE|IF NOT EXISTS/)
 })
 test('capture CLI accepts no target, suite, reset or output switches',()=>{
  expect(capture.catalogueCaptureArgs).toBeTypeOf('function')
  expect(()=>capture.catalogueCaptureArgs([])).not.toThrow()
  for(const args of [['--reset'],['--output','elsewhere'],['--suite','all'],['--url','postgres://hosted']])expect(()=>capture.catalogueCaptureArgs(args)).toThrow()
 })
 test('capture evidence explicitly remains unverified and never mutates baseline',()=>{
  expect(capture.catalogueCaptureEvidence).toBeTypeOf('function')
  const catalog=Object.fromEntries(['schemas','relations','columns','foreign_keys','constraints','functions','triggers','policies','indexes','types','roles','memberships','default_acl','rules','event_triggers'].map(k=>[k,[]]))
  const evidence=capture.catalogueCaptureEvidence(identity,catalog)
  expect(evidence.status).toBe('captured-unverified')
  expect(evidence.hostedVerified).toBe(false)
  expect(evidence.task1Complete).toBe(false)
  expect(evidence.catalog).toEqual(catalog)
  expect(()=>capture.catalogueCaptureEvidence(identity,{...catalog,privateRows:[]})).toThrow()
 })
})

test('capture workflow is independent, same-repository exact-branch PR only, and uploads fixed synthetic directory',()=>{
 const workflow=readFileSync('.github/workflows/pilot-safety.yml','utf8')
 const job=workflow.slice(workflow.indexOf('\n  catalogue-baseline:'))
 expect(job).toContain("github.event_name == 'pull_request'")
 for(const gate of ["github.repository == 'pl0203/lou_erp'","github.event.pull_request.head.repo.full_name == 'pl0203/lou_erp'","github.event.pull_request.base.repo.full_name == 'pl0203/lou_erp'","github.event.pull_request.head.ref == 'feat/catalogue-mutations-20261014'","github.event.pull_request.base.ref == 'fix/pilot-database'"])expect(job).toContain(gate)
 expect(job).not.toMatch(/needs:|pull_request_target|secrets\.|npm test|npm run build/)
 expect(job).toContain('persist-credentials: false')
 expect(job).toContain('ref: ${{ github.event.pull_request.head.sha }}')
 expect(job).toContain('node scripts/catalogue-capture-baseline.mjs')
 expect(job).toContain('path: scale-results/catalogue-baseline')
 expect(job).toContain('contents: read')
})

test('fixture adaptation exempts only the harness identity row from empty-table checks',async()=>{
 const runner=await import('../../scripts/catalogue-capture-source.mjs')
 expect(runner.catalogueCompositionSql).toBeTypeOf('function')
 const path='tests/database/hosted-read-policy-fixture.sql',sql=readFileSync(path,'utf8')
 const adapted=runner.catalogueCompositionSql(path,sql)
 expect(adapted).toContain("tablename NOT IN ('pilot_fixture_marker','catalogue_fixture_identity_v1')")
 expect(adapted).toContain("current_database()<>'pilot_catalogue_test'")
 expect(adapted).toContain("Empty fixture required before policy reconstruction")
 expect(()=>runner.catalogueCompositionSql(path,sql.replace("tablename<>'pilot_fixture_marker'","true"))).toThrow()
})

const runner=await load('catalogue-capture-source')
const gitFake=(_file:string,args:string[])=>args.includes('HEAD^{tree}')?source.tree:args.includes('HEAD')?source.commit:''
function mockedCapture(change:{reuse?:boolean,drift?:boolean,dirty?:boolean,runDrift?:boolean,probeNoError?:boolean,probeWrongExit?:boolean,probeWrongState?:boolean,probeReached?:boolean}={}) {
 const actualSource=runner.catalogueCaptureSourceIdentity(resolve('.'),gitFake)
 const liveEnv={...env,CATALOGUE_CI_CANDIDATE_SHA256:actualSource.candidate}
 const calls:any[]=[];let bound:any;let saved:any;let gitCalls=0
 const execute=(file:string,args:string[],options:any)=>{
  if(file==='git') { gitCalls++; return change.dirty && gitCalls>3 && args[0]==='status'?' M scripts/catalogue-ci-profile.mjs':gitFake(file,args) }
  calls.push({file,args,options})
  const sql=options.input
  if(sql.includes('CATALOGUE_CI_SERVER_OBSERVATION'))return JSON.stringify(server)
  if(sql.includes('CATALOGUE_CI_REAL_REFUSAL_PROBE')) {
   if(change.probeNoError)return ''
   throw Object.assign(new Error('synthetic expected psql refusal'),{status:change.probeWrongExit?2:3,stderr:change.probeWrongState?'ERROR: other':'ERROR: 22012: division by zero',stdout:change.probeReached?'CATALOGUE_GATE_PROBE_UNSAFE':''})
  }
  const matched=sql.match(/'(\{"profile"[^']+)'::jsonb/)
  if(matched)bound=JSON.parse(matched[1])
  if(sql.includes('CATALOGUE_CI_FRESH_ROOT') && change.runDrift)liveEnv.GITHUB_RUN_ATTEMPT='2'
  if(sql.includes('CATALOGUE_FIXTURE_OBSERVATION')) {
   const child=options.env.PGDATABASE==='pilot_catalogue_test'
   return JSON.stringify({...server,database:options.env.PGDATABASE,...(child&&change.drift?{system_identifier:'999999999'}:{}),marker:{kind:'r',owner:'postgres',rows:child?[{singleton:true,purpose:'disposable-catalogue-ci-v1',identity:bound}]:[{purpose:'disposable-pilot-ci'}]}})
  }
  if(sql.includes('CATALOGUE_REQUIRE_FRESH_DATABASE'))return change.reuse?'f\n':'t\n'
  if(sql.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'))return JSON.stringify(Object.fromEntries(['schemas','relations','columns','foreign_keys','constraints','functions','triggers','policies','indexes','types','roles','memberships','default_acl','rules','event_triggers'].map(k=>[k,[]])))
  return ''
 }
 const run=()=>capture.captureCatalogueBaseline({env:liveEnv,execute,repoRoot:resolve('.'),writeEvidence:(_root:string,evidence:any)=>{saved=evidence;return 'scale-results/catalogue-baseline'}})
 return {calls,run,get saved(){return saved}}
}
test('capture pipeline composes all 42 reviewed phases with same-session gates and never certifies the baseline',()=>{
 const mock=mockedCapture(), result=mock.run()
 expect(result.status).toBe('captured-unverified');expect(result.task1Complete).toBe(false)
 expect(mock.saved.identity.source.clean).toBe(true)
 expect(mock.calls.filter(c=>c.options.input.includes('CREATE DATABASE pilot_catalogue_test')).length).toBe(1)
 expect(mock.calls.some(c=>c.options.input.includes("tablename NOT IN ('pilot_fixture_marker','catalogue_fixture_identity_v1')"))).toBe(true)
 const baseline=JSON.parse(readFileSync('supabase/catalogue/ci/composition.json','utf8'))
 for(const phase of baseline.composition){
  const sql=runner.catalogueCompositionSql(phase.path,readFileSync(phase.path,'utf8'))
  const call=mock.calls.find(c=>c.options.input.endsWith(sql))
  expect(call,phase.path).toBeTruthy()
  expect(call.options.input.indexOf('SELECT 1/0 AS catalogue_identity_refused;')).toBeLessThan(call.options.input.indexOf(sql))
 }
 expect(mock.calls.every(c=>c.file==='psql' && c.options.env.PGHOST==='127.0.0.1' && c.options.env.PGPORT==='5432' && c.options.env.PGPASSWORD==='synthetic-ci-only' && !c.options.shell && !c.options.env.HOME)).toBe(true)
 expect(mock.calls.some(c=>/^\s*(?:DROP DATABASE|TRUNCATE (?:TABLE )?(?:public|private)\.)/m.test(c.options.input))).toBe(false)
})
test.each(['reuse','drift','dirty','runDrift','probeNoError','probeWrongExit','probeWrongState','probeReached'])('capture refuses %s and does not publish evidence',(key)=>{
 const mock=mockedCapture({[key]:true})
 expect(()=>mock.run()).toThrow()
 expect(mock.saved).toBeUndefined()
 if(key==='reuse'||key==='dirty')expect(mock.calls.some(c=>c.options.input.includes('CREATE DATABASE pilot_catalogue_test'))).toBe(false)
})
const temporary:string[]=[]
afterEach(()=>{for(const root of temporary.splice(0))rmSync(root,{recursive:true,force:true})})
const temp=()=>{const root=mkdtempSync(join(tmpdir(),'catalogue-capture-test-'));temporary.push(root);return root}
test('artifact writer creates only the fixed synthetic directory with checksummed unverified evidence and refuses overwrite',()=>{
 const root=temp(),evidence={identity,status:'captured-unverified',task1Complete:false}
 expect(capture.writeCatalogueCaptureEvidence(root,evidence)).toBe('scale-results/catalogue-baseline')
 const dir=join(root,'scale-results/catalogue-baseline')
 expect(readdirSync(dir).sort()).toEqual(['capture.json','manifest.json'])
 const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'))
 expect(manifest.status).toBe('captured-unverified');expect(manifest.files[0].sha256).toMatch(/^[a-f0-9]{64}$/)
 expect(()=>capture.writeCatalogueCaptureEvidence(root,evidence)).toThrow(/overwrite|reuse/)
})
test('artifact writer refuses symlink parent and dangling output symlink',()=>{
 const root=temp(),other=temp();symlinkSync(other,join(root,'scale-results'),'dir')
 expect(()=>capture.writeCatalogueCaptureEvidence(root,{identity})).toThrow(/Unsafe/)
 const second=temp();mkdirSync(join(second,'scale-results'));symlinkSync(join(second,'missing'),join(second,'scale-results/catalogue-baseline'),'dir')
 expect(()=>capture.writeCatalogueCaptureEvidence(second,{identity})).toThrow()
})

test('psql refusal uses an ON_ERROR_STOP SQL error instead of ignored quit status',()=>{
 for(const path of ['scripts/catalogue-ci-profile.mjs']){
  const contents=readFileSync(path,'utf8')
  expect(contents).not.toContain('quit 3')
  expect(contents).toContain('SELECT 1/0 AS catalogue_identity_refused;')
 }
 expect(profile.catalogueCiRefusalProbeSql).toBeTypeOf('function')
 const sql=profile.catalogueCiRefusalProbeSql(identity)
 expect(sql).toContain('AND false');expect(sql).toContain('CATALOGUE_GATE_PROBE_UNSAFE')
})

test('public capture failure reports only a fixed code and allowlisted phase',()=>{
 expect(capture.catalogueCaptureFailure).toBeTypeOf('function')
 expect(capture.catalogueCaptureFailure('metadata')).toEqual({status:'capture-failed',code:'CATALOGUE_CAPTURE_REFUSED',phase:'metadata'})
 expect(JSON.stringify(capture.catalogueCaptureFailure('PRIVATE SQL OR INVENTORY'))).not.toContain('PRIVATE')
 expect(capture.catalogueCaptureFailure('PRIVATE SQL OR INVENTORY').phase).toBe('initialization')
})
test('public source binding requires only exact synthetic composition and public harness files',()=>{
 expect(runner.catalogueCaptureSourceIdentity).toBeTypeOf('function')
 const contents=readFileSync('scripts/catalogue-capture-source.mjs','utf8')
 expect(contents).not.toMatch(/reference-inventory|baseline\.json|test-catalogue-ci|catalogue-preflight/)
 expect(runner.cataloguePublicSourcePaths).not.toContain('supabase/catalogue/v1/reference-inventory.json')
 expect(runner.cataloguePublicSourcePaths).not.toContain('docs/catalogue-reference-inventory.md')
})


test('metadata capture excludes business rows, raw function bodies and unexpected fields',()=>{
 const sql=readFileSync('scripts/catalogue-ci-metadata.sql','utf8')
 expect(()=>runner.assertCatalogueMetadataSql(sql)).not.toThrow()
 expect(sql).not.toContain("'definition',pg_get_functiondef")
 expect(sql).not.toContain("'prosrc',")
 expect(sql).not.toContain('invalid_snapshots')
 for(const unsafe of ["SELECT * FROM public.customers;", "DELETE FROM public.customers;", "SELECT pg_read_file('/private');"])expect(()=>runner.assertCatalogueMetadataSql(sql.replace('ROLLBACK;',unsafe+'\nROLLBACK;'))).toThrow()
 const catalog=Object.fromEntries(['schemas','relations','columns','foreign_keys','constraints','functions','triggers','policies','indexes','types','roles','memberships','default_acl','rules','event_triggers'].map(k=>[k,[]]))
 expect(()=>capture.catalogueCaptureEvidence(identity,{...catalog,functions:[{definition:'PRIVATE BODY'}]})).toThrow()
})
test('capture strips original error, stdout, stderr and SQL values from thrown failures',()=>{
 const actualSource=runner.catalogueCaptureSourceIdentity(resolve('.'),gitFake)
 const execute=(file:string,args:string[])=>{
  if(file==='git')return gitFake(file,args)
  throw Object.assign(new Error('PRIVATE MESSAGE'),{stdout:'PRIVATE SQL',stderr:'PRIVATE DATA',status:3})
 }
 let thrown:any
 try { capture.captureCatalogueBaseline({env:{...env,CATALOGUE_CI_CANDIDATE_SHA256:actualSource.candidate},execute,repoRoot:resolve('.')}) } catch(error) { thrown=error }
 expect(thrown.message).toBe('CATALOGUE_CAPTURE_REFUSED')
 expect(thrown.phase).toBe('connection')
 expect(thrown).not.toHaveProperty('stdout');expect(thrown).not.toHaveProperty('stderr');expect(thrown).not.toHaveProperty('cause')
 expect(JSON.stringify(capture.catalogueCaptureFailure(thrown.phase))).not.toContain('PRIVATE')
})
test('public input list is exact and does not enumerate or read unrelated protected source',()=>{
 expect(runner.cataloguePublicSourcePaths).toHaveLength(49)
 expect(runner.cataloguePublicSourcePaths).toEqual([
  '.github/workflows/pilot-safety.yml','vercel.json','tests/vercel-routing.test.ts',
  'scripts/catalogue-checkout.mjs','scripts/catalogue-ci-profile.mjs','scripts/catalogue-capture-source.mjs',
  'scripts/catalogue-capture-baseline.mjs','scripts/catalogue-ci-metadata.sql','supabase/catalogue/ci/composition.json',
  'tests/catalogue-ci/checkout.test.ts','tests/catalogue-ci/capture.test.ts',
  'tests/co/ci-workflow.test.ts','tests/co/ci-shallow-checkout.test.ts',
  'scripts/catalogue-failfast-probe.mjs',
  'scripts/catalogue-foundation-red.mjs',
  'tests/database/catalogue/foundation.sql',
  'scripts/catalogue-foundation.mjs',
  'scripts/catalogue-reference-helpers.mjs',
  'tests/catalogue-ci/reference-helpers.node.mjs',
  'supabase/catalogue/v1/02-promotion-owner-extraction.sql',
  'tests/database/catalogue/promotion-owner-extraction.sql',
  'tests/catalogue-ci/promotion-owner-extraction.node.mjs',
  'supabase/catalogue/v1/02-retired-co-line-resolution.sql',
  'tests/database/catalogue/retired-co-line-resolution.sql',
  'tests/catalogue/retired-co-line-resolution.source.mjs',
  'supabase/catalogue/v1/01-foundation.sql',
  'tests/database/catalogue/before-foundation.sql',
  'tests/database/catalogue/foundation-red.sql',
  'tests/database/catalogue/legacy-columns.sql',
  'tests/database/catalogue/roles.sql',
  'tests/catalogue-ci/foundation.node.mjs',
  'tests/catalogue-ci/foundation-binding.test.ts',
  'tests/catalogue/foundation.test.ts',
  'tests/catalogue/foundation-lock-source.test.ts',
  'tests/catalogue/authority-source.test.ts',
  'tests/catalogue/authority-manifest.test.ts',
  'tests/catalogue/fixtures/authority-observed-grants.json',
  'tests/catalogue-ci/foundation-red.node.mjs',
  'tests/catalogue-ci/failfast.node.mjs',
  'tests/database/catalogue-failfast/core.mjs',
  'tests/database/catalogue-failfast/core.node.mjs',
  'tests/database/catalogue-failfast/output.node.mjs',
  'tests/database/catalogue-failfast/results.mjs',
  'tests/database/catalogue-failfast/runner.mjs',
  'tests/database/catalogue-failfast/runner.node.mjs',
  'tests/database/catalogue-failfast/scenarios.mjs',
  'tests/database/catalogue-failfast/schema.sql',
  'tests/database/catalogue-failfast/session.mjs',
  'tests/database/catalogue-failfast/session.node.mjs',
 ])
 expect(runner.assertCatalogueCaptureSource(resolve('.')).composition).toHaveLength(42)
 const root=temp(),other=temp()
 mkdirSync(join(root,'supabase/functions/invite-user'),{recursive:true})
 symlinkSync(join(other,'unreadable-missing'),join(root,'supabase/functions/invite-user/.npmrc'))
 expect(()=>runner.catalogueCaptureSourceBytes(root,'supabase/functions/invite-user/.npmrc')).toThrow(/Protected/)
 expect(()=>runner.catalogueCaptureSourceBytes(root,'../private')).toThrow(/Protected/)
 mkdirSync(join(root,'safe'));symlinkSync(other,join(root,'safe/link'))
 expect(()=>runner.catalogueCaptureSourceBytes(root,'safe/link/file')).toThrow(/symlink/)
})

test('public capture and checkout CLIs fail with fixed output and no supplied payload',()=>{
 for(const [file,expected] of [['catalogue-capture-baseline','{"status":"capture-failed","code":"CATALOGUE_CAPTURE_REFUSED","phase":"initialization"}'],['catalogue-checkout','CATALOGUE_CHECKOUT_REFUSED']]) {
  const result=spawnSync(process.execPath,[`scripts/${file}.mjs`,'--PRIVATE-SENTINEL'],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:5000})
  expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr.trim()).toBe(expected)
 }
})

test('only the dedicated catalogue service disables Docker log capture before SQL can run',()=>{
 const workflow=readFileSync('.github/workflows/pilot-safety.yml','utf8')
 const [historical,job]=workflow.split('\n  catalogue-baseline:')
 expect(historical).not.toContain('--log-driver')
 const options=job.split('        options: >-\n')[1].split('\n    env:')[0]
 expect(options.match(/--log-driver=none/g)).toHaveLength(1)
 expect(options).toContain('--health-cmd "pg_isready -U postgres -d pilot_test"')
 expect(options).toContain('--health-retries 10')
})
