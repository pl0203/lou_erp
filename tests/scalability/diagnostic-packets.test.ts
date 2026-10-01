// @vitest-environment node
import { expect, test } from 'vitest'
import { buildDiagnosticPackets } from './diagnostic-packets.mjs'
test('four fixed fresh-session cases distinguish recent cohorts and full-history admin planning',()=>{
 const packets=buildDiagnosticPackets();expect(packets).toHaveLength(4)
 expect(packets.map(p=>[p.name,p.role,p.from,p.planMode])).toEqual([
 ['recent-manager','managerA','2026-07-01','auto'],['recent-admin','po_admin','2026-07-01','auto'],
 ['history-admin-auto','po_admin','2021-01-01','auto'],['history-admin-custom','po_admin','2021-01-01','force_custom_plan']])
 for(const p of packets){expect(p.sql).toContain('BEGIN READ ONLY;');expect(p.sql).toContain("statement_timeout='60s'");expect(p.sql).toContain("current_database()<>'pilot_test'");expect(p.sql).toContain("purpose='disposable-pilot-ci'");expect(p.sql).toContain("manifest->'base'->>'purchase_orders'");expect(p.sql).toContain('<>6000');expect(p.sql).toContain('SET LOCAL ROLE authenticated');expect(p.sql).toContain('row_security_active');expect(p.sql).toContain('EXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF)');expect(p.sql).toContain(`'${p.from}','2026-09-30','2025-10-01','all','all'`);expect(p.sql).toContain('ROLLBACK;');expect(p.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|COMMIT|CREATE|ALTER)\b/)}
})
