import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decodeCataloguePage, decodeProcurementAccessV2 } from '../../src/lib/catalogue/validation'
import type { CatalogueIdentity, CataloguePageArgs } from '../../src/lib/catalogue/contracts'
// Only real SQL output qualifies. No decoded mock or checked-in fabricated JSON
// substitutes for this gate. The source-only worker intentionally leaves it absent.
const outputPath = 'tests/catalogue/fixtures/catalogue-read-sql-output.json'
describe.skipIf(!existsSync(outputPath))('actual SQL output → shared TypeScript decoders', () => {
 test('decodes both kinds, complete pagination, enabled demand and fresh v2 authority', () => {
  const result = JSON.parse(readFileSync(outputPath, 'utf8'))
  expect(result.format).toBe('catalogue-read-sql-output-v1')
  const identity = result.identity as CatalogueIdentity
  expect(result.pages).toHaveLength(4)
  const decoded = result.pages.map((page: any) => {
   const { kind, purpose, status, search, page: number, page_size } = page
   return decodeCataloguePage(page, identity, { kind, purpose, status, search, page: number, page_size } as CataloguePageArgs)
  })
  expect(decoded[0].rows[0].catalog_version).toBe('9007199254740993')
  expect(decoded[0].total_count).toBe('3'); expect(decoded[1].total_count).toBe('3')
  expect(decoded[1].rows[0].is_enabled).toBe(false)
  expect(decoded[2].rows.every((row: any) => row.is_enabled)).toBe(true)
  expect(decoded[3].kind).toBe('customer')
  expect(decodeProcurementAccessV2(result.access, identity).version).toBe(2)
 })
})
