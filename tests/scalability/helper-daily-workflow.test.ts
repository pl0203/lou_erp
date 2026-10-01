// @vitest-environment node
import { readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect,test } from 'vitest'
const workflow=readFileSync('.github/workflows/helper-daily-diagnostic.yml','utf8')
const block=workflow.split('      - name: Exact custom generic and instrumented daily plans with complete oracle\n        run: |\n')[1].split('      - name: Preserve')[0].split('\n').map(l=>l.slice(10)).join('\n')
test.each([
 ['positive',0,true],['SQL failure despite markers',1,false],
 ['missing file',0,false],['missing oracle',0,false],['wrong actor',0,false],
 ['missing restoration',0,false],['missing cost plan',0,false],['missing actual plan',0,false],
] as const)('actual daily Bash loop: %s',(_label,exit,pass)=>{
 const dir=mkdtempSync(join(tmpdir(),'daily-workflow-'))
 try{
  mkdirSync(join(dir,'scale-results/helper-daily-diagnostic'),{recursive:true})
  for(const role of ['manager','admin'])for(const mode of ['force_custom_plan','force_generic_plan','auto']){
   if(_label==='missing file'&&role==='admin'&&mode==='auto')continue
   writeFileSync(join(dir,`scale-results/helper-daily-diagnostic/daily-${role}-${mode}.sql`),'')
  }
  const script=`node(){
    local path="\${@: -1}" name actor=2
    name="\${path##*/}"; name="\${name%.sql}"
    [[ "$name" == daily-admin-* ]] && actor=6
    [[ "$SYNTHETIC_CASE" == 'wrong actor' ]] && actor=99
    [[ "$SYNTHETIC_CASE" != 'missing oracle' ]] && echo "POOLED_RPC_VERIFIED actor=$actor rpc=daily narrow=f"
    [[ "$SYNTHETIC_CASE" != 'missing restoration' ]] && echo "HELPER_EXPERIMENT_RESTORED | $name"
    [[ "$SYNTHETIC_CASE" != 'missing cost plan' ]] && echo "DAILY_COST_PLAN $name"
    [[ "$SYNTHETIC_CASE" != 'missing actual plan' ]] && echo "DAILY_INSTRUMENTED_INNER_PLAN $name"
    return "$SYNTHETIC_EXIT"
  }\n`+block
  const result=spawnSync('/bin/bash',['-e','-o','pipefail','-c',script],{cwd:dir,env:{...process.env,SYNTHETIC_CASE:_label,SYNTHETIC_EXIT:String(exit)},encoding:'utf8'})
  expect(result.status===0).toBe(pass)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
