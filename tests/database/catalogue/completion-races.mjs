// Fictional three-session proof supplied by the existing identity-bound CI child.
// No connection discovery, hosted execution, or automatic invocation.
import assert from 'node:assert/strict';
const executive='5e186f1c-c18f-6670-7b74-d7d2f4e8a28e';
const co='30000000-0000-4000-8000-000000000799';
const request=n=>`30000000-0000-4000-8000-${String(700+n).padStart(12,'0')}`;
const quote=value=>`'${value.replaceAll("'","''")}'`;
const uuid=value=>{assert.match(value,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);return quote(value)+'::uuid';};
const command=(id,operation,payload)=>`SELECT public.pilot_catalog_transaction_v1(${uuid(id)},${quote(operation)},${quote(JSON.stringify(payload))}::jsonb);`;
const remove=(id,kind,target)=>command(id,'delete_unused',{kind,id:target,expected_version:'1'});
const target=(id,customer)=>`SELECT public.pilot_customer_target_upsert_v1(${uuid(id)},${uuid(customer)},'2040-01',123.45);`;
const create=(id,kind)=>command(id,'create',{kind,values:kind==='customer'?{name:'Fictional completion customer',address:null,city:null,phone:null,email:null,pricing_tier:'luar_kota',customer_category:'perorangan'}:{name:'Fictional completion product',sku:'COMPLETION-RACE-PRODUCT',size:null,harga_pokok:null,luar_kota:0,dalam_kota:null,depo_bangunan:null}});
const pids=(waiter,blocker)=>{for(const pid of [waiter,blocker])assert.ok(Number.isSafeInteger(pid)&&pid>0);assert.notEqual(waiter,blocker);};
export const catalogueCompletionRaceCases=Object.freeze(['target_duplicate_commit_replay','target_use_blocks_unused_delete','delete_commit_refuses_target_save','product_relation_busy_then_delete','delete_request_busy_replay','truncate_drain_busy_then_refused']);
export function completionRequestBarrierSql(waiter,blocker,id){
 pids(waiter,blocker);uuid(id);
 return `WITH k AS (SELECT hashtextextended('catalog_target_request_v1:'||${uuid(executive)}::text||':'||${uuid(id)}::text,0) v)
 SELECT EXISTS(SELECT 1 FROM pg_locks,k WHERE pid=${waiter} AND locktype='advisory' AND mode='ExclusiveLock' AND NOT granted
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objsubid=1
 AND classid=((k.v >> 32)&4294967295)::oid AND objid=(k.v&4294967295)::oid)
 AND ${blocker}=ANY(pg_blocking_pids(${waiter}));`;
}
export function completionRowWaitSql(waiter,blocker){
 pids(waiter,blocker);
 return `SELECT ${blocker}=ANY(pg_blocking_pids(${waiter})) AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiter} AND NOT granted AND locktype IN('transactionid','tuple'));`;
}
export function completionRefusalSql(sql,reason){
 assert.equal(typeof sql,'string');
 const expected={'customer-row':'could not obtain lock on row in relation "customers"','product-relation':'could not obtain lock on relation "public.products"','cutover-row':'could not obtain lock on row in relation "catalog_cutover_v1"'};
 assert.ok(reason==='request'||Object.hasOwn(expected,reason));
 const predicate=reason==='request'?"detail IS DISTINCT FROM 'CATALOG_REQUEST_BUSY'":`message IS DISTINCT FROM ${quote(expected[reason])}`;
 return `DO $completion_busy$ DECLARE detail text; message text; BEGIN BEGIN ${sql.replace(/^SELECT /,'PERFORM ')}
 RAISE EXCEPTION 'Missing completion busy refusal' USING ERRCODE='PC922';
 EXCEPTION WHEN SQLSTATE '55P03' THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL,message=MESSAGE_TEXT;
 IF ${predicate} THEN RAISE EXCEPTION 'Wrong completion busy refusal' USING ERRCODE='PC923'; END IF;
 RAISE; END; END $completion_busy$;`;
}
export async function executeCatalogueCompletionRaces({a,b,observer,query,expectState,verify}){
 assert.notEqual(a,b);assert.notEqual(a,observer);assert.notEqual(b,observer);
 for(const fn of [query,expectState,verify])assert.equal(typeof fn,'function');
 const ids=await Promise.all([a,b,observer].map(async s=>Number(await query(s,'SELECT pg_backend_pid();'))));
 assert.equal(new Set(ids).size,3);ids.forEach(pid=>assert.ok(Number.isSafeInteger(pid)&&pid>0));
 const json=async(s,sql)=>JSON.parse(await query(s,sql));
 const start=async(s,actor)=>{
  await query(s,`BEGIN; SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(actor)},true);`);
  assert.equal(await query(s,`SELECT current_user='authenticated' AND auth.uid()=${uuid(actor)} AND row_security_active('public.products') AND row_security_active('public.customers') AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls));`),'t');
 };
 const fail=async(s,sql,state)=>{await expectState(s,sql,state);await expectState(s,'SELECT 1;','25P02');await query(s,'ROLLBACK;');};
 const observe=async sql=>{
  let observed=false;
  for(let attempt=0;attempt<200;attempt++){
   if(await query(observer,sql)==='t'){observed=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(observed,true,'An exact database lock barrier, not elapsed time, must be observed');
 };
 let activated=false,pending;
 try{
  await verify();
  assert.equal(await query(observer,"SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton;"),'t');
  await query(observer,`BEGIN;
   INSERT INTO auth.users(id) VALUES(${uuid(co)});
   INSERT INTO public.users(id,full_name,email,role,is_active) VALUES(${uuid(co)},'Fictional completion CO','completion-co@example.invalid','co_admin',true);
   ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_generation_one,DROP CONSTRAINT catalog_foundation_not_ready;
   UPDATE private.catalog_cutover_v1 SET execution_generation=2,tracking_ready=true WHERE singleton;
   COMMIT;`);activated=true;
  await start(a,co);const customer=(await json(a,create(request(1),'customer'))).id;const other=(await json(a,create(request(2),'customer'))).id;const product=(await json(a,create(request(3),'product'))).id;
  [customer,other,product].forEach(uuid);await query(a,'COMMIT;');
  assert.equal(await query(observer,`SELECT count(*)=3 FROM private.catalog_identity_v1 WHERE id IN(${uuid(customer)},${uuid(other)},${uuid(product)}) AND lifetime_state='unused';`),'t');

  await start(a,executive);const saved=await json(a,target(request(4),customer));
  assert.equal(saved.actor_id,executive);assert.equal(saved.customer_id,customer);assert.equal(saved.target_value,'123.45');
  assert.equal(await query(observer,`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${ids[0]} AND relation='public.customers'::regclass AND mode='RowShareLock' AND granted);`),'t');
  await start(b,co);await fail(b,completionRefusalSql(remove(request(5),'customer',customer),'customer-row'),'55P03');
  await start(b,executive);pending=json(b,target(request(4),customer));pending.catch(()=>{});
  await observe(completionRequestBarrierSql(ids[1],ids[0],request(4)));
  assert.equal(await query(observer,`SELECT NOT EXISTS(SELECT 1 FROM public.customer_targets WHERE customer_id=${uuid(customer)});`),'t');
  await query(a,'COMMIT;');assert.deepEqual(await pending,saved);pending=null;await query(b,'COMMIT;');
  await start(b,executive);assert.deepEqual(await json(b,`SELECT public.pilot_reconcile_customer_target_v1(${uuid(request(4))});`),{status:'committed',receipt:saved});await query(b,'COMMIT;');
  await start(a,co);await fail(a,remove(request(5),'customer',customer),'23514');
  assert.equal(await query(observer,`SELECT (SELECT count(*)=1 FROM public.customer_targets WHERE customer_id=${uuid(customer)}) AND (SELECT lifetime_state='used' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=${uuid(customer)}) AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE actor_id=${uuid(co)} AND request_id=${uuid(request(5))});`),'t');

  await start(a,co);const deleted=await json(a,remove(request(6),'customer',other));assert.equal(deleted.after,null);
  await start(b,executive);pending=b.query(target(request(7),other));pending.catch(()=>{});
  await observe(completionRowWaitSql(ids[1],ids[0]));await query(a,'COMMIT;');
  const denied=await pending;pending=null;assert.equal(denied.sqlstate,'42501');await expectState(b,'SELECT 1;','25P02');await query(b,'ROLLBACK;');
  assert.equal(await query(observer,`SELECT NOT EXISTS(SELECT 1 FROM public.customer_targets WHERE customer_id=${uuid(other)}) AND NOT EXISTS(SELECT 1 FROM private.catalog_target_requests_v1 WHERE actor_id=${uuid(executive)} AND request_id=${uuid(request(7))});`),'t');

  await start(b,executive);await query(b,`SELECT id FROM public.products WHERE id=${uuid(product)} FOR SHARE;`);
  assert.equal(await query(observer,`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${ids[1]} AND relation='public.products'::regclass AND mode='RowShareLock' AND granted);`),'t');
  await start(a,co);await fail(a,completionRefusalSql(remove(request(8),'product',product),'product-relation'),'55P03');await query(b,'ROLLBACK;');
  await start(a,co);const productDeleted=await json(a,remove(request(8),'product',product));
  assert.equal(await query(observer,`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${ids[0]} AND relation='public.products'::regclass AND mode='ExclusiveLock' AND granted);`),'t');
  await start(b,co);await fail(b,completionRefusalSql(remove(request(8),'product',product),'request'),'55P03');await query(a,'COMMIT;');
  await start(b,co);assert.deepEqual(await json(b,remove(request(8),'product',product)),productDeleted);assert.deepEqual(await json(b,`SELECT public.pilot_reconcile_catalog_v1(${uuid(request(8))},false);`),{status:'committed',receipt:productDeleted});await query(b,'COMMIT;');
  assert.equal(await query(observer,`SELECT NOT EXISTS(SELECT 1 FROM public.products WHERE id=${uuid(product)}) AND (SELECT deleted_at IS NOT NULL AND lifetime_state='unused' FROM private.catalog_identity_v1 WHERE kind='product' AND id=${uuid(product)}) AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE status='pending') AND NOT EXISTS(SELECT 1 FROM private.catalog_target_requests_v1 WHERE status='pending');`),'t');
  // TRUNCATE has acquired its relation lock before its trigger. Holding the
  // cutover row proves the trigger must refuse rather than wait in reverse order.
  await query(observer,'BEGIN; SELECT singleton FROM private.catalog_cutover_v1 WHERE singleton FOR UPDATE;');
  const serviceStart=async()=>{
   await query(b,"BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='3s'; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claim.sub','',true);");
   assert.equal(await query(b,"SELECT current_user='service_role' AND has_table_privilege(current_user,'public.customer_targets','TRUNCATE') AND auth.uid() IS NULL;"),'t');
  };
  await serviceStart();await fail(b,completionRefusalSql('TRUNCATE public.customer_targets;','cutover-row'),'55P03');await query(observer,'ROLLBACK;');
  await serviceStart();await fail(b,`DO $truncate_refusal$ DECLARE detail text; BEGIN BEGIN
   TRUNCATE public.customer_targets; RAISE EXCEPTION 'Missing truncate refusal' USING ERRCODE='PC920';
   EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
    IF detail IS DISTINCT FROM 'CATALOG_GENERATION_RETIRED' THEN RAISE EXCEPTION 'Wrong truncate refusal' USING ERRCODE='PC921'; END IF; RAISE;
   END; END $truncate_refusal$;`,'42501');
  assert.equal(await query(observer,`SELECT count(*)=1 FROM public.customer_targets WHERE customer_id=${uuid(customer)};`),'t');
  await verify();
 }finally{
  // Release the blocker before settling its peer; never issue concurrent queries
  // on a session. Only this identity-bound fictional child is altered/restored.
  await query(a,'ROLLBACK;');if(pending)await pending.catch(()=>{});await query(b,'ROLLBACK;');await query(observer,'ROLLBACK;');
  if(activated){await query(observer,`BEGIN;
   UPDATE private.catalog_cutover_v1 SET execution_generation=1,tracking_ready=false WHERE singleton;
   ALTER TABLE private.catalog_cutover_v1 ADD CONSTRAINT catalog_foundation_generation_one CHECK (execution_generation = 1),ADD CONSTRAINT catalog_foundation_not_ready CHECK (NOT tracking_ready);
   COMMIT;`);
   assert.equal(await query(observer,"SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton;"),'t');}
 }
 await verify();return {status:'BOUNDED_CATALOGUE_COMPLETION_RACES_PASSED',backendPids:ids,cases:catalogueCompletionRaceCases};
}
