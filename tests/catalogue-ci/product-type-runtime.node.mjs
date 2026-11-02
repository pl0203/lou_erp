import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
let runner; try { runner=await import('../../scripts/catalogue-product-type-runtime.mjs'); } catch {}
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('Tipe acceptance owns one rollback envelope and installs fragments before API assertions',()=>{
 assert.ok(runner,'Tipe runtime builder missing');
 const parts=Object.fromEntries(Object.entries(runner.productTypeRuntimePaths).map(([k,p])=>[k,read(p)]));
 const sql=runner.buildProductTypeAcceptance(parts);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);assert.equal((sql.match(/^ROLLBACK;/gm)||[]).length,1);assert.doesNotMatch(sql,/^COMMIT;/m);
 assert.ok(sql.indexOf(parts.before)<sql.indexOf(parts.storage));assert.ok(sql.indexOf(parts.graph)<sql.indexOf(parts.api));
 assert.match(sql,/row_security_active/);assert.match(sql,/rolbypassrls/);
 for(const extra of ['\nCOMMIT;','\n\\quit'])assert.throws(()=>runner.buildProductTypeAcceptance({...parts,api:parts.api+extra}));
});
test('Tipe race install is finite and never executes pre-upgrade fixture or API suite',()=>{
 assert.ok(runner,'Tipe runtime builder missing');
 const parts=Object.fromEntries(Object.entries(runner.productTypeRuntimePaths).map(([k,p])=>[k,read(p)]));
 const sql=runner.buildProductTypeRaceInstall(parts);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
 assert.ok(!sql.includes(parts.before));assert.ok(!sql.includes(parts.api));assert.ok(sql.includes(parts.graph));
});
test('positive multi-statement batches stop on first SQL error before rollback marker or races',async()=>{
 assert.ok(runner);const parts=Object.fromEntries(Object.entries(runner.productTypeRuntimePaths).map(([k,p])=>[k,read(p)]));
 let races=0,queries=0;
 await assert.rejects(()=>runner.executeProductTypeAcceptance({parts,a:{},b:{},observer:{},verify:async()=>{},expectState:async()=>{},runRaces:async()=>{races++;},query:async(_s,sql)=>{
  queries++;assert.ok(sql.startsWith('\\set ON_ERROR_STOP on\n'),'positive-only SQL must fail fast');
  throw new Error('synthetic psql process exits on first failed assertion');
 }}),/psql process exits/);
 assert.equal(queries,1);assert.equal(races,0);
});
