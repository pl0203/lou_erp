// @vitest-environment node
import {test,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {runCoFinalChecks} from '../../scripts/test-co-ci.mjs'
const root=(path:string)=>readFileSync(path,'utf8')
const suites=[['foundation.sql','CO_FOUNDATION_AND_COMMANDS_PASSED'],['monthly-fifo.sql','CO_MONTHLY_FIFO_PASSED'],['corrections.sql','CO_RETURNS_CORRECTIONS_PASSED'],['reads.sql','CO_OPERATIONAL_READS_PASSED'],['sales-metrics.sql','CO_SALES_METRICS_PASSED'],['rollout.sql','CO_FINAL_AUDIENCES_PASSED']]
function lane(missing=''){
 const calls:string[]=[];const decoderInputs:string[]=[]
 const output=runCoFinalChecks({read:root,protectedBefore:'a'.repeat(64),run:(sql:string)=>{
  if(sql.includes('CO_PROTECTED_BASELINE_FINGERPRINT'))return 'a'.repeat(64)
  const suite=suites.find(([path])=>sql===root('tests/database/co/'+path));expect(suite).toBeDefined();calls.push(suite![0]);return suite![1]===missing?'':suite![1]+'\nACTUAL_SQL_SENTINEL'
 },decode:(path:string,input:string)=>{expect(input).toContain('ACTUAL_SQL_SENTINEL');decoderInputs.push(path);return path.endsWith('decode-reads.mjs')?'CO_SQL_DECODERS_PASSED':'CO_SALES_METRICS_DECODERS_PASSED'}})
 return {calls,decoderInputs,output}
}
test('final composition reexecutes compatible suites and both actual SQL decoder bridges',()=>{
 const result=lane();expect(result.calls).toEqual(suites.map(s=>s[0]));expect(result.decoderInputs).toEqual(['tests/database/co/decode-reads.mjs','tests/database/co/decode-sales-metrics.mjs'])
 expect(result.output).toContain('CO_FINAL_SQL_DECODERS_PASSED');expect(result.output).toContain('CO_FINAL_SALES_METRICS_DECODERS_PASSED')
})
test.each(suites)('final checkpoint refuses missing %s marker',(_,marker)=>{expect(()=>lane(marker)).toThrow(/marker/)})
test('final runner invokes fixed independently guarded rollout lifecycle and emits success last',()=>{
 const source=root('scripts/test-co-ci.mjs')
 expect(source).toContain('tests/database/co/rollout.mjs')
 expect(source.indexOf("process.stdout.write('CO_FINAL_COMPOSED_DATABASE_PASSED")).toBeGreaterThan(source.lastIndexOf('CO_ATOMIC_ROLLOUT_LIFECYCLE_PASSED'))
})
