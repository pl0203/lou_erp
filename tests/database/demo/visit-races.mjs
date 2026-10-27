// Independent PostgreSQL sessions, explicit lock barriers, synthetic data only.
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
assert.ok(['visit_workflow_test','pilot_test'].includes(process.env.PGDATABASE),'Disposable database required')
assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST),'Loopback PostgreSQL required')
const env={...process.env};for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGPASSFILE'])delete env[key]
const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',env.PGHOST,'-p',env.PGPORT??'5432','-U',env.PGUSER??'postgres','-d',env.PGDATABASE]
const quote=s=>`'${String(s).replaceAll("'","''")}'`,json=s=>`${quote(JSON.stringify(s))}::jsonb`
let serial=0;const processes=new Set()
function start(sql,interactive=false){const name=`visit-race-${process.pid}-${++serial}`;const child=spawn('psql',args,{env:{...env,PGAPPNAME:name,PGOPTIONS:'-c statement_timeout=20000 -c lock_timeout=18000 -c idle_in_transaction_session_timeout=25000'},stdio:['pipe','pipe','pipe']});processes.add(child);let stdout='',stderr='',readyResolve,readyReject;const ready=new Promise((res,rej)=>{readyResolve=res;readyReject=rej});ready.catch(()=>{});child.stdout.on('data',b=>{stdout+=b;if(stdout.includes('VISIT_GATE_READY'))readyResolve()});child.stderr.on('data',b=>{stderr+=b});child.stdin.on('error',()=>{});const result=new Promise(res=>{child.on('error',error=>{readyReject(error);res({code:-1,stdout,stderr:String(error)})});child.on('close',code=>{processes.delete(child);if(!stdout.includes('VISIT_GATE_READY'))readyReject(new Error(stderr));res({code,stdout,stderr})})});if(interactive)child.stdin.write(`${sql};\n\\echo VISIT_GATE_READY\n`);else child.stdin.end(`${sql};\n`);return {child,result,ready,name}}
function success(r){assert.equal(r.code,0,r.stderr);return r.stdout.trim()}
async function sql(q){return success(await start(q).result)}
async function blocked(name){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${quote(name)} AND wait_event_type='Lock'`)==='1')return;await new Promise(r=>setTimeout(r,30))}throw new Error(`No observed lock barrier: ${name}`)}
const actor=id=>`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(id)},true);`
const transaction=(id,q)=>`BEGIN; ${actor(id)} ${q}; COMMIT`
const plan=(op,payload,id=randomUUID())=>`SELECT public.pilot_schedule_transaction_v1(${quote(id)},${quote(op)},${json(payload)})`
const finalize=(payload,id=randomUUID())=>`SELECT public.pilot_finalize_visit(${quote(id)},'finalize_visit',${json(payload)})`
async function orderedRace(winnerActor,winner,loserActor,loser,sqlstate){const controller=start(`BEGIN; ${actor(winnerActor)} ${winner}`,true);await controller.ready;const contender=start(transaction(loserActor,loser));try{await blocked(contender.name)}finally{controller.child.stdin.end('COMMIT;\n');success(await controller.result)}const outcome=await contender.result;assert.notEqual(outcome.code,0,'Loser unexpectedly committed');assert.match(outcome.stderr,new RegExp(sqlstate));return outcome}
const manager=randomUUID(),sales=randomUUID(),other=randomUUID(),executive=randomUUID(),store=randomUUID(),nextStore=randomUUID(),schedule1=randomUUID(),schedule2=randomUUID()
try{
 assert.equal(await sql("SELECT purpose FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci'"),'disposable-pilot-ci')
 await sql(`INSERT INTO auth.users(id) VALUES(${quote(manager)}),(${quote(sales)}),(${quote(other)}),(${quote(executive)}); INSERT INTO public.users(id,full_name,email,role,manager_id) VALUES(${quote(manager)},'Race manager',${quote(manager+'@tests.invalid')},'sales_manager',null),(${quote(other)},'Other manager',${quote(other+'@tests.invalid')},'sales_manager',null),(${quote(executive)},'Executive',${quote(executive+'@tests.invalid')},'executive',null),(${quote(sales)},'Race sales',${quote(sales+'@tests.invalid')},'sales_person',${quote(manager)}); INSERT INTO public.customers(id,name) VALUES(${quote(store)},'Race store'),(${quote(nextStore)},'Race amended store'); INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by) VALUES(${quote(store)},${quote(manager)},${quote(manager)}),(${quote(nextStore)},${quote(manager)},${quote(manager)}); INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES(${quote(store)},${quote(sales)}),(${quote(nextStore)},${quote(sales)}); INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES(${quote(schedule1)},${quote(store)},${quote(sales)},${quote(manager)},'2026-10-08'),(${quote(schedule2)},${quote(store)},${quote(sales)},${quote(manager)},'2026-10-09'); INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('visits',${quote(`visits/${schedule1}/proof.webp`)},${quote(sales)}),('visits',${quote(`visits/${schedule2}/proof.webp`)},${quote(sales)})`)
 const bound=(id,date)=>({schedule_id:id,expected_schedule_version:1,customer_id:store,scheduled_date:date,storage_path:`visits/${id}/proof.webp`,lat:0,lng:0,notes:'captured before race'})
 const change=(id,date)=>({schedule_id:id,expected_version:1,customer_id:nextStore,sales_person_id:sales,scheduled_date:date,notes:'Amended'})
 const visitRequest=randomUUID()
 await orderedRace(sales,finalize(bound(schedule1,'2026-10-08'),visitRequest),manager,plan('edit_schedule',change(schedule1,'2026-10-10')),'40001|55000')
 assert.equal(await sql(`SELECT count(*) FROM public.outlet_visits WHERE schedule_id=${quote(schedule1)} AND outlet_id=${quote(store)} AND notes='captured before race'`),'1')
 assert.equal(await sql(`SELECT outlet_id FROM public.sales_schedules WHERE id=${quote(schedule1)}`),store)
 console.log('PASS check-in wins: waiting amendment refused; original store/photo/note retained')
 await orderedRace(manager,plan('edit_schedule',change(schedule2,'2026-10-11')),sales,finalize(bound(schedule2,'2026-10-09')),'PVS01')
 assert.equal(await sql(`SELECT count(*) FROM public.outlet_visits WHERE schedule_id=${quote(schedule2)}`),'0')
 assert.equal(await sql(`SELECT outlet_id||':'||version FROM public.sales_schedules WHERE id=${quote(schedule2)}`),`${nextStore}:2`)
 console.log('PASS amendment wins: old photo finalization refused; no visit/photo evidence created')
 const proposalResult=await sql(transaction(sales,plan('propose_visit',{customer_id:store,scheduled_date:'2026-10-15',notes:'proposed'})))
 const proposal=JSON.parse(proposalResult.split('\n').findLast(x=>x.startsWith('{')))
 await orderedRace(executive,`UPDATE public.users SET manager_id=${quote(other)} WHERE id=${quote(sales)}`,manager,plan('approve_request',{request_id:proposal.id,expected_version:1}),'42501')
 assert.equal(await sql(`SELECT status FROM public.visit_requests WHERE id=${quote(proposal.id)}`),'pending')
 console.log('PASS manager reassignment wins: blocked stale approval rechecks current authority and fails')
 await sql(transaction(executive,`UPDATE public.users SET manager_id=${quote(manager)} WHERE id=${quote(sales)}`))
 await orderedRace(manager,plan('approve_request',{request_id:proposal.id,expected_version:1}),manager,plan('approve_request',{request_id:proposal.id,expected_version:1}),'40001')
 assert.equal(await sql(`SELECT count(*) FROM public.sales_schedules WHERE outlet_id=${quote(store)} AND scheduled_date='2026-10-15'`),'1')
 console.log('PASS duplicate approval race: exactly one executable schedule')
 const req=randomUUID();await sql(transaction(sales,plan('propose_visit',{customer_id:store,scheduled_date:'2026-10-17'},req)))
 await orderedRace(executive,`UPDATE public.users SET is_active=false WHERE id=${quote(sales)}`,sales,`SELECT public.pilot_reconcile_schedule_v1(${quote(req)},true)`,'42501')
 console.log('PASS deactivation wins: pending recovery rechecks current actor and refuses receipt')
 await sql(transaction(executive,`UPDATE public.users SET is_active=true WHERE id=${quote(sales)}`))
 await orderedRace(executive,`UPDATE public.users SET is_active=false WHERE id=${quote(sales)}`,sales,`SELECT public.pilot_reconcile_visit(${quote(visitRequest)},true)`,'42501')
 console.log('PASS deactivation wins: check-in recovery rechecks current actor and refuses receipt')
 await sql(transaction(executive,`UPDATE public.users SET is_active=true WHERE id=${quote(sales)}`))
 const customerProposalResult=await sql(transaction(sales,plan('propose_visit',{customer_id:nextStore,scheduled_date:'2026-10-20'})))
 const customerProposal=JSON.parse(customerProposalResult.split('\n').findLast(x=>x.startsWith('{')))
 await orderedRace(executive,`DELETE FROM public.customer_manager_assignments WHERE customer_id=${quote(nextStore)}`,manager,plan('approve_request',{request_id:customerProposal.id,expected_version:1}),'42501')
 assert.equal(await sql(`SELECT status FROM public.visit_requests WHERE id=${quote(customerProposal.id)}`),'pending')
 console.log('PASS customer reassignment wins: waiting approval cannot use former store authority')

}finally{for(const child of processes){child.stdin.end('ROLLBACK;\n');child.kill('SIGTERM')}}
