import { callRead } from './rpc'
import type { POStatusFilter, SalesStatusFilter } from './contracts'

export const ORDER_PAGE_SIZE = 10
export type POFilters = { status: POStatusFilter; search: string }
export type SalesOrderFilters = { status: SalesStatusFilter; ownOnly: boolean; customerId?: string; visitId?: string }
export function fetchPOPage(filters: POFilters, page: number, signal?: AbortSignal) {
  return callRead('pilot_po_page_v1', { p_status: filters.status, p_search: filters.search.trim(), p_page: page, p_page_size: ORDER_PAGE_SIZE }, signal)
}
export function fetchSalesOrderPage(filters: SalesOrderFilters, page: number, signal?: AbortSignal) {
  return callRead('pilot_sales_order_page_v1', { p_status: filters.status, p_own_only: filters.ownOnly, p_customer_id: filters.customerId ?? null, p_visit_id: filters.visitId ?? null, p_page: page, p_page_size: ORDER_PAGE_SIZE }, signal)
}
export async function fetchPOLinePage(poId: string, page: number, expectedUpdatedAt?: string, signal?: AbortSignal) {
  const result = await callRead('pilot_po_lines_v1', { p_po_id: poId, p_page: page, p_page_size: 100, p_expected_updated_at: expectedUpdatedAt ?? null }, signal)
  if (result.items.some(line => line.product_id !== null && (typeof line.product_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.product_id)))) throw new Error('Identitas produk PO belum lengkap atau tidak valid. Muat ulang sebelum mengubah PO.')
  return result
}
