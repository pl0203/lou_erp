// Additional integration evidence through the existing fixed-baseline runner.
// Its marker, source/run identity, topology and real-race checks are not bypassed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync,readFileSync,rmSync,existsSync } from 'node:fs'
import {tmpdir}from'node:os'
import {join,resolve}from'node:path'
import {runCoCi}from'../../../scripts/test-co-ci.mjs'
export async function runFullComposition({bin,root}) {
 const temp=mkdtempSync(join(tmpdir(),'sales-targets-full-source-'))
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')&&!/DATABASE_URL|SUPABASE|CO_CI|GITHUB_ACTIONS/.test(key)))
 Object.assign(env,{PATH:bin+':'+env.PATH,LD_LIBRARY_PATH:resolve(bin,'../../../../lib/x86_64-linux-gnu'),PGHOST:'127.0.0.1',PGPORT:'65437',PGUSER:'postgres',PGDATABASE:'pilot_test'})
 const run=(program,args,options={})=>execFileSync(join(bin,program),args,{env,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:240000,maxBuffer:32*1024*1024,...options})
 const sql=(input,database='pilot_co_test')=>run('psql',['-X','-qAt','--no-password','-v','ON_ERROR_STOP=1'],{env:{...env,PGDATABASE:database},input})
 let started=false
 try {
  run('initdb',['-D',join(temp,'data'),'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'])
  run('pg_ctl',['-D',join(temp,'data'),'-l',join(temp,'server.log'),'-o',"-h 127.0.0.1 -c unix_socket_directories='' -p 65437 -c jit=off -c timezone=UTC",'-w','start']);started=true
  sql('CREATE DATABASE pilot_test OWNER postgres;','postgres')
  sql("CREATE TABLE public.pilot_fixture_marker(purpose text PRIMARY KEY);INSERT INTO public.pilot_fixture_marker VALUES('disposable-pilot-ci');",'pilot_test')
  runCoCi({env})
  // Additive target candidate on the fully composed source schema, still disabled.
  for(const name of ['01-foundation.sql','02-scoped-reads.sql','03-commands.sql','04-preflight-postflight.sql']) sql(readFileSync(join(root,'supabase/sales_targets/v1',name),'utf8'))
  const {verifySourceGuard}=await import('./source-preflight.mjs');verifySourceGuard({sql,root})
  const output=sql(readFileSync(join(root,'tests/database/sales-targets/full-composition-smoke.sql'),'utf8'))
  assert.ok(output.includes('SALES_TARGETS_FULL_SOURCE_SMOKE_PASSED'))
  console.log(output)
  console.log('SALES_TARGETS_FULL_SOURCE_COMPOSITION_PASSED')
 } catch(error){if(existsSync(join(temp,'server.log')))console.error(readFileSync(join(temp,'server.log'),'utf8'));throw error}
 finally{if(started)run('pg_ctl',['-D',join(temp,'data'),'-m','immediate','-w','stop']);rmSync(temp,{recursive:true,force:true})}
}
