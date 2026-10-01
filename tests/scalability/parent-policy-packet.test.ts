// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { buildParentPolicyPackets } from './parent-policy-packet.mjs'
const source=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
const setup=readFileSync('tests/database/parent-set-policy-setup.sql','utf8')
test('small parity rolls back empty before separate same-fixture large benchmarks',()=>{
 const packets=buildParentPolicyPackets(source,setup,"SELECT 'PARENT_SET_POLICY_PARITY_VERIFIED'; -- stub only for assembly test")
 const small=packets.parity,large=packets.benchmark
 expect(small).toContain("current_database()<>'pilot_test'");expect(small).toContain('Empty synthetic database required');expect(small).toContain("SET LOCAL pilot.policy_trial_mode='parity'")
 expect(small.indexOf('PARENT_SET_DRIFT_GUARD_VERIFIED')).toBeLessThan(small.indexOf('PARENT_SET_POLICY_PARITY_VERIFIED'))
 expect(small).not.toContain('baseline-admin');expect(small).toContain('PARITY_ROLLBACK_EMPTY_VERIFIED')
 expect(large).toContain("SET LOCAL pilot.policy_trial_mode='benchmark'");expect(large).not.toContain('-- stub only for assembly test')
 expect(large).toContain('baseline-admin');expect(large).toContain('baseline-manager');expect(large).toContain('candidate-manager');expect(large).toContain('candidate-admin')
 for(const packet of [small,large]){expect(packet).toContain("statement_timeout='60s'");expect(packet.lastIndexOf('ROLLBACK;')).toBeLessThan(packet.lastIndexOf('policy_before'));expect(packet.lastIndexOf('policy_before')).toBeLessThan(packet.lastIndexOf('SCALE_DIAGNOSTIC_VERIFIED'));expect(packet).not.toMatch(/^\s*COMMIT\s*;/m);expect(packet).not.toContain('ALTER POLICY pilot_active_profile');expect(packet).toContain('columns_before')}
 expect(()=>buildParentPolicyPackets(source,setup,'no parity marker')).toThrow()
})
