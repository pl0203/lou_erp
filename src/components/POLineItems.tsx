import type { Ref } from 'react'
import { formatLineAmount } from '../lib/catalogPricing'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

const COLUMNS = 'sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2.4fr)_minmax(0,.8fr)_minmax(0,1.5fr)_2.75rem]'
const INPUT = 'min-h-11 min-w-0 max-w-full w-full border border-brand-control-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand-primary disabled:bg-gray-50 disabled:text-brand-secondary'
export function exactCatalogIdentity(sku: string, products: { id: string; sku: string }[]): string | null {
  const normalized = sku.trim().toLocaleLowerCase()
  if (!normalized) return null
  const matches = products.filter(product => product.sku.trim().toLocaleLowerCase() === normalized)
  return matches.length === 1 ? matches[0].id : null
}

type Line = { product_id?: string | null; sku: string; product_name: string; quantity: number; unit_price: number }
type LineField = keyof Line

export function POLineItemsHeader() {
  return <div aria-hidden="true" className={`hidden sm:grid ${COLUMNS} gap-2 px-3 text-[13px] text-brand-secondary`}>
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
  const id = `po-line-${lineKey}`
  const errorId = error ? `${id}-error` : undefined
  return <div data-po-line={lineKey} className="min-w-0 rounded-lg border border-gray-100 bg-white p-3 space-y-2">
    <div className={`grid grid-cols-1 ${COLUMNS} gap-2 items-end`}>
      <Field id={`${id}-sku`} label="SKU" className="min-w-0">{control => <input {...control} aria-describedby={errorId} aria-invalid={error ? true : undefined} type="text" aria-label={`SKU ${name}`} disabled={historical} value={item.sku}
          onChange={event => onChange('sku', event.target.value)} className={`${INPUT} font-mono uppercase`} />}</Field>
      <Field id={`${id}-name`} label="Nama Produk" className="min-w-0">{control => <input {...control} aria-describedby={errorId} aria-invalid={error ? true : undefined} type="text" aria-label={`Nama produk ${name}`} placeholder="Nama produk" ref={nameRef} disabled={historical} value={item.product_name}
          onChange={event => onChange('product_name', event.target.value)} className={INPUT} />}</Field>
      <Field id={`${id}-quantity`} label="Qty" className="min-w-0">{control => <input {...control} aria-describedby={errorId} aria-invalid={error ? true : undefined} type="number" min={minimumQuantity} step={1} inputMode="numeric" aria-label={`Qty ${name}`} ref={quantityRef}
          value={Number.isNaN(item.quantity) ? '' : item.quantity} onChange={event => onChange('quantity', event.target.valueAsNumber)} className={INPUT} />}</Field>
      <Field id={`${id}-price`} label="Harga Satuan (Rp)" className="min-w-0">{control => <input {...control} aria-describedby={[errorId, Number.isNaN(item.unit_price) ? `${id}-price-hint` : undefined].filter(Boolean).join(' ') || undefined} aria-invalid={error ? true : undefined} type="number" min={0} step="0.01" inputMode="decimal" aria-label="Harga satuan" ref={priceRef} required disabled={historical}
          placeholder="Harga belum diisi" value={Number.isNaN(item.unit_price) ? '' : item.unit_price}
          onChange={event => onChange('unit_price', event.target.valueAsNumber)} className={INPUT} />}</Field>
      <Button variant="danger" type="button" aria-label={`Hapus ${name}`} disabled={historical} onClick={onRemove}
        title={historical ? 'Barang dengan riwayat pengiriman tidak dapat dihapus.' : 'Hapus barang'}
        className="justify-self-end px-2 text-xl">×</Button>
    </div>
    {item.product_id === null && <p className="text-[13px] text-amber-700">Identitas katalog belum terhubung. SKU harus cocok tepat dan unik untuk alokasi stok promosi; barang manual tetap dapat disimpan.</p>}
    {item.product_id && <p className="text-[13px] text-brand-secondary">Produk katalog terhubung</p>}
    {error && <p id={errorId} role="alert" className="text-[13px] text-red-700">{error}</p>}
    {historical && <p className="text-[13px] text-brand-secondary">Riwayat pengiriman mengunci produk, SKU, harga, dan penghapusan barang. Jumlah minimal {minimumQuantity} (terkirim aktif: {deliveredQuantity}).</p>}
    {Number.isNaN(item.unit_price) && <p id={`${id}-price-hint`} className="text-[13px] text-amber-700">Isi harga satuan sebelum menyimpan. Nol hanya untuk barang gratis.</p>}
    <div className="text-right text-[13px] text-brand-secondary [overflow-wrap:anywhere]">Subtotal: <span className="text-gray-700 font-medium">{formatLineAmount(item.quantity, item.unit_price)}</span></div>
  </div>
}
