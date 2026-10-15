// Bound to the existing terminal isolated PG17 runtime. No new process, package,
// connection, target discovery or auto-run. query is its existing checked PsqlSession
// adapter. Only observed pg_locks + pg_blocking_pids can satisfy a barrier.
import assert from 'node:assert/strict';
export const lifetimeAdmissionCases=Object.freeze(['legacy_already_admitted_po_drain','authorized_raw_service_admission_drain','legacy_unledgered_owner_actual_dml_drain']);
export function lifetimeDrainBarrierSql(waiter,holder){
 for(const pid of [waiter,holder])assert.ok(Number.isSafeInteger(pid)&&pid>0);
 return `SELECT ${holder}=ANY(pg_blocking_pids(${waiter}))
 AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiter} AND locktype='transactionid' AND NOT granted)
 AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=${holder} AND relation='private.catalog_cutover_v1'::regclass AND mode='RowShareLock' AND granted);`;
}
export async function executeLifetimeAdmissionRaces({a,b,observer,query,verify}){
 const ids=await Promise.all([a,b,observer].map(async s=>Number(await query(s,'SELECT pg_backend_pid();'))));assert.equal(new Set(ids).size,3);
 const actor="md5('catalogue-foundation-actor-3')::uuid";
 const customerA="'10000000-0000-4000-8000-000000000071'::uuid";
 const customerB="'10000000-0000-4000-8000-000000000072'::uuid";
 const product="'10000000-0000-4000-8000-000000000091'::uuid";
 const request="'30000000-0000-4000-8000-000000000191'::uuid";
 const start=`BEGIN; SET LOCAL lock_timeout='6s'; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${actor}::text,true);`;
 const barrier=async()=>{
  const deadline=Date.now()+4000;
  while(Date.now()<deadline){
   if(await query(observer,lifetimeDrainBarrierSql(ids[1],ids[0]))==='t')return;
   await new Promise(resolve=>setTimeout(resolve,10)); // scheduling, never success evidence
  }
  throw new Error('Required actual transaction-held lifetime drain barrier not observed');
 };
 const drain=async()=>{
  await query(b,"BEGIN; SET LOCAL lock_timeout='6s';");
  const pending=query(b,'SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton FOR UPDATE;');pending.catch(()=>{});
  await barrier();await query(a,'COMMIT;');assert.equal(await pending,'t');await query(b,'ROLLBACK;');await verify();
 };
 await verify();
 await query(a,start);
 const receipt=JSON.parse(await query(a,`SELECT public.pilot_order_transaction(${request},'create_po',jsonb_build_object('customer_id',${customerA},'po_number','FICTIONAL-LIFETIME-DRAIN','items',jsonb_build_array(jsonb_build_object('product_id',${product},'product_name','Fictional drain product','sku','LIFETIME-DRAIN','quantity',1,'unit_price',0))));`));assert.ok(receipt.id);
 await drain();
 assert.equal(await query(observer,`SELECT execution_version=1 AND result IS NOT NULL FROM private.pilot_order_requests WHERE actor_id=${actor} AND request_id=${request};`),'t');
 await query(a,"BEGIN; SET LOCAL lock_timeout='6s'; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.sub','',true);");
 await query(a,`INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(${customerA},'2098-12',${actor});`);
 await drain();
 assert.equal(await query(observer,`SELECT count(*)=1 FROM public.customer_targets WHERE customer_id=${customerA} AND year_month='2098-12';`),'t');
 await query(a,start);
 const assignment=JSON.parse(await query(a,`SELECT public.pilot_assign_store_owner_v1(${customerB},${actor},NULL,NULL);`));assert.ok(assignment.id);
 await drain();
 assert.equal(await query(observer,`SELECT manager_id=${actor} FROM public.customer_manager_assignments WHERE customer_id=${customerB};`),'t');
 return {status:'BOUNDED_LIFETIME_ADMISSION_RACES_PASSED',cases:lifetimeAdmissionCases,scope:'ADMISSION_ONLY_NOT_GLOBAL_LIFETIME'};
}
