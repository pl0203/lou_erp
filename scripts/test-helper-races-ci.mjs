// Candidate cross-session visibility exists only in this fresh ephemeral CI job.
import { execFileSync } from 'node:child_process'
import { mkdirSync,writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { sanitizeConnectionEnv } from '../tests/scalability/measure-reads.mjs'
import { verifyScaleConnectionTarget } from './verify-scale-target.mjs'
import { buildHelperRaceLifecycle,helperRaceStateSql } from '../tests/scalability/can-read-po-experiment.mjs'
const compatibilitySuites=[
 'supabase/tests/security/explicit_guards.sql','supabase/tests/security/pilot_security.sql',
 'supabase/tests/security/storage_helpers.sql','supabase/tests/security/storage_rls.sql',
 'tests/database/order-transactions.sql','tests/database/nullable-catalog-prices.sql','tests/database/visit-transactions.sql',
 'tests/database/scalable-policy-state.sql','tests/database/scalable-index.sql',
 'tests/database/scalable-summary-parity.sql','tests/database/scalable-customer-parity.sql','tests/database/scalable-sales-page-parity.sql',
 'tests/database/scalable-order-reads.sql','tests/database/scalable-report-boundaries.sql','tests/database/scalable-report-reads.sql',
]
export function helperRaceConnection(env){
 const connection=sanitizeConnectionEnv(env)
 verifyScaleConnectionTarget({host:connection.PGHOST,database:connection.PGDATABASE,permit:env.SCALE_PERMIT,rows:Number(env.SCALE_ROWS)})
 if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='pl0203/lou_erp'||!/^\d+$/.test(env.GITHUB_RUN_ID??'')||env.SCALE_ROWS!=='6000')throw new Error('Only the fixed companion repository CI job is allowed')
 return connection
}
export function runHelperRaceAcceptance({env=process.env,execute=execFileSync,evidenceDir='scale-results/helper-races',stateSql=helperRaceStateSql,buildLifecycle=buildHelperRaceLifecycle,bodyField='helper_source_md5'}={}){
 const connection=helperRaceConnection(env)
 const sql=s=>execute('psql',['-X','--no-password','-qAt','--set=ON_ERROR_STOP=1'],{env:connection,input:s,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,shell:false,stdio:['pipe','pipe','pipe']})
 const state=()=>{
  const lines=String(sql(stateSql())).trim().split('\n').filter(s=>s.startsWith('{'))
  if(lines.length!==1)throw new Error('Exactly one helper state record required')
  const value=JSON.parse(lines[0]);if(value.marker!=='HELPER_RACE_STATE'||['catalog_md5','normalized_catalog_md5',bodyField,'buckets_md5'].some(k=>!/^[a-f0-9]{32}$/.test(value[k]??'')))throw new Error('Invalid helper metadata receipt')
  return value
 }
 const before=state(),lifecycle=buildLifecycle(before.catalog_md5)
 if(before[bodyField]!==lifecycle.originalHash||before.normalized_catalog_md5!==before.catalog_md5)throw new Error('Exact original helper required before candidate installation')
 if(!/^HELPER_RACE_EMPTY_VERIFIED$/m.test(String(sql(lifecycle.empty))))throw new Error('Fresh empty companion fixture required')
 mkdirSync(evidenceDir,{recursive:true})
 // Persist the actual pre-install receipt before any helper commit or child process.
 writeFileSync(`${evidenceDir}/before.json`,JSON.stringify(before,null,2),{flag:'wx'})
 writeFileSync(`${evidenceDir}/install.sql`,lifecycle.install,{flag:'wx'})
 writeFileSync(`${evidenceDir}/restore.sql`,lifecycle.restore,{flag:'wx'})
 let failure=null,restored=false,racesPassed=false
 try {
  const receipt=String(sql(lifecycle.install));writeFileSync(`${evidenceDir}/install.log`,receipt)
  if(!/^HELPER_RACE_CANDIDATE_COMMITTED$/m.test(receipt))throw new Error('Candidate commit receipt missing')
  const active=state()
  if(active[bodyField]!==lifecycle.candidateHash||active.normalized_catalog_md5!==before.catalog_md5||active.buckets_md5!==before.buckets_md5)throw new Error('Candidate differs outside reviewed helper body')
  writeFileSync(`${evidenceDir}/active.json`,JSON.stringify(active,null,2),{flag:'wx'})
  console.log('HELPER_RACE_INSTALL_VERIFIED')
  mkdirSync(`${evidenceDir}/suites`,{recursive:true})
  for(const file of compatibilitySuites){
   const marker=`HELPER_COMPAT_SUITE_PASSED ${file}`
   let output
   // Original --file preserves relative \ir resolution. Session bounds also cover
   // suites whose own transaction does not set a statement timeout.
   try{output=String(execute('psql',['-X','--no-password','-qAt','--set=ON_ERROR_STOP=1',"--command=SET statement_timeout='60s'; SET lock_timeout='5s'; SET TIME ZONE 'UTC';",`--file=${file}`,`--command=SELECT '${marker}';`],{env:connection,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,shell:false,stdio:['pipe','pipe','pipe']}))}
   catch(error){writeFileSync(`${evidenceDir}/suites/${file.replaceAll('/','_')}.log`,String(error.stdout??'')+'\n'+String(error.stderr??error));throw error}
   writeFileSync(`${evidenceDir}/suites/${file.replaceAll('/','_')}.log`,output)
   if(!output.split('\n').includes(marker))throw new Error(`Compatibility suite completion missing: ${file}`)
   const preserved=state()
   if(preserved[bodyField]!==lifecycle.candidateHash||preserved.normalized_catalog_md5!==before.catalog_md5||preserved.buckets_md5!==before.buckets_md5)throw new Error(`Compatibility suite changed protected state: ${file}`)
   if(!/^HELPER_RACE_EMPTY_VERIFIED$/m.test(String(sql(lifecycle.candidateEmpty))))throw new Error(`Compatibility suite left business rows: ${file}`)
   console.log(marker)
  }
  console.log('HELPER_CANDIDATE_SQL_SUITES_VERIFIED')
  let output
  try { output=String(execute(process.execPath,['tests/database/concurrency.mjs'],{env:connection,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024,shell:false,stdio:['pipe','pipe','pipe']})) }
  catch(error){writeFileSync(`${evidenceDir}/races-failure.log`,String(error.stdout??'')+'\n'+String(error.stderr??error));throw error}
  writeFileSync(`${evidenceDir}/races.log`,output)
  if(!/^PASS all twelve normal-session concurrency scenarios$/m.test(output))throw new Error('Complete candidate race marker missing')
  racesPassed=true;console.log(output.trim())
 } catch(error){failure=error}
 finally {
  try {
   const current=state()
   if(current.normalized_catalog_md5!==before.catalog_md5||current.buckets_md5!==before.buckets_md5)throw new Error('Unexpected companion metadata/data drift; restoration refused')
   if(current[bodyField]===lifecycle.candidateHash){
    const receipt=String(sql(lifecycle.restore));writeFileSync(`${evidenceDir}/restore.log`,receipt)
    if(!/^HELPER_RACE_RESTORED$/m.test(receipt))throw new Error('Original helper restoration receipt missing')
   } else if(current[bodyField]!==lifecycle.originalHash)throw new Error('Unknown helper body; restoration refused')
   const after=state();writeFileSync(`${evidenceDir}/after.json`,JSON.stringify(after,null,2))
   if(JSON.stringify(after)!==JSON.stringify(before))throw new Error('Original helper/catalog/ACL restoration mismatch')
   if(!/^HELPER_RACE_EMPTY_VERIFIED$/m.test(String(sql(lifecycle.empty))))throw new Error('Synthetic race fixture was not cleaned by its existing harness')
   restored=true;console.log('HELPER_RACE_RESTORATION_VERIFIED')
  } catch(error){failure=failure?new AggregateError([failure,error],'Race failure and restoration failure'):error}
 }
 if(failure)throw failure
 if(!racesPassed||!restored)throw new Error('Candidate race acceptance incomplete')
 console.log('HELPER_CANDIDATE_RACE_ACCEPTANCE_VERIFIED')
 return {racesPassed,restored,compatibilitySuites:compatibilitySuites.length}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom race targets or arguments accepted')
 runHelperRaceAcceptance()
}
