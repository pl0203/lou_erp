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
 assert.ok(sql.startsWith('DO $tipe_atomic$ BEGIN EXECUTE $tipe_body$'));assert.equal((sql.match(/^BEGIN;|^COMMIT;/gm)||[]).length,0);
 assert.ok(!sql.includes(parts.before));assert.ok(!sql.includes(parts.api));assert.ok(sql.includes(parts.graph));
});
test('positive multi-statement batches stop on first SQL error before rollback marker or races',async()=>{
 assert.ok(runner);const parts=Object.fromEntries(Object.entries(runner.productTypeRuntimePaths).map(([k,p])=>[k,read(p)]));
 let races=0,queries=0;
 await assert.rejects(()=>runner.executeProductTypeAcceptance({parts,a:{},b:{},observer:{},verify:async()=>{},expectState:async()=>{},runRaces:async()=>{races++;},query:async(_s,sql)=>{
  if(!sql.includes('\\o /dev/null'))return sql.startsWith('SELECT ')?'t':'';
  queries++;assert.ok(sql.startsWith('\\set ON_ERROR_STOP on\n'),'positive-only SQL must fail fast');
  throw new Error('synthetic psql process exits on first failed assertion');
 }}),/psql process exits/);
 assert.equal(queries,1);assert.equal(races,0);
});
test('single-statement envelope rejects inner transaction controls and delimiter escape',()=>{
 assert.equal(typeof runner.productTypeAtomicStatement,'function');
 const sql=runner.productTypeAtomicStatement('SELECT 1;');assert.ok(sql.startsWith('DO $tipe_atomic$'));assert.ok(sql.includes('EXECUTE $tipe_body$SELECT 1;$tipe_body$'));
 for(const bad of ['BEGIN;SELECT 1;COMMIT;',"SELECT '$tipe_body$';",'ROLLBACK;'])assert.throws(()=>runner.productTypeAtomicStatement(bad));
});

test('generic envelope probe checks actual rollback observation and identity before and after',async()=>{
 let checks=0,expected=0;const statements=[];
 const args={a:{},verify:async()=>{checks++},expectState:async(_s,sql,state)=>{expected++;assert.equal(state,'PT901');assert.equal(sql,runner.productTypeEnvelopeProbeSql.failure)},query:async(_s,sql)=>{statements.push(sql);return sql.startsWith('SELECT ')?'t':''}};
 assert.equal(await runner.executeProductTypeEnvelopeProbe(args),'ATOMIC_STATEMENT_ROLLBACK_VERIFIED');assert.equal(checks,2);assert.equal(expected,1);assert.ok(statements.includes(runner.productTypeEnvelopeProbeSql.rollbackObservation));
 for(const failed of ["SELECT current_setting('statement_timeout')='8s' AND current_setting('idle_in_transaction_session_timeout')='30s';",runner.productTypeEnvelopeProbeSql.successObservation,runner.productTypeEnvelopeProbeSql.rollbackObservation])await assert.rejects(runner.executeProductTypeEnvelopeProbe({...args,query:async(_s,sql)=>sql===failed?'f':sql.startsWith('SELECT ')?'t':''}));
});
