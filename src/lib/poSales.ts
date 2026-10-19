import { supabase } from './supabase'
import { singleRelation } from './relations'

export type SavedPOSales = {
  sales_person_id_at_creation?: string | null
  sales_attribution_state?: string | null
  sales_person_at_creation?: { full_name: string } | null
}
/** Saved PO credit is deliberately independent of the customer's current owner. */
export function savedPOSalesName(po: SavedPOSales): string {
  if (po.sales_attribution_state === 'unassigned') return 'Belum ditugaskan'
  if (po.sales_attribution_state !== 'assigned' || !po.sales_person_id_at_creation) return 'Belum diketahui'
  return po.sales_person_at_creation?.full_name?.trim() || 'Nama sales tidak tersedia'
}

/** Preview only. The create-PO transaction captures current authority at commit time. */
export async function fetchNewPOSalesPreview(customerId: string, signal?: AbortSignal): Promise<string | null> {
  let query = supabase.from('customer_manager_assignments')
    .select('manager_id, person:users!customer_manager_assignments_manager_id_fkey(id, full_name, is_active, role)')
    .eq('customer_id', customerId)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data?.manager_id) return null
  const person = singleRelation(data.person)
  if (!person || person.id !== data.manager_id) throw new Error('Penanggung jawab belum dapat diverifikasi.')
  if (!person.is_active || !['sales_person', 'sales_manager', 'sales_head', 'executive'].includes(person.role)) return null
  if (!person.full_name?.trim()) throw new Error('Nama sales belum tersedia.')
  return person.full_name
}
