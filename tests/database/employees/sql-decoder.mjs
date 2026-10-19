// Fixed synthetic SQL output -> exact application TypeScript decoders, not copies.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname,join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {validateIhrDbTarget} from '../../../scripts/test-ihr-db.mjs'
import * as contracts from '../../../src/lib/employees/contracts.ts'
const root=dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const parsers={context:contracts.parseEmployeeContext,preview:contracts.parseEmployeePreview,command:contracts.parseCommandResult,page:contracts.parseEmployeePage,detail:contracts.parseEmployeeDetail,audit:contracts.parseEmployeeAudit,candidates:contracts.parseEmployeeAccountCandidates,recovered:contracts.parseOperationResult,absent:contracts.parseOperationResult,abandoned:contracts.parseOperationResult}
export function decodeEmployeeSqlOutput(output){
 assert.equal(typeof output,'string');const lines=output.trim().split(/\r?\n/)
 assert.equal(lines.filter(x=>x==='EMPLOYEE_SQL_OUTPUT_ROLLED_BACK').length,1,'Complete rollback sentinel required')
 const payloads=lines.filter(x=>x.startsWith('EMPLOYEE_SQL_JSON|'));assert.equal(payloads.length,1,'Exactly one SQL envelope required')
 assert.equal(lines.at(-1),'EMPLOYEE_SQL_OUTPUT_ROLLED_BACK','Rollback must complete after output')
 const raw=contracts.strictObject(JSON.parse(payloads[0].slice('EMPLOYEE_SQL_JSON|'.length)),Object.keys(parsers))
 const result=Object.fromEntries(Object.entries(parsers).map(([name,parse])=>[name,parse(raw[name])]))
 assert.equal(result.context.canMaintainBasic,true);assert.equal(result.page.total,2);assert.equal(result.audit.total,8)
 assert.equal(result.detail.account.quarantined,true);assert.equal(result.detail.account.active,false)
 assert.equal(result.detail.reporting.length,2);assert.equal(result.detail.reporting[0].managerEmployeeId,null)
 assert.equal(result.recovered.state,'completed');assert.deepEqual(result.recovered.result,result.command)
 assert.equal(result.absent.state,'absent');assert.equal(result.abandoned.state,'abandoned')
 // Actual successful SQL responses must fail closed after adversarial corruption.
 for(const [name,parse]of Object.entries(parsers))assert.throws(()=>parse({...raw[name],unexpected:'not-allowed'}))
 assert.throws(()=>contracts.parseEmployeeDetail({...raw.detail,version:'1'}))
 assert.throws(()=>contracts.parseEmployeeDetail({...raw.detail,episode:{...raw.detail.episode,startDate:'2026-02-30'}}))
 assert.throws(()=>contracts.parseEmployeePreview({...raw.preview,previewFingerprint:'wrong'}))
 return result
}
export function runEmployeeSqlDecoder(options={}){
 assert.ok(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='env'),'Only fixed decoder environment permitted')
 const env=validateIhrDbTarget(options.env??process.env),args=['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1']
 const marker=execFileSync('psql',args,{env:{...env,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=5000'},input:"SELECT current_database()='pilot_test' AND current_user='postgres' AND inet_server_addr() IN('127.0.0.1'::inet,'::1'::inet) AND (SELECT count(*)=1 FROM public.pilot_fixture_marker) AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') AND to_regprocedure('private.ihr_leave_calendar_timezone(uuid)') IS NOT NULL;",encoding:'utf8',timeout:15000,shell:false})
 assert.equal(marker.trim(),'t','Disposable actual target and marker required')
 const output=execFileSync('psql',[...args,'-f',join(root,'tests/database/employees/sql-output.sql')],{cwd:root,env,encoding:'utf8',timeout:180000,shell:false})
 decodeEmployeeSqlOutput(output)
 const files=['src/lib/employees/contracts.ts','sql/employee-foundation-schema.sql','sql/employee-foundation-commands.sql','sql/employee-foundation-reporting.sql','tests/database/employees/sql-output.sql','tests/database/employees/fixture-users.sql','tests/database/employees/retained-fixture.sql','tests/database/employees/sql-decoder.mjs']
 const sha=value=>createHash('sha256').update(value).digest('hex')
 process.stdout.write('EMPLOYEE_SQL_TYPESCRIPT_DECODERS_PASSED '+JSON.stringify({source:Object.fromEntries(files.map(file=>[file,sha(readFileSync(join(root,file)))])),outputSha256:sha(output),decoders:Object.keys(parsers)})+'\n')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{assert.equal(process.argv.length,2,'No decoder arguments permitted');runEmployeeSqlDecoder()}catch(error){process.stderr.write(`Employee SQL decoder failed: ${error.message}\n`);process.exitCode=1}}
