import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
const source = (path: string) => readFileSync(`${process.cwd()}/src/${path}`, 'utf8')
const ui = ['pages/athel/PONew.tsx', 'pages/athel/POEdit.tsx', 'pages/athel/CustomerList.tsx', 'pages/girard/GirardCustomers.tsx', 'pages/athel/ProductList.tsx', 'pages/athel/Promotions.tsx', 'pages/athel/co/COForm.tsx']
test.each(ui)('%s exposes no tier controls, catalogue price autofill or tier help', path => {
 const text = source(path)
 expect(text).not.toMatch(/Tier [Hh]arga|Tier harga|Harga per Tier|Harga baru mengikuti tier|resolveCatalogPrice\(|resolveCOCatalogPrice\(/)
})
test('PO details keep the immutable sales attribution as a compact Sales summary', () => {
 const detail = source('pages/athel/PODetail.tsx')
 expect(detail).toContain('Sales:')
 expect(detail).not.toContain('aria-label="Kredit salesperson"')
 expect(detail).toContain('sales_person_id_at_creation')
})
