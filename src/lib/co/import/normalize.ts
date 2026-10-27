import type { Money } from '../contracts'
import { minorUnits, parseMoney } from '../validation'
import type { SourceRow, SourceNumber } from './types'

export function sourceMoney(value: SourceNumber | null): Money | null {
  if (value?.decimal == null) return null
  try { return parseMoney(value.decimal) } catch { return null }
}
export function moneyFromMinor(value: bigint): Money {
  if (value < 0n) throw new RangeError('Negative source amount')
  return parseMoney(`${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`)
}
/** Evidence only: never CO allocation prices, revenue, or return-adjusted sales. */
export function summarizeSource(rows: SourceRow[]): {unitPrice: Money | 'multiple' | null; amount: Money | null} {
  if (!rows.length) return {unitPrice:null,amount:null}
  const currencies = new Set(rows.map(row => row.currency))
  const coherentCurrency = currencies.size === 1 && !currencies.has(null)
  let amount = 0n
  let amountKnown = coherentCurrency
  const prices = new Map<string,Money>()
  let priceKnown = coherentCurrency
  for (const row of rows) {
    const value = sourceMoney(row.amount)
    if (value === null) amountKnown = false
    else amount += minorUnits(value)
    const price = sourceMoney(row.unitPrice)
    if (price === null || !row.unit) priceKnown = false
    else prices.set(JSON.stringify([minorUnits(price).toString(),row.unit,row.currency,row.priceBasisLabel]),price)
  }
  return {unitPrice:prices.size > 1 ? 'multiple' : priceKnown ? [...prices.values()][0] ?? null : null,amount:amountKnown ? moneyFromMinor(amount) : null}
}
/** Exact SKU candidates only; ambiguity remains explicit and no decision is mutated. */
export function suggestSkuMatches(row:SourceRow,catalog:{stockKeyId:string;sku:string;name:string;unit:string}[]):string[] {
  if (!row.sourceSku?.trim()) return []
  const sku=row.sourceSku.trim().toLocaleUpperCase('en-US')
  return [...new Set(catalog.filter(item=>item.sku.trim().toLocaleUpperCase('en-US')===sku).map(item=>item.stockKeyId))]
}
