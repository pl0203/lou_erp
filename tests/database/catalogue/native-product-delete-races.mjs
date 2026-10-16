// Source-only until the reviewed, identity-bound disposable PostgreSQL CI child
// supplies three live sessions. No connection/configuration discovery or auto-run.
import assert from 'node:assert/strict';
const id=n=>`4d45a1e0-1500-4000-8000-${String(n).padStart(12,'0')}`;
const executive=id(1),po=id(2),customer=id(3);
const products=[id(101),id(102)],plain=id(103),promotions=[id(201),id(202)];
const actors=[executive,po];
const quote=value=>`'${value.replaceAll("'","''")}'`;
const uuid=value=>{assert.match(value,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);return `${quote(value)}::uuid`;};
const list=values=>values.map(uuid).join(',');
const pids=(waiter,blocker)=>{for(const pid of [waiter,blocker])assert.ok(Number.isSafeInteger(pid)&&pid>0);assert.notEqual(waiter,blocker);};
export const nativeProductDeleteRaceCases=Object.freeze([
 'native_no_action_po_and_executive','native_multi_product_both_orders',
 'checked_po_first_native_nowait','checked_promotion_first_native_nowait',
 'native_first_checked_po_wait','native_first_checked_promotion_wait',
 'promotion_child_wait_root_flush','identity_refusal_atomic_cascade_rollback',
 'native_committed_cascade_and_plain_provenance'
]);
export function nativeProductDeleteRelationBarrierSql(waiter,blocker){
 pids(waiter,blocker);
 return `SELECT ${blocker}=ANY(pg_blocking_pids(${waiter}))
 AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiter} AND locktype='relation' AND relation='public.products'::regclass AND mode='RowShareLock' AND NOT granted)
 AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=${blocker} AND locktype='relation' AND relation='public.products'::regclass AND mode='ExclusiveLock' AND granted);`;
}
export function nativeProductDeleteChildBarrierSql(waiter,blocker){
 pids(waiter,blocker);
 return `SELECT ${blocker}=ANY(pg_blocking_pids(${waiter}))
 AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiter} AND locktype IN('transactionid','tuple') AND NOT granted)
 AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiter} AND locktype='relation' AND relation='public.products'::regclass AND mode='ExclusiveLock' AND granted)
 AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=${blocker} AND locktype='relation' AND relation='public.promotions'::regclass AND mode='RowShareLock' AND granted);`;
}
export function nativeProductDeleteRefusalSql(sql,reason){
 assert.equal(typeof sql,'string');
 const messages={'product-relation':'could not obtain lock on relation "public.products"','identity-row':'could not obtain lock on row in relation "catalog_identity_v1"'};
 assert.ok(reason==='no-action'||Object.hasOwn(messages,reason));
 const state=reason==='no-action'?'23503':'55P03';
 const mismatch=reason==='no-action'?"constraint_name IS DISTINCT FROM 'promotions_product_id_fkey'":`message IS DISTINCT FROM ${quote(messages[reason])}`;
 return `DO $native_refusal$ DECLARE message text; constraint_name text; BEGIN BEGIN
 ${sql} RAISE EXCEPTION 'Missing native delete refusal' USING ERRCODE='PC930';
 EXCEPTION WHEN SQLSTATE '${state}' THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT,constraint_name=CONSTRAINT_NAME;
 IF ${mismatch} THEN RAISE EXCEPTION 'Wrong native delete refusal' USING ERRCODE='PC931'; END IF;
 RAISE; END; END $native_refusal$;`;
}
// PostgreSQL does not promise DELETE order from an IN-list. An ordered outer
// relation plus nested-loop planning requests each order; RETURNING must prove
// the actual order or the test fails. Never silently relabel an unordered run.
const remove=order=>`WITH wanted AS MATERIALIZED
 (SELECT key FROM unnest(ARRAY[${list(order)}]) WITH ORDINALITY AS input(key,n) ORDER BY n),
 deleted AS (DELETE FROM public.products p USING wanted w WHERE p.id=w.key RETURNING p.id)
 SELECT coalesce(json_agg(id),'[]'::json) FROM deleted;`;
const removeStatement=order=>`DELETE FROM public.products WHERE id IN(${list(order)});`;
const poCommand=(request,order)=>`SELECT public.pilot_order_transaction(${uuid(request)},'create_po',${quote(JSON.stringify({customer_id:customer,po_number:`FICTIONAL-NATIVE-DELETE-${request}`,items:order.map(product=>({product_id:product,product_name:'Fictional native race product',sku:`NATIVE-RACE-${product}`,quantity:1,unit_price:0}))}))}::jsonb);`;
const promotionCommand=(request,index)=>`SELECT public.pilot_promotion_transaction_v1(${uuid(request)},'set_active',${quote(JSON.stringify({promotion_id:promotions[index],expected_stock_version:1,is_active:false}))}::jsonb);`;
export async function executeNativeProductDeleteRaces({a,b,observer,query,expectState,verify}){
 assert.ok(a&&b&&observer);assert.notEqual(a,b);assert.notEqual(a,observer);assert.notEqual(b,observer);
 for(const fn of [query,expectState,verify])assert.equal(typeof fn,'function');
 const backendPids=await Promise.all([a,b,observer].map(async s=>Number(await query(s,'SELECT pg_backend_pid();'))));
 assert.equal(new Set(backendPids).size,3);backendPids.forEach(pid=>assert.ok(Number.isSafeInteger(pid)&&pid>0));
 const json=async(s,sql)=>JSON.parse(await query(s,sql));
 const start=async(s,actor)=>{
  await query(s,`BEGIN; SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'; SET LOCAL idle_in_transaction_session_timeout='30s';
   SET LOCAL enable_hashjoin=off; SET LOCAL enable_mergejoin=off; SET LOCAL enable_seqscan=off;
   SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(actor)},true);`);
  assert.equal(await query(s,`SELECT current_user='authenticated' AND auth.uid()=${uuid(actor)}
   AND public.current_user_role()=${quote(actor===po?'po_admin':'executive')}::public.user_role
   AND row_security_active('public.products') AND row_security_active('public.promotions')
   AND has_table_privilege(current_user,'public.products','DELETE')
   AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls));`),'t');
 };
 const fail=async(s,sql,reason)=>{
  await expectState(s,nativeProductDeleteRefusalSql(sql,reason),reason==='no-action'?'23503':'55P03');
  await expectState(s,'SELECT 1;','25P02');await query(s,'ROLLBACK;');
 };
 const observe=async sql=>{
  let observed=false;
  for(let attempt=0;attempt<400;attempt++){
   if(await query(observer,sql)==='t'){observed=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10)); // Scheduling only, never evidence.
  }
  assert.equal(observed,true,'Exact live PostgreSQL wait barrier was not observed');
 };
 // Recreated constraints have new internal OIDs. Compare all semantic definition,
 // timing/validation fields and relation ACL/RLS, not transient catalog row OIDs.
 const structure=()=>json(observer,`SELECT jsonb_build_object(
  'constraints',(SELECT jsonb_agg(jsonb_build_object('relation',conrelid,'name',conname,'type',contype,
   'definition',pg_get_constraintdef(oid),'validated',convalidated,'deferrable',condeferrable,'deferred',condeferred)
   ORDER BY conrelid,conname) FROM pg_constraint WHERE conrelid='private.catalog_cutover_v1'::regclass
   OR (contype='f' AND confrelid IN('public.products'::regclass,'public.promotions'::regclass))),
  'access',(SELECT jsonb_agg(jsonb_build_object('relation',oid,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY oid)
   FROM pg_class WHERE oid IN('public.products'::regclass,'public.promotions'::regclass,'private.catalog_cutover_v1'::regclass)));`);
 const snapshot=(session=observer)=>json(session,`SELECT jsonb_build_object(
  'products',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.products p WHERE id IN(${list([...products,plain])})),
  'promotions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.promotions p WHERE id IN(${list(promotions)})),
  'identities',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY kind,id),'[]') FROM private.catalog_identity_v1 i WHERE id IN(${list([...products,plain,customer])})),
  'orders',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM public.purchase_orders p WHERE created_by IN(${list(actors)})),
  'order_requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_id),'[]') FROM private.pilot_order_requests r WHERE actor_id IN(${list(actors)})),
  'promotion_requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_id),'[]') FROM private.pilot_promotion_requests r WHERE actor_id IN(${list(actors)})),
  'root_scope',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY backend_pid),'[]') FROM private.catalog_product_delete_scope_v2 r WHERE backend_pid IN(${backendPids.join(',')})),
  'root_rows',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY backend_pid,product_id),'[]') FROM private.catalog_product_delete_rows_v2 r WHERE backend_pid IN(${backendPids.join(',')})),
  'writer_scope',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY backend_pid),'[]') FROM private.catalog_checked_scope_v2 r WHERE backend_pid IN(${backendPids.join(',')})));`);
 const assertDeleted=async session=>{
  await query(session,'RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE;');
  assert.equal(await query(session,`SELECT NOT EXISTS(SELECT 1 FROM public.products WHERE id IN(${list(products)}))
   AND NOT EXISTS(SELECT 1 FROM public.promotions WHERE id IN(${list(promotions)}))
   AND (SELECT count(*)=2 AND bool_and(lifetime_state='used' AND last_version=1 AND deleted_at IS NOT NULL) FROM private.catalog_identity_v1 WHERE kind='product' AND id IN(${list(products)}))
   AND (SELECT lifetime_state='unknown' AND deleted_at IS NULL FROM private.catalog_identity_v1 WHERE kind='product' AND id=${uuid(plain)})
   AND NOT EXISTS(SELECT 1 FROM private.catalog_product_delete_scope_v2 WHERE backend_pid=${backendPids[0]})
   AND NOT EXISTS(SELECT 1 FROM private.catalog_product_delete_rows_v2 WHERE backend_pid=${backendPids[0]});`),'t');
 };
 let activated=false,cascade=false,pending=null,originalStructure;
 const launch=(session,blocker,sql)=>{
  const promise=json(session,sql);promise.catch(()=>{});pending={session,blocker,promise};return promise;
 };
 try{
  await verify();
  assert.equal(await query(observer,"SELECT current_database()='pilot_catalogue_test' AND session_user='postgres' AND current_user='postgres' AND (SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton);"),'t');
  originalStructure=await structure();
  assert.equal(await query(observer,`SELECT NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN(${list(actors)}))
   AND NOT EXISTS(SELECT 1 FROM public.products WHERE id IN(${list([...products,plain])}))
   AND NOT EXISTS(SELECT 1 FROM public.customers WHERE id=${uuid(customer)})
   AND NOT EXISTS(SELECT 1 FROM public.promotions WHERE id IN(${list(promotions)}))
   AND NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE id IN(${list([...products,plain,customer])}))
   AND (SELECT count(*)=1 FROM pg_constraint WHERE conrelid='public.promotions'::regclass AND conname='promotions_product_id_fkey' AND confdeltype='a' AND NOT condeferrable AND convalidated)
   AND (SELECT count(*)=2 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid='private.catalog_cutover_v1'::regclass AND conname IN('catalog_foundation_generation_one','catalog_foundation_not_ready'));`),'t');
  // New fixture IDs only; generation-one seeding precedes temporary activation.
  await query(observer,`BEGIN; SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'; SELECT set_config('request.jwt.claim.sub','',true);
   INSERT INTO auth.users(id) VALUES(${uuid(executive)}),(${uuid(po)});
   INSERT INTO public.users(id,full_name,email,role,is_active) VALUES
    (${uuid(executive)},'Fictional native executive','native-executive@example.invalid','executive',true),
    (${uuid(po)},'Fictional native PO','native-po@example.invalid','po_admin',true);
   INSERT INTO public.customers(id,name) VALUES(${uuid(customer)},'Fictional native race customer');
   INSERT INTO public.products(id,name,sku) VALUES ${[...products,plain].map(product=>`(${uuid(product)},'Fictional native race product',${quote(`NATIVE-RACE-${product}`)})`).join(',')};
   INSERT INTO public.promotions(id,product_id,start_date,end_date,created_by,stock_managed,remaining_quantity,stock_version,is_active,image_path) VALUES
    ${promotions.map((promotion,index)=>`(${uuid(promotion)},${uuid(products[index])},current_date,current_date,${uuid(executive)},true,1,1,true,${quote(`promotions/${executive}/${promotion}/${id(301+index)}.png`)})`).join(',')};
   ALTER TABLE private.catalog_cutover_v1 DROP CONSTRAINT catalog_foundation_generation_one,DROP CONSTRAINT catalog_foundation_not_ready;
   UPDATE private.catalog_cutover_v1 SET execution_generation=2,tracking_ready=true WHERE singleton;
   COMMIT;`);activated=true;
  const baseline=await snapshot();
  assert.equal(baseline.products.length,3);assert.equal(baseline.promotions.length,2);assert.equal(baseline.identities.length,4);
  for(const promotion of baseline.promotions){assert.equal(promotion.remaining_quantity,1);assert.equal(promotion.stock_version,1);}
  for(const identity of baseline.identities){assert.equal(identity.lifetime_state,'unknown');assert.equal(identity.deleted_at,null);}
  // Actual original NO ACTION, both authorized native roles. These are real
  // aborted transactions, not exceptions swallowed inside a savepoint.
  for(const actor of actors)for(const order of [products,[...products].reverse()]){
   await start(a,actor);await fail(a,removeStatement(order),'no-action');assert.deepEqual(await snapshot(),baseline);
  }
  await query(observer,`BEGIN; SET LOCAL lock_timeout='8s';
   ALTER TABLE public.promotions DROP CONSTRAINT promotions_product_id_fkey;
   ALTER TABLE public.promotions ADD CONSTRAINT catalogue_fictional_promotion_product_cascade_v2 FOREIGN KEY(product_id) REFERENCES public.products(id) ON DELETE CASCADE;
   COMMIT;`);cascade=true;
  // Only this independently authored promotion edge changes. PO/Girard and
  // private promotion edges stay NO ACTION; the candidate checks the full graph.
  let request=400;
  for(const order of [products,[...products].reverse()]){
   const index=products.indexOf(order[0]);
   // Checked writers first: their final master mode prevents a native upgrade.
   for(const family of ['po','promotion']){
    await start(b,family==='po'?po:executive);
    await json(b,family==='po'?poCommand(id(++request),order):promotionCommand(id(++request),index));
    assert.equal(await query(observer,`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${backendPids[1]} AND relation='public.products'::regclass AND mode='RowShareLock' AND granted);`),'t');
    await start(a,executive);await fail(a,removeStatement(order),'product-relation');
    await query(b,'ROLLBACK;');assert.deepEqual(await snapshot(),baseline);
   }
   // Native first: a checked business command must actually wait on the final
   // products relation lock, then succeed after the native transaction rolls back.
   for(const family of ['po','promotion']){
    await start(a,po);const deleted=await json(a,remove(order));assert.deepEqual(deleted,order);
    await assertDeleted(a);assert.deepEqual(await snapshot(),baseline);
    await start(b,family==='po'?po:executive);
    const waiting=launch(b,a,family==='po'?poCommand(id(++request),order):promotionCommand(id(++request),index));
    await observe(nativeProductDeleteRelationBarrierSql(backendPids[1],backendPids[0]));
    await query(a,'ROLLBACK;');const result=await waiting;pending=null;assert.ok(result.id);
    await query(b,'ROLLBACK;');assert.deepEqual(await snapshot(),baseline);
   }
   // Block the second requested promotion child. Before its cascade completes,
   // the native root must hold its final products mode and no identity evidence
   // write/advisory reservation. Nested promotion statements cannot flush it.
   await start(b,executive);
   const child=promotions[products.indexOf(order[1])];
   assert.equal(await query(b,`SELECT id FROM public.promotions WHERE id=${uuid(child)} FOR UPDATE;`),child);
   await start(a,executive);const waiting=launch(a,b,remove(order));
   await observe(nativeProductDeleteChildBarrierSql(backendPids[0],backendPids[1]));
   assert.equal(await query(observer,`SELECT NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${backendPids[0]} AND relation='private.catalog_identity_v1'::regclass AND mode='RowExclusiveLock')
    AND NOT EXISTS(SELECT 1 FROM pg_locks l JOIN unnest(ARRAY[${list(products)}]) p(id)
     ON l.classid=((hashtextextended('catalog_identity_v1:product:'||p.id::text,1801427913)>>32)&4294967295)::oid
     AND l.objid=(hashtextextended('catalog_identity_v1:product:'||p.id::text,1801427913)&4294967295)::oid
     WHERE l.pid=${backendPids[0]} AND l.locktype='advisory' AND l.objsubid=1
     AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()));`),'t');
   assert.deepEqual(await snapshot(),baseline);
   await query(b,'ROLLBACK;');const deleted=await waiting;pending=null;assert.deepEqual(deleted,order);
   await assertDeleted(a);await query(a,'ROLLBACK;');assert.deepEqual(await snapshot(),baseline);
   // Hold the greatest identity row. The root has already deleted both products
   // and children before its ordered evidence flush reaches this exact NOWAIT.
   // The failure must roll all earlier child/use/tombstone changes back together.
   await query(b,`BEGIN; SET LOCAL lock_timeout='8s'; SELECT id FROM private.catalog_identity_v1 WHERE kind='product' AND id=${uuid(products[1])} FOR UPDATE;`);
   assert.equal(await query(observer,`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${backendPids[1]} AND relation='private.catalog_identity_v1'::regclass AND mode='RowShareLock' AND granted);`),'t');
   await start(a,executive);await fail(a,removeStatement(order),'identity-row');
   await query(b,'ROLLBACK;');assert.deepEqual(await snapshot(),baseline);
  }
  // Both native roles also complete successful multi-row deletes. The first is
  // explicitly rolled back; the final Executive cascade commits observable use.
  await start(a,po);const deleted=await json(a,remove([...products].reverse()));assert.deepEqual(deleted,[...products].reverse());
  await assertDeleted(a);await query(a,'ROLLBACK;');assert.deepEqual(await snapshot(),baseline);
  await start(a,executive);assert.deepEqual(await json(a,remove(products)),products);await assertDeleted(a);await query(a,'COMMIT;');
  await start(a,po);assert.deepEqual(await json(a,remove([plain])),[plain]);await query(a,'SET CONSTRAINTS ALL IMMEDIATE; COMMIT;');
  const final=await snapshot();assert.equal(final.products.length,0);assert.equal(final.promotions.length,0);
  for(const product of products){const identity=final.identities.find(row=>row.id===product);assert.equal(identity.lifetime_state,'used');assert.ok(identity.deleted_at);assert.equal(identity.last_version,1);}
  const plainIdentity=final.identities.find(row=>row.id===plain);assert.equal(plainIdentity.lifetime_state,'unknown');assert.ok(plainIdentity.deleted_at);
  assert.deepEqual(final.identities.find(row=>row.id===customer),baseline.identities.find(row=>row.id===customer));
  for(const key of ['orders','order_requests','promotion_requests','root_scope','root_rows','writer_scope'])assert.deepEqual(final[key],baseline[key]);
  await verify();
 }finally{
  // Release the exact blocker first, settle an in-flight query, then clean up.
  // Never send a second query concurrently on the waiting session.
  if(pending){await query(pending.blocker,'ROLLBACK;');await pending.promise.catch(()=>{});pending=null;}
  await query(a,'ROLLBACK;');await query(b,'ROLLBACK;');await query(observer,'ROLLBACK;');
  if(activated){
   await query(observer,`BEGIN; SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s';
    ${cascade?`ALTER TABLE public.promotions DROP CONSTRAINT catalogue_fictional_promotion_product_cascade_v2;
    ALTER TABLE public.promotions ADD CONSTRAINT promotions_product_id_fkey FOREIGN KEY(product_id) REFERENCES public.products(id);`:''}
    UPDATE private.catalog_cutover_v1 SET execution_generation=1,tracking_ready=false WHERE singleton;
    ALTER TABLE private.catalog_cutover_v1 ADD CONSTRAINT catalog_foundation_generation_one CHECK (execution_generation = 1),ADD CONSTRAINT catalog_foundation_not_ready CHECK (NOT tracking_ready);
    COMMIT;`);
   assert.equal(await query(observer,"SELECT execution_generation=1 AND NOT tracking_ready FROM private.catalog_cutover_v1 WHERE singleton;"),'t');
   assert.deepEqual(await structure(),originalStructure);
  }
 }
 await verify();
 return {status:'BOUNDED_NATIVE_PRODUCT_DELETE_RACES_PASSED',backendPids,cases:nativeProductDeleteRaceCases};
}
