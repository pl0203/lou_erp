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
test('native relation refusal matches the exact schema-qualified PostgreSQL LOCK target',async()=>{
 // PG17 namespace.c RangeVarGetRelidExtended preserves the LOCK schema;
 // this is not the unqualified heap tuple-lock error path.
 const {nativeProductDeleteRefusalSql:refusal}=await load();
 const relation=refusal('DELETE FROM public.products WHERE false;','product-relation');
 assert.ok(relation.includes(`IF message IS DISTINCT FROM 'could not obtain lock on relation "public.products"' THEN`));
 assert.match(relation,/EXCEPTION WHEN SQLSTATE '55P03'/);
 assert.doesNotMatch(relation,/lock timeout|could not obtain lock on relation "products"/);
 assert.ok(refusal('DELETE FROM public.products WHERE false;','identity-row').includes(`IF message IS DISTINCT FROM 'could not obtain lock on row in relation "catalog_identity_v1"' THEN`));
 const candidate=readFileSync(new URL('../../supabase/catalogue/v1/new09-checked-boundaries.sql',import.meta.url),'utf8');
 assert.match(candidate,/LOCK TABLE public\.products IN EXCLUSIVE MODE NOWAIT;/);
});
test('native promotion seed satisfies the checked PO demand without changing optimistic versions',()=>{
 const source=readFileSync(sourceUrl,'utf8');
 const demand=source.match(/const poCommand=[^\n]+quantity:(\d+)/);
 const seed=source.match(/stock_managed,remaining_quantity,stock_version,is_active,image_path\) VALUES\s*\n\s*\$\{promotions\.map[^\n]+,true,(\d+),(\d+),true,/);
 assert.ok(demand);assert.ok(seed);
 assert.equal(Number(seed[1]),Number(demand[1]),'each active promotion must cover the rollback-only PO quantity, not trigger a stock warning');
 assert.equal(Number(seed[1]),1);assert.equal(Number(seed[2]),1);
 assert.match(source,/for\(const promotion of baseline\.promotions\)\{assert\.equal\(promotion\.remaining_quantity,1\);assert\.equal\(promotion\.stock_version,1\);\}/);
 assert.match(source,/expected_stock_version:1/);
 assert.match(source,/for\(const family of \['po','promotion'\]\)/);
 assert.doesNotMatch(source,/promo_stock_ack/,'do not manufacture an acknowledgment to bypass the stock warning');
 const producer=readFileSync(new URL('../../supabase/migrations/202610081101_demo_order_promotions.sql',import.meta.url),'utf8');
 assert.match(producer,/IF promotion\.id IS NOT NULL AND demand>promotion\.remaining_quantity THEN/);
 assert.match(producer,/ELSIF NOT \(payload \? 'promo_stock_ack'\) AND jsonb_array_length\(shortages\)>0 THEN\s*RAISE EXCEPTION 'Promo stock requires confirmation' USING ERRCODE='PT409'/);
});
test('native child barrier uses a verified owner blocker without changing real writer roles',()=>{
 const source=readFileSync(sourceUrl,'utf8');
 const start=source.indexOf('// Block the second requested promotion child.');
 const end=source.indexOf('// Hold the greatest identity row.',start);
 assert.ok(start>=0&&end>start);
 const child=source.slice(start,end);
 assert.match(child,/await query\(b,`BEGIN; SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'; SET LOCAL idle_in_transaction_session_timeout='30s';\s*SELECT set_config\('request\.jwt\.claim\.sub','',true\);`\);/);
 const ownerCheck=`assert.equal(await query(b,"SELECT current_user='postgres' AND session_user='postgres' AND auth.uid() IS NULL;"),'t');`;
 assert.ok(child.includes(ownerCheck),'synthetic blocker must verify owner and empty authentication claim');
 assert.ok(child.indexOf(ownerCheck)<child.indexOf('SELECT id FROM public.promotions'));
 assert.match(child,/SELECT id FROM public\.promotions WHERE id=\$\{uuid\(child\)\} FOR UPDATE;/);
 assert.doesNotMatch(child,/await start\(b,|SET LOCAL ROLE|GRANT\b|REVOKE\b/);
 assert.match(child,/await start\(a,executive\);const waiting=launch\(a,b,remove\(order\)\);/);
 assert.match(child,/await observe\(nativeProductDeleteChildBarrierSql\(backendPids\[0\],backendPids\[1\]\)\);/);
 assert.match(child,/await query\(b,'ROLLBACK;'\);const deleted=await waiting;/);
 assert.equal((source.match(/await start\(b,family==='po'\?po:executive\);/g)||[]).length,2);
 const producer=readFileSync(new URL('../../supabase/migrations/202610081101_demo_order_promotions.sql',import.meta.url),'utf8');
 assert.match(producer,/REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public\.promotions FROM PUBLIC,anon,authenticated;/);
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
