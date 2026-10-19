import { describe, expect, test } from 'vitest'
import { decodeCataloguePage, decodeProcurementAccessV2, parseCataloguePayload, parseCatalogueReceipt, parseCatalogueRecovery, parseCatalogueRow, parseCatalogueVersion } from '../../src/lib/catalogue/validation'

const actor = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'
const request = '00000000-0000-4000-8000-000000000003'
const timestamp = '2026-10-14T05:00:00Z'
const state = { catalog_version: '9007199254740993', is_enabled: true }
const receipt = { version: 1, request_id: request, actor_id: actor, operation: 'edit', kind: 'product', id,
  before: state, after: { ...state, catalog_version: '9007199254740994' }, committed_at: timestamp }
const binding = { request_id: request, actor_id: actor, operation: 'edit', kind: 'product', id, expected_version: state.catalog_version }
const access = { version: 2, as_of: timestamp, actor_id: actor, role: 'co_admin', customer_create: true,
  customer_edit: true, customer_delete: true, product_create: true, product_edit: true, product_delete: true,
  customer_set_enabled: true, product_set_enabled: true, customer_delete_mode: 'guarded', product_delete_mode: 'guarded' }
const product = { id, name: 'Product', sku: 'SKU-1', size: null, unit_price: null, harga_pokok: 0,
  luar_kota: null, dalam_kota: 25.5, depo_bangunan: null, ...state }
const customer = { id, name: 'Customer', address: null, city: null, phone: null, email: null,
  pricing_tier: 'others', customer_category: null, ...state }
const pageArgs = { kind: 'product', purpose: 'catalogue', status: 'all', search: '', page: 1, page_size: 10 } as const
const page = { version: 1, actor_id: actor, role: 'co_admin', ...pageArgs, total_count: '1', rows: [product] }

describe('catalogue wire boundaries', () => {
  test.each(['1', '9007199254740993', '9223372036854775807'])('keeps version %s as exact text', value => expect(parseCatalogueVersion(value)).toBe(value))
  test.each([undefined, null, 1, 9007199254740993, '0', '-1', '+1', '01', '1.0', '1e3', ' 1', '1 ', '', '9223372036854775808'])('rejects invalid version %#', value => expect(() => parseCatalogueVersion(value)).toThrow())
  test('binds a strict receipt to request, actor, operation, kind and target', () => {
    expect(parseCatalogueReceipt(receipt, binding)).toEqual(receipt)
    expect(parseCatalogueRecovery({ status: 'committed', receipt }, binding)).toEqual({ status: 'committed', receipt })
  })
  test.each([{ request_id: id }, { actor_id: id }, { operation: 'set_enabled' }, { kind: 'customer' }, { id: actor },
    { version: '1' }, { id: 'wrong' }, { before: { ...state, catalog_version: 9007199254740993 } },
    { before: { ...state, catalog_version: '1' } }, { after: { ...state, catalog_version: '9007199254740995' } },
    { after: { ...state, is_enabled: false } }, { committed_at: '2026-02-30T12:00:00Z' }, { unexpected: true },
  ])('rejects malformed or mismatched receipts %#', patch => expect(() => parseCatalogueReceipt({ ...receipt, ...patch }, binding)).toThrow())
  test('requires operation-specific before and after state', () => {
    const created = { ...receipt, operation: 'create', before: null, after: { catalog_version: '1', is_enabled: true } }
    expect(parseCatalogueReceipt(created).before).toBeNull()
    expect(() => parseCatalogueReceipt({ ...created, before: state })).toThrow()
    expect(() => parseCatalogueReceipt({ ...created, after: null })).toThrow()
    const deleted = { ...receipt, operation: 'delete_unused', after: null }
    expect(parseCatalogueReceipt(deleted).after).toBeNull()
    expect(() => parseCatalogueReceipt({ ...deleted, before: null })).toThrow()
    expect(() => parseCatalogueReceipt({ ...deleted, after: state })).toThrow()
    expect(parseCatalogueReceipt({ ...receipt, after: state }).after).toEqual(state)
  })
  test('binds desired enabled state and requires exactly one version step for change', () => {
    const enabled = { ...receipt, operation: 'set_enabled', after: { catalog_version: '9007199254740994', is_enabled: false } }
    const expected = { ...binding, operation: 'set_enabled', is_enabled: false }
    expect(parseCatalogueReceipt(enabled, expected)).toEqual(enabled)
    expect(() => parseCatalogueReceipt(enabled, { ...expected, is_enabled: true })).toThrow()
    expect(() => parseCatalogueReceipt({ ...enabled, after: { ...enabled.after, catalog_version: state.catalog_version } }, expected)).toThrow()
    expect(() => parseCatalogueReceipt({ ...enabled, after: { ...state, catalog_version: '9007199254740994' } })).toThrow()
  })
  test.each([{}, { status: 'pending' }, { status: 'unknown', receipt }, { status: 'abandoned', operation: 'edit' },
    { status: 'committed' }, { status: 'committed', receipt, operation: 'edit' }])('rejects invalid recovery envelope %#', value => expect(() => parseCatalogueRecovery(value, binding)).toThrow())
  test.each(['unknown', 'abandoned'] as const)('accepts exact %s recovery', status => expect(parseCatalogueRecovery({ status }, binding)).toEqual({ status }))
  test('strict v2 modes preserve individual grants and bind current actor and role', () => {
    expect(decodeProcurementAccessV2(access, { actorId: actor, role: 'co_admin' })).toEqual(access)
    expect(decodeProcurementAccessV2({ ...access, product_edit: false, product_set_enabled: false, product_delete: false, product_delete_mode: 'none' }).product_edit).toBe(false)
    expect(decodeProcurementAccessV2({ ...access, role: 'po_admin', customer_delete: false, customer_delete_mode: 'none', product_delete_mode: 'direct' }).product_delete).toBe(true)
    expect(() => decodeProcurementAccessV2(access, { actorId: id, role: 'co_admin' })).toThrow()
    expect(() => decodeProcurementAccessV2(access, { actorId: actor, role: 'po_admin' })).toThrow()
    expect(decodeProcurementAccessV2({ ...access, role: 'executive', customer_delete: false, customer_delete_mode: 'none',
      product_edit: false, product_set_enabled: false, product_delete_mode: 'direct' }).product_delete_mode).toBe('direct')
  })
  test.each([{ extra: true }, { version: 1 }, { actor_id: 'invalid' }, { role: 'anonymous' }, { role: 'sales_person' },
    { as_of: 'now' }, { customer_create: 1 }, { customer_delete: false }, { customer_delete_mode: 'direct' },
    { product_delete_mode: 'direct' }, { product_delete_mode: 'missing' }, { role: 'po_admin' }, { role: 'executive' },
    { product_set_enabled: false }, { product_edit: false },
  ])('rejects invalid capability %#', patch => expect(() => decodeProcurementAccessV2({ ...access, ...patch })).toThrow())
  test('requires status and exact version on rows while retaining zero and null prices', () => {
    expect(parseCatalogueRow('product', product)).toEqual(product)
    expect(parseCatalogueRow('customer', customer)).toEqual(customer)
    const { is_enabled: _enabled, ...missingStatus } = product
    expect(() => parseCatalogueRow('product', missingStatus)).toThrow()
    expect(() => parseCatalogueRow('product', { ...product, catalog_version: 1 })).toThrow()
    expect(() => parseCatalogueRow('product', { ...product, lifetime_state: 'unused' })).toThrow()
    expect(() => parseCatalogueRow('customer', { ...customer, customer_category: 'unknown' })).toThrow()
  })
  test('pages bind the request and reject duplicate, incomplete and misfiltered rows', () => {
    const identity = { backend: 'synthetic', actorId: actor, role: 'co_admin' }
    expect(decodeCataloguePage(page, identity, pageArgs)).toEqual(page)
    for (const patch of [{ total_count: '2' }, { total_count: 1 }, { rows: [] }, { rows: [product, product], total_count: '2' },
      { actor_id: id }, { role: 'po_admin' }, { search: 'different' }, { status: 'enabled' }, { extra: true }]) {
      expect(() => decodeCataloguePage({ ...page, ...patch }, identity, pageArgs)).toThrow()
    }
    expect(() => decodeCataloguePage({ ...page, purpose: 'enabled-for-order', status: 'enabled', rows: [{ ...product, is_enabled: false }] }, identity,
      { ...pageArgs, purpose: 'enabled-for-order', status: 'enabled' })).toThrow()
  })
  test('zero visible rows and bigint totals are explicit valid pages without enabled defaults', () => {
    const identity = { backend: 'synthetic', actorId: actor, role: 'co_admin' }
    expect(decodeCataloguePage({ ...page, total_count: '0', rows: [] }, identity, pageArgs).rows).toEqual([])
    const one = { ...pageArgs, page_size: 1 }
    expect(decodeCataloguePage({ ...page, ...one, total_count: '9007199254740993' }, identity, one).total_count).toBe('9007199254740993')
    expect(() => decodeCataloguePage({ ...page, ...one, total_count: '9223372036854775808' }, identity, one)).toThrow()
    expect(() => decodeCataloguePage({ ...page, ...one, total_count: '01' }, identity, one)).toThrow()
  })
  test.each([{ page: 0 }, { page: 1.5 }, { page: 2147483648 }, { page_size: 0 }, { page_size: 251 },
    { purpose: 'all-for-history', status: 'enabled' }, { purpose: 'enabled-for-order', status: 'all' }])('invalid requested pagination or purpose fails closed %#', patch => {
    const args: any = { ...pageArgs, ...patch }
    expect(() => decodeCataloguePage({ ...page, ...patch }, { backend: 'synthetic', actorId: actor, role: 'co_admin' }, args)).toThrow()
  })
  test('payloads reject server-owned fields without normalizing form text or changing prices', () => {
    const values = { name: ' Kept spacing ', sku: 'sku-Kept', size: null, harga_pokok: 0, luar_kota: null, dalam_kota: 25.5, depo_bangunan: null }
    expect(parseCataloguePayload('create', { kind: 'product', values })).toEqual({ kind: 'product', values })
    for (const extra of [{ id }, { is_enabled: true }, { catalog_version: '1' }, { lifetime_state: 'unused' }, { unit_price: 12 }]) {
      expect(() => parseCataloguePayload('create', { kind: 'product', values: { ...values, ...extra } })).toThrow()
    }
    expect(() => parseCataloguePayload('create', { kind: 'product', id, values })).toThrow()
    expect(() => parseCataloguePayload('edit', { kind: 'product', id, expected_version: '1', values: {} })).toThrow()
    expect(parseCataloguePayload('edit', { kind: 'product', id, expected_version: '1', values: { name: 'Updated' } })).toMatchObject({ values: { name: 'Updated' } })
    expect(() => parseCataloguePayload('delete_unused', { kind: 'product', id, expected_version: 1 })).toThrow()
    expect(() => parseCataloguePayload('set_enabled', { kind: 'product', id, expected_version: '1', is_enabled: 'false' })).toThrow()
    const { id: _id, is_enabled: _status, catalog_version: _version, ...legacyValues } = customer
    expect(() => parseCataloguePayload('create', { kind: 'customer', values: legacyValues })).toThrow()
    expect(parseCataloguePayload('edit', { kind: 'customer', id, expected_version: '1', values: { customer_category: null } })).toMatchObject({ values: { customer_category: null } })
    for (const harga_pokok of [-1, NaN, Infinity, 1.001, '1', 1000000000000]) {
      expect(() => parseCataloguePayload('create', { kind: 'product', values: { ...values, harga_pokok } })).toThrow()
    }
  })
})
