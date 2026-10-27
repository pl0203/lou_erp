import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync,readFileSync,mkdirSync,writeFileSync,renameSync,readdirSync,openSync,fstatSync,closeSync,constants } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { catalogueCaptureSourceBytes,catalogueCaptureSourceIdentity,catalogueCompositionSha256 } from './catalogue-capture-source.mjs';
import { validateBinding,connectionFor } from '../tests/database/catalogue-failfast/core.mjs';
import { run } from '../tests/database/catalogue-failfast/runner.mjs';
import { publicResult } from '../tests/database/catalogue-failfast/results.mjs';
const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const executableFiles=['core.mjs','results.mjs','runner.mjs','scenarios.mjs','schema.sql','session.mjs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const plainDirectory=path=>{const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());};
function captureFile(repoRoot,name,limit) {
 const parent=resolve(repoRoot,'scale-results'),directory=resolve(parent,'catalogue-baseline');
 plainDirectory(parent);plainDirectory(directory);
 const path=resolve(directory,name),stat=lstatSync(path);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit);
 return readFileSync(path);
}
export function catalogueFailfastBinding(repoRoot,env,execute=execFileSync) {
 const manifest=JSON.parse(captureFile(repoRoot,'manifest.json',64*1024));
 const bytes=captureFile(repoRoot,'capture.json',64*1024*1024),capture=JSON.parse(bytes);
 assert.equal(manifest.format,'catalogue-capture-manifest-v1');assert.equal(manifest.status,'captured-unverified');
 assert.deepEqual(manifest.files,[{path:'capture.json',sha256:sha(bytes)}]);
 assert.equal(capture.format,'catalogue-baseline-capture-v1');assert.equal(capture.status,'captured-unverified');
 assert.equal(capture.scope,'synthetic-composed-source-only');assert.equal(capture.task1Complete,false);assert.equal(capture.hostedVerified,false);
 assert.equal(capture.refusalProbe,'verified-on-error-stop');assert.equal(capture.compositionPhases,42);
 assert.equal(capture.compositionSha256,catalogueCompositionSha256);assert.deepEqual(capture.implementationSuitesRun,[]);
 const source=catalogueCaptureSourceIdentity(repoRoot,execute);
 assert.deepEqual(source,capture.identity.source);assert.deepEqual(manifest.source,source);assert.deepEqual(manifest.ci,capture.identity.ci);
 const files=Object.fromEntries(executableFiles.map(name=>[name,sha(catalogueCaptureSourceBytes(repoRoot,`tests/database/catalogue-failfast/${name}`))]));
 const binding={format:'synthetic-failfast-binding-v1',approval:'REVIEWED_FOR_THIS_RUN',scope:'generic-synthetic-only',identity:capture.identity,files};
 validateBinding(binding);connectionFor(env,binding);
 return binding;
}
function createOutput(repoRoot) {
 const parent=resolve(repoRoot,'scale-results');plainDirectory(parent);
 const directory=resolve(parent,'catalogue-failfast');mkdirSync(directory);plainDirectory(directory);
 const reserved=lstatSync(directory),staging=resolve(parent,'catalogue-failfast-pending');mkdirSync(staging);plainDirectory(staging);
 return report=>{
  plainDirectory(parent);plainDirectory(directory);plainDirectory(staging);
  const current=lstatSync(directory);assert.equal(current.ino,reserved.ino);assert.equal(current.dev,reserved.dev);
  const bytes=JSON.stringify(report,null,2)+'\n';assert.ok(Buffer.byteLength(bytes)<=512*1024);
  writeFileSync(resolve(staging,'results.json'),bytes,{flag:'wx'});
  writeFileSync(resolve(staging,'manifest.json'),JSON.stringify({format:'synthetic-failfast-manifest-v1',status:report.status,files:[{path:'results.json',sha256:sha(bytes)}]})+'\n',{flag:'wx'});
  assert.deepEqual(readdirSync(directory),[]);
  renameSync(staging,directory);
 };
}
function actionOutput(env) {
 assert.equal(typeof env.GITHUB_OUTPUT,'string');
 const descriptor=openSync(env.GITHUB_OUTPUT,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);
 try {
  assert.ok(fstatSync(descriptor).isFile());
  writeFileSync(descriptor,'bundle_ready=false\n');
  return {ready:()=>writeFileSync(descriptor,'bundle_ready=true\n'),close:()=>closeSync(descriptor)};
 } catch(error) {closeSync(descriptor);throw error;}
}
export async function runCatalogueFailfast({repoRoot=defaultRoot,env=process.env,execute=execFileSync,runProbe=run}={}) {
 let binding,write,signal;
 try {
  signal=actionOutput(env);
  binding=catalogueFailfastBinding(repoRoot,env,execute);
  write=createOutput(repoRoot);
  const report=publicResult(await runProbe(binding,repoRoot,env),binding);
  assert.equal(report.status,'BOUNDED_REPRESENTATIVE_CASES_PASSED');
  assert.deepEqual(catalogueFailfastBinding(repoRoot,env,execute),binding);
  write(report);
  signal.ready();
  return report;
 } catch(error) {
  if(write&&binding) {
   let report;
   try {assert.equal(error.report?.status,'FAILED_OR_INCONCLUSIVE');report=publicResult(error.report,binding);}catch {
    report=publicResult({status:'FAILED_OR_INCONCLUSIVE',cases:[]},binding);
   }
   try {write(report);signal.ready();}catch {}
  }
  throw new Error('CATALOGUE_FAILFAST_REFUSED');
 } finally {try {signal?.close();}catch {throw new Error('CATALOGUE_FAILFAST_REFUSED');}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {
  assert.deepEqual(process.argv.slice(2),[]);
  const report=await runCatalogueFailfast();
  console.log(JSON.stringify({status:report.status,scope:report.scope,cases:report.cases.map(({name,status})=>({name,status}))}));
 } catch {process.stderr.write('CATALOGUE_FAILFAST_REFUSED\n');process.exitCode=1;}
}
