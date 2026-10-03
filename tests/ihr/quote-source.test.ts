// Structural RED/GREEN checks supplement, never replace, actual-role PostgreSQL execution.
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { malformedFixtureUuids } from './sql-fixture-uuids'
const path='supabase/migrations/202610021004_ihr_leave_quote.sql'
const sql=existsSync(path)?readFileSync(path,'utf8'):''
const body=(name:string)=>sql.split(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replaceAll('.','\\.')}\\(`))[1]?.split('\n$$;')[0]??''
test('quote owns rules with no inferred notice, horizon, reason or future grants',()=>{
 expect(sql).toContain('request_rules_confirmed boolean NOT NULL DEFAULT false')
 for(const name of ['minimum_notice_days','booking_horizon_days','reason_required'])expect(sql).toContain(`ADD COLUMN ${name}`)
 const quote=body('private.ihr_leave_quote_v1')
 for(const token of ['private.ihr_leave_annual_eligibility','private.ihr_working_day_v1','private.ihr_leave_balance_json','REQUEST_RULES_UNCONFIRMED','NO_CHARGEABLE_DATES','DURATION_EXCEEDS_SHIFT','INSUFFICIENT_ALLOWANCE','ACCOUNT_UNAVAILABLE','APPROVER_UNAVAILABLE'])expect(quote).toContain(token)
 expect(quote).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b|ihr_leave_prepare_account/)
 expect(quote).not.toMatch(/least\(/i)
})
test('public quote only derives its actor and authorization time; private helpers remain closed',()=>{
 const rpc=body('public.leave_quote_v1')
 expect(rpc).toContain('STABLE SECURITY DEFINER SET search_path=\'\'')
 expect(rpc).toContain('private.ihr_leave_require_actor()');expect(rpc).toContain('statement_timestamp()')
 expect(sql).toContain('REVOKE ALL ON FUNCTION private.ihr_leave_quote_v1(uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated')
 expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.leave_quote_v1(jsonb) TO authenticated')
 expect(sql).not.toMatch(/INSERT INTO public\./)
})
test('quote scope uses the accepted complete actor token and the real-role suite compares it with context',()=>{
 expect(body('private.ihr_leave_quote_v1')).toContain('scope_version:=private.ihr_leave_scope_version(p_employee)')
 expect(body('private.ihr_leave_quote_v1')).not.toContain('SELECT version::text INTO scope_version')
 const entry=readFileSync('tests/database/ihr/quote.sql','utf8')
 expect(entry).toContain("->>'scopeVersion'=public.leave_context_v1()->>'scopeVersion'")
})
test('actual-role quote suite is qualified, UUID-clean, and marks completion only after its last include',()=>{
 for(const file of ['quote.sql','quote-seed.sql','quote-boundaries.sql']){
  const source=existsSync(`tests/database/ihr/${file}`)?readFileSync(`tests/database/ihr/${file}`,'utf8'):''
  expect(source.length).toBeGreaterThan(100)
  expect(source.match(/(?<![\w.])leave_[a-z0-9_]+\s*\(/g)).toBeNull()
  expect(malformedFixtureUuids(source)).toEqual([])
 }
 const entry=existsSync('tests/database/ihr/quote.sql')?readFileSync('tests/database/ihr/quote.sql','utf8'):''
 expect(entry.trimEnd()).toMatch(/\\ir quote-boundaries\.sql\s+\\echo IHR_QUOTE_PERMISSIONS_AND_CALCULATION_PASSED$/)
})
