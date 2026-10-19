import assert from 'node:assert/strict'
import { decodeCataloguePage, decodeProcurementAccessV2 } from '../../src/lib/catalogue/validation'
import type { CatalogueIdentity, CataloguePageArgs } from '../../src/lib/catalogue/contracts'

// Invoke only after the producer receipt, successful rollback and current-run
// artifact provenance/source binding are verified. This function does not
// establish provenance and must not be used to certify fabricated JSON.
export function assertActualCatalogueReadSqlOutput(value: unknown): void {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  const result = value as Record<string, unknown>
  assert.deepEqual(Object.keys(result).sort(), ['access', 'format', 'identity', 'pages'])
  assert.equal(result.format, 'catalogue-read-sql-output-v1')
  const identity: CatalogueIdentity = {
    backend: 'https://catalogue.example.invalid',
    actorId: '00000000-0000-4000-8000-000000000101',
    role: 'co_admin',
  }
  assert.deepEqual(result.identity, identity)
  const rawPages = result.pages
  assert.ok(Array.isArray(rawPages))
  assert.equal(rawPages.length, 4)
  const requests: CataloguePageArgs[] = [
    {kind: 'product', purpose: 'all-for-history', status: 'all', search: '', page: 1, page_size: 2},
    {kind: 'product', purpose: 'all-for-history', status: 'all', search: '', page: 2, page_size: 2},
    {kind: 'product', purpose: 'enabled-for-order', status: 'enabled', search: '', page: 1, page_size: 250},
    {kind: 'customer', purpose: 'all-for-history', status: 'all', search: '', page: 1, page_size: 250},
  ]
  const pages = requests.map((request, index) => decodeCataloguePage(rawPages[index], identity, request))
  assert.deepEqual(pages.map(page => page.total_count), ['3', '3', '2', '2'])
  assert.deepEqual(pages.map(page => page.rows.length), [2, 1, 2, 2])
  assert.equal(pages[0].rows[0].catalog_version, '9007199254740993')
  assert.deepEqual([...pages[0].rows, ...pages[1].rows].map(row => row.id), [
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000203',
  ])
  assert.equal(pages[1].rows[0].is_enabled, false)
  assert.ok(pages[2].rows.every(row => row.is_enabled))
  assert.deepEqual(pages[3].rows.map(row => row.is_enabled), [true, false])
  assert.equal(decodeProcurementAccessV2(result.access, identity).version, 2)
}
