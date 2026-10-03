// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { buildHelperExperiment, helperCandidate, helperOriginal } from './can-read-po-experiment.mjs'

test('candidate preserves global NULL semantics and reads one active caller without nested role helpers', () => {
  expect(helperCandidate).toContain('SELECT EXISTS')
  expect(helperCandidate).toContain('FROM public.users caller')
  expect(helperCandidate).toContain('caller.is_active AND caller.role IS NOT NULL')
  expect(helperCandidate).toContain("caller.role IN ('po_admin','sales_head','executive')")
  expect(helperCandidate).toContain('FROM public.girard_orders')
  expect(helperCandidate).toContain('FROM public.orders')
  expect(helperCandidate).not.toMatch(/current_user_role|pilot_can_access_actor|public.purchase_orders|actor\.is_active|actor\.role/)
  expect(helperCandidate.match(/auth\.uid\(\)/g)).toHaveLength(1)
  expect(helperOriginal).toContain('private.pilot_can_access_actor')
})

test('experiment is fixed 6k, rollback guarded and balanced for each role', () => {
  const result=buildHelperExperiment()
  expect(result.benchmarks).toHaveLength(12)
  for (const role of ['manager','sales','admin']) {
    expect(result.benchmarks.filter(p=>p.role===role).map(p=>p.variant)).toEqual(['baseline','candidate','candidate','baseline'])
  }
  for (const packet of [...result.benchmarks,...result.plans]) {
    expect(packet.sql).toContain("current_database()<>'pilot_test'")
    expect(packet.sql).toContain("<>6000")
    expect(packet.sql).toContain("statement_timeout='60s'")
    expect(packet.sql).toContain('row_security_active')
    expect(packet.sql).not.toMatch(/^\s*COMMIT\s*;/m)
    expect(packet.sql.lastIndexOf('ROLLBACK;')).toBeLessThan(packet.sql.lastIndexOf('HELPER_EXPERIMENT_RESTORED'))
    expect(packet.sql).toContain("to_jsonb(p)-'prosrc'")
  }
})

test('unchanged installed policy oracle is exercised under both helper bodies', () => {
  const result=buildHelperExperiment()
  const source=readFileSync('tests/database/scalable-policy-state.sql','utf8')
  for (const packet of result.policy) {
    expect(packet.sql).toContain(source.slice(source.indexOf('SET LOCAL statement_timeout'),source.lastIndexOf('ROLLBACK;')))
    expect(packet.sql).toContain('FINAL_READ_POLICY_MATRIX_VERIFIED')
    expect(packet.sql).toContain('HELPER_EXPERIMENT_RESTORED')
  }
  expect(result.policy.map(x=>x.variant)).toEqual(['baseline','candidate'])
})

test('no deployable migration is changed by experiment and truth table has required negative controls', () => {
  const result=buildHelperExperiment()
  expect(result.truth).toContain('HELPER_DIRECT_TRUTH_VERIFIED')
  for (const marker of ['constant_false','constant_true','missing_caller_null','requires_parent']) expect(result.truth).toContain(marker)
  expect(result.truth).toContain('22P02')
  expect(result.truth).toContain('force_generic_plan')
  expect(result.truth).toContain('HELPER_EXPERIMENT_RESTORED')
})

test('extension configuration remains privileged and capture/restoration have session bounds',()=>{
 const r=buildHelperExperiment()
 for(const packet of [...r.policy,...r.benchmarks,...r.plans]){
  expect(packet.sql.indexOf("SET statement_timeout='60s';")).toBeLessThan(packet.sql.indexOf('helper_catalog_before'))
  for(const catalog of ['pg_constraint','pg_index','pg_trigger','pg_roles','pg_auth_members'])expect(packet.sql).toContain(catalog)
 }
 for(const packet of r.plans){
  expect(packet.sql).toContain("RESET ROLE;\nSET LOCAL auto_explain.log_min_duration='1s';\nSET LOCAL auto_explain.log_analyze=off;\nSET LOCAL ROLE authenticated;")
 }
})

test('every generated packet preserves the exact dollar-quoted apply routine from the passing truth packet',()=>{
 const r=buildHelperExperiment()
 const routine=r.truth.match(/CREATE FUNCTION pg_temp\.apply_can_read_po_trial\(\)[\s\S]*?END \$apply\$;/)![0]
 expect(routine).toContain('AS $$')
 for(const p of [...r.policy,...r.warmups,...r.benchmarks,...r.plans])expect(p.sql).toContain(routine)
})
