// @vitest-environment node
import { expect,test } from 'vitest'
import { parseHelper30kLog,summarizeHelper30kSamples } from './helper-30k-results.mjs'
const descriptor={name:'pair-00-summary-baseline',rpc:'summary',variant:'baseline',warmup:false}
const log=`NOTICE: POOLED_RPC_FINISH actor=2 rpc=summary narrow=f rpc_elapsed_ms=12000.000
NOTICE: POOLED_ASSERTION_FINISH actor=2 rpc=summary narrow=f rpc_elapsed_ms=12000.000 oracle_elapsed_ms=23.000 total_elapsed_ms=12023.000
 POOLED_RPC_VERIFIED actor=2 rpc=summary narrow=f
 HELPER_EXPERIMENT_RESTORED | pair-00-summary-baseline
`
test('30k parser requires exact RPC, oracle and restoration evidence',()=>{
 expect(parseHelper30kLog(log,descriptor)).toMatchObject({rpc_elapsed_ms:12000,oracle_and_validation_ms:23})
 for(const broken of [log.replace('HELPER_EXPERIMENT_RESTORED','MISSING'),log.replace('POOLED_ASSERTION_FINISH','MISSING'),log.replaceAll('rpc=summary','rpc=stats'),log+log])expect(()=>parseHelper30kLog(broken,descriptor)).toThrow()
})
test('30k paired screen preserves sixteen fixed measurements without treating them as acceptance',()=>{
 const samples=['baseline','candidate','candidate','baseline'].flatMap((variant,i)=>['summary','stats','lines','daily'].map((rpc,j)=>({name:`pair-${String(i*4+j).padStart(2,'0')}-${rpc}-${variant}`,rpc,variant,warmup:false,rpc_elapsed_ms:variant==='baseline'?100:70,oracle_and_validation_ms:1})))
 expect(summarizeHelper30kSamples(samples)).toMatchObject({capacityAccepted:false,summaryMeetsTwentyPercentScreen:true})
 expect(()=>summarizeHelper30kSamples(samples.slice(1))).toThrow()
 expect(()=>summarizeHelper30kSamples([...samples,samples[0]])).toThrow()
 expect(()=>summarizeHelper30kSamples(samples.map(s=>({...s,rpc_elapsed_ms:NaN})))).toThrow()
})
