import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { demoCiConnection } from '../../../scripts/test-demo-revisions-ci.mjs'
assert.ok(['pilot_test','pilot_store_owner_test'].includes(process.env.PGDATABASE))
const connection={...demoCiConnection({...process.env,PGDATABASE:'pilot_test'}), PGDATABASE:process.env.PGDATABASE}
const query=sql=>execFileSync('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1'],{env:connection,input:sql,encoding:'utf8',timeout:15000})
assert.equal(query("SELECT current_user='postgres' AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')").trim(),'t')
function session(name,sql,open=false){
 const child=spawn('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{env:{...connection,PGAPPNAME:name},stdio:['pipe','pipe','pipe']})
 let output='',error='',readyResolve
 const ready=new Promise(resolve=>readyResolve=resolve)
 child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('OWNER_LOCK_READY'))readyResolve()})
 child.stderr.on('data',chunk=>error+=chunk)
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,output,error}))})
 child.stdin.write(sql); if(!open)child.stdin.end()
 return {child,ready,done}
}
async function blocked(name){
 const deadline=Date.now()+5000
 while(Date.now()<deadline){
  if(query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock')`).trim()==='t')return
  await new Promise(resolve=>setTimeout(resolve,30))
 }
 throw new Error(`Expected ${name} to serialize on the authority lock`)
}
const uid=n=>`md5('owner-user-${n}')::uuid`, store=n=>`md5('owner-store-${n}')::uuid`
const auth=n=>`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${uid(n)}::text,false);`
const first=session('owner-first',`BEGIN; ${auth(1)} SELECT public.pilot_assign_store_owner_v1(${store(4)},${uid(2)},NULL,NULL); SELECT 'OWNER_LOCK_READY';\n`,true)
await first.ready
const second=session('owner-stale',`${auth(1)} SELECT public.pilot_assign_store_owner_v1(${store(4)},${uid(3)},NULL,NULL);\n`)
await blocked('owner-stale');first.child.stdin.end('COMMIT;\n')
assert.equal((await first.done).code,0)
const stale=await second.done;assert.notEqual(stale.code,0);assert.match(stale.error,/40001/)
assert.equal(query(`SELECT manager_id=${uid(2)} AND version=1 FROM public.customer_manager_assignments WHERE customer_id=${store(4)}`).trim(),'t')
assert.equal(query(`SELECT count(*) FROM private.pilot_store_owner_audit_v1 WHERE customer_id=${store(4)}`).trim(),'1')
// A PO that wins the lock snapshots unassigned; a later owner write cannot rewrite it.
const po=session('owner-po-first',`BEGIN; ${auth(6)} SELECT public.pilot_order_transaction(md5('owner-race-request')::uuid,'create_po',jsonb_build_object('customer_id',${store(5)},'po_number','OWNER-RACE-PO','items',jsonb_build_array(jsonb_build_object('product_name','Synthetic','quantity',1,'unit_price',17)))); SELECT 'OWNER_LOCK_READY';\n`,true)
await po.ready
const assign=session('owner-after-po',`${auth(1)} SELECT public.pilot_assign_store_owner_v1(${store(5)},${uid(4)},NULL,NULL);\n`)
await blocked('owner-after-po');po.child.stdin.end('COMMIT;\n')
assert.equal((await po.done).code,0);assert.equal((await assign.done).code,0)
assert.equal(query("SELECT sales_attribution_state='unassigned' AND sales_person_id_at_creation IS NULL FROM public.purchase_orders WHERE po_number='OWNER-RACE-PO'").trim(),'t')
console.log('STORE_OWNER_CONCURRENT_WRITES_AND_PO_SNAPSHOT_PASSED')
// Establish authority table lock before actor row lock so profile changes cannot invert them.
const authority=session('owner-authority-first',`BEGIN; SELECT set_config('request.jwt.claim.sub',${uid(6)}::text,false); SELECT private.demo_order_actor(); SELECT 'OWNER_LOCK_READY';\n`,true)
await authority.ready
const profile=session('owner-profile-update',`UPDATE public.users SET full_name='Synthetic renamed administrator' WHERE id=${uid(6)};\n`)
await blocked('owner-profile-update')
authority.child.stdin.end(`SELECT private.demo_capture_credit(${store(1)}); COMMIT;\n`)
const authorityResult=await authority.done,profileResult=await profile.done
assert.equal(authorityResult.code,0,authorityResult.error);assert.equal(profileResult.code,0,profileResult.error)
console.log('STORE_OWNER_PROFILE_AUTHORITY_LOCK_ORDER_PASSED')
