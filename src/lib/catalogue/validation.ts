import { isValidPrice, PRICE_TIERS } from '../catalogPricing'
import { parseCustomerCategory } from '../customerCategory'
import type {
  CatalogueCount, CatalogueIdentity, CatalogueKind, CatalogueOperation, CatalogueOperationPayloads,
  CataloguePage, CataloguePageArgs, CatalogueReceipt, CatalogueReceiptBinding, CatalogueRecovery,
  CatalogueRequestBinding, CatalogueRow, CatalogueState, DecimalVersion, ProcurementAccessV2,
} from './contracts'

export class CatalogueValidationError extends Error {
  readonly code = 'CATALOG_INVALID_RESPONSE'
  constructor(path: string) {
    super(`Data katalog tidak lengkap atau tidak valid: ${path}`)
    this.name = 'CatalogueValidationError'
  }
}
export function invalidCatalogue(path: string): never { throw new CatalogueValidationError(path) }
export function catalogueRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidCatalogue('object')
  return value as Record<string, unknown>
}
export function exactCatalogueFields(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const row = catalogueRecord(value)
  if (Object.keys(row).length !== fields.length || fields.some(key => !Object.hasOwn(row, key))) invalidCatalogue('fields')
  return row
}
export function parseCatalogueUUID(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)) invalidCatalogue('UUID')
  return value
}
export function parseCatalogueText(value: unknown): string {
  if (typeof value !== 'string') invalidCatalogue('text')
  return value
}
export function parseCatalogueBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalidCatalogue('boolean')
  return value
}
export function catalogueEnum<const T extends readonly string[]>(values: T, value: unknown): T[number] {
  const text = parseCatalogueText(value)
  if (!values.includes(text)) invalidCatalogue('enum')
  return text as T[number]
}
const MAX_BIGINT = 9223372036854775807n
export function parseCatalogueVersion(value: unknown): DecimalVersion {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || value.length > 19 || BigInt(value) > MAX_BIGINT) invalidCatalogue('catalog_version')
  return value as DecimalVersion
}
function parseCount(value: unknown): CatalogueCount {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 19 || BigInt(value) > MAX_BIGINT) invalidCatalogue('total_count')
  return value as CatalogueCount
}
function timestamp(value: unknown): string {
  const text = parseCatalogueText(value)
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(text)
    || !Number.isFinite(Date.parse(text)) || new Date(`${text.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== text.slice(0, 10)) invalidCatalogue('timestamp')
  return text
}
const kinds = ['customer', 'product'] as const
const operations = ['create', 'edit', 'set_enabled', 'delete_unused'] as const
const maintainerRoles = ['co_admin', 'po_admin', 'executive'] as const
const roles = [...maintainerRoles, 'sales_person', 'sales_manager', 'sales_head'] as const
export function parseCatalogueState(value: unknown): CatalogueState {
  const row = exactCatalogueFields(value, ['catalog_version', 'is_enabled'])
  return { catalog_version: parseCatalogueVersion(row.catalog_version), is_enabled: parseCatalogueBoolean(row.is_enabled) }
}
export function parseCatalogueRequestBinding(value: unknown): CatalogueRequestBinding {
  const row = catalogueRecord(value), operation = catalogueEnum(operations, row.operation), kind = catalogueEnum(kinds, row.kind)
  const fields = operation === 'create' ? ['operation', 'kind'] : ['operation', 'kind', 'id', 'expected_version', ...(operation === 'set_enabled' ? ['is_enabled'] : [])]
  exactCatalogueFields(row, fields)
  if (operation === 'create') return { operation, kind }
  const target = { kind, id: parseCatalogueUUID(row.id), expected_version: parseCatalogueVersion(row.expected_version) }
  return operation === 'set_enabled' ? { operation, ...target, is_enabled: parseCatalogueBoolean(row.is_enabled) } : { operation, ...target }
}
export function parseCatalogueReceipt(value: unknown, expected?: CatalogueReceiptBinding): CatalogueReceipt {
  const row = exactCatalogueFields(value, ['version', 'request_id', 'actor_id', 'operation', 'kind', 'id', 'before', 'after', 'committed_at'])
  if (row.version !== 1) invalidCatalogue('receipt version')
  const receipt: CatalogueReceipt = { version: 1, request_id: parseCatalogueUUID(row.request_id), actor_id: parseCatalogueUUID(row.actor_id),
    operation: catalogueEnum(operations, row.operation), kind: catalogueEnum(kinds, row.kind), id: parseCatalogueUUID(row.id),
    before: row.before === null ? null : parseCatalogueState(row.before), after: row.after === null ? null : parseCatalogueState(row.after), committed_at: timestamp(row.committed_at) }
  const { operation, before, after } = receipt
  if (operation === 'create') {
    if (before !== null || after === null || !after.is_enabled || after.catalog_version !== '1') invalidCatalogue('create state')
  } else if (operation === 'delete_unused') {
    if (before === null || after !== null) invalidCatalogue('delete state')
  } else {
    if (before === null || after === null) invalidCatalogue('mutation state')
    const step = BigInt(after.catalog_version) - BigInt(before.catalog_version)
    if (operation === 'edit' ? before.is_enabled !== after.is_enabled || (step !== 0n && step !== 1n)
      : step !== (before.is_enabled === after.is_enabled ? 0n : 1n)) invalidCatalogue('state transition')
  }
  if (expected) {
    const { actor_id, request_id, ...rawBinding } = expected
    const binding = parseCatalogueRequestBinding(rawBinding)
    if (receipt.actor_id !== parseCatalogueUUID(actor_id) || receipt.request_id !== parseCatalogueUUID(request_id)
      || receipt.operation !== binding.operation || receipt.kind !== binding.kind) invalidCatalogue('receipt identity')
    if (binding.operation !== 'create' && (receipt.id !== binding.id || before?.catalog_version !== binding.expected_version)) invalidCatalogue('receipt target')
    if (binding.operation === 'set_enabled' && after?.is_enabled !== binding.is_enabled) invalidCatalogue('desired state')
  }
  return receipt
}
export function parseCatalogueRecovery(value: unknown, expected?: CatalogueReceiptBinding): CatalogueRecovery {
  const row = catalogueRecord(value)
  if (row.status === 'committed') {
    exactCatalogueFields(row, ['status', 'receipt'])
    return { status: 'committed', receipt: parseCatalogueReceipt(row.receipt, expected) }
  }
  exactCatalogueFields(row, ['status'])
  return { status: catalogueEnum(['unknown', 'abandoned'] as const, row.status) }
}
const capabilities = ['customer_create', 'customer_edit', 'customer_delete', 'product_create', 'product_edit', 'product_delete', 'customer_set_enabled', 'product_set_enabled'] as const
export function decodeProcurementAccessV2(value: unknown, expected?: Pick<CatalogueIdentity, 'actorId' | 'role'>): ProcurementAccessV2 {
  const row = exactCatalogueFields(value, ['version', 'as_of', 'actor_id', 'role', ...capabilities, 'customer_delete_mode', 'product_delete_mode'])
  if (row.version !== 2) invalidCatalogue('capability version')
  const actor = parseCatalogueUUID(row.actor_id), role = catalogueEnum(maintainerRoles, row.role)
  timestamp(row.as_of)
  capabilities.forEach(key => parseCatalogueBoolean(row[key]))
  for (const kind of kinds) {
    const mode = catalogueEnum(['none', 'guarded', 'direct'] as const, row[`${kind}_delete_mode`])
    if (row[`${kind}_delete`] !== (mode !== 'none') || row[`${kind}_set_enabled`] !== row[`${kind}_edit`]) invalidCatalogue('capability pairing')
    if (role === 'co_admin' ? mode !== (row[`${kind}_edit`] ? 'guarded' : 'none')
      : kind === 'customer' ? mode !== 'none' : mode === 'guarded') invalidCatalogue('delete authority')
  }
  if (expected && (actor !== expected.actorId || role !== expected.role)) invalidCatalogue('current authority')
  return { ...row } as unknown as ProcurementAccessV2
}
const customerFields = ['name', 'address', 'city', 'phone', 'email', 'pricing_tier', 'customer_category'] as const
const productFields = ['name', 'sku', 'size', ...PRICE_TIERS] as const
function valueField(kind: CatalogueKind, key: string, value: unknown, allowUnclassified: boolean): unknown {
  if (kind === 'customer') {
    if (key === 'customer_category') return parseCustomerCategory(value, { allowUnclassified })
    if (key === 'pricing_tier') return catalogueEnum([...PRICE_TIERS, 'others'] as const, value)
    if (key !== 'name' && value === null) return null
  } else {
    if (PRICE_TIERS.includes(key as typeof PRICE_TIERS[number]) || key === 'unit_price') {
      if (value === null) return null
      if (typeof value !== 'number' || !isValidPrice(value)) invalidCatalogue('price')
      return value
    }
    if (key === 'size' && value === null) return null
  }
  return parseCatalogueText(value)
}
export function parseCatalogueRow<K extends CatalogueKind>(kind: K, value: unknown): CatalogueRow<K> {
  catalogueEnum(kinds, kind)
  const fields = kind === 'customer' ? customerFields : [...productFields, 'unit_price']
  const row = exactCatalogueFields(value, ['id', ...fields, 'is_enabled', 'catalog_version'])
  const values = Object.fromEntries(fields.map(key => [key, valueField(kind, key, row[key], true)]))
  return { ...values, id: parseCatalogueUUID(row.id), is_enabled: parseCatalogueBoolean(row.is_enabled), catalog_version: parseCatalogueVersion(row.catalog_version) } as CatalogueRow<K>
}
export function parseCataloguePayload<K extends CatalogueOperation>(operation: K, value: unknown): CatalogueOperationPayloads[K] {
  catalogueEnum(operations, operation)
  const row = catalogueRecord(value), kind = catalogueEnum(kinds, row.kind)
  const common = operation === 'create' ? ['kind'] : ['kind', 'id', 'expected_version']
  const valuesOperation = operation === 'create' || operation === 'edit'
  exactCatalogueFields(row, [...common, ...(valuesOperation ? ['values'] : operation === 'set_enabled' ? ['is_enabled'] : [])])
  const target = operation === 'create' ? { kind } : { kind, id: parseCatalogueUUID(row.id), expected_version: parseCatalogueVersion(row.expected_version) }
  if (!valuesOperation) return { ...target, ...(operation === 'set_enabled' ? { is_enabled: parseCatalogueBoolean(row.is_enabled) } : {}) } as CatalogueOperationPayloads[K]
  const input = catalogueRecord(row.values), fields = kind === 'customer' ? customerFields : productFields
  if (!Object.keys(input).length || Object.keys(input).some(key => !(fields as readonly string[]).includes(key))) invalidCatalogue('values fields')
  if (operation === 'create') exactCatalogueFields(input, fields)
  const values = Object.fromEntries(Object.entries(input).map(([key, item]) => {
    const parsed = valueField(kind, key, item, operation === 'edit')
    if ((key === 'name' || key === 'sku') && !(parsed as string).trim()) invalidCatalogue(key)
    return [key, parsed]
  }))
  return { ...target, values } as CatalogueOperationPayloads[K]
}
export function parseCataloguePageArgs<K extends CatalogueKind>(value: CataloguePageArgs<K>): CataloguePageArgs<K> {
  const row = exactCatalogueFields(value, ['kind', 'purpose', 'status', 'search', 'page', 'page_size'])
  const kind = catalogueEnum(kinds, row.kind) as K, purpose = catalogueEnum(['enabled-for-order', 'all-for-history', 'catalogue'] as const, row.purpose)
  const status = catalogueEnum(['all', 'enabled', 'disabled'] as const, row.status), search = parseCatalogueText(row.search)
  if (purpose === 'enabled-for-order' && status !== 'enabled' || purpose === 'all-for-history' && status !== 'all') invalidCatalogue('read purpose')
  const { page, page_size } = row
  if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 || page > 2147483647
    || typeof page_size !== 'number' || !Number.isInteger(page_size) || page_size < 1 || page_size > 250) invalidCatalogue('pagination')
  return { kind, purpose, status, search, page, page_size }
}
export function decodeCataloguePage<K extends CatalogueKind>(value: unknown, identity: CatalogueIdentity, expected: CataloguePageArgs<K>): CataloguePage<K> {
  const args = parseCataloguePageArgs(expected)
  const row = exactCatalogueFields(value, ['version', 'actor_id', 'role', 'kind', 'purpose', 'status', 'search', 'page', 'page_size', 'total_count', 'rows'])
  if (row.version !== 1) invalidCatalogue('page version')
  const actor = parseCatalogueUUID(row.actor_id), role = catalogueEnum(roles, row.role)
  if (actor !== identity.actorId || role !== identity.role || Object.entries(args).some(([key, item]) => row[key] !== item)) invalidCatalogue('page identity')
  const total = parseCount(row.total_count), offset = BigInt(args.page - 1) * BigInt(args.page_size)
  const remaining = BigInt(total) > offset ? BigInt(total) - offset : 0n
  const expectedLength = remaining > BigInt(args.page_size) ? BigInt(args.page_size) : remaining
  if (!Array.isArray(row.rows) || BigInt(row.rows.length) !== expectedLength) invalidCatalogue('page completeness')
  const rows = row.rows.map(item => parseCatalogueRow(args.kind, item))
  rows.forEach((item, index) => {
    if (index > 0 && rows[index - 1].id >= item.id) invalidCatalogue('row order or duplicate')
    if (args.status === 'enabled' && !item.is_enabled || args.status === 'disabled' && item.is_enabled) invalidCatalogue('row status')
  })
  return { version: 1, actor_id: actor, role, ...args, total_count: total, rows }
}
