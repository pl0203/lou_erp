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
function start(body, interactive=false) {
  const name=`co-race-${process.pid}-${++serial}`
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
const commit = p => `SELECT public.pilot_co_import_commit_v1(${quote(p.requestId)}::uuid,${json(p)})`
const setup = async label => resultJson(await start(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); SELECT co_test.import_setup(${quote(label)}); COMMIT;`).result)
const payload = async binding => resultJson(await start(txn(`SELECT co_test.import_post_payload(${json(binding)})`)).result)
try {
 coBindFixtureServer(fixtureProfile,JSON.parse(await sql(CO_FIXTURE_OBSERVATION_SQL)),expectedIdentity)
 assert.equal(await sql(coVerifyFixtureIdentitySql(expectedIdentity)),'t','exact import source/run/server required')
 const helpers=readFileSync(new URL('./import-posting.sql',import.meta.url),'utf8').split('-- IMPORT_POSTING_HELPERS_END')[0]
 await sql(helpers+'COMMIT;')
 // Same actor/request: second session is observed waiting on exact advisory key.
 let state=await setup('import-race-retry'), p=await payload(state.binding)
 const first=await gate(auth()+commit(p)), retry=start(txn(commit(p)))
 await observed(first,retry,'import exact UUID double click',['advisory'])
 const original=resultJson(await release(first)), repeated=resultJson(await retry.result)
 assert.deepEqual(repeated,original)
 await fails(txn(commit({...p,reason:'changed outer payload'})),'22023')
 await fails(txn(`SELECT public.pilot_reconcile_co_v1(${quote(p.requestId)}::uuid,false)`),'22023')
 assert.equal(await sql(`SELECT count(*) FROM private.co_report_heads WHERE customer_id=${quote(state.customerId)}::uuid`),'1')
 // Distinct operators and UUIDs serialize on the customer; only one publishes.
 state=await setup('import-race-operators');p=await payload(state.binding)
 const winner=await gate(auth()+commit(p)), other=start(txn(commit({...p,requestId:randomUUID()}),2))
 await observed(winner,other,'import concurrent operators one head',['transactionid','tuple'])
 success(await release(winner)); assert.match((await other.result).stderr,/ERROR:\s+PT409:/)
 assert.equal(await sql(`SELECT count(*) FROM private.co_report_heads WHERE customer_id=${quote(state.customerId)}::uuid`),'1')
 // Review-open supersession is also version/predecessor bound; loser cannot erase origin.
 const reviewPayload=resultJson(await start(txn(`SELECT co_test.import_review_payload(${quote(state.draftId)}::uuid)`)).result)
 const reviewCall=req=>`SELECT public.pilot_co_import_review_v1(${quote(req)}::uuid,${json(reviewPayload)})`
 const reviewWinner=await gate(auth()+reviewCall(randomUUID())), reviewOther=start(txn(reviewCall(randomUUID()),2))
 await observed(reviewWinner,reviewOther,'concurrent review predecessor',['transactionid','tuple'])
 success(await release(reviewWinner));assert.match((await reviewOther.result).stderr,/ERROR:\s+PT409:/)
 assert.equal(await sql(`SELECT count(*) FROM private.co_draft_import_origins WHERE draft_id=${quote(state.draftId)}::uuid`),'1')
 // SHARE preview prevents a late delivery from racing its snapshot, then invalidates it.
 state=await setup('import-race-delivery');p=await payload(state.binding)
 const reader=await gate(auth()+`SELECT public.pilot_co_import_preview_v1(${quote(state.binding.importId)}::uuid,'1')`)
 const delivery=start(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); SELECT co_test.monthly_delivery(${quote(state.customerId)}::uuid,'IMPORT-LATE','SYNTHETIC',1,'200',${quote(state.month)}::date+2); COMMIT;`)
 await observed(reader,delivery,'import preview late delivery',['transactionid','tuple'])
 success(await release(reader));success(await delivery.result)
 await fails(txn(commit(p)),'PT409')
 assert.equal(await sql(`SELECT count(*) FROM private.co_report_heads WHERE customer_id=${quote(state.customerId)}::uuid`),'0')
 // A locked absent-request abandon wins against a late request using the same UUID.
 state=await setup('import-race-tombstone');p=await payload(state.binding)
 const abandon=await gate(auth()+`SELECT public.pilot_co_import_reconcile_v1(${quote(p.requestId)}::uuid,true)`), late=start(txn(commit(p)))
 await observed(abandon,late,'import abandonment late execution',['advisory'])
 success(await release(abandon));assert.match((await late.result).stderr,/ERROR:\s+55000:/)
 assert.equal(await sql(`SELECT count(*) FROM private.co_import_post_requests WHERE request_id=${quote(p.requestId)}::uuid`),'0')
 console.log('CO_IMPORT_REAL_RACES_PASSED')
} finally {
 for (const child of sessions.keys()) { child.stdin.destroy();child.kill('SIGTERM') }
}
