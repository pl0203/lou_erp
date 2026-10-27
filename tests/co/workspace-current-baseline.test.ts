// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
import * as runner from '../../scripts/test-co-workspace-db.mjs'
test('fixed baseline selection defaults to the unchanged legacy composition',()=>{
 expect(runner.workspaceOptions(['--case','import-posting'])).toEqual({caseName:'import-posting',baselineName:'legacy'})
 for(const baselineName of ['legacy','current']) for(const caseName of ['import-manifest','import-posting','import-races','workspace-reads']) {
  expect(runner.workspaceOptions(['--case',caseName,'--baseline',baselineName])).toEqual({caseName,baselineName})
 }
})
test('no caller-selected SQL path, target, or baseline can enter composition',()=>{
 for(const args of [[],['--case','other'],['--case','import-posting','--baseline','/tmp/migration.sql'],['--case','import-posting','--baseline','current','--url','postgres://x']]) expect(()=>runner.workspaceOptions(args)).toThrow()
})
test('current composition is installed only after source/server verification and before candidates',()=>{
 const source=readFileSync('scripts/test-co-workspace-db.mjs','utf8')
 expect(source).toContain("if (baselineName === 'current')")
 expect(source.indexOf('verify()\n  if (baselineName')).toBeGreaterThan(source.indexOf('const verify ='))
 expect(source.indexOf('runWorkspaceCurrentBaseline(')).toBeLessThan(source.indexOf('const candidate ='))
})
test('the current baseline pins authored source bytes and rejects drift before SQL execution',async()=>{
 const {workspaceCurrentSourcePins,runWorkspaceCurrentBaseline}=await import('../../scripts/co-workspace-current-baseline.mjs')
 const calls:string[]=[]
 expect(()=>runWorkspaceCurrentBaseline({read:(path:string)=>readFileSync(path,'utf8')+'\n-- drift',run:(sql:string)=>{calls.push(sql);return ''},verify:()=>{}})).toThrow(/source changed/)
 expect(calls).toEqual([])
 expect(workspaceCurrentSourcePins).toHaveLength(11)
})
test('composition runs actual catalogue, capability-off target source, then intact HR gates',async()=>{
 const {runWorkspaceCurrentBaseline}=await import('../../scripts/co-workspace-current-baseline.mjs')
 const calls:string[]=[];let verifications=0
 runWorkspaceCurrentBaseline({read:(path:string)=>readFileSync(path,'utf8'),run:(sql:string)=>{calls.push(sql);return sql.includes('SJ_CATALOGUE_COHERENT_SYNTHETIC_GRAPH_PASSED')?'SJ_CATALOGUE_COHERENT_SYNTHETIC_GRAPH_PASSED\n':sql.includes('CO_WORKSPACE_CURRENT_BASELINE_PASSED')?'CO_WORKSPACE_CURRENT_BASELINE_PASSED\n':''},verify:()=>{verifications++}})
 expect(calls).toHaveLength(6)
 expect(verifications).toBe(6)
 expect(calls[0]).toContain('SELECT private.catalog_assert_checked_graph_v2()')
 expect(calls[5]).toContain('EMPLOYEE_PROTECTED_GATE_PREIMAGE_MISMATCH')
 expect(calls[5]).toContain('EMPLOYEE_CATALOGUE_GATE_PREIMAGE_MISMATCH')
 expect(calls[5]).not.toContain('DISABLE TRIGGER')
 for(const call of calls) expect(call).not.toMatch(/UPDATE private.catalog_cutover_v1/)
})
test('current cases preserve exact HR authority definitions and run real rollback denial assertions',()=>{
 const source=readFileSync('scripts/test-co-workspace-db.mjs','utf8')
 expect(source).toContain('const currentAuthorityBefore =')
 expect(source).toContain("assert.equal(run(WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT).trim(), currentAuthorityBefore")
 expect(source).toContain('tests/database/co/workspace-current-authority.sql')
 const fixture=readFileSync('tests/database/co/workspace-current-authority.sql','utf8')
 expect(fixture).toContain("recorded_status='inactive'")
 expect(fixture).toContain("'2000-01-01'")
 expect(fixture).toContain('public.pilot_co_page_v1')
 expect(fixture).not.toContain('DISABLE TRIGGER')
 expect(fixture.trim()).toMatch(/ROLLBACK;$/)
})
test('current runs execute history invariants and snapshot exact existing history producer metadata',async()=>{
 const {WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT}=await import('../../scripts/co-workspace-current-baseline.mjs')
 expect(WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT).toContain("p.proname ~ '^catalog_history_'")
 expect(WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT).toContain("p.proname = 'catalog_assert_history_contract_v1'")
 const source=readFileSync('scripts/test-co-workspace-db.mjs','utf8')
 expect(source).toContain('tests/database/co/workspace-current-history.sql')
 expect(source).toContain("x === 'CO_WORKSPACE_CURRENT_HISTORY_PASSED'")
})
test('service-role manual attestation denies both real-trigger-restricted actors before unknown evidence work',()=>{
 const fixture=readFileSync('tests/database/co/workspace-current-authority.sql','utf8')
 const service=fixture.split('SET LOCAL ROLE service_role;')[1]?.split('RESET ROLE;')[0]
 expect(service).toBeDefined()
 expect(service).toContain('FOR n IN 1..2 LOOP')
 expect(service).toContain('public.pilot_co_evidence_manual_workbook_attest_v1(')
 expect(service).toContain("WHEN SQLSTATE '42501'")
 expect(service).toContain('IF NOT denied THEN RAISE EXCEPTION')
 expect(service).toContain("md5('workspace-current-unknown-evidence')::uuid")
})
test('HR fixture mutations use the genuine executive without changing co-admin service control',()=>{
 const seed=readFileSync('tests/database/co/fixture.sql','utf8')
 expect(seed).toContain("WHEN 1 THEN 'co_admin' WHEN 2 THEN 'executive'")
 const fixture=readFileSync('tests/database/co/workspace-current-authority.sql','utf8')
 const setup=fixture.split('SET LOCAL ROLE authenticated;')[0]
 expect(setup).toContain("set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true)")
 const mutation=fixture.split('RESET ROLE;')[1]?.split('SET LOCAL ROLE authenticated;')[0]
 expect(mutation).toContain("set_config('request.jwt.claim.sub',md5('co-user-2')::uuid::text,true)")
 const service=fixture.split('SET LOCAL ROLE service_role;')[1]
 expect(service).toContain("md5('co-user-1')::uuid,md5('workspace-current-unknown-evidence')::uuid")
})
