// Source-only prepared entrypoint. Existing fixed CI profile is mandatory.
import assert from 'node:assert/strict';
import { canonicalReadJson } from './catalogue-read-json.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync,mkdirSync,writeFileSync,renameSync,readdirSync,openSync,fstatSync,closeSync,constants } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { catalogueFailfastBinding } from './catalogue-failfast-probe.mjs';
import { catalogueCaptureSourceBytes,cataloguePublicSourcePaths } from './catalogue-capture-source.mjs';
import { catalogueCiConnection,catalogueCiIdentityGateSql,catalogueObservationSql,verifyCatalogueCiObservation } from './catalogue-ci-profile.mjs';
import { readSqlPaths,buildCatalogueReadSession,parseCatalogueReadOutput } from './catalogue-read-session.mjs';
const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const directory=path=>{const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());return stat;};
export const readProofBoundPaths=Object.freeze([...Object.values(readSqlPaths),
 'src/lib/catalogue/validation.ts','src/lib/catalogue/contracts.ts','src/lib/catalogPricing.ts','src/lib/customerCategory.ts',
 'tests/catalogue/assert-read-sql-output.ts','scripts/catalogue-read-session.mjs','scripts/catalogue-read-proof.mjs',
 'scripts/catalogue-read-json.mjs','scripts/catalogue-read-consumer.mjs','tests/catalogue/read-proof.runtime.ts','vitest.catalogue-read-proof.config.ts']);
export function runCatalogueReadProof({repoRoot=defaultRoot,env=process.env,execute=execFileSync}={}) {
 let descriptor;
 try {
  assert.equal(typeof env.GITHUB_OUTPUT,'string');
  descriptor=openSync(env.GITHUB_OUTPUT,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);
  assert.ok(fstatSync(descriptor).isFile());writeFileSync(descriptor,'bundle_ready=false\n');
  const binding=catalogueFailfastBinding(repoRoot,env,execute),identity=binding.identity;
  const connection={...catalogueCiConnection(env,identity.source),PGDATABASE:'pilot_catalogue_test',LC_ALL:'C'};
  assert.ok(readProofBoundPaths.every(path=>cataloguePublicSourcePaths.includes(path)), 'Read proof paths missing from explicit capture allowlist');
  assert.equal(new Set(cataloguePublicSourcePaths).size,cataloguePublicSourcePaths.length);
  // The capture byte reader alone is NOT an allowlist guard.
  const files=readProofBoundPaths.map(path=>({path,sha256:sha(catalogueCaptureSourceBytes(repoRoot,path))}));
  const parts=Object.fromEntries(Object.entries(readSqlPaths).map(([name,path])=>[name,catalogueCaptureSourceBytes(repoRoot,path).toString('utf8')]));
  const sql=buildCatalogueReadSession(identity,parts);
  const parent=resolve(repoRoot,'scale-results'),parentReserved=directory(parent);
  const output=resolve(parent,'catalogue-read-proof'),pending=resolve(parent,'catalogue-read-proof-pending');
  mkdirSync(output);const reserved=directory(output);mkdirSync(pending);const pendingReserved=directory(pending);
  const checkSource=()=>{
   assert.deepEqual(catalogueFailfastBinding(repoRoot,env,execute),binding);
   assert.deepEqual(readProofBoundPaths.map(path=>({path,sha256:sha(catalogueCaptureSourceBytes(repoRoot,path))})),files);
  };
  const run=input=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{
   cwd:repoRoot,env:connection,input,encoding:'utf8',timeout:180000,maxBuffer:512*1024,shell:false,stdio:['pipe','pipe','pipe']});
  const verify=()=>verifyCatalogueCiObservation(JSON.parse(run(catalogueCiIdentityGateSql(identity)+catalogueObservationSql('pilot_catalogue_test'))),identity,'pilot_catalogue_test');
  checkSource();verify();
  const {json,...session}=parseCatalogueReadOutput(run(sql));
  checkSource();verify();
  const payload=json+'\n';
  const report={format:'catalogue-read-proof-v1',status:'SQL_READ_ROLLBACK_PASSED_DECODER_PENDING',scope:'synthetic-read-composition-only',
   task1Complete:false,implementationAccepted:false,hostedVerified:false,trackingReady:false,
   identity,session,files,sqlOutputSha256:sha(payload),rollback:'VERIFIED',decoder:'NOT_YET_RUN'};
  checkSource();
  for(const [path,expected] of [[parent,parentReserved],[pending,pendingReserved]]){const actual=directory(path);assert.equal(actual.ino,expected.ino);assert.equal(actual.dev,expected.dev);}
  const current=directory(output);
  assert.equal(current.ino,reserved.ino);assert.equal(current.dev,reserved.dev);assert.deepEqual(readdirSync(output),[]);
  const result=canonicalReadJson(report)+'\n';
  writeFileSync(resolve(pending,'results.json'),result,{flag:'wx'});
  writeFileSync(resolve(pending,'sql-output.json'),payload,{flag:'wx'});
  writeFileSync(resolve(pending,'manifest.json'),canonicalReadJson({format:'catalogue-read-proof-manifest-v1',files:[{path:'results.json',sha256:sha(result)},{path:'sql-output.json',sha256:sha(payload)}]})+'\n',{flag:'wx'});
  checkSource();renameSync(pending,output);writeFileSync(descriptor,'bundle_ready=true\n');return report;
 }catch{throw new Error('CATALOGUE_READ_PROOF_REFUSED');}
 finally{if(descriptor!==undefined)closeSync(descriptor);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{assert.deepEqual(process.argv.slice(2),[]);const report=runCatalogueReadProof();console.log(JSON.stringify({status:report.status,decoder:report.decoder,implementationAccepted:false}));}
 catch{process.stderr.write('CATALOGUE_READ_PROOF_REFUSED\n');process.exitCode=1;}
}
