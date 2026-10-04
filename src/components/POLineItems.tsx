import type { Ref } from 'react'
import { formatLineAmount } from '../lib/catalogPricing'

const COLUMNS = 'sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2.4fr)_minmax(0,.8fr)_minmax(0,1.5fr)_2.5rem]'
const INPUT = 'min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500'
const LABEL = 'block text-xs text-gray-500 mb-1 sm:hidden'
type Line = { sku: string; product_name: string; quantity: number; unit_price: number }
type LineField = keyof Line

export function POLineItemsHeader() {
  return <div aria-hidden="true" className={`hidden sm:grid ${COLUMNS} gap-2 px-3 text-xs text-gray-500`}>
    <span>SKU</span><span>Nama Produk</span><span>Qty</span><span>Harga Satuan (Rp)</span><span className="sr-only">Hapus</span>
  </div>
}

/** One compact editable row. Catalog entry stays in the shared lookup above this list. */
export function POLineRow({ lineKey, item, onChange, onRemove, historical = false, minimumQuantity = 1, deliveredQuantity = 0, nameRef, quantityRef, priceRef, error }: {
  lineKey: string; item: Line; onChange: (field: LineField, value: string | number) => void; onRemove: () => void
  historical?: boolean; minimumQuantity?: number; deliveredQuantity?: number
  nameRef: Ref<HTMLInputElement>; quantityRef: Ref<HTMLInputElement>; priceRef: Ref<HTMLInputElement>; error?: string
}) {
  const name = item.product_name || 'barang baru'
  return <div data-po-line={lineKey} className="min-w-0 rounded-lg border border-gray-100 bg-white p-3 space-y-2">
    <div className={`grid grid-cols-1 ${COLUMNS} gap-2 items-end`}>
      <div className="min-w-0">
        <label className={LABEL}>SKU</label>
        <input type="text" aria-label={`SKU ${name}`} disabled={historical} value={item.sku}
          onChange={event => onChange('sku', event.target.value)} className={`${INPUT} font-mono uppercase`} />
      </div>
      <div className="min-w-0">
        <label className={LABEL}>Nama Produk</label>
        <input type="text" aria-label={`Nama produk ${name}`} placeholder="Nama produk" ref={nameRef} disabled={historical} value={item.product_name}
          onChange={event => onChange('product_name', event.target.value)} className={INPUT} />
      </div>
      <div className="min-w-0">
        <label className={LABEL}>Qty</label>
        <input type="number" min={minimumQuantity} step={1} inputMode="numeric" aria-label={`Qty ${name}`} ref={quantityRef}
          value={Number.isNaN(item.quantity) ? '' : item.quantity} onChange={event => onChange('quantity', event.target.valueAsNumber)} className={INPUT} />
      </div>
      <div className="min-w-0">
        <label className={LABEL}>Harga Satuan (Rp)</label>
        <input type="number" min={0} step="0.01" inputMode="decimal" aria-label="Harga satuan" ref={priceRef} required disabled={historical}
          placeholder="Harga belum diisi" value={Number.isNaN(item.unit_price) ? '' : item.unit_price}
          onChange={event => onChange('unit_price', event.target.valueAsNumber)} className={INPUT} />
      </div>
      <button type="button" aria-label={`Hapus ${name}`} disabled={historical} onClick={onRemove}
        title={historical ? 'Barang dengan riwayat pengiriman tidak dapat dihapus.' : 'Hapus barang'}
        className="h-10 w-10 justify-self-end rounded-lg text-xl text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400">×</button>
    </div>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {historical && <p className="text-xs text-gray-500">Riwayat pengiriman mengunci produk, SKU, harga, dan penghapusan barang. Jumlah minimal {minimumQuantity} (terkirim aktif: {deliveredQuantity}).</p>}
    {Number.isNaN(item.unit_price) && <p className="text-xs text-amber-700">Isi harga satuan sebelum menyimpan. Nol hanya untuk barang gratis.</p>}
    <div className="text-right text-xs text-gray-400 [overflow-wrap:anywhere]">Subtotal: <span className="text-gray-700 font-medium">{formatLineAmount(item.quantity, item.unit_price)}</span></div>
  </div>
}
