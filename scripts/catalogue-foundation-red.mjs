// RED-only checkpoint. Never applies candidate SQL or certifies implementation.
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
const testPath='tests/database/catalogue/foundation.sql';
const sha=x=>createHash('sha256').update(x).digest('hex');
const directory=path=>{const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());return stat;};
export function assertFoundationMissingContract(error) {
 assert.ok(error,'Unexpected foundation pass is not RED evidence');
 assert.equal(error.status,3);assert.equal(error.signal,null);assert.equal(error.code,undefined);
 assert.equal(error.stdout,'CATALOGUE_FOUNDATION_FIXTURE_READY\n');
 const errors=String(error.stderr??'').split('\n').filter(line=>line.startsWith('ERROR:'));
 assert.equal(errors.length,1);
 assert.match(errors[0],/^ERROR:\s+PFC01: CATALOGUE_FOUNDATION_MISSING_SERVER_COLUMNS$/);
}
export function runCatalogueFoundationRed({repoRoot=defaultRoot,env=process.env,execute=execFileSync}={}) {
 let descriptor;
 try {
  // Each invocation must explicitly authorize its own bundle; stale files cannot.
  assert.equal(typeof env.GITHUB_OUTPUT,'string');
  descriptor=openSync(env.GITHUB_OUTPUT,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);
  assert.ok(fstatSync(descriptor).isFile());writeFileSync(descriptor,'bundle_ready=false\n');
  // Reuse the established capture guard, not its generic concurrency result.
  const binding=catalogueFailfastBinding(repoRoot,env,execute),identity=binding.identity;
  const connection={...catalogueCiConnection(env,identity.source),PGDATABASE:'pilot_catalogue_test',LC_ALL:'C'};
  const sql=catalogueCaptureSourceBytes(repoRoot,testPath);
  const parent=resolve(repoRoot,'scale-results');directory(parent);
  const output=resolve(parent,'catalogue-foundation-red'),pending=resolve(parent,'catalogue-foundation-red-pending');
  mkdirSync(output);const reserved=directory(output);mkdirSync(pending);directory(pending);
  const checkSource=()=>assert.deepEqual(catalogueFailfastBinding(repoRoot,env,execute),binding);
  const run=body=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{
   cwd:repoRoot,env:connection,input:catalogueCiIdentityGateSql(identity)+body,encoding:'utf8',timeout:20000,maxBuffer:128*1024,shell:false,stdio:['pipe','pipe','pipe']});
  const verify=()=>verifyCatalogueCiObservation(JSON.parse(run(catalogueObservationSql('pilot_catalogue_test'))),identity,'pilot_catalogue_test');
  checkSource();verify();
  let failure;try {run(sql.toString('utf8'));}catch(error){failure=error;}
  assertFoundationMissingContract(failure);
  checkSource();verify();
  const report={format:'catalogue-foundation-red-v1',status:'EXPECTED_MISSING_CONTRACT_RED',scope:'synthetic-foundation-contract-only',
   implementationAccepted:false,hostedVerified:false,identity,testPath,testSha256:sha(sql),
   fixture:'PASSED',assertion:'master_server_columns',assertionStatus:'FAILED',sqlstate:'PFC01',
   otherFoundationBehavior:'UNRUN',authorityBehavior:'UNRUN',targetParity:'UNPROVEN'};
  directory(parent);directory(pending);const current=directory(output);
  assert.equal(current.ino,reserved.ino);assert.equal(current.dev,reserved.dev);assert.deepEqual(readdirSync(output),[]);
  const bytes=JSON.stringify(report,null,2)+'\n';
  writeFileSync(resolve(pending,'results.json'),bytes,{flag:'wx'});
  writeFileSync(resolve(pending,'manifest.json'),JSON.stringify({format:'catalogue-foundation-red-manifest-v1',status:report.status,files:[{path:'results.json',sha256:sha(bytes)}]})+'\n',{flag:'wx'});
  checkSource();renameSync(pending,output);writeFileSync(descriptor,'bundle_ready=true\n');
  return report;
 } catch {throw new Error('CATALOGUE_FOUNDATION_RED_REFUSED');}
 finally {if(descriptor!==undefined)closeSync(descriptor);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {
  assert.deepEqual(process.argv.slice(2),[]);
  const report=runCatalogueFoundationRed();
  // Exit zero means the expected RED was verified, never that foundation passed.
  console.log(JSON.stringify({status:report.status,assertionStatus:report.assertionStatus,implementationAccepted:false,hostedVerified:false}));
 } catch {process.stderr.write('CATALOGUE_FOUNDATION_RED_REFUSED\n');process.exitCode=1;}
}
