// @vitest-environment node
import { expect,it,vi } from 'vitest'
let recovery:any
try{recovery=await import('../database/employees/recovery-races.mjs')}catch{}
const env={PGHOST:'127.0.0.1',PGPORT:'65435',PGDATABASE:'pilot_test',PGUSER:'postgres'}
it('implements the fixed owned recovery lifecycle',()=>expect(recovery?.runRecoveryRaces).toBeTypeOf('function'))
it('refuses caller SQL, scripts, roots and unsafe targets before probing',async()=>{
 expect(recovery).toBeDefined();const probe=vi.fn(),spawnProcess=vi.fn()
 for(const key of ['sql','path','script','repoRoot'])await expect(recovery.runRecoveryRaces({env,probe,spawnProcess,[key]:'x'})).rejects.toThrow(/fixed/)
 await expect(recovery.runRecoveryRaces({env:{...env,PGHOST:'hosted.example'},probe,spawnProcess})).rejects.toThrow(/loopback/)
 expect(probe).not.toHaveBeenCalled();expect(spawnProcess).not.toHaveBeenCalled()
})
it('uses marked fixed collisions with fresh locked cleanup and an internal post-COMMIT exit proof',async()=>{
 const {readFileSync}=await import('node:fs'),source=readFileSync('tests/database/employees/recovery-races.mjs','utf8')
 expect(source).toContain('withCollisionCleanup')
 expect(source).toContain('EMPLOYEE_RECOVERY_INVOCATION')
 expect(source.indexOf('EMPLOYEE_RECOVERY_INVOCATION')).toBeLessThan(source.indexOf('creationAttempted=true'))
 expect(source).toContain('JSON.stringify({at:new Date().toISOString(),token})')
 expect(source).toContain('creationAttempted=true')
 expect(source.indexOf('creationAttempted=true')).toBeLessThan(source.indexOf('await admin.query(collisionCreateSql'))
 expect(source).toContain("pool.open('collision-cleanup')")
 expect(source).toContain('assertOwnedCollision(expected,await admin.query(collisionObservationSql(expected.kind)))')
 expect(source).toContain('EMPLOYEE_FIXED_COLLISION_AFTER_COMMIT')
 expect(source).toContain('EMPLOYEE_COLLISION_OWNER_EXIT_RECOVERED')
 const files=JSON.parse(readFileSync('tests/employee-ci/source-files.json','utf8'))
 expect(files).toContain('tests/database/employees/collision-owner.mjs')
 expect(files).toContain('tests/employees/collision-owner.test.ts')
})
