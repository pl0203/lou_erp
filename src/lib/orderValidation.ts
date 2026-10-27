import { isValidPrice } from './catalogPricing'
type PricedLine = { quantity: number; unit_price: number; product_name: string }

/** Validate the whole payload before its first database write. Zero-price items are valid. */
export function validateOrderLines(lines: PricedLine[]): void {
  if (lines.length === 0) throw new Error('Pesanan harus memiliki minimal satu barang.')
  let total = 0
  for (const line of lines) {
    if (!line.product_name.trim()) throw new Error('Semua barang harus memiliki nama produk.')
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new Error('Jumlah barang harus berupa bilangan bulat positif.')
    }
    if (!isValidPrice(line.unit_price)) {
      throw new Error('Harga wajib diisi dengan angka nol atau positif, maksimal 2 angka desimal dan 999.999.999.999,99.')
    }
    total += line.quantity * line.unit_price
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
      throw new Error('Total pesanan terlalu besar.')
    }
  }
}
