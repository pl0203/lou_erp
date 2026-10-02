import { POCustomerLookup, POProductLookup } from '../../components/POLookup'
import { resolveCatalogPrice, formatLineAmount } from '../../lib/catalogPricing'
import ReadFailure from '../../components/ReadFailure'
import { readCompleteQuery } from '../../lib/reads/completeQuery'
import TransactionRecovery from '../../components/TransactionRecovery'
import { createTransactionSender, useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { validateOrderLines } from '../../lib/orderValidation'
import { hasOrderItemChanges, useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type LineItem = {
  _key?: string
  product_id: string | null
  product_name: string
  sku: string
  quantity: number
  unit_price: number
}

type Customer = {
  id: string
  name: string
  pricing_tier: string
}

type Product = {
  id: string
  name: string
  sku: string
  size: string | null
  unit_price: number | null
  harga_pokok: number | null
  luar_kota: number | null
  dalam_kota: number | null
  depo_bangunan: number | null
}

const EMPTY_LINE: LineItem = {
  product_id: null,
  product_name: '',
  sku: '',
  quantity: 1,
  unit_price: Number.NaN,
}

const newLine = (): LineItem => ({ ...EMPTY_LINE, _key: crypto.randomUUID() })

const TIER_LABELS: Record<string, string> = {
  harga_pokok:   'Harga Pokok',
  luar_kota:     'Luar Kota',
  dalam_kota:    'Dalam Kota',
  depo_bangunan: 'Depo Bangunan',
  others: 'Others',
}

async function fetchCustomers(signal?: AbortSignal): Promise<Customer[]> {
  const data = await readCompleteQuery((offset, limit) => supabase
    .from('customers')
    .select('id, name, pricing_tier', { count: 'exact' })
    .order('id')
    .range(offset, offset + limit - 1), row => row.id, signal)
  return data.sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  const data = await readCompleteQuery((offset, limit) => supabase
    .from('products')
    .select('id, name, sku, size, unit_price, harga_pokok, luar_kota, dalam_kota, depo_bangunan', { count: 'exact' })
    .order('id')
    .range(offset, offset + limit - 1), row => row.id, signal)
  return data.sort((a, b) => a.name.localeCompare(b.name))
}

export async function createPO(payload: {
  customer_id: string; po_number: string; order_date: string; expected_delivery_date: string; notes: string; lineItems: LineItem[]
}, send: TransactionSender = createTransactionSender()) {
  validateOrderLines(payload.lineItems)
  return send('create_po', {
    customer_id: payload.customer_id, po_number: payload.po_number, order_date: payload.order_date,
    expected_delivery_date: payload.expected_delivery_date || null, notes: payload.notes || null, items: payload.lineItems.map(({ _key, ...line }) => line),
  })
}

export default function PONew() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sendTransaction = useTransactionSender('new-po')
  const [customerId, setCustomerId] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [initialOrderDate] = useState(() => new Date().toISOString().split('T')[0])
  const [orderDate, setOrderDate] = useState(initialOrderDate)
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>(() => [newLine()])
  const productSearch = useRef<HTMLInputElement>(null)
  const quantityInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const nameInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const priceInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const pendingFocus = useRef<string | null>(null)
  const [entryNotice, setEntryNotice] = useState('')
  const [entryError, setEntryError] = useState<{ key: string; message: string } | null>(null)
  const itemsDirty = hasOrderItemChanges(lineItems)
  const unsaved = useUnsavedChanges(!!customerId || !!poNumber || !!expectedDelivery || !!notes || orderDate !== initialOrderDate || itemsDirty)

  const { data: customers, isError: customerReadError, isFetching: customersFetching, refetch: retryCustomers } = useQuery({ queryKey: ['customers'], queryFn: ({ signal }) => fetchCustomers(signal) })
  const { data: products, isError: productReadError, isFetching: productsFetching, refetch: retryProducts } = useQuery({ queryKey: ['products', 'complete', 'po-new'], queryFn: ({ signal }) => fetchProducts(signal) })

  const onCommitted = (po: { id: string }) => {
    queryClient.invalidateQueries()
    unsaved.runWithoutPrompt(() => navigate(`/athel/po/${po.id}`))
  }

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof createPO>[0]) => createPO(payload, sendTransaction),
    onSuccess: onCommitted,
  })

  // Get selected customer's pricing tier
  const selectedCustomer = customers?.find(c => c.id === customerId)
  const pricingTier = selectedCustomer?.pricing_tier ?? 'others'

  const updateLine = (index: number, field: keyof LineItem, value: string | number | null) => {
    setLineItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const fillFromProduct = (index: number, product: Product) => {
    const sku = product.sku.trim().toLocaleLowerCase()
    const existing = lineItems.find((line, i) => i !== index && (line.product_id === product.id || (sku && line.sku.trim().toLocaleLowerCase() === sku)))
    if (existing) {
      setEntryNotice(`${product.sku} sudah ada. Jumlah dan harga tetap; periksa barang yang difokuskan.`)
      focusQuantity(existing._key!)
      return
    }
    setEntryError(null); setEntryNotice('')
    pendingFocus.current = lineItems[index]._key!
    const price = resolveCatalogPrice(product, pricingTier) ?? Number.NaN
    setLineItems(prev => prev.map((item, i) =>
      i === index
        ? { ...item, product_id: product.id, product_name: product.name, sku: product.sku, unit_price: price }
        : item
    ))
  }

  const addLine = () => setLineItems(prev => [...prev, newLine()])
  const removeLine = (index: number) => {
    if (lineItems.length === 1) return
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  const focusQuantity = (key: string) => {
    const input = quantityInputs.current[key]
    if (input) { input.focus(); input.select(); input.scrollIntoView?.({ block: 'nearest' }) }
    else pendingFocus.current = key
  }
  const addProduct = (product: Product) => {
    const sku = product.sku.trim().toLocaleLowerCase()
    const existing = lineItems.find(line => line.product_id === product.id || (sku && line.sku.trim().toLocaleLowerCase() === sku))
    if (existing) {
      setEntryNotice(`${product.sku} sudah ada. Jumlah dan harga tetap; periksa barang yang difokuskan.`)
      focusQuantity(existing._key!)
      return
    }
    setEntryNotice(''); setEntryError(null)
    const pristine = lineItems.find(line => line.product_id === null && !line.product_name && !line.sku && line.quantity === 1 && Number.isNaN(line.unit_price))
    const key = pristine?._key ?? crypto.randomUUID()
    pendingFocus.current = key
    const next = { ...newLine(), _key: key, product_id: product.id, product_name: product.name, sku: product.sku, quantity: 1, unit_price: resolveCatalogPrice(product, pricingTier) ?? Number.NaN }
    setLineItems(prev => pristine ? prev.map(line => line._key === key ? next : line) : [...prev, next])
  }
  const addAndNext = (item: LineItem) => {
    try {
      validateOrderLines([item])
    } catch (error) {
      setEntryError({ key: item._key!, message: (error as Error).message })
      if (!item.product_name.trim()) nameInputs.current[item._key!]?.focus()
      else if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) quantityInputs.current[item._key!]?.focus()
      else priceInputs.current[item._key!]?.focus()
      return
    }
    setEntryError(null); setEntryNotice('')
    productSearch.current?.focus()
  }

  const total = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)

  const handleSubmit = () => {
    if (!customerId) return alert('Pilih pelanggan terlebih dahulu.')
    if (!poNumber.trim()) return alert('Masukkan nomor PO terlebih dahulu.')
    if (lineItems.some(l => !l.product_name.trim())) return alert('Semua barang harus memiliki nama produk.')
    mutation.mutate({
      customer_id: customerId,
      po_number: poNumber,
      order_date: orderDate,
      expected_delivery_date: expectedDelivery,
      notes,
      lineItems,
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {unsaved.dialog}
      <AthelNav />
      {(customerReadError || productReadError) && <ReadFailure onRetry={() => { void retryCustomers(); void retryProducts() }} />}
        <TransactionRecovery send={sendTransaction} onCommitted={onCommitted} />
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <button type="button" onClick={() => navigate('/athel/po')} className="text-gray-400 hover:text-gray-600 text-sm">
          ← Kembali
        </button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">PO Baru</h1>
          <p className="text-sm text-gray-500 mt-0.5">Athel — Manajemen PO</p>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

        {/* Detail Pesanan */}
        <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Detail Pesanan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Pelanggan</label>
              <POCustomerLookup customers={customers ?? []} selectedId={customerId} disabled={!customers || customerReadError || customersFetching || mutation.isPending}
                onSelect={customer => {
                  const nextCustomer = customer.id
                  if (nextCustomer === customerId) return
                  unsaved.confirmDiscard(() => {
                    setCustomerId(nextCustomer)
                    setLineItems([newLine()])
                    setEntryError(null); setEntryNotice('')
                  }, { when: itemsDirty, message: 'Mengganti pelanggan akan menghapus daftar barang dan harga yang sudah diisi. Detail PO lainnya tetap dipertahankan. Permintaan yang sudah dikirim tidak dibatalkan.' })
                }} />
              {selectedCustomer && (
                <p className="text-xs text-blue-600 mt-1">
                  Tier harga: <span className="font-medium">{TIER_LABELS[pricingTier]}</span>
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Nomor PO</label>
              <input
                type="text"
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                placeholder="mis. PO-2024-001"
                className="min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tanggal PO</label>
              <input
                type="date"
                value={orderDate}
                onChange={e => setOrderDate(e.target.value)}
                className="min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="po-expiry" className="block text-sm text-gray-600 mb-1">Tanggal Kedaluwarsa PO (opsional)</label>
              <input
                id="po-expiry"
                type="date"
                value={expectedDelivery}
                onChange={e => setExpectedDelivery(e.target.value)}
                className="min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">Jika PO pelanggan memiliki tanggal kedaluwarsa. Bukan tanggal pengiriman.</p>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Catatan</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Catatan (opsional)..."
                className="min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Daftar Barang */}
        <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900 mb-1">Daftar Barang</h2>
          <p className="text-xs text-gray-400 mb-4">
            Cari berdasarkan SKU atau nama untuk mengisi otomatis. Harga otomatis sesuai tier pelanggan dan dapat diubah per pesanan.
          </p>

          {!customerId && (
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-4 py-3 mb-4">
              <p className="text-xs text-yellow-700">Pilih pelanggan terlebih dahulu agar harga otomatis sesuai tier.</p>
            </div>
          )}

          <div className="mb-4 min-w-0">
            <label className="block text-sm font-medium text-gray-700 mb-1">Cari SKU atau nama barang</label>
            <POProductLookup products={products ?? []} inputRef={productSearch} onSelect={addProduct}
              disabled={!customerId || !selectedCustomer || !products || !customers || customerReadError || productReadError || customersFetching || productsFetching || mutation.isPending} />
            <p className="text-xs text-gray-500 mt-1">Ketik SKU tepat lalu Enter, atau gunakan ↑ ↓ dan Enter untuk memilih. Isi Qty dan harga, lalu Tambah & berikutnya.</p>
            {entryNotice && <p role="status" className="text-xs text-blue-700 mt-2">{entryNotice}</p>}
          </div>

          <div className="space-y-4">
            {lineItems.map((item, i) => (
              <div key={item._key} data-po-line={item._key} className="border border-gray-100 rounded-lg p-4 space-y-3 relative">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                  <div className="min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">Cari barang berdasarkan SKU atau nama</label>
                    {products && (
                      <POProductLookup
                        products={products}
                        label="Ganti barang berdasarkan SKU atau nama"
                        disabled={!selectedCustomer || customersFetching || productsFetching || customerReadError || productReadError || mutation.isPending}
                        onSelect={p => fillFromProduct(i, p)}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    disabled={lineItems.length === 1}
                    className="w-8 text-gray-300 hover:text-red-400 disabled:opacity-20 text-xl text-center pb-1"
                  >
                    ×
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="min-w-0 sm:col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">SKU</label>
                    <input
                      type="text"
                      value={item.sku}
                      onChange={e => updateLine(i, 'sku', e.target.value)}
                      className="min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-2 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                    />
                  </div>
                  <div className="min-w-0 sm:col-span-4">
                    <label className="block text-xs text-gray-400 mb-1">Nama Produk</label>
                    <input
                      type="text"
                      ref={node => { nameInputs.current[item._key!] = node }}
                      value={item.product_name}
                      onChange={e => updateLine(i, 'product_name', e.target.value)}
                      placeholder="Nama produk"
                      className="min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Qty</label>
                    <input
                      type="number" min={1} step={1} inputMode="numeric"
                      aria-label={`Qty ${item.product_name || 'barang baru'}`}
                      ref={node => {
                        quantityInputs.current[item._key!] = node
                        if (node && pendingFocus.current === item._key) { node.focus(); node.select(); pendingFocus.current = null }
                      }}
                      value={Number.isNaN(item.quantity) ? '' : item.quantity}
                      onChange={e => updateLine(i, 'quantity', e.target.valueAsNumber)}
                      className="min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="min-w-0 sm:col-span-4">
                    <label className="block text-xs text-gray-400 mb-1">
                      Harga Satuan (Rp)
                      {item.product_id && (
                        <span className="text-blue-400 ml-1">— dapat diubah</span>
                      )}
                    </label>
                    <input
                      type="number" min={0} step="0.01"
                      aria-label="Harga satuan"
                      inputMode="decimal"
                      ref={node => { priceInputs.current[item._key!] = node }}
                      required
                      placeholder="Harga belum diisi"
                      value={Number.isNaN(item.unit_price) ? '' : item.unit_price}
                      onChange={e => updateLine(i, 'unit_price', e.target.valueAsNumber)}
                      className="min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {entryError?.key === item._key && <p role="alert" className="text-xs text-red-700">{entryError.message}</p>}
                <button type="button" onClick={() => addAndNext(item)} disabled={mutation.isPending || productsFetching || customersFetching || customerReadError || productReadError}
                  className="w-full sm:w-auto rounded-lg border border-blue-200 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">Tambah & berikutnya</button>
                {Number.isNaN(item.unit_price) && <p className="text-xs text-amber-700">Isi harga satuan sebelum menyimpan. Nol hanya untuk barang gratis.</p>}
                  <div className="text-right text-xs text-gray-400 [overflow-wrap:anywhere]">
                  Subtotal: <span className="text-gray-700 font-medium">
                    {formatLineAmount(item.quantity, item.unit_price)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100">
            <button type="button" onClick={addLine} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
              + Tambah Produk
            </button>
            <div className="min-w-0 text-sm text-gray-500 [overflow-wrap:anywhere]">
              Total: <span className="text-gray-900 font-semibold text-base ml-1">
                {Number.isFinite(total) ? `Rp ${total.toLocaleString('id-ID')}` : 'Harga belum lengkap'}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap justify-end gap-3 pb-8">
          <button
            type="button"
            onClick={() => navigate('/athel/po')}
            className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending || customerReadError || productReadError || !customers || !products || customersFetching || productsFetching}
            className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Menyimpan...' : 'Simpan PO'}
          </button>
        </div>

        {mutation.isError && (
          <p className="text-red-500 text-sm text-right">{(mutation.error as Error).message}</p>
        )}
      </div>
    </div>
  )
}
