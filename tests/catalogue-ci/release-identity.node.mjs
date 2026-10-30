import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueCiConnection,catalogueCiIdentity } from '../../scripts/catalogue-ci-profile.mjs';
import { catalogueReadCiContext } from '../../scripts/catalogue-read-consumer.mjs';
const source={commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64),clean:true};
const branch='release/padiwan-staging-fixes-20261030';
const env={CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'Pilot safety checks',GITHUB_JOB:'catalogue-baseline',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:`refs/heads/${branch}`,GITHUB_SHA:source.commit,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_REF:`pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/heads/${branch}`,PILOT_RELEASE_SOURCE_SHA:source.commit,CATALOGUE_CI_PROFILE:'github-catalogue-baseline-v1',CATALOGUE_CI_SOURCE_SHA:source.commit,CATALOGUE_CI_SOURCE_TREE:source.tree,CATALOGUE_CI_CANDIDATE_SHA256:source.candidate,CATALOGUE_CI_HEAD_REPOSITORY:'',CATALOGUE_CI_BASE_REPOSITORY:'',CATALOGUE_CI_HEAD_REF:'',CATALOGUE_CI_BASE_REF:'',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only'};
const server={database:'pilot_test',operator:'postgres',database_owner:'postgres',server_address:'172.18.0.2',server_port:5432,server_version_num:'170011',system_identifier:'123456'};
const run='00000000-0000-4000-8000-000000000001';
const consumer=e=>({...e,GITHUB_JOB:'synthetic-safety',CATALOGUE_READ_BASELINE_RESULT:'success'});
test('exact release dispatch captures truthful non-PR identity and consumer uses the same provenance',()=>{
 assert.equal(catalogueCiConnection(env,source).PGHOST,'127.0.0.1');
 const identity=catalogueCiIdentity(env,source,server,run).ci;
 assert.equal(identity.event,'workflow_dispatch');assert.equal(identity.releaseRef,`refs/heads/${branch}`);assert.equal(identity.expectedSourceSha,source.commit);assert.equal(Object.hasOwn(identity,'headRef'),false);assert.equal(Object.hasOwn(identity,'baseRef'),false);
 assert.deepEqual(catalogueReadCiContext(consumer(env),source),{...identity,job:'synthetic-safety'});
});
for(const [key,value] of [['GITHUB_EVENT_NAME','schedule'],['GITHUB_REF','refs/heads/main'],['GITHUB_SHA','d'.repeat(40)],['PILOT_RELEASE_SOURCE_SHA','d'.repeat(40)],['PILOT_RELEASE_SOURCE_SHA',''],['PILOT_RELEASE_SOURCE_SHA',undefined],['CATALOGUE_CI_HEAD_REF','other'],['CATALOGUE_CI_BASE_REF','fix/pilot-database'],['CATALOGUE_CI_HEAD_REPOSITORY','fork/repo'],['CATALOGUE_CI_BASE_REPOSITORY','fork/repo'],['GITHUB_WORKFLOW_REF','other'],['CATALOGUE_CI_SOURCE_SHA','e'.repeat(40)],['GITHUB_RUN_ID','0']])test(`release producer and consumer refuse changed ${key}=${value}`,()=>{
 assert.throws(()=>catalogueCiConnection({...env,[key]:value},source));assert.throws(()=>catalogueReadCiContext(consumer({...env,[key]:value}),source));
});
test('producer still rejects ambient hosted/runtime options and consumer mismatched source tree/digest',()=>{
 for(const key of ['DATABASE_URL','SUPABASE_DB_URL','NODE_OPTIONS','PGHOSTADDR'])assert.throws(()=>catalogueCiConnection({...env,[key]:'unsafe'},source));
 for(const key of ['CATALOGUE_CI_SOURCE_TREE','CATALOGUE_CI_CANDIDATE_SHA256'])assert.throws(()=>catalogueReadCiContext({...consumer(env),[key]:'bad'},source));
 assert.throws(()=>catalogueReadCiContext({...consumer(env),CATALOGUE_READ_BASELINE_RESULT:'failure'},source));
});
test('existing PR identity remains unchanged and cannot use release refs',()=>{
 const pr={...env,CATALOGUE_CI_HEAD_REPOSITORY:'pl0203/lou_erp',CATALOGUE_CI_BASE_REPOSITORY:'pl0203/lou_erp',GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/30/merge',GITHUB_SHA:'d'.repeat(40),GITHUB_WORKFLOW_REF:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/30/merge',CATALOGUE_CI_HEAD_REF:'feat/catalogue-mutations-20261014',CATALOGUE_CI_BASE_REF:'fix/pilot-database'};delete pr.PILOT_RELEASE_SOURCE_SHA;
 const identity=catalogueCiIdentity(pr,source,server,run).ci;assert.equal(identity.headRef,'feat/catalogue-mutations-20261014');assert.equal(identity.baseRef,'fix/pilot-database');assert.equal(Object.hasOwn(identity,'releaseRef'),false);assert.equal(Object.hasOwn(identity,'expectedSourceSha'),false);
 assert.deepEqual(catalogueReadCiContext(consumer(pr),source),{...identity,job:'synthetic-safety'});assert.throws(()=>catalogueCiConnection({...pr,GITHUB_REF:env.GITHUB_REF},source));
});

test('exact release push has its own truthful event identity, never dispatch or PR',()=>{
 const push={...env,GITHUB_EVENT_NAME:'push'};const identity=catalogueCiIdentity(push,source,server,run).ci;
 assert.equal(identity.event,'push');assert.equal(identity.releaseRef,env.GITHUB_REF);assert.equal(identity.expectedSourceSha,source.commit);assert.equal(Object.hasOwn(identity,'headRef'),false);assert.deepEqual(catalogueReadCiContext(consumer(push),source),{...identity,job:'synthetic-safety'});
});
for(const [key,value] of [['GITHUB_REF','refs/heads/main'],['GITHUB_REF','refs/tags/release/padiwan-staging-fixes-20261030'],['GITHUB_REPOSITORY','fork/repo'],['GITHUB_SHA','f'.repeat(40)],['PILOT_RELEASE_SOURCE_SHA','f'.repeat(40)],['CATALOGUE_CI_HEAD_REF','feat/catalogue-mutations-20261014']])test(`release push refuses ${key}=${value}`,()=>{
 const push={...env,GITHUB_EVENT_NAME:'push',[key]:value};assert.throws(()=>catalogueCiConnection(push,source));assert.throws(()=>catalogueReadCiContext(consumer(push),source));
});

// Regression for the post-capture consumer: capture accepted push, but its
// downstream failfast/reference binding used to require a PR unconditionally.
import { connectionFor } from '../database/catalogue-failfast/core.mjs';
const failfastBinding=e=>({format:'synthetic-failfast-binding-v1',approval:'REVIEWED_FOR_THIS_RUN',scope:'generic-synthetic-only',
 identity:catalogueCiIdentity(e,source,server,run),files:{'core.mjs':'a'.repeat(64)}});
for(const event of ['push','workflow_dispatch']) {
 const e={...env,GITHUB_EVENT_NAME:event};
 test(`post-capture failfast accepts exact ${event} identity with unchanged isolated connection`,()=>{
  const b=failfastBinding(e),connection=connectionFor(e,b);
  assert.equal(connection.PGHOST,'127.0.0.1');assert.equal(connection.PGDATABASE,'pilot_catalogue_test');
  assert.equal(connection.PGPASSFILE,'/dev/null/failfast-no-password');assert.equal(connection.PGSYSCONFDIR,'/dev/null');
  assert.equal(b.identity.ci.event,event);assert.equal(Object.hasOwn(b.identity.ci,'headRef'),false);
 });
 test(`post-capture ${event} refuses context/source/run drift and ambient hosted settings`,()=>{
  const b=failfastBinding(e);
  for(const [key,value] of [['GITHUB_EVENT_NAME','schedule'],['GITHUB_REF','refs/heads/main'],['GITHUB_REPOSITORY','fork/repo'],['GITHUB_JOB','synthetic-safety'],['GITHUB_SHA','d'.repeat(40)],['PILOT_RELEASE_SOURCE_SHA','d'.repeat(40)],['PILOT_RELEASE_SOURCE_SHA',undefined],['CATALOGUE_CI_HEAD_REF','feat/catalogue-mutations-20261014'],['CATALOGUE_CI_SOURCE_SHA','e'.repeat(40)],['CATALOGUE_CI_CANDIDATE_SHA256','f'.repeat(64)],['GITHUB_RUN_ID','124'],['GITHUB_RUN_ATTEMPT','2'],['GITHUB_WORKFLOW_REF','other'],['PGHOST','hosted.example.invalid'],['PGDATABASE','other'],['DATABASE_URL','unsafe'],['NODE_OPTIONS','unsafe'],['PGHOSTADDR','127.0.0.1']]) assert.throws(()=>connectionFor({...e,[key]:value},b),key);
  for(const change of [c=>c.event='pull_request',c=>c.releaseRef='refs/heads/main',c=>c.expectedSourceSha='e'.repeat(40),c=>c.extra='unbound']) {
   const changed=structuredClone(b);change(changed.identity.ci);assert.throws(()=>connectionFor(e,changed));
  }
 });
}
test('post-capture legacy PR still validates exact original context',()=>{
 const e={...env,GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/2/merge',GITHUB_SHA:'d'.repeat(40),GITHUB_WORKFLOW_REF:'pl0203/lou_erp/.github/workflows/pilot-safety.yml@refs/pull/2/merge',CATALOGUE_CI_HEAD_REPOSITORY:'pl0203/lou_erp',CATALOGUE_CI_BASE_REPOSITORY:'pl0203/lou_erp',CATALOGUE_CI_HEAD_REF:'feat/catalogue-mutations-20261014',CATALOGUE_CI_BASE_REF:'fix/pilot-database'};
 const b=failfastBinding(e);assert.equal(connectionFor(e,b).PGDATABASE,'pilot_catalogue_test');
 for(const key of ['CATALOGUE_CI_HEAD_REPOSITORY','CATALOGUE_CI_BASE_REPOSITORY','CATALOGUE_CI_HEAD_REF','CATALOGUE_CI_BASE_REF'])assert.throws(()=>connectionFor({...e,[key]:'wrong'},b));
});
