export const PRICE_TIERS = ['harga_pokok', 'luar_kota', 'dalam_kota', 'depo_bangunan'] as const
export type PriceTier = typeof PRICE_TIERS[number]
export type CatalogPrices = Partial<Record<PriceTier, number | null>>
const MAX_PRICE = 999999999999.99
export function isValidPrice(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_PRICE && /^\d+(?:\.\d{1,2})?$/.test(String(value))
}
/** No other tier or legacy unit_price may substitute for a missing price. */
export function resolveCatalogPrice(prices: CatalogPrices | null | undefined, tier: string | null | undefined): number | null {
  if (!PRICE_TIERS.includes(tier as PriceTier)) return null
  const value = prices?.[tier as PriceTier]
  return typeof value === 'number' && isValidPrice(value) ? value : null
}
/** Promotions are explicit overrides, matching the server's exact-tier contract. */
export const resolvePromotionPrice = resolveCatalogPrice
export function parseCatalogPrice(text: string): number | null {
  const value = text.trim()
  if (!value) return null
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !isValidPrice(Number(value))) {
    throw new Error('Harga harus nol atau positif, maksimal 2 angka desimal dan 999.999.999.999,99.')
  }
  return Number(value)
}
export function formatCatalogPrice(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Belum diisi' : `Rp ${value.toLocaleString('id-ID')}`
}
export function formatLineAmount(quantity: number, price: number): string {
  return Number.isFinite(quantity) && Number.isFinite(price) ? `Rp ${(quantity * price).toLocaleString('id-ID')}` : 'Harga belum diisi'
}
