// INCOMPLETE checkpoint: collect synthetic metadata for independent review only.
// This entrypoint cannot certify Task 1, reset, or deploy.
import assert from 'node:assert/strict'
import { createHash,randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync,existsSync,lstatSync,mkdirSync,writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { catalogueCaptureSourceIdentity,assertCatalogueCaptureSource,assertCatalogueMetadataSql,catalogueCompositionSql,catalogueCompositionSha256 } from './catalogue-capture-source.mjs'
import { catalogueCiConnection,catalogueCiIdentity,catalogueCiServerObservationSql,catalogueCiRootBootstrapSql,catalogueCiBootstrapSql,catalogueCiIdentityGateSql,verifyCatalogueCiObservation,catalogueCiRefusalProbeSql,catalogueObservationSql } from './catalogue-ci-profile.mjs'
const defaultRoot=fileURLToPath(new URL('../',import.meta.url))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const compositionHash=catalogueCompositionSha256
const catalogParts=['schemas','relations','columns','foreign_keys','constraints','functions','triggers','policies','indexes','types','roles','memberships','default_acl','rules','event_triggers'].sort()
const phases=['initialization','source','connection','refusal-probe','root-bootstrap','child-create','child-bootstrap','composition','metadata','artifact']
export function catalogueCaptureFailure(phase) {
 return {status:'capture-failed',code:'CATALOGUE_CAPTURE_REFUSED',phase:phases.includes(phase)?phase:'initialization'}
}
const fields={
 schemas:'name owner acl',relations:'name kind owner rls force_rls acl persistence options replica_identity',
 columns:'relation position name type not_null default identity generated acl',
 foreign_keys:'relation name target columns target_columns update_action delete_action match validated deferrable deferred definition',
 constraints:'relation name type validated deferrable deferred definition',
 functions:'signature identity_arguments definition_sha256 prosrc_sha256 owner language kind definer leakproof strict volatility parallel result config acl effective_execute',
 triggers:'relation name function definition type enabled internal deferrable deferred constraint',policies:'relation name command permissive roles using check',
 indexes:'relation name definition valid ready unique primary',types:'name kind owner acl enum',
 roles:'name superuser inherit create_role create_db login replication bypass_rls config',memberships:'role member grantor admin inherit set',
 default_acl:'owner schema type acl',rules:'relation name enabled definition',event_triggers:'name event owner function enabled tags',
}
export function catalogueCaptureArgs(args) { assert.deepEqual(args,[],'Capture accepts no flags; fixed GitHub profile and output only') }
export function catalogueCaptureEvidence(identity,catalog) {
 assert.deepEqual(Object.keys(catalog).sort(),catalogParts,'Unknown or missing captured metadata part')
 for(const key of catalogParts) {
  assert.ok(Array.isArray(catalog[key]),'Metadata array required')
  for(const row of catalog[key]) {
   assert.ok(row && typeof row==='object' && !Array.isArray(row),'Metadata object required')
   assert.deepEqual(Object.keys(row).sort(),fields[key].split(' ').sort(),'Unexpected metadata fields refused')
   if(key==='functions')for(const field of ['definition_sha256','prosrc_sha256'])assert.match(row[field],/^[a-f0-9]{64}$/,'Function checksum required')
  }
 }
 return {format:'catalogue-baseline-capture-v1',status:'captured-unverified',scope:'synthetic-composed-source-only',task1Complete:false,hostedVerified:false,
  identity,compositionSha256:compositionHash,implementationSuitesRun:[],catalog,
  reviewRequired:['Independently review this synthetic structural metadata','Complete the separate Task 1 topology and safety review before implementation']}
}
export function writeCatalogueCaptureEvidence(repoRoot,evidence) {
 // Only this ignored directory may be uploaded. Never follow an existing symlink or overwrite evidence.
 const parent=resolve(repoRoot,'scale-results'),directory=resolve(parent,'catalogue-baseline')
 if(existsSync(parent))assert.ok(lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink(),'Unsafe evidence parent')
 else mkdirSync(parent)
 assert.ok(!existsSync(directory),'Capture evidence already exists; no overwrite/reuse')
 mkdirSync(directory)
 const capture=JSON.stringify(evidence,null,2)+'\n'
 writeFileSync(resolve(directory,'capture.json'),capture,{flag:'wx'})
 writeFileSync(resolve(directory,'manifest.json'),JSON.stringify({format:'catalogue-capture-manifest-v1',status:'captured-unverified',source:evidence.identity.source,
  ci:evidence.identity.ci,files:[{path:'capture.json',sha256:hash(capture)}]},null,2)+'\n',{flag:'wx'})
 return 'scale-results/catalogue-baseline'
}
export function captureCatalogueBaseline({env=process.env,execute=execFileSync,repoRoot=defaultRoot,writeEvidence=writeCatalogueCaptureEvidence}={}) {
 let phase='source'
 try {
 const read=path=>readFileSync(resolve(repoRoot,path),'utf8')
 const manifest=assertCatalogueCaptureSource(repoRoot)
 const source=catalogueCaptureSourceIdentity(repoRoot,execute)
 phase='connection'
 const connection=catalogueCiConnection(env,source)
 const run=(sql,database='pilot_catalogue_test')=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{
  cwd:repoRoot,env:{...connection,PGDATABASE:database},input:sql,encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024,shell:false,stdio:['pipe','pipe','pipe']})
 const observed=JSON.parse(run(catalogueCiServerObservationSql,'pilot_test'))
 const identity=catalogueCiIdentity(env,source,observed,randomUUID())
 const checkSource=()=>{
  assert.deepEqual(catalogueCaptureSourceIdentity(repoRoot,execute),source,'Candidate source changed during capture')
  assert.deepEqual(catalogueCiConnection(env,source),connection,'CI context changed during capture')
  assert.deepEqual(catalogueCiIdentity(env,source,observed,identity.runIdentity),identity,'CI run identity changed during capture')
 }
 const verify=database=>{
  checkSource()
  verifyCatalogueCiObservation(JSON.parse(run(catalogueCiIdentityGateSql(identity,database)+catalogueObservationSql(database),database)),identity,database)
 }
 const guardedRun=(sql,database='pilot_catalogue_test')=>{
  verify(database)
  return run(catalogueCiIdentityGateSql(identity,database)+sql,database)
 }
 checkSource()
 // Real psql behavior is part of capture, not inferred from a mocked SQL string.
 phase='refusal-probe'
 let refusalVerified=false
 try { run(catalogueCiRefusalProbeSql(identity),'pilot_test') }
 catch(error) {
  assert.equal(error.status,3,'Expected psql ON_ERROR_STOP script refusal')
  assert.match(String(error.stderr??''),/22012/,'Expected deliberate division-by-zero SQLSTATE')
  assert.ok(!String(error.stdout??'').includes('CATALOGUE_GATE_PROBE_UNSAFE'),'Refusal probe executed past gate')
  refusalVerified=true
 }
 assert.equal(refusalVerified,true,'Real psql refusal probe did not fail closed')
 checkSource()
 phase='root-bootstrap'
 run(catalogueCiRootBootstrapSql(identity),'pilot_test')
 verify('pilot_test')
 assert.equal(guardedRun("-- CATALOGUE_REQUIRE_FRESH_DATABASE\nSELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='pilot_catalogue_test');",'pilot_test').trim(),'t','pilot_catalogue_test already exists; new service required, no reset/reuse')
 // CREATE DATABASE cannot be inside a transaction. The gate and CREATE share one psql session.
 phase='child-create'
 guardedRun('CREATE DATABASE pilot_catalogue_test OWNER postgres;','pilot_test')
 verify('pilot_test')
 phase='child-bootstrap'
 run(catalogueCiBootstrapSql(identity))
 verify('pilot_catalogue_test')
 phase='composition'
 for(const {path} of manifest.composition) {
  guardedRun(catalogueCompositionSql(path,read(path)))
 }
 phase='metadata'
 const sql=read('scripts/catalogue-ci-metadata.sql');assertCatalogueMetadataSql(sql)
 const catalog=JSON.parse(guardedRun(sql))
 verify('pilot_catalogue_test')
 const evidence={...catalogueCaptureEvidence(identity,catalog),refusalProbe:'verified-on-error-stop',compositionPhases:manifest.composition.length}
 phase='artifact'
 const output=writeEvidence(repoRoot,evidence)
 checkSource()
 return {status:'captured-unverified',task1Complete:false,hostedVerified:false,output,source,ci:identity.ci}
 } catch {
  // Never attach subprocess output, SQL text, input values, or the original cause.
  throw Object.assign(new Error('CATALOGUE_CAPTURE_REFUSED'),{phase:catalogueCaptureFailure(phase).phase})
 }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try { catalogueCaptureArgs(process.argv.slice(2));console.log(JSON.stringify(captureCatalogueBaseline())) }
 catch(error) { process.stderr.write(JSON.stringify(catalogueCaptureFailure(error.phase))+'\n');process.exitCode=1 }
}
