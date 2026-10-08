export type PromoShortage = {
  promotion_id: string; product_id: string; product_name: string; sku: string
  remaining_quantity: number; requested_quantity: number; incremental_quantity: number
  shortfall: number; stock_version: number
}
export type PromoAllocation = {
  promotion_id: string | null; product_id: string; product_name: string; sku: string
  remaining_quantity: number; requested_quantity: number; incremental_quantity: number
  allocation_quantity: number; stock_version: number | null
}
export type PromoStockWarning = { code: 'PROMO_STOCK_WARNING'; shortages: PromoShortage[]; ack: Record<string, unknown> }
export type PromoStockChanged = { code: 'PROMO_STOCK_CHANGED'; shortages: PromoShortage[]; allocations: PromoAllocation[]; ack: Record<string, unknown> }
export type PromoStockNotice = PromoStockWarning | PromoStockChanged
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function jsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 15) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => jsonSafe(item, depth + 1))
  return record(value) && Object.entries(value).every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && jsonSafe(item, depth + 1))
}
/** Never infer a stock quote from a message or a successful receipt. Ack is opaque server JSON. */
export function parsePromoStockWarning(details: unknown): PromoStockNotice | null {
  try {
    if (typeof details === 'string') { if (details.length > 131072) return null; details = JSON.parse(details) }
    if (!record(details) || !['PROMO_STOCK_WARNING', 'PROMO_STOCK_CHANGED'].includes(String(details.code)) || !Array.isArray(details.shortages) || (details.code === 'PROMO_STOCK_WARNING' && !details.shortages.length) || details.shortages.length > 500 || !record(details.ack) || !Object.keys(details.ack).length || !jsonSafe(details.ack)) return null
    const seen = new Set<string>()
    for (const row of details.shortages) {
      if (!record(row) || !uuid(row.promotion_id) || !uuid(row.product_id) || typeof row.product_name !== 'string' || !row.product_name.trim() || typeof row.sku !== 'string' || !['remaining_quantity', 'requested_quantity', 'incremental_quantity', 'shortfall', 'stock_version'].every(key => count(row[key]))) return null
      const valid = row as unknown as PromoShortage
      if (valid.requested_quantity < valid.incremental_quantity || valid.incremental_quantity <= valid.remaining_quantity || valid.shortfall !== valid.incremental_quantity - valid.remaining_quantity || valid.stock_version < 1 || seen.has(row.promotion_id as string)) return null
      seen.add(row.promotion_id as string)
    }
    if (details.code === 'PROMO_STOCK_CHANGED') {
      if (!Array.isArray(details.allocations) || details.allocations.length > 500) return null
      const products = new Set<string>(), campaigns = new Set<string>()
      for (const row of details.allocations) {
        if (!record(row) || !uuid(row.product_id) || typeof row.product_name !== 'string' || !row.product_name.trim() || typeof row.sku !== 'string' || !['remaining_quantity', 'requested_quantity', 'incremental_quantity', 'allocation_quantity'].every(key => count(row[key]))) return null
        const valid = row as unknown as PromoAllocation
        if (valid.requested_quantity < valid.incremental_quantity || products.has(valid.product_id)) return null
        if (valid.promotion_id === null) {
          if (valid.stock_version !== null || valid.remaining_quantity !== 0 || valid.allocation_quantity !== 0) return null
        } else {
          if (!uuid(valid.promotion_id) || !count(valid.stock_version) || valid.stock_version < 1 || campaigns.has(valid.promotion_id) || valid.allocation_quantity !== Math.min(valid.incremental_quantity, valid.remaining_quantity)) return null
          campaigns.add(valid.promotion_id)
        }
        products.add(valid.product_id)
      }
    }
    return JSON.parse(JSON.stringify(details)) as PromoStockNotice
  } catch { return null }
}
export class PromoStockWarningError extends Error {
  readonly code: PromoStockNotice['code']
  readonly warning: PromoStockNotice
  constructor(warning: PromoStockNotice) {
    super(warning.code === 'PROMO_STOCK_CHANGED' ? 'Alokasi promosi berubah. Periksa fakta terbaru sebelum melanjutkan.' : 'Stok promosi tidak mencukupi. Periksa jumlah sebelum melanjutkan.'); this.warning = warning; this.code = warning.code; this.name = 'PromoStockWarningError'
  }
}
