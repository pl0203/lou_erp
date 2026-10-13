// Disposable fixtures only. No credentials or targets are inferred from ambient libpq defaults.
import { isIP } from 'node:net'
const literal=value=>`'${String(value).replaceAll("'","''")}'`
function verifyCiContext(ci) {
 if(ci?.actions!=='true'||ci.enabled!=='true'||ci.repository!=='pl0203/lou_erp'||ci.workflow!=='Pilot safety checks'
 ||!/^[a-f0-9]{40}$/.test(ci.eventSha??'')||ci.job!=='synthetic-safety'||!/^\d+$/.test(ci.runId??'')||!/^[a-f0-9]{40}$/.test(ci.sourceSha??'')) throw new Error('Exact disposable repository CI context and source identity required')
}
function privateServiceAddress(address) {
 if(address==='::1') return true
 if(isIP(address)!==4) return false
 const [a,b]=address.split('.').map(Number)
 return a===127||a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)
}
export function verifyDemoFixtureTarget(target) {
 if(target?.database!=='demo_rollout_test'||target.operator!=='postgres') throw new Error('Separate disposable demo_rollout_test / postgres fixture required')
 if(target.kind==='fixture-ci') {
  if(target.host!=='127.0.0.1'||target.port!==5432||target.permit!=='disposable-demo-rollout-ci') throw new Error('Fixed repository-CI loopback service required')
  verifyCiContext(target.ci)
 } else if(target.kind!=='fixture'||!['127.0.0.1','::1'].includes(target.host)
 ||!Number.isInteger(target.port)||target.port<1024||target.port>65535||target.port===5432||target.permit!=='disposable-demo-rollout') {
  throw new Error('Explicit non-default-port loopback disposable-demo-rollout fixture required')
 }
}
export function demoFixtureConnection(input,checkoutSha) {
 for(const key of ['PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGOPTIONS','PGPASSFILE','PGSSLMODE','PGSSLCERT','PGSSLKEY','PGSSLROOTCERT','PGSSLCRL','DATABASE_URL']) {
  if(input[key]) throw new Error(`Inherited connection override forbidden: ${key}`)
 }
 const isCi=input.DEMO_ROLLOUT_PERMIT==='disposable-demo-rollout-ci'
 const target={kind:isCi?'fixture-ci':'fixture',host:input.PGHOST,port:Number(input.PGPORT),database:input.PGDATABASE,operator:input.PGUSER,permit:input.DEMO_ROLLOUT_PERMIT}
 if(isCi) target.ci={actions:input.GITHUB_ACTIONS,enabled:input.CI,repository:input.GITHUB_REPOSITORY,workflow:input.GITHUB_WORKFLOW,job:input.GITHUB_JOB,runId:input.GITHUB_RUN_ID,eventSha:input.GITHUB_SHA,sourceSha:input.DEMO_ROLLOUT_SOURCE_SHA}
 verifyDemoFixtureTarget(target)
 if(isCi&&(!/^[a-f0-9]{40}$/.test(checkoutSha??'')||checkoutSha!==target.ci.sourceSha)) throw new Error('Explicit source SHA must match the verified checkout HEAD')
 if(isCi?input.PGPASSWORD!=='synthetic-ci-only':!!input.PGPASSWORD) throw new Error('Only the exact synthetic CI password is permitted, and only in repository CI')
 const env={PATH:input.PATH,LD_LIBRARY_PATH:input.LD_LIBRARY_PATH,PGHOST:target.host,PGPORT:String(target.port),PGDATABASE:target.database,PGUSER:target.operator,PGCONNECT_TIMEOUT:'5',PGPASSFILE:'/dev/null',PGSSLMODE:'disable'}
 if(isCi) env.PGPASSWORD='synthetic-ci-only'
 return {target,env}
}
// Read through the already validated CI connection, using the fixed existing pilot_test DB.
export const DEMO_CI_IDENTITY_SQL=`SELECT jsonb_build_object('database',current_database(),'operator',current_user,
 'marker',(SELECT count(*)=1 AND bool_and(purpose='disposable-pilot-ci') FROM public.pilot_fixture_marker),
 'server_address',host(inet_server_addr()),'server_port',inet_server_port(),'server_major',current_setting('server_version_num')::integer/10000);`
export function bindDemoCiServer(target,observed) {
 verifyDemoFixtureTarget(target)
 if(target.kind!=='fixture-ci'||observed?.database!=='pilot_test'||observed.operator!=='postgres'||observed.marker!==true
 ||observed.server_major!==17||observed.server_port!==5432||!privateServiceAddress(observed.server_address)) throw new Error('Verified existing disposable PostgreSQL 17 CI fixture identity required')
 return {...target,serverAddress:observed.server_address,serverPort:observed.server_port,identity:'disposable-pilot-ci'}
}
export function fixtureServerGuard(target) {
 verifyDemoFixtureTarget(target)
 let sql
 if(target.kind==='fixture-ci') {
  if(target.identity!=='disposable-pilot-ci'||target.serverPort!==5432||!privateServiceAddress(target.serverAddress)) throw new Error('CI server identity must be bound before packet generation')
  sql=`IF inet_server_addr() IS NULL OR inet_server_addr()<>${literal(target.serverAddress)}::inet OR inet_server_port()<>5432 OR current_setting('server_version_num')::integer/10000<>17 THEN RAISE EXCEPTION 'Pinned disposable CI server identity changed'; END IF;\n`
 } else sql=`IF inet_server_addr() IS NULL OR inet_server_addr() NOT IN('127.0.0.1'::inet,'::1'::inet) OR inet_server_port()<>${target.port} THEN RAISE EXCEPTION 'Loopback fixture server required'; END IF;\n`
 return sql+`IF NOT EXISTS(SELECT 1 FROM public.demo_rollout_fixture_marker WHERE purpose='disposable-demo-rollout'${target.kind==='fixture-ci'?` AND run_id=${literal(target.ci.runId)} AND source_sha=${literal(target.ci.sourceSha)}`:''}) OR (SELECT count(*) FROM public.demo_rollout_fixture_marker)<>1 THEN RAISE EXCEPTION 'Disposable fixture marker required'; END IF;\n`
}
