// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
const workflow=readFileSync('.github/workflows/helper-read-experiment.yml','utf8')
test('fixed helper trial is restricted to the reviewed same-repository draft branch and disposable PG17',()=>{
 expect(workflow).toContain("github.event.pull_request.base.ref == 'fix/pilot-database'")
 expect(workflow).not.toContain('github.event.pull_request.number')
 expect(workflow).toContain("github.event.pull_request.head.ref == 'fix/pilot-scale-sql'")
 expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository')
 expect(workflow).toContain('contents: read')
 expect(workflow).toContain('image: postgres:17')
 expect(workflow).toContain("SCALE_ROWS: '6000'")
 expect(workflow).toContain('PGHOST: 127.0.0.1')
 expect(workflow).toContain('timeout-minutes: 20')
 expect(workflow).not.toMatch(/workflow_dispatch|secrets\.|supabase\.co|--rows 30000/)
})
test('truth and unchanged matrix gate large fixture; strict pipeline/restoration gates all timing packets',()=>{
 expect(workflow.indexOf('Independent helper truth')).toBeLessThan(workflow.indexOf('Load the reviewed fixed6k'))
 expect(workflow.indexOf('Unchanged installed620')).toBeLessThan(workflow.indexOf('Load the reviewed fixed6k'))
 expect(workflow).toContain('shell: bash')
 expect(workflow).not.toMatch(/^\s*psql /m)
 expect(workflow).toContain('node scripts/run-disposable-psql.mjs --file')
 expect(workflow).toContain('HELPER_EXPERIMENT_RESTORED')
 expect(workflow).toContain('exit "$failed"')
 expect(workflow.indexOf('Balanced warmups')).toBeLessThan(workflow.indexOf('Separate bounded helper'))
 expect(workflow).toContain('if: always()')
})
