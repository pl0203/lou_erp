// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect,test } from 'vitest'
import { buildCustomerPlanPackets,extractCustomerStatement } from './customer-plan-packets.mjs'
const source=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
test('extracted customer query retains exact source text apart from fixed bindings and INTO',()=>{
 const sql=extractCustomerStatement(source)
 expect(sql).toContain('WITH cohort AS MATERIALIZED')
 expect(sql).not.toContain('INTO result')
 expect(sql).toContain('WHERE t.year_month<=$2')
 expect(sql).toContain('LIMIT $6 OFFSET ($5::bigint-1)*$6')
 expect(sql).not.toMatch(/\b(?:month_from|month_until|p_manager_id|p_year_month|p_visit_from|p_visit_until|p_page|p_page_size)\b/)
 expect(()=>extractCustomerStatement(source.replaceAll('WITH cohort AS MATERIALIZED','WITH unexpected AS MATERIALIZED'))).toThrow()
})
test('fixed plans and actual calls are read-only guarded and separate from pooled acceptance',()=>{
 const packets=buildCustomerPlanPackets(source)
 const body=source.match(/FUNCTION public\.pilot_customer_performance_v1\([^]*?AS \$\$([^]*?)\$\$;/)![1]
 const sourceHash=createHash('md5').update(body).digest('hex')
 expect(packets).toHaveLength(9)
 for(const {sql} of packets){
  expect(sql).toContain(sourceHash)
  expect(sql).toContain('BEGIN READ ONLY;');expect(sql).toContain("statement_timeout='60s'")
  expect(sql).toContain("current_database()<>'pilot_test'");expect(sql).toContain("SET LOCAL ROLE authenticated")
  expect(sql).toContain("ARRAY['customers'");expect(sql).toContain("row_security_active(('public.'||t.name)::regclass)")
  expect(sql).toContain("SET LOCAL search_path=''")
  expect(sql).not.toMatch(/\b(?:ALTER POLICY|CREATE INDEX|COMMIT;)\b/)
  expect(sql.indexOf('ROLLBACK;')).toBeLessThan(sql.indexOf('CUSTOMER_PLAN_DIAGNOSTIC_VERIFIED'))
 }
 const auto=packets.find(p=>p.name==='customer-inner-auto-sixth')!.sql
 expect(auto.match(/EXPLAIN \(VERBOSE,COSTS\) EXECUTE customer_read/g)).toHaveLength(6)
 expect(auto).toContain('generic_plans,custom_plans')
 const actual=packets.filter(p=>p.name.startsWith('customer-rpc'))
 expect(actual).toHaveLength(3)
 for(const p of actual){expect(p.sql).toContain('public.pilot_customer_performance_v1(');expect(p.sql).toContain("LOAD 'auto_explain'");expect(p.sql).toContain('auto_explain.log_analyze=off')}
})
