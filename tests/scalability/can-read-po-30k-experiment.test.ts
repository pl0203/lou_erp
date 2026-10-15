// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { buildHelper30kExperiment,buildHelperExperiment } from './can-read-po-experiment.mjs'
test('30k screening fixes four manager RPCs and two balanced observations per arm',()=>{
 const r=buildHelper30kExperiment()
 expect(r.warmups).toHaveLength(8);expect(r.benchmarks).toHaveLength(16)
 for(const rpc of ['summary','stats','lines','daily'])expect(r.benchmarks.filter(x=>x.rpc===rpc).map(x=>x.variant)).toEqual(['baseline','candidate','candidate','baseline'])
 for(const p of [...r.warmups,...r.benchmarks]){
  expect(p.sql).toContain('<>30000');expect(p.sql).toContain('<>300007');expect(p.sql).toContain('<>600005')
  expect(p.sql).toContain("statement_timeout='60s'");expect(p.sql).not.toMatch(/^\s*COMMIT;/m)
  expect(p.sql).toContain(`SELECT pg_temp.pooled_check(2,'${p.rpc}',false);`)
  expect(p.sql.lastIndexOf('ROLLBACK;')).toBeLessThan(p.sql.lastIndexOf('HELPER_EXPERIMENT_RESTORED'))
 }
})
test('30k oracle and timed-check definitions remain byte-identical to the acceptance suite',()=>{
 const source=readFileSync('tests/database/scalable-pooled-reads.sql','utf8')
 const expected=source.slice(source.indexOf('DO $guard$ DECLARE base_rows integer;'),source.indexOf('PREPARE pooled_read(integer,text,boolean)'))
 for(const p of buildHelper30kExperiment().benchmarks)expect(p.sql).toContain(expected)
})
test('all30k packets preserve the same reviewed helper definition and complete metadata guard',()=>{
 const routine=buildHelperExperiment().truth.match(/CREATE FUNCTION pg_temp\.apply_can_read_po_trial\(\)[\s\S]*?END \$apply\$;/)![0]
 const r=buildHelper30kExperiment()
 for(const p of [...r.warmups,...r.benchmarks]){
  expect(p.sql).toContain(routine)
  for(const field of ['pg_constraint','pg_index','pg_trigger','pg_roles','pg_auth_members','helper_only_body_changed'])expect(p.sql).toContain(field)
 }
})
