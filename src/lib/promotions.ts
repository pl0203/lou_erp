import { readCompleteQuery } from './reads/completeQuery'
import { singleRelation } from './relations'
import { supabase } from './supabase'

export type ActivePromotion = {
  id: string
  start_date: string
  end_date: string
  is_active: boolean
  products: { name: string; sku: string; size: string | null } | null
}

export function isCurrentlyActive(promo: ActivePromotion): boolean {
  const today = new Date().toISOString().split('T')[0]
  return promo.is_active && promo.start_date <= today && promo.end_date >= today
}

export async function fetchPromotions(signal?: AbortSignal): Promise<ActivePromotion[]> {
  const data = await readCompleteQuery((offset, limit) => supabase.from('promotions')
    .select('id, start_date, end_date, is_active, products(name, sku, size)', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1), row => row.id, signal)
  return data.map(row => ({ ...row, products: singleRelation(row.products) }))
}
