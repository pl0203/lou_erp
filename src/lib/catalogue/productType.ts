/** Persisted catalogue labels; do not normalize or infer legacy classifications. */
export const PRODUCT_TYPES = ['Bonbon', 'Bak Cuci Piring', 'Wastafel', 'Batu Taman', 'Granite', 'Closet', 'Listello', 'Mosaic', 'Meja', 'Andesit', 'Pola', 'House Plint', 'Rumput Sintetis', 'Teracotta', 'Gentong', 'Air Mancur', 'Step Nosing'] as const
export type ProductType = typeof PRODUCT_TYPES[number]
