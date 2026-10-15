import { mkdirSync,writeFileSync,readFileSync } from 'node:fs'
import { buildDailyPreaggregationExperiment,summarizeDailyPreaggregation,buildHelperExperiment } from './can-read-po-experiment.mjs'
if(process.argv.length>3||![undefined,'results'].includes(process.argv[2]))throw new Error('Only fixed daily trial/results are supported')
const root='scale-results/daily-preaggregation/',p=buildDailyPreaggregationExperiment()
if(process.argv[2]==='results'){
 const rows=[]
 for(const packet of [...p.warmups,...p.benchmarks,...p.plans]){
  const log=readFileSync(root+packet.name+'.log','utf8'),actor=packet.role==='manager'?2:6
  const r=[...log.matchAll(/POOLED_RPC_FINISH actor=(\d+) rpc=daily narrow=f rpc_elapsed_ms=([\d.]+)/g)]
  const checks=[...log.matchAll(/POOLED_ASSERTION_FINISH actor=(\d+) rpc=daily narrow=f rpc_elapsed_ms=([\d.]+) oracle_elapsed_ms=([\d.]+) total_elapsed_ms=([\d.]+)/g)]
  if(r.length!==1||checks.length!==1||+r[0][1]!==actor||+checks[0][1]!==actor||r[0][2]!==checks[0][2]
   ||!log.split('\n').some(l=>l.trim()===`POOLED_RPC_VERIFIED actor=${actor} rpc=daily narrow=f`)
   ||!log.split('\n').some(l=>l.trim()===`HELPER_EXPERIMENT_RESTORED | ${packet.name}`))throw new Error('Missing exact daily observation/restoration')
  const ms=+r[0][2],oracle=+checks[0][3],total=+checks[0][4]
  if(!Number.isFinite(ms)||ms<=0||ms>=60000||!Number.isFinite(oracle)||oracle<0||!Number.isFinite(total)||total<ms)throw new Error('Invalid daily timing')
  if(packet.phase==='pair')rows.push({name:packet.name,role:packet.role,variant:packet.variant,ms,oracleAndValidationMs:oracle})
 }
 const result={screeningOnly:true,p95Accepted:false,statistic:'two fresh-connection observations per arm; shared-buffer warmups',roles:summarizeDailyPreaggregation(rows),samples:rows}
 writeFileSync(root+'paired-results.json',JSON.stringify(result,null,2));console.log('DAILY_PREAGGREGATION_SCREEN '+JSON.stringify(result))
}else{
 mkdirSync(root,{recursive:true});const small=buildHelperExperiment()
 writeFileSync(root+'truth.sql',small.truth,{flag:'wx'})
 for(const packet of small.policy)writeFileSync(root+packet.name+'.sql',packet.sql,{flag:'wx'})
 writeFileSync(root+'parity.sql',p.parity,{flag:'wx'})
 for(const packet of [...p.warmups,...p.benchmarks,...p.plans])writeFileSync(root+packet.name+'.sql',packet.sql,{flag:'wx'})
}
