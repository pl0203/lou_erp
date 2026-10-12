import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// These source-contract checks target only the audit's explicit surfaces and
// known token pairs. They do not claim rendered/hover/browser certification.
const source = (file: string) => readFileSync(`src/${file}`, 'utf8')
for (const file of ['pages/athel/POList.tsx', 'pages/athel/PONew.tsx', 'pages/athel/POEdit.tsx', 'pages/athel/SalesOrders.tsx', 'pages/athel/PODetail.tsx', 'pages/girard/GirardCustomerDetail.tsx']) test(`${file} known normal-size error/overdue text uses the legible red token`, () => {
  const text = source(file)
  expect(text.match(/\btext-red-\d{3}\b/g)).not.toContain('text-red-500')
  expect(text).toContain('text-red-700')
})

test('PO detail completion and outstanding quantities retain their conditional meanings with legible tokens', () => {
  const text = source('pages/athel/PODetail.tsx')
  expect(text).toContain('text-sm text-green-800 mt-3 font-medium')
  expect(text).toMatch(/\(outstanding\[item\.id\] \?\? 0\) === 0\s*\? 'text-green-800'\s*: 'text-orange-700'/)
  expect(text).toContain("line.quantity_outstanding === 0 ? 'text-green-800' : 'text-orange-700'")
  expect(text).toContain('✓ Semua jumlah barang sudah tercatat dikirim.')
})

test('promotion pricing label keeps its orange surface and a legible orange text token', () => {
  const text = source('components/SalesOrderItems.tsx')
  expect(text).toContain('item.is_promo &&')
  expect(text).toMatch(/bg-orange-100[^"\n]*text-orange-800">Harga Promosi/)
})

test('reachable dashboard normal-size success percentages retain existing thresholds and use the darker green token', () => {
  const customer = source('pages/girard/CustomerPerformance.tsx')
  const team = source('pages/girard/GirardPerformance.tsx')
  expect(customer).toContain("pct >= 100 ? 'text-green-800'")
  expect(customer).toContain("onTrack ? 'text-green-800' : 'text-red-700'")
  expect(team).toContain("p.visit_rate >= 80 ? 'text-green-800'")
  for (const text of [customer, team]) {
    expect(text).not.toMatch(/text-yellow-600|text-red-500|text-gray-300/)
    expect(text).toContain('text-brand-secondary')
  }
})
