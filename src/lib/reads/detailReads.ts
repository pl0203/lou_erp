import { supabase } from '../supabase'
import { singleRelation } from '../relations'
import { fetchPOLinePage } from './orders'
import { IncompleteReadError, readComplete } from './completeReads'
import type { POLineState } from './contracts'

export type CompletePOLines = { items: POLineState[]; po_updated_at: string; po_has_delivery_history: boolean }
export type HistoryPage<T> = { items: T[]; total: number; page: number; page_size: number }
export type AuditEntry = { id: string; field_changed: string; old_value: string | null; new_value: string | null; changed_at: string; users: { full_name: string } | null }
export type DeliveryHeader = { id: string; voided_at: string | null; void_reason: string | null; sj_number: string; sj_date: string; sj_date_received: string | null; sj_date_returned: string | null }
export type DeliveryLine = { id: string; po_line_item_id: string; quantity_delivered: number }
export type SalesOrderLine = { id: string; order_id: string; product_name: string; sku: string | null; quantity: number; unit_price: number; is_promo: boolean }

/** All lines are pinned to the header version. A partial result is never editable. */
export async function fetchCompletePOLines(poId: string, expectedUpdatedAt: string, signal?: AbortSignal): Promise<CompletePOLines> {
  let hasHistory: boolean | undefined
  const items = await readComplete(async offset => {
    const page = await fetchPOLinePage(poId, offset / 100 + 1, expectedUpdatedAt, signal)
    if (page.po_updated_at !== expectedUpdatedAt || (hasHistory !== undefined && hasHistory !== page.po_has_delivery_history)) throw new IncompleteReadError('PO berubah. Muat ulang sebelum melanjutkan.')
    hasHistory = page.po_has_delivery_history
    return { items: page.items, total: page.total }
  }, row => row.id, signal)
  return { items, po_updated_at: expectedUpdatedAt, po_has_delivery_history: hasHistory ?? false }
}

/** Only ordinary numeric(14,2) prices cross into the existing numeric edit payload. */
export function priceForEdit(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new IncompleteReadError('Harga tidak dapat diubah dengan aman.')
  const [whole, fraction = ''] = value.split('.')
  if (BigInt(whole + fraction.padEnd(2, '0')) > BigInt(Number.MAX_SAFE_INTEGER)) throw new IncompleteReadError('Harga terlalu besar untuk diubah dengan aman.')
  const number = Number(value)
  const canonical = `${BigInt(whole)}${fraction.replace(/0+$/, '') ? `.${fraction.replace(/0+$/, '')}` : ''}`
  if (!Number.isFinite(number) || number.toString() !== canonical) throw new IncompleteReadError('Harga tidak dapat diubah tanpa pembulatan.')
  return number
}

// Exact counts and ID ordering are required for narrow complete reads; RLS and
// the visible caller-owned filters remain authoritative for every page.
export async function fetchCompleteRows<T extends { id: string }>(table: string, columns: string, filters: Record<string, string>, signal?: AbortSignal): Promise<T[]> {
  return readComplete<T>(async (offset, limit) => {
    let query = supabase.from(table).select(columns, { count: 'exact' }).order('id').range(offset, offset + limit - 1)
    for (const [field, value] of Object.entries(filters)) query = query.eq(field, value)
    if (signal) query = query.abortSignal(signal)
    const { data, error, count } = await query
    if (error) throw error
    return { items: (data ?? []) as unknown as T[], total: count as number }
  }, row => row.id, signal)
}

export function fetchSalesOrderLines(orderId: string, signal?: AbortSignal): Promise<SalesOrderLine[]> {
  return fetchCompleteRows('girard_order_items', 'id, order_id, product_name, sku, quantity, unit_price, is_promo', { order_id: orderId }, signal)
}
export function fetchDeliveryLines(sjId: string, signal?: AbortSignal): Promise<DeliveryLine[]> {
  return fetchCompleteRows('sj_line_items', 'id, po_line_item_id, quantity_delivered', { surat_jalan_id: sjId }, signal)
}

async function historyPage<T extends { id: string }>(table: string, columns: string, poId: string, sort: string, ascending: boolean, page: number, signal?: AbortSignal): Promise<HistoryPage<T>> {
  if (!Number.isSafeInteger(page) || page < 1) throw new IncompleteReadError()
  const pageSize = 20, offset = (page - 1) * pageSize
  let query = supabase.from(table).select(columns, { count: 'exact' }).eq('purchase_order_id', poId)
    .order(sort, { ascending }).order('id', { ascending }).range(offset, offset + pageSize - 1)
  if (signal) query = query.abortSignal(signal)
  const { data, error, count } = await query
  if (error) throw error
  const items = (data ?? []) as unknown as T[]
  if (!Number.isSafeInteger(count) || count! < 0 || items.length !== Math.min(pageSize, Math.max(0, count! - offset)) || new Set(items.map(row => row.id)).size !== items.length) throw new IncompleteReadError()
  return { items, total: count!, page, page_size: pageSize }
}
export async function fetchAuditPage(poId: string, page: number, signal?: AbortSignal): Promise<HistoryPage<AuditEntry>> {
  const result = await historyPage<AuditEntry>('po_audit_log', 'id, field_changed, old_value, new_value, changed_at, users(full_name)', poId, 'changed_at', false, page, signal)
  return { ...result, items: result.items.map(row => ({ ...row, users: singleRelation(row.users) })) }
}
export function fetchDeliveryPage(poId: string, page: number, signal?: AbortSignal): Promise<HistoryPage<DeliveryHeader>> {
  return historyPage('surat_jalan', 'id, sj_number, sj_date, sj_date_received, sj_date_returned, voided_at, void_reason', poId, 'sj_date', true, page, signal)
}
export async function fetchDeliveryForEdit(poId: string, sjId: string, expectedUpdatedAt: string, signal?: AbortSignal) {
  const items = await fetchDeliveryLines(sjId, signal)
  // Changes during the child read must not combine new SJ lines with old totals.
  const check = await fetchPOLinePage(poId, 1, expectedUpdatedAt, signal)
  if (check.po_updated_at !== expectedUpdatedAt) throw new IncompleteReadError('PO berubah. Muat ulang sebelum melanjutkan.')
  return items
}
