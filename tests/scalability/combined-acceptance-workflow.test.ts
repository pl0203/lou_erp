// @vitest-environment node
import { readFileSync,mkdtempSync,mkdirSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect,test } from 'vitest'
const workflow=readFileSync('.github/workflows/combined-read-acceptance.yml','utf8')
function block(name:string){return workflow.split(`      - name: ${name}\n        run: |\n`)[1].split('      - name:')[0].split('\n').map(l=>l.slice(10)).join('\n')}
const cases=[
 ['Candidate exact all-role ground truth and restored metadata','SCALABILITY_ROLE_GROUND_TRUTH_VERIFIED | fixture\nHELPER_EXPERIMENT_RESTORED | combined-ground','HELPER_EXPERIMENT_RESTORED'],
 ['Candidate unchanged 242 successes and 33 denials in one connection',Array(242).fill('POOLED_RPC_VERIFIED actor=2').concat(Array(33).fill('POOLED_DENIED_VERIFIED daily'),['SCALABLE_POOLED_READS_VERIFIED','HELPER_EXPERIMENT_RESTORED | combined-pooled']).join('\n'),'SCALABLE_POOLED_READS_VERIFIED'],
 ['Guarded candidate SQL suites all 12 races and exact original restoration',['HELPER_RACE_INSTALL_VERIFIED','HELPER_CANDIDATE_SQL_SUITES_VERIFIED',...Array(15).fill('HELPER_COMPAT_SUITE_PASSED fixture'),'PASS all twelve normal-session concurrency scenarios','HELPER_RACE_RESTORATION_VERIFIED','HELPER_CANDIDATE_RACE_ACCEPTANCE_VERIFIED','COMBINED_READ_CANDIDATE_RACE_ACCEPTANCE_VERIFIED'].join('\n'),'HELPER_RACE_RESTORATION_VERIFIED'],
] as const
for(const [name,output,marker] of cases)test.each(['pass','nonzero','missing marker'])(`${name}: %s`,mode=>{
 const dir=mkdtempSync(join(tmpdir(),'combined-workflow-'))
 try{
  mkdirSync(join(dir,'scale-results/combined-read-acceptance'),{recursive:true})
  const text=mode==='missing marker'?output.split('\n').filter(l=>!l.includes(marker)).join('\n'):output
  const r=spawnSync('/bin/bash',['-e','-o','pipefail','-c',`node(){ printf '%s\\n' "$OUTPUT"; return "$EXIT"; }\n`+block(name)],{cwd:dir,env:{...process.env,OUTPUT:text,EXIT:mode==='nonzero'?'1':'0'},encoding:'utf8'})
  expect(r.status===0).toBe(mode==='pass')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('combined gates keep exact sizes ceilings and synthetic branch target',()=>{
 expect(workflow).toContain("github.event.pull_request.head.ref == 'fix/pilot-scale-sql'")
 expect(workflow).toContain("github.event.pull_request.base.ref == 'fix/pilot-database'")
 expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository')
 expect(workflow.match(/image: postgres:17/g)).toHaveLength(2)
 expect(workflow).toContain('job_minutes: 20');expect(workflow).toContain('job_minutes: 45')
 expect(workflow).toContain('-eq 242');expect(workflow).toContain('-eq 33');expect(workflow).toContain('-eq 226')
 expect(workflow).toContain('helper_only daily_only')
 expect(workflow).not.toMatch(/secrets\.|supabase\.co|workflow_dispatch/)
})
