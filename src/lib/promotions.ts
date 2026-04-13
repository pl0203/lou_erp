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

export async function fetchPromotions(): Promise<ActivePromotion[]> {
  const { data, error } = await supabase
    .from('promotions')
    .select('id, start_date, end_date, is_active, products(name, sku, size)')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ActivePromotion[]
}
