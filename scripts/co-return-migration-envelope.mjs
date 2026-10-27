// Fixed reviewed derivation: no SQL parsing/formatting and no caller-selected source.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const candidateSha='7e7601e457ba47178ccc507fca58a5f72bc1b84267232390044e82a8003711f5'
const sha=sql=>createHash('sha256').update(sql).digest('hex')
export function deriveReturnMigration(candidate){
 assert.equal(sha(candidate),candidateSha,'Return candidate identity changed')
 const first=candidate.indexOf('\nBEGIN;\n')+1,last=candidate.lastIndexOf('COMMIT;\n')
 assert.ok(first>0&&last>first&&last+8===candidate.length,'Exact outer transaction required')
 assert.equal(candidate.split('\n').filter(x=>/^(BEGIN|COMMIT);$/.test(x)).join(','),'BEGIN;,COMMIT;')
 const sql=candidate.slice(0,first)+candidate.slice(first+7,last)
 return {sql,manifest:{transformation:'remove-exact-outer-transaction-v1',candidate_sha256:candidateSha,migration_sha256:sha(sql),removed:[{offset:first,bytes:'BEGIN;\n'},{offset:last,bytes:'COMMIT;\n'}]}}
}
// Synthetic test only; this is NOT a claim about the private Management API internals.
// The guarded actual-PG runner owns the fixed disposable connection and history schema.
export function composeReturnMigrationTest(candidate,mode){
 assert.ok(['success','ddl-failure','history-failure'].includes(mode),'Unsupported migration envelope test')
 const {sql,manifest}=deriveReturnMigration(candidate)
 const fault=mode==='ddl-failure'?"DO $$ BEGIN RAISE EXCEPTION 'Synthetic external migration install fault' USING ERRCODE='PZ703';END $$;\n":''
 const version=mode==='history-failure'?'rejected':'accepted'
 return 'BEGIN;\n'+sql+fault+`INSERT INTO return_envelope_test.history(version,candidate_sha256,migration_sha256) VALUES('${version}','${manifest.candidate_sha256}','${manifest.migration_sha256}');\nCOMMIT;\n`
}
