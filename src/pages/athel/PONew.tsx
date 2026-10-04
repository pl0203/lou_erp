import { POCustomerLookup, POProductLookup } from '../../components/POLookup'
import { POLineItemsHeader, POLineRow } from '../../components/POLineItems'
import { resolveCatalogPrice } from '../../lib/catalogPricing'
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
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const productSearch = useRef<HTMLInputElement>(null)
  const quantityInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const nameInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const priceInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const pendingFocus = useRef<{ key: string; field: 'quantity' | 'name' } | null>(null)
  const [entryNotice, setEntryNotice] = useState('')
  const [entryError, setEntryError] = useState<{ key: string; message: string } | null>(null)
  const itemsDirty = lineItems.length > 0 && hasOrderItemChanges(lineItems)
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

  const addLine = () => {
    const key = crypto.randomUUID()
    pendingFocus.current = { key, field: 'name' }
    setEntryError(null); setEntryNotice('')
    setLineItems(prev => [...prev, { ...newLine(), _key: key }])
  }

  const removeLine = (index: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  const focusQuantity = (key: string) => {
    const input = quantityInputs.current[key]
    if (input) { input.focus(); input.select(); input.scrollIntoView?.({ block: 'nearest' }) }
    else pendingFocus.current = { key, field: 'quantity' }
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
    setLineItems(prev => [...prev, { ...newLine(), product_id: product.id, product_name: product.name, sku: product.sku, quantity: 1, unit_price: resolveCatalogPrice(product, pricingTier) ?? Number.NaN }])
    productSearch.current?.focus()
  }
  const validateLine = (item: LineItem) => {
    try {
      validateOrderLines([item])
    } catch (error) {
      setEntryError({ key: item._key!, message: (error as Error).message })
      if (!item.product_name.trim()) nameInputs.current[item._key!]?.focus()
      else if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) quantityInputs.current[item._key!]?.focus()
      else priceInputs.current[item._key!]?.focus()
      return false
    }
    return true
  }

  const total = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)

  const handleSubmit = () => {
    if (!customerId) return alert('Pilih pelanggan terlebih dahulu.')
    if (!poNumber.trim()) return alert('Masukkan nomor PO terlebih dahulu.')
    if (lineItems.length === 0) {
      alert('PO harus memiliki minimal satu barang.')
      productSearch.current?.focus()
      return
    }
    if (!lineItems.every(validateLine)) return
    setEntryError(null)
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
                    setLineItems([])
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
            <p className="text-xs text-gray-500 mt-1">Ketik SKU tepat lalu Enter, atau klik hasil pencarian untuk menambahkan barang. Ulangi pencarian untuk barang berikutnya.</p>
            {entryNotice && <p role="status" className="text-xs text-blue-700 mt-2">{entryNotice}</p>}
          </div>

          {lineItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">Belum ada barang. Cari SKU atau nama untuk menambahkan barang.</p>
          ) : (
            <div className="min-w-0 space-y-2">
              <POLineItemsHeader />
              {lineItems.map((item, i) => (
                <POLineRow key={item._key} lineKey={item._key!} item={item}
                  onChange={(field, value) => updateLine(i, field, value)}
                  onRemove={() => removeLine(i)}
                  nameRef={node => {
                    nameInputs.current[item._key!] = node
                    if (node && pendingFocus.current?.key === item._key && pendingFocus.current.field === 'name') { node.focus(); pendingFocus.current = null }
                  }}
                  quantityRef={node => {
                    quantityInputs.current[item._key!] = node
                    if (node && pendingFocus.current?.key === item._key && pendingFocus.current.field === 'quantity') { node.focus(); node.select(); pendingFocus.current = null }
                  }}
                  priceRef={node => { priceInputs.current[item._key!] = node }}
                  error={entryError?.key === item._key ? entryError.message : undefined} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100">
            <button type="button" onClick={addLine} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
              + Tambah barang manual
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
