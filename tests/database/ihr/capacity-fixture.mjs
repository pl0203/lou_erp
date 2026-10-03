// Fictional deterministic capacity envelope; no database access or product setup occurs here.
import { createHash } from 'node:crypto'
export const SEED = 'ihr-capacity-v1-20261003'
export const AS_OF = '2026-10-03'
export const YEARS = [2024, 2025, 2026]
export const STATES = { approved: 3500, cancellation_pending: 500, submitted: 1000, rejected: 2000, withdrawn: 1500, cancelled: 1500 }
export const ACTIVE_STATES = ['submitted', 'approved', 'cancellation_pending']
export const PRESETS = [60, 120, 180, 225, 240, 300, 360, 'full_scheduled_day']
export const CAPS = ['configure', 'adjust', 'read_private', 'calendar', 'manage_access']
export const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export const uuid = (kind, value) => {
  const h = sha256(`${SEED}:${kind}:${value}`)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
export const personId = n => uuid('person', n)
export const accountId = (n, year) => uuid('account', `${n}:${year}`)
export const dayNumber = text => Date.parse(`${text}T00:00:00Z`) / 86400000
export const dateAt = n => new Date(n * 86400000).toISOString().slice(0, 10)
export const addDays = (text, n) => dateAt(dayNumber(text) + n)
export const weekday = text => new Date(`${text}T00:00:00Z`).getUTCDay()
export const approverNumber = n => n <= 240 ? 481 : n <= 244 ? 482 : n <= 480 ? 483 + ((n - 245) % 13) : 496 + ((n - 481) % 5)
export const groupAt = (n, date) => (n % 2 === 1) !== (n % 25 === 0 && date >= '2025-07-01') ? 'A' : 'B'
export const holidays = YEARS.flatMap(year => [`${year}-01-01`, `${year}-05-01`, `${year}-12-25`]).concat(['2027-01-01', '2027-05-01'])
export function scheduledMinutes(n, date) {
  if (holidays.includes(date) || weekday(date) === 0) return 0
  if (weekday(date) !== 6) return 450
  return ((dayNumber(date) - dayNumber('2024-01-06')) / 7 % 2 === 0) === (groupAt(n, date) === 'A') ? 225 : 0
}
export function transitionsFor(status) {
  return ['submitted', ...(status === 'submitted' ? [] : status === 'rejected' || status === 'withdrawn' ? [status] : ['approved', ...(['cancellation_pending', 'cancelled'].includes(status) ? ['cancellation_requested'] : []), ...(status === 'cancelled' ? ['cancellation_accepted'] : [])])]
}
export const requestVersion = r => r.transitions.length
export const eventId = (r, index) => uuid('event', r.historyCycles ? `${r.id}:${index}:${r.transitions[index]}` : `${r.id}:${r.transitions[index]}`)
export const attemptId = (r, number) => uuid('attempt', number === 1 ? r.id : `${r.id}:${number}`)
export function buildCapacityFixture() {
  const people = Array.from({ length: 505 }, (_, i) => {
    const n = i + 1
    return { n, id: personId(n), name: `Fictional Capacity ${String(n).padStart(3, '0')}`, active: n <= 500, kind: n <= 480 || n > 500 ? 'employee' : n <= 495 ? 'manager' : 'director' }
  })
  const eligible = people.filter(p => p.kind !== 'director')
  const accounts = eligible.flatMap(p => YEARS.map(year => ({ id: accountId(p.n, year), employee: p.n, year, allowance: 5400 })))
  const memberships = eligible.flatMap(p => p.n % 25 === 0 ? [
    { id: uuid('membership', `${p.n}:first`), employee: p.n, group: groupAt(p.n, '2024-01-01'), from: '2024-01-01', until: '2025-07-01' },
    { id: uuid('membership', `${p.n}:second`), employee: p.n, group: groupAt(p.n, '2025-07-01'), from: '2025-07-01', until: '2027-10-05' },
  ] : [{ id: uuid('membership', `${p.n}:first`), employee: p.n, group: groupAt(p.n, '2024-01-01'), from: '2024-01-01', until: '2027-10-05' }])
  const roster = []
  for (let date = '2024-01-06'; date <= '2027-10-02'; date = addDays(date, 7)) {
    for (const group of ['A', 'B']) roster.push({ id: uuid('roster', `${group}:${date}`), group, date, minutes: ((dayNumber(date) - dayNumber('2024-01-06')) / 7 % 2 === 0) === (group === 'A') ? 225 : 0 })
  }
  const grants = []
  // Ordinary employee classifications remain employee-only despite independent scoped HR grants.
  for (let k = 0; k < CAPS.length; k++) grants.push({ id: uuid('grant', `${470 + k}:1:${CAPS[k]}`), actor: 470 + k, employee: 1, capability: CAPS[k] })
  for (const capability of CAPS) for (let n = 1; n <= 120; n++) grants.push({ id: uuid('grant', `475:${n}:${capability}`), actor: 475, employee: n, capability })
  const requests = [], lengths = [1, 11, 2, 10, 3, 9, 4, 8, 5, 7]
  const activePeople = eligible.filter(p => p.active && p.n !== 480)
  const historicalPeople = eligible.filter(p => p.n !== 480)
  const slots = new Map(), occupied = new Set(), consumed = new Map()
  const order = ['rejected', 'withdrawn', 'cancelled', 'approved', 'cancellation_pending', 'submitted']
  let index = 0, activeIndex = 0, historicalIndex = 0
  for (const status of order) for (let count = 0; count < STATES[status]; count++, index++) {
    const active = ACTIVE_STATES.includes(status)
    const ordinal = active ? activeIndex++ : historicalIndex++
    const employee = active ? activePeople[ordinal % activePeople.length].n : ordinal < 240 ? 1 : historicalPeople[(ordinal - 240) % historicalPeople.length].n
    const year = YEARS[Math.floor(ordinal / (active ? activePeople.length : historicalPeople.length)) % 3]
    const account = accountId(employee, year), length = lengths[index % 10]
    const slot = active ? slots.get(account) ?? 0 : (ordinal % 8)
    if (active) slots.set(account, slot + 1)
    let start = addDays(`${year}-01-05`, slot * 28)
    while (scheduledMinutes(employee, start) === 0) start = addDays(start, 1)
    let preset = active ? 60 : PRESETS[index % PRESETS.length]
    const dates = Array.from({ length }, (_, d) => addDays(start, d))
    if (typeof preset === 'number' && dates.some(date => scheduledMinutes(employee, date) > 0 && scheduledMinutes(employee, date) < preset)) preset = 225
    const days = dates.map(date => ({ date, scheduled: scheduledMinutes(employee, date), charged: scheduledMinutes(employee, date) === 0 ? 0 : preset === 'full_scheduled_day' ? scheduledMinutes(employee, date) : preset }))
    const total = days.reduce((sum, d) => sum + d.charged, 0)
    if (active) {
      consumed.set(account, (consumed.get(account) ?? 0) + total)
      for (const day of days.filter(d => d.charged)) {
        const key = `${employee}:${day.date}`
        if (occupied.has(key)) throw new Error(`Overlapping active date ${key}`)
        occupied.add(key)
      }
    }
    requests.push({ id: uuid('request', index + 1), sequence: index + 1, employee, account, year, approver: employee > 500 ? 481 : approverNumber(employee), status,
      start, end: dates.at(-1), duration: preset === 'full_scheduled_day' ? { mode: preset } : { mode: 'fixed_minutes', minutes: preset }, total, days, transitions: transitionsFor(status) })
  }
  // Sixty legal request/decline cycles preserve the original charge and finish with the original accepted cancellation.
  const dense = requests.filter(r => r.employee === 1 && r.status === 'cancelled').at(-1)
  dense.historyCycles = 60
  dense.transitions = ['submitted', 'approved', ...Array.from({ length: 60 }, () => ['cancellation_requested', 'cancellation_declined']).flat(), 'cancellation_requested', 'cancellation_accepted']
  const fixture = { denseHistory: { requestId: dense.id, declinedCycles: 60, events: 124 }, seed: SEED, asOf: AS_OF, timezone: 'Etc/UTC', years: YEARS, rosterCoverage: { from: '2024-01-01', until: '2027-10-05', reason: '2024–2026 fixture plus explicit 366-day timed public quote coverage; no 2027 accounts or grants' }, people, accounts, memberships, roster, holidays, grants, requests }
  validateCapacityFixture(fixture)
  return fixture
}
export function validateCapacityFixture(f) {
  const check = (actual, label) => { if (!actual) throw new Error(`Invalid capacity fixture: ${label}`) }
  check(f.people.filter(p => p.active).length === 500, '500 active people')
  for (const [kind, count] of Object.entries({ employee: 480, manager: 15, director: 5 })) check(f.people.filter(p => p.active && p.kind === kind).length === count, kind)
  check(f.accounts.length === 1500 && new Set(f.accounts.map(a => a.id)).size === 1500, '1500 distinct annual accounts')
  check(f.accounts.every(a => a.allowance === 5400 && !f.people.find(p => p.n === a.employee).kind.includes('director')), 'normal eligible allowance')
  check(f.requests.length === 10000 && f.requests.reduce((n, r) => n + r.days.length, 0) === 60000, 'request/day cardinality')
  let peakCommittedMinutes = 0, events = 0, attempts = 0, decisions = 0, reversals = 0
  const occupied = new Set(), balances = new Map(f.accounts.map(a => [a.id, { allowance: 5400, used: 0, reserved: 0 }]))
  for (const [status, count] of Object.entries(STATES)) check(f.requests.filter(r => r.status === status).length === count, status)
  for (const r of f.requests) {
    const balance = balances.get(r.account)
    check(r.employee !== r.approver && r.total > 0 && Number.isInteger(r.total), 'request integer/route')
    check(r.days.every(d => Number.isInteger(d.charged) && d.charged >= 0 && d.charged <= d.scheduled), 'day charge bounds')
    check(r.days.reduce((n, d) => n + d.charged, 0) === r.total, 'allocation matches snapshots')
    let state = 'none'
    for (const step of r.transitions) {
      const allowed = { submitted: ['none', 'submitted'], approved: ['submitted', 'approved'], rejected: ['submitted', 'rejected'], withdrawn: ['submitted', 'withdrawn'], cancellation_requested: ['approved', 'cancellation_pending'], cancellation_declined: ['cancellation_pending', 'approved'], cancellation_accepted: ['cancellation_pending', 'cancelled'] }[step]
      check(allowed && state === allowed[0], 'legal transition order'); state = allowed[1]; events++
      if (step === 'cancellation_requested') attempts++
      if (step === 'cancellation_declined' || step === 'cancellation_accepted') decisions++
      if (step === 'cancellation_accepted') reversals++
      if (step === 'submitted') balance.reserved += r.total
      if (step === 'approved') { balance.reserved -= r.total; balance.used += r.total }
      if (step === 'rejected' || step === 'withdrawn') balance.reserved -= r.total
      if (step === 'cancellation_accepted') balance.used -= r.total
      peakCommittedMinutes = Math.max(peakCommittedMinutes, balance.used + balance.reserved)
      check(balance.used >= 0 && balance.reserved >= 0 && balance.used + balance.reserved <= 5400, 'transition never overdraws account')
    }
    check(state === r.status, 'final state matches transition history')
    if (ACTIVE_STATES.includes(r.status)) for (const d of r.days.filter(d => d.charged > 0)) {
      const key = `${r.employee}:${d.date}`
      check(!occupied.has(key), 'one active request per date'); occupied.add(key)
    }
  }
  return { people: f.people.length, activePeople: 500, accounts: f.accounts.length, requests: f.requests.length, days: 60000, occupancy: occupied.size,
    annualGrants: 1500, ledger: 22000, events, attempts, decisions, reversals, peakCommittedMinutes, maxCommittedMinutes: Math.max(...[...balances.values()].map(a => a.used + a.reserved)),
    states: STATES, materializedInputHash: sha256(f), fictionalUuidHash: sha256([...f.people, ...f.accounts, ...f.memberships, ...f.roster, ...f.grants, ...f.requests].map(r => r.id)) }
}
