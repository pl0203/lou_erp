// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { buildQueryPlanPackets, extractSummaryStatement } from './query-plan-packets.mjs'
const source=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
test('prepared diagnostic derives the exact candidate statement and only replaces parameter bindings',()=>{
 const inner=extractSummaryStatement(source)
 expect(inner.startsWith('WITH pos AS MATERIALIZED')).toBe(true)
 expect(inner).not.toContain('INTO result');expect(inner).not.toMatch(/\bp_(from|to|rolling_from|status|fulfillment)\b/)
 for(const name of ['$1','$2','$3','$4','$5'])expect(inner).toContain(name)
 expect(()=>extractSummaryStatement('unrelated source')).toThrow()
})
test('admin generic/custom plans are cost-only while manager stages execute real scoped RLS reads',()=>{
 const packets=buildQueryPlanPackets(source);expect(packets.map(p=>p.name)).toEqual(['admin-inner-custom','admin-inner-generic','manager-component-costs'])
 for(const p of packets){expect(p.sql).toContain('BEGIN READ ONLY;');expect(p.sql).toContain("statement_timeout='60s'");expect(p.sql).toContain('row_security_active');expect(p.sql).toContain("current_database()<>'pilot_test'");expect(p.sql).toContain('ROLLBACK;')}
 for(const p of packets.slice(0,2)){expect(p.sql).toContain('PREPARE diagnostic_summary(date,date,date,text,text) AS\n'+extractSummaryStatement(source));expect(p.sql).toContain('EXPLAIN (VERBOSE,COSTS) EXECUTE');expect(p.sql).not.toContain('ANALYZE');expect(p.sql).toContain("'2021-01-01','2026-09-30','2025-10-01','all','all'")}
 const manager=packets[2].sql;expect(manager.match(/EXPLAIN \(ANALYZE/g)).toHaveLength(4);expect(manager).toContain('public.po_line_items');expect(manager).toContain('public.sj_line_items');expect(manager).toContain("'2025-10-01'::date")
})
