// Source-reviewed wrapper only. Runtime remains AUTHORED / UNRUN until separately authorized.
// Terminal use of an exclusively job-owned PostgreSQL service, never a shared/local/hosted DB.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,writeFileSync,readFileSync,renameSync,readdirSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {catalogueFailfastBinding} from './catalogue-failfast-probe.mjs';
import {catalogueCaptureSourceBytes,cataloguePublicSourcePaths} from './catalogue-capture-source.mjs';
import {catalogueCiIdentity} from './catalogue-ci-profile.mjs';
const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sha=x=>createHash('sha256').update(x).digest('hex');
export const targetRuntimeReviewedFiles=Object.freeze([
 {
  "path": "scripts/catalogue-customer-target-runtime.mjs",
  "sha256": "08642b53e8f8eaff33f0c850c1558727cdc0053ed18a585b472c382ccc3909f5"
 },
 {
  "path": "supabase/catalogue/v1/02-customer-target-tracking.sql",
  "sha256": "e4567a9cd023aba3c1bdb4b84925c6a6bad1e931bf5a199ba41c2bf5e34924ca"
 },
 {
  "path": "tests/catalogue-ci/customer-target-runtime.node.mjs",
  "sha256": "cfe4d616d6b6b8a9a559466081d851dd8e61609f3a75d106362700882d50cfc3"
 },
 {
  "path": "tests/catalogue-ci/customer-target-tracking.node.mjs",
  "sha256": "bc15e5f94bb83e796f5cc39a1bfba9ef6aabd4cdc71be24e2350749d8b9c3394"
 },
 {
  "path": "tests/database/catalogue/customer-target-race-spec.md",
  "sha256": "d60bb2d91d24072f48da7a86b1bc60ce86f5adcc88ece4feec1968030a783d25"
 },
 {
  "path": "tests/database/catalogue/customer-target-races.mjs",
  "sha256": "baf9524fba4726179e8f01457d003b77769affc7e69c3950a0fbca61ab168139"
 },
 {
  "path": "tests/database/catalogue/customer-target-runtime-authority.sql",
  "sha256": "f5153099679cacfcbc65bbd5325cc9e6bd18e94b1e0643d00be18d98aa69247e"
 },
 {
  "path": "tests/database/catalogue/customer-target-runtime-variants.sql",
  "sha256": "7df904baf7dc731fd426bfeb542ffa88cd7751b0944e40daf569ae3699eec985"
 },
 {
  "path": "tests/database/catalogue/customer-target-tracking.sql",
  "sha256": "0a6e5f1622b3aabd84e43e2c601720ca01ca06e58dcef70c3d9a06dc394b9bb5"
 }
].map(Object.freeze));
const reportPaths=Object.freeze(['tests/database/catalogue/before-foundation.sql','supabase/catalogue/v1/01-foundation.sql','tests/database/catalogue/legacy-columns.sql','tests/database/catalogue/roles.sql','supabase/catalogue/v1/02-customer-target-tracking.sql','tests/database/catalogue/customer-target-tracking.sql','tests/database/catalogue/customer-target-runtime-authority.sql','tests/database/catalogue/customer-target-runtime-variants.sql']);
const wrapperPaths=['scripts/catalogue-customer-target-artifact.mjs','tests/catalogue-ci/customer-target-artifact.node.mjs'];
const directory=path=>{const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());return stat;};
const sameDirectory=(path,expected)=>{const stat=directory(path);assert.equal(stat.ino,expected.ino);assert.equal(stat.dev,expected.dev);};
function validateIdentity(identity,env){
 const {commit,tree,candidate,clean}=identity.source;
 assert.deepEqual(identity.source,{commit,tree,candidate,clean});
 const exact=catalogueCiIdentity(env,{commit,tree,candidate,clean},{database:'pilot_test',operator:'postgres',database_owner:'postgres',server_address:identity.serverAddress,server_port:identity.serverPort,server_version_num:identity.serverVersion,system_identifier:identity.systemIdentifier},identity.runIdentity);
 assert.deepEqual(identity,exact);return identity;
}
function validateReport(bytes,identity,files){
 assert.equal(typeof bytes,'string');assert.ok(Buffer.byteLength(bytes)<=65536);assert.ok(bytes.endsWith('\n'));
 const report=JSON.parse(bytes);assert.equal(bytes,JSON.stringify(report)+'\n');
 const lifecycle=report.lifecycle;for(const key of ['backendPid','transactionId'])assert.match(lifecycle?.[key]??'',/^[1-9][0-9]{0,19}$/);
 const pids=report.races?.backendPids;assert.ok(Array.isArray(pids));assert.equal(pids.length,3);assert.equal(new Set(pids).size,3);assert.ok(pids.every(pid=>Number.isSafeInteger(pid)&&pid>0&&pid<=2147483647));
 const expected={format:'catalogue-customer-target-runtime-v1',status:'BOUNDED_TARGET_RUNTIME_PASSED',identity,lifecycle:{backendPid:lifecycle.backendPid,transactionId:lifecycle.transactionId},races:{status:'BOUNDED_TARGET_RACES_PASSED',backendPids:pids,cases:['reversed_raw_target_statements','evidence_relation_contention']},cleanup:'COMMITTED_SYNTHETIC_CHILD_DISPOSED',files,implementationAccepted:false,hostedVerified:false,trackingReady:false,broaderLockGraph:'UNPROVEN'};
 assert.deepEqual(report,expected);assert.equal(bytes,JSON.stringify(expected)+'\n');return expected;
}
function exactFile(path,expected){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=fstatSync(fd);assert.ok(stat.isFile()&&stat.nlink===1&&stat.size===Buffer.byteLength(expected));assert.equal(readFileSync(fd,'utf8'),expected);}finally{closeSync(fd);}
}
export function runCatalogueCustomerTargetArtifact({repoRoot=defaultRoot,env=process.env,execute=execFileSync,launch=spawnSync,bind=catalogueFailfastBinding,readSource=catalogueCaptureSourceBytes}={}){
 let descriptor;
 try{
  assert.equal(typeof env.GITHUB_OUTPUT,'string');descriptor=openSync(env.GITHUB_OUTPUT,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);const outputFile=fstatSync(descriptor);assert.ok(outputFile.isFile()&&outputFile.nlink===1);writeFileSync(descriptor,'bundle_ready=false\n');
  const binding=bind(repoRoot,env,execute),identity=validateIdentity(binding.identity,env);
  assert.equal(new Set(cataloguePublicSourcePaths).size,cataloguePublicSourcePaths.length);
  for(const path of [...reportPaths,...targetRuntimeReviewedFiles.map(x=>x.path),...wrapperPaths])assert.ok(cataloguePublicSourcePaths.includes(path));
  const snapshot=()=>cataloguePublicSourcePaths.map(path=>({path,sha256:sha(readSource(repoRoot,path))}));
  const sources=snapshot(),byPath=new Map(sources.map(x=>[x.path,x.sha256]));
  for(const entry of targetRuntimeReviewedFiles)assert.equal(byPath.get(entry.path),entry.sha256);
  const files=reportPaths.map(path=>({path,sha256:byPath.get(path)}));
  const checkSource=()=>{assert.deepEqual(bind(repoRoot,env,execute),binding);assert.deepEqual(snapshot(),sources);};
  const parent=resolve(repoRoot,'scale-results'),parentStat=directory(parent),output=resolve(parent,'catalogue-customer-target-runtime'),pending=resolve(parent,'catalogue-customer-target-runtime-pending');
  mkdirSync(output);const outputStat=directory(output);mkdirSync(pending);const pendingStat=directory(pending);
  const checkDirectories=()=>{sameDirectory(parent,parentStat);sameDirectory(output,outputStat);sameDirectory(pending,pendingStat);assert.deepEqual(readdirSync(output),[]);};
  checkSource();checkDirectories();assert.deepEqual(readdirSync(pending),[]);
  // Capture both streams in memory only. Never persist raw logs or original errors.
  const child=launch(process.execPath,['scripts/catalogue-customer-target-runtime.mjs'],{cwd:repoRoot,env,encoding:'utf8',timeout:600000,maxBuffer:65536,shell:false,stdio:['ignore','pipe','pipe']});
  assert.equal(child.error,undefined);assert.equal(child.status,0);assert.equal(child.signal,null);assert.equal(child.stderr,'');
  const report=validateReport(child.stdout,identity,files);checkSource();checkDirectories();assert.deepEqual(readdirSync(pending),[]);
  const manifest=JSON.stringify({format:'catalogue-customer-target-runtime-manifest-v1',status:report.status,files:[{path:'results.json',sha256:sha(child.stdout)}]})+'\n';
  writeFileSync(resolve(pending,'results.json'),child.stdout,{flag:'wx',mode:0o600});writeFileSync(resolve(pending,'manifest.json'),manifest,{flag:'wx',mode:0o600});
  const checkBundle=path=>{assert.deepEqual(readdirSync(path).sort(),['manifest.json','results.json']);exactFile(resolve(path,'results.json'),child.stdout);exactFile(resolve(path,'manifest.json'),manifest);};
  checkSource();checkDirectories();checkBundle(pending);renameSync(pending,output);
  sameDirectory(parent,parentStat);sameDirectory(output,pendingStat);checkBundle(output);checkSource();
  writeFileSync(descriptor,'bundle_ready=true\n');return report;
 }catch{throw new Error('CATALOGUE_TARGET_ARTIFACT_REFUSED');}
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{assert.deepEqual(process.argv.slice(2),[]);const result=runCatalogueCustomerTargetArtifact();console.log(JSON.stringify({status:result.status,cleanup:result.cleanup,implementationAccepted:false}));}
 catch{process.stderr.write('CATALOGUE_TARGET_ARTIFACT_REFUSED\n');process.exitCode=1;}
}
