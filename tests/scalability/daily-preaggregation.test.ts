import { readFileSync } from 'node:fs'
import { expect,it } from 'vitest'
import * as source from './can-read-po-experiment.mjs'
it('builds only the fixed parity and balanced manager/admin daily trial with exact restoration',()=>{
 const build=(source as any).buildDailyPreaggregationExperiment
 expect(build).toBeTypeOf('function')
 const packets=build()
 expect(packets.warmups).toHaveLength(4)
 expect(packets.benchmarks).toHaveLength(8)
 expect(packets.plans).toHaveLength(4)
 for(const p of [...packets.warmups,...packets.benchmarks,...packets.plans]){
  expect(p.sql).toContain('Exact unchanged 30000 fixture required')
  expect(p.sql).toContain("SET statement_timeout='60s'")
  expect(p.sql).toContain('SELECT pg_temp.apply_can_read_po_trial();')
  expect(p.sql).toContain('daily_and_helper_only_bodies_changed')
  expect(p.sql).toContain('HELPER_EXPERIMENT_RESTORED')
  expect(p.sql).not.toMatch(/^COMMIT;/m)
 }
 expect(packets.parity).toContain('DAILY_PREAGGREGATION_PARITY_VERIFIED')
})
it('candidate differs from original only by exact per-SJ aggregation and corresponding inner join',()=>{
 const build=(source as any).buildDailyPreaggregationExperiment
 expect(build).toBeTypeOf('function')
 const {candidate,original}=build()
 const changed=original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
  .replace(' delivery_days AS (',` delivery_values AS MATERIALIZED (SELECT d.surat_jalan_id,sum(d.quantity_delivered::numeric*l.unit_price) AS value\n  FROM public.sj_line_items d JOIN lines l ON l.id=d.po_line_item_id GROUP BY d.surat_jalan_id),\n delivery_days AS (`)
  .replace('sum(d.quantity_delivered::numeric*l.unit_price) AS value,count(DISTINCT s.id)','sum(v.value) AS value,count(DISTINCT s.id)')
  .replace('JOIN public.sj_line_items d ON d.surat_jalan_id=s.id JOIN lines l ON l.id=d.po_line_item_id','JOIN delivery_values v ON v.surat_jalan_id=s.id')
 expect(candidate).toBe(changed)
 expect(candidate).toBe(readFileSync('tests/database/experiments/daily-preaggregation.sql','utf8').trim())
})
it('rejects incomplete or misattributed paired observations before reporting medians',()=>{
 const summarize=(source as any).summarizeDailyPreaggregation
 expect(summarize).toBeTypeOf('function')
 const rows=['baseline','candidate','candidate','baseline'].flatMap((variant,i)=>['manager','admin'].map((role,j)=>({name:`pair-${String(i*2+j).padStart(2,'0')}-${role}-${variant}`,role,variant,ms:variant==='candidate'?100:1000})))
 expect(summarize(rows).manager.improvementPercent).toBe(90)
 expect(()=>summarize(rows.slice(1))).toThrow()
 expect(()=>summarize(rows.map((r,i)=>i===0?{...r,role:'admin'}:r))).toThrow()
 expect(()=>summarize(rows.map((r,i)=>i===0?{...r,ms:60000}:r))).toThrow()
})
it('retains full item keys and makes deliberate SQL errors fail rather than count as negative evidence',()=>{
 const parity=readFileSync('tests/database/experiments/daily-preaggregation-parity.sql','utf8')
 expect(parity).toContain("x||jsonb_build_object('deliveredValue'")
 expect(parity).toContain('pg_temp.daily_literal(actor,case_no)')
 expect(parity).toContain("IF SQLERRM<>'Expected daily literal mismatch' THEN RAISE")
 expect(parity).not.toContain('EXCEPTION WHEN OTHERS')
 expect(parity).toContain("session_replication_role='origin'")
})
