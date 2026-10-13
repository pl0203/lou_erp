// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { buildScalarProfilePackets } from './scalar-profile-packet.mjs'
const source=readFileSync('supabase/migrations/202610010002_scalable_report_reads.sql','utf8')
const parent=readFileSync('tests/database/parent-set-policy-setup.sql','utf8'),parity=readFileSync('tests/database/parent-set-parity.sql','utf8')
test('scalar experiment keeps parent-set baseline and changes only five active-profile predicates',()=>{
 const setup=readFileSync('tests/database/scalar-profile-policy-setup.sql','utf8')
 expect(setup.match(/ALTER POLICY pilot_active_profile ON public\./g)).toHaveLength(6) // five candidates plus one deliberately rejected drift probe
 expect(setup).not.toMatch(/ALTER POLICY (?!pilot_active_profile)/)
 expect(setup).toContain('USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL)')
 const packets=buildScalarProfilePackets(source,parent,setup,parity)
 expect(packets.parity).toContain('SCALAR_PROFILE_POLICY_PARITY_VERIFIED')
 expect(packets.parity).toContain('SELECT pg_temp.apply_scalar_profile_policy();')
 expect(packets.benchmarks.map(p=>p.name)).toEqual(['scalar-profile-baseline-admin','scalar-profile-baseline-manager','scalar-profile-candidate-admin','scalar-profile-candidate-manager'])
 for(const p of packets.benchmarks){expect(p.sql).toContain('SELECT pg_temp.apply_parent_set_policy();');expect(p.sql).toContain('EXPLAIN (ANALYZE,BUFFERS,VERBOSE,TIMING OFF) SELECT count(*) FROM public.sj_line_items;');expect(p.sql).toContain("statement_timeout='60s'");expect(p.sql).toContain('ROLLBACK;');expect(p.sql).not.toMatch(/^\s*COMMIT;/m)}
})
