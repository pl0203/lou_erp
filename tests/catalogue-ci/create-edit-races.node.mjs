import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogueWriteRequestBarrierSql, catalogueWriteGateBarrierSql, catalogueCreateEditRaceCases, executeCatalogueCreateEditRaces } from '../database/catalogue/create-edit-races.mjs';
test('create/edit race barriers bind distinct real PIDs, exact request identity, gate, and database',()=>{
 const request='30000000-0000-4000-8000-000000000301';
 for(const text of [catalogueWriteRequestBarrierSql(123,request),catalogueWriteGateBarrierSql(123,124)]){
  for(const marker of ['pg_locks','classid','objid','objsubid=1','current_database()'])assert.ok(text.includes(marker));
 }
 assert.ok(catalogueWriteGateBarrierSql(123,124).includes('pg_blocking_pids'));
 assert.throws(()=>catalogueWriteRequestBarrierSql('123 OR true',request));
 assert.throws(()=>catalogueWriteRequestBarrierSql(123,"';DROP TABLE x;"));
 assert.throws(()=>catalogueWriteGateBarrierSql(123,123));
});
test('new races cannot run without supplied distinct identity-bound sessions',async()=>{
 await assert.rejects(executeCatalogueCreateEditRaces({a:{},b:{},observer:{}}));
 const same={};await assert.rejects(executeCatalogueCreateEditRaces({a:same,b:same,observer:{},query:()=>{},verify:()=>{}}));
 assert.deepEqual(catalogueCreateEditRaceCases,['duplicate_create_exact_replay','edit_vs_reenable_both_directions','reconcile_during_blocked_fresh_create']);
});
test('runtime authoring has no connection discovery and verifies genuinely aborted losers',()=>{
 const source=readFileSync(new URL('../database/catalogue/create-edit-races.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/process\.env|execFile|spawn\(|readFile|dotenv/);
 assert.match(source,/25P02/);assert.match(source,/NOT EXISTS\(SELECT 1 FROM private\.catalog_requests_v1 WHERE status='pending'\)/);
 assert.match(source,/observed,true/);assert.match(source,/await verify\(\)/);
});
