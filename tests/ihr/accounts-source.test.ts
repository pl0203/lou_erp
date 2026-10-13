// Structural guards only; actual-role SQL is the runtime/permission evidence.
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { malformedFixtureUuids } from './sql-fixture-uuids'
const path='supabase/migrations/202610021003_ihr_leave_accounts.sql'
const sql=existsSync(path)?readFileSync(path,'utf8'):''
const body=(name:string)=>sql.split(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replaceAll('.','\\.')}\\(`))[1]?.split('\n$$;')[0]??''
test('annual accounts and append-only exact ledger are denied to direct clients',()=>{
 for(const table of ['ihr_leave_accounts','ihr_leave_ledger']){
  expect(sql).toContain(`CREATE TABLE public.${table}`)
  expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
  expect(sql).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC,anon,authenticated`)
 }
 expect(sql).toContain('UNIQUE(employee_id,leave_type,year)')
 expect(sql).toContain('UNIQUE(account_id,source_kind,source_id,source_event)')
 expect(sql).toContain('allowance_minutes>=used_minutes+reserved_minutes')
 expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.ihr_leave_ledger')
 expect(sql).toContain('BEFORE TRUNCATE ON public.ihr_leave_ledger')
})
test('preparation uses confirmed calendar lineage, explicit eligibility and current server period',()=>{
 const eligible=body('private.ihr_leave_annual_eligibility')
 for(const condition of ['established_calendar','eligibility_date','annual_policy_confirmed','private.ihr_leave_calendar_timezone','TIMEZONE_UNCONFIRMED','FIRST_GRANT_BLOCKED'])expect(eligible).toContain(condition)
 const prepare=body('public.leave_prepare_self_v1')
 expect(prepare).toContain('VOLATILE SECURITY DEFINER')
 expect(prepare).toContain('private.ihr_leave_require_command_isolation()')
 expect(prepare.indexOf('clock_timestamp()')).toBeGreaterThan(prepare.indexOf('FOR UPDATE'))
 expect(body('public.leave_context_v1')).not.toMatch(/INSERT|dispatch_command|prepare_account/)
})
test('opening does not double grant, imports atomically and locks occupancy before accounts',()=>{
 expect(body('private.ihr_import_opening_absences_v1')).toContain('OPENING_REQUEST_IMPORT_UNAVAILABLE')
 const opening=body('private.ihr_leave_reconcile_opening')
 expect(opening).toContain('p->>\'allowance_minutes\'')
 expect(opening).toContain('ihr_import_opening_absences_v1')
 expect(opening).not.toMatch(/EXCEPTION WHEN OTHERS|allowance_minutes\s*=\s*allowance_minutes\s*\+/)
 const dispatch=body('private.ihr_leave_dispatch_command')
 expect(dispatch.indexOf('ihr-occupancy:')).toBeLessThan(dispatch.indexOf('ihr-account:'))
 expect(dispatch.indexOf('clock_timestamp()')).toBeGreaterThan(dispatch.indexOf('FOR UPDATE'))
})
test('private history is separately scoped and minimized with bounded pagination',()=>{
 const history=body('public.leave_balance_history_v1')
 expect(history).toContain('p_limit>100')
 expect(history).toContain("'read_private'")
 expect(history).not.toContain('ihr_leave_is_approver')
 expect(history).not.toMatch(/'actorId'|'sourceId'|'reason'|'payload'/)
 expect(history).toContain('ORDER BY l.sequence DESC')
})
test('accounts SQL closure qualifies RPCs and reports success only after final include',()=>{
 const files=['accounts.sql','accounts-commands.sql','accounts-seed.sql']
 for(const file of files){
  const source=existsSync(`tests/database/ihr/${file}`)?readFileSync(`tests/database/ihr/${file}`,'utf8'):''
  expect(source.length).toBeGreaterThan(100)
  expect(source.match(/(?<![\w.])leave_[a-z0-9_]+\s*\(/g)).toBeNull()
  expect(malformedFixtureUuids(source)).toEqual([])
 }
 const entry=existsSync('tests/database/ihr/accounts.sql')?readFileSync('tests/database/ihr/accounts.sql','utf8'):''
 expect(entry.trimEnd()).toMatch(/\\ir accounts-commands\.sql\s+\\echo IHR_ACCOUNTS_PERMISSIONS_AND_RECONCILIATION_PASSED$/)
})
