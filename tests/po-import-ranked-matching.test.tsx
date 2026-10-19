import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useState } from 'react'
import type { ParsedPO, Product, ReviewDecision } from '../src/lib/poImport/contracts'
import { matchPODraft } from '../src/lib/poImport/matching'
import { parsePODocument } from '../src/lib/poImport/parse'
import { pricedIndent } from './fixtures/po-import-layouts'
import POImportReview from '../src/components/poImport/POImportReview'
import { usePOImport } from '../src/lib/poImport/usePOImport'

const reader = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/lib/poImport/reader', () => ({ readPODocument: (...args: unknown[]) => reader.read(...args) }))
afterEach(cleanup)
const product = (id: string, sku: string, name: string, size: string | null = null): Product => ({ id, sku, name, size, harga_pokok: 0, luar_kota: 120000, dalam_kota: null, depo_bangunan: null })
function source(name = 'Baut hex stainless M8 40mm', sku: string | null = null) {
  const po = parsePODocument(pricedIndent())
  po.rows = [po.rows[0]]
  po.rows[0].sku = { ...po.rows[0].sku, value: sku, raw: sku ?? '' }
  po.rows[0].name = { ...po.rows[0].name, value: name, raw: name }
  return po
}
const suggestions = (po: ParsedPO, products: Product[]) => matchPODraft(po, [], products).productMatchesByRow[po.rows[0].id]

test('exact SKU takes priority over an exact name and does not collapse punctuation or zeros', () => {
  const po = source('Baut hex stainless M8 40mm', ' erp-001 ')
  const matches = matchPODraft(po, [], [product('name', 'OTHER', po.rows[0].name.value!), product('exact', 'ERP-001', 'Different item'), product('punctuation', 'ERP001', 'Different item'), product('zero', 'ERP-1', 'Different item')])
  expect(matches.productMatchesByRow[po.rows[0].id].map(x => [x.productId, x.kind])).toEqual([['exact', 'exact-sku'], ['name', 'exact-name']])
  expect(matches.exactSkuIdsByRow[po.rows[0].id]).toEqual(['exact'])
})

test('meaningful internal SKU spaces are preserved rather than silently collapsed', () => {
  const po = source('Different description', ' SY AB ')
  const matches = matchPODraft(po, [], [product('exact', 'sy ab', 'Other'), product('joined', 'SYAB', 'Other'), product('double', 'SY  AB', 'Other')])
  expect(matches.exactSkuIdsByRow[po.rows[0].id]).toEqual(['exact'])
})

test('missing or unmatched SKU ranks description and catalogue size without inventing identity', () => {
  for (const sku of [null, 'BUYER-UNKNOWN']) {
    const po = source(undefined, sku)
    const matches = suggestions(po, [product('wrong', 'ERP-2', 'Baut hex stainless M8', '50mm'), product('best', 'ERP-1', 'Baut hex stainless M8', '40 mm'), product('irrelevant', 'ERP-3', 'Pipa PVC 40mm')])
    expect(matches[0]).toMatchObject({ productId: 'best', kind: 'similarity', score: 100, specification: 'match' })
    expect(matches.find(x => x.productId === 'irrelevant')).toBeUndefined()
    expect(matches.find(x => x.productId === 'wrong')?.score ?? 0).toBeLessThan(matches[0].score)
  }
})

test('model and dimension mismatches cannot look like a full match', () => {
  const po = source('Panel model AX-100 10 x 20 cm')
  const matches = suggestions(po, [product('wrong', 'P-2', 'Panel model AX-200 20x30cm'), product('best', 'P-1', 'Panel model AX-100', '10×20 cm')])
  expect(matches[0]).toMatchObject({ productId: 'best', score: 100, specification: 'match' })
  expect(matches.find(x => x.productId === 'wrong')?.score ?? 0).toBeLessThan(50)
})

test('an exact SKU with a conflicting description keeps visible conflict evidence', () => {
  const po = source('Baut hex M8 40mm', 'ERP-1')
  expect(suggestions(po, [product('p', 'ERP-1', 'Baut hex M10 80mm')])[0]).toMatchObject({ productId: 'p', kind: 'exact-sku', specification: 'conflict' })
})

test('an exact name cannot outrank stronger description and size evidence when its catalogue size conflicts', () => {
  const po = source('Baut hex M8')
  const matches = suggestions(po, [product('name-only', 'ERP-2', 'Baut hex M8', 'M10'), product('consistent', 'ERP-1', 'Baut hex carbon M8', 'M8')])
  expect(matches[0].productId).toBe('consistent')
  expect(matches.find(x => x.productId === 'name-only')).toMatchObject({ kind: 'exact-name', specification: 'conflict' })
})

test('barcode and numeric-only descriptions are not identity or useful fuzzy evidence', () => {
  const po = source('40 100 200')
  po.rows[0].barcode = { raw: '000001', value: '000001', page: 1 }
  expect(suggestions(po, [product('barcode', '000001', 'Other product'), product('number', 'N', 'Panel 40 100 200')])).toEqual([])
})

test('ranking is bounded, deterministic under catalogue reorder, and does not mutate sources', () => {
  const po = source('Baut hex stainless')
  const products = Array.from({ length: 9 }, (_, i) => product(`p${i}`, `ERP-${i}`, 'Baut hex stainless'))
  const before = JSON.stringify({ po, products })
  const forward = suggestions(po, products)
  expect(forward).toHaveLength(5)
  expect(suggestions(po, [...products].reverse())).toEqual(forward)
  expect(JSON.stringify({ po, products })).toBe(before)
  expect(forward.every(x => Number.isInteger(x.score) && x.score >= 0 && x.score <= 100)).toBe(true)
})

test('normalization collisions are all recorded even when the visible list is bounded', () => {
  const po = source('Unrelated description', 'SKU-001')
  const products = Array.from({ length: 7 }, (_, i) => product(`p${i}`, i % 2 ? ' sku-001 ' : 'SKU-001', 'Other'))
  const matches = matchPODraft(po, [], products)
  expect(matches.exactSkuIdsByRow[po.rows[0].id]).toHaveLength(7)
  expect(matches.productMatchesByRow[po.rows[0].id]).toHaveLength(5)
})

test('removed or unavailable catalogue products are not suggested from prior results', () => {
  const po = source()
  const p = product('available', 'ERP-1', po.rows[0].name.value!)
  expect(suggestions(po, [p])).toHaveLength(1)
  expect(suggestions(po, [])).toEqual([])
})

function decision(po: ParsedPO): ReviewDecision {
  return { customerId: '', poNumber: po.poNumber.value!, orderDate: po.orderDate.value!, expiry: '', notes: '', acknowledgedIssueIds: [], rows: Object.fromEntries(po.rows.map(row => [row.id, { productId: null, manual: false, sku: row.sku.value ?? '', name: row.name.value ?? '', quantity: row.quantity.value!, unitPrice: row.unitPrice.value, unitConfirmed: false }])) }
}
function Review({ po, products, disabled = false }: { po: ParsedPO; products: Product[]; disabled?: boolean }) {
  const [value, setValue] = useState(() => decision(po))
  return <POImportReview parsed={po} decision={value} customers={[]} products={products} issues={[]} disabled={disabled} onChange={setValue} onApply={vi.fn()} />
}

test('ranked choices show scores as similarity, not probability, and require a deliberate selection', () => {
  const po = source()
  render(<Review po={po} products={[product('partial', 'ERP-2', 'Baut hex M8'), product('best', 'ERP-1', 'Baut hex stainless M8', '40mm')]} />)
  const list = screen.getByRole('list', { name: 'Saran produk barang 1' })
  expect(list.textContent).toMatch(/Skor kemiripan 100\/100/)
  expect(screen.getByText(/bukan probabilitas/)).toBeTruthy()
  expect(screen.getByText('Produk dipilih: Belum dipilih')).toBeTruthy()
  const buttons = within(list).getAllByRole('button')
  expect(buttons[0].getAttribute('aria-label')).toContain('ERP-1')
  expect(buttons[0].getAttribute('aria-label')?.startsWith(buttons[0].textContent!)).toBe(true)
  fireEvent.click(buttons[1])
  expect(screen.getByText('Produk dipilih: ERP-2 · Baut hex M8')).toBeTruthy()
  expect((screen.getByLabelText('Harga hasil impor 1') as HTMLInputElement).value).toBe(po.rows[0].unitPrice.value)
  expect((screen.getByLabelText('Saya sudah memeriksa satuan barang 1') as HTMLInputElement).checked).toBe(false)
})

test('equally ranked choices remain explicit and cannot change during a disabled refresh', () => {
  const po = source()
  render(<Review po={po} products={[product('a', 'ERP-A', po.rows[0].name.value!), product('b', 'ERP-B', po.rows[0].name.value!)]} disabled />)
  const buttons = within(screen.getByRole('list', { name: 'Saran produk barang 1' })).getAllByRole('button')
  expect(buttons).toHaveLength(2)
  buttons.forEach(button => expect((button as HTMLButtonElement).disabled).toBe(true))
  expect(screen.getByText('Produk dipilih: Belum dipilih')).toBeTruthy()
})

test('real parser source-code provenance still prevents automatic identity despite exact SKU text', async () => {
  // Exercise the real parser. Existing layouts intentionally flag their buyer codes.
  const pages = pricedIndent()
  reader.read.mockResolvedValue({ pages, previews: [], dispose: vi.fn() })
  const po = parsePODocument(pages)
  const first = po.rows[0]
  const products = [product('exact', first.sku.value!, 'Different name'), product('name', 'OTHER', first.name.value!)]
  const hook = renderHook(() => usePOImport({ customers: [], products, actorKey: 'synthetic:po_admin', disabled: false }, vi.fn(), vi.fn()))
  await act(async () => hook.result.current.start(new File(['synthetic'], 'synthetic.png')))
  expect(hook.result.current.decision!.rows[first.id].productId).toBeNull()
})
