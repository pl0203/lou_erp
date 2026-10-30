// Artifact integrity + source/run binding. Provenance additionally requires the
// workflow to download this exact named artifact from its own successful run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync,openSync,readFileSync,fstatSync,closeSync,constants } from 'node:fs';
import { resolve } from 'node:path';
import { catalogueCaptureSourceIdentity,catalogueCaptureSourceBytes,cataloguePublicSourcePaths } from './catalogue-capture-source.mjs';
import { catalogueCiIdentity,catalogueCiEventIdentity } from './catalogue-ci-profile.mjs';
import { parseReadJson } from './catalogue-read-json.mjs';
import { readProofBoundPaths } from './catalogue-read-proof.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
export function catalogueReadCiContext(env,source) {
 assert.equal(env.GITHUB_JOB,'synthetic-safety');assert.equal(env.CATALOGUE_READ_BASELINE_RESULT,'success');
 assert.equal(source.clean,true);
 for(const key of ['commit','tree'])assert.match(source[key]??'',/^[a-f0-9]{40}$/);
 assert.match(source.candidate??'',/^[a-f0-9]{64}$/);
 assert.equal(source.commit,env.CATALOGUE_CI_SOURCE_SHA);assert.equal(source.tree,env.CATALOGUE_CI_SOURCE_TREE);assert.equal(source.candidate,env.CATALOGUE_CI_CANDIDATE_SHA256);
 return catalogueCiEventIdentity(env,source);
}
export function verifyCatalogueReadBundle(repoRoot,env) {
 assert.ok(readProofBoundPaths.every(path=>cataloguePublicSourcePaths.includes(path)), 'Read proof paths missing from explicit capture allowlist');
 const source=catalogueCaptureSourceIdentity(repoRoot);
 const consumerIdentity=catalogueReadCiContext(env,source);
 const directory=resolve(repoRoot,'scale-results/catalogue-read-proof');
 for(const path of [repoRoot,resolve(repoRoot,'scale-results'),directory]){const stat=lstatSync(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());}
 const read=name=>{const fd=openSync(resolve(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);assert.ok(stat.isFile()&&stat.size<=128*1024);return readFileSync(fd);}finally{closeSync(fd);}};
 const parse=bytes=>{const text=bytes.toString('utf8');assert.ok(text.endsWith('\n'));return parseReadJson(text.slice(0,-1),{canonical:true}).value;};
 const manifest=parse(read('manifest.json')),reportBytes=read('results.json'),payload=read('sql-output.json');
 assert.deepEqual(manifest,{format:'catalogue-read-proof-manifest-v1',files:[{path:'results.json',sha256:sha(reportBytes)},{path:'sql-output.json',sha256:sha(payload)}]});
 const report=parse(reportBytes);
 assert.equal(report.format,'catalogue-read-proof-v1');assert.equal(report.status,'SQL_READ_ROLLBACK_PASSED_DECODER_PENDING');
 assert.equal(report.scope,'synthetic-read-composition-only');assert.equal(report.rollback,'VERIFIED');assert.equal(report.decoder,'NOT_YET_RUN');
 for(const key of ['task1Complete','implementationAccepted','hostedVerified','trackingReady'])assert.equal(report[key],false);
 assert.equal(report.identity.profile,'github-catalogue-baseline-v1');assert.deepEqual(report.identity.source,source);
 const expectedIdentity=catalogueCiIdentity({...env,GITHUB_JOB:'catalogue-baseline',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only'},source,{
  database:'pilot_test',operator:'postgres',database_owner:'postgres',server_address:report.identity.serverAddress,
  server_port:report.identity.serverPort,server_version_num:report.identity.serverVersion,system_identifier:report.identity.systemIdentifier,
 },report.identity.runIdentity);
 assert.deepEqual(report.identity,expectedIdentity);
 assert.deepEqual(report.identity.ci,{...consumerIdentity,job:'catalogue-baseline'});
 assert.match(report.session.backendPid,/^[1-9][0-9]*$/);assert.match(report.session.transactionId,/^[1-9][0-9]*$/);
 assert.equal(report.sqlOutputSha256,sha(payload));
 assert.deepEqual(report.files,readProofBoundPaths.map(path=>({path,sha256:sha(catalogueCaptureSourceBytes(repoRoot,path))})));
 assert.deepEqual(catalogueCaptureSourceIdentity(repoRoot),source);
 assert.ok(payload.toString('utf8').endsWith('\n'));
 return parseReadJson(payload.toString('utf8').slice(0,-1),{canonical:true}).value;
}
