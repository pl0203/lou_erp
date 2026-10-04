// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { buildManifest } from './generate-fixtures.mjs'
const sql=readFileSync('tests/database/scalable-pooled-reads.sql','utf8')
function fixedArithmetic(expression:string,n:number){
 const m=expression.match(/^base_rows(?:::numeric)?(?:([*/])(\d+))?(?:\+(\d+))?$/)
 if(!m)throw new Error('Unexpected scale assertion expression')
 return (m[1]==='*'?n*Number(m[2]):m[1]==='/'?n/Number(m[2]):n)+Number(m[3]??0)
}
for(const n of [6000,30000])test(`pooled actual-count guards match declared base plus unchanged edges at ${n}`,()=>{
 const manifest=buildManifest(n)
 for(const table of ['purchase_orders','po_line_items','surat_jalan','sj_line_items','girard_orders'] as const){
  const expr=sql.match(new RegExp(`count\\(\\*\\) FROM public\\.${table}\\)<>([^\\n]+)`))![1]
  expect(fixedArithmetic(expr,n)).toBe(manifest.totals[table])
 }
 expect(fixedArithmetic(sql.match(/sum\(total_value\) FROM pg_temp.pooled_pos\)<>([^\n]+)/)![1],n)).toBe(n*1000+600)
 expect(fixedArithmetic(sql.match(/sum\(value\) FROM pg_temp.pooled_delivery\)<>(.*?) THEN/)![1],n)).toBe(n*500+180)
 const teamA=sql.match(/pooled_pos WHERE scope='A'\)<>([^\n]+)/)![1]
 expect(fixedArithmetic(teamA,n)).toBe(manifest.role_po_counts.managerA)
})
test('growth affects declared history only while session/role/date gates remain fixed',()=>{
 expect(sql).toContain('base_rows IS NULL OR base_rows NOT IN(6000,30000)')
 expect(sql).toContain("statement_timeout='60s'")
 expect(sql).toContain("count(*) FROM pg_temp.pooled_evidence)<>242")
 expect(sql).toContain('generate_series(1,6)')
 expect(sql).toContain("'2026-07-01'");expect(sql).toContain("'2026-09-01'");expect(sql).toContain("'2025-10-01'")
 expect(sql).not.toContain('COMMIT;')
 const workflow=readFileSync('.github/workflows/scalability-sql.yml','utf8')
 expect(workflow).toContain("SCALE_ROWS: '30000'");expect(workflow).toContain('timeout-minutes: 45')
 expect(workflow).toContain('pull_request.number == 3')
})
