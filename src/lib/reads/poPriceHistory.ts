import { supabase } from '../supabase'
import { IncompleteReadError } from './completeReads'
import { fetchCompletePOLines, priceForEdit } from './detailReads'
import { PO_OUTPUT_STATUSES, type POLineState } from './contracts'

export type PriceHistoryPO = {
  id: string; customer_id: string; po_number: string; order_date: string;
  created_at: string; updated_at: string; status: string;
}
export type LastPOPrice =
  | { kind: 'none' }
  | { kind: 'legacy'; po: PriceHistoryPO }
  | { kind: 'ambiguous'; po: PriceHistoryPO }
  | { kind: 'suggestion'; po: PriceHistoryPO; price: string; unitPrice: number }

type Search = 'product' | 'legacy'
const HEADER_COLUMNS = 'id,customer_id,po_number,order_date,created_at,updated_at,status,matching:po_line_items!inner(id)'
const LEGACY_PAGE_SIZE = 20
const MAX_LEGACY_CANDIDATES = 100
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const normalizeSku = (value: string) => value.trim().toLowerCase()
function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('The read was aborted', 'AbortError')
}
// Postgres timestamps retain microseconds. Date alone would lose the tie-break
// between the product-ID and legacy-SKU searches within one millisecond.
function timestamp(value: string): bigint {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new IncompleteReadError()
  const millis = Date.parse(value), fraction = value.match(/\.(\d+)/)?.[1] ?? ''
  if (!Number.isFinite(millis)) throw new IncompleteReadError()
  return BigInt(millis) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3))
}
function compareNewest(a: PriceHistoryPO, b: PriceHistoryPO): number {
  const at = timestamp(a.created_at), bt = timestamp(b.created_at)
  return at === bt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : at > bt ? -1 : 1
}
function header(value: unknown, customerId: string): PriceHistoryPO {
  const row = value as PriceHistoryPO
  if (!row || !uuid.test(row.id) || row.customer_id !== customerId || typeof row.po_number !== 'string' ||
    !/^\d{4}-\d\d-\d\d$/.test(row.order_date) || !PO_OUTPUT_STATUSES.includes(row.status as typeof PO_OUTPUT_STATUSES[number]) || row.status === 'cancelled') throw new IncompleteReadError()
  timestamp(row.created_at); timestamp(row.updated_at)
  return { id: row.id, customer_id: row.customer_id, po_number: row.po_number, order_date: row.order_date, created_at: row.created_at, updated_at: row.updated_at, status: row.status }
}

/** Read-only, existing RLS and existing version-pinned line API. "Last" means
 * most recently created PO, then descending UUID; edits to an older PO do not
 * make it the customer's most recent order. Never uses tier/catalogue prices.
 * Legacy lines have no reliable product identity, so a matching SKU is review
 * evidence only, never permission to assign a guessed historical price.
 */
export async function fetchLastPOPrice(customerId: string, productId: string, sku: string, signal?: AbortSignal): Promise<LastPOPrice> {
  if (!uuid.test(customerId) || !uuid.test(productId) || !sku.trim()) throw new IncompleteReadError()
  assertActive(signal)
  const checks: Array<{ kind: Search; offset: number; snapshot: string }> = []
  async function page(kind: Search, offset = 0) {
    assertActive(signal)
    const size = kind === 'product' ? 1 : LEGACY_PAGE_SIZE
    let query = supabase.from('purchase_orders').select(HEADER_COLUMNS, { count: 'exact' })
      .eq('customer_id', customerId).neq('status', 'cancelled')
    if (kind === 'product') query = query.eq('matching.product_id', productId)
    else {
      // Parameterized ILIKE is a broad prefilter, not identity resolution. It
      // includes padded/case variants; wildcard punctuation is checked against
      // the exact normalized SKU after the complete version-pinned line read.
      const pattern = `%${sku.trim().replace(/[\\%_]/g, '\\$&').replace(/\*/g, '%')}%`
      query = query.is('matching.product_id', null).ilike('matching.sku', pattern)
    }
    query = query.order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + size - 1).limit(1, { referencedTable: 'matching' })
    if (signal) query = query.abortSignal(signal)
    const { data, error, count } = await query
    assertActive(signal)
    if (error) throw error
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count! < 0 || data.length !== Math.min(size, Math.max(0, count! - offset))) throw new IncompleteReadError()
    const rows = data.map(row => header(row, customerId))
    if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some((row, index) => index > 0 && compareNewest(rows[index - 1], row) > 0)) throw new IncompleteReadError()
    return { rows, total: count!, snapshot: JSON.stringify({ rows, total: count }) }
  }
  async function checkedPage(kind: Search, offset = 0) {
    const result = await page(kind, offset)
    checks.push({ kind, offset, snapshot: result.snapshot }); return result
  }
  const lines = new Map<string, POLineState[]>()
  async function details(po: PriceHistoryPO) {
    if (!lines.has(po.id)) {
      const result = await fetchCompletePOLines(po.id, po.updated_at, signal)
      assertActive(signal)
      if (result.po_updated_at !== po.updated_at) throw new IncompleteReadError()
      lines.set(po.id, result.items)
    }
    return lines.get(po.id)!
  }
  const definitive = (await checkedPage('product')).rows[0]
  let legacy: PriceHistoryPO | undefined
  let stop = false
  for (let offset = 0; !stop; offset += LEGACY_PAGE_SIZE) {
    if (offset >= MAX_LEGACY_CANDIDATES) throw new IncompleteReadError('Riwayat lama belum dapat dipastikan. Isi harga secara manual.')
    const result = await checkedPage('legacy', offset)
    for (const po of result.rows) {
      if (definitive && compareNewest(po, definitive) > 0) { stop = true; break }
      const items = await details(po)
      if (items.some(item => item.product_id === null && typeof item.sku === 'string' && normalizeSku(item.sku) === normalizeSku(sku))) { legacy = po; stop = true; break }
    }
    if (offset + result.rows.length >= result.total) stop = true
  }
  let result: LastPOPrice = { kind: 'none' }
  if (legacy) result = { kind: 'legacy', po: legacy }
  else if (definitive) {
    const matching = (await details(definitive)).filter(item => item.product_id === productId)
    if (!matching.length) throw new IncompleteReadError()
    const prices = matching.map(item => ({ price: item.unit_price, unitPrice: priceForEdit(item.unit_price) }))
    result = new Set(prices.map(item => item.unitPrice)).size > 1
      ? { kind: 'ambiguous', po: definitive }
      : { kind: 'suggestion', po: definitive, ...prices[0] }
  }
  // Separate HTTP requests are not a database snapshot. Recheck the predicates,
  // latest candidate, status and versions after details; drift fails closed.
  for (const check of checks) {
    if ((await page(check.kind, check.offset)).snapshot !== check.snapshot) throw new IncompleteReadError('Riwayat PO berubah. Coba muat ulang harga.')
  }
  return result
}
