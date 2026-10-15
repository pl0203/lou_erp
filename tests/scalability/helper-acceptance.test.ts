// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test,vi } from 'vitest'
import { buildHelperAcceptancePackets,buildHelperRaceLifecycle } from './can-read-po-experiment.mjs'
import { runDisposableSql } from '../../scripts/run-disposable-psql.mjs'
test.each([6000,30000])('candidate acceptance preserves the complete original suites at%s',rows=>{
 const p=buildHelperAcceptancePackets(rows)
 for(const [name,path] of [['ground-truth','tests/database/scalability-ground-truth.sql'],['pooled-reads','tests/database/scalable-pooled-reads.sql']] as const){
  const original=readFileSync(path,'utf8')
  expect(p[name]).toContain(original.slice(original.indexOf('SET LOCAL statement_timeout'),original.lastIndexOf('ROLLBACK;')))
  expect(p[name]).toContain(`<>${rows}`)
  expect(p[name]).not.toMatch(/^\s*COMMIT;/m)
  expect(p[name].lastIndexOf('ROLLBACK;')).toBeLessThan(p[name].lastIndexOf('HELPER_EXPERIMENT_RESTORED'))
 }
 expect(p['pooled-reads']).toContain("<>242")
 expect(p['pooled-reads']).toContain('Sixth-call auto-plan coverage missing')
})
test('candidate pooled wrapper receives only the original size-specific whole-process budget',()=>{
 for(const [rows,minutes] of [[6000,18],[30000,40]]){
  const execute=vi.fn();runDisposableSql('scale-results/helper-acceptance/pooled-reads.sql',{env:{PGHOST:'127.0.0.1',PGDATABASE:'pilot_test',PGUSER:'postgres',SCALE_ROWS:String(rows),SCALE_PERMIT:'disposable-pilot-ci'},execute})
  expect(execute.mock.calls[0][2].timeout).toBe(minutes*60000)
 }
 const execute=vi.fn();runDisposableSql('unreviewed/helper-acceptance/pooled-reads.sql',{env:{PGHOST:'127.0.0.1',PGDATABASE:'pilot_test',PGUSER:'postgres',SCALE_ROWS:'30000',SCALE_PERMIT:'disposable-pilot-ci'},execute});expect(execute.mock.calls[0][2].timeout).toBe(15*60000)
})
test('acceptance workflow isolates race service and retains exact success denial and restoration markers',()=>{
 const source=readFileSync('.github/workflows/helper-read-acceptance.yml','utf8')
 expect(source).toContain('candidate-pooled:');expect(source).toContain('candidate-races:')
 expect(source.match(/image: postgres:17/g)).toHaveLength(2)
 expect(source).toContain('job_minutes: 20');expect(source).toContain('job_minutes: 45')
 expect(source).toContain('-eq 242');expect(source).toContain('-eq 33')
 expect(source).toContain('HELPER_CANDIDATE_RACE_ACCEPTANCE_VERIFIED')
 expect(source.match(/shell: bash/g)).toHaveLength(2)
 expect(source).not.toMatch(/secrets\.|supabase\.co|workflow_dispatch/)
})
test('cross-session lifecycle pins catalog before guarded commit and restores only known candidate state',()=>{
 const p=buildHelperRaceLifecycle('a'.repeat(32))
 expect(p.install).toContain("current_database()<>'pilot_test'")
 expect(p.install.indexOf('Source fixture must be empty')).toBeLessThan(p.install.indexOf('COMMIT;'))
 expect(p.install.indexOf('helper_only_body_changed')).toBeLessThan(p.install.indexOf('COMMIT;'))
 expect(p.restore).toContain('HELPER_RACE_RESTORED')
 expect(p.restore).toContain("'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'")
 expect(()=>buildHelperRaceLifecycle('unsafe')).toThrow()
})
