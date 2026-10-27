import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import POImportReview from '../src/components/poImport/POImportReview'
import { parsePODocument } from '../src/lib/poImport/parse'
import { isFinancialReviewIssue, preparePOFormDraft } from '../src/lib/poImport/review'
import type { Product, ReviewDecision } from '../src/lib/poImport/contracts'
import { pricedIndent, token } from './fixtures/po-import-layouts'

afterEach(cleanup)

function ready(currency?: string) {
  const pages = pricedIndent()
  if (currency) pages[0].tokens.push(token(`Currency : ${currency}`, 5, 88, 100, 2))
  const parsed = parsePODocument(pages)
  const customers = [{ id: 'synthetic-customer', name: parsed.buyer.value!, pricing_tier: 'luar_kota' }]
  const products: Product[] = parsed.rows.map((row, index) => ({ id: `synthetic-product-${index}`, sku: row.sku.value!, name: row.name.value!, size: row.uom.value, harga_pokok: 0, luar_kota: Number(row.unitPrice.value), dalam_kota: null, depo_bangunan: null }))
  const decision: ReviewDecision = { customerId: customers[0].id, poNumber: parsed.poNumber.value!, orderDate: parsed.orderDate.value!, expiry: '', notes: '', acknowledgedIssueIds: [], rows: Object.fromEntries(parsed.rows.map((row, index) => [row.id, { productId: products[index].id, manual: false, sku: products[index].sku, name: products[index].name, quantity: row.quantity.value!, unitPrice: row.unitPrice.value, unitConfirmed: true }])) }
  const run = () => preparePOFormDraft(parsed, decision, customers, products)
  decision.acknowledgedIssueIds = run().issues.filter(isFinancialReviewIssue).map(issue => issue.id)
  return { parsed, customers, products, decision, run }
}

test.each([undefined, 'IDR'])('Indonesia business default needs no IDR acknowledgement (%s)', currency => {
  const x = ready(currency)
  expect(x.run().draft).not.toBeNull()
  expect(x.run().draft!.lineItems[0].unit_price).toBe(120000)
  expect(x.run().issues.some(issue => ['currency-unconfirmed', 'currency-unknown'].includes(issue.code))).toBe(false)
  // Preserve source evidence rather than claiming an absent currency was printed.
  expect(x.parsed.currency.value).toBe(currency ?? null)
})

test.each(['USD', 'EUR', 'SGD'])('explicit foreign %s stays a hard blocker, without conversion', currency => {
  const x = ready(currency)
  expect(x.run().draft).toBeNull()
  expect(x.run().issues.some(issue => issue.code === 'foreign-currency' && issue.blocking)).toBe(true)
  expect(x.decision.rows[x.parsed.rows[0].id].unitPrice).toBe('120000')
})

test('review shows the IDR default without an extra currency checkbox', () => {
  const x = ready()
  render(<POImportReview {...x} issues={[]} disabled={false} onChange={vi.fn()} onApply={vi.fn()} />)
  expect(screen.queryByRole('checkbox', { name: /nilai harga dalam IDR/ })).toBeNull()
  expect(screen.getByText(/Mata uang: IDR \(default\)/)).toBeTruthy()
})

test('red Apply summary shows actual customer blocker, not informational SKU warnings', () => {
  const x = ready('IDR')
  x.decision.customerId = ''
  const issues = x.run().issues
  expect(issues.some(issue => issue.code === 'source-sku-review' && !issue.blocking)).toBe(true)
  render(<POImportReview {...x} issues={issues} disabled={false} onChange={vi.fn()} onApply={vi.fn()} />)
  const alert = screen.getByRole('alert')
  expect(within(alert).getByText('Pilih pelanggan dari katalog yang tersedia saat ini.')).toBeTruthy()
  expect(alert.textContent).not.toMatch(/Kode barang sumber/)
})

test('informational source warnings alone do not produce a red error summary', () => {
  const x = ready('IDR')
  expect(x.run().draft).not.toBeNull()
  render(<POImportReview {...x} issues={x.run().issues} disabled={false} onChange={vi.fn()} onApply={vi.fn()} />)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a text-bearing but unreliable extraction explains the structure failure and still blocks Apply', () => {
  const x = ready()
  x.parsed.complete = false
  render(<POImportReview {...x} hasExtractedText={true} issues={[]} disabled={false} onChange={vi.fn()} onApply={vi.fn()} />)
  expect(screen.getByRole('alert').textContent).toMatch(/Teks dokumen sudah terbaca/)
  expect(screen.getByRole('alert').textContent).toMatch(/struktur tabel atau kelengkapan baris/)
  expect((screen.getByRole('button', { name: 'Terapkan ke formulir' }) as HTMLButtonElement).disabled).toBe(true)
})

test('fallback without text evidence does not falsely claim successful text extraction', () => {
  const x = ready()
  x.parsed.complete = false
  render(<POImportReview {...x} hasExtractedText={false} issues={[]} disabled={false} onChange={vi.fn()} onApply={vi.fn()} />)
  expect(screen.getByRole('alert').textContent).not.toMatch(/Teks dokumen sudah terbaca/)
  expect((screen.getByRole('button', { name: 'Terapkan ke formulir' }) as HTMLButtonElement).disabled).toBe(true)
})
