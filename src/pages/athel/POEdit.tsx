import { resolveCatalogPrice, formatLineAmount } from '../../lib/catalogPricing'
import { fetchCompletePOLines, fetchCompleteRows, priceForEdit } from '../../lib/reads/detailReads'
import TransactionRecovery from '../../components/TransactionRecovery'
import { createTransactionSender, useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { singleRelation } from '../../lib/relations'
import { validateOrderLines } from '../../lib/orderValidation'
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

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

type LineItemRow = {
  id: string | null
  product_name: string
  sku: string
  quantity: number
  unit_price: number
  _deleted?: boolean
}

type POData = {
  id: string
  po_number: string
  status: string
  order_date: string
  expected_delivery_date: string | null
  updated_at: string
  total_value: number
  notes: string | null
  customer_id: string
  customers: { name: string }
}

const TIER_LABELS: Record<string, string> = {
  harga_pokok:   'Harga Pokok',
  luar_kota:     'Luar Kota',
  dalam_kota:    'Dalam Kota',
  depo_bangunan: 'Depo Bangunan',
  others: 'Others',
}

async function fetchPO(id: string): Promise<POData> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id, po_number, status, order_date, expected_delivery_date, total_value, updated_at, notes, customer_id, customers(name)')
    .eq('id', id)
    .single()
  if (error) throw error
  return { ...data, customers: singleRelation(data.customers) }
}

async function fetchCustomers(signal?: AbortSignal): Promise<Customer[]> {
  return (await fetchCompleteRows<Customer>('customers', 'id, name, pricing_tier', {}, signal)).sort((a, b) => a.name.localeCompare(b.name))
}
async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  return (await fetchCompleteRows<Product>('products', 'id, name, sku, size, unit_price, harga_pokok, luar_kota, dalam_kota, depo_bangunan', {}, signal)).sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveEdits(poId: string, payload: {
  customer_id: string; expected_delivery_date: string | null; notes: string | null; expected_updated_at: string; lineItems: LineItemRow[]
}, send: TransactionSender = createTransactionSender()) {
  const items = payload.lineItems.filter(line => !line._deleted)
  validateOrderLines(items)
  return send('edit_po', { po_id: poId, customer_id: payload.customer_id, expected_delivery_date: payload.expected_delivery_date, notes: payload.notes, expected_updated_at: payload.expected_updated_at, items })
}

function SKULookup({ products, onSelect }: {
  products: Product[]
  onSelect: (p: Product) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const results = query.trim()
    ? products.filter(p =>
        p.sku.toLowerCase().includes(query.toLowerCase()) ||
        p.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : []

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Cari SKU atau nama..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {results.map(p => (
            <button
              key={p.id}
              onMouseDown={() => { onSelect(p); setQuery(''); setOpen(false) }}
              className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-gray-50 last:border-0"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs text-gray-400 uppercase mr-2">{p.sku}</span>
                  <span className="text-sm text-gray-900">{p.name}</span>
                  {p.size && <span className="text-xs text-gray-400 ml-1">({p.size})</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function POEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sendTransaction = useTransactionSender(`edit-po:${id}`)
  const [initialVersion, setInitialVersion] = useState('')

  const [customerId, setCustomerId] = useState('')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  const initialized = initializedFor === id

  const { data: po, isLoading: poLoading, isError: poError, isFetching: poFetching, refetch: refetchPO } = useQuery({
    queryKey: ['po', id, 'edit'],
    queryFn: () => fetchPO(id!),
  })

  const { data: lineState, isLoading: linesLoading, isError: linesError, isFetching: linesFetching, refetch: refetchLines } = useQuery({
    queryKey: ['po_line_state', id, 'edit', po?.updated_at],
    queryFn: async ({ signal }) => {
      const result = await fetchCompletePOLines(id!, po!.updated_at, signal)
      return { ...result, items: result.items.map(line => ({ ...line, unit_price: priceForEdit(line.unit_price) })) }
    },
    enabled: !!id && !!po,
  })
  const readReady = !!po && po.id === id && !!lineState && lineState.po_updated_at === po.updated_at && !poError && !linesError && !poFetching && !linesFetching
  const existingLines = lineState?.items
  const historicalLineIds = new Set((existingLines ?? []).filter(line => line.has_delivery_history).map(line => line.id))
  const deliveredByLine = Object.fromEntries((existingLines ?? []).map(line => [line.id, line.delivered_quantity]))
  const hasDeliveryHistory = lineState?.po_has_delivery_history ?? false
  const { data: customers, isError: customersError, refetch: refetchCustomers } = useQuery({
    queryKey: ['customers', 'complete', 'po-edit'], queryFn: ({ signal }) => fetchCustomers(signal),
  })
  const { data: products, isError: productsError, refetch: refetchProducts } = useQuery({
    queryKey: ['products', 'complete', 'po-edit'], queryFn: ({ signal }) => fetchProducts(signal),
  })

  useEffect(() => {
    if (readReady && po && lineState && existingLines && !initialized) {
      setInitialVersion(lineState.po_updated_at)
      setCustomerId(po.customer_id)
      setExpectedDelivery(po.expected_delivery_date ?? '')
      setNotes(po.notes ?? '')
      setLineItems(existingLines.map(l => ({
        id: l.id,
        product_name: l.product_name,
        sku: l.sku ?? '',
        quantity: l.quantity,
        unit_price: l.unit_price,
      })))
      setInitializedFor(id!)
    }
  }, [id, po, lineState, existingLines, initialized, readReady])

  const mutation = useMutation({
    mutationFn: () => {
      if (!readReady || !initialized || !lineState || lineState.po_updated_at !== initialVersion) throw new Error('Data PO berubah atau belum lengkap. Muat ulang sebelum menyimpan.')
      if (lineItems.some(line => !line._deleted && line.quantity < (deliveredByLine[line.id ?? ''] ?? 0))) throw new Error('Jumlah tidak boleh kurang dari jumlah terkirim aktif.')
      return saveEdits(id!, {
      customer_id: customerId,
      expected_delivery_date: expectedDelivery || null,
      notes: notes || null,
      lineItems,
      expected_updated_at: initialVersion,
    }, sendTransaction)
    },
    onSuccess: () => {
      queryClient.invalidateQueries()
      navigate(`/athel/po/${id}`)
    },
  })

  // Get selected customer's pricing tier
  const selectedCustomer = customers?.find(c => c.id === customerId)
  const pricingTier = selectedCustomer?.pricing_tier ?? 'others'

  const updateLine = (index: number, field: keyof LineItemRow, value: string | number) => {
    setLineItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const fillFromProduct = (index: number, product: Product) => {
    const price = resolveCatalogPrice(product, pricingTier) ?? Number.NaN
    setLineItems(prev => prev.map((item, i) =>
      i === index
        ? { ...item, product_name: product.name, sku: product.sku, unit_price: price }
        : item
    ))
  }

  const addLine = () => setLineItems(prev => [
    ...prev,
    { id: null, product_name: '', sku: '', quantity: 1, unit_price: Number.NaN }
  ])

  const removeLine = (index: number) => {
    setLineItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      return item.id ? { ...item, _deleted: true } : null
    }).filter(Boolean) as LineItemRow[])
  }

  const visibleLines = lineItems.filter(l => !l._deleted)
  const total = visibleLines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)

  const handleSave = () => {
    if (!customerId) return alert('Pilih pelanggan terlebih dahulu.')
    if (visibleLines.some(l => !l.product_name.trim())) return alert('Semua barang harus memiliki nama produk.')
    if (visibleLines.length === 0) return alert('PO harus memiliki minimal satu barang.')
    mutation.mutate()
  }

  const recovery = <TransactionRecovery send={sendTransaction} onCommitted={result => { queryClient.invalidateQueries(); navigate(`/athel/po/${result.id}`) }} />

  if (poLoading || linesLoading || (!initialized && (poFetching || linesFetching))) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AthelNav />
        {recovery}
        <div className="p-8 text-gray-400 text-sm text-center">Memuat...</div>
      </div>
    )
  }

  if (poError || linesError || !po || !existingLines || !lineState || (initialized && lineState.po_updated_at !== initialVersion)) {
    return <div className="min-h-screen bg-gray-50"><AthelNav />{recovery}<div role="alert" className="p-8 text-red-600">
      <p>Data PO atau riwayat pengiriman belum dapat dimuat. Pengubahan belum tersedia.</p>
      <button onClick={() => { setInitializedFor(null); refetchPO(); refetchLines() }} className="mt-2 underline">Coba lagi</button>
    </div></div>
  }
  if (!['confirm', 'in_progress'].includes(po.status)) {
    return <div className="min-h-screen bg-gray-50"><AthelNav />{recovery}<div className="p-8">
      <p>PO {po.status === 'cancelled' ? 'yang dibatalkan' : po.status === 'complete' ? 'yang selesai' : 'dengan status ini'} tidak dapat diubah.</p>
      <button onClick={() => navigate(`/athel/po/${id}`)} className="mt-2 underline">Kembali ke PO</button>
    </div></div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />
        {recovery}

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <button
          onClick={() => navigate(`/athel/po/${id}`)}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          ← Kembali
        </button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Ubah {po?.po_number}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Perubahan akan tercatat di riwayat audit</p>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

        {(customersError || productsError) && <div role="alert" className="text-sm text-red-600">Pilihan pelanggan atau produk belum lengkap. <button className="underline" onClick={() => { refetchCustomers(); refetchProducts() }}>Coba lagi</button></div>}
        {(poFetching || linesFetching) && <p role="status" className="text-sm text-blue-600">Memperbarui data PO… Penyimpanan menunggu data lengkap; isian Anda tetap tersimpan di formulir.</p>}
        {/* Detail PO */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Detail PO</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Pelanggan</label>
              <select
                value={customerId}
                disabled={hasDeliveryHistory}
                onChange={e => setCustomerId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Pilih pelanggan...</option>
                {customers?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {hasDeliveryHistory && <p className="text-xs text-gray-500 mt-1">Pelanggan terkunci karena PO memiliki riwayat pengiriman.</p>}
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
                value={po?.po_number ?? ''}
                disabled
                className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tanggal PO</label>
              <input
                type="text"
                value={po?.order_date ?? ''}
                disabled
                className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tanggal Kedaluwarsa PO (opsional)</label>
              <p className="text-xs text-gray-400 mb-1">Jika PO pelanggan memiliki tanggal kedaluwarsa. Bukan tanggal pengiriman.</p>
              <input
                type="date"
                value={expectedDelivery}
                aria-label="Tanggal Kedaluwarsa PO (opsional)"
                onChange={e => setExpectedDelivery(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Catatan</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Catatan (opsional)..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Daftar Barang */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-1">Daftar Barang</h2>
          <p className="text-xs text-gray-400 mb-4">
            Barang tanpa riwayat pengiriman dapat diganti atau dihapus. Untuk barang yang pernah dikirim, hanya jumlah yang dapat diubah sesuai batas terkirim aktif.
          </p>

          <div className="space-y-4">
            {visibleLines.map((item, i) => {
              const realIndex = lineItems.indexOf(item)
              const historical = !!item.id && historicalLineIds.has(item.id)
              const minimumQuantity = Math.max(1, deliveredByLine[item.id ?? ''] ?? 0)
              return (
                <div key={item.id ?? `new-${i}`} className="border border-gray-100 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-12 gap-3 items-end">
                    <div className="col-span-11">
                      <label className="block text-xs text-gray-400 mb-1">
                        Ganti dengan barang lain (opsional)
                      </label>
                      {products && !historical && (
                        <SKULookup
                          products={products}
                          onSelect={p => fillFromProduct(realIndex, p)}
                        />
                      )}
                    </div>
                    <button
                      disabled={historical}
                      title={historical ? 'Barang dengan riwayat pengiriman tidak dapat dihapus.' : undefined}
                      onClick={() => removeLine(realIndex)}
                      className="col-span-1 text-gray-300 hover:text-red-400 text-xl text-center pb-1"
                    >
                      ×
                    </button>
                  </div>

                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-1">
                      <label className="block text-xs text-gray-400 mb-1">SKU</label>
                      <input
                        type="text"
                        disabled={historical}
                        value={item.sku}
                        onChange={e => updateLine(realIndex, 'sku', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                      />
                    </div>
                    <div className="col-span-5">
                      <label className="block text-xs text-gray-400 mb-1">Nama Produk</label>
                      <input
                        type="text"
                        disabled={historical}
                        value={item.product_name}
                        onChange={e => updateLine(realIndex, 'product_name', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Qty</label>
                      <input
                        type="number" min={minimumQuantity}
                        value={Number.isNaN(item.quantity) ? '' : item.quantity}
                        onChange={e => updateLine(realIndex, 'quantity', e.target.valueAsNumber)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="col-span-4">
                      <label className="block text-xs text-gray-400 mb-1">
                        Harga Satuan (Rp)
                        <span className="text-blue-400 ml-1">{historical ? '— terkunci' : '— dapat diubah'}</span>
                      </label>
                      <input
                        type="number" min={0} step="0.01"
                        disabled={historical}
                        aria-label="Harga satuan"
                        required
                        placeholder="Harga belum diisi"
                        value={Number.isNaN(item.unit_price) ? '' : item.unit_price}
                        onChange={e => updateLine(realIndex, 'unit_price', e.target.valueAsNumber)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {historical && <p className="text-xs text-gray-500">Riwayat pengiriman mengunci produk, SKU, harga, dan penghapusan barang. Jumlah minimal {minimumQuantity} (terkirim aktif: {deliveredByLine[item.id!] ?? 0}).</p>}
                  {Number.isNaN(item.unit_price) && <p className="text-xs text-amber-700">Isi harga satuan sebelum menyimpan. Nol hanya untuk barang gratis.</p>}
                  <div className="text-right text-xs text-gray-400">
                    Subtotal: <span className="text-gray-700 font-medium">
                      {formatLineAmount(item.quantity, item.unit_price)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={addLine}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              + Tambah Barang
            </button>
            <div className="text-sm text-gray-500">
              Total: <span className="text-gray-900 font-semibold text-base ml-1">
                {Number.isFinite(total) ? `Rp ${total.toLocaleString('id-ID')}` : 'Harga belum lengkap'}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pb-8">
          <button
            onClick={() => navigate(`/athel/po/${id}`)}
            className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={mutation.isPending || !readReady || !initialized}
            className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>

        {mutation.isError && (
          <p className="text-red-500 text-sm text-right">
            {(mutation.error as Error).message}
          </p>
        )}
      </div>
    </div>
  )
}
