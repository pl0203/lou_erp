// Candidate QA comparator; no private labels or production parser behavior.
export function paymentTermsMatch(actual: { value: string | null; raw: string }, expectedDays: number): boolean {
  if (!Number.isSafeInteger(expectedDays) || expectedDays < 0) return false
  const terms = String(actual.value || actual.raw).trim().replace(/\s+/g, ' ')
  const complete = /^(?:credit\s+|net\s+)?(\d+)\s*(?:days?|hari)$/i.exec(terms)
  return complete !== null && Number(complete[1]) === expectedDays
}

export type ExpectedRow = {
  source_code: string; source_code_label: string; name: string
  quantity: number; unit_price: number | null; uom: string; barcode?: string
}
export type ExpectedSource = {
  file: string; buyer_name: string; supplier_name: string; po_number: string
  order_date: string | null; expiry_date: string | null; items: ExpectedRow[]
  delivery_date?: string | null; currency?: string | null; payment_terms_days?: number | null
  printed_grand_total?: number | null; printed_order_net_value?: number | null
}
export type ExpectedLabels = { sources: ExpectedSource[] }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const textOrNull = (value: unknown) => value === null || typeof value === 'string'
const numberOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))

export function validExpectedLabels(input: unknown): input is ExpectedLabels {
  if (!record(input) || !Array.isArray(input.sources) || !input.sources.length) return false
  const filenames = new Set<string>()
  return input.sources.every(source => {
    if (!record(source) || typeof source.file !== 'string' || !source.file.trim() || filenames.has(source.file)) return false
    filenames.add(source.file)
    if (!['buyer_name', 'supplier_name', 'po_number'].every(key => typeof source[key] === 'string' && (source[key] as string).trim())) return false
    if (!['order_date', 'expiry_date'].every(key => textOrNull(source[key]))) return false
    if (!['delivery_date', 'currency'].every(key => source[key] === undefined || textOrNull(source[key]))) return false
    if (!['payment_terms_days', 'printed_grand_total', 'printed_order_net_value'].every(key => source[key] === undefined || numberOrNull(source[key]))) return false
    if (!Array.isArray(source.items)) return false
    return source.items.every(row => record(row)
      && ['source_code', 'source_code_label', 'name', 'uom'].every(key => typeof row[key] === 'string')
      && typeof row.quantity === 'number' && Number.isFinite(row.quantity)
      && numberOrNull(row.unit_price) && (row.barcode === undefined || typeof row.barcode === 'string'))
  })
}
