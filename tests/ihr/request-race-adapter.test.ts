import { existsSync,readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
const path='tests/database/ihr/concurrency.mjs',source=existsSync(path)?readFileSync(path,'utf8'):''
test('request barrier adapter uses existing guard and read-only marker before any fixtures',()=>{
 expect(source).toContain("import { validateIhrDbTarget }")
 expect(source.indexOf('const env = validateIhrDbTarget')).toBeGreaterThan(0)
 expect(source.indexOf("marker.trim() !== 't'")).toBeLessThan(source.indexOf("'requests-race-fixture.sql'"))
 expect(source).toContain("purpose='disposable-pilot-ci'")
 expect(source).toContain('server_version_num')
})
test('adapter waits on observed blocker identity rather than treating sleep as contention proof',()=>{
 for(const token of ['pg_blocking_pids','pg_stat_activity','pg_locks',"wait_event_type='Lock'","wait_event='advisory'",'IHR_REQUESTS_CONCURRENCY_PASSED'])expect(source).toContain(token)
 expect(source).toContain("['last_allowance', 'same_date', 'same_key']")
 expect(source).toContain('finally');expect(source).toContain("child.kill('SIGTERM')");expect(source).toContain("child.kill('SIGKILL')")
 expect(source).toContain('150_000')
})
test('invalid targets refuse before any subprocess is launched',async()=>{
 const {runRequestRaces}=await import('../database/ihr/concurrency.mjs')
 await expect(runRequestRaces({PGHOST:'hosted.example.invalid',PGDATABASE:'pilot_test',PGUSER:'postgres'})).rejects.toThrow('Explicit loopback')
 await expect(runRequestRaces({PGHOST:'127.0.0.1',PGDATABASE:'production',PGUSER:'postgres'})).rejects.toThrow('Only disposable')
})
test('adapter handles termination and waits only for terminal close with a hard cleanup deadline',()=>{
 for(const token of ["process.on('SIGTERM'","process.on('SIGINT'","process.removeListener('SIGTERM'","process.removeListener('SIGINT'",'cleanupDeadline','state.closed = true','terminalClose'])expect(source).toContain(token)
 expect(source).not.toMatch(/once\('error',[^\n]*resolve\(/)
})
test('authority wait compares a complete before/after baseline before the final marker',()=>{
 for(const token of ['authorityBaseline','authorityAfter',"'requests'","'days'","'occupancy'","'allocations'","'ledger'","'audit'","'commands'","'accounts'"] )expect(source).toContain(token)
 expect(source.indexOf('authorityBaseline')).toBeLessThan(source.indexOf('const holder = session'))
 expect(source.indexOf('authorityAfter')).toBeLessThan(source.indexOf('IHR_REQUESTS_CONCURRENCY_PASSED'))
})
test('authority barriers cover request-first and deactivation-first orderings with committed revocation before release',()=>{
 expect(source).toContain("for (const ordering of ['request_first', 'deactivation_first'])")
 for(const token of ['DEACTIVATION_HELD','DEACTIVATION_COMMITTED','ACCOUNT_RELEASED','80000000-0000-0000-0000-000000000531','80000000-0000-0000-0000-000000000532'])expect(source).toContain(token)
 const authority=source.slice(source.indexOf("for (const ordering of ['request_first', 'deactivation_first'])"))
 expect(authority.indexOf("if (ordering === 'deactivation_first') await startDeactivation()")).toBeLessThan(authority.indexOf('const waiter = await app'))
 expect(authority.indexOf('await deactivation.finish()')).toBeLessThan(authority.indexOf("holder.write('COMMIT;')"))
 expect(authority).toContain('authorityAfter === authorityBaseline')
})
