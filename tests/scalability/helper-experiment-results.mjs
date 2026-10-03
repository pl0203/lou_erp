import { readFileSync,writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
export function summarizeHelperSamples(samples) {
 const roles=['manager','sales','admin'],order=['baseline','candidate','candidate','baseline']
 const expected=order.flatMap((variant,i)=>roles.map((role,j)=>({name:`pair-${String(i*3+j).padStart(2,'0')}-${role}-${variant}`,role,variant})))
 if(samples.length!==expected.length)throw new Error('All twelve bounded paired observations required')
 const byName=new Map(samples.map(x=>[x.name,x]));if(byName.size!==expected.length)throw new Error('Duplicate paired observation')
 for(const e of expected){const s=byName.get(e.name);if(!s||s.role!==e.role||s.variant!==e.variant||s.warmup!==false||!Number.isFinite(s.rpc_elapsed_ms)||s.rpc_elapsed_ms<0)throw new Error('Invalid or missing paired observation')}
 const median=a=>{a.sort((x,y)=>x-y);return (a[0]+a[1])/2}
 const result={screeningOnly:true,statistic:'median of two RPC-only measurements per arm; not p95',roles:{},managerMeetsTwentyPercentScreen:false,rolesNeedingRegressionReview:[],planMechanismReviewRequired:true,capacityAccepted:false}
 for(const role of roles){const baseline=samples.filter(s=>s.role===role&&s.variant==='baseline').map(s=>s.rpc_elapsed_ms),candidate=samples.filter(s=>s.role===role&&s.variant==='candidate').map(s=>s.rpc_elapsed_ms);const b=median(baseline),c=median(candidate);if(b<=0)throw new Error('Positive baseline timing required');const improvement=(b-c)/b*100;result.roles[role]={samples:4,baselineMedianMs:b,candidateMedianMs:c,improvementPercent:improvement};if(c>b)result.rolesNeedingRegressionReview.push(role)}
 result.managerMeetsTwentyPercentScreen=result.roles.manager.improvementPercent>=20
 return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom result paths accepted')
 const root='scale-results/helper-experiment/',order=JSON.parse(readFileSync(root+'packet-order.json','utf8'))
 const samples=order.benchmarks.map(name=>{const log=readFileSync(root+name+'.log','utf8');if(!/^\s*HELPER_EXPERIMENT_RESTORED\s*\|/m.test(log))throw new Error('Missing rollback restoration marker');const rows=[...log.matchAll(/^\s*HELPER_RPC_FINISH (\{[^\n]+\})\s*$/gm)];if(rows.length!==1)throw new Error('Expected one streamed measurement');return JSON.parse(rows[0][1])})
 const summary=summarizeHelperSamples(samples);writeFileSync(root+'paired-summary.json',JSON.stringify({samples,summary},null,2));console.log('HELPER_PAIRED_SCREEN '+JSON.stringify(summary))
}
