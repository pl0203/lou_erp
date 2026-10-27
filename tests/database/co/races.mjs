// Real sessions in the runner's fresh PostgreSQL17 fixture only. No timing-only evidence.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { coCiConnection, coSourceIdentity, coBindFixtureServer, CO_FIXTURE_OBSERVATION_SQL, coVerifyFixtureIdentitySql } from '../../../scripts/co-fixture-target.mjs'
assert.equal(process.argv.length, 2, 'No race target or arbitrary arguments accepted')
const input = { ...process.env }
for (const [key, value] of [['PGPASSFILE','/dev/null/co-ci-no-password'],['PGSYSCONFDIR','/dev/null']]) {
  assert.equal(input[key], value, 'Runner-only sanitized connection required'); delete input[key]
}
const source = coSourceIdentity()
const guarded = coCiConnection(input, source)
const expectedIdentity = JSON.parse(input.CO_FIXTURE_IDENTITY ?? 'null')
assert.ok(expectedIdentity, 'Runner source/run/server binding required')
assert.deepEqual(expectedIdentity.source, source, 'Race source must independently equal checked-out source')
const fixtureProfile = { kind: input.CO_CI_PROFILE ? 'ci' : 'local', source, runIdentity: input.CO_CI_PROFILE ? `${input.GITHUB_RUN_ID}:${input.GITHUB_RUN_ATTEMPT}` : expectedIdentity.runIdentity, database: 'pilot_co_race_test' }
const env = { ...guarded, PGDATABASE:'pilot_co_race_test' }
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
try {
 coBindFixtureServer(fixtureProfile,JSON.parse(await sql(CO_FIXTURE_OBSERVATION_SQL)),expectedIdentity)
 assert.equal(await sql(coVerifyFixtureIdentitySql(expectedIdentity)),'t','exact fresh race fixture source/run/server required')
 const helpers=readFileSync(new URL('./corrections.sql',import.meta.url),'utf8').split('DO $downstream_correction$')[0]
 await sql(helpers+`CREATE TABLE co_test.race_state(c uuid,d uuid,payload jsonb); DO $$ DECLARE c uuid:=co_test.monthly_customer('race601'); m date:=(date_trunc('month',current_date)-interval '1 month')::date; lines jsonb; o uuid; r jsonb; d uuid; BEGIN
 SELECT jsonb_agg(jsonb_build_object('id',md5('co-race601-'||n)::uuid,'sku','RACE-'||n,'product_name','Race','ordered_quantity',2,'unit_price','1.00')) INTO lines FROM generate_series(1,601)n;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'create_co',jsonb_build_object('customer_id',c,'expected_customer_version','1','co_number','RACE601','order_date',m,'lines',lines));o:=(r->>'id')::uuid;
 SELECT jsonb_agg(jsonb_build_object('co_line_id',id,'quantity',2)) INTO lines FROM private.co_order_lines WHERE co_id=o;
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',o,'expected_co_version','1','expected_customer_version',r->>'customer_version','sj_number','RACE601','sj_date',m,'lines',lines));
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',jsonb_build_object('draft_id',r->>'id','expected_draft_version',r->>'version','expected_co_version','1','expected_customer_version',r->>'customer_version'));
 d:=co_test.report_init(c,m);PERFORM co_test.report_zero(d); PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'save_report_draft',co_test.report_input(d)||jsonb_build_object('action','upsert_lines','lines',jsonb_build_array(jsonb_build_object('stock_key_id',(SELECT stock_key_id FROM private.co_report_draft_lines WHERE draft_id=d ORDER BY stock_key_id LIMIT 1),'sold_quantity',1))));INSERT INTO co_test.race_state VALUES(c,d,co_test.report_input(d));END $$; COMMIT;`)
 let state=JSON.parse(await sql('SELECT row_to_json(r) FROM co_test.race_state r;'))
 let preview=resultJson(await start(txn(`SELECT public.pilot_co_preview_v1('post_report',${json(state.payload)})`)).result)
 const stalePost={...state.payload,preview_fingerprint:preview.preview_fingerprint}
 // Public preview holds SHARE through the transaction; a real SKU602 writer must wait.
 const reader=await gate(auth()+` SELECT public.pilot_co_preview_v1('post_report',${json(state.payload)})`)
 const writer=start(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); SELECT co_test.monthly_delivery(${quote(state.c)}::uuid,'RACE602','RACE-602',1,'1.00',(date_trunc('month',current_date)-interval '1 month')::date); COMMIT;`)
 await observed(reader,writer,'601-preview blocks SKU602 writer',['transactionid','tuple']);success(await release(reader));success(await writer.result)
 await fails(txn(rpc('post_report',stalePost)),'PT409')
 await sql(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); SELECT co_test.refresh_report(${quote(state.c)}::uuid,(date_trunc('month',current_date)-interval '1 month')::date); SELECT co_test.assert((SELECT count(*)=602 AND count(sold_quantity)=601 FROM private.co_report_draft_lines WHERE draft_id=${quote(state.d)}::uuid),'601 preserved plus null602'); SELECT co_test.report_zero(${quote(state.d)}::uuid); UPDATE co_test.race_state SET payload=co_test.report_input(d); COMMIT;`)
 state=JSON.parse(await sql('SELECT row_to_json(r) FROM co_test.race_state r;'));preview=resultJson(await start(txn(`SELECT public.pilot_co_preview_v1('post_report',${json(state.payload)})`)).result)
 const post={...state.payload,preview_fingerprint:preview.preview_fingerprint},request=randomUUID(),otherRequest=randomUUID()
 const first=await gate(auth()+rpc('post_report',post,request))
 const retry=start(txn(rpc('post_report',post,request)))
 await observed(first,retry,'identical report retry',['advisory'])
 const other=start(txn(rpc('post_report',post,otherRequest),2))
 await observed(first,other,'different actor stale customer post',['transactionid','tuple'])
 const committed=await release(first), retried=await retry.result, lost=await other.result
 assert.deepEqual(resultJson(retried),resultJson(committed));assert.notEqual(lost.code,0);assert.match(lost.stderr,/ERROR:\s+PT409:/)
 assert.equal(await sql(`SELECT count(*)=1 AND sum((SELECT count(*) FROM private.co_report_revision_lines l WHERE l.head_id=h.id))=602 FROM private.co_report_heads h WHERE customer_id=${quote(state.c)}::uuid;`),'t')
 assert.equal(await sql(`SELECT NOT EXISTS(SELECT 1 FROM private.co_commands WHERE request_id=${quote(otherRequest)}::uuid);`),'t')
 // Recovery can win before the delayed command starts, and owns the exact same request lock.
 const abandoned=randomUUID();const tombstone=await gate(auth()+`SELECT public.pilot_reconcile_co_v1(${quote(abandoned)}::uuid,true)`)
 const delayed=start(txn(rpc('post_report',post,abandoned)))
 await observed(tombstone,delayed,'abandonment fences delayed post',['advisory']);success(await release(tombstone));const refused=await delayed.result;assert.match(refused.stderr,/ERROR:\s+55000:/)
 assert.equal(await sql(`SELECT status='abandoned' AND receipt IS NULL FROM private.co_commands WHERE request_id=${quote(abandoned)}::uuid;`),'t')
 assert.equal(await sql(`SELECT count(*) FROM private.co_report_heads WHERE customer_id=${quote(state.c)}::uuid;`),'1')
 // A real return post also serializes its effective customer publication.
 const batch=await sql(`SELECT id FROM private.co_stock_batches WHERE customer_id=${quote(state.c)}::uuid ORDER BY id LIMIT 1;`)
 const retDraft=await sql(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); SELECT co_test.return_draft(${quote(state.c)}::uuid,${quote(batch)}::uuid,1,current_date); COMMIT;`)
 const did=retDraft.split('\n').at(-1);const returnInput=JSON.parse(await sql(`SELECT co_test.return_input(${quote(did)}::uuid);`));const readonly=await sql(`BEGIN READ ONLY; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); SELECT private.co_build_plan_v1(${quote(state.c)}::uuid,'post_return',${json(returnInput)})->>'can_post'; ROLLBACK;`);assert.equal(readonly.split('\n').at(-1),'true','reviewed planner executes without writes');const retPreview=resultJson(await start(txn(`SELECT public.pilot_co_preview_v1('post_return',${json(returnInput)})`)).result);const retPost={...returnInput,preview_fingerprint:retPreview.preview_fingerprint};const retRequest=randomUUID()
 const retFirst=await gate(auth()+rpc('post_return',retPost,retRequest));const retOther=start(txn(rpc('post_return',retPost),2));await observed(retFirst,retOther,'return publication customer conflict',['transactionid','tuple']);success(await release(retFirst));assert.match((await retOther.result).stderr,/ERROR:\s+PT409:/)
 assert.equal(await sql(`SELECT count(*) FROM private.co_return_heads WHERE customer_id=${quote(state.c)}::uuid;`),'1')
 const pendingRequest=randomUUID()
 await fails(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); SELECT private.co_command_begin_v1(${quote(pendingRequest)}::uuid,'close_co','{}'::jsonb); SET LOCAL ROLE authenticated; COMMIT;`,'55000')
 assert.equal(await sql(`SELECT NOT EXISTS(SELECT 1 FROM private.co_commands WHERE request_id=${quote(pendingRequest)}::uuid);`),'t','definer trigger still rejects pending command at API-role commit')
 // Current authority is checked before returning a previously committed receipt.
 const revoke=await gate(`UPDATE public.users SET is_active=false WHERE id=${uid(1)}`)
 const recovery=start(txn(`SELECT public.pilot_reconcile_co_v1(${quote(request)}::uuid,false)`));await observed(revoke,recovery,'revocation before recovery',['relation']);success(await release(revoke));assert.match((await recovery.result).stderr,/ERROR:\s+42501:/);await sql(`UPDATE public.users SET is_active=true WHERE id=${uid(1)};`)
 // Use existing synthetic principals; the cloned fixed race fixture isolates authentic owner audit events from the protected primary baseline.
 const ownerCustomer=await sql("SELECT co_test.monthly_customer('owner-race');")
 const makePayload=async suffix=>({customer_id:ownerCustomer,expected_customer_version:await sql(`SELECT coalesce((SELECT version::text FROM private.co_customer_state WHERE customer_id=${quote(ownerCustomer)}::uuid),'1');`),co_number:'RACE-OWNER-'+suffix,order_date:await sql('SELECT current_date;'),lines:[{id:randomUUID(),sku:'OWNER',product_name:'Owner',ordered_quantity:1,unit_price:'1.00'}]})
 const ownerCreate=await gate(auth()+rpc('create_co',await makePayload('first')))
 const assignment=start(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(2)}::text,true); SELECT public.pilot_assign_store_owner_v1(${quote(ownerCustomer)}::uuid,md5('owner-user-2')::uuid,NULL,NULL); COMMIT;`)
 await observed(ownerCreate,assignment,'CO creation before owner assignment',['relation']);const firstOwner=resultJson(await release(ownerCreate));success(await assignment.result)
 assert.equal(await sql(`SELECT sales_attribution_state FROM private.co_orders WHERE id=${quote(firstOwner.id)}::uuid;`),'unassigned')
 const assignmentFirst=await gate(`SELECT set_config('request.jwt.claim.sub',${uid(2)}::text,true); SELECT public.pilot_assign_store_owner_v1(${quote(ownerCustomer)}::uuid,md5('owner-user-3')::uuid,(SELECT id FROM public.customer_manager_assignments WHERE customer_id=${quote(ownerCustomer)}::uuid),(SELECT version FROM public.customer_manager_assignments WHERE customer_id=${quote(ownerCustomer)}::uuid))`)
 const afterOwner=start(txn(rpc('create_co',await makePayload('second'))));await observed(assignmentFirst,afterOwner,'owner assignment before CO capture',['relation']);success(await release(assignmentFirst));const secondOwner=resultJson(await afterOwner.result)
 assert.equal(await sql(`SELECT sales_person_id_at_creation=md5('owner-user-3')::uuid FROM private.co_orders WHERE id=${quote(secondOwner.id)}::uuid;`),'t')
 const profilePayload=await makePayload('profile')
 // Stop after the real authority helper, before credit capture: the historically dangerous lock ordering.
 const profileGate=await gate(`SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); SELECT private.co_actor_v1()` )
 const profile=start(`UPDATE public.users SET full_name='Synthetic concurrent rename' WHERE id=${uid(1)};`)
 await observed(profileGate,profile,'profile update waits while CO proceeds from authority to credit',['relation']);profileGate.child.stdin.end(auth()+rpc('create_co',profilePayload)+'; COMMIT;\n');success(await profileGate.result);success(await profile.result)
 assert.equal(await sql(`SELECT sales_attribution_state='unassigned' AND sales_person_id_at_creation IS NULL FROM private.co_orders WHERE id=${quote(firstOwner.id)}::uuid;`),'t')
 // Materialize assigned stock/sales, then change owner and correct the report: original credit must survive.
 await sql(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); DO $$ DECLARE r jsonb; d uuid; BEGIN
 r:=public.pilot_co_transaction_v1(gen_random_uuid(),'save_sj_draft',jsonb_build_object('co_id',${quote(secondOwner.id)}::uuid,'expected_co_version',(SELECT version::text FROM private.co_orders WHERE id=${quote(secondOwner.id)}::uuid),'expected_customer_version',(SELECT version::text FROM private.co_customer_state WHERE customer_id=${quote(ownerCustomer)}::uuid),'sj_number','RACE-OWNER-SJ','sj_date',current_date,'lines',(SELECT jsonb_agg(jsonb_build_object('co_line_id',id,'quantity',1)) FROM private.co_order_lines WHERE co_id=${quote(secondOwner.id)}::uuid)));
 PERFORM public.pilot_co_transaction_v1(gen_random_uuid(),'post_sj',jsonb_build_object('draft_id',r->>'id','expected_draft_version',r->>'version','expected_co_version',(SELECT version::text FROM private.co_orders WHERE id=${quote(secondOwner.id)}::uuid),'expected_customer_version',r->>'customer_version'));
 d:=co_test.report_init(${quote(ownerCustomer)}::uuid,date_trunc('month',current_date)::date);PERFORM co_test.set_sold(d,1);PERFORM co_test.report_post(d);END $$;COMMIT;`)
 success(await start(txn(`SELECT public.pilot_assign_store_owner_v1(${quote(ownerCustomer)}::uuid,md5('owner-user-2')::uuid,${quote(await sql(`SELECT id FROM public.customer_manager_assignments WHERE customer_id=${quote(ownerCustomer)}::uuid;`))}::uuid,${await sql(`SELECT version FROM public.customer_manager_assignments WHERE customer_id=${quote(ownerCustomer)}::uuid;`)})`,2)).result)
 await sql(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); DO $$ DECLARE d uuid; BEGIN d:=co_test.refresh_report(${quote(ownerCustomer)}::uuid,date_trunc('month',current_date)::date);PERFORM co_test.review_post('correct_report',co_test.report_correction(d));END $$;COMMIT;`)
 assert.equal(await sql(`SELECT count(*)=1 AND bool_and(a.sales_person_id_at_creation=md5('owner-user-3')::uuid) FROM private.co_sale_allocations a JOIN private.co_customer_state s ON s.effective_generation_id=a.generation_id WHERE s.customer_id=${quote(ownerCustomer)}::uuid;`),'t','reviewed replay retains original assigned owner after reassignment')
 // Replay still copies original batch credit after the owner race and profile change.
 assert.equal(await sql(`SELECT bool_and(a.sales_person_id_at_creation IS NOT DISTINCT FROM b.sales_person_id_at_creation AND a.sales_assignment_source_id IS NOT DISTINCT FROM b.sales_assignment_source_id) FROM private.co_sale_allocations a JOIN private.co_stock_batches b ON b.id=a.batch_id;`),'t')

 // Supporting evidence shares the universal command barrier and the customer/draft lock.
 if(await sql("SELECT to_regclass('private.co_evidence') IS NOT NULL;")==='t'){
  const evidenceRpc=(operation,payload,request=randomUUID())=>`SELECT public.pilot_co_evidence_transaction_v1(${quote(request)}::uuid,${quote(operation)},${json(payload)})`
  const evidenceState=JSON.parse(await sql(`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(1)}::text,true); CREATE TEMP TABLE evidence_race_state(c uuid,d uuid); DO $$ DECLARE c uuid:=co_test.monthly_customer('evidence-race'); d uuid; BEGIN PERFORM co_test.monthly_delivery(c,'EVIDENCE-RACE','ER',2,'1',date_trunc('month',current_date)::date);d:=co_test.report_init(c,date_trunc('month',current_date)::date);PERFORM co_test.report_zero(d);INSERT INTO evidence_race_state VALUES(c,d);END $$; SELECT json_build_object('customer_id',r.c,'draft_id',r.d,'expected_draft_version',d.version::text,'expected_customer_version',c.version::text) FROM evidence_race_state r JOIN private.co_drafts d ON d.id=r.d JOIN private.co_customer_state c ON c.customer_id=r.c; COMMIT;`).then(x=>x.split('\n').at(-1)))
  const {customer_id:ec,...binding}=evidenceState
  const register={...binding,filename:'synthetic.pdf',mime_type:'application/pdf',byte_size:100,sha256:'a'.repeat(64)},request=randomUUID()
  const registered=await gate(auth()+evidenceRpc('register_evidence',register,request))
  const registrationRetry=start(txn(evidenceRpc('register_evidence',register,request)))
  await observed(registered,registrationRetry,'evidence register same actor/request',['advisory'])
  const wrongFamily=start(txn(`SELECT public.pilot_reconcile_co_v1(${quote(request)}::uuid,false)`))
  await observed(registered,wrongFamily,'business recovery waits on supporting command',['advisory'])
  const first=resultJson(await release(registered));assert.deepEqual(resultJson(await registrationRetry.result),first);assert.match((await wrongFamily.result).stderr,/ERROR:\s+22023:/)
  const eid=first.id
  await sql(`BEGIN; INSERT INTO storage.objects(bucket_id,name,metadata,version) VALUES('co-evidence',${quote(eid+'.pdf')},'{"size":100,"mimetype":"application/pdf"}','synthetic-race'); SET LOCAL ROLE service_role; SELECT public.pilot_co_evidence_attest_v1(${uid(1)},${quote(eid)}::uuid,(SELECT id FROM storage.objects WHERE bucket_id='co-evidence' AND name=${quote(eid+'.pdf')}),'synthetic-race',100,'application/pdf',${quote(register.sha256)}); COMMIT;`)
  const finalize={evidence_id:eid,expected_evidence_version:'1',expected_draft_version:binding.expected_draft_version,expected_customer_version:binding.expected_customer_version},finalReq=randomUUID()
  const finishing=await gate(auth()+evidenceRpc('finalize_evidence',finalize,finalReq))
  const finalRetry=start(txn(evidenceRpc('finalize_evidence',finalize,finalReq)))
  await observed(finishing,finalRetry,'evidence finalize exact request replay',['advisory'])
  const competing=start(txn(evidenceRpc('finalize_evidence',finalize)))
  await observed(finishing,competing,'evidence competing finalization serializes draft',['transactionid','tuple'])
  const finalized=resultJson(await release(finishing));assert.deepEqual(resultJson(await finalRetry.result),finalized);assert.match((await competing.result).stderr,/ERROR:\s+PT409:/)
  assert.equal(await sql(`SELECT d.evidence_id=e.id AND d.version=e.finalized_draft_version AND e.version=2 AND (SELECT count(*)=1 FROM private.co_audit_events WHERE request_id=${quote(finalReq)}::uuid) FROM private.co_drafts d JOIN private.co_evidence e ON e.draft_id=d.id WHERE e.id=${quote(eid)}::uuid;`),'t')
  const abandoned=randomUUID(),tombstone=await gate(auth()+`SELECT public.pilot_reconcile_co_v1(${quote(abandoned)}::uuid,true)`),delayed=start(txn(evidenceRpc('register_evidence',register,abandoned)))
  await observed(tombstone,delayed,'universal tombstone fences supporting register',['advisory']);success(await release(tombstone));assert.match((await delayed.result).stderr,/ERROR:\s+55000:/)
  const revoke=await gate(`UPDATE public.users SET is_active=false WHERE id=${uid(1)}`)
  const callback=start(`BEGIN; SET LOCAL ROLE service_role; SELECT public.pilot_co_evidence_attest_v1(${uid(1)},${quote(eid)}::uuid,(SELECT id FROM storage.objects WHERE bucket_id='co-evidence' AND name=${quote(eid+'.pdf')}),'synthetic-race',100,'application/pdf',${quote(register.sha256)}); COMMIT;`)
  await observed(revoke,callback,'service attestation observes current actor revocation',['transactionid','tuple']);success(await release(revoke));assert.match((await callback.result).stderr,/ERROR:\s+42501:/);await sql(`UPDATE public.users SET is_active=true WHERE id=${uid(1)};`)
  console.log('CO_EVIDENCE_REAL_RACES_PASSED')
 }
 console.log('CO_REAL_RACES_PASSED')
} finally {
 const outstanding=[...sessions.values()];for(const s of outstanding)s.child.kill('SIGTERM');await Promise.all(outstanding.map(s=>s.result))
}
