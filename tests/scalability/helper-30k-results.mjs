import { readFileSync,writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
export function parseHelper30kLog(log,descriptor){
 const finished=[...log.matchAll(/POOLED_RPC_FINISH actor=2 rpc=(\w+) narrow=f rpc_elapsed_ms=([0-9.]+)/g)]
 const assertions=[...log.matchAll(/POOLED_ASSERTION_FINISH actor=2 rpc=(\w+) narrow=f rpc_elapsed_ms=([0-9.]+) oracle_elapsed_ms=([0-9.]+) total_elapsed_ms=([0-9.]+)/g)]
 if(finished.length!==1||assertions.length!==1||finished[0][1]!==descriptor.rpc||assertions[0][1]!==descriptor.rpc
 ||!log.includes(`POOLED_RPC_VERIFIED actor=2 rpc=${descriptor.rpc} narrow=f`)
 ||!log.split('\n').some(line=>line.trim()===`HELPER_EXPERIMENT_RESTORED | ${descriptor.name}`))throw new Error('Incomplete exact RPC/oracle/restoration evidence')
 const rpc=Number(finished[0][2]),oracle=Number(assertions[0][3]),total=Number(assertions[0][4])
 if(!Number.isFinite(rpc)||rpc<0||rpc>=60000||rpc!==Number(assertions[0][2])||!Number.isFinite(oracle)||oracle<0||!Number.isFinite(total)||total<rpc)throw new Error('Invalid bounded timing evidence')
 return {...descriptor,rpc_elapsed_ms:rpc,oracle_and_validation_ms:oracle}
}
export function summarizeHelper30kSamples(samples){
 const rpcs=['summary','stats','lines','daily'],variants=['baseline','candidate','candidate','baseline']
 if(samples.length!==16)throw new Error('All sixteen fixed paired samples required')
 const byName=new Map(samples.map(s=>[s.name,s]));if(byName.size!==16)throw new Error('Duplicate paired sample')
 for(const [i,variant] of variants.entries())for(const [j,rpc] of rpcs.entries()){
  const s=byName.get(`pair-${String(i*4+j).padStart(2,'0')}-${rpc}-${variant}`)
  if(!s||s.rpc!==rpc||s.variant!==variant||s.warmup!==false||!Number.isFinite(s.rpc_elapsed_ms)||s.rpc_elapsed_ms<=0||s.rpc_elapsed_ms>=60000||!Number.isFinite(s.oracle_and_validation_ms)||s.oracle_and_validation_ms<0)throw new Error('Invalid fixed paired observation')
 }
 const result={screeningOnly:true,capacityAccepted:false,statistic:'two fresh-connection observations per arm; shared-buffer warmups; not p95 or pooled performance',rpcs:{},summaryMeetsTwentyPercentScreen:false,rpcsNeedingRegressionReview:[]}
 for(const rpc of rpcs){const rows=samples.filter(s=>s.rpc===rpc),b=rows.filter(s=>s.variant==='baseline').reduce((n,s)=>n+s.rpc_elapsed_ms,0)/2,c=rows.filter(s=>s.variant==='candidate').reduce((n,s)=>n+s.rpc_elapsed_ms,0)/2;result.rpcs[rpc]={baselineMedianMs:b,candidateMedianMs:c,improvementPercent:(b-c)/b*100,maxOracleAndValidationMs:Math.max(...rows.map(s=>s.oracle_and_validation_ms))};if(c>b)result.rpcsNeedingRegressionReview.push(rpc)}
 result.summaryMeetsTwentyPercentScreen=result.rpcs.summary.improvementPercent>=20
 return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('Fixed result paths only')
 const root='scale-results/helper-30k-experiment/',order=JSON.parse(readFileSync(root+'packet-order.json','utf8'))
 const samples=order.benchmarks.map(d=>parseHelper30kLog(readFileSync(root+d.name+'.log','utf8'),d))
 const summary=summarizeHelper30kSamples(samples);writeFileSync(root+'paired-summary.json',JSON.stringify({samples,summary},null,2));console.log('HELPER_30K_PAIRED_SCREEN '+JSON.stringify(summary))
}
