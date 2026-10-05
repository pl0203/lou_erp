import { expect, test } from 'vitest'
import type { PageText } from '../src/lib/poImport/contracts'
import { parsePODocument } from '../src/lib/poImport/parse'
import { preparePOFormDraft } from '../src/lib/poImport/review'
import { depotTable, photoGrid, pricedIndent, token, unpricedIndent } from './fixtures/po-import-layouts'

// All identities and values are synthetic. Repeated table headers remain structurally valid.
function repeated(make: () => PageText[], count: number, noEnd: number): PageText[] {
  const first = make()[0], second = make()[0]
  first.tokens.forEach(t => { t.text = t.text.replace(/Hal\. 1 \/ 1/, 'Hal. 1 / 2') })
  second.page = 2
  second.tokens.forEach(t => {
    t.text = t.text.replace(/Hal\. 1 \/ 1/, 'Hal. 2 / 2')
    if (t.x / second.width < noEnd && /^\d{1,3}\.?$/.test(t.text)) t.text = String(Number(t.text.replace('.', '')) + count)
  })
  return [first, second]
}
function repeatedDepot(): PageText[] {
  const input = depotTable(12)
  input[1].tokens = [
    ...input[0].tokens.filter(t => t.y < 285 && !/^Page /.test(t.text)).map(t => ({ ...t })),
    ...input[0].tokens.filter(t => t.y >= 285 && t.y < 360).map(t => ({ ...t })),
    ...input[1].tokens.filter(t => t.y >= 86 || /^Page /.test(t.text)).map(t => ({ ...t, y: t.y === 86 ? 360 : t.y })),
  ]
  return input
}
const layouts = [
  { name: 'photo', make: () => repeated(photoGrid, 3, .1), buyer: 'PT. LANTERN MATERIALS', supplier: 'KEPADA : V-00999 - GLASS PINE SUPPLY', date: 'TGL. NOTA : 12-01-2028', payment: 'TOP : 40 Hari', headerEnd: 230, rows: 6 },
  { name: 'unpriced', make: () => repeated(unpricedIndent, 3, .09), buyer: 'LANTERN BUILDING', supplier: ': V-00888 - GLASS PINE SUPPLY', date: 'TGL. NOTA : 03-02-2028', payment: 'JTH. TEMPO 50 Hari', headerEnd: 96, rows: 6 },
  { name: 'priced', make: () => repeated(pricedIndent, 2, .055), buyer: 'PT. LANTERN RETAIL GROUP', supplier: 'GLASS PINE SUPPLY', date: 'Tanggal : 07 Mar 2028', payment: null, headerEnd: 153, rows: 4 },
  { name: 'depot', make: repeatedDepot, buyer: 'PT. LANTERN DEPOT, Tbk', supplier: 'GLASS PINE SUPPLY', date: null, payment: 'Payment terms : Credit 20 Days', headerEnd: 285, rows: 12 },
]
function replace(input: PageText[], index: number, original: string, replacement: string) {
  const found = input[index].tokens.find(t => t.text === original)
  if (!found) throw new Error(`Missing synthetic token: ${original}`)
  found.text = replacement
}
function expectConflict(input: PageText[], field: string, rows: number) {
  const parsed = parsePODocument(input)
  expect(parsed.rows).toHaveLength(rows)
  expect(parsed.complete).toBe(false)
  expect(parsed.issues.some(i => i.field === 'document' && i.code === 'conflicting-header' && i.id.includes(field) && i.blocking)).toBe(true)
}
test('depot continuation with another buyer never combines its 22 rows as a complete PO', () => {
  const input = depotTable(); replace(input, 1, 'PT. LANTERN DEPOT, Tbk', 'PT. OTHER DEPOT, Tbk')
  expectConflict(input, 'buyer', 22)
  const parsed = parsePODocument(input)
  const decision = { customerId: 'buyer', poNumber: parsed.poNumber.value!, orderDate: '2028-04-11', expiry: '', notes: '', idrConfirmed: true, acknowledgedIssueIds: parsed.issues.map(i => i.id), rows: Object.fromEntries(parsed.rows.map(r => [r.id, { productId: null, manual: true, name: r.name.value!, sku: r.sku.value!, quantity: r.quantity.value!, unitPrice: r.unitPrice.value, unitConfirmed: true }])) }
  const customers = [{ id: 'buyer', name: parsed.buyer.value!, pricing_tier: 'luar_kota' }]
  decision.acknowledgedIssueIds.push(...preparePOFormDraft(parsed, decision, customers, []).issues.map(i => i.id))
  expect(preparePOFormDraft(parsed, decision, customers, []).draft).toBeNull()
})
for (const layout of layouts) {
  test(`${layout.name} rejects a different repeated buyer`, () => {
    const input = layout.make(); replace(input, 1, layout.buyer, 'OTHER SYNTHETIC BUYER')
    expectConflict(input, 'buyer', layout.rows)
  })
  test(`${layout.name} rejects a different explicit repeated supplier`, () => {
    const input = layout.make(); replace(input, 1, layout.supplier, layout.supplier.replace('GLASS PINE SUPPLY', 'OTHER SYNTHETIC SUPPLIER'))
    expectConflict(input, 'supplier', layout.rows)
  })
  if (layout.date) test(`${layout.name} rejects a different explicit repeated order date`, () => {
    const input = layout.make(); replace(input, 1, layout.date!, layout.date!.replace('2028', '2029'))
    expectConflict(input, 'orderDate', layout.rows)
  })
  if (layout.payment) test(`${layout.name} rejects different explicit repeated payment terms`, () => {
    const input = layout.make(); replace(input, 1, layout.payment!, layout.payment!.replace(/40|50|20/, '60'))
    expectConflict(input, 'paymentTerms', layout.rows)
  })
  test(`${layout.name} allows normalized repeated header values without removing rows`, () => {
    const input = layout.make()
    for (const original of [layout.buyer, layout.supplier, layout.payment].filter(Boolean) as string[]) replace(input, 1, original, original.toLowerCase().replace(/ /g, '  '))
    if (layout.date) replace(input, 1, layout.date, layout.date.replace('12-01-2028', '12/01/2028').replace('03-02-2028', '03/02/2028').replace('07 Mar 2028', '07 Maret 2028'))
    const parsed = parsePODocument(input); expect(parsed.complete).toBe(true); expect(parsed.rows).toHaveLength(layout.rows)
  })
  test(`${layout.name} permits omitted repeated identity headers`, () => {
    const input = layout.make(); input[1].tokens = input[1].tokens.filter(t => t.y >= layout.headerEnd)
    const parsed = parsePODocument(input); expect(parsed.complete).toBe(true); expect(parsed.rows).toHaveLength(layout.rows)
  })
  test(`${layout.name} reconciles explicit repeated currency, including normalized rupiah labels`, () => {
    const input = layout.make()
    for (const pg of input) pg.tokens = pg.tokens.filter(t => !/^Currency\s*:/i.test(t.text))
    input[0].tokens.push(token('Currency : IDR', 5, layout.headerEnd - 14, 110, 2))
    input[1].tokens.push(token('Currency : Rupiah', 5, layout.headerEnd - 14, 110, 2))
    expect(parsePODocument(input).complete).toBe(true)
    replace(input, 1, 'Currency : Rupiah', 'Currency : USD'); expectConflict(input, 'currency', layout.rows)
  })
}
test('depot genuinely headerless rows in the old buyer region are not interpreted as a new buyer', () => {
  const input = depotTable(); input[1].tokens = input[1].tokens.filter(t => t.y >= 86).map(t => ({ ...t, y: t.y - 66 }))
  const parsed = parsePODocument(input); expect(parsed.complete).toBe(true); expect(parsed.rows).toHaveLength(22)
})
test('header integrity ignores differing print dates, end-customer and note header references', () => {
  const input = repeatedDepot()
  replace(input, 1, 'Printout date : 11/04/2028', 'Printout date : 12/04/2028')
  input[1].tokens.push(token('Order no / Rev : END-CUSTOMER-REFERENCE', 263, 790, 220, 15), token('Kepada: END CUSTOMER / Payment terms : 90 Days', 23, 805, 420, 15))
  const parsed = parsePODocument(input); expect(parsed.complete).toBe(true); expect(parsed.orderDate.value).toBeNull()
})
test('depot explicit repeated order dates conflict, but their different date spellings do not', () => {
  const input = repeatedDepot()
  input[0].tokens.push(token('Order date : 11/04/2028', 22, 182, 160, 15))
  input[1].tokens.push(token('Order date : 11-04-2028', 22, 182, 160, 15))
  expect(parsePODocument(input).complete).toBe(true)
  replace(input, 1, 'Order date : 11-04-2028', 'Order date : 12-04-2028'); expectConflict(input, 'orderDate', 12)
})

test.each(['delivery', 'expiry'] as const)('explicit repeated %s must match while equivalent date formats are accepted', key => {
  const input = repeatedDepot(), label = key === 'delivery' ? 'Delivery date' : 'Expiry date'
  input[0].tokens.push(token(`${label} : 20/04/2028`, 22, 182, 180, 15))
  input[1].tokens.push(token(`${label} : 20-04-2028`, 22, 182, 180, 15))
  expect(parsePODocument(input).complete).toBe(true)
  replace(input, 1, `${label} : 20-04-2028`, `${label} : 21-04-2028`); expectConflict(input, key, 12)
})
test('header-like phrases embedded in an end-customer reference do not establish header identity', () => {
  const input = repeatedDepot()
  input[0].tokens.push(token('Order date : 11/04/2028', 22, 182, 160, 15))
  input[1].tokens.push(token('End customer reference: Order date : 12/04/2028', 22, 182, 300, 15))
  expect(parsePODocument(input).complete).toBe(true)
})

test('a second complete PO section below the first table still cannot be merged', () => {
  const input = pricedIndent(), second = pricedIndent()[0]
  second.tokens.forEach(t => { t.y += 400; t.text = t.text.replace('POZ1.2803.00421', 'POZ1.2803.00999') })
  input[0].tokens.push(...second.tokens)
  const parsed = parsePODocument(input)
  expect(parsed.complete).toBe(false); expect(parsed.issues.some(i => i.code === 'multiple-po' && i.blocking)).toBe(true)
})

test.each([true, false])('same-page matching PO table sections cannot silently omit later rows (repeated identity: %s)', withIdentity => {
  const input = pricedIndent(), second = pricedIndent()[0]
  if (!withIdentity) second.tokens = second.tokens.filter(t => t.y >= 153)
  second.tokens.forEach(t => {
    if (t.x / second.width < .055 && /^\d{1,3}$/.test(t.text)) t.text = String(Number(t.text) + 2)
    t.y += 400
  })
  input[0].tokens.push(...second.tokens)
  const parsed = parsePODocument(input)
  const customers = [{ id: 'buyer', name: parsed.buyer.value!, pricing_tier: 'luar_kota' }]
  const decision = { customerId: 'buyer', poNumber: parsed.poNumber.value!, orderDate: parsed.orderDate.value!, expiry: '', notes: parsed.notes, idrConfirmed: true, acknowledgedIssueIds: parsed.issues.map(i => i.id), rows: Object.fromEntries(parsed.rows.map(row => [row.id, { productId: null, manual: true, name: row.name.value!, sku: row.sku.value!, quantity: row.quantity.value!, unitPrice: row.unitPrice.value, unitConfirmed: true }])) }
  decision.acknowledgedIssueIds.push(...preparePOFormDraft(parsed, decision, customers, []).issues.map(i => i.id))
  expect(parsed.complete).toBe(false)
  expect(parsed.issues.some(i => i.code === 'incomplete-extraction' && i.blocking)).toBe(true)
  expect(preparePOFormDraft(parsed, decision, customers, []).draft).toBeNull()
})

test.each([
  ['combined title tokens', 'SURAT ORDER PEMBELIAN', false],
  ['combined case/whitespace variant', 'surat  order   pembelian', false],
  ['separate title tokens on one line', 'SURAT ORDER', true],
] as const)('different same-page PO numbers remain blocked with %s', (_label, title, sameLine) => {
  const input = pricedIndent(), second = pricedIndent()[0]
  for (const source of [input[0], second]) {
    source.tokens.find(t => t.text === 'SURAT ORDER')!.text = title
    if (sameLine) source.tokens.find(t => t.text === 'PEMBELIAN')!.y = 9
    else source.tokens = source.tokens.filter(t => t.text !== 'PEMBELIAN')
  }
  second.tokens.forEach(t => { t.y += 400; t.text = t.text.replace('POZ1.2803.00421', 'POZ1.2803.00999') })
  input[0].tokens.push(...second.tokens)
  const parsed = parsePODocument(input)
  const customers = [{ id: 'buyer', name: parsed.buyer.value!, pricing_tier: 'luar_kota' }]
  const decision = { customerId: 'buyer', poNumber: parsed.poNumber.value!, orderDate: parsed.orderDate.value!, expiry: '', notes: parsed.notes, idrConfirmed: true, acknowledgedIssueIds: parsed.issues.map(i => i.id), rows: Object.fromEntries(parsed.rows.map(row => [row.id, { productId: null, manual: true, name: row.name.value!, sku: row.sku.value!, quantity: row.quantity.value!, unitPrice: row.unitPrice.value, unitConfirmed: true }])) }
  decision.acknowledgedIssueIds.push(...preparePOFormDraft(parsed, decision, customers, []).issues.map(i => i.id))
  expect(preparePOFormDraft(parsed, decision, customers, []).draft).toBeNull()
  expect(parsed.complete).toBe(false)
  expect(parsed.issues.some(i => i.field === 'document' && i.code === 'multiple-po' && i.blocking)).toBe(true)
})
