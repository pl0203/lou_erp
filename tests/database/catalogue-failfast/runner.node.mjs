import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run,verifyFiles } from './runner.mjs';
test('pending proof never reaches missing source, executable lookup, or database',async()=>{const b={format:'synthetic-failfast-binding-v1',approval:'PENDING'};await assert.rejects(run(b,'/intentionally-absent-source',{PATH:'/intentionally-absent-executables'}),/authorization\/binding is pending/);});
test('executable manifest is exact and refuses incomplete byte binding',()=>{assert.throws(()=>verifyFiles({files:{'schema.sql':'a'.repeat(64)}}),/Exact reviewed executable file set/);});
