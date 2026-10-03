import { AS_OF, accountId, addDays, approverNumber, buildCapacityFixture, requestVersion, eventId, groupAt, holidays, personId, scheduledMinutes, uuid, weekday } from './capacity-fixture.mjs'
import { literal } from './capacity-sql.mjs'
import { buildCapacityHrWorkloads, assertCapacityHrResult } from './capacity-hr-workloads.mjs'
const json = value => `${literal(JSON.stringify(value))}::jsonb`
const id = n => `${literal(personId(n))}::uuid`
const version = requestVersion
const personName = n => `Fictional Capacity ${String(n).padStart(3, '0')}`
const summary = r => ({ id: r.id, sequence: r.sequence, status: r.status, version: version(r), totalMinutes: r.total, startDate: r.start, endDate: r.end, duration: r.duration, submittedAt: `${r.year}-01-01T00:00:00Z`, sourceKind: 'submission' })
const assignedSummary = r => ({ ...summary(r), employee: {id: personId(r.employee), name: personName(r.employee)}, cancellationAttemptId: r.status === 'cancellation_pending' ? uuid('attempt', r.id) : null, cancellationRequestedAt: r.status === 'cancellation_pending' ? `${r.year}-01-01T00:00:02Z` : null })
export function buildCapacityWorkloads(f = buildCapacityFixture()) {
  const workloads = []
  function add(name, actor, scope, sql, expected, kind = 'read') { workloads.push({ name, actor: personId(actor), actorNumber: actor, scope, sql, expected, kind, thresholdMs: kind === 'read' ? 1000 : 2000, role: 'authenticated' }) }
  function page(name, actor, rows, before = null, rpc = 'leave_own_history_v1') {
    const available = rows.filter(r => before === null || r.sequence < before).sort((a, b) => b.sequence - a.sequence), selected = available.slice(0, 50)
    add(name, actor, rpc === 'leave_own_history_v1' ? 'own-private-history' : 'currently-assigned-submitted-and-cancellation-pending', `SELECT public.${rpc}(${before ?? 'NULL'},50)`, { type: 'page', rows: selected.map(rpc === 'leave_own_history_v1' ? summary : assignedSummary), nextBefore: available.length > 50 ? selected.at(-1).sequence : null })
  }
  const own = f.requests.filter(r => r.employee === 1).sort((a, b) => b.sequence - a.sequence)
  page('own-history-first-50', 1, own)
  page('own-history-deep-50', 1, own, own[99].sequence)
  page('own-history-empty', 480, [])
  for (const [label, actor] of [['large-team', 481], ['small-team', 482], ['director-managers', 496]]) {
    const rows = f.requests.filter(r => r.approver === actor && ['submitted', 'cancellation_pending'].includes(r.status) && r.employee <= 495).sort((a, b) => b.sequence - a.sequence)
    page(`assigned-${label}-first-50`, actor, rows, null, 'leave_assigned_inbox_v1')
    page(`assigned-${label}-deep-50`, actor, rows, rows.length > 100 ? rows[99].sequence : 1, 'leave_assigned_inbox_v1')
    add(`counts-${label}-full`, actor, 'all-current-assigned-count-buckets', 'SELECT public.leave_approval_counts_v1()', { type: 'exact', value: { pendingLeave: rows.filter(r => r.status === 'submitted').length, pendingCancellation: rows.filter(r => r.status === 'cancellation_pending').length } })
  }
  const deny = (state, code = null) => ({ type: 'error', sqlstate: state, code })
  add('assigned-configure-only-denied', 470, 'configure-does-not-approve', 'SELECT public.leave_assigned_inbox_v1(NULL,50)', deny('42501', 'REQUEST_ACCESS_DENIED'))
  for (const [actor, label] of [[471, 'adjust-only'], [472, 'read-private-only'], [473, 'calendar-only'], [474, 'manage-access-only'], [475, 'combined-hr']]) add(`assigned-${label}-denied`, actor, 'hr-grants-do-not-approve', 'SELECT public.leave_assigned_inbox_v1(NULL,50)', deny('42501', 'REQUEST_ACCESS_DENIED'))
  add('counts-employee-empty', 480, 'own-only', 'SELECT public.leave_approval_counts_v1()', { type: 'exact', value: { pendingLeave: 0, pendingCancellation: 0 } })
  add('counts-inactive-denied', 501, 'inactive', 'SELECT public.leave_approval_counts_v1()', deny('42501'))
  const detail = f.requests.find(r => r.status === 'submitted' && r.employee === 1 && r.days.length > 1) ?? f.requests.find(r => r.status === 'submitted' && r.employee === 1)
  const expectedDetail = { type: 'detail', summary: summary(detail), days: detail.days.map(d => ({ date: d.date, scheduledMinutes: d.scheduled, chargedMinutes: d.charged, exclusion: d.scheduled ? null : holidays.includes(d.date) ? 'holiday' : 'off_duty', groupName: weekday(d.date) === 6 ? `Fictional ${groupAt(detail.employee, d.date)}` : null })), allocations: [{ year: detail.year, startDate: `${detail.year}-01-01`, endDate: `${detail.year + 1}-01-01`, chargedMinutes: detail.total }], reason: 'Fictional capacity request', approverName: personName(detail.approver) }
  add('own-detail-days', 1, 'own', `SELECT public.leave_own_request_v1(${literal(detail.id)}::uuid)`, expectedDetail)
  add('assigned-detail-days', detail.approver, 'exact-assigned', `SELECT public.leave_assigned_request_v1(${literal(detail.id)}::uuid)`, { ...expectedDetail, summary: assignedSummary(detail), cancellation: null })
  add('unrelated-detail-denied', 480, 'unrelated', `SELECT public.leave_own_request_v1(${literal(detail.id)}::uuid)`, deny('42501', 'REQUEST_ACCESS_DENIED'))
  // Exact ledger sequences derive from materialization order; no opaque guessed cursor.
  let sequence = 1500
  const ledger = []
  f.accounts.forEach((a, i) => ledger.push({ account: a.id, sequence: i + 1, id: uuid('grant-ledger', a.id), kind: 'annual_grant', allowanceDelta: 5400, reservedDelta: 0, usedDelta: 0, date: `${a.year}-01-01` }))
  for (const r of f.requests) for (const step of r.transitions) {
    if (step === 'cancellation_requested' || step === 'cancellation_declined') continue
    const [kind, reservedDelta, usedDelta] = step === 'submitted' ? ['reservation', r.total, 0] : step === 'approved' ? ['approval', -r.total, r.total] : step === 'rejected' ? ['rejection', -r.total, 0] : step === 'withdrawn' ? ['withdrawal', -r.total, 0] : ['cancellation', 0, -r.total]
    ledger.push({ account: r.account, sequence: ++sequence, id: uuid('ledger', `${r.id}:${step}`), kind, allowanceDelta: 0, reservedDelta, usedDelta, date: r.start })
  }
  const account = accountId(1, 2024), entries = ledger.filter(l => l.account === account).sort((a, b) => b.sequence - a.sequence)
  for (const [name, actor, before] of [['own-balance-first-50', 1, null], ['own-balance-deep-50', 1, entries[99].sequence], ['private-hr-balance-first-50', 472, null], ['private-hr-balance-deep-50', 472, entries[99].sequence]]) {
    const available = entries.filter(l => before === null || l.sequence < before), selected = available.slice(0, 50).map(({ account: _account, ...row }) => row)
    add(name, actor, actor === 1 ? 'own-account' : 'exact-read-private-grant', `SELECT public.leave_balance_history_v1(${literal(account)}::uuid,${before ?? 'NULL'},50)`, { type: 'balance-page', rows: selected, nextBefore: available.length > 50 ? selected.at(-1).sequence : null, balance: { accountId: account, year: 2024, allowanceMinutes: 5400, reconciled: true, approvedMinutes: entries.reduce((n, l) => n + l.usedDelta, 0), pendingMinutes: entries.reduce((n, l) => n + l.reservedDelta, 0), availableMinutes: 0, expiredMinutes: 5400 - entries.reduce((n, l) => n + l.usedDelta + l.reservedDelta, 0), version: 1 + entries.length } })
  }
  for (const [actor, label] of [[470, 'configure'], [471, 'adjust'], [473, 'calendar'], [474, 'manage-access']]) add(`${label}-private-balance-denied`, actor, `${label}-only`, `SELECT public.leave_balance_history_v1(${literal(account)}::uuid,NULL,50)`, deny('42501', 'BALANCE_ACCESS_DENIED'))
  const from = '2026-01-01', to = '2026-04-03'
  for (const [name, actor, audience, targets] of [
    ['own', 1, 'own', [1]], ['own-empty', 480, 'own', [480]], ['team-small', 482, 'assigned_team', [241, 242, 243, 244]],
    ['team-large', 481, 'assigned_team', Array.from({ length: 240 }, (_, i) => i + 1)], ['director', 496, 'assigned_team', [481, 486, 491]],
    ['scoped-calendar', 473, 'granted', [1]], ['broad-approved', 475, 'granted', Array.from({ length: 120 }, (_, i) => i + 1)],
  ]) {
    const rows = f.requests.filter(r => ['approved', 'cancellation_pending'].includes(r.status) && targets.includes(r.employee)).flatMap(r => r.days.filter(d => d.charged && d.date >= from && d.date <= to).map(d => ({ employeeId: personId(r.employee), employeeName: f.people.find(p => p.n === r.employee).name, date: d.date, approvedMinutes: d.charged, availabilityLabel: d.charged === d.scheduled ? 'full_scheduled_absence' : 'partial_absence' }))).sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName) || a.employeeId.localeCompare(b.employeeId))
    add(`calendar-93-${name}`, actor, audience, `SELECT public.leave_calendar_v1('${from}','${to}',${literal(audience)})`, { type: 'exact', value: rows })
  }
  for (const [name, actor, audience] of [['unrelated', 480, 'granted'], ['configure-only', 470, 'granted'], ['director-own', 496, 'own'], ['director-broader', 496, 'granted']]) add(`calendar-${name}-denied`, actor, audience, `SELECT public.leave_calendar_v1('${from}','${to}',${literal(audience)})`, deny('42501'))
  const quoteInput = (start, end, duration) => ({ start_date: start, end_date: end, duration, reason: 'Fictional capacity quote' })
  const fixed = minutes => ({ mode: 'fixed_minutes', minutes })
  const maximumInput = quoteInput(AS_OF, addDays(AS_OF, 365), fixed(60))
  add('quote-public-maximum-366-missing-2027', 480, 'own-full-range-rejection', `SELECT public.leave_quote_v1(${json(maximumInput)})`, deny('55000', 'ACCOUNT_UNAVAILABLE'), 'quote')
  add('quote-cross-year-missing-account', 480, 'own', `SELECT public.leave_quote_v1(${json(quoteInput('2026-12-31', '2027-01-04', fixed(60)))})`, deny('55000', 'ACCOUNT_UNAVAILABLE'), 'quote')
  let saturday = addDays(AS_OF, 1)
  while (weekday(saturday) !== 6 || scheduledMinutes(480, saturday) !== 225) saturday = addDays(saturday, 1)
  for (const minutes of [60, 120, 180, 225]) add(`quote-working-saturday-${minutes}`, 480, 'own-explicit-roster', `SELECT public.leave_quote_v1(${json(quoteInput(saturday, saturday, fixed(minutes)))})`, { type: 'quote', totalMinutes: minutes, dates: [saturday], scheduledMinutes: [225], chargedMinutes: [minutes] }, 'quote')
  add('quote-working-saturday-full', 480, 'own-explicit-roster', `SELECT public.leave_quote_v1(${json(quoteInput(saturday, saturday, { mode: 'full_scheduled_day' }))})`, { type: 'quote', totalMinutes: 225, dates: [saturday], scheduledMinutes: [225], chargedMinutes: [225] }, 'quote')
  for (const minutes of [240, 300, 360]) add(`quote-whole-request-saturday-reject-${minutes}`, 480, 'own-friday-and-duty-saturday', `SELECT public.leave_quote_v1(${json(quoteInput(addDays(saturday, -1), saturday, fixed(minutes)))})`, deny('22023', 'DURATION_EXCEEDS_SHIFT'), 'quote')
  const historical = quoteInput('2024-01-01', '2024-12-31', fixed(60))
  workloads.push({ name: 'quote-owner-historical-maximum-366', actor: personId(480), actorNumber: 480, role: 'postgres', scope: 'OWNER-CALCULATION-ONLY-NO-AUTHORITY-PROOF', sql: `SELECT private.ihr_leave_quote_v1(${id(480)},${json(historical)},'2024-01-01T00:00:00Z'::timestamptz)`, expected: deny('55000', 'INSUFFICIENT_ALLOWANCE'), kind: 'quote', thresholdMs: 2000 })
  // Each mutation receives the exact same restored baseline; generated RPC IDs may vary and must be read back.
  for (const operation of ['approve_request', 'reject_request', 'withdraw_request', 'approve_cancellation']) {
    const r = f.requests.find(r => r.employee === 1 && r.status === (operation === 'approve_cancellation' ? 'cancellation_pending' : 'submitted'))
    const payload = { request_id: r.id, expected_version: version(r), ...(operation === 'reject_request' ? { reason: 'Fictional rejection' } : {}), ...(operation === 'approve_cancellation' ? { attempt_id: uuid('attempt', r.id) } : {}) }
    add(`mutation-${operation}`, operation === 'withdraw_request' ? r.employee : r.approver, 'restored-uncontended-request', `SELECT public.leave_transaction_v1(${literal(uuid('mutation-command', operation))}::uuid,${literal(operation)},${json(payload)})`, { type: 'receipt', id: r.id, version: version(r) + 1, operation }, 'mutation')
    workloads.at(-1).postcondition = { requestId: r.id, allocationAccountId: r.account, totalMinutes: r.total, status: { approve_request: 'approved', reject_request: 'rejected', withdraw_request: 'withdrawn', approve_cancellation: 'cancelled' }[operation] }
  }
  const submit = quoteInput('2026-10-05', '2026-10-05', fixed(60))
  add('mutation-submit', 480, 'restored-own-empty-account', `SELECT public.leave_transaction_v1(${literal(uuid('mutation-command', 'submit'))}::uuid,'submit_request',jsonb_build_object('input',${json(submit)},'quote_fingerprint',:CAPACITY_QUOTE_FINGERPRINT))`, { type: 'receipt', version: 1, operation: 'submit_request' }, 'mutation')
  workloads.at(-1).prepareSql = `SELECT public.leave_quote_v1(${json(submit)})`
  workloads.at(-1).postcondition = { employeeId: personId(480), allocationAccountId: accountId(480, 2026), status: 'submitted', totalMinutes: 60 }
  add('mutation-adjustment', 471, 'restored-exact-adjust-grant', `SELECT public.leave_transaction_v1(${literal(uuid('mutation-command', 'adjust'))}::uuid,'adjust_balance',jsonb_build_object('employee_id',${id(1)},'year',2026,'expected_version',:CAPACITY_ACCOUNT_VERSION,'delta_minutes',-60,'source_id',${literal(uuid('adjustment', 1))}::uuid,'reason','Fictional bounded adjustment'))`, { type: 'receipt', id: accountId(1, 2026), operation: 'adjust_balance' }, 'mutation')
  workloads.at(-1).prepareOwnerSql = `SELECT to_jsonb(a) FROM public.ihr_leave_accounts a WHERE id=${literal(accountId(1, 2026))}::uuid`
  workloads.at(-1).postcondition = { accountId: accountId(1, 2026), allowanceMinutes: 5340 }
  workloads.splice(workloads.findIndex(w => w.kind === 'mutation'), 0, ...buildCapacityHrWorkloads(f))
  return workloads
}
export function assertCapacityResult(workload, captured) {
  const fail = why => { throw new Error(`${workload.name}: ${why}`) }
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  const equal = (actual, expected, what) => { if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) fail(`${what} mismatch`) }
  const subset = (actual, expected, what) => { for (const [key, value] of Object.entries(expected)) {
    if (['submittedAt', 'cancellationRequestedAt'].includes(key) && value !== null) equal(Date.parse(actual?.[key]), Date.parse(value), `${what}.${key}`)
    else equal(actual?.[key], value, `${what}.${key}`)
  } }
  const e = workload.expected
  if (e.type.startsWith('hr-')) return assertCapacityHrResult(workload, captured, assertCapacityResult)
  if (e.type === 'error') {
    if (captured.ok !== false || captured.sqlstate !== e.sqlstate || (e.code !== null && captured.code !== e.code)) fail('expected exact controlled rejection')
    return
  }
  if (captured.ok !== true) fail('expected successful RPC')
  const value = captured.value
  if (e.type === 'exact') { equal(value, e.value, 'value'); return }
  if (e.type === 'page' || e.type === 'balance-page') {
    equal(value.nextBefore, e.nextBefore, 'cursor'); equal(value.rows?.length, e.rows.length, 'page length')
    e.rows.forEach((row, i) => { equal(Object.keys(value.rows[i]).sort(), Object.keys(row).sort(), `row ${i} keys`); subset(value.rows[i], row, `row ${i}`) })
    equal(Object.keys(value).sort(), e.type === 'balance-page' ? ['balance', 'nextBefore', 'rows'] : ['nextBefore', 'rows'], 'page keys')
    if (e.balance) equal(value.balance, e.balance, 'balance')
  } else if (e.type === 'detail') {
    subset(value, e.summary, 'detail'); equal(value.days, e.days, 'immutable days'); equal(value.allocations, e.allocations, 'original allocations'); equal(value.reason, e.reason, 'private reason'); equal(value.approverName, e.approverName, 'approver name')
    if ('cancellation' in e) equal(value.cancellation, e.cancellation, 'cancellation detail')
    equal(Object.keys(value).sort(), [...Object.keys(e.summary), 'reason', 'approverName', 'days', 'allocations', ...('cancellation' in e ? ['cancellation'] : [])].sort(), 'detail keys')
  } else if (e.type === 'quote') {
    equal(value.totalMinutes, e.totalMinutes, 'total'); equal(value.days?.map(d => d.date), e.dates, 'dates'); equal(value.days?.map(d => d.scheduledMinutes), e.scheduledMinutes, 'schedule'); equal(value.days?.map(d => d.chargedMinutes), e.chargedMinutes, 'charge')
  } else if (e.type === 'receipt') {
    equal(Object.keys(value).sort(), ['id', 'operation', 'version'], 'receipt shape')
    if (!/^[0-9a-f-]{36}$/.test(value.id) || !Number.isInteger(value.version) || value.version < 1) fail('invalid receipt')
    subset(value, Object.fromEntries(Object.entries(e).filter(([key]) => key !== 'type')), 'receipt')
  } else fail('unknown assertion kind')
}
export { buildCapacityPlans } from './capacity-plans.mjs'
