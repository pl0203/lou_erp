// @vitest-environment node
import { expect,test } from 'vitest'
import { summarizeHelperSamples } from './helper-experiment-results.mjs'
const samples=()=>['baseline','candidate','candidate','baseline'].flatMap((variant,i)=>['manager','sales','admin'].map((role,j)=>({name:`pair-${String(i*3+j).padStart(2,'0')}-${role}-${variant}`,role,variant,warmup:false,rpc_elapsed_ms:variant==='baseline'?100:70})))
test('paired result summary preserves all roles and labels medians as screening only',()=>{
 const r=summarizeHelperSamples(samples());expect(r.screeningOnly).toBe(true);expect(r.managerMeetsTwentyPercentScreen).toBe(true);expect(r.roles.manager.improvementPercent).toBe(30);expect(r.roles.admin.samples).toBe(4)
})
test('missing, duplicate, wrong-variant, nonfinite or invalid timing samples cannot pass',()=>{
 const good=samples();expect(()=>summarizeHelperSamples(good.slice(1))).toThrow();expect(()=>summarizeHelperSamples([...good,good[0]])).toThrow();
 for(const bad of [{...good[0],variant:'candidate'},{...good[0],rpc_elapsed_ms:NaN},{...good[0],rpc_elapsed_ms:-1}])expect(()=>summarizeHelperSamples([bad,...good.slice(1)])).toThrow()
})
test('slower candidates remain visible instead of being reported as an accepted improvement',()=>{
 const r=summarizeHelperSamples(samples().map(s=>({...s,rpc_elapsed_ms:s.variant==='candidate'?120:100})));expect(r.managerMeetsTwentyPercentScreen).toBe(false);expect(r.roles.manager.improvementPercent).toBe(-20);expect(r.rolesNeedingRegressionReview).toEqual(['manager','sales','admin'])
})
