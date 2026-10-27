// Real sessions in the runner's fresh PostgreSQL17 fixture only. No timing-only evidence.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { coWorkspaceConnection, coSourceIdentity, coBindFixtureServer, CO_FIXTURE_OBSERVATION_SQL, coVerifyFixtureIdentitySql } from '../../../scripts/co-fixture-target.mjs'
assert.equal(process.argv.length, 2, 'No race target or arbitrary arguments accepted')
const input = { ...process.env }
for (const [key, value] of [['PGPASSFILE','/dev/null/co-ci-no-password'],['PGSYSCONFDIR','/dev/null']]) {
  assert.equal(input[key], value, 'Runner-only sanitized connection required'); delete input[key]
}
const source = coSourceIdentity()
const guarded = coWorkspaceConnection(input, source)
const expectedIdentity = JSON.parse(input.CO_FIXTURE_IDENTITY ?? 'null')
assert.ok(expectedIdentity, 'Runner source/run/server binding required')
assert.deepEqual(expectedIdentity.source, source, 'Race source must independently equal checked-out source')
const fixtureProfile = { kind: input.CO_CI_PROFILE ? 'ci' : 'local', source, runIdentity: input.CO_CI_PROFILE ? `${input.GITHUB_RUN_ID}:${input.GITHUB_RUN_ATTEMPT}` : expectedIdentity.runIdentity, database: 'pilot_co_test' }
const env = { ...guarded, PGDATABASE:'pilot_co_test' }
const sessions = new Map()
let serial = 0
const quote = x => `'${String(x).replaceAll("'", "''")}'`
const json = x => `${quote(JSON.stringify(x))}::jsonb`
const uid = n => `md5('co-user-${n}')::uuid`
const auth = (n=1) => `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${uid(n)}::text,true);`
const rpc = (operation,payload,request=randomUUID()) => `SELECT public.pilot_co_transaction_v1(${quote(request)}::uuid,${quote(operation)},${json(payload)})`
const txn = (body,n=1) => `BEGIN; ${auth(n)} ${body}; COMMIT;`
// Owner-only synthetic helpers prepare inputs; competing RPC sessions still use authenticated.
const fixtureTxn = body => `BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); ${body}; COMMIT;`
function start(body, interactive=false) {
  const name=`co-return-race-${process.pid}-${++serial}`
  const child=spawn('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{env:{...env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']})
  let stdout='',stderr='',pid=null,closed=false,resolveReady,rejectReady
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject});ready.catch(()=>{})
  child.stdout.on('data',chunk=>{stdout+=chunk;const m=stdout.match(/CO_PID:(\d+)/);if(m)pid=Number(m[1]);if(stdout.includes('CO_GATE_READY'))resolveReady()})
  child.stderr.on('data',chunk=>stderr+=chunk)
  const result=new Promise(resolve=>{
    child.on('error',error=>{rejectReady(error);resolve({code:-1,stdout,stderr:String(error)})})
    child.on('close',code=>{closed=true;sessions.delete(child);if(!stdout.includes('CO_GATE_READY'))rejectReady(new Error(stderr||'Exited before gate'));resolve({code,stdout,stderr})})
  })
  const session={child,name,ready,result,get pid(){return pid},get closed(){return closed}}
  sessions.set(child,session);child.stdin.on('error',()=>{})
  const setup="SET statement_timeout='25s'; SET lock_timeout='20s'; SET idle_in_transaction_session_timeout='30s'; SELECT 'CO_PID:'||pg_backend_pid();\n"
  if(interactive)child.stdin.write(setup+body+'\n\\echo CO_GATE_READY\n');else child.stdin.end(setup+body+'\n')
  return session
}
function success(r){assert.equal(r.code,0,r.stderr||r.stdout);return r.stdout.split('\n').filter(l=>l&&!l.startsWith('CO_PID:')&&l!=='CO_GATE_READY').join('\n')}
async function sql(body){return success(await start(body).result)}
function resultJson(r){success(r);const line=r.stdout.split('\n').findLast(l=>l.startsWith('{'));assert.ok(line,r.stdout);return JSON.parse(line)}
async function gate(body){const s=start('BEGIN; '+body+';',true);await Promise.race([s.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Gate readiness timeout')),15000))]);assert.ok(s.pid);return s}
async function release(s){s.child.stdin.end('COMMIT;\n');return await s.result}
async function observed(winner,contender,label,lockTypes){
 const until=Date.now()+15000;let last
 while(Date.now()<until){
  assert.equal(contender.closed,false,`${label}: contender finished without an observed barrier`)
  if(contender.pid){
   const raw=await sql(`SELECT json_build_object('pid',a.pid,'blockers',pg_blocking_pids(a.pid),'wait_type',a.wait_event_type,'wait_event',a.wait_event,'query',a.query,'locks',(SELECT coalesce(json_agg(json_build_object('type',locktype,'relation',relation::regclass::text,'transaction',transactionid::text,'classid',classid,'objid',objid,'objsubid',objsubid)),'[]') FROM pg_locks WHERE pid=a.pid AND NOT granted)) FROM pg_stat_activity a WHERE a.pid=${contender.pid} AND a.application_name=${quote(contender.name)};`)
   if(raw){last=JSON.parse(raw);if(last.wait_type==='Lock'&&last.blockers.includes(winner.pid)&&last.locks.some(l=>lockTypes.includes(l.type))){
    if(lockTypes.includes('advisory')){
     assert.equal(await sql(`SELECT EXISTS(SELECT 1 FROM pg_locks waiting JOIN pg_locks held USING(locktype,database,classid,objid,objsubid) WHERE waiting.pid=${contender.pid} AND held.pid=${winner.pid} AND waiting.locktype='advisory' AND NOT waiting.granted AND held.granted);`),'t','same actor/request advisory identity')
    }
    console.log('CO_OBSERVED_BARRIER '+JSON.stringify({label,winner:winner.pid,contender:contender.pid,wait:last.wait_event,locks:last.locks}));return
   }}
  }
  await new Promise(resolve=>setTimeout(resolve,25))
 }
 throw new Error(`${label}: expected exact PID/blocker barrier; last=${JSON.stringify(last)}`)
}
async function fails(body,state){const r=await start(body).result;assert.notEqual(r.code,0);assert.match(r.stderr,new RegExp(`ERROR:\\s+${state}:`));return r}
const create=(p,request)=>`SELECT public.pilot_co_return_create_v1(${quote(request)}::uuid,${json(p)})`
const setup=async label=>resultJson(await start(fixtureTxn(`SELECT co_test.return_race_setup(${quote(label)})`)).result)
try {
 coBindFixtureServer(fixtureProfile,JSON.parse(await sql(CO_FIXTURE_OBSERVATION_SQL)),expectedIdentity)
 assert.equal(await sql(coVerifyFixtureIdentitySql(expectedIdentity)),'t','exact return source/run/server binding')
 const base=readFileSync(new URL('./import-posting.sql',import.meta.url),'utf8').split('-- IMPORT_POSTING_HELPERS_END')[0]
 await sql(base+'COMMIT;')
 const helpers=readFileSync(new URL('./return-workspace.sql',import.meta.url),'utf8').split('DO $create_retry$')[0]
 await sql('BEGIN;'+helpers+`CREATE FUNCTION co_test.return_race_setup(label text) RETURNS jsonb LANGUAGE plpgsql AS $$
 DECLARE c uuid;day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;BEGIN
 c:=co_test.monthly_customer(label);PERFORM co_test.monthly_delivery(c,'RW-RACE-'||label,'RW-RACE',5,'10.00',day);PERFORM co_test.return_units(c);
 RETURN co_test.return_input(c,day,4);END $$; COMMIT;`)
 let p=await setup('return-race-retry'),request=randomUUID()
 const first=await gate(auth()+create(p,request)),retry=start(txn(create(p,request)))
 await observed(first,retry,'return exact UUID retry',['advisory'])
 const original=resultJson(await release(first)),repeated=resultJson(await retry.result)
 assert.deepEqual(repeated,original)
 assert.equal(await sql(`SELECT count(*) FROM private.co_return_heads WHERE customer_id=${quote(p.customer_id)}::uuid`),'1')
 assert.equal(await sql(`SELECT count(*) FROM private.co_return_workspace_requests WHERE actor_id=${uid(1)} AND request_id=${quote(request)}::uuid`),'1')
 await fails(txn(create({...p,reason:'different'},request)),'PT409')
 // Distinct authorized operators compete for the same stock snapshot. Exactly one records.
 p=await setup('return-race-stock');request=randomUUID()
 const winner=await gate(auth()+create(p,request)),other=start(txn(create(p,randomUUID()),2))
 await observed(winner,other,'return simultaneous stock consumption',['transactionid','tuple'])
 success(await release(winner));assert.match((await other.result).stderr,/ERROR:\s+PT409:/)
 assert.equal(await sql(`SELECT count(*) FROM private.co_return_heads WHERE customer_id=${quote(p.customer_id)}::uuid`),'1')
 assert.equal(await sql(`SELECT sum(m.quantity_delta)::text FROM private.co_stock_movements m JOIN private.co_customer_state s ON s.customer_id=m.customer_id AND s.effective_generation_id=m.generation_id WHERE m.customer_id=${quote(p.customer_id)}::uuid`),'1')
 // Commit response deliberately not consumed by the client; recovery binds canonical receipt.
 p=await setup('return-race-uncertain');request=randomUUID()
 success(await start(txn(create(p,request))).result)
 const recovered=resultJson(await start(txn(`SELECT public.pilot_co_return_create_result_v1(${quote(request)}::uuid)`)).result)
 assert.equal(recovered.status,'committed')
 assert.deepEqual(resultJson(await start(txn(create(p,request))).result),recovered.result)
 coBindFixtureServer(fixtureProfile,JSON.parse(await sql(CO_FIXTURE_OBSERVATION_SQL)),expectedIdentity)
 assert.equal(await sql(coVerifyFixtureIdentitySql(expectedIdentity)),'t')
 console.log('CO_RETURN_WORKSPACE_REAL_RACES_PASSED')
} finally {
 for(const {child} of sessions.values()){child.stdin.end('ROLLBACK;\n');child.kill('SIGTERM')}
}
