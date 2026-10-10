import { parseCustomerCategory } from './customerCategory'

/** Cached older projections must fail visibly too, before a render tries to label them. */
export function hasInvalidCustomerCategories(rows: readonly { customer_category: unknown }[]) {
  try {
    rows.forEach(row => parseCustomerCategory(row.customer_category, { allowUnclassified: true }))
    return false
  } catch {
    return true
  }
}
