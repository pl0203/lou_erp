/** Only a current, accepted authorized catalogue read may annotate an order. */
export interface CurrentProductTypes {
  data?: readonly { id: string; product_type?: string | null }[]
  isFetching?: boolean
  isError?: boolean
  isPaused?: boolean
}
export function currentProductTypeLabel(productId: string | null | undefined, state?: CurrentProductTypes): string {
  if (!productId || !state?.data || state.isFetching || state.isError || state.isPaused) return 'Tidak tersedia'
  const row = state.data.find(product => product.id === productId)
  return row && Object.hasOwn(row, 'product_type') ? row.product_type ?? '—' : 'Tidak tersedia'
}
