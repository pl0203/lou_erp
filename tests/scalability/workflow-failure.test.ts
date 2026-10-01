// @vitest-environment node
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

const workflow=readFileSync('.github/workflows/scalability-sql.yml','utf8')
function stepScript(name:string) {
 const section=workflow.split(`      - name: ${name}\n`)[1]?.split('      - name:')[0]
 if(!section)throw new Error('Missing workflow step')
 const run=section.split('        run: ')[1]
 return run.startsWith('|\n') ? run.slice(2).split('\n').filter(line=>line.startsWith('          ')).map(line=>line.slice(10)).join('\n') : run.split('\n')[0]
}
function executeStep(name:string, output:string, status:number) {
 const dir=mkdtempSync(join(tmpdir(),'scale-pipeline-'));mkdirSync(join(dir,'scale-results'))
 try {
  mkdirSync(join(dir,'scale-results/customer-diagnostics'))
  for(const name of ['one','two','three','four'])writeFileSync(join(dir,`scale-results/customer-diagnostics/${name}.sql`),'synthetic command placeholder')
  // Run the actual workflow script, replacing only the external database/fixture commands.
  const script=stepScript(name).replace(/^.*node tests\/scalability\/(?:generate-fixtures|diagnostic-packets|query-plan-packets|summary-ab-packets|parent-policy-packet|scalar-profile-packet|final-read-checks|customer-plan-packets).*$/gm,':').replace(/node scripts\/run-disposable-psql\.mjs --file (?:[^ |]+|"[^"]+")/g,`( printf '%s\\n' '${output}'; exit ${status} )`)
  const explicitBash=/defaults:\s*\n\s+run:\s*\n\s+shell: bash/.test(workflow)
  return spawnSync('bash',explicitBash?['--noprofile','--norc','-e','-o','pipefail','-c',script]:['-e','-c',script],{cwd:dir,encoding:'utf8'}).status
 }finally{rmSync(dir,{recursive:true,force:true})}
}
const cases=[
 ['Verify customer report parity','SCALABLE_CUSTOMER_PARITY_VERIFIED'],
 ['Verify installed policy matrix and rollback','FINAL_READ_POLICY_MATRIX_VERIFIED\nFINAL_READ_POLICY_ROLLBACK_VERIFIED'],
 ['Customer report plan diagnostics',' CUSTOMER_PLAN_DIAGNOSTIC_VERIFIED | synthetic-case'],
 ['Emit and load permitted synthetic fixture with actual SQL marker guard',' SYNTHETIC_SCALE_FIXTURE_LOADED | 53010959'],
 ['Exact role ground truth and bounded query diagnostics',' SCALABILITY_ROLE_GROUND_TRUTH_VERIFIED | PostgreSQL17 | 53010959'],
 ['Same-session repeated reads and identity transitions','SCALABLE_POOLED_READS_VERIFIED'],
] as const
for(const [name,marker] of cases){
 test(`${name}: nonzero SQL status survives tee even if marker was printed`,()=>expect(executeStep(name,marker,1)).not.toBe(0))
 test(`${name}: zero exit without completion marker fails`,()=>expect(executeStep(name,'incomplete SQL output',0)).not.toBe(0))
 test(`${name}: successful SQL plus required completion marker passes`,()=>expect(executeStep(name,marker,0)).toBe(0))
}
