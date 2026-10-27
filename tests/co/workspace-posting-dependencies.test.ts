// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,test} from 'vitest'
const runner=readFileSync('scripts/test-co-workspace-db.mjs','utf8')
const posting=readFileSync('tests/database/co/import-posting.sql','utf8')
test('posting and race cases install the real read candidate required by immutable revision assertions',()=>{
 expect(posting).toContain('public.pilot_co_report_import_v1(c,m,')
 const install=runner.split("if (caseName !== 'import-manifest') {")[1]?.split("if (caseName === 'workspace-reads') {")[0]
 expect(install).toBeDefined()
 expect(install).toContain('20261026101000_co_workspace_reads.sql')
 expect(install).toContain('One whole workspace-read candidate transaction required')
 expect(install).toContain('Terminal workspace-read COMMIT required')
 expect(install).toContain('run(reads)\n    verify()')
 expect(runner.match(/run\(reads\)/g)).toHaveLength(1)
 expect(runner.indexOf("if (caseName !== 'import-manifest') {")).toBeLessThan(runner.indexOf("if (caseName === 'import-posting' || caseName === 'import-races')"))
 expect(runner).toContain("'CO_IMPORT_ATOMIC_POST_EDIT_PASSED'")
})
