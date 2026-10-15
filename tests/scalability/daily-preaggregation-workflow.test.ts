// @vitest-environment node
import { readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect,test } from 'vitest'
import { buildDailyPreaggregationExperiment } from './can-read-po-experiment.mjs'
const workflow=readFileSync('.github/workflows/daily-preaggregation.yml','utf8')
const block=workflow.split('      - name: Balanced original candidate daily calls and separately instrumented plans\n        run: |\n')[1].split('      - name: Require')[0].split('\n').map(l=>l.slice(10)).join('\n')
test('daily trial remains same-repo fixed fictional30k with parity before load',()=>{
 expect(workflow).toContain("github.event.pull_request.head.ref == 'fix/pilot-scale-sql'")
 expect(workflow).toContain("github.event.pull_request.base.ref == 'fix/pilot-database'")
 expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository')
 expect(workflow).toContain("SCALE_ROWS: '30000'")
 expect(workflow).toContain('timeout-minutes: 20')
 expect(workflow).toContain('-eq 226')
 expect(workflow).toContain('drop_line_cohort count_empty')
 expect(workflow.indexOf('Exact small daily')).toBeLessThan(workflow.indexOf('Load the reviewed fixed30k'))
 expect(workflow).not.toMatch(/secrets\.|supabase\.co|workflow_dispatch/)
})
test.each(['positive','nonzero','missing file','missing oracle','missing restoration','wrong actor','missing plan'])('actual fixed trial Bash %s',scenario=>{
 const dir=mkdtempSync(join(tmpdir(),'daily-preagg-workflow-'))
 try{
  mkdirSync(join(dir,'scale-results/daily-preaggregation'),{recursive:true})
  const p=buildDailyPreaggregationExperiment()
  for(const packet of [...p.warmups,...p.benchmarks,...p.plans]){
   if(scenario==='missing file'&&packet.name==='pair-07-admin-baseline')continue
   writeFileSync(join(dir,'scale-results/daily-preaggregation',packet.name+'.sql'),'')
  }
  const script=`node(){
   local path="\${@: -1}" name actor=2
   name="\${path##*/}"; name="\${name%.sql}"
   [[ "$name" == *-admin-* ]] && actor=6
   [[ "$CASE" == 'wrong actor' ]] && actor=99
   [[ "$CASE" != 'missing oracle' ]] && echo "POOLED_RPC_VERIFIED actor=$actor rpc=daily narrow=f"
   [[ "$CASE" != 'missing restoration' ]] && echo "HELPER_EXPERIMENT_RESTORED | $name"
   if [[ "$name" == plan-* && "$CASE" != 'missing plan' ]]; then echo "DAILY_PREAGG_PLAN $name"; echo 'Execution Time: 1.000 ms'; fi
   [[ "$CASE" == nonzero ]] && return 1
   return 0
  }\n`+block
  const r=spawnSync('/bin/bash',['-e','-o','pipefail','-c',script],{cwd:dir,env:{...process.env,CASE:scenario},encoding:'utf8'})
  expect(r.status===0).toBe(scenario==='positive')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
