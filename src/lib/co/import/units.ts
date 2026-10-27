import type { Version } from '../contracts'
import { invalid, parseUUID, parseVersion, parseTimestamp, parseText, record } from '../validation'
export type COStockKeyUnit = {
  customerId: string
  stockKeyId: string
} & ({ state: 'unknown'; declaration: null } | {
  state: 'declared'
  declaration: { id: string; version: Version; unit: string; declaredBy: string; declaredAt: string; reason: string }
})
export type UnitDeclaration = {
  customer_id: string; stock_key_id: string; expected_customer_version: Version
  expected_unit_version: null; unit: string; reason: string; confirmed: true
}
export type UnitReceipt = {
  id: string; operation: 'declare_stock_key_unit'; version: Version; customer_id: string; customer_version: Version
}
function exact(value: unknown, keys: string[]) {
  const v = record(value)
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) invalid('unit object')
  const own = Reflect.ownKeys(v)
  if (own.length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) invalid('unit fields')
  for (const key of own) {
    const d = Object.getOwnPropertyDescriptor(v, key)!
    if (typeof key !== 'string' || !keys.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value')) invalid('unit fields')
  }
  return v
}
function denseArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 1000) invalid('unit array')
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1) invalid('unit dense array')
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i))
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) invalid('unit array entry')
  }
  return value
}
function unit(value: unknown) {
  const text = parseText(value)
  if (/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) invalid('unit Unicode')
  if (text !== text.trim() || text.length < 1 || text.length > 128 || /[\x00-\x1f\x7f]/.test(text)) invalid('unit label')
  return text
}
function reason(value: unknown) {
  const text = parseText(value)
  if (/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) invalid('unit Unicode')
  if (!text.trim() || text.length > 2000) invalid('unit reason')
  return text
}
export function decodeUnitDeclaration(value: unknown): UnitDeclaration {
  const v = exact(value, ['customer_id', 'stock_key_id', 'expected_customer_version', 'expected_unit_version', 'unit', 'reason', 'confirmed'])
  if (v.confirmed !== true || v.expected_unit_version !== null) invalid('first unit declaration')
  return { customer_id: parseUUID(v.customer_id), stock_key_id: parseUUID(v.stock_key_id), expected_customer_version: parseVersion(v.expected_customer_version), expected_unit_version: null, unit: unit(v.unit), reason: reason(v.reason), confirmed: true }
}
export function decodeUnitReceipt(value: unknown): UnitReceipt {
  const v = exact(value, ['id', 'operation', 'version', 'customer_id', 'customer_version'])
  if (v.operation !== 'declare_stock_key_unit' || v.version !== '1') invalid('unit receipt')
  return { id: parseUUID(v.id), operation: 'declare_stock_key_unit', version: parseVersion(v.version), customer_id: parseUUID(v.customer_id), customer_version: parseVersion(v.customer_version) }
}
/** Read response is bound to the exact requested customer, ordered keys and version. */
export function decodeStockKeyUnits(value: unknown, customerId: string, stockKeyIds: string[], expectedVersion: string): { customerVersion: Version; rows: COStockKeyUnit[] } {
  parseUUID(customerId)
  parseVersion(expectedVersion)
  denseArray(stockKeyIds)
  if (!stockKeyIds.length || stockKeyIds.length > 1000 || new Set(stockKeyIds).size !== stockKeyIds.length) invalid('unit read keys')
  stockKeyIds.forEach(parseUUID)
  const v = exact(value, ['customerVersion', 'rows'])
  if (v.customerVersion !== expectedVersion || !Array.isArray(v.rows) || v.rows.length !== stockKeyIds.length) invalid('unit read binding')
  denseArray(v.rows)
  const rows: COStockKeyUnit[] = []
  for (let i = 0; i < stockKeyIds.length; i++) {
    const row = exact(v.rows[i], ['customerId', 'stockKeyId', 'state', 'declaration'])
    if (row.customerId !== customerId || row.stockKeyId !== stockKeyIds[i]) invalid('unit identity')
    if (row.state === 'unknown') {
      if (row.declaration !== null) invalid('unknown unit')
      rows.push({ customerId, stockKeyId: stockKeyIds[i], state: 'unknown', declaration: null })
    } else {
      if (row.state !== 'declared') invalid('unit state')
      const d = exact(row.declaration, ['id', 'version', 'unit', 'declaredBy', 'declaredAt', 'reason'])
      if (d.version !== '1') invalid('immutable first declaration')
      rows.push({ customerId, stockKeyId: stockKeyIds[i], state: 'declared', declaration: {
        id: parseUUID(d.id), version: parseVersion(d.version), unit: unit(d.unit), declaredBy: parseUUID(d.declaredBy), declaredAt: parseTimestamp(d.declaredAt), reason: reason(d.reason),
      } })
    }
  }
  return { customerVersion: parseVersion(v.customerVersion), rows }
}
