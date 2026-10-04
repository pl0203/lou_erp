import { POCustomerLookup, POProductLookup } from '../../components/POLookup'
import { POLineItemsHeader, POLineRow } from '../../components/POLineItems'
import { resolveCatalogPrice } from '../../lib/catalogPricing'
import { fetchCompletePOLines, fetchCompleteRows, priceForEdit } from '../../lib/reads/detailReads'
import TransactionRecovery from '../../components/TransactionRecovery'
import { createTransactionSender, useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { isPOConflict, retryUnlessPOConflict } from '../../lib/poConflict'
import { singleRelation } from '../../lib/relations'
import { validateOrderLines } from '../../lib/orderValidation'
import { useState, useEffect, useRef } from 'react'
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
  _key?: string
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
  const items = payload.lineItems.filter(line => !line._deleted).map(({ _key, ...line }) => line)
  validateOrderLines(items)
  return send('edit_po', { po_id: poId, customer_id: payload.customer_id, expected_delivery_date: payload.expected_delivery_date, notes: payload.notes, expected_updated_at: payload.expected_updated_at, items })
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
  const productSearch = useRef<HTMLInputElement>(null)
  const quantityInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const nameInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const priceInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const pendingFocus = useRef<{ key: string; field: 'quantity' | 'name' } | null>(null)
  const [entryNotice, setEntryNotice] = useState('')
  const [entryError, setEntryError] = useState<{ key: string; message: string } | null>(null)
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  const initialized = initializedFor === id
  const [refreshingPO, setRefreshingPO] = useState(false)
  const activePO = useRef({ id, generation: 0 })
  if (activePO.current.id !== id) activePO.current = { id, generation: activePO.current.generation + 1 }
  const refreshSequence = useRef(0)

  const { data: po, isLoading: poLoading, isError: poError, isFetching: poFetching, refetch: refetchPO } = useQuery({
    queryKey: ['po', id, 'edit'],
    queryFn: () => fetchPO(id!),
  })

  const { data: lineState, isLoading: linesLoading, isError: linesError, error: lineError, isFetching: linesFetching } = useQuery({
    queryKey: ['po_line_state', id, 'edit', po?.updated_at],
    queryFn: async ({ signal }) => {
      const result = await fetchCompletePOLines(id!, po!.updated_at, signal)
      return { ...result, items: result.items.map(line => ({ ...line, unit_price: priceForEdit(line.unit_price) })) }
    },
    enabled: query => !!id && !!po && !refreshingPO && !isPOConflict(query.state.error),
    retry: (count, error) => retryUnlessPOConflict(count, error, queryClient.getDefaultOptions().queries?.retry),
    refetchOnMount: query => !isPOConflict(query.state.error),
    refetchOnWindowFocus: query => !isPOConflict(query.state.error),
    refetchOnReconnect: query => !isPOConflict(query.state.error),
  })
  const readReady = !!po && po.id === id && !!lineState && lineState.po_updated_at === po.updated_at && !poError && !linesError && !poFetching && !linesFetching && !refreshingPO
  const existingLines = lineState?.items
  const historicalLineIds = new Set((existingLines ?? []).filter(line => line.has_delivery_history).map(line => line.id))
  const deliveredByLine = Object.fromEntries((existingLines ?? []).map(line => [line.id, line.delivered_quantity]))
  const hasDeliveryHistory = lineState?.po_has_delivery_history ?? false
  const { data: customers, isError: customersError, isFetching: customersFetching, refetch: refetchCustomers } = useQuery({
    queryKey: ['customers', 'complete', 'po-edit'], queryFn: ({ signal }) => fetchCustomers(signal),
  })
  const { data: products, isError: productsError, isFetching: productsFetching, refetch: refetchProducts } = useQuery({
    queryKey: ['products', 'complete', 'po-edit'], queryFn: ({ signal }) => fetchProducts(signal),
  })

  useEffect(() => {
    if (readReady && po && lineState && existingLines && !initialized) {
      setInitialVersion(lineState.po_updated_at)
      setCustomerId(po.customer_id)
      setExpectedDelivery(po.expected_delivery_date ?? '')
      setNotes(po.notes ?? '')
      setLineItems(existingLines.map(l => ({
        _key: l.id,
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
    retry: false,
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

  useEffect(() => {
    refreshSequence.current++; setRefreshingPO(false); mutation.reset()
    return () => { void queryClient.cancelQueries({ queryKey: ['po_line_state', id, 'edit'] }) }
  }, [id, queryClient, mutation.reset])

  // Read the new header first; never refetch lines with the rejected version.
  const refreshPO = async () => {
    const target = id!
    const generation = activePO.current.generation
    const sequence = ++refreshSequence.current
    const isCurrent = () => activePO.current.id === target && activePO.current.generation === generation && refreshSequence.current === sequence
    setRefreshingPO(true)
    try {
      await queryClient.cancelQueries({ queryKey: ['po_line_state', target, 'edit'] })
      const header = await refetchPO()
      if (header.isError || !header.data || header.data.id !== target || !isCurrent()) return
      await queryClient.fetchQuery({
        queryKey: ['po_line_state', target, 'edit', header.data.updated_at],
        queryFn: async ({ signal }) => {
          const result = await fetchCompletePOLines(target, header.data!.updated_at, signal)
          return { ...result, items: result.items.map(line => ({ ...line, unit_price: priceForEdit(line.unit_price) })) }
        }, retry: false,
      })
      if (isCurrent()) { setInitializedFor(null); mutation.reset() }
    } catch { /* The authoritative query retains its error; no edit is submitted. */ }
    finally { if (isCurrent()) setRefreshingPO(false) }
  }

  // Get selected customer's pricing tier
  const selectedCustomer = customers?.find(c => c.id === customerId)
  const pricingTier = selectedCustomer?.pricing_tier ?? 'others'

  const updateLine = (index: number, field: keyof LineItemRow, value: string | number) => {
    setLineItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const addLine = () => {
    const key = crypto.randomUUID()
    pendingFocus.current = { key, field: 'name' }
    setEntryError(null); setEntryNotice('')
    setLineItems(prev => [...prev, { _key: key, id: null, product_name: '', sku: '', quantity: 1, unit_price: Number.NaN }])
  }

  const removeLine = (index: number) => {
    if (lineItems[index]?.id && historicalLineIds.has(lineItems[index].id!)) return
    setLineItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      return item.id ? { ...item, _deleted: true } : null
    }).filter(Boolean) as LineItemRow[])
  }

  const focusQuantity = (key: string) => {
    const input = quantityInputs.current[key]
    if (input) { input.focus(); input.select(); input.scrollIntoView?.({ block: 'nearest' }) }
    else pendingFocus.current = { key, field: 'quantity' }
  }
  const addProduct = (product: Product) => {
    const sku = product.sku.trim().toLocaleLowerCase()
    const existing = lineItems.find(line => !line._deleted && (sku && line.sku.trim().toLocaleLowerCase() === sku))
    if (existing) {
      setEntryNotice(`${product.sku} sudah ada. Jumlah dan harga tetap; periksa barang yang difokuskan.`)
      focusQuantity(existing._key!)
      return
    }
    setEntryNotice(''); setEntryError(null)
    setLineItems(prev => [...prev, { id: null, _key: crypto.randomUUID(), product_name: product.name, sku: product.sku, quantity: 1, unit_price: resolveCatalogPrice(product, pricingTier) ?? Number.NaN }])
    productSearch.current?.focus()
  }
  const validateLine = (item: LineItemRow) => {
    try {
      validateOrderLines([item])
      if (item.quantity < (deliveredByLine[item.id ?? ''] ?? 0)) throw new Error('Jumlah tidak boleh kurang dari jumlah terkirim aktif.')
    } catch (error) {
      setEntryError({ key: item._key!, message: (error as Error).message })
      if (!item.product_name.trim()) nameInputs.current[item._key!]?.focus()
      else if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity < (deliveredByLine[item.id ?? ''] ?? 0)) quantityInputs.current[item._key!]?.focus()
      else priceInputs.current[item._key!]?.focus()
      return false
    }
    return true
  }

  const visibleLines = lineItems.filter(l => !l._deleted)
  const total = visibleLines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)

  const handleSave = () => {
    if (!customerId) return alert('Pilih pelanggan terlebih dahulu.')
    if (visibleLines.length === 0) {
      alert('PO harus memiliki minimal satu barang.')
      productSearch.current?.focus()
      return
    }
    if (!visibleLines.every(validateLine)) return
    setEntryError(null)
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
      <p>{isPOConflict(lineError) ? 'PO berubah. Muat ulang sebelum melanjutkan.' : 'Data PO atau riwayat pengiriman belum dapat dimuat. Pengubahan belum tersedia.'}</p>
      <button type="button" onClick={() => void refreshPO()} disabled={refreshingPO} className="mt-2 underline">Coba lagi</button>
    </div></div>
  }
  if (!['confirm', 'in_progress'].includes(po.status)) {
    return <div className="min-h-screen bg-gray-50"><AthelNav />{recovery}<div className="p-8">
      <p>PO {po.status === 'cancelled' ? 'yang dibatalkan' : po.status === 'complete' ? 'yang selesai' : 'dengan status ini'} tidak dapat diubah.</p>
      <button type="button" onClick={() => navigate(`/athel/po/${id}`)} className="mt-2 underline">Kembali ke PO</button>
    </div></div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />
        {recovery}

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate(`/athel/po/${id}`)}
          className="shrink-0 text-gray-400 hover:text-gray-600 text-sm"
        >
          ← Kembali
        </button>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h1 className="text-xl font-semibold text-gray-900">Ubah {po?.po_number}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Perubahan akan tercatat di riwayat audit</p>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

        {(customersError || productsError) && <div role="alert" className="text-sm text-red-600">Pilihan pelanggan atau produk belum lengkap. <button className="underline" onClick={() => { refetchCustomers(); refetchProducts() }}>Coba lagi</button></div>}
        {(poFetching || linesFetching) && <p role="status" className="text-sm text-blue-600">Memperbarui data PO… Penyimpanan menunggu data lengkap; isian Anda tetap tersimpan di formulir.</p>}
        {/* Detail PO */}
        <div className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Detail PO</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Pelanggan</label>
              <POCustomerLookup customers={customers ?? []} selectedId={customerId} selectedLabel={po.customers?.name}
                disabled={hasDeliveryHistory || !readReady || !customers || customersError || customersFetching || mutation.isPending}
                onSelect={customer => setCustomerId(customer.id)} />
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
                className="min-w-0 max-w-full w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tanggal PO</label>
              <input
                type="text"
                value={po?.order_date ?? ''}
                disabled
                className="min-w-0 max-w-full w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
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
                className="min-w-0 max-w-full w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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
            Barang tanpa riwayat pengiriman dapat diganti atau dihapus. Untuk barang yang pernah dikirim, hanya jumlah yang dapat diubah sesuai batas terkirim aktif.
          </p>

          <div className="mb-4 min-w-0">
            <label className="block text-sm font-medium text-gray-700 mb-1">Cari SKU atau nama barang</label>
            <POProductLookup products={products ?? []} inputRef={productSearch} onSelect={addProduct}
              disabled={!readReady || !initialized || !selectedCustomer || !products || !customers || customersError || productsError || customersFetching || productsFetching || mutation.isPending} />
            <p className="text-xs text-gray-500 mt-1">Ketik SKU tepat lalu Enter, atau klik hasil pencarian untuk menambahkan barang. Ulangi pencarian untuk barang berikutnya.</p>
            {entryNotice && <p role="status" className="text-xs text-blue-700 mt-2">{entryNotice}</p>}
          </div>

          {visibleLines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">Belum ada barang. Cari SKU atau nama untuk menambahkan barang.</p>
          ) : (
            <div className="min-w-0 space-y-2">
              <POLineItemsHeader />
              {visibleLines.map(item => {
                const realIndex = lineItems.indexOf(item)
                const historical = !!item.id && historicalLineIds.has(item.id)
                const minimumQuantity = Math.max(1, deliveredByLine[item.id ?? ''] ?? 0)
                return (
                <POLineRow key={item._key} lineKey={item._key!} item={item}
                  onChange={(field, value) => updateLine(realIndex, field, value)}
                  onRemove={() => removeLine(realIndex)}
                  historical={historical} minimumQuantity={minimumQuantity} deliveredQuantity={deliveredByLine[item.id ?? ''] ?? 0}
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
              )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={addLine}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
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
            onClick={() => navigate(`/athel/po/${id}`)}
            className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={mutation.isPending || isPOConflict(mutation.error) || !readReady || !initialized || !customers || !products || customersError || productsError || customersFetching || productsFetching}
            className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>

        {mutation.isError && (
          <div role="alert" className="text-red-500 text-sm text-right">
            {(mutation.error as Error).message}
            {isPOConflict(mutation.error) && <button type="button" onClick={() => void refreshPO()} disabled={refreshingPO} className="ml-2 underline">Muat ulang PO</button>}
          </div>
        )}
      </div>
    </div>
  )
}
