import type { ExtractedReport, SourceRow } from '../../../src/lib/co/import/types'

// Entirely synthetic: no uploaded customer documents or live backend identifiers.
const sha256 = 'a'.repeat(64)
const row = (physicalRow: string, overrides: Partial<SourceRow>): SourceRow => ({
  id: `${sha256}:sheet:Sales:row:${physicalRow}:section:sales`,
  ref: { fileSha256: sha256, page: null, sheet: 'Sales', row: physicalRow, section: 'sales' },
  sourceSku: '00001234', name: 'Synthetic item', transactionDate: '2026-09-12',
  transactionReference: `SYN-${physicalRow}`, quantity: { raw: '73', decimal: '73' },
  returned: null, unit: 'PCS', unitPrice: { raw: '17.000', decimal: '17000' },
  discount: { raw: '0', decimal: '0' }, discountBasis: 'line_amount', netUnitPrice: null,
  amount: { raw: '1.241.000', decimal: '1241000' }, currency: 'IDR', priceBasisLabel: null,
  flags: [], ...overrides,
})

export const syntheticReport: ExtractedReport = {
  sha256, format: 'xlsx', parserVersion: 'synthetic-v1',
  sourceRows: [
    row('2', {}),
    row('3', { quantity: { raw: '31', decimal: '31' }, unit: 'BOX',
      unitPrice: { raw: '19.000', decimal: '19000' }, amount: { raw: '589.000', decimal: '589000' } }),
    row('4', { sourceSku: null, quantity: { raw: '', decimal: null }, unit: null,
      unitPrice: null, discount: null, discountBasis: null, amount: null, currency: null,
      transactionDate: null, transactionReference: null, flags: ['manual_review_required'] }),
  ],
  sections: [{ id: 'sales', label: 'Synthetic sales', rowIds: ['2', '3', '4'].map(r => `${sha256}:sheet:Sales:row:${r}:section:sales`), printedTotal: null }],
  periodCandidates: ['2026-09-01'], customerCandidates: ['Synthetic customer'], warnings: [],
}
