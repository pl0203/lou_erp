import { supabase } from '../supabase'
import { singleRelation } from '../relations'
import { IncompleteReadError } from './completeReads'
import type { HistoryPage } from './detailReads'

type Person = { full_name: string } | null
export type CustomerDetail = {
  id: string; name: string; address: string | null; city: string | null; phone: string | null; email: string | null
  last_visit_date: string | null; visit_frequency_days: number
}
export type CustomerVisit = { id: string; checked_in_at: string; users: Person }
export type CustomerOrder = {
  id: string; po_number: string; status: string; total_value: number | string
  order_date: string; expected_delivery_date: string | null
}
export type VisitEvidence = {
  id: string; notes: string | null
  visit_photos: { id: string; storage_path: string; taken_at: string }[]
}
export type NextCustomerSchedule = { id: string; scheduled_date: string; notes: string | null; users: Person }

export async function fetchCustomerDetail(id: string, signal?: AbortSignal): Promise<CustomerDetail | null> {
  let query = supabase.from('customers')
    .select('id, name, address, city, phone, email, last_visit_date, visit_frequency_days').eq('id', id)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

async function customerHistoryPage<T extends { id: string }>(
  table: string, columns: string, customerColumn: string, customerId: string,
  sort: string, page: number, pageSize: number, signal?: AbortSignal,
): Promise<HistoryPage<T>> {
  if (!Number.isSafeInteger(page) || page < 1) throw new IncompleteReadError()
  const offset = (page - 1) * pageSize
  if (!Number.isSafeInteger(offset + pageSize - 1)) throw new IncompleteReadError()
  let query = supabase.from(table).select(columns, { count: 'exact' }).eq(customerColumn, customerId)
    .order(sort, { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1)
  if (signal) query = query.abortSignal(signal)
  const { data, count, error } = await query
  if (error) throw error
  const items = (data ?? []) as unknown as T[]
  if (!Number.isSafeInteger(count) || count! < 0 || items.length !== Math.min(pageSize, Math.max(0, count! - offset))
    || items.some(row => typeof row.id !== 'string' || !row.id) || new Set(items.map(row => row.id)).size !== items.length) throw new IncompleteReadError()
  return { items, total: count!, page, page_size: pageSize }
}

export async function fetchCustomerVisitPage(filters: { customerId: string }, page: number, signal?: AbortSignal): Promise<HistoryPage<CustomerVisit>> {
  const result = await customerHistoryPage<CustomerVisit>('outlet_visits',
    'id, checked_in_at, users!outlet_visits_sales_person_id_fkey(full_name)', 'outlet_id', filters.customerId, 'checked_in_at', page, 10, signal)
  return { ...result, items: result.items.map(row => ({ ...row, users: singleRelation(row.users) })) }
}

export function fetchCustomerOrderPage(filters: { customerId: string }, page: number, signal?: AbortSignal): Promise<HistoryPage<CustomerOrder>> {
  return customerHistoryPage('purchase_orders', 'id, po_number, status, total_value, order_date, expected_delivery_date',
    'customer_id', filters.customerId, 'order_date', page, 20, signal)
}

export async function fetchVisitEvidence(customerId: string, visitId: string, signal?: AbortSignal): Promise<VisitEvidence | null> {
  let query = supabase.from('outlet_visits').select('id, notes, visit_photos(id, storage_path, taken_at)')
    .eq('outlet_id', customerId).eq('id', visitId)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data as VisitEvidence | null
}

export async function fetchNextCustomerSchedule(customerId: string, today: string, signal?: AbortSignal): Promise<NextCustomerSchedule | null> {
  let query = supabase.from('sales_schedules')
    .select('id, scheduled_date, notes, users!sales_schedules_sales_person_id_fkey(full_name)')
    .eq('outlet_id', customerId).eq('status', 'pending').gte('scheduled_date', today)
    .order('scheduled_date').order('id').limit(1)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw error
  const row = data?.[0]
  return row ? { ...row, users: singleRelation(row.users) } : null
}
