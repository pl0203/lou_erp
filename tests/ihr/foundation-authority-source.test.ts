// Structural contracts only: this suite never executes SQL or proves a race.
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
const path = 'supabase/migrations/202610021001_ihr_leave_foundation.sql'
const sql = existsSync(path) ? readFileSync(path, 'utf8') : ''
function fn(name: string) {
  const start = sql.indexOf(`CREATE FUNCTION ${name}(`); expect(start, name).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf('\n$$;', start); expect(end).toBeGreaterThan(start)
  return sql.slice(start, end)
}
test.each(['leave_transaction_v1', 'leave_reconcile_request_v1'])('%s refreshes actor/time after advisory wait and enforces supported fresh snapshots', name => {
  const body = fn(`public.${name}`)
  expect(body).toContain('LANGUAGE plpgsql VOLATILE SECURITY DEFINER')
  const isolation = body.indexOf('private.ihr_leave_require_command_isolation()'), lock = body.indexOf('PERFORM pg_advisory_xact_lock'), refresh = body.indexOf('SELECT private.ihr_leave_require_actor(), clock_timestamp() INTO actor, authorized_at;')
  expect(isolation).toBeGreaterThan(0); expect(lock).toBeGreaterThan(isolation); expect(refresh).toBeGreaterThan(lock)
  expect(body.indexOf('SELECT * INTO command')).toBeGreaterThan(refresh)
  expect(body.match(/clock_timestamp\(\)/g)).toHaveLength(1)
  expect(body).toContain(name === 'leave_transaction_v1' ? 'private.ihr_leave_authorize_command(actor,p_operation,p_payload,authorized_at)' : 'private.ihr_leave_authorize_command(actor,command.operation,command.payload,authorized_at)')
  if (name === 'leave_transaction_v1') expect(body).toContain('private.ihr_leave_dispatch_command(actor,p_operation,p_payload,authorized_at)')
  expect(body).not.toMatch(/set_config\(|SET TRANSACTION|FOR SHARE/)
})
test('fixed transaction snapshots are refused for commands', () => {
  const body = fn('private.ihr_leave_require_command_isolation')
  expect(body).toContain("current_setting('transaction_isolation') IS DISTINCT FROM 'read committed'")
  expect(body).toContain('UNSUPPORTED_COMMAND_ISOLATION')
})
test.each(['ihr_leave_has_grant', 'ihr_leave_is_approver'])('%s has an explicit instant and a read-only statement-time default', name => {
  const source = fn(`private.${name}`); expect(source).toContain('p_authorized_at timestamptz DEFAULT statement_timestamp()')
  const body = source.slice(source.indexOf('AS $$')); expect(body).not.toMatch(/statement_timestamp\(\)|clock_timestamp\(\)/)
  expect(body).toContain('effective_from <= p_authorized_at'); expect(body).toContain('effective_until > p_authorized_at')
})
test('authorizer is stable and rechecks actor; static dispatcher is initially deny-all', () => {
  const source = fn('private.ihr_leave_authorize_command'); expect(source).toContain('LANGUAGE plpgsql STABLE'); expect(source).toContain('p_actor IS DISTINCT FROM private.ihr_leave_require_actor()'); expect(source).toContain('p_authorized_at IS NULL')
  const dispatch = fn('private.ihr_leave_dispatch_command'); expect(dispatch).toContain('p_authorized_at timestamptz'); expect(dispatch).toContain('CASE p_operation'); expect(dispatch).toContain('UNSUPPORTED_OPERATION'); expect(dispatch).not.toMatch(/EXECUTE\s/)
})
test('read context remains snapshot consistent and grants trigger has a stricter separate clock', () => {
  expect(fn('public.leave_context_v1')).toContain('LANGUAGE plpgsql STABLE SECURITY DEFINER')
  expect(fn('private.ihr_leave_scope_version')).toContain('statement_timestamp()')
  const guard = fn('private.ihr_leave_guard_grant'); expect(guard).toContain('authorized_at timestamptz := clock_timestamp()'); expect(guard).not.toMatch(/statement_timestamp\(\)|current_setting\(/)
})
test('every function has fixed search path and private helpers are explicitly revoked', () => {
  const names = [...sql.matchAll(/CREATE FUNCTION (private\.[a-z_]+)\(/g)].map(match => match[1]); expect(names.length).toBeGreaterThan(10)
  const revokes = sql.slice(sql.indexOf('-- Close every private helper'))
  for (const name of names) { expect(fn(name)).toContain("SET search_path = ''"); expect(revokes).toContain(name + '(') }
  expect(revokes).toContain('FROM PUBLIC, anon, authenticated')
})
test('assignment trigger refreshes authority after its own employee advisory wait', () => {
  const body = fn('private.ihr_leave_guard_approver')
  const lock = body.indexOf('PERFORM pg_advisory_xact_lock'), instant = body.indexOf('authorized_at:=clock_timestamp();'), refresh = body.indexOf('PERFORM private.ihr_leave_require_actor()')
  expect(lock).toBeGreaterThan(0); expect(instant).toBeGreaterThan(lock); expect(refresh).toBeGreaterThan(instant)
})
test.each([
  ['employee account', /JOIN public\.users eu ON eu\.id=em\.user_id AND eu\.is_active/],
  ['approver account', /JOIN public\.users au ON au\.id=am\.user_id AND au\.is_active/],
  ['employee membership', /\bem\.active\b/],
  ['approver membership', /\bam\.active\b/],
])('unrevoked assignments require an active %s after the lock and actor refresh', (_endpoint, required) => {
  const body = fn('private.ihr_leave_guard_approver')
  const start = body.indexOf('IF NEW.revoked_at IS NULL AND NOT EXISTS (')
  expect(start).toBeGreaterThan(body.indexOf('PERFORM private.ihr_leave_require_actor()'))
  const route = body.slice(start, body.indexOf(") THEN RAISE EXCEPTION 'Invalid approval route'", start))
  expect(route).toMatch(required)
  expect(route).toContain("(em.member_kind='employee' AND am.member_kind='manager') OR (em.member_kind='manager' AND am.member_kind='director')")
  expect(body).toContain('actor=NEW.employee_id OR actor=NEW.approver_id')
})
