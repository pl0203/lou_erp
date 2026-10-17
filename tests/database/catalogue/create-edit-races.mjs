// Bounded synthetic proof only. No connection/configuration access or auto-run.
// Existing identity-bound CI runtime supplies its live sessions and verifier.
import assert from 'node:assert/strict';
const actor='5e186f1c-c18f-6670-7b74-d7d2f4e8a28e';
const request=n=>`30000000-0000-4000-8000-${String(300+n).padStart(12,'0')}`;
const quote=value=>`'${value.replaceAll("'","''")}'`;
const uuid=value=>{assert.match(value,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);return quote(value)+'::uuid';};
const command=(id,operation,payload)=>`SELECT public.pilot_catalog_transaction_v1(${uuid(id)},${quote(operation)},${quote(JSON.stringify(payload))}::jsonb);`;
const reconcile=(id,abandon=false)=>`SELECT public.pilot_reconcile_catalog_v1(${uuid(id)},${abandon});`;
const createPayload=sku=>({kind:'product',values:{name:'Fictional create/edit race',sku,size:null,harga_pokok:null,luar_kota:0,dalam_kota:12.34,depo_bangunan:null}});
const begin=`BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1500ms'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(actor)},true);`;
export const catalogueCreateEditRaceCases=Object.freeze(['duplicate_create_exact_replay','edit_vs_reenable_both_directions','reconcile_during_blocked_fresh_create']);
export function catalogueWriteRequestBarrierSql(pid,id){
 assert.ok(Number.isSafeInteger(pid)&&pid>0);uuid(id);
 return `WITH k AS (SELECT hashtextextended('catalog_request_v1:'||${uuid(actor)}::text||':'||${uuid(id)}::text,1801427914) AS v)
 SELECT EXISTS(SELECT 1 FROM pg_locks,k WHERE pid=${pid} AND locktype='advisory' AND mode='ExclusiveLock' AND granted
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objsubid=1
 AND classid=((k.v >> 32) & 4294967295)::oid AND objid=(k.v & 4294967295)::oid);`;
}
export function catalogueWriteGateBarrierSql(waiter,blocker){
 for(const pid of [waiter,blocker])assert.ok(Number.isSafeInteger(pid)&&pid>0);assert.notEqual(waiter,blocker);
 return `WITH k AS (SELECT hashtextextended('catalogue_create_edit_gate_v1',1801427925) AS v)
 SELECT EXISTS(SELECT 1 FROM pg_locks,k WHERE pid=${waiter} AND locktype='advisory' AND mode='ExclusiveLock' AND NOT granted
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objsubid=1
 AND classid=((k.v >> 32) & 4294967295)::oid AND objid=(k.v & 4294967295)::oid)
 AND ${blocker}=ANY(pg_blocking_pids(${waiter}));`;
}
function refusal(sql,state,detail){
 assert.ok(['55P03','40001'].includes(state));assert.ok(['CATALOG_REQUEST_BUSY','CATALOG_VERSION_CONFLICT','row-lock'].includes(detail));
 return `DO $write_refusal$ DECLARE detail text; message text; BEGIN BEGIN ${sql.replace(/^SELECT /,'PERFORM ')}
 RAISE EXCEPTION 'Missing create/edit contention' USING ERRCODE='PC810';
 EXCEPTION WHEN SQLSTATE '${state}' THEN GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL,message=MESSAGE_TEXT;
 IF ${detail==='row-lock'?"message !~ '^could not obtain lock on row in relation'":`detail IS DISTINCT FROM '${detail}'`} THEN
 RAISE EXCEPTION 'Wrong create/edit contention' USING ERRCODE='PC811'; END IF; RAISE; END; END $write_refusal$;`;
}
function receipt(value,{id,operation,beforeVersion,afterVersion,beforeEnabled=true,afterEnabled=true}){
 assert.equal(value.version,1);assert.equal(value.actor_id,actor);assert.equal(value.request_id,id);assert.equal(value.operation,operation);assert.equal(value.kind,'product');uuid(value.id);
 assert.deepEqual(value.before,beforeVersion===null?null:{catalog_version:beforeVersion,is_enabled:beforeEnabled});
 assert.deepEqual(value.after,{catalog_version:afterVersion,is_enabled:afterEnabled});
 assert.match(value.committed_at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
 assert.deepEqual(Object.keys(value).sort(),['version','request_id','actor_id','operation','kind','id','before','after','committed_at'].sort());return value;
}
export async function executeCatalogueCreateEditRaces({a,b,observer,query,expectState,verify}){
 assert.notEqual(a,b);assert.notEqual(a,observer);assert.notEqual(b,observer);assert.equal(typeof query,'function');assert.equal(typeof expectState,'function');assert.equal(typeof verify,'function');
 const json=async(s,sql)=>JSON.parse(await query(s,sql));
 const pids=await Promise.all([a,b,observer].map(async s=>Number(await query(s,'SELECT pg_backend_pid();'))));
 assert.equal(new Set(pids).size,3);assert.ok(pids.every(pid=>Number.isSafeInteger(pid)&&pid>0));
 const start=async s=>{await query(s,begin);assert.equal(await query(s,`SELECT current_user='authenticated' AND auth.uid()=${uuid(actor)} AND row_security_active('public.products') AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls));`),'t');};
 const fail=async(s,sql,state,detail)=>{await expectState(s,refusal(sql,state,detail),state);await expectState(s,'SELECT 1;','25P02');await query(s,'ROLLBACK;');};
 let gateInstalled=false,pending;
 try{
  await verify();
  await start(a);const firstPayload=createPayload('CATALOGUE-RACE-CREATE-ONE');
  const original=receipt(await json(a,command(request(1),'create',firstPayload)),{id:request(1),operation:'create',beforeVersion:null,afterVersion:'1'});
  assert.equal(await query(observer,catalogueWriteRequestBarrierSql(pids[0],request(1))),'t');
  assert.equal(await query(observer,`SELECT NOT EXISTS(SELECT 1 FROM public.products WHERE sku='CATALOGUE-RACE-CREATE-ONE') AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE actor_id=${uuid(actor)} AND request_id=${uuid(request(1))});`),'t');
  await start(b);await fail(b,command(request(1),'create',firstPayload),'55P03','CATALOG_REQUEST_BUSY');
  await query(a,'COMMIT;');
  await start(b);assert.deepEqual(await json(b,command(request(1),'create',firstPayload)),original);assert.deepEqual(await json(b,reconcile(request(1))),{status:'committed',receipt:original});await query(b,'COMMIT;');
  const target=original.id;
  assert.equal(await query(observer,`SELECT (SELECT count(*)=1 FROM public.products WHERE sku='CATALOGUE-RACE-CREATE-ONE') AND (SELECT count(*)=1 FROM private.catalog_requests_v1 WHERE actor_id=${uuid(actor)} AND request_id=${uuid(request(1))}) AND (SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='product' AND id=${uuid(target)});`),'t');
  await verify();

  const status=(id,version,enabled)=>command(id,'set_enabled',{kind:'product',id:target,expected_version:version,is_enabled:enabled});
  const edit=(id,version,name)=>command(id,'edit',{kind:'product',id:target,expected_version:version,values:{name}});
  await start(a);receipt(await json(a,status(request(2),'1',false)),{id:request(2),operation:'set_enabled',beforeVersion:'1',afterVersion:'2',afterEnabled:false});await query(a,'COMMIT;');
  await start(a);const edited=receipt(await json(a,edit(request(3),'2','Edited while disabled')),{id:request(3),operation:'edit',beforeVersion:'2',afterVersion:'3',beforeEnabled:false,afterEnabled:false});
  assert.equal(await query(observer,catalogueWriteRequestBarrierSql(pids[0],request(3))),'t');
  assert.equal(await query(observer,`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pids[0]} AND locktype='relation' AND relation='public.products'::regclass AND mode='RowExclusiveLock' AND granted);`),'t');
  await start(b);await fail(b,status(request(4),'2',true),'55P03','row-lock');await query(a,'COMMIT;');
  await start(b);await fail(b,status(request(4),'2',true),'40001','CATALOG_VERSION_CONFLICT');
  await start(b);receipt(await json(b,status(request(5),'3',true)),{id:request(5),operation:'set_enabled',beforeVersion:'3',afterVersion:'4',beforeEnabled:false});await query(b,'COMMIT;');
  await start(a);receipt(await json(a,status(request(6),'4',false)),{id:request(6),operation:'set_enabled',beforeVersion:'4',afterVersion:'5',afterEnabled:false});await query(a,'COMMIT;');
  await start(a);receipt(await json(a,status(request(7),'5',true)),{id:request(7),operation:'set_enabled',beforeVersion:'5',afterVersion:'6',beforeEnabled:false});
  assert.equal(await query(observer,catalogueWriteRequestBarrierSql(pids[0],request(7))),'t');
  await start(b);await fail(b,edit(request(8),'5','Stale disabled edit'),'55P03','row-lock');await query(a,'COMMIT;');
  await start(b);await fail(b,edit(request(8),'5','Stale disabled edit'),'40001','CATALOG_VERSION_CONFLICT');
  await start(b);assert.deepEqual(await json(b,reconcile(request(3))),{status:'committed',receipt:edited});await query(b,'COMMIT;');
  assert.equal(await query(observer,`SELECT (SELECT catalog_version=6 AND is_enabled AND name='Edited while disabled' FROM public.products WHERE id=${uuid(target)}) AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE actor_id=${uuid(actor)} AND request_id IN(${uuid(request(4))},${uuid(request(8))}));`),'t');
  await verify();

  // A synthetic BEFORE trigger stops the fresh create after its pending request
  // admission and before any real master/evidence row event. The observer proves
  // the precise database barrier in pg_locks; elapsed time never proves success.
  await query(observer,`CREATE FUNCTION pg_temp.catalogue_write_gate_v1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.sku='CATALOGUE-RACE-CREATE-GATED' THEN PERFORM pg_advisory_xact_lock(hashtextextended('catalogue_create_edit_gate_v1',1801427925)); END IF; RETURN NEW; END $$;
    CREATE TRIGGER aaa_catalogue_write_gate_v1 BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION pg_temp.catalogue_write_gate_v1();`);gateInstalled=true;
  await query(observer,"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('catalogue_create_edit_gate_v1',1801427925));");
  await start(a);await query(a,"SET LOCAL lock_timeout='6s';");const gatedPayload=createPayload('CATALOGUE-RACE-CREATE-GATED');pending=json(a,command(request(9),'create',gatedPayload));pending.catch(()=>{});
  let observed=false;
  for(let attempt=0;attempt<200;attempt++){
   if(await query(observer,catalogueWriteGateBarrierSql(pids[0],pids[2]))==='t'){observed=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(observed,true,'Exact live advisory wait must be observed before testing reconciliation');
  assert.equal(await query(observer,catalogueWriteRequestBarrierSql(pids[0],request(9))),'t');
  for(const abandon of [false,true]){await start(b);await fail(b,reconcile(request(9),abandon),'55P03','CATALOG_REQUEST_BUSY');}
  assert.equal(await query(observer,`SELECT NOT EXISTS(SELECT 1 FROM public.products WHERE sku='CATALOGUE-RACE-CREATE-GATED') AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE actor_id=${uuid(actor)} AND request_id=${uuid(request(9))});`),'t');
  await query(observer,'COMMIT;');const created=receipt(await pending,{id:request(9),operation:'create',beforeVersion:null,afterVersion:'1'});pending=null;await query(a,'COMMIT;');
  await start(b);assert.deepEqual(await json(b,reconcile(request(9))),{status:'committed',receipt:created});assert.deepEqual(await json(b,command(request(9),'create',gatedPayload)),created);await query(b,'COMMIT;');
  assert.equal(await query(observer,`SELECT (SELECT count(*)=1 FROM public.products WHERE sku='CATALOGUE-RACE-CREATE-GATED') AND NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE status='pending');`),'t');
  await query(observer,'DROP TRIGGER aaa_catalogue_write_gate_v1 ON public.products; DROP FUNCTION pg_temp.catalogue_write_gate_v1();');gateInstalled=false;
  await verify();return {status:'BOUNDED_CATALOGUE_CREATE_EDIT_RACES_PASSED',backendPids:pids,cases:catalogueCreateEditRaceCases};
 }finally{
  // Release an owned gate before awaiting an in-flight query, never issue two
  // concurrent commands on one session or leave test locks for the next suite.
  await query(observer,'ROLLBACK;');if(pending)await pending.catch(()=>{});
  await query(a,'ROLLBACK;');await query(b,'ROLLBACK;');
  if(gateInstalled)await query(observer,'DROP TRIGGER aaa_catalogue_write_gate_v1 ON public.products; DROP FUNCTION pg_temp.catalogue_write_gate_v1();');
 }
}
