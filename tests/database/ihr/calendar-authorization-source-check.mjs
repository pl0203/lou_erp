// Source-only regression. This does not claim SQL/runtime/latency verification.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export function assertCalendarAuthorizationHoist() {
  const sql = readFileSync(join(here, '../../../supabase/migrations/202610021006_ihr_leave_reads.sql'), 'utf8')
  const baseline = JSON.parse(readFileSync(join(here, 'calendar-authorization-baseline.json'), 'utf8')).definition
  const definition = sql.match(/CREATE FUNCTION public\.leave_calendar_v1\([\s\S]*?\n\$\$;/)?.[0]
  assert.ok(definition, 'calendar RPC definition must exist')
  const expected = baseline
    .replace('rows jsonb;', 'rows jsonb;authorized_employees uuid[];')
    .replace(' IF NOT EXISTS(SELECT 1 FROM public.ihr_leave_members m\n  WHERE private.ihr_leave_calendar_can_read(actor,m.user_id,p_audience,authorized_at)) THEN',
      ' SELECT pg_catalog.array_agg(m.user_id) INTO authorized_employees\n FROM public.ihr_leave_members m\n WHERE private.ihr_leave_calendar_can_read(actor,m.user_id,p_audience,authorized_at);\n IF authorized_employees IS NULL THEN')
    .replace('AND private.ihr_leave_calendar_can_read(actor,r.employee_id,p_audience,authorized_at);',
      'AND r.employee_id=ANY(authorized_employees);')
  assert.notEqual(expected, baseline, 'source regression must describe the intended hoist')
  assert.equal(definition, expected, 'only hoist the identical predicate before request lookup; preserve all other RPC semantics')
  assert.equal((definition.match(/private\.ihr_leave_calendar_can_read\(/g) ?? []).length, 1, 'authorize once per member, never per request')
  assert.ok(definition.indexOf('IF authorized_employees IS NULL') < definition.indexOf('FROM public.ihr_leave_requests'), 'deny before request lookup')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertCalendarAuthorizationHoist()
  console.log('CALENDAR_AUTHORIZATION_SOURCE_ONLY_PASSED; SQL/runtime/latency NOT_RUN')
}
