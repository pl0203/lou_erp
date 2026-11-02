import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeProductTypeRaces,productTypeRaceCases} from '../database/catalogue/product-type-races.mjs';
function harness({rls=true,wrongVersion=false}={}){
 const a={},b={},observer={},sessions=[a,b,observer],calls=[],errors=[],receipts=new Map();let checks=0;
 const target='72000000-0000-4000-8000-000000000001';
 const audit=[{old_type:null,new_type:'Bonbon',old_version:null,new_version:'1'},{old_type:'Bonbon',new_type:'Mosaic',old_version:'1',new_version:'2'},{old_type:'Mosaic',new_type:'Granite',old_version:'2',new_version:'3'}];
 async function query(s,sql){
  calls.push({session:s,sql});
  if(sql==='SELECT pg_backend_pid();')return String(sessions.indexOf(s)+101);
  if(sql.includes("current_user='authenticated'"))return rls?'t':'f';
  const command=sql.match(/^SELECT public\.pilot_catalog_transaction_v2\('([^']+)'::uuid,'([^']+)','(.+)'::jsonb\);$/);
  if(command){
   const [,id,operation,raw]=command,payload=JSON.parse(raw);if(receipts.has(id))return JSON.stringify(receipts.get(id));
   const before=operation==='create'?null:{catalog_version:payload.expected_version,is_enabled:true};
   const receipt={version:1,actor_id:'5e186f1c-c18f-6670-7b74-d7d2f4e8a28e',request_id:id,operation,kind:'product',id:target,before,after:{catalog_version:wrongVersion?'999':operation==='create'?'1':String(BigInt(payload.expected_version)+1n),is_enabled:true},committed_at:'2026-11-02T00:00:00Z'};
   receipts.set(id,receipt);return JSON.stringify(receipt);
  }
  const recover=sql.match(/^SELECT public\.pilot_reconcile_catalog_v1\('([^']+)'::uuid,false\);$/);
  if(recover){assert.ok(receipts.has(recover[1]));return JSON.stringify({status:'committed',receipt:receipts.get(recover[1])});}
  if(sql.startsWith('SELECT coalesce(jsonb_agg('))return JSON.stringify(audit);
  if(sql.startsWith('SELECT ')||sql.startsWith('WITH k AS '))return 't';
  return '';
 }
 return {args:{a,b,observer,query,expectState:async(s,sql,state)=>{errors.push({s,sql,state});},verify:async()=>{checks++;}},calls,errors,checks:()=>checks};
}
test('Tipe races require distinct supplied sessions and explicit verifier/error adapter',async()=>{
 const same={};await assert.rejects(executeProductTypeRaces({a:same,b:same,observer:{},query:()=>{},expectState:()=>{},verify:()=>{}}));
 await assert.rejects(executeProductTypeRaces({a:{},b:{},observer:{},query:()=>{},verify:()=>{}}));
 assert.deepEqual(productTypeRaceCases,['duplicate_type_create_exact_replay','concurrent_type_edit_version_conflict','actor_cutoff_refuses_write_and_recovery']);
});
test('scripted adapter exercises orchestration only, preserving error and barrier checks',async()=>{
 const h=harness();const result=await executeProductTypeRaces(h.args);
 assert.equal(result.status,'BOUNDED_PRODUCT_TYPE_RACES_PASSED');assert.deepEqual(result.backendPids,[101,102,103]);assert.equal(h.checks(),4);
 assert.deepEqual(h.errors.filter(e=>e.state!=='25P02').map(e=>e.state),['55P03','55P03','40001','42501','42501','42501']);
 assert.equal(h.errors.filter(e=>e.state==='25P02').length,6);
 const sql=h.calls.map(c=>c.sql).join('\n');
 assert.match(sql,/pg_locks/);assert.match(sql,/row_security_active/);assert.match(sql,/actor_id=/);assert.match(sql,/new_catalog_version/);assert.match(sql,/SET is_active=false/);assert.match(sql,/SET is_active=true/);
});
test('false RLS observation or malformed receipt stops instead of reporting native success',async()=>{
 for(const opts of [{rls:false},{wrongVersion:true}]){const h=harness(opts);await assert.rejects(executeProductTypeRaces(h.args));assert.equal(h.calls.filter(c=>c.sql==='ROLLBACK;').length,3);}
});
test('runner discovers no connection or secrets and never auto-runs',()=>{
 const source=readFileSync(new URL('../database/catalogue/product-type-races.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/process\.env|execFile|spawn\(|readFile|dotenv|postgres --single/);
 assert.match(source,/await verify\(\)/);assert.match(source,/status='pending'/);assert.match(source,/if\(actorTouched\)/);
});

test('actor restoration is attempted if cutoff verification fails',async()=>{
 const h=harness();const original=h.args.expectState;
 h.args.expectState=async(s,sql,state)=>{if(state==='42501')throw new Error('synthetic verification failure');return original(s,sql,state);};
 await assert.rejects(executeProductTypeRaces(h.args),/synthetic verification failure/);
 assert.ok(h.calls.some(c=>c.sql.includes('SET is_active=false')));
 assert.ok(h.calls.some(c=>c.sql.includes('SET is_active=true')));
 assert.equal(h.calls.slice(-4).filter(c=>c.sql==='ROLLBACK;').length,3);
});
