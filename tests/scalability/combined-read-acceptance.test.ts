// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,it } from 'vitest'
import * as source from './can-read-po-experiment.mjs'
it.each([6000,30000])('wraps unchanged full role/session suites with only the two approved bodies at %s',rows=>{
 const build=(source as any).buildCombinedAcceptancePackets
 expect(build).toBeTypeOf('function')
 const p=build(rows)
 for(const [name,path] of [['ground-truth','tests/database/scalability-ground-truth.sql'],['pooled-reads','tests/database/scalable-pooled-reads.sql']]){
  const original=readFileSync(path,'utf8')
  expect(p[name]).toContain(original.slice(original.indexOf('SET LOCAL statement_timeout'),original.lastIndexOf('ROLLBACK;')))
  expect(p[name]).toContain('SELECT pg_temp.apply_can_read_po_trial();')
  expect(p[name]).toContain('SELECT pg_temp.apply_daily_preaggregation();')
  expect(p[name]).toContain('daily_and_helper_only_bodies_changed')
  expect(p[name]).toContain(`combined-${rows}-${name}`)
  expect(p[name]).not.toMatch(/^COMMIT;/m)
 }
 expect(p['pooled-reads']).toContain('<>242')
})
it('restores both exact bodies atomically only from the known paired candidate state',()=>{
 const build=(source as any).buildCombinedRaceLifecycle
 expect(build).toBeTypeOf('function')
 const p=build('a'.repeat(32))
 expect(p.install).toContain('SELECT pg_temp.apply_daily_preaggregation();')
 expect(p.install).toContain('COMMIT;')
 expect(p.restore).toContain('CREATE OR REPLACE FUNCTION private.pilot_can_read_po')
 expect(p.restore).toContain('CREATE OR REPLACE FUNCTION public.pilot_athel_daily_v1')
 expect(p.restore).toContain('Confirmed combined candidate required')
 expect(p.restore).toContain('HELPER_RACE_RESTORED')
 expect(p.originalHash).not.toBe(p.candidateHash)
 expect(()=>build('unknown')).toThrow()
})
it('uses original18/40-minute budget only for the exact combined pooled path',async()=>{
 const {runDisposableSql}=await import('../../scripts/run-disposable-psql.mjs')
 for(const [rows,minutes] of [[6000,18],[30000,40]]){
  let options:any
  runDisposableSql('scale-results/combined-read-acceptance/pooled-reads.sql',{env:{PGHOST:'127.0.0.1',PGDATABASE:'pilot_test',PGUSER:'postgres',SCALE_ROWS:String(rows),SCALE_PERMIT:'disposable-pilot-ci'},execute:(_cmd:any,_args:any,o:any)=>{options=o}})
  expect(options.timeout).toBe(minutes*60000)
 }
})
it('includes runtime negative controls for both mixed function states',()=>{
 const p=(source as any).buildCombinedAcceptancePackets(6000)
 expect(p['mixed-controls']).toContain('COMBINED_MIXED_BODY_REJECTED helper_only')
 expect(p['mixed-controls']).toContain('COMBINED_MIXED_BODY_REJECTED daily_only')
 expect(p['mixed-controls']).toContain("IF SQLERRM<>'Unknown or mixed combined function bodies' THEN RAISE")
 expect(p['mixed-controls']).not.toMatch(/^COMMIT;/m)
})
it('records independently inspectable hashes for both bodies alongside their atomic pair',()=>{
 const sql=(source as any).combinedRaceStateSql()
 expect(sql).toContain("'helper_source_md5'")
 expect(sql).toContain("'daily_source_md5'")
 expect(sql).toContain("'combined_source_md5'")
})
