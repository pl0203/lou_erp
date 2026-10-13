import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accountId, buildCapacityFixture, eventId, personId, sha256 } from './capacity-fixture.mjs'
import { literal } from './capacity-sql.mjs'
const sources = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'capacity-plan-sources.json'), 'utf8'))
const actor = n => `${literal(personId(n))}::uuid`
export const calendarSql = (employeeIds, from = '2026-01-01', to = '2026-04-03') => `SELECT coalesce(jsonb_agg(jsonb_build_object(
 'employeeId',r.employee_id,'employeeName',u.full_name,'date',to_char(d.day,'YYYY-MM-DD'),
 'approvedMinutes',d.charged_minutes,'availabilityLabel',
 CASE WHEN d.charged_minutes=d.scheduled_minutes THEN 'full_scheduled_absence' ELSE 'partial_absence' END)
 ORDER BY d.day,u.full_name,r.employee_id),'[]'::jsonb)
 FROM public.ihr_leave_requests r JOIN public.ihr_leave_request_days d ON d.request_id=r.id
 JOIN public.users u ON u.id=r.employee_id
 WHERE r.status IN('approved','cancellation_pending') AND d.charged_minutes>0 AND d.day BETWEEN ${literal(from)}::date AND ${literal(to)}::date
 AND r.employee_id=ANY(ARRAY[${employeeIds.map(id => `${literal(id)}::uuid`).join(',')}]::uuid[])`
export function calendarAuthorization(person, audience, targets) {
  const sql = `SELECT jsonb_build_object('actor',${actor(person)},'audience',${literal(audience)},'authorizedAt',statement_timestamp(),
 'employeeIds',pg_catalog.array_agg(m.user_id)) FROM public.ihr_leave_members m
 WHERE private.ihr_leave_calendar_can_read(${actor(person)},m.user_id,${literal(audience)},statement_timestamp())`
  return { actor: personId(person), audience, employeeIds: targets.map(personId), sql, sqlSha256: sha256(sql) }
}
export function assertCalendarPlanAuthorization(plan, captured) {
  const required = plan.calendarAuthorization
  const fail = () => { throw new Error(`${plan.name}: exact calendar authorization binding required before row EXPLAIN`) }
  if (!required || !captured || captured.actor !== required.actor || captured.audience !== required.audience
    || typeof captured.authorizedAt !== 'string' || !Number.isFinite(Date.parse(captured.authorizedAt))
    || !Array.isArray(captured.employeeIds) || captured.employeeIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    || new Set(captured.employeeIds).size !== captured.employeeIds.length
    || JSON.stringify([...captured.employeeIds].sort()) !== JSON.stringify([...required.employeeIds].sort())) fail()
}
export async function captureCapacityPlan(session, plan, emit) {
  let authorizationBinding
  if (plan.calendarAuthorization) {
    authorizationBinding = await session.query(plan.calendarAuthorization.sql)
    // Retain the actual result before assertion, including a rejected/missing binding.
    await emit('plan-authorization', { name: plan.name, sql: plan.calendarAuthorization.sql, captured: authorizationBinding })
    assertCalendarPlanAuthorization(plan, authorizationBinding)
  }
  const explain = await session.query(`EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) ${plan.sql}`)
  return { ...plan, ...(authorizationBinding ? { authorizationBinding } : {}), explain }
}
export function buildCapacityPlans() {
  const f = buildCapacityFixture(), request = f.requests.find(r => r.id === f.denseHistory.requestId)
  const requestId = `${literal(request.id)}::uuid`, routeName = literal(f.people.find(p => p.n === request.approver).name)
  return [
    { name: 'narrow-own-history', scope: 'one employee, actual underlying page SELECT', rpc: 'leave_own_history_v1', requiredRelations: ['ihr_leave_requests'], forbidSeqScan: ['ihr_leave_requests'], sql: `SELECT coalesce(jsonb_agg(s.entry ORDER BY s.sequence DESC),'[]'),min(s.sequence) FROM (SELECT r.sequence,private.ihr_leave_request_summary(r) entry FROM public.ihr_leave_requests r WHERE r.employee_id=${actor(1)} AND (NULL::bigint IS NULL OR r.sequence<NULL::bigint) ORDER BY r.sequence DESC LIMIT 50) s` },
    { name: 'narrow-balance-history', scope: 'one account, actual underlying page SELECT', rpc: 'leave_balance_history_v1', requiredRelations: ['ihr_leave_ledger'], forbidSeqScan: ['ihr_leave_ledger'], sql: `SELECT coalesce(jsonb_agg(r.entry ORDER BY r.sequence DESC),'[]'),min(r.sequence) FROM (SELECT l.sequence,jsonb_build_object('id',l.id,'sequence',l.sequence,'date',l.effective_date,'kind',l.kind,'allowanceDelta',l.allowance_delta,'reservedDelta',l.reserved_delta,'usedDelta',l.used_delta) entry FROM public.ihr_leave_ledger l WHERE l.account_id=${literal(accountId(1, 2024))}::uuid AND (NULL::bigint IS NULL OR l.sequence<NULL::bigint) ORDER BY l.sequence DESC LIMIT 50) r` },
    { name: 'narrow-calendar-employee-date', scope: 'own audience, exact runtime-bound authorized employee array, 93 days', rpc: 'leave_calendar_v1', requiredRelations: ['ihr_leave_requests', 'ihr_leave_request_days', 'users'], forbidSeqScan: ['ihr_leave_requests', 'ihr_leave_request_days'], calendarAuthorization: calendarAuthorization(1, 'own', [1]), sql: calendarSql([personId(1)]) },
    { name: 'broad-calendar-authorized-scope', scope: '120 explicitly granted targets, exact runtime-bound authorized employee array', rpc: 'leave_calendar_v1', requiredRelations: ['ihr_leave_requests', 'ihr_leave_request_days', 'users'], forbidSeqScan: [], calendarAuthorization: calendarAuthorization(475, 'granted', Array.from({ length: 120 }, (_, i) => i + 1)), sql: calendarSql(Array.from({ length: 120 }, (_, i) => personId(i + 1))) },
    { name: 'broad-assigned-counts', scope: '240 assigned employees, actual canonical assigned predicate', rpc: 'leave_approval_counts_v1', requiredRelations: ['ihr_leave_requests'], forbidSeqScan: [], sql: `SELECT count(*) FILTER(WHERE r.status='submitted'),count(*) FILTER(WHERE r.status='cancellation_pending') FROM public.ihr_leave_requests r WHERE private.ihr_leave_is_assigned_request(${actor(481)},r.id,statement_timestamp())` },
    { name: 'narrow-private-hr-history-cursor', scope: 'one request, exact time/UUID cursor, 50 events and original projection joins', rpc: 'leave_hr_request_history_v1', requiredRelations: ['ihr_leave_request_events', 'users'], forbidSeqScan: ['ihr_leave_request_events'], sql: `SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'event',e.event,'atTime',e.at_time,'actor',jsonb_build_object('id',e.actor_id,'name',u.full_name),
'reason',CASE WHEN e.event='reassigned' THEN reassignment.reason WHEN e.event IN('rejected','cancellation_requested','cancellation_declined') AND jsonb_typeof(e.data->'reason')='string' THEN e.data->>'reason' ELSE NULL END,
'approverName',CASE WHEN e.event IN('submitted','opening_imported') THEN ${routeName} WHEN e.event='reassigned' THEN reassignment.assignment_source->>'approver_name'
 WHEN e.event='cancellation_requested' THEN attempt.approver_name
 WHEN e.event IN('cancellation_accepted','cancellation_declined') THEN coalesce(decision_route.assignment_source->>'approver_name',attempt.approver_name)
 WHEN e.event IN('approved','rejected') THEN coalesce(decision_route.assignment_source->>'approver_name',${routeName}) ELSE NULL END) ORDER BY e.at_time DESC,e.id DESC),'[]')
FROM(SELECT * FROM private.ihr_leave_request_events WHERE request_id=${requestId} AND (at_time,id)<('${request.year}-01-01T00:01:14.000000Z'::timestamptz,${literal(eventId(request, 74))}::uuid) ORDER BY at_time DESC,id DESC LIMIT 50)e
JOIN public.users u ON u.id=e.actor_id
LEFT JOIN private.ihr_leave_request_reassignments reassignment ON e.event='reassigned' AND reassignment.request_id=${requestId} AND reassignment.request_version::text=e.data->>'requestVersion'
LEFT JOIN private.ihr_leave_cancellation_attempts attempt ON attempt.request_id=${requestId} AND attempt.id::text=e.data->>'attemptId'
LEFT JOIN LATERAL(SELECT rr.assignment_source FROM private.ihr_leave_request_reassignments rr WHERE rr.request_id=${requestId} AND rr.created_at<=e.at_time AND ((e.event IN('approved','rejected') AND NOT (rr.assignment_source ? 'cancellation_attempt_id')) OR (e.event IN('cancellation_accepted','cancellation_declined') AND rr.assignment_source->>'cancellation_attempt_id'=attempt.id::text)) ORDER BY rr.request_version DESC LIMIT 1)decision_route ON e.event IN('approved','rejected','cancellation_accepted','cancellation_declined')` },
  ].map(plan => ({ ...plan, role: 'postgres', sqlSha256: sha256(plan.sql), source: sources[plan.rpc], authorityEvidence: 'underlying SELECT only; actual authenticated RPC permission assertions are separate', ...(plan.calendarAuthorization ? { planLimits: ['row EXPLAIN excludes authorization collection cost; full authenticated RPC timings include it', 'UUID array literal represents the captured binding; long-lived PL/pgSQL generic-cache behavior is not established'] } : {}) }))
}
export function assertCapacityPlanInventory(plans) {
  const expected = buildCapacityPlans()
  if (!Array.isArray(plans) || plans.length !== expected.length || new Set(plans.map(p => p.name)).size !== expected.length) throw new Error('Complete nonempty required plan inventory is mandatory')
  for (const required of expected) {
    const actual = plans.find(p => p.name === required.name)
    if (!actual || sha256(actual) !== sha256(required)) throw new Error(`Required original-query/source plan changed: ${required.name}`)
  }
}
export function assertPlanGate(plan, explain) {
  if (!Array.isArray(explain) || explain.length !== 1 || !explain[0]?.Plan || !Number.isFinite(explain[0]['Planning Time']) || !Number.isFinite(explain[0]['Execution Time'])) throw new Error(`${plan.name}: missing or malformed analyzed EXPLAIN root`)
  if (!Number.isFinite(explain[0].Plan['Shared Hit Blocks']) || !Number.isFinite(explain[0].Plan['Shared Read Blocks'])) throw new Error(`${plan.name}: missing root BUFFERS evidence`)
  const scans = [], relations = new Set()
  let nodes = 0
  function visit(node) {
    if (!node || typeof node !== 'object' || typeof node['Node Type'] !== 'string' || !Number.isFinite(node['Actual Rows']) || !Number.isFinite(node['Actual Loops'])) throw new Error(`${plan.name}: missing ANALYZE/BUFFERS plan node evidence`)
    nodes++
    if (node['Relation Name']) relations.add(node['Relation Name'])
    if (node['Node Type'].includes('Seq Scan') && plan.forbidSeqScan.includes(node['Relation Name'])) scans.push(node['Relation Name'])
    if (node.Plans !== undefined) { if (!Array.isArray(node.Plans)) throw new Error(`${plan.name}: malformed child plans`); node.Plans.forEach(visit) }
  }
  visit(explain[0].Plan)
  if (nodes === 0 || plan.requiredRelations.some(name => !relations.has(name))) throw new Error(`${plan.name}: opaque or missing required underlying relations`)
  if (scans.length) throw new Error(`${plan.name}: prohibited narrow full-table scan (${scans.join(', ')})`)
}
