// @vitest-environment node
import { createHash } from 'node:crypto'
import { expect,test } from 'vitest'
import { buildGuardedReadRollout,buildGuardedReadRollback,assertGuardedReadRollout,expectedReadFunctions } from '../../scripts/build-read-rollout.mjs'
import {loadApprovedReadSources} from '../../scripts/assemble-read-rollout.mjs'
const options={repoRoot:process.cwd(),expectedDatabase:'pilot_rollout_test',expectedDataHash:'0'.repeat(32),expectedSchemaHash:'1'.repeat(32)}
test('guarded artifact hashes and validates the exact bytes including committed receipt',async()=>{
 const r=await buildGuardedReadRollout(options)
 expect(r.checks.assembledSha256).toBe(createHash('sha256').update(r.sql).digest('hex'))
 expect(r.checks.transactionSha256).toBe(createHash('sha256').update(r.transactionSql).digest('hex'))
 expect(r.sql.lastIndexOf('READ_ROLLOUT_COMMITTED')).toBeGreaterThan(r.sql.lastIndexOf('COMMIT;'))
 await expect(assertGuardedReadRollout({...options,sql:r.sql+'SELECT 1;'})).rejects.toThrow()
 expect(await assertGuardedReadRollout({...options,sql:r.sql})).toEqual(r.checks)
})
test('baseline, exact metadata deltas, null-safe ACL and index provenance are enforced',async()=>{
 const r=await buildGuardedReadRollout(options)
 expect(r.sql).toContain('Approved baseline fingerprint drift')
 expect(r.sql).toContain('Untargeted schema/ACL/trigger drift')
 expect(r.sql).toContain("jsonb_array_length(b->'functions')+15")
 expect(r.sql).toContain('Target policy expression mismatch')
 expect(r.sql).toContain('FROM read_rollout_index_before')
 expect(r.sql).toContain("added->>'name' IS DISTINCT FROM 'public.pilot_girard_orders_po_id_idx'")
 expect(r.sql).toContain('acl.is_grantable AND acl.grantee<>p.proowner')
 expect(r.sql).not.toContain("acl.grantee NOT IN(p.proowner")
 expect(expectedReadFunctions(await loadApprovedReadSources(process.cwd()))).toHaveLength(15)
 await expect(buildGuardedReadRollout({...options,expectedDataHash:'unknown'})).rejects.toThrow()
 await expect(buildGuardedReadRollout({...options,expectedDatabase:'production'})).rejects.toThrow()
})
test('rollback binds confirmed post-state and restores baseline without deleting data',async()=>{
 for(const indexCreated of [true,false]){
  const sql=await buildGuardedReadRollback({...options,baselineSchemaHash:'2'.repeat(32),indexCreated})
  expect(sql).toContain('Confirmed post-apply schema drift; rollback refused')
  expect(sql).toContain('Rollback did not restore exact baseline metadata')
  expect(sql).toContain('Data fingerprint changed')
  expect(sql.match(/DROP FUNCTION /g)).toHaveLength(15)
  expect(sql.match(/ALTER POLICY /g)).toHaveLength(9)
  expect(sql.includes('DROP INDEX public.pilot_girard_orders_po_id_idx RESTRICT;')).toBe(indexCreated)
  expect(sql).not.toMatch(/DROP SCHEMA|CASCADE|DELETE FROM|TRUNCATE|DISABLE ROW LEVEL/)
  expect(sql.lastIndexOf('READ_ROLLBACK_COMMITTED')).toBeGreaterThan(sql.lastIndexOf('COMMIT;'))
 }
})
