import { supabase } from './supabase'
import { PRICE_TIERS, isValidPrice } from './catalogPricing'
import type { CatalogPrices } from './catalogPricing'

export type ActivePromotion = CatalogPrices & {
  id: string; product_id: string; product_name: string; sku: string; size: string | null
  start_date: string; end_date: string; is_active: boolean; stock_managed: boolean
  remaining_quantity: number | null; stock_version: number; image_path: string | null
  products: { name: string; sku: string; size: string | null } | null
}
export function isCurrentlyActive(promo: Pick<ActivePromotion, 'is_active' | 'start_date' | 'end_date'> & Partial<Pick<ActivePromotion, 'stock_managed' | 'remaining_quantity'>>): boolean {
  if (promo.stock_managed) return promo.is_active && (promo.remaining_quantity ?? 0) > 0
  const today = new Date().toISOString().split('T')[0]
  return promo.is_active && promo.start_date <= today && promo.end_date >= today
}
export function promotionStatus(promo: ActivePromotion): string {
  if (!promo.is_active) return 'Dijeda'
  if (promo.stock_managed) return promo.remaining_quantity === 0 ? 'Stok habis' : 'Berjalan'
  return isCurrentlyActive(promo) ? 'Legacy · aktif' : 'Legacy · tidak berjalan'
}
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export async function fetchPromotions(signal?: AbortSignal, includeInactive = false): Promise<ActivePromotion[]> {
  signal?.throwIfAborted()
  let request = supabase.rpc('pilot_promotions_v1', { p_include_inactive: includeInactive })
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  signal?.throwIfAborted()
  if (error) throw error
  if (!data || data.version !== 1 || typeof data.as_of !== 'string' || !Number.isFinite(Date.parse(data.as_of)) || !Array.isArray(data.items)) throw new Error('Data promosi belum lengkap. Coba lagi.')
  const seen = new Set<string>()
  return data.items.map((row: Record<string, unknown>) => {
    if (!row || !uuid(row.id) || !uuid(row.product_id) || typeof row.product_name !== 'string' || typeof row.sku !== 'string' || (row.size !== null && typeof row.size !== 'string') || typeof row.is_active !== 'boolean' || typeof row.stock_managed !== 'boolean' || typeof row.start_date !== 'string' || typeof row.end_date !== 'string' || !Number.isSafeInteger(row.stock_version) || (row.stock_version as number) < 0 || (row.image_path !== null && typeof row.image_path !== 'string') || seen.has(row.id as string)) throw new Error('Data promosi tidak valid. Coba lagi.')
    if (row.stock_managed && (!Number.isSafeInteger(row.remaining_quantity) || (row.remaining_quantity as number) < 0 || (row.stock_version as number) < 1 || !row.image_path)) throw new Error('Data stok promosi tidak valid. Coba lagi.')
    if (!row.stock_managed && row.remaining_quantity !== null) throw new Error('Data stok legacy tidak valid. Coba lagi.')
    if (!PRICE_TIERS.every(tier => row[tier] === null || typeof row[tier] === 'number' && isValidPrice(row[tier] as number))) throw new Error('Data harga promosi tidak valid. Coba lagi.')
    seen.add(row.id as string)
    return { ...row, products: { name: row.product_name as string, sku: row.sku as string, size: row.size as string | null } } as ActivePromotion
  })
}
/** The server alone authorizes the canonical linked promotion and signs a five-minute capability. */
export async function fetchPromotionImage(promotionId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('promotion-image-url', { body: { promotion_id: promotionId } })
  if (error) throw error
  if (!data || data.promotion_id !== promotionId || data.expires_in !== 300 || typeof data.signed_url !== 'string' || !/^https:\/\//.test(data.signed_url)) throw new Error('Tautan gambar promosi tidak valid. Coba lagi.')
  return data.signed_url
}
