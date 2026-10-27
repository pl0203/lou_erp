import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { malformedFixtureUuids } from './sql-fixture-uuids'
const path='supabase/migrations/202610021007_ihr_leave_admin.sql'
const sql=existsSync(path)?readFileSync(path,'utf8'):''
const body=(name:string)=>sql.split(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replaceAll('.','\\.')}\\(`))[1]?.split('\n$$;')[0]??''
test('external approval and named manifest records have no client write or fabrication path',()=>{
 for(const table of ['ihr_leave_access_manifests','ihr_leave_governance_approvals']){
  expect(sql).toContain(`CREATE TABLE private.${table}`)
  expect(sql).toContain(`ALTER TABLE private.${table} ENABLE ROW LEVEL SECURITY`)
  expect(sql).toContain(`REVOKE ALL ON private.${table} FROM PUBLIC,anon,authenticated`)
  expect(sql).not.toMatch(new RegExp(`INSERT INTO private\\.${table}`))
 }
 expect(sql).toContain('private.ihr_leave_evidenced_access')
 expect(body('private.ihr_leave_admin_authorize')).toContain('SELF_ADMIN_DENIED')
 expect(sql).not.toContain('ihr_leave_scope_revision WHERE singleton FOR UPDATE')
 expect(sql).not.toMatch(/current_setting\(|set_config\(|ERRCODE='40001'/)
})
test('readiness checks exact approval fields and SQL gates quote/submission',()=>{
 const readiness=body('private.ihr_leave_readiness')
 for(const field of ['retention','access_review','rule_version','approved_by','approved_at','accountable_owner','cadence','capabilities','grant_ids','audience_ids']) expect(sql).toContain(field)
 for(const code of ['PEOPLE_UNCONFIRMED','POLICY_UNCONFIRMED','CALENDAR_UNCONFIRMED','OPENING_UNCONFIRMED','REQUEST_RULES_UNCONFIRMED','CANCELLATION_RULES_UNCONFIRMED','AUDIENCE_UNCONFIRMED','RETENTION_UNCONFIRMED','ACCESS_REVIEW_UNCONFIRMED'])expect(readiness).toContain(code)
 expect(body('private.ihr_leave_quote_v1')).toContain('private.ihr_leave_readiness')
})
test('administration locks refresh actor and exact scope at every blocking stage',()=>{
 const dispatch=body('private.ihr_leave_dispatch_command')
 expect(dispatch.indexOf('ihr-setup')).toBeLessThan(dispatch.indexOf('ihr-approver:'))
 expect(dispatch.indexOf('ihr-approver:')).toBeLessThan(dispatch.indexOf('ihr_leave_scope_revision'))
 expect((dispatch.match(/private.ihr_leave_admin_authorize/g)||[]).length).toBeGreaterThanOrEqual(3)
 expect(dispatch).toContain('clock_timestamp()')
 expect(sql).toContain("leave_type='annual'")
})
test('owned synthetic suite qualifies RPCs, scans UUIDs and prints a genuine terminal marker',()=>{
 for(const name of ['admin.sql','admin-commands.sql','admin-governance-seed.sql','admin-targets.sql','admin-mixed-grants.sql','admin-midyear-denials.sql','admin-write-context.sql','hr-private-review.sql','admin-rota-context.sql']){const content=readFileSync(`tests/database/ihr/${name}`,'utf8');expect(malformedFixtureUuids(content)).toEqual([]);expect(content.match(/(?<![\w.])leave_[a-z0-9_]+\s*\(/g)).toBeNull()}
 const path='tests/database/ihr/admin.sql',source=existsSync(path)?readFileSync(path,'utf8'):''
 expect(source.length).toBeGreaterThan(100)
 expect(malformedFixtureUuids(source)).toEqual([])
 expect(source.match(/(?<![\w.])leave_[a-z0-9_]+\s*\(/g)).toBeNull()
 expect(source.trimEnd()).toMatch(/ROLLBACK;\s+\\echo IHR_ADMIN_SCOPED_SETTINGS_PASSED$/)
})

test('the frozen quote calculator changes only governance readiness and owned predecessor compatibility',()=>{
 const core=readFileSync('supabase/migrations/202610021004_ihr_leave_quote.sql','utf8')
 const start=core.indexOf('CREATE FUNCTION private.ihr_leave_quote_v1'),end=core.indexOf('\n$$;',start)+4
 const expected=core.slice(start,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('eligibility:=private.ihr_leave_annual_eligibility(p_employee,p_at);',`eligibility:=private.ihr_leave_annual_eligibility(p_employee,p_at);
 IF (private.ihr_leave_readiness(p_employee,p_at)->>'ready')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Setup requires approval' USING ERRCODE='55000',DETAIL='{"code":"SETUP_APPROVAL_REQUIRED"}';END IF;`).replace('a.policy_id<>p.id','NOT private.ihr_leave_policy_account_compatible(p_employee,a.policy_id,p.id)')
 expect(sql).toContain(expected)
})
