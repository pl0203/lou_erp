import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { catalogueCiEventIdentity } from '../../../scripts/catalogue-ci-profile.mjs';
export const literal = x => `'${String(x).replaceAll("'", "''")}'`;
const privateAddress = s => { if (isIP(s ?? '') !== 4) return false; const [a,b] = s.split('.').map(Number); return a===127 || a===10 || (a===172 && b>=16 && b<=31) || (a===192 && b===168); };
export function validateBinding(b) {
 assert.equal(b?.format,'synthetic-failfast-binding-v1');
 assert.equal(b.approval,'REVIEWED_FOR_THIS_RUN','Runtime authorization/binding is pending');
 assert.equal(b.scope,'generic-synthetic-only');
 const i=b.identity; assert.equal(i?.profile,'github-catalogue-baseline-v1'); assert.equal(i.source?.clean,true);
 for(const key of ['commit','tree']) assert.match(i.source[key]??'',/^[a-f0-9]{40}$/);
 assert.match(i.source.candidate??'',/^[a-f0-9]{64}$/);
 assert.match(i.runIdentity??'',/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
 assert.equal(i.serverPort,5432); assert.ok(privateAddress(i.serverAddress)); assert.match(i.serverVersion??'',/^17[0-9]{4}$/); assert.match(i.systemIdentifier??'',/^[1-9][0-9]*$/);
 assert.ok(i.ci && Object.keys(b.files??{}).length>0);
 for(const [name,digest] of Object.entries(b.files)) {assert.match(name,/^[a-z0-9.-]+$/);assert.match(digest,/^[a-f0-9]{64}$/);}
 return b;
}
export function connectionFor(e,b) {
 validateBinding(b); const i=b.identity,c=i.ci;
 const fixed={CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'Pilot safety checks',GITHUB_JOB:'catalogue-baseline',CATALOGUE_CI_PROFILE:i.profile,CATALOGUE_CI_SOURCE_SHA:i.source.commit,CATALOGUE_CI_CANDIDATE_SHA256:i.source.candidate,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only',GITHUB_REF:c.ref,GITHUB_SHA:c.eventSha,GITHUB_WORKFLOW_REF:c.workflowRef,GITHUB_RUN_ID:c.runId,GITHUB_RUN_ATTEMPT:c.runAttempt};
 for(const [k,v] of Object.entries(fixed))assert.equal(e[k],v,`Exact reviewed context required: ${k}`);
 // The captured identity and current environment must describe the same exact
 // authorized event; release pushes/dispatches must never masquerade as PRs.
 assert.deepEqual(c,catalogueCiEventIdentity(e,i.source));
 const accepted=['PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGCONNECT_TIMEOUT','PGTZ'];
 for(const k of Object.keys(e))assert.ok(!k.startsWith('PG')||accepted.includes(k),`Ambient libpq option refused: ${k}`);
 for(const k of ['DATABASE_URL','SUPABASE_DB_URL','SUPABASE_DB_PASSWORD','LD_PRELOAD','LD_LIBRARY_PATH','NODE_OPTIONS','NODE_PATH','DYLD_LIBRARY_PATH','DYLD_INSERT_LIBRARIES'])assert.equal(e[k],undefined,`Ambient runtime option refused: ${k}`);
 return {PATH:e.PATH,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_catalogue_test',PGPASSWORD:'synthetic-ci-only',PGCONNECT_TIMEOUT:'5',PGTZ:'UTC',PGPASSFILE:'/dev/null/failfast-no-password',PGSYSCONFDIR:'/dev/null',LC_ALL:'C'};
}
export function identityGate(b) {
 validateBinding(b); const i=b.identity;
 return `\\set ON_ERROR_STOP on
SELECT current_database()='pilot_catalogue_test' AND current_user='postgres'
 AND inet_server_addr()=${literal(i.serverAddress)}::inet AND inet_server_port()=5432
 AND current_setting('server_version_num')=${literal(i.serverVersion)}
 AND (SELECT system_identifier::text=${literal(i.systemIdentifier)} FROM pg_control_system())
 AND (SELECT pg_get_userbyid(datdba)='postgres' FROM pg_database WHERE datname=current_database())
 AND (SELECT relkind='r' AND relowner='postgres'::regrole FROM pg_class WHERE oid='public.catalogue_fixture_identity_v1'::regclass)
 AND (SELECT count(*)=1 AND bool_and(singleton AND purpose='disposable-catalogue-ci-v1' AND identity=${literal(JSON.stringify(i))}::jsonb) FROM public.catalogue_fixture_identity_v1)
 AS ff_identity_ok
\\gset
\\if :ff_identity_ok
\\else
SELECT 1/0 AS failfast_identity_refused;
\\endif
`;
}
export const observationSql = `SELECT jsonb_build_object('database',current_database(),'operator',current_user,'database_owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),'system_identifier',(SELECT system_identifier::text FROM pg_control_system()),'server_version_num',current_setting('server_version_num'),'server_address',host(inet_server_addr()),'server_port',inet_server_port(),'marker',(SELECT jsonb_build_object('kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'rows',(SELECT jsonb_agg(to_jsonb(m)) FROM public.catalogue_fixture_identity_v1 m)) FROM pg_class c WHERE c.oid='public.catalogue_fixture_identity_v1'::regclass));`;
export function verifyObservation(o,b) {
 validateBinding(b); const i=b.identity;
 assert.deepEqual(o,{database:'pilot_catalogue_test',operator:'postgres',database_owner:'postgres',server_address:i.serverAddress,server_port:5432,server_version_num:i.serverVersion,system_identifier:i.systemIdentifier,marker:{kind:'r',owner:'postgres',rows:[{singleton:true,purpose:'disposable-catalogue-ci-v1',identity:i}]}});
}
export class ResultFramer {
 constructor(token,limit=4*1024*1024){assert.match(token,/^[a-zA-Z0-9_]+$/);this.token=token;this.limit=limit;this.buffer='';this.done=false;}
 feed(chunk){assert.equal(this.done,false,'Frame already completed');this.buffer+=chunk;assert.ok(Buffer.byteLength(this.buffer)<=this.limit,'Output bound exceeded');const marker=`__FF_END_${this.token}__ `;const lines=this.buffer.split('\n');for(let n=0;n<lines.length-1;n++){if(!lines[n].startsWith(marker))continue;const sqlstate=lines[n].slice(marker.length).trim();assert.match(sqlstate,/^[0-9A-Z]{5}$/);assert.equal(n,lines.length-2,'Unexpected data after frame');assert.equal(lines.at(-1),'','Unexpected partial data after frame');this.done=true;return {stdout:lines.slice(0,n).join('\n')+(n?'\n':''),sqlstate};}return null;}
}
export const isBlockedBy=(o,pid)=>o?.blockers?.includes(pid) && o.wait_event_type==='Lock' && o.locks?.some(x=>x.granted===false && ['transactionid','tuple','relation','advisory'].includes(x.locktype)) || false;
export function verifyGateRefusal(error) {
 assert.ok(error,'False gate unexpectedly succeeded');
 assert.equal(error.status,3,'Expected psql script-error exit 3');
 assert.equal(error.signal,null,'Signal is not evidence of gate refusal');
 assert.equal(error.code,undefined,'Infrastructure error is not gate refusal');
 assert.match(String(error.stderr??''),/ERROR:\s+22012:\s+division by zero/,'Exact intended SQLSTATE required');
 assert.ok(!String(error.stdout??'').includes('UNSAFE_GATE_CONTINUED'),'Gate sentinel unexpectedly executed');
}

