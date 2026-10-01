// Fixed ephemeral GitHub PostgreSQL service only. Never a hosted database runner.
import {execFileSync} from 'node:child_process'
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {sanitizeConnectionEnv} from '../tests/scalability/measure-reads.mjs'
import {verifyScaleConnectionTarget} from './verify-scale-target.mjs'
import {buildGuardedReadRollout,buildGuardedReadRollback} from './build-read-rollout.mjs'
export function rolloutCiConnection(env){
 const connection=sanitizeConnectionEnv(env)
 verifyScaleConnectionTarget({host:connection.PGHOST,database:connection.PGDATABASE,permit:env.SCALE_PERMIT,rows:Number(env.SCALE_ROWS)})
 if(env.GITHUB_ACTIONS!=='true'||env.CI!=='true'||env.GITHUB_REPOSITORY!=='pl0203/lou_erp'||!/^\d+$/.test(env.GITHUB_RUN_ID??''))throw new Error('Only the authorized ephemeral repository CI job may run this test')
 return connection
}
export async function runReadRolloutCi({env=process.env,execute=execFileSync,repoRoot=process.cwd()}={}){
 const connection=rolloutCiConnection(env)
 const run=(sql,db='pilot_rollout_test')=>execute('psql',['-X','--no-password','-qAt','--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose'],{env:{...connection,PGDATABASE:db},input:sql,encoding:'utf8',timeout:120000,shell:false,stdio:['pipe','pipe','pipe']})
 const oneJson=output=>JSON.parse(output.trim().split('\n').filter(Boolean).at(-1))
 // Verify the existing fixture marker on the same guarded loopback service before
 // creating one fixed companion database. Existing companion names fail; no reset/drop.
 const marker=run("SELECT current_database()='pilot_test' AND current_user='postgres' AND (SELECT count(*) FROM public.pilot_fixture_marker)=1 AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci');",'pilot_test').trim()
 if(marker!=='t')throw new Error('Original disposable fixture marker required')
 run('CREATE DATABASE pilot_rollout_test;','postgres')
 run(readFileSync(`${repoRoot}/tests/database/fixture.sql`,'utf8'))
 for(const file of readdirSync(`${repoRoot}/supabase/migrations`).filter(f=>f.startsWith('202609')).sort())run(readFileSync(`${repoRoot}/supabase/migrations/${file}`,'utf8'))
 const topology=readFileSync(`${repoRoot}/tests/database/hosted-read-policy-fixture.sql`,'utf8')
 if(topology.split("current_database()<>'pilot_test'").length!==2)throw new Error('Unexpected fixture database guard')
 run(topology.replace("current_database()<>'pilot_test'","current_database()<>'pilot_rollout_test'"))
 // Explicit provider approximations for the safe metadata snapshot, no credentials.
 run(`ALTER TABLE auth.users ADD COLUMN email text,ADD COLUMN role text,ADD COLUMN aud text,ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE storage.objects ADD COLUMN metadata jsonb;
INSERT INTO auth.users(id,email,role,aud) VALUES('96000000-0000-0000-0000-000000000001','rollout-ci@example.invalid','authenticated','authenticated');
INSERT INTO public.users(id,email,full_name,role,is_active) VALUES('96000000-0000-0000-0000-000000000001','rollout-ci@example.invalid','Synthetic rollout actor','executive',true);
INSERT INTO public.customers(id,name) VALUES('96000000-0000-0000-0000-000000000002','Synthetic rollout fingerprint');
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('visits','synthetic-rollout-metadata-only','96000000-0000-0000-0000-000000000001','{"size":0}');`)
 const snapshot=()=>oneJson(run("BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path='';\n"+readFileSync(`${repoRoot}/scripts/read-rollout-snapshot.sql`,'utf8')+'\nROLLBACK;'))
 mkdirSync(`${repoRoot}/rollout-results`,{recursive:true})
 const reject=(sql,message)=>{try{run(sql)}catch(error){if(new RegExp('ERROR:\\s+P0001: '+message+'(?:\\r?\\n|$)').test(String(error.stderr)))return;throw error}throw new Error('Expected guarded rejection did not occur')}
 for(const reuse of [false,true]){
  if(reuse)run('CREATE INDEX synthetic_existing_po_lookup ON public.girard_orders(po_id);')
  const before=snapshot(),options={repoRoot,expectedDatabase:'pilot_rollout_test',expectedDataHash:before.data_md5,expectedSchemaHash:before.schema_md5}
  const bad=await buildGuardedReadRollout({...options,expectedDataHash:'0'.repeat(32)})
  reject(bad.sql,'Approved baseline fingerprint drift')
  if(snapshot().schema_md5!==before.schema_md5)throw new Error('Rejected apply changed schema')
  console.log(`READ_ROLLOUT_BAD_BASELINE_REJECTED reuse=${reuse}`)
  const apply=await buildGuardedReadRollout(options)
  writeFileSync(`${repoRoot}/rollout-results/apply-${reuse?'reuse':'new'}.sql`,apply.sql)
  const receipt=oneJson(run(apply.sql))
  if(receipt.result!=='READ_ROLLOUT_COMMITTED'||receipt.index_created!==!reuse||receipt.data_md5!==before.data_md5)throw new Error('Apply receipt mismatch')
  const after=snapshot()
  if(after.schema_md5!==receipt.after_schema_md5||after.data_md5!==before.data_md5)throw new Error('Committed apply state mismatch')
  console.log(`READ_ROLLOUT_APPLY_VERIFIED reuse=${reuse}`)
  run("UPDATE public.customers SET name='Synthetic current data "+(reuse?'reuse':'new')+"' WHERE id='96000000-0000-0000-0000-000000000002';")
  const current=snapshot()
  if(current.data_md5===before.data_md5||current.schema_md5!==after.schema_md5)throw new Error('Intervening synthetic write did not change only data')
  console.log(`READ_ROLLOUT_CURRENT_DATA_CHANGED reuse=${reuse}`)
  const rollbackOptions={repoRoot,expectedDatabase:'pilot_rollout_test',expectedSchemaHash:after.schema_md5,baselineSchemaHash:before.schema_md5,indexCreated:receipt.index_created}
  reject(await buildGuardedReadRollback({...rollbackOptions,expectedSchemaHash:'0'.repeat(32)}),'Confirmed post-apply schema drift; rollback refused')
  const rejectedState=snapshot()
  if(rejectedState.schema_md5!==after.schema_md5||rejectedState.data_md5!==current.data_md5)throw new Error('Rejected rollback changed state')
  console.log(`READ_ROLLOUT_BAD_ROLLBACK_REJECTED reuse=${reuse}`)
  const rollback=await buildGuardedReadRollback(rollbackOptions)
  writeFileSync(`${repoRoot}/rollout-results/rollback-${reuse?'reuse':'new'}.sql`,rollback)
  const recovered=oneJson(run(rollback)),final=snapshot()
  if(recovered.result!=='READ_ROLLBACK_COMMITTED'||final.schema_md5!==before.schema_md5||final.data_md5!==current.data_md5)throw new Error('Exact rollback/current-data preservation failed')
  writeFileSync(`${repoRoot}/rollout-results/receipt-${reuse?'reuse':'new'}.json`,JSON.stringify({before:{schema:before.schema_md5,data:before.data_md5},receipt,currentData:current.data_md5,recovered,checks:apply.checks},null,2))
  console.log(`READ_ROLLOUT_ROLLBACK_VERIFIED reuse=${reuse}`)
 }
 console.log('READ_ROLLOUT_LIFECYCLE_VERIFIED')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2)throw new Error('No custom CI runner arguments')
 await runReadRolloutCi()
}
