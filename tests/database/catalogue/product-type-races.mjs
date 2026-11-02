// Authored native-PG cases. No connection discovery or auto-run; the existing
// identity-bound disposable CI runtime supplies three live sessions and verifier.
import assert from 'node:assert/strict';
import {catalogueWriteRequestBarrierSql} from './create-edit-races.mjs';
const actor='5e186f1c-c18f-6670-7b74-d7d2f4e8a28e';
const request=n=>`71000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const quote=value=>`'${value.replaceAll("'","''")}'`;
const uuid=value=>{assert.match(value,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);return quote(value)+'::uuid';};
const command=(id,operation,payload)=>`SELECT public.pilot_catalog_transaction_v2(${uuid(id)},${quote(operation)},${quote(JSON.stringify(payload))}::jsonb);`;
const reconcile=id=>`SELECT public.pilot_reconcile_catalog_v1(${uuid(id)},false);`;
const begin=`BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1500ms'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(actor)},true);`;
export const productTypeRaceCases=Object.freeze(['duplicate_type_create_exact_replay','concurrent_type_edit_version_conflict','actor_cutoff_refuses_write_and_recovery']);
function receipt(value,id,operation,before,after){
 assert.equal(value.version,1);assert.equal(value.actor_id,actor);assert.equal(value.request_id,id);assert.equal(value.operation,operation);assert.equal(value.kind,'product');uuid(value.id);
 assert.deepEqual(value.before,before===null?null:{catalog_version:before,is_enabled:true});
 assert.deepEqual(value.after,{catalog_version:after,is_enabled:true});
 assert.match(value.committed_at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
 assert.deepEqual(Object.keys(value).sort(),['version','request_id','actor_id','operation','kind','id','before','after','committed_at'].sort());return value;
}
function refusal(sql,state,detail){
 assert.ok(['55P03','40001','42501'].includes(state));
 assert.ok([null,'CATALOG_REQUEST_BUSY','CATALOG_VERSION_CONFLICT','row-lock'].includes(detail));
 const check=detail===null?'false':detail==='row-lock'?"message !~ '^could not obtain lock on row in relation'":`detail IS DISTINCT FROM ${quote(detail)}`;
 return `DO $type_refusal$ DECLARE detail text;message text;BEGIN BEGIN ${sql.replace(/^SELECT /,'PERFORM ')}
 RAISE EXCEPTION 'Expected Tipe refusal' USING ERRCODE='PT810';
 EXCEPTION WHEN SQLSTATE '${state}' THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL,message=MESSAGE_TEXT;
 IF ${check} THEN RAISE EXCEPTION 'Wrong Tipe refusal' USING ERRCODE='PT811'; END IF;RAISE;END;END $type_refusal$;`;
}
export async function executeProductTypeRaces({a,b,observer,query,expectState,verify}){
 assert.ok(a&&b&&observer);assert.notEqual(a,b);assert.notEqual(a,observer);assert.notEqual(b,observer);
 for(const fn of [query,expectState,verify])assert.equal(typeof fn,'function');
 const json=async(s,sql)=>JSON.parse(await query(s,sql));
 const pids=await Promise.all([a,b,observer].map(async s=>Number(await query(s,'SELECT pg_backend_pid();'))));
 assert.equal(new Set(pids).size,3);assert.ok(pids.every(pid=>Number.isSafeInteger(pid)&&pid>0));
 const start=async s=>{await query(s,begin);assert.equal(await query(s,`SELECT current_user='authenticated' AND auth.uid()=${uuid(actor)} AND row_security_active('public.products') AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls));`),'t','Native authenticated RLS must be active; standalone is not proof');};
 const fail=async(s,sql,state,detail=null)=>{await expectState(s,refusal(sql,state,detail),state);await expectState(s,'SELECT 1;','25P02');await query(s,'ROLLBACK;');};
 let actorTouched=false;
 try{
  await verify();
  assert.equal(await query(observer,`SELECT is_active FROM public.users WHERE id=${uuid(actor)};`),'t','Known synthetic actor must start active');
  assert.equal(await query(observer,"SELECT NOT EXISTS(SELECT 1 FROM public.products WHERE sku='CATALOGUE-TYPE-RACE-ONE') AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE request_id::text LIKE '71000000-0000-4000-8000-%');"),'t','Fresh dedicated Tipe fixture required');
  const payload={kind:'product',values:{name:'Fictional Tipe race',sku:'CATALOGUE-TYPE-RACE-ONE',size:null,harga_pokok:null,luar_kota:0,dalam_kota:12.34,depo_bangunan:null,product_type:'Bonbon'}};
  await start(a);const created=receipt(await json(a,command(request(1),'create',payload)),request(1),'create',null,'1');const target=created.id;
  assert.equal(await query(observer,catalogueWriteRequestBarrierSql(pids[0],request(1))),'t');
  assert.equal(await query(observer,`SELECT NOT EXISTS(SELECT 1 FROM public.products WHERE id=${uuid(target)}) AND NOT EXISTS(SELECT 1 FROM private.catalog_product_type_audit_v2 WHERE product_id=${uuid(target)});`),'t');
  await start(b);await fail(b,command(request(1),'create',payload),'55P03','CATALOG_REQUEST_BUSY');await query(a,'COMMIT;');
  await start(b);assert.deepEqual(await json(b,command(request(1),'create',payload)),created);assert.deepEqual(await json(b,reconcile(request(1))),{status:'committed',receipt:created});await query(b,'COMMIT;');
  assert.equal(await query(observer,`SELECT (SELECT count(*)=1 FROM public.products WHERE id=${uuid(target)} AND product_type='Bonbon' AND catalog_version=1) AND (SELECT count(*)=1 FROM private.catalog_product_type_audit_v2 WHERE product_id=${uuid(target)} AND actor_id=${uuid(actor)} AND old_type IS NULL AND new_type='Bonbon' AND old_catalog_version IS NULL AND new_catalog_version=1);`),'t');
  await verify();
  const edit=(id,version,type)=>command(id,'edit',{kind:'product',id:target,expected_version:version,values:{product_type:type}});
  await start(a);const firstEdit=receipt(await json(a,edit(request(2),'1','Mosaic')),request(2),'edit','1','2');
  assert.equal(await query(observer,catalogueWriteRequestBarrierSql(pids[0],request(2))),'t');
  assert.equal(await query(observer,`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pids[0]} AND locktype='relation' AND relation='public.products'::regclass AND mode='RowExclusiveLock' AND granted);`),'t');
  await start(b);await fail(b,edit(request(3),'1','Granite'),'55P03','row-lock');await query(a,'COMMIT;');
  await start(b);await fail(b,edit(request(3),'1','Granite'),'40001','CATALOG_VERSION_CONFLICT');
  await start(b);receipt(await json(b,edit(request(4),'2','Granite')),request(4),'edit','2','3');assert.deepEqual(await json(b,reconcile(request(2))),{status:'committed',receipt:firstEdit});await query(b,'COMMIT;');
  const expectedAudit=[{old_type:null,new_type:'Bonbon',old_version:null,new_version:'1'},{old_type:'Bonbon',new_type:'Mosaic',old_version:'1',new_version:'2'},{old_type:'Mosaic',new_type:'Granite',old_version:'2',new_version:'3'}];
  const auditSql=`SELECT coalesce(jsonb_agg(jsonb_build_object('old_type',old_type,'new_type',new_type,'old_version',old_catalog_version::text,'new_version',new_catalog_version::text) ORDER BY new_catalog_version),'[]'::jsonb) FROM private.catalog_product_type_audit_v2 WHERE product_id=${uuid(target)};`;
  assert.deepEqual(await json(observer,auditSql),expectedAudit);
  assert.equal(await query(observer,`SELECT (SELECT product_type='Granite' AND catalog_version=3 FROM public.products WHERE id=${uuid(target)}) AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE actor_id=${uuid(actor)} AND request_id=${uuid(request(3))});`),'t');
  await verify();
  // Separate committed synthetic actor change, not a forged JWT-role claim.
  // Original activity is asserted above and restored in finally, including errors.
  actorTouched=true;await query(observer,`BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='1500ms';UPDATE public.users SET is_active=false WHERE id=${uuid(actor)};COMMIT;`);
  assert.equal(await query(observer,`SELECT NOT is_active FROM public.users WHERE id=${uuid(actor)};`),'t');
  for(const sql of [edit(request(5),'3','Meja'),reconcile(request(1)),command(request(1),'create',payload)]){
   await start(b);await fail(b,sql,'42501');
  }
  assert.deepEqual(await json(observer,auditSql),expectedAudit);
  assert.equal(await query(observer,`SELECT (SELECT product_type='Granite' AND catalog_version=3 FROM public.products WHERE id=${uuid(target)}) AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE request_id=${uuid(request(5))}) AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE status='pending');`),'t');
  await query(observer,`UPDATE public.users SET is_active=true WHERE id=${uuid(actor)};`);actorTouched=false;
  await start(b);assert.deepEqual(await json(b,reconcile(request(1))),{status:'committed',receipt:created});await query(b,'COMMIT;');
  await verify();return {status:'BOUNDED_PRODUCT_TYPE_RACES_PASSED',backendPids:pids,cases:productTypeRaceCases};
 }finally{
  // Always attempt every independent session cleanup and actor restoration,
  // even when one connection has already failed. Never report success on cleanup failure.
  const cleanup=await Promise.allSettled([a,b,observer].map(s=>query(s,'ROLLBACK;')));
  if(actorTouched)await query(observer,`UPDATE public.users SET is_active=true WHERE id=${uuid(actor)};`);
  assert.ok(cleanup.every(result=>result.status==='fulfilled'),'Tipe race session cleanup failed');
 }
}
