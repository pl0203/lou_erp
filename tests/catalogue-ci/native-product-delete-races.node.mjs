import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const sourceUrl=new URL('../database/catalogue/native-product-delete-races.mjs',import.meta.url);
const load=()=>import(sourceUrl.href);
// These source-only checks do not execute a database race or establish SQL validity.
test('native product deletion has a bounded supplied-session proof module',async()=>{
 assert.ok(existsSync(sourceUrl),'Missing native product deletion concurrency proof');
 const {executeNativeProductDeleteRaces,nativeProductDeleteRaceCases}=await load();
 assert.equal(typeof executeNativeProductDeleteRaces,'function');
 assert.deepEqual(nativeProductDeleteRaceCases,[
  'native_no_action_po_and_executive','native_multi_product_both_orders',
  'checked_po_first_native_nowait','checked_promotion_first_native_nowait',
  'native_first_checked_po_wait','native_first_checked_promotion_wait',
  'promotion_child_wait_root_flush','identity_refusal_atomic_cascade_rollback',
  'native_committed_cascade_and_plain_provenance'
 ]);
 assert.ok(Object.isFrozen(nativeProductDeleteRaceCases));
});
test('native barriers identify the exact waiter, blocker, mode and relation',async()=>{
 const {nativeProductDeleteRelationBarrierSql:relation,nativeProductDeleteChildBarrierSql:child}=await load();
 for(const sql of [relation(123,124),child(123,124)]){
  for(const token of ['pg_locks','pg_blocking_pids','NOT granted',"'public.products'::regclass","mode='ExclusiveLock'",'pid=123','pid=124'])assert.ok(sql.includes(token),token);
 }
 assert.match(relation(123,124),/mode='RowShareLock'/);
 assert.match(child(123,124),/transactionid.*tuple/);
 assert.match(child(123,124),/'public.promotions'::regclass/);
 assert.throws(()=>relation(123,123));assert.throws(()=>child('123',124));assert.throws(()=>child(123,-1));
});
test('native refusal proofs discriminate NOWAIT and original FK from timeouts',async()=>{
 const {nativeProductDeleteRefusalSql:refusal}=await load();
 for(const reason of ['product-relation','identity-row','no-action']){
  const sql=refusal('DELETE FROM public.products WHERE false;',reason);
  assert.match(sql,/GET STACKED DIAGNOSTICS/);assert.match(sql,/RAISE;/);
  assert.match(sql,/Wrong native delete refusal/);
  assert.ok(sql.includes(reason==='no-action'?'CONSTRAINT_NAME':'MESSAGE_TEXT'));
 }
 assert.match(refusal('DELETE FROM public.products WHERE false;','no-action'),/promotions_product_id_fkey/);
 assert.match(refusal('DELETE FROM public.products WHERE false;','identity-row'),/could not obtain lock on row in relation "catalog_identity_v1"/);
 assert.throws(()=>refusal('DELETE FROM public.products;','timeout'));
});
test('native execution rejects missing verifier or aliased sessions before SQL',async()=>{
 const {executeNativeProductDeleteRaces:run}=await load();
 await assert.rejects(run({a:{},b:{},observer:{}}));
 const same={};await assert.rejects(run({a:same,b:same,observer:{},query(){throw Error('No SQL allowed');},expectState(){},verify(){}}));
});
test('native proof stays fictional and restores inactive generation and exact FK structure',()=>{
 const source=readFileSync(sourceUrl,'utf8');
 assert.doesNotMatch(source,/process\.env|execFile|spawn\(|readFile|dotenv|CREATE OR REPLACE|DISABLE TRIGGER/);
 for(const token of ['await verify()','25P02','observed,true','catalog_foundation_generation_one CHECK (execution_generation = 1)',
  'catalog_foundation_not_ready CHECK (NOT tracking_ready)','catalogue_fictional_promotion_product_cascade_v2',
  'ADD CONSTRAINT promotions_product_id_fkey FOREIGN KEY(product_id) REFERENCES public.products(id)',
  'assert.deepEqual(await structure(),originalStructure)','public.pilot_order_transaction(',
  'public.pilot_promotion_transaction_v1(','RETURNING p.id','assert.deepEqual(deleted,order)',
  'assert.deepEqual(await snapshot(),baseline)','SET CONSTRAINTS ALL IMMEDIATE',
  'private.catalog_product_delete_scope_v2','private.catalog_product_delete_rows_v2'])assert.ok(source.includes(token),token);
 assert.ok(source.indexOf('INSERT INTO public.promotions')<source.indexOf('SET execution_generation=2'));
 assert.match(source,/for\(const order of \[products,\[\.\.\.products\]\.reverse\(\)\]\)/);
});
