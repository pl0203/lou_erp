// Source contracts supplement the real-role PostgreSQL suite and coordinator-run barriers.
import { existsSync,readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import { malformedFixtureUuids } from './sql-fixture-uuids'
const path='supabase/migrations/202610021005_ihr_leave_requests.sql'
const sql=existsSync(path)?readFileSync(path,'utf8'):''
const body=(name:string)=>sql.split(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replaceAll('.','\\.')}\\(`))[1]?.split('\n$$;')[0]??''
test('submission persists immutable snapshots, one active employee/date and an atomic reservation',()=>{
 for(const table of ['ihr_leave_requests','ihr_leave_request_days','ihr_leave_request_allocations','ihr_leave_occupancy']){
  expect(sql).toContain(`CREATE TABLE public.${table}`);expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
  expect(sql).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC,anon,authenticated`)
 }
 expect(sql).toContain('PRIMARY KEY(employee_id,day)')
 for(const token of ['source_snapshot','period_start','period_end','ihr_leave_immutable_audit','STALE_QUOTE','DATE_OCCUPIED'])expect(sql).toContain(token)
 const submit=body('private.ihr_leave_submit_request')
 expect(submit.indexOf('ihr-occupancy:')).toBeLessThan(submit.indexOf('ihr-account:'))
 expect(submit.lastIndexOf('clock_timestamp()')).toBeLessThan(submit.indexOf('private.ihr_leave_quote_v1'))
 for(const token of ['private.ihr_leave_authorize_command','private.ihr_leave_quote_v1','INSERT INTO public.ihr_leave_ledger','reserved_delta'])expect(submit).toContain(token)
 expect(sql).not.toContain("ERRCODE='40001'")
})
test('current replay authorization stays separate from new-submission quote and account checks',()=>{
 const auth=body('private.ihr_leave_authorize_command')
 expect(auth).toContain("p_operation<>'submit_request'")
 expect(auth).toContain('private.ihr_leave_require_actor()')
 expect(auth).toContain("m.member_kind IN('employee','manager')")
 expect(auth).not.toMatch(/ihr_leave_quote_v1|ihr_leave_annual_eligibility|booking_horizon|available_minutes|clock_timestamp/)
 expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public.leave_(?:transaction|reconcile_request)_v1/)
})
test('import verifies charges and freezes originals without a second usage ledger event',()=>{
 const importer=body('private.ihr_import_opening_absences_v1')
 expect(importer).toContain('private.ihr_working_day_v1');expect(importer).toContain('OPENING_TOTAL_MISMATCH')
 expect(importer).toContain('OPENING_SOURCE_DUPLICATE');expect(importer).toContain('DATE_OCCUPIED')
 expect(importer).not.toContain('INSERT INTO public.ihr_leave_ledger')
 expect(importer).not.toContain('ihr_leave_quote_v1')
})
test('own history/details use current personal authority, minimized summaries and bounded keyset pages',()=>{
 for(const fn of ['public.leave_own_history_v1','public.leave_own_request_v1']){
  const b=body(fn);expect(b).toContain('private.ihr_leave_require_personal_actor()');expect(b).toContain('employee_id=actor')
  expect(b).toContain("STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp")
 }
 expect(body('public.leave_own_history_v1')).toContain('p_before')
 expect(body('public.leave_own_history_v1')).not.toContain("'reason'")
 expect(body('private.ihr_leave_setup_impacts_v1')).toContain("'configure',target")
})
test('owned SQL fixtures use canonical UUIDs and qualified calls; marker follows all included tests',()=>{
 for(const name of ['requests.sql','requests-opening.sql','requests-replay.sql','requests-race-fixture.sql']){
  const file=`tests/database/ihr/${name}`,source=existsSync(file)?readFileSync(file,'utf8'):''
  expect(source.length).toBeGreaterThan(100);expect(malformedFixtureUuids(source)).toEqual([])
  expect(source.match(/(?<![\w.])leave_[a-z0-9_]+\s*\(/g)).toBeNull()
 }
 const file='tests/database/ihr/requests.sql',entry=existsSync(file)?readFileSync(file,'utf8'):''
 expect(entry.trimEnd()).toMatch(/\\ir requests-replay\.sql\s+\\echo IHR_REQUESTS_ATOMIC_SUBMISSION_PASSED$/)
})
test('owner replay fixtures clear retained JWT claims before guarded membership mutations',()=>{
 const source=readFileSync('tests/database/ihr/requests-replay.sql','utf8')
 let claim=''
 for(const line of source.split('\n')){
  const found=line.match(/set_config\('request.jwt.claim.sub','([^']*)'/)
  if(found)claim=found[1]
  if(line.startsWith('UPDATE public.ihr_leave_members'))expect(claim).toBe('')
 }
})
test('submission does not retain a scope latch while waiting on occupancy/accounts',()=>{
 const submit=body('private.ihr_leave_submit_request')
 expect(submit).not.toContain('PERFORM version FROM private.ihr_leave_scope_revision')
 expect(submit).toContain('Scope revision is read by the final quote, never locked by submission')
 for(const lock of ['ihr-setup','ihr-approver:','ihr-occupancy:','ihr-account:'])expect(submit).toContain(lock)
 expect(submit).toContain('private.ihr_leave_quote_v1(actor,p_payload')
 const foundation=readFileSync('supabase/migrations/202610021001_ihr_leave_foundation.sql','utf8')
 expect(foundation).toContain('AFTER UPDATE OF is_active ON public.users')
 expect(foundation).toContain('UPDATE private.ihr_leave_scope_revision SET version=version+1')
})
