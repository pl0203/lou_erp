import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const path = 'supabase/migrations/202610081101_demo_order_promotions.sql'
describe('reviewed order/promotion migration contract', () => {
  it('ships a forward migration with the explicit client endpoints', () => {
    expect(existsSync(path)).toBe(true)
    const sql = readFileSync(path, 'utf8')
    for (const name of ['pilot_promotions_v1', 'pilot_promotion_transaction_v1', 'pilot_reconcile_promotion_v1', 'edit_sj_returned_date', 'PROMO_STOCK_WARNING', 'PROMO_STOCK_CHANGED', 'execution_version']) expect(sql).toContain(name)
  })
  it('documents exact nullable tier prices and family-scoped durable receipts', () => {
    expect(existsSync('docs/demo-order-promotion-contracts.md')).toBe(true)
    const docs = readFileSync('docs/demo-order-promotion-contracts.md', 'utf8')
    for (const field of ['opening_quantity', 'expected_stock_version', 'quantity_delta', 'promo_stock_ack', 'PROMO_STOCK_CHANGED', 'allocation_quantity', 'execution_version', 'product_id', '300']) expect(docs).toContain(field)
  })
})
