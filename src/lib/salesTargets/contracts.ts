/** New monetary targets are deliberately separate from legacy sales_targets. */
export const METRICS = ['po_order_value', 'po_delivery_value', 'co_sale_value'] as const
export type Metric = typeof METRICS[number]
export type Money = string
export type PlanningRequest = { month: string; managerId: string }
export type MonthValue = { month: string; amount: Money | null; quality: 'complete' | 'missing' | 'not_applicable' }
export type BaselineCell = { metric: Metric; months: MonthValue[]; contextMonths: MonthValue[]; complete: boolean; baseline: Money | null; warningCodes: string[] }
export type BaselineCustomer = { customerId: string; name: string; cells: BaselineCell[] }
export type BaselinePerson = { personId: string; name: string; ownership: 'direct_report' | 'exclusive_manager'; customers: BaselineCustomer[] }
export type TargetBaseline = PlanningRequest & { schemaVersion: 1; rosterHash: string; currency: 'IDR'; people: BaselinePerson[]; warnings: string[] }
export type TargetLine = { personId: string; metric: Metric; amount: Money | null; applicability: 'target' | 'not_applicable'; reason: string | null }
export type PlanState = 'draft' | 'submitted' | 'returned' | 'published' | 'superseded'
export type TargetPlan = PlanningRequest & { id: string; version: number; state: PlanState; rosterHash: string; currency: 'IDR'; lines: TargetLine[]; proposedBy: string; publishedBy: string | null; publishedAt: string | null; warnings: string[]; previousPlanId?: string | null; returnReason?: string | null; baselineSnapshot?: TargetBaseline | null; auditEvents?: TargetAuditEvent[]; auditEventsTruncated?: boolean }
export type TargetAuditSnapshot = { state: PlanState; version: number; lines: TargetLine[]; people: { personId: string; name: string }[] }
export type TargetAuditEvent = { id: string; operation: TargetOperation | 'supersede'; actorId: string; actorName: string; occurredAt: string; reason: string | null; before: TargetAuditSnapshot | null; after: TargetAuditSnapshot }
export type TargetOperation = 'save_draft' | 'submit' | 'return' | 'approve_publish' | 'propose_revision'
export type TargetCommand = { requestId: string; operation: TargetOperation; payload: { planId?: string; expectedVersion: number | null; month?: string; managerId?: string; rosterHash?: string; lines?: TargetLine[]; reason?: string } }
export type CommandReceipt = { status: 'committed'; requestId: string; plan: TargetPlan }
export type ReconcileReceipt = CommandReceipt | { status: 'not_found' | 'abandoned'; requestId: string }
export type TargetActor = { id: string; role: string; active: boolean }
export type TeamChoice = { managerId: string; name: string }

type RecordValue = Record<string, unknown>
function invalid(path: string): never { throw new Error(`Data target tidak valid: ${path}`) }
function record(value: unknown, path: string, keys: string[], optional: string[] = []): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path)
  const row = value as RecordValue
  if (keys.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !keys.includes(key) && !optional.includes(key))) invalid(`${path}.fields`)
  return row
}
function text(value: unknown, path: string): string { if (typeof value !== 'string' || !value.trim()) invalid(path); return value }
export function validUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) }
function uuid(value: unknown, path: string): void { if (!validUuid(value)) invalid(path) }
export function validMonth(value: unknown): value is string { return typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])-01$/.test(value) }
function month(value: unknown, path: string): void { if (!validMonth(value)) invalid(path) }
export function validMoney(value: unknown): value is Money { return typeof value === 'string' && /^(0|[1-9]\d{0,23})(?:\.\d{1,2})?$/.test(value) }
function money(value: unknown, path: string): void { if (!validMoney(value)) invalid(path) }
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) invalid(path); return value }
function strings(value: unknown, path: string): void { array(value, path).forEach(item => text(item, path)) }
function metric(value: unknown): value is Metric { return METRICS.includes(value as Metric) }
function sequence(values: MonthValue[]): boolean {
  return values.every((value, index) => !index || (() => { const previous = new Date(`${values[index - 1].month}T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() + 1); return previous.toISOString().slice(0, 10) === value.month })())
}
function monthValues(value: unknown, path: string, count: number): MonthValue[] {
  const list = array(value, path)
  if (list.length !== count) invalid(`${path}.count`)
  for (const item of list) {
    const row = record(item, path, ['month', 'amount', 'quality'])
    month(row.month, `${path}.month`)
    if (!['complete', 'missing', 'not_applicable'].includes(String(row.quality))) invalid(`${path}.quality`)
    if (row.amount !== null) money(row.amount, `${path}.amount`)
    if (row.quality === 'complete' && row.amount === null) invalid(`${path}.complete`)
  }
  if (!sequence(list as MonthValue[])) invalid(`${path}.sequence`)
  return list as MonthValue[]
}
function cents(value: Money): bigint { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) }
export function decodeBaseline(request: PlanningRequest, data: unknown): TargetBaseline {
  month(request.month, 'request.month'); uuid(request.managerId, 'request.managerId')
  const root = record(data, 'baseline', ['schemaVersion', 'month', 'managerId', 'rosterHash', 'currency', 'people', 'warnings'])
  if (root.schemaVersion !== 1 || root.currency !== 'IDR') invalid('schema/currency')
  if (root.month !== request.month || root.managerId !== request.managerId) invalid('request.binding')
  text(root.rosterHash, 'rosterHash'); strings(root.warnings, 'warnings')
  const people = new Set<string>(), customers = new Set<string>()
  for (const item of array(root.people, 'people')) {
    const person = record(item, 'person', ['personId', 'name', 'ownership', 'customers'])
    uuid(person.personId, 'personId'); text(person.name, 'person.name')
    if (!['direct_report', 'exclusive_manager'].includes(String(person.ownership))) invalid('ownership')
    if ((person.ownership === 'exclusive_manager') !== (person.personId === request.managerId)) invalid('ownership.manager')
    if (people.has(String(person.personId))) invalid('duplicate person'); people.add(String(person.personId))
    for (const rawCustomer of array(person.customers, 'customers')) {
      const customer = record(rawCustomer, 'customer', ['customerId', 'name', 'cells'])
      uuid(customer.customerId, 'customerId'); text(customer.name, 'customer.name')
      if (customers.has(String(customer.customerId))) invalid('duplicate customer'); customers.add(String(customer.customerId))
      const cells = array(customer.cells, 'cells'), seen = new Set<Metric>()
      if (cells.length !== METRICS.length) invalid('cells.count')
      for (const rawCell of cells) {
        const cell = record(rawCell, 'cell', ['metric', 'months', 'contextMonths', 'complete', 'baseline', 'warningCodes'])
        if (!metric(cell.metric) || seen.has(cell.metric)) invalid('cell.metric'); seen.add(cell.metric)
        const values = monthValues(cell.months, 'months', 3), context = monthValues(cell.contextMonths, 'contextMonths', 6)
        if (values.some((value, index) => (value.month !== context[index + 3].month || value.amount !== context[index + 3].amount || value.quality !== context[index + 3].quality)) || values[2].month >= request.month) invalid('months.binding')
        const complete = values.every(value => value.quality === 'complete' && value.amount !== null)
        if (typeof cell.complete !== 'boolean' || cell.complete !== complete) invalid('cell.complete')
        strings(cell.warningCodes, 'warningCodes')
        if (complete) {
          money(cell.baseline, 'baseline.amount')
          const mean = (values.reduce((sum, value) => sum + cents(value.amount!), 0n) + 1n) / 3n
          if (cents(String(cell.baseline)) !== mean) invalid('baseline.calculation')
        } else if (cell.baseline !== null) invalid('baseline.incomplete')
      }
    }
  }
  return data as TargetBaseline
}
export function decodePlan(data: unknown): TargetPlan {
  const root = record(data, 'plan', ['id', 'month', 'managerId', 'version', 'state', 'rosterHash', 'currency', 'lines', 'proposedBy', 'publishedBy', 'publishedAt', 'warnings'], ['previousPlanId', 'returnReason', 'baselineSnapshot', 'auditEvents', 'auditEventsTruncated'])
  uuid(root.id, 'id'); month(root.month, 'month'); uuid(root.managerId, 'managerId'); uuid(root.proposedBy, 'proposedBy'); text(root.rosterHash, 'rosterHash'); strings(root.warnings, 'warnings')
  if (!Number.isSafeInteger(root.version) || Number(root.version) < 1 || !['draft', 'submitted', 'returned', 'published', 'superseded'].includes(String(root.state)) || root.currency !== 'IDR') invalid('plan state/version/currency')
  if (root.previousPlanId !== undefined && root.previousPlanId !== null) uuid(root.previousPlanId, 'previousPlanId')
  if (root.publishedBy !== null) uuid(root.publishedBy, 'publishedBy')
  if (root.publishedAt !== null && (typeof root.publishedAt !== 'string' || !Number.isFinite(Date.parse(root.publishedAt)))) invalid('publishedAt')
  if (['published', 'superseded'].includes(String(root.state))) {
    if (!root.publishedBy || !root.publishedAt || root.publishedBy === root.proposedBy) invalid('publication.authority')
  } else if (root.publishedBy !== null || root.publishedAt !== null) invalid('unpublished')
  if (root.returnReason !== undefined && root.returnReason !== null && typeof root.returnReason !== 'string') invalid('returnReason')
  if (root.state === 'returned' && (typeof root.returnReason !== 'string' || !root.returnReason.trim())) invalid('returned.feedback')
  const seen = new Set<string>(), personMetrics = new Map<string, number>()
  for (const rawLine of array(root.lines, 'lines')) {
    const line = record(rawLine, 'line', ['personId', 'metric', 'amount', 'applicability', 'reason'])
    uuid(line.personId, 'line.personId')
    if (!metric(line.metric) || !['target', 'not_applicable'].includes(String(line.applicability))) invalid('line.metric/applicability')
    if (line.amount !== null) money(line.amount, 'line.amount')
    if (line.reason !== null && typeof line.reason !== 'string') invalid('line.reason')
    if (line.applicability === 'not_applicable' && line.amount !== null) invalid('line.not_applicable')
    if (root.state !== 'draft' && root.state !== 'returned' && (line.applicability === 'target' ? line.amount === null : !String(line.reason ?? '').trim())) invalid('line.incomplete')
    const key = `${line.personId}:${line.metric}`
    if (seen.has(key)) invalid('duplicate line'); seen.add(key)
    personMetrics.set(String(line.personId), (personMetrics.get(String(line.personId)) ?? 0) + 1)
  }
  if ([...personMetrics.values()].some(count => count !== METRICS.length)) invalid('lines.metric completeness')
  if (['submitted', 'published', 'superseded'].includes(String(root.state)) && !seen.size) invalid('lines.empty publication')
  if (root.baselineSnapshot !== undefined && root.baselineSnapshot !== null) {
    const snapshot = decodeBaseline({ month: String(root.month), managerId: String(root.managerId) }, root.baselineSnapshot)
    if (snapshot.rosterHash !== root.rosterHash || [...personMetrics.keys()].some(person => !snapshot.people.some(item => item.personId === person))) invalid('plan.baseline binding')
    if (['submitted', 'published', 'superseded'].includes(String(root.state)) && snapshot.people.length !== personMetrics.size) invalid('plan.roster completeness')
  }
  if (root.auditEvents !== undefined) {
    decodeAuditEvents(root.auditEvents)
    if (typeof root.auditEventsTruncated !== 'boolean') invalid('auditEventsTruncated')
  } else if (root.auditEventsTruncated !== undefined) invalid('auditEvents.missing')
  return data as TargetPlan
}
export function decodeReceipt(requestId: string, data: unknown): ReconcileReceipt {
  const row = record(data, 'receipt', ['status', 'requestId'], ['plan'])
  if (row.requestId !== requestId) invalid('receipt.binding')
  if (row.status === 'committed') { decodePlan(row.plan); return data as CommandReceipt }
  if (!['not_found', 'abandoned'].includes(String(row.status)) || Object.hasOwn(row, 'plan')) invalid('receipt.status')
  return data as ReconcileReceipt
}
export type TargetPlansRequest = { month: string; page: number; pageSize: number }
export type TargetPlanSummary = Pick<TargetPlan, 'id' | 'month' | 'managerId' | 'version' | 'state' | 'proposedBy' | 'publishedAt'> & { managerName: string }
export type TargetPlansPage = TargetPlansRequest & { schemaVersion: 1; total: number; items: TargetPlanSummary[] }
export function decodePlansPage(request: TargetPlansRequest, data: unknown): TargetPlansPage {
  month(request.month, 'request.month')
  if (!Number.isSafeInteger(request.page) || request.page < 1 || !Number.isSafeInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 100) invalid('request.pagination')
  const root = record(data, 'plans', ['schemaVersion', 'month', 'page', 'pageSize', 'total', 'items'])
  if (root.schemaVersion !== 1 || root.month !== request.month || root.page !== request.page || root.pageSize !== request.pageSize) invalid('plans.binding')
  if (!Number.isSafeInteger(root.total) || Number(root.total) < 0) invalid('plans.total')
  const items = array(root.items, 'plans.items'), ids = new Set<string>()
  if (items.length !== Math.min(request.pageSize, Math.max(0, Number(root.total) - (request.page - 1) * request.pageSize))) invalid('plans.completeness')
  for (const item of items) {
    const row = record(item, 'plans.item', ['id', 'month', 'managerId', 'managerName', 'version', 'state', 'proposedBy', 'publishedAt'])
    uuid(row.id, 'id'); uuid(row.managerId, 'managerId'); uuid(row.proposedBy, 'proposedBy'); text(row.managerName, 'managerName')
    if (row.month !== request.month || !Number.isSafeInteger(row.version) || Number(row.version) < 1 || !['draft', 'submitted', 'returned', 'published', 'superseded'].includes(String(row.state))) invalid('plans.item.state')
    if (ids.has(String(row.id))) invalid('plans.duplicate'); ids.add(String(row.id))
    if (['published', 'superseded'].includes(String(row.state)) ? typeof row.publishedAt !== 'string' || !Number.isFinite(Date.parse(row.publishedAt)) : row.publishedAt !== null) invalid('plans.item.publication')
  }
  return data as TargetPlansPage
}

function decodeAuditSnapshot(data: unknown): TargetAuditSnapshot {
  const root = record(data, 'audit snapshot', ['state', 'version', 'lines', 'people'])
  if (!['draft', 'submitted', 'returned', 'published', 'superseded'].includes(String(root.state)) || !Number.isSafeInteger(root.version) || Number(root.version) < 1) invalid('audit snapshot state/version')
  const people = new Set<string>(), lines = new Set<string>(), personMetrics = new Map<string, number>()
  for (const raw of array(root.people, 'audit people')) {
    const person = record(raw, 'audit person', ['personId', 'name']); uuid(person.personId, 'audit personId'); text(person.name, 'audit person name')
    if (people.has(String(person.personId))) invalid('duplicate audit person'); people.add(String(person.personId))
  }
  for (const raw of array(root.lines, 'audit lines')) {
    const line = record(raw, 'audit line', ['personId', 'metric', 'amount', 'applicability', 'reason'])
    uuid(line.personId, 'audit line personId')
    if (!people.has(String(line.personId)) || !metric(line.metric) || !['target', 'not_applicable'].includes(String(line.applicability))) invalid('audit line binding')
    if (line.amount !== null) money(line.amount, 'audit amount')
    if (line.reason !== null && typeof line.reason !== 'string') invalid('audit line reason')
    if (line.applicability === 'not_applicable' && line.amount !== null) invalid('audit N/A amount')
    const key = `${line.personId}:${line.metric}`
    if (lines.has(key)) invalid('duplicate audit line'); lines.add(key)
    personMetrics.set(String(line.personId), (personMetrics.get(String(line.personId)) ?? 0) + 1)
  }
  if ([...personMetrics.values()].some(count => count !== METRICS.length)) invalid('audit metric completeness')
  return data as TargetAuditSnapshot
}
export function decodeAuditEvents(data: unknown): TargetAuditEvent[] {
  const rows = array(data, 'auditEvents'), seen = new Set<string>()
  if (rows.length > 100) invalid('audit event window')
  for (const raw of rows) {
    const event = record(raw, 'audit event', ['id', 'operation', 'actorId', 'actorName', 'occurredAt', 'reason', 'before', 'after'])
    if (typeof event.id !== 'string' || !/^[1-9][0-9]*$/.test(event.id) || seen.has(event.id)) invalid('audit id')
    seen.add(event.id); uuid(event.actorId, 'audit actorId'); text(event.actorName, 'audit actorName')
    if (!['save_draft', 'submit', 'return', 'approve_publish', 'propose_revision', 'supersede'].includes(String(event.operation))) invalid('audit operation')
    if (typeof event.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(event.occurredAt) || !Number.isFinite(Date.parse(event.occurredAt))) invalid('audit occurredAt')
    if (event.reason !== null && typeof event.reason !== 'string') invalid('audit reason')
    if (event.before !== null) decodeAuditSnapshot(event.before)
    decodeAuditSnapshot(event.after)
  }
  return data as TargetAuditEvent[]
}
