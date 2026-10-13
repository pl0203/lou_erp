// Additive read-only workloads for Task 11 frozen interfaces revision 6.
import { buildCapacityFixture, requestVersion, eventId, groupAt, holidays, personId, uuid, weekday } from './capacity-fixture.mjs'
import { literal } from './capacity-sql.mjs'
const personName = n => `Fictional Capacity ${String(n).padStart(3, '0')}`
const version = requestVersion
const summary = r => ({ id: r.id, sequence: r.sequence, status: r.status, version: version(r), totalMinutes: r.total, startDate: r.start, endDate: r.end, duration: r.duration, submittedAt: `${r.year}-01-01T00:00:00Z`, sourceKind: 'submission' })
const utc = (year, seconds, micros = 0) => new Date(Date.parse(`${year}-01-01T00:00:00Z`) + seconds * 1000).toISOString().replace('.000Z', `.${String(micros).padStart(6, '0')}Z`)
export function capacityHistoryInstant(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/)
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) throw new Error('Invalid precise history timestamp')
  const whole = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[6]}`)
  if (!Number.isFinite(whole) || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) throw new Error('Invalid precise history timestamp')
  return BigInt(whole) * 1000n + BigInt((match[5] ?? '').padEnd(6, '0') || '0')
}
export function compareCapacityHistory(a, b) {
  const instantA = capacityHistoryInstant(a.atTime), instantB = capacityHistoryInstant(b.atTime)
  if (instantA !== instantB) return instantA < instantB ? -1 : 1
  const left = a.id.toLowerCase(), right = b.id.toLowerCase()
  return left === right ? 0 : left < right ? -1 : 1
}
export function capacityHistoryRows(r) {
  return r.transitions.map((event, index) => {
    const actor = ['approved', 'rejected', 'cancellation_accepted', 'cancellation_declined'].includes(event) ? r.approver : r.employee
    return { id: eventId(r, index), event, atTime: utc(r.year, index), actor: { id: personId(actor), name: personName(actor) },
      // Controlled reasons follow the same valid transition that produced the immutable event.
      reason: event === 'rejected' ? 'Fictional rejection' : event === 'cancellation_requested' ? 'Fictional cancellation' : event === 'cancellation_declined' ? 'Fictional cancellation declined' : null, approverName: ['submitted', 'approved', 'rejected', 'cancellation_requested', 'cancellation_accepted', 'cancellation_declined'].includes(event) ? personName(r.approver) : null }
  }).sort((a, b) => -compareCapacityHistory(a, b))
}
export function buildCapacityHrWorkloads(f = buildCapacityFixture()) {
  const result = [], own = f.requests.filter(r => r.employee === 1).sort((a, b) => b.sequence - a.sequence)
  const selected = own.find(r => r.status === 'cancelled')
  const detail = { type: 'detail', summary: summary(selected), reason: 'Fictional capacity request', approverName: personName(selected.approver),
    days: selected.days.map(d => ({ date: d.date, scheduledMinutes: d.scheduled, chargedMinutes: d.charged, exclusion: d.scheduled ? null : holidays.includes(d.date) ? 'holiday' : 'off_duty', groupName: weekday(d.date) === 6 ? `Fictional ${groupAt(selected.employee, d.date)}` : null })),
    allocations: [{ year: selected.year, startDate: `${selected.year}-01-01`, endDate: `${selected.year + 1}-01-01`, chargedMinutes: selected.total }] }
  const employee = `${literal(personId(1))}::uuid`, request = `${literal(selected.id)}::uuid`, events = capacityHistoryRows(selected)
  function add(name, actor, target, sql, expected) {
    result.push({ name: `hr-${name}`, actor: personId(actor), actorNumber: actor, scope: 'exact-read-private-target-only', sql, expected, kind: 'read', thresholdMs: 1000, role: 'authenticated',
      ...(expected.type === 'error' ? {} : { prepareExpectedSql: `SELECT jsonb_build_object('scopeVersion',private.ihr_leave_scope_version(${literal(personId(actor))}::uuid),'authorityKey',private.ihr_leave_admin_authority_key(${literal(personId(actor))}::uuid,${literal(personId(target))}::uuid))` }) })
  }
  function page(name, actor, before) {
    const rows = own.filter(r => before === null || r.sequence < before), projected = rows.slice(0, 50)
    add(name, actor, 1, `SELECT public.leave_hr_requests_v1(${employee},${before ?? 'NULL'},50)`, { type: 'hr-page', employeeId: personId(1), nested: { type: 'page', rows: projected.map(summary), nextBefore: rows.length > 50 ? projected.at(-1).sequence : null } })
  }
  page('requests-first-50', 472, null)
  page('requests-deep-50', 472, own[99].sequence)
  page('requests-combined-grant-first-50', 475, null)
  page('requests-authorized-empty-page', 472, 1)
  add('detail-original-days-charges', 472, 1, `SELECT public.leave_hr_request_v1(${employee},${request})`, { type: 'hr-detail', employeeId: personId(1), nested: detail })
  function history(name, before = null, limit = 50) {
    const available = events.filter(e => !before || compareCapacityHistory(e, before) < 0), rows = available.slice(0, limit)
    add(name, 472, 1, `SELECT public.leave_hr_request_history_v1(${employee},${request},${before ? `${literal(before.atTime)}::timestamptz,${literal(before.id)}::uuid` : 'NULL,NULL'},${limit})`,
      { type: 'hr-history', employeeId: personId(1), requestId: selected.id, rows, nextBefore: available.length > limit ? { atTime: rows.at(-1).atTime, id: rows.at(-1).id } : null, before, limit })
  }
  history('history-first-page-50')
  history('history-deep-page-50', { atTime: events[49].atTime, id: events[49].id })
  history('history-after-exact-cursor-50', { atTime: events[0].atTime, id: events[0].id })
  history('history-authorized-empty-page-50', { atTime: events.at(-1).atTime, id: events.at(-1).id })
  // Existing event timestamps stay untouched. Fractional cursor inputs distinguish one microsecond from UUID tie ordering.
  history('history-microsecond-after-event-50', { atTime: utc(selected.year, selected.transitions.length - 1, 1), id: '00000000-0000-0000-0000-000000000000' })
  history('history-microsecond-before-event-50', { atTime: utc(selected.year, selected.transitions.length - 2, 999999), id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })
  history('history-same-time-upper-uuid-50', { atTime: events[0].atTime, id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })
  history('history-same-time-lower-uuid-50', { atTime: events[0].atTime, id: '00000000-0000-0000-0000-000000000000' })
  history('history-first-one-cursor', null, 1)
  history('history-next-one-cursor', { atTime: events[0].atTime, id: events[0].id }, 1)
  const denial = { type: 'error', sqlstate: '42501', code: 'REQUEST_ACCESS_DENIED' }
  for (const [actor, label] of [[1, 'owner'], [481, 'approver'], [470, 'configure'], [471, 'adjust'], [473, 'calendar'], [474, 'manage-access'], [496, 'director'], [480, 'unrelated']]) {
    add(`${label}-list-denied`, actor, 1, `SELECT public.leave_hr_requests_v1(${employee},NULL,50)`, denial)
    add(`${label}-detail-denied`, actor, 1, `SELECT public.leave_hr_request_v1(${employee},${request})`, denial)
    add(`${label}-history-denied`, actor, 1, `SELECT public.leave_hr_request_history_v1(${employee},${request},NULL,NULL,50)`, denial)
  }
  const otherRequest = f.requests.find(r => r.employee === 2).id
  add('read-private-unrelated-target-denied', 472, 2, `SELECT public.leave_hr_requests_v1(${literal(personId(2))}::uuid,NULL,50)`, denial)
  for (const [key, requestId] of [['wrong-target-request', otherRequest], ['guessed-request', uuid('missing-request', 1)]]) {
    add(`${key}-detail-denied`, 472, 1, `SELECT public.leave_hr_request_v1(${employee},${literal(requestId)}::uuid)`, denial)
    add(`${key}-history-denied`, 472, 1, `SELECT public.leave_hr_request_history_v1(${employee},${literal(requestId)}::uuid,NULL,NULL,50)`, denial)
  }
  add('history-partial-cursor-denied', 472, 1, `SELECT public.leave_hr_request_history_v1(${employee},${request},${literal(events[0].atTime)}::timestamptz,NULL,50)`, { type: 'error', sqlstate: '22023', code: null })
  return result
}
export function assertCapacityHrResult(workload, captured, assertNested) {
  const e = workload.expected, value = captured.value
  const fail = label => { throw new Error(`${workload.name}: ${label} mismatch`) }
  const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x
  const equal = (a, b, label) => { if (JSON.stringify(canonical(a)) !== JSON.stringify(canonical(b))) fail(label) }
  if (captured.ok !== true || !value || typeof value !== 'object') fail('expected successful private read')
  if (!/^\d+:[0-9a-f]{32}$/.test(e.scopeVersion ?? '') || !/^[0-9a-f]{64}$/.test(e.authorityKey ?? '')) fail('missing independently prepared authority binding')
  equal(value.employeeId, e.employeeId, 'target')
  equal(value.scopeVersion, e.scopeVersion, 'current scope')
  equal(value.authorityKey, e.authorityKey, 'target authority')
  const keys = ['employeeId', 'scopeVersion', 'authorityKey', ...(e.type === 'hr-detail' ? ['request'] : ['rows', 'nextBefore']), ...(e.type === 'hr-history' ? ['requestId'] : [])]
  equal(Object.keys(value).sort(), keys.sort(), 'minimal envelope keys')
  if (e.type === 'hr-page') return assertNested({ ...workload, expected: e.nested }, { ok: true, value: { rows: value.rows, nextBefore: value.nextBefore } })
  if (e.type === 'hr-detail') return assertNested({ ...workload, expected: e.nested }, { ok: true, value: value.request })
  if (e.type !== 'hr-history') fail('unknown HR type')
  equal(value.requestId, e.requestId, 'selected request')
  equal(value.rows?.length, e.rows.length, 'history length')
  value.rows.forEach((row, index) => {
    equal(Object.keys(row).sort(), ['actor', 'approverName', 'atTime', 'event', 'id', 'reason'], 'history row keys')
    equal(Object.keys(row.actor).sort(), ['id', 'name'], 'recorded actor keys')
    if (capacityHistoryInstant(row.atTime) !== capacityHistoryInstant(e.rows[index].atTime)) fail('microsecond event time')
    const { atTime: _atTime, ...actual } = row, { atTime: _expectedAt, ...expected } = e.rows[index]
    equal(actual, expected, 'immutable event projection')
    if ((e.before && compareCapacityHistory(row, e.before) >= 0) || (index > 0 && compareCapacityHistory(row, value.rows[index - 1]) >= 0)) fail('strict microsecond/UUID ordering')
  })
  if (e.nextBefore === null) equal(value.nextBefore, null, 'history exhaustion')
  else {
    equal(Object.keys(value.nextBefore ?? {}).sort(), ['atTime', 'id'], 'history cursor keys')
    if (compareCapacityHistory(value.nextBefore, e.nextBefore) !== 0 || compareCapacityHistory(value.nextBefore, value.rows.at(-1)) !== 0) fail('lossless history cursor')
  }
}
