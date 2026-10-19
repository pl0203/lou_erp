// Bounded GitHub-only synthetic capture. This does not widen the local profile.
import assert from 'node:assert/strict'
import { isIP } from 'node:net'
const profile='github-catalogue-baseline-v1'
const quote=value=>`'${String(value).replaceAll("'","''")}'`
const privateIPv4=address=>{
 if(isIP(address??'')!==4)return false
 const [a,b]=address.split('.').map(Number)
 return a===127 || a===10 || (a===172 && b>=16 && b<=31) || (a===192 && b===168)
}
export function catalogueCiConnection(env,source) {
 assert.equal(source?.clean,true,'CI requires clean source')
 for(const key of ['commit','tree'])assert.match(source[key]??'',/^[a-f0-9]{40}$/,'Verified source identity required')
 assert.match(source.candidate??'',/^[a-f0-9]{64}$/,'Candidate byte digest required')
 assert.ok(['feat/catalogue-mutations-20261014','feat/employee-foundation-20261019'].includes(env.CATALOGUE_CI_HEAD_REF),'Exact reviewed head required')
 const fixed={CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'Pilot safety checks',GITHUB_JOB:'catalogue-baseline',
  GITHUB_EVENT_NAME:'pull_request',CATALOGUE_CI_PROFILE:profile,CATALOGUE_CI_HEAD_REPOSITORY:'pl0203/lou_erp',CATALOGUE_CI_BASE_REPOSITORY:'pl0203/lou_erp',
  CATALOGUE_CI_BASE_REF:'fix/pilot-database',
  CATALOGUE_CI_SOURCE_SHA:source.commit,CATALOGUE_CI_CANDIDATE_SHA256:source.candidate,
  PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only'}
 for(const [key,value] of Object.entries(fixed))assert.equal(env[key],value,`Fixed catalogue CI context required: ${key}`)
 for(const key of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'])assert.match(env[key]??'',/^[1-9][0-9]*$/,`Invalid ${key}`)
 assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/,'Invalid GitHub event SHA')
 assert.match(env.GITHUB_REF??'',/^refs\/pull\/[1-9][0-9]*\/merge$/,'Exact pull request merge ref required')
 assert.equal(env.GITHUB_WORKFLOW_REF,`pl0203/lou_erp/.github/workflows/pilot-safety.yml@${env.GITHUB_REF}`,'Exact workflow ref required')
 const acceptedPg=['PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGCONNECT_TIMEOUT','PGTZ']
 for(const key of Object.keys(env))assert.ok(!key.startsWith('PG') || acceptedPg.includes(key),`Ambient libpq option refused: ${key}`)
 for(const key of ['DATABASE_URL','SUPABASE_DB_URL','SUPABASE_DB_PASSWORD','LD_PRELOAD','LD_LIBRARY_PATH','NODE_OPTIONS','NODE_PATH','DYLD_LIBRARY_PATH','DYLD_INSERT_LIBRARIES'])assert.equal(env[key],undefined,`Ambient target/runtime option refused: ${key}`)
 return {PATH:env.PATH,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only',
  PGCONNECT_TIMEOUT:'5',PGTZ:'UTC',PGPASSFILE:'/dev/null/catalogue-no-password',PGSYSCONFDIR:'/dev/null',GIT_NO_LAZY_FETCH:'1'}
}
const ciIdentity=env=>({repository:env.GITHUB_REPOSITORY,workflow:env.GITHUB_WORKFLOW,workflowRef:env.GITHUB_WORKFLOW_REF,job:env.GITHUB_JOB,
 event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,eventSha:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,
 headRef:env.CATALOGUE_CI_HEAD_REF,baseRef:env.CATALOGUE_CI_BASE_REF})
export function catalogueCiIdentity(env,source,observed,runIdentity) {
 catalogueCiConnection(env,source)
 assert.match(runIdentity??'',/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/,'Run identity required')
 assert.equal(observed.database,'pilot_test');assert.equal(observed.operator,'postgres');assert.equal(observed.database_owner,'postgres')
 assert.ok(privateIPv4(observed.server_address),'Private Docker service IPv4 required')
 assert.equal(observed.server_port,5432);assert.match(observed.server_version_num??'',/^17[0-9]{4}$/)
 assert.match(observed.system_identifier??'',/^[1-9][0-9]*$/)
 return {profile,source,ci:ciIdentity(env),runIdentity,serverAddress:observed.server_address,serverPort:5432,serverVersion:observed.server_version_num,systemIdentifier:observed.system_identifier}
}
export const catalogueObservationSql=database=> {
 assert.ok(['pilot_test','pilot_catalogue_test'].includes(database),'Unknown fixed fixture target')
 const marker=database==='pilot_test'?'pilot_fixture_marker':'catalogue_fixture_identity_v1'
 return `-- CATALOGUE_FIXTURE_OBSERVATION
SELECT jsonb_build_object('database',current_database(),'operator',current_user,
 'database_owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
 'system_identifier',(SELECT system_identifier::text FROM pg_control_system()),
 'server_version_num',current_setting('server_version_num'),
 'server_address',host(inet_server_addr()),'server_port',inet_server_port(),
 'marker',(SELECT jsonb_build_object('kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),
 'rows',(SELECT jsonb_agg(to_jsonb(m)) FROM public.${marker} m))
 FROM pg_class c WHERE c.oid='public.${marker}'::regclass));`
}
export const catalogueCiServerObservationSql=`-- CATALOGUE_CI_SERVER_OBSERVATION
SELECT jsonb_build_object('database',current_database(),'operator',current_user,
 'database_owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
 'system_identifier',(SELECT system_identifier::text FROM pg_control_system()),
 'server_version_num',current_setting('server_version_num'),
 'server_address',host(inet_server_addr()),'server_port',inet_server_port());`
function serverPredicate(identity,database) {
 assert.ok(['pilot_test','pilot_catalogue_test'].includes(database),'Unknown fixed fixture target')
 assert.equal(identity.profile,profile);assert.equal(identity.source?.clean,true)
 assert.ok(privateIPv4(identity.serverAddress));assert.equal(identity.serverPort,5432)
 assert.match(identity.serverVersion??'',/^17[0-9]{4}$/);assert.match(identity.systemIdentifier??'',/^[1-9][0-9]*$/)
 return `current_database()='${database}' AND current_user='postgres'
 AND inet_server_addr()=${quote(identity.serverAddress)}::inet AND inet_server_port()=5432
 AND current_setting('server_version_num')=${quote(identity.serverVersion)}
 AND (SELECT system_identifier::text=${quote(identity.systemIdentifier)} FROM pg_control_system())
 AND (SELECT pg_get_userbyid(datdba)='postgres' FROM pg_database WHERE datname=current_database())`
}
const gate=predicate=>`SELECT ${predicate} AS catalogue_ci_identity_ok
\\gset
\\if :catalogue_ci_identity_ok
\\else
SELECT 1/0 AS catalogue_identity_refused;
\\endif
`
export function catalogueCiIdentityGateSql(identity,database='pilot_catalogue_test') {
 const marker=database==='pilot_test'?'catalogue_ci_root_identity_v1':'catalogue_fixture_identity_v1'
 const purpose=database==='pilot_test'?'disposable-catalogue-root-ci-v1':'disposable-catalogue-ci-v1'
 return gate(`${serverPredicate(identity,database)}
 AND (SELECT relkind='r' AND relowner='postgres'::regrole FROM pg_class WHERE oid='public.${marker}'::regclass)
 AND (SELECT count(*)=1 AND bool_and(singleton AND purpose='${purpose}' AND identity=${quote(JSON.stringify(identity))}::jsonb) FROM public.${marker})${database==='pilot_test'?`
 AND (SELECT relkind='r' AND relowner='postgres'::regrole FROM pg_class WHERE oid='public.pilot_fixture_marker'::regclass)
 AND (SELECT count(*)=1 AND bool_and(purpose='disposable-pilot-ci') FROM public.pilot_fixture_marker)`:''}`)
}
const emptyPredicate=`NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private','auth','storage') AND c.relkind IN ('r','p','v','m','f','S'))
 AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('private','auth','storage'))
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','auth','storage'))`
function createMarker(identity,marker,purpose) {
 return `CREATE TABLE public.${marker}(singleton boolean PRIMARY KEY CHECK(singleton),purpose text NOT NULL CHECK(purpose='${purpose}'),identity jsonb NOT NULL);
REVOKE ALL ON public.${marker} FROM PUBLIC;
INSERT INTO public.${marker} VALUES(true,'${purpose}',${quote(JSON.stringify(identity))}::jsonb);
`
}
export function catalogueCiRootBootstrapSql(identity) {
 return `-- CATALOGUE_CI_FRESH_ROOT: no reuse/reset
${gate(`${serverPredicate(identity,'pilot_test')} AND ${emptyPredicate}
 AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='pilot_catalogue_test')`)}BEGIN;
CREATE TABLE public.pilot_fixture_marker(purpose text PRIMARY KEY CHECK(purpose='disposable-pilot-ci'));
REVOKE ALL ON public.pilot_fixture_marker FROM PUBLIC;
INSERT INTO public.pilot_fixture_marker VALUES('disposable-pilot-ci');
${createMarker(identity,'catalogue_ci_root_identity_v1','disposable-catalogue-root-ci-v1')}COMMIT;
`
}
export function catalogueCiBootstrapSql(identity) {
 return `-- CATALOGUE_CI_FRESH_CHILD: no reuse/reset
${gate(`${serverPredicate(identity,'pilot_catalogue_test')} AND ${emptyPredicate}`)}BEGIN;
${createMarker(identity,'catalogue_fixture_identity_v1','disposable-catalogue-ci-v1')}COMMIT;
`
}
export function verifyCatalogueCiObservation(observed,identity,database) {
 assert.equal(observed.database,database);assert.equal(observed.operator,'postgres');assert.equal(observed.database_owner,'postgres')
 assert.deepEqual({address:observed.server_address,port:observed.server_port,version:observed.server_version_num,system:observed.system_identifier},
  {address:identity.serverAddress,port:identity.serverPort,version:identity.serverVersion,system:identity.systemIdentifier},'CI service identity drift')
 const rows=database==='pilot_test'?[{purpose:'disposable-pilot-ci'}]:[{singleton:true,purpose:'disposable-catalogue-ci-v1',identity}]
 assert.deepEqual(observed.marker,{kind:'r',owner:'postgres',rows},'CI fixture marker drift')
}

export function catalogueCiRefusalProbeSql(identity) {
 return `-- CATALOGUE_CI_REAL_REFUSAL_PROBE
${gate(`${serverPredicate(identity,'pilot_test')} AND false`)}SELECT 'CATALOGUE_GATE_PROBE_UNSAFE';
`
}
