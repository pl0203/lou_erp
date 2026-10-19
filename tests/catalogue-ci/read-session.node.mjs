import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogueReadSession,parseCatalogueReadOutput } from '../../scripts/catalogue-read-session.mjs';
const identity={profile:'github-catalogue-baseline-v1',source:{clean:true,commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64)},serverAddress:'172.18.0.2',serverPort:5432,serverVersion:'170011',systemIdentifier:'123456789',ci:{}};
// These are parser unit inputs, never runtime evidence or published fixtures.
const parts={foundation:'SELECT 1;',candidate:'SELECT 2;',suite:"SELECT 'CATALOGUE_READ_SQL_OUTPUT:' || jsonb_build_object('format','catalogue-read-sql-output-v1')::text;\nSELECT 3;"};
test('buffer SQL output until remaining assertions and verified rollback',()=>{
 const sql=buildCatalogueReadSession(identity,parts);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);assert.equal((sql.match(/^ROLLBACK;/gm)||[]).length,1);
 assert.ok(sql.indexOf('SELECT 3;')<sql.indexOf('ROLLBACK;'));
 assert.ok(sql.indexOf('catalogue_read_rollback_refused')<sql.indexOf('\\echo CATALOGUE_READ_SQL_OUTPUT:'));
 assert.match(sql,/AS catalogue_read_json\n\\gset/);
 assert.ok(!/^COMMIT;/m.test(sql));assert.ok(!/DROP DATABASE/.test(sql));
});
test('reject suite transaction/client boundaries and duplicate/missing output SELECT',()=>{
 for(const suffix of ['\nCOMMIT;','\n\\echo forged', '\n'+parts.suite])assert.throws(()=>buildCatalogueReadSession(identity,{...parts,suite:parts.suite+suffix}));
 assert.throws(()=>buildCatalogueReadSession(identity,{...parts,suite:'SELECT 1;'}));
});
test('parser requires exactly one rollback marker before one complete JSON line',()=>{
 const good='CATALOGUE_READ_ROLLBACK_VERIFIED 1 2\nCATALOGUE_READ_SQL_OUTPUT: {"format": "catalogue-read-sql-output-v1"}\n';
 assert.equal(parseCatalogueReadOutput(good).transactionId,'2');
 for(const output of ['',good.trim(),good+good,good.split('\n').reverse().join('\n'),good.replace('VERIFIED','FAILED'),good.replace('v1','v2'),good.replace('1 2','0 2'),good+'extra\n'])assert.throws(()=>parseCatalogueReadOutput(output));
});
import { runCatalogueReadProof } from '../../scripts/catalogue-read-proof.mjs';
import { mkdtempSync,writeFileSync,readFileSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('unbound producer refuses before any subprocess and never marks ready',()=>{
 const root=mkdtempSync(join(tmpdir(),'catalogue-read-source-test-')),output=join(root,'output');writeFileSync(output,'');
 let calls=0;const execute=()=>{calls++;throw Error('subprocess must not execute');};
 assert.throws(()=>runCatalogueReadProof({repoRoot:root,env:{GITHUB_OUTPUT:output},execute}),/CATALOGUE_READ_PROOF_REFUSED/);
 assert.equal(calls,0);assert.equal(readFileSync(output,'utf8'),'bundle_ready=false\n');
});
test('symlink output target refuses before any subprocess or write',()=>{
 const root=mkdtempSync(join(tmpdir(),'catalogue-read-source-test-')),target=join(root,'target'),output=join(root,'output');writeFileSync(target,'untouched');symlinkSync(target,output);
 let calls=0;assert.throws(()=>runCatalogueReadProof({repoRoot:root,env:{GITHUB_OUTPUT:output},execute:()=>{calls++;}}),/CATALOGUE_READ_PROOF_REFUSED/);
 assert.equal(calls,0);assert.equal(readFileSync(target,'utf8'),'untouched');
});

import { parseReadJson } from '../../scripts/catalogue-read-json.mjs';
test('PostgreSQL decimal scales and nested key ordering normalize deterministically',()=>{
 const parsed=parseReadJson('{"a": 1.00, "bb": [{"z": null}]}',{postgres:true});
 assert.equal(parsed.canonicalText,'{"a":1,"bb":[{"z":null}]}');
 assert.deepEqual(parseReadJson(parsed.canonicalText,{canonical:true}).value,parsed.value);
 for(const text of ['{"a": {"x": 1, "x": 2}}','{"bb": 1, "a": 2}','{"a": 1e2}','{"a": 9007199254740993}','{"a":1}'])assert.throws(()=>parseReadJson(text,{postgres:true}));
});
test('exact decimal semantic identity rejects overflow, underflow and near-integer rounding',()=>{
 for(const number of ['1.0000000000000000001','0.10000000000000001','9007199254740991.1','9007199254740992','-0','-0.00','1e309','1e-400'])assert.throws(()=>parseReadJson('{"n":'+number+'}'));
 for(const number of ['0','0.00','0.1','12.34','-12.34','9007199254740991','0.0000001','0.000000000000000000001','-0.0000001']){
  const result=parseReadJson('{"n": '+number+'}',{postgres:true});
  assert.deepEqual(parseReadJson(result.canonicalText,{canonical:true}).value,result.value);
 }
 for(const text of ['{"n":1E-7}','{"n":1e-07}','{"n":1.0e-7}'])assert.throws(()=>parseReadJson(text,{canonical:true}));
});
