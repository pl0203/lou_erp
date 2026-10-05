import { expect, test } from 'vitest'
import type { ReviewDecision } from '../src/lib/poImport/contracts'
import { parsePODocument } from '../src/lib/poImport/parse'
import { initialReviewNotes } from '../src/lib/poImport/reviewNotes'
import { isFinancialReviewIssue, preparePOFormDraft } from '../src/lib/poImport/review'
import { depotTable, photoGrid, pricedIndent, unpricedIndent } from './fixtures/po-import-layouts'

for (const [name, make, expectedRows, context] of [
  ['photo', photoGrid, 3, ['15-01-2028', '40 Hari', 'PCS', '16.000.000']],
  ['unpriced', unpricedIndent, 3, ['09-02-2028', '50 Hari', 'UNIT', 'PCS', 'SAK']],
  ['priced', pricedIndent, 2, ['DPP : 1,171,171.17', 'Pajak : 128,828.83', '1,300,000', 'gross', 'PCS']],
  ['depot', depotTable, 22, ['Credit 20 Days', '528,000.00', 'PC', 'VAT 0.00', 'gross']],
] as const) {
  test(`${name} source facts survive initial review and actual policy without financial conversion`, () => {
    const parsed = parsePODocument(make()), notes = initialReviewNotes(parsed)
    expect(parsed.complete).toBe(true); expect(parsed.rows).toHaveLength(expectedRows)
    expect(notes.startsWith(parsed.notes)).toBe(true)
    for (const fact of context) expect(notes).toContain(fact)
    expect(notes).toContain('Mata uang sumber: tidak tercantum'); expect(notes).toContain('tanpa konversi')
    expect(notes).toContain('Satuan sumber barang 1 (halaman 1)')
    const customers = [{ id: 'c', name: parsed.buyer.value!, pricing_tier: 'luar_kota' }]
    const decision: ReviewDecision = { customerId: 'c', poNumber: parsed.poNumber.value!, orderDate: parsed.orderDate.value || '2028-04-11', expiry: '', notes, idrConfirmed: true, acknowledgedIssueIds: [], rows: Object.fromEntries(parsed.rows.map(row => [row.id, { productId: null, manual: true, sku: row.sku.value || '', name: row.name.value!, quantity: row.quantity.value!, unitPrice: row.unitPrice.value, unitConfirmed: true }])) }
    decision.acknowledgedIssueIds = preparePOFormDraft(parsed, decision, customers, []).issues.filter(issue => isFinancialReviewIssue(issue) || issue.code === 'missing-price').map(issue => issue.id)
    const result = preparePOFormDraft(parsed, decision, customers, [])
    expect(result.draft).not.toBeNull(); expect(result.draft!.notes).toBe(notes); expect(result.draft!.expectedDelivery).toBe('')
    expect(result.draft!.lineItems.map(row => row.unit_price)).toEqual(parsed.rows.map(row => row.unitPrice.value === null ? Number.NaN : Number(row.unitPrice.value)))
    decision.notes = ''; expect(preparePOFormDraft(parsed, decision, customers, []).draft!.notes).toBe('')
  })
}
