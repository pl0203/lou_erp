import { describe,it,expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as generator from './can-read-po-experiment.mjs'

describe('fixed daily query diagnosis',()=>{
 it('keeps exact original daily query under eight typed bindings and six bounded packets',()=>{
  const build=(generator as any).buildHelperDailyDiagnostic
  expect(build).toBeTypeOf('function')
  const out=build()
  const original=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8').split('CREATE FUNCTION public.pilot_athel_daily_v1')[1].split(' WITH pos')[1].split('\n RETURN result;')[0]
  const bindings=['p_from','p_to','p_rolling_from','p_status','p_page','p_page_size','total_days','page_offset']
  let reversed=out.query
  for(let i=8;i>=1;i--) reversed=reversed.replaceAll('$'+i,bindings[i-1])
  expect(reversed).toBe('WITH pos'+original.replace(' INTO result',''))
  expect(out.packets).toHaveLength(6)
  expect(out.packets.filter((p:any)=>p.analyze)).toHaveLength(2)
  for(const p of out.packets){
   expect(p.sql).toContain("SET statement_timeout='60s'")
   expect(p.sql).toContain('Exact unchanged 30000 fixture required')
   expect(p.sql).toContain('SELECT pg_temp.apply_can_read_po_trial();')
   expect(p.sql).toContain('PREPARE daily_inner(date,date,date,text,integer,integer,integer,bigint) AS\n'+out.query)
   expect(p.sql).toContain('HELPER_EXPERIMENT_RESTORED')
   expect(p.sql).not.toMatch(/^COMMIT;/m)
   expect(p.sql).toContain('ROLLBACK;')
   expect(p.sql).toContain(`pg_temp.pooled_check(${p.role==='manager'?2:6},'daily',false)`)
  }
 })
 it('retains candidate routine and the independent complete daily oracle byte for byte',()=>{
  const build=(generator as any).buildHelperDailyDiagnostic
  expect(build).toBeTypeOf('function')
  const out=build(), truth=generator.buildHelperExperiment().truth
  const routine=truth.slice(truth.indexOf('CREATE FUNCTION pg_temp.apply_can_read_po_trial'),truth.indexOf('END $apply$;')+13)
  const source=readFileSync('tests/database/scalable-pooled-reads.sql','utf8')
  const oracle=source.slice(source.indexOf('DO $guard$ DECLARE base_rows integer;'),source.indexOf('PREPARE pooled_read(integer,text,boolean)'))
  for(const p of out.packets){expect(p.sql).toContain(routine);expect(p.sql).toContain(oracle)}
 })
})

it('restricts the daily workflow to the same-repository disabled branch and fixed synthetic30k',()=>{
 const workflow=readFileSync('.github/workflows/helper-daily-diagnostic.yml','utf8')
 expect(workflow).toContain("github.event.pull_request.head.ref == 'fix/pilot-scale-sql'")
 expect(workflow).toContain("github.event.pull_request.base.ref == 'fix/pilot-database'")
 expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository')
 expect(workflow).toContain("SCALE_ROWS: '30000'")
 expect(workflow).toContain('PGHOST: 127.0.0.1')
 expect(workflow).toContain('timeout-minutes: 20')
 expect(workflow).not.toMatch(/secrets\.|workflow_dispatch|supabase\.co/)
 expect(workflow.indexOf('Unchanged installed620')).toBeLessThan(workflow.indexOf('Load the reviewed fixed30k'))
})
