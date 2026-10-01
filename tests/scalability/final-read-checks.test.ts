// @vitest-environment node
import { expect,test } from 'vitest'
import { buildFinalReadChecks } from './final-read-checks.mjs'
test('final diagnostics call the installed RPC in three bounded real-role sessions',()=>{
 const packets=buildFinalReadChecks()
 expect(packets.map(p=>p.name)).toEqual(['final-admin-auto','final-manager-auto','final-admin-force_generic_plan'])
 for(const {sql} of packets){
  expect(sql).toContain('BEGIN READ ONLY;');expect(sql).toContain("statement_timeout='60s'")
  expect(sql).toContain("current_database()<>'pilot_test'");expect(sql).toContain("SET LOCAL ROLE authenticated")
  expect(sql).toContain("row_security_active('public.sj_line_items')")
  expect(sql).toContain('WITH response AS MATERIALIZED');expect(sql).toContain('public.pilot_athel_summary_v1(')
  expect(sql).not.toMatch(/(?:CREATE|ALTER|DROP|COMMIT) /)
  expect(sql.indexOf('ROLLBACK;')).toBeLessThan(sql.indexOf('FINAL_READ_DIAGNOSTIC_VERIFIED'))
 }
})
test('full-history and recent-manager checks keep independent fixture totals and cohorts',()=>{
 const [admin,manager,generic]=buildFinalReadChecks()
 expect(admin.sql).toContain("'2021-01-01','2026-09-30','2025-10-01'")
 expect(admin.sql).toContain("::numeric*1000+600")
 expect(manager.sql).toContain("'2026-07-01','2026-09-30','2025-10-01'")
 for(const value of ['756','750500','375130','375370'])expect(manager.sql).toContain(value)
 expect(generic.sql).toContain("plan_cache_mode='force_generic_plan'")
})
