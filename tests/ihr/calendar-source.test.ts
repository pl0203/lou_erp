// Structure-only regressions. These do not establish PostgreSQL execution or RLS/race safety.
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { malformedFixtureUuids } from './sql-fixture-uuids'
const file = 'supabase/migrations/202610021002_ihr_leave_calendar.sql'
const sql = existsSync(file) ? readFileSync(file, 'utf8') : ''
const fn = (name: string) => sql.split(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replaceAll('.', '\\.')}\\(`))[1]?.split('\n$$;')[0] ?? ''
test('calendar schema is unseeded, denied to clients and immutable sources are distinguished from lineage IDs', () => {
  for (const table of ['ihr_leave_policies','ihr_leave_calendars','ihr_leave_calendar_exceptions','ihr_saturday_groups','ihr_saturday_memberships','ihr_saturday_roster']) {
    expect(sql).toContain(`CREATE TABLE public.${table}`)
    expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    expect(sql).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC,anon,authenticated`)
  }
  expect(sql.slice(0, sql.indexOf('CREATE FUNCTION'))).not.toMatch(/INSERT INTO public\./)
  expect(sql).toContain('REFERENCES private.ihr_leave_calendar_registry(id)')
})
test('working-day resolves highest matching immutable sources and missing is never off-duty', () => {
  const body = fn('private.ihr_working_day_v1')
  expect(body).toContain('ORDER BY c.version DESC LIMIT 1')
  expect(body).toContain('r.calendar_version_id=v_calendar.id')
  expect(body).toContain('ORDER BY r.version DESC LIMIT 1')
  for (const error of ['TIMEZONE_UNCONFIRMED','SUNDAY_UNCONFIGURED','HOLIDAYS_UNCONFIRMED','ROSTER_COVERAGE_MISSING','MEMBERSHIP_COVERAGE_MISSING']) expect(body).toContain(error)
  expect(body).toContain("'calendar_id',v_calendar.id")
  expect(body).toContain("'roster_id',v_roster.id")
})
test('timezone is single-confirmed per lineage and Sunday cannot enable working policy', () => {
  expect(fn('private.ihr_leave_calendar_timezone')).toContain('timezone IS NOT NULL ORDER BY version DESC LIMIT 1')
  expect(sql).toContain('TIMEZONE_CHANGE_UNSUPPORTED')
  expect(sql).toContain('sunday_minutes integer CHECK(sunday_minutes=0)')
  expect(fn('private.ihr_leave_set_member')).toContain('private.ihr_leave_calendar_timezone(')
  expect(fn('private.ihr_leave_set_approver')).toContain('private.ihr_leave_calendar_timezone(')
})
test('preview is STABLE/read-only and mutations reauthorize after the last setup lock', () => {
  const preview = fn('public.leave_roster_preview_v1')
  expect(preview).toContain('STABLE SECURITY DEFINER')
  expect(preview).not.toMatch(/INSERT |UPDATE |DELETE |dispatch_command|clock_timestamp/)
  const body = fn('private.ihr_leave_dispatch_command'), lastLock = body.indexOf('FOR UPDATE')
  expect(lastLock).toBeGreaterThan(body.indexOf('ihr-approver:'))
  expect(body.indexOf('clock_timestamp()', lastLock)).toBeGreaterThan(lastLock)
  expect(body.indexOf('private.ihr_leave_authorize_command', lastLock)).toBeGreaterThan(lastLock)
  for (const name of ['set_member','set_approver','save_calendar_version','set_group_membership','publish_roster']) expect(body).toContain(`WHEN '${name}'`)
})
test('exact authorizer prevents own membership and self appointment and keeps unknown operations denied', () => {
  const body = fn('private.ihr_leave_authorize_command')
  expect(body).toContain("p_operation IN('set_member','set_group_membership')")
  expect(body).toContain('SELF_MEMBER_SETUP_DENIED')
  expect(body).toContain('SELF_APPROVER_ASSIGNMENT_DENIED')
  expect(body).toContain('UNSUPPORTED_OPERATION')
  expect(body).toContain('private.ihr_leave_validate_payload')
  expect(body).toContain('p_authorized_at')
  expect(sql).toContain('REVOKE ALL ON FUNCTION private.ihr_working_day_v1(uuid,date)')
})
test('calendar entry reports completion only after its command suite returns from rollback', () => {
  const entry = readFileSync('tests/database/ihr/calendar.sql', 'utf8')
  const commands = readFileSync('tests/database/ihr/calendar-commands.sql', 'utf8')
  const runner = readFileSync('scripts/test-ihr-db.mjs', 'utf8')
  expect(entry.trimEnd()).toMatch(/\\ir calendar-commands\.sql\s+\\echo IHR_CALENDAR_PERMISSIONS_AND_SETUP_PASSED$/)
  expect(entry.match(/IHR_CALENDAR_PERMISSIONS_AND_SETUP_PASSED/g)).toHaveLength(1)
  expect(commands.trimEnd()).toMatch(/ROLLBACK;$/)
  expect(commands).not.toContain('IHR_CALENDAR_PERMISSIONS_AND_SETUP_PASSED')
  expect(runner).toContain("'--set=ON_ERROR_STOP=1'")
})
test('holiday zero follows relevant Saturday and Sunday setup resolution',()=>{
 const body=fn('private.ihr_working_day_v1'),holiday=body.indexOf("v_exclusion:='holiday'")
 expect(holiday).toBeGreaterThan(body.indexOf("'ROSTER_COVERAGE_MISSING'"))
 expect(holiday).toBeGreaterThan(body.indexOf("'MEMBERSHIP_COVERAGE_MISSING'"))
 expect(holiday).toBeGreaterThan(body.indexOf("'SUNDAY_UNCONFIGURED'"))
})
test('roster guard parenthesizes SQL CASE inside the PL/pgSQL IF expression',()=>{
 expect(fn('private.ihr_leave_roster_guard')).toContain('IF NEW.capacity_minutes<>(CASE WHEN (mod((NEW.day-NEW.anchor)/7,2)=0)=NEW.on_anchor THEN 225 ELSE 0 END) THEN')
})
test('calendar fixtures qualify public RPCs even inside dynamic denial assertions',()=>{
 for(const file of ['calendar.sql','calendar-commands.sql']){
  const fixture=readFileSync(`tests/database/ihr/${file}`,'utf8')
  expect(fixture.match(/(?<![\w.])leave_[a-z0-9_]+\s*\(/g),file).toBeNull()
  expect(fixture).toContain('public.leave_')
 }
})

test.each([
 ['canonical SQL and nested JSON', `SELECT '71000000-0000-0000-0000-000000000002'::uuid, '{"groups":[{"id":"74000000-0000-0000-0000-000000000091"}],"employee_id":null}';`, []],
 ['SQL missing segment', `SELECT '71000000-0000-0000-000000000002';`, ['71000000-0000-0000-000000000002']],
 ['nested JSON missing segment', `SELECT '{"groups":[{"id":"74000000-0000-0000-000000000091"}]}';`, ['74000000-0000-0000-000000000091']],
 ['non-UUID identity input', `SELECT '{"actor_id":"forged"}';`, ['forged']],
 ['explicit UUID cast', `SELECT 'not-a-uuid'::uuid;`, ['not-a-uuid']],
 ['constructed seed prefix', `SELECT ('71000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid;`, []],
 ['malformed seed prefix', `SELECT ('71000000-0000-0000-' || lpad(n::text,12,'0'))::uuid;`, ['71000000-0000-0000-']],
])('fixture UUID checker detects %s', (_name, fixture, expected) => {
 expect(malformedFixtureUuids(fixture).map(issue => issue.value)).toEqual(expected)
})
test('calendar fixture closure has no accidental malformed UUID literals', () => {
 // Deliberate unknown-key injection, not an intended employee/actor identity. Keep it invalid.
 const deliberateInvalidInputs = [{ file: 'calendar-commands.sql', line: 39, value: 'forged', reason: 'Unknown actor_id must be rejected with 22023' }]
 for (const name of ['calendar.sql', 'calendar-commands.sql', 'seed.sql']) {
  const fixture = readFileSync(`tests/database/ihr/${name}`, 'utf8')
  const deliberate = deliberateInvalidInputs.filter(input => input.file === name)
  for (const input of deliberate) {
   expect(input.reason).not.toBe('')
   expect(fixture.split('\n')[input.line - 1]).toContain('"actor_id":"forged"')
   expect(fixture.split('\n')[input.line - 1]).toContain("'22023'")
  }
  expect(malformedFixtureUuids(fixture), name).toEqual(deliberate.map(({ line, value }) => ({ line, value })))
 }
})
