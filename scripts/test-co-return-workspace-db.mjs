// Fixed synthetic-only, guarded fixture runner. No target URL/path/credential flags.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {runCoCi} from './test-co-ci.mjs'
import {installReturnCurrentFunctions} from './co-return-current-functions.mjs'
import {installReturnCurrentSchema} from './co-return-current-schema.mjs'
import {runWorkspaceCurrentBaseline,WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT} from './co-workspace-current-baseline.mjs'
import {coWorkspaceConnection,coSourceIdentity,coBindFixtureServer,CO_FIXTURE_OBSERVATION_SQL,coVerifyFixtureIdentitySql,coFixtureChildEnv} from './co-fixture-target.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
export function returnWorkspaceOptions(args){
 assert.equal(args.length,4,'Fixed case and baseline required')
 assert.equal(args[0],'--case');assert.equal(args[1],'returns');assert.equal(args[2],'--baseline')
 assert.ok(['legacy','current'].includes(args[3]));return {baselineName:args[3]}
}
export function composeReturnFixture(posting,returns){
 const terminal=/ROLLBACK;\s*SELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';\s*$/
 assert.match(posting,terminal)
 assert.equal(posting.split('\n').filter(x=>/^ROLLBACK;\s*$/.test(x)).length,1)
 assert.doesNotMatch(returns,/^\s*(BEGIN|COMMIT|ROLLBACK);/mi)
 return posting.replace(terminal,()=>returns+"\nROLLBACK;\nSELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';\n")
}
// Same real additive read dependency as the original workspace posting fixture.
// Fixed source only: no caller-selected path, target, or replacement SQL.
export function installReturnReadDependency({read,run,verify}){
 const sql=read('supabase/candidates/co-workspace-redesign/20261026101000_co_workspace_reads.sql')
 assert.equal(createHash('sha256').update(sql).digest('hex'),'ba57d414ddf786df64e391765e5634edbf494c05a8c6aa126b8379267503aa57','Workspace-read dependency changed')
 assert.equal(sql.split('\n').filter(line=>/^(BEGIN|COMMIT);\s*$/.test(line)).join(','),'BEGIN;,COMMIT;','One whole workspace-read candidate transaction required')
 assert.ok(sql.trimEnd().endsWith('COMMIT;'),'Terminal workspace-read COMMIT required')
 run(sql);verify()
}
export function composeReturnInstallFailure(candidate){
 assert.match(candidate,/COMMIT;\s*$/,'Terminal candidate COMMIT required')
 // A replacement string would collapse PostgreSQL $$ to $, so return it literally.
 return candidate.replace(/COMMIT;\s*$/,()=>"DO $$ BEGIN RAISE EXCEPTION 'Synthetic return install fault' USING ERRCODE='PZ702';END $$;\nCOMMIT;")
}
export function runReturnWorkspace({env=process.env,execute=execFileSync,sourceIdentity=coSourceIdentity,baselineName='legacy'}={}){
 returnWorkspaceOptions(['--case','returns','--baseline',baselineName])
 const source=sourceIdentity(),expected=coWorkspaceConnection(env,source)
 const {identity,connection}=runCoCi({env,execute,sourceIdentity,through:'08',fixtureProfile:baselineName==='current'?'return-current':'minimal'})
 assert.deepEqual(connection,expected);assert.deepEqual(identity.source,source)
 const run=sql=>execute('psql',['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{env:{...connection,PGDATABASE:'pilot_co_test'},cwd:root,input:sql,encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000,shell:false,stdio:['pipe','pipe','pipe']})
 const verify=()=>{
  coBindFixtureServer({kind:env.CO_CI_PROFILE?'ci':'local',database:'pilot_co_test',source,runIdentity:identity.runIdentity},JSON.parse(run(CO_FIXTURE_OBSERVATION_SQL)),identity)
  assert.equal(run(coVerifyFixtureIdentitySql(identity)).trim(),'t')
 }
 verify()
 if(baselineName==='current'){
  runWorkspaceCurrentBaseline({run,verify,read})
  installReturnCurrentFunctions({read,run,verify})
  installReturnCurrentSchema({read,run,verify})
 }
 const before=baselineName==='current'?run(WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT).trim():null
 run(read('supabase/candidates/co-workspace-redesign/20261026100000_co_import_manifest.sql'));verify()
 installReturnReadDependency({read,run,verify})
 const normalization=run(read('tests/database/co/return-workspace-acl-normalization.sql'))
 assert.equal(normalization.trim(),'CO_RETURN_ACL_NORMALIZATION_PASSED')
 process.stdout.write(normalization)
 const preflightSql=read('tests/database/co/return-workspace-preflight.sql')
 const preflight=JSON.parse(run(preflightSql).trim())
 assert.match(preflight.attestation_sha256,/^[a-f0-9]{64}$/)
 assert.equal(preflight.attestation?.attestation_version,'return-preflight-v1')
 process.stdout.write('CO_RETURN_WORKSPACE_PREFLIGHT '+JSON.stringify({baseline:baselineName,source,preflight_sql_sha256:createHash('sha256').update(preflightSql).digest('hex'),candidate_sha256:createHash('sha256').update(read('supabase/candidates/co-stock-return-workspace/20261027144000_co_stock_return_workspace.sql')).digest('hex'),...preflight})+'\n')
 const schemaSnapshot=read('tests/database/co/return-workspace-parity.sql')
 const schemaBefore=run(schemaSnapshot).trim()
 const candidate=read('supabase/candidates/co-stock-return-workspace/20261027144000_co_stock_return_workspace.sql')
 assert.equal(candidate.split('\n').filter(x=>/^(BEGIN|COMMIT);\s*$/.test(x)).join(','),'BEGIN;,COMMIT;')
 const absent="SELECT to_regclass('private.co_return_workspace_requests') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='private' AND p.proname='co_return_workspace_page_v1') OR (n.nspname='public' AND p.proname IN('pilot_co_return_customers_v1','pilot_co_return_history_customers_v1','pilot_co_return_items_v1','pilot_co_returns_page_v1','pilot_co_return_create_v1','pilot_co_return_create_result_v1')));"
 assert.equal(run(absent).trim(),'t')
 let failed=false
 try{run(composeReturnInstallFailure(candidate))}
 catch(error){assert.match(String(error.stderr??''),/PZ702.*Synthetic return install fault/);failed=true}
 assert.equal(failed,true);assert.equal(run(absent).trim(),'t');assert.equal(run(schemaSnapshot).trim(),schemaBefore,'Failed candidate leaves exact existing schema');verify()
 run(candidate);verify()
 assert.equal(run(schemaSnapshot).trim(),schemaBefore,'Additive install preserves exact existing schema')
 const acl=run(read('tests/database/co/return-workspace-acl.sql'))
 assert.equal(acl.trim(),'CO_RETURN_WORKSPACE_ACL_PASSED')
 process.stdout.write('CO_RETURN_WORKSPACE_INSTALL_PARITY_PASSED\n'+acl)
 const result=run(composeReturnFixture(read('tests/database/co/import-posting.sql'),read('tests/database/co/return-workspace.sql')))
 for(const marker of ['CO_IMPORT_ATOMIC_POST_EDIT_PASSED','CO_RETURN_WORKSPACE_BEHAVIOR_PASSED','CO_RETURN_WORKSPACE_LARGE_READ_PASSED','CO_RETURN_WORKSPACE_SOURCE_SAFETY_PASSED','CO_RETURN_WORKSPACE_PIC_GENERATION_PASSED','CO_RETURN_WORKSPACE_HISTORY_CUSTOMERS_PASSED'])assert.equal(result.split('\n').filter(x=>x===marker).length,1)
 process.stdout.write(result);verify()
 const races=execute(process.execPath,[fileURLToPath(new URL('../tests/database/co/return-workspace-races.mjs',import.meta.url))],{env:coFixtureChildEnv(connection,env,identity),cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000,shell:false,stdio:['pipe','pipe','pipe']})
 assert.equal(races.split('\n').filter(x=>x==='CO_RETURN_WORKSPACE_REAL_RACES_PASSED').length,1);process.stdout.write(races);verify()
 if(baselineName==='current')assert.equal(run(WORKSPACE_CURRENT_AUTHORITY_SNAPSHOT).trim(),before,'Existing current public/private authority must remain exact')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{runReturnWorkspace(returnWorkspaceOptions(process.argv.slice(2)))}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1}}
