// Source proposal + fictional SQL suite in one rollback-only disposable local transaction.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname,join } from 'node:path'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { validateIhrDbTarget } from './test-ihr-db.mjs'
const root=dirname(dirname(fileURLToPath(import.meta.url)))
export function runWeeklyDb({env=process.env,repoRoot=root,probe=execFileSync,execute=execFileSync}={}) {
 if(!['pilot_test','weekly_leave_test'].includes(env.PGDATABASE))throw new Error('Disposable weekly database required')
 const connection={...validateIhrDbTarget({...env,PGDATABASE:'pilot_test'}),PGDATABASE:env.PGDATABASE}
 const args=['-h',connection.PGHOST,'-p',connection.PGPORT,'-U','postgres','-d',connection.PGDATABASE,'-X','--no-password','--set=ON_ERROR_STOP=1']
 let marker
 try {marker=probe('psql',[...args,'-qAt'],{env:{...connection,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=5000'},
  input:`SELECT current_database()='${connection.PGDATABASE}' AND current_user='postgres' AND inet_server_addr() IN('127.0.0.1'::inet,'::1'::inet) AND (SELECT count(*) FROM public.pilot_fixture_marker)=1 AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci');`,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe'],shell:false})}
 catch{throw new Error('Disposable fixture marker could not be verified')}
 if(typeof marker!=='string'||marker.trim()!=='t')throw new Error('Disposable fixture marker required')
 const source=readFileSync(join(repoRoot,'sql/weekly-leave-calendar-candidate.sql'),'utf8').replace(/^(?:BEGIN|COMMIT);\r?$/gm,'')
 // Paths come from the checked-out repo, never caller SQL. Quote for psql meta-command parsing.
 const path=value=>`'${value.replaceAll("'","''")}'`
 const suite=readFileSync(join(repoRoot,'tests/database/ihr/weekly-calendar.sql'),'utf8').replace(/^BEGIN;\r?$/gm,'')
  .replace('\\ir quote-seed.sql',`\\i ${path(join(repoRoot,'tests/database/ihr/quote-seed.sql'))}`)
 const input=`BEGIN;\n${source}\n\\i ${path(join(repoRoot,'tests/database/ihr/helpers.sql'))}\n${suite}\n`
 execute('psql',args,{env:{...connection,PGOPTIONS:'-c statement_timeout=120000 -c lock_timeout=10000'},cwd:repoRoot,input,encoding:'utf8',timeout:180000,stdio:['pipe','inherit','inherit'],shell:false})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{runWeeklyDb()}catch(error){process.stderr.write(`Weekly fixture execution refused or failed: ${error.message}\n`);process.exitCode=1}}
