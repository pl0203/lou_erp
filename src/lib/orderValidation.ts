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
    if (!Number.isFinite(line.unit_price) || line.unit_price < 0) {
      throw new Error('Harga harus berupa angka nol atau positif.')
    }
    total += line.quantity * line.unit_price
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
      throw new Error('Total pesanan terlalu besar.')
    }
  }
}
