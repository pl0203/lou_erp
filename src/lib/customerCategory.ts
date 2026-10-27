/** Business classification only. A category never chooses or changes a price tier. */
export const CUSTOMER_CATEGORIES = Object.freeze([
  Object.freeze({ value: 'supermarket_besar', label: 'Supermarket Besar' } as const),
  Object.freeze({ value: 'supermarket_sedang', label: 'Supermarket Sedang' } as const),
  Object.freeze({ value: 'supermarket_kecil', label: 'Supermarket Kecil' } as const),
  Object.freeze({ value: 'tradisional_market', label: 'Tradisional Market' } as const),
  Object.freeze({ value: 'perorangan', label: 'Perorangan' } as const),
] as const)

export type CustomerCategory = typeof CUSTOMER_CATEGORIES[number]['value']

/** New input is required; only an explicitly reviewed legacy null is Unclassified. */
export function parseCustomerCategory(value: unknown, options?: { allowUnclassified?: boolean }): CustomerCategory | null {
  if (value === null && options?.allowUnclassified === true) return null
  if (value === null || value === undefined || value === '') throw new Error('Customer category is required.')
  const choice = CUSTOMER_CATEGORIES.find(category => category.value === value)
  if (!choice) throw new Error('Invalid customer category.')
  return choice.value
}

/** Invalid stored values fail visibly rather than silently becoming Unclassified. */
export function formatCustomerCategory(value: unknown): string {
  const parsed = parseCustomerCategory(value, { allowUnclassified: true })
  if (parsed === null) return 'Unclassified'
  return CUSTOMER_CATEGORIES.find(category => category.value === parsed)!.label
}
