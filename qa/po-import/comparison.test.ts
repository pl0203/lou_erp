import { describe, expect, it } from 'vitest'
import { paymentTermsMatch } from './comparison'

const terms = (value: string | null, raw = value ?? '') => ({ value, raw })

describe('candidate payment terms comparison', () => {
  it('does not confuse three days with thirty days', () => {
    expect(paymentTermsMatch(terms('Credit 30 Days'), 3)).toBe(false)
    expect(paymentTermsMatch(terms('3 Hari'), 30)).toBe(false)
  })
  it('matches complete equivalent day terms', () => {
    expect(paymentTermsMatch(terms('3 Days'), 3)).toBe(true)
    expect(paymentTermsMatch(terms('Credit 30 Days'), 30)).toBe(true)
    expect(paymentTermsMatch(terms('45 Hari'), 45)).toBe(true)
    expect(paymentTermsMatch(terms(null, '60 Hari'), 60)).toBe(true)
  })
  it('rejects unbounded, ambiguous or wrong-unit text', () => {
    expect(paymentTermsMatch(terms('3 months'), 3)).toBe(false)
    expect(paymentTermsMatch(terms('3 days or 30 days'), 3)).toBe(false)
    expect(paymentTermsMatch(terms('130 days'), 30)).toBe(false)
    expect(paymentTermsMatch(terms('3 days plus fees'), 3)).toBe(false)
    expect(paymentTermsMatch(terms(''), 3)).toBe(false)
  })
})

import { validExpectedLabels } from './comparison'
const expectedRow = { source_code: 'QA-001', source_code_label: 'Kode', name: 'Synthetic Widget', quantity: 3, unit_price: 30, uom: 'PCS' }
const expectedSource = { file: 'synthetic.pdf', buyer_name: 'Synthetic Buyer', supplier_name: 'Synthetic Supplier', po_number: 'QA-1', order_date: '2026-10-05', expiry_date: null, items: [expectedRow] }

describe('candidate expected-label shape', () => {
  it('accepts complete synthetic labels and optional null financial fields', () => {
    expect(validExpectedLabels({ sources: [{ ...expectedSource, payment_terms_days: null, printed_grand_total: null }] })).toBe(true)
  })
  it('rejects malformed roots and duplicate filenames', () => {
    expect(validExpectedLabels(null)).toBe(false)
    expect(validExpectedLabels({ sources: [] })).toBe(false)
    expect(validExpectedLabels({ sources: [expectedSource, expectedSource] })).toBe(false)
  })
  it('rejects incomplete headers and malformed item numeric values', () => {
    expect(validExpectedLabels({ sources: [{ file: 'synthetic.pdf', items: [] }] })).toBe(false)
    expect(validExpectedLabels({ sources: [{ ...expectedSource, items: [{ ...expectedRow, unit_price: '30' }] }] })).toBe(false)
    expect(validExpectedLabels({ sources: [{ ...expectedSource, items: null }] })).toBe(false)
  })
})
