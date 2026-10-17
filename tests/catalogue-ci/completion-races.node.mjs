import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalogueCompletionRaceCases,completionRequestBarrierSql,completionRowWaitSql,completionRefusalSql,executeCatalogueCompletionRaces} from '../database/catalogue/completion-races.mjs';
test('busy proofs distinguish NOWAIT/request refusal from lock timeout',()=>{
 for(const reason of ['customer-row','product-relation','request','cutover-row']){
  const sql=completionRefusalSql('SELECT 1;',reason);
  assert.match(sql,/GET STACKED DIAGNOSTICS/);
  assert.match(sql,/MESSAGE_TEXT/);
  assert.match(sql,/Wrong completion busy refusal/);
  assert.ok(sql.includes(reason==='request'?'CATALOG_REQUEST_BUSY':'could not obtain lock on'));
 }
 assert.throws(()=>completionRefusalSql('SELECT 1;','timeout'));
});
test('completion relation refusal matches the exact schema-qualified PostgreSQL LOCK target',()=>{
 // PG17 namespace.c RangeVarGetRelidExtended includes the explicit schema;
 // heap tuple NOWAIT messages still use only the relation name.
 const relation=completionRefusalSql('SELECT 1;','product-relation');
 assert.ok(relation.includes(`IF message IS DISTINCT FROM 'could not obtain lock on relation "public.products"' THEN`));
 assert.match(relation,/EXCEPTION WHEN SQLSTATE '55P03'/);
 assert.doesNotMatch(relation,/lock timeout|could not obtain lock on relation "products"/);
 assert.ok(completionRefusalSql('SELECT 1;','customer-row').includes(`IF message IS DISTINCT FROM 'could not obtain lock on row in relation "customers"' THEN`));
 assert.ok(completionRefusalSql('SELECT 1;','cutover-row').includes(`IF message IS DISTINCT FROM 'could not obtain lock on row in relation "catalog_cutover_v1"' THEN`));
 assert.ok(completionRefusalSql('SELECT 1;','request').includes("IF detail IS DISTINCT FROM 'CATALOG_REQUEST_BUSY' THEN"));
 const candidate=readFileSync(new URL('../../supabase/catalogue/v1/new10-guarded-delete.sql',import.meta.url),'utf8');
 assert.match(candidate,/LOCK TABLE public\.products IN EXCLUSIVE MODE NOWAIT;/);
});
test('completion barriers bind exact sessions and transaction request identity',()=>{
 const id='30000000-0000-4000-8000-000000000701';
 const sql=completionRequestBarrierSql(123,124,id);
 for(const token of ['pg_locks','pg_blocking_pids','objsubid=1','current_database()','catalog_target_request_v1:'])assert.ok(sql.includes(token));
 assert.match(completionRowWaitSql(123,124),/transactionid.*tuple/);
 assert.throws(()=>completionRequestBarrierSql(123,123,id));
 assert.throws(()=>completionRequestBarrierSql(123,124,"'; SELECT true;"));
 assert.throws(()=>completionRowWaitSql('123',124));
});
test('completion execution requires supplied distinct sessions and verifier',async()=>{
 await assert.rejects(executeCatalogueCompletionRaces({a:{},b:{},observer:{}}));
 const same={};await assert.rejects(executeCatalogueCompletionRaces({a:same,b:same,observer:{},query(){},expectState(){},verify(){}}));
 assert.deepEqual(catalogueCompletionRaceCases,['target_duplicate_commit_replay','target_use_blocks_unused_delete','delete_commit_refuses_target_save','product_relation_busy_then_delete','delete_request_busy_replay','truncate_drain_busy_then_refused']);
});
test('completion races cannot discover connections and restore inactive constraints',()=>{
 const sql=readFileSync(new URL('../database/catalogue/completion-races.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/process\.env|execFile|spawn\(|readFile|dotenv/);
 for(const token of ['25P02','catalog_foundation_generation_one CHECK (execution_generation = 1)','catalog_foundation_not_ready CHECK (NOT tracking_ready)','await verify()','observed,true'])assert.ok(sql.includes(token));
});
