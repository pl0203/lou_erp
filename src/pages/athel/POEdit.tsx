import { Button } from '../../components/ui/Button'
import { ActionLink } from '../../components/ui/ActionLink'
import { MainContent } from '../../components/ui/MainContent'
import { Field } from '../../components/ui/Field'
import { FormActions } from '../../components/ui/FormActions'
import PromoStockWarning, { usePromoStockSubmission } from '../../components/PromoStockWarning'
import { POCustomerLookup, POProductLookup } from '../../components/POLookup'
import { POLineItemsHeader, POLineRow } from '../../components/POLineItems'
import { useCatalogueOrderOptions } from '../../lib/catalogue/useCatalogueOrderOptions'
import { resolveCatalogPrice } from '../../lib/catalogPricing'
import { fetchCompletePOLines, priceForEdit } from '../../lib/reads/detailReads'
import TransactionRecovery from '../../components/TransactionRecovery'
import { createTransactionSender, useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { isPOConflict, retryUnlessPOConflict } from '../../lib/poConflict'
import { singleRelation } from '../../lib/relations'
import { validateOrderLines } from '../../lib/orderValidation'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

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
  product_id: string | null
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

// Compare editable values with the loaded draft, excluding UI-only row keys.
function draftSnapshot(customerId: string, expectedDelivery: string, notes: string, lineItems: LineItemRow[]) {
  return JSON.stringify([customerId, expectedDelivery, notes, lineItems.filter(line => !line._deleted).map(line =>
    [line.id, line.product_id, line.product_name, line.sku, line.quantity, line.unit_price])])
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

export async function saveEdits(poId: string, payload: {
  customer_id: string; expected_delivery_date: string | null; notes: string | null; expected_updated_at: string; lineItems: LineItemRow[]; promo_stock_ack?: Record<string, unknown>
}, send: TransactionSender = createTransactionSender()) {
  const items = payload.lineItems.filter(line => !line._deleted).map(({ _key, _deleted, ...line }) => ({ ...line, product_id: line.product_id ?? null }))
  validateOrderLines(items)
  return send('edit_po', { po_id: poId, customer_id: payload.customer_id, expected_delivery_date: payload.expected_delivery_date, notes: payload.notes, expected_updated_at: payload.expected_updated_at, items, ...(payload.promo_stock_ack ? { promo_stock_ack: payload.promo_stock_ack } : {}) })
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
  const stockTrigger = useRef<HTMLElement | null>(null)
  const formFocus = useRef<HTMLDivElement>(null)
  const quantityInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const nameInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const priceInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const pendingFocus = useRef<{ key: string; field: 'quantity' | 'name' } | null>(null)
  const [entryNotice, setEntryNotice] = useState('')
  const [entryError, setEntryError] = useState<{ key: string; message: string } | null>(null)
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  const initialized = initializedFor === id
  const [initialDraft, setInitialDraft] = useState('')
  const snapshot = draftSnapshot(customerId, expectedDelivery, notes, lineItems)
  const unsaved = useUnsavedChanges(initialized && snapshot !== initialDraft)
  const [refreshingPO, setRefreshingPO] = useState(false)
  const activePO = useRef({ id, generation: 0 })
  if (activePO.current.id !== id) activePO.current = { id, generation: activePO.current.generation + 1 }
  const editor = activePO.current
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
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
  const customerHistory = useCatalogueOrderOptions('customer', 'all-for-history')
  const productHistory = useCatalogueOrderOptions('product', 'all-for-history')
  const { data: customers, isError: customersError, isFetching: customersFetching, refetch: refetchCustomers } = customerHistory
  const { data: products, isError: productsError, isFetching: productsFetching, refetch: refetchProducts } = productHistory
  const customerOptions = useCatalogueOrderOptions('customer', 'enabled-for-order')
  const productOptions = useCatalogueOrderOptions('product', 'enabled-for-order')

  const readCurrentCatalogue = () => {
    const customers = customerHistory.getCurrentData(), products = productHistory.getCurrentData()
    const enabledCustomers = customerOptions.getCurrentData(), enabledProducts = productOptions.getCurrentData()
    if (!customers || !products || !enabledCustomers || !enabledProducts) throw new Error('Pilihan katalog belum siap. Tunggu pemuatan atau coba lagi.')
    return { customers, products, enabledCustomers, enabledProducts }
  }
  const assertCatalogueDraft = (draft: { customer_id: string; lineItems: LineItemRow[] }) => {
    const catalogue = readCurrentCatalogue()
    const customer = catalogue.customers.find(row => row.id === draft.customer_id)
    if (!customer || !customer.is_enabled && draft.customer_id !== po?.customer_id || customer.is_enabled && !catalogue.enabledCustomers.some(row => row.id === customer.id && row.is_enabled)) throw new Error('Pilih pelanggan aktif terlebih dahulu.')
    for (const item of draft.lineItems.filter(line => !line._deleted)) {
      const saved = existingLines?.find(line => line.id === item.id)
      const product = catalogue.products.find(row => row.id === item.product_id)
      if (!saved) {
        const enabled = catalogue.enabledProducts.find(row => row.id === item.product_id && row.is_enabled)
        if (item.id || !customer.is_enabled || !product?.is_enabled || !enabled || enabled.sku !== item.sku || enabled.name !== item.product_name || product.sku !== item.sku || product.name !== item.product_name) throw new Error('Barang baru harus dipilih dari katalog aktif untuk pelanggan aktif.')
      } else if ((saved.product_id ?? null) !== item.product_id || (saved.sku ?? '') !== item.sku || saved.product_name !== item.product_name) {
        throw new Error('Identitas barang tersimpan tidak boleh diubah; pilih barang pengganti dari katalog aktif.')
      }
      if (saved && (!customer.is_enabled || item.product_id && !product?.is_enabled) && item.quantity > saved.quantity) throw new Error('Jumlah barang untuk katalog nonaktif tidak boleh melebihi jumlah tersimpan pada baris ini.')
    }
    return { ...catalogue, customer }
  }
  type Submission = Parameters<typeof saveEdits>[1] & { catalogueAdmission: string }
  // Keep the originating owner and editor across the stock-warning draft clone.
  const catalogueAdmission = useRef<{ key: string; editor: typeof editor; assert: typeof assertCatalogueDraft } | null>(null)

  useEffect(() => {
    if (readReady && po && lineState && existingLines && !initialized) {
      setInitialVersion(lineState.po_updated_at)
      setCustomerId(po.customer_id)
      setExpectedDelivery(po.expected_delivery_date ?? '')
      setNotes(po.notes ?? '')
      const loadedLines = existingLines.map(l => ({
        _key: l.id,
        id: l.id,
        product_id: l.product_id ?? null,
        product_name: l.product_name,
        sku: l.sku ?? '',
        quantity: l.quantity,
        unit_price: l.unit_price,
      }))
      setLineItems(loadedLines)
      setInitialDraft(draftSnapshot(po.customer_id, po.expected_delivery_date ?? '', po.notes ?? '', loadedLines))
      setInitializedFor(id!)
    }
  }, [id, po, lineState, existingLines, initialized, readReady])

  const mutation = useMutation({
    retry: false,
    onMutate: () => activePO.current,
    mutationFn: (draft: Submission) => {
      const admission = catalogueAdmission.current
      if (!admission || admission.key !== draft.catalogueAdmission || admission.editor !== activePO.current) throw new Error('Pilihan katalog berubah. Periksa kembali formulir.')
      admission.assert(draft)
      if (!readReady || !initialized || !lineState || lineState.po_updated_at !== initialVersion) throw new Error('Data PO berubah atau belum lengkap. Muat ulang sebelum menyimpan.')
      if (draft.lineItems.some(line => !line._deleted && line.quantity < (deliveredByLine[line.id ?? ''] ?? 0))) throw new Error('Jumlah tidak boleh kurang dari jumlah terkirim aktif.')
      return saveEdits(id!, draft, sendTransaction)
    },
    onSuccess: (_result, _draft, submittedEditor) => {
      queryClient.invalidateQueries()
      // A late result must not leave a newer PO or pull back a departed editor.
      if (mounted.current && activePO.current === submittedEditor) {
        unsaved.runWithoutPrompt(() => navigate(`/athel/po/${submittedEditor.id}`))
      }
    },
  })

  const stockSubmission = usePromoStockSubmission((draft: Submission) => mutation.mutateAsync(draft))
  const formLocked = mutation.isPending
  const submissionStarting = useRef(false)

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
    if (field !== 'quantity' && field !== 'unit_price') return
    setLineItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
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
  const addProduct = (selected: Product) => {
    let product: Product, currentTier: typeof pricingTier
    try {
      const catalogue = assertCatalogueDraft({ customer_id: customerId, lineItems: [{ id: null, product_id: selected.id, product_name: selected.name, sku: selected.sku, quantity: 1, unit_price: Number.NaN }] })
      product = catalogue.enabledProducts.find(row => row.id === selected.id)!
      currentTier = catalogue.customer.pricing_tier
    } catch (error) { setEntryNotice((error as Error).message); return }
    const sku = product.sku.trim().toLocaleLowerCase()
    const existing = lineItems.find(line => !line._deleted && (sku && line.sku.trim().toLocaleLowerCase() === sku))
    if (existing) {
      setEntryNotice(`${product.sku} sudah ada. Jumlah dan harga tetap; periksa barang yang difokuskan.`)
      focusQuantity(existing._key!)
      return
    }
    setEntryNotice(''); setEntryError(null)
    setLineItems(prev => [...prev, { id: null, product_id: product.id, _key: crypto.randomUUID(), product_name: product.name, sku: product.sku, quantity: 1, unit_price: resolveCatalogPrice(product, currentTier) ?? Number.NaN }])
    productSearch.current?.focus()
  }
  const maximumQuantity = (item: LineItemRow) => {
    const saved = existingLines?.find(line => line.id === item.id)
    const product = products?.find(product => product.id === item.product_id)
    return saved && (!selectedCustomer?.is_enabled || item.product_id && !product?.is_enabled) ? saved.quantity : undefined
  }
  const validateLine = (item: LineItemRow) => {
    try {
      assertCatalogueDraft({ customer_id: customerId, lineItems: [item] })
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
    if (mutation.isPending || submissionStarting.current || stockSubmission.warning) return
    if (!customerId) return alert('Pilih pelanggan terlebih dahulu.')
    if (visibleLines.length === 0) {
      alert('PO harus memiliki minimal satu barang.')
      productSearch.current?.focus()
      return
    }
    if (!visibleLines.every(validateLine)) return
    setEntryError(null)
    submissionStarting.current = true
    const key = crypto.randomUUID()
    catalogueAdmission.current = { key, editor, assert: assertCatalogueDraft }
    void stockSubmission.run({ catalogueAdmission: key, customer_id: customerId, expected_delivery_date: expectedDelivery || null, notes: notes || null, lineItems, expected_updated_at: initialVersion }).finally(() => { submissionStarting.current = false })
  }

  const recovery = <TransactionRecovery key={id} send={sendTransaction} onCommitted={result => {
    if (!mounted.current || activePO.current !== editor) { queryClient.invalidateQueries(); return }
    const showSavedPO = () => {
      queryClient.invalidateQueries()
      unsaved.runWithoutPrompt(() => navigate(`/athel/po/${result.id}`))
    }
    // Recovery metadata has no draft, so it cannot prove these edits were saved.
    unsaved.confirmDiscard(showSavedPO, { message: 'Permintaan sebelumnya sudah tersimpan. Isian saat ini mungkin berbeda dari hasil tersebut. Buang isian dan lihat PO tersimpan?' })
  }} />

  if (poLoading || linesLoading || (!initialized && (poFetching || linesFetching))) {
    return (
      <div className="min-h-screen bg-brand-canvas">
        {unsaved.dialog}
        <AthelNav /><MainContent>
        {recovery}
        <div className="p-8 text-brand-secondary text-sm text-center">Memuat...</div>
        </MainContent>
      </div>
    )
  }

  if (poError || linesError || !po || !existingLines || !lineState || (initialized && lineState.po_updated_at !== initialVersion)) {
    return <div className="min-h-screen bg-brand-canvas">{unsaved.dialog}<AthelNav /><MainContent>{recovery}<div role="alert" className="p-8 text-red-700">
      <p>{isPOConflict(lineError) ? 'PO berubah. Muat ulang sebelum melanjutkan.' : 'Data PO atau riwayat pengiriman belum dapat dimuat. Pengubahan belum tersedia.'}</p>
      <Button variant="secondary" type="button" onClick={() => void refreshPO()} disabled={refreshingPO} className="mt-2">Coba lagi</Button>
    </div></MainContent></div>
  }
  if (!['confirm', 'in_progress'].includes(po.status)) {
    return <div className="min-h-screen bg-brand-canvas">{unsaved.dialog}<AthelNav /><MainContent>{recovery}<div className="p-8">
      <p>PO {po.status === 'cancelled' ? 'yang dibatalkan' : po.status === 'complete' ? 'yang selesai' : 'dengan status ini'} tidak dapat diubah.</p>
      <ActionLink variant="quiet" to={`/athel/po/${id}`} className="mt-2">Kembali ke PO</ActionLink>
    </div></MainContent></div>
  }

  return (
    <div className="min-h-screen bg-brand-canvas">
      {unsaved.dialog}
      {stockSubmission.warning && <PromoStockWarning warning={stockSubmission.warning} returnFocus={stockTrigger.current} fallbackFocus={() => formFocus.current} pending={mutation.isPending} onContinue={() => void stockSubmission.continue()} onCancel={() => { stockSubmission.cancel(); mutation.reset() }} />}
      <div inert={!!stockSubmission.warning} aria-hidden={stockSubmission.warning ? true : undefined}>
      <AthelNav /><MainContent>
        {!stockSubmission.warning && recovery}

      <div ref={formFocus} tabIndex={-1} className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <ActionLink variant="quiet" to={`/athel/po/${id}`} className="shrink-0">← Kembali</ActionLink>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h1 className="text-xl font-semibold text-gray-900">Ubah {po?.po_number}</h1>
          <p className="text-sm text-brand-secondary mt-0.5">Perubahan akan tercatat di riwayat audit</p>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

        {(customersError || productsError || customerOptions.isError || productOptions.isError) && <div role="alert" className="text-sm text-red-700">Pilihan pelanggan atau produk belum lengkap. <Button variant="secondary"  onClick={() => { void refetchCustomers(); void refetchProducts(); void customerOptions.refetch(); void productOptions.refetch() }}>Coba lagi</Button></div>}
        {(poFetching || linesFetching) && <p role="status" className="text-sm text-blue-600">Memperbarui data PO… Penyimpanan menunggu data lengkap; isian Anda tetap tersimpan di formulir.</p>}
        {/* Detail PO */}
        <fieldset disabled={formLocked} className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Detail PO</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Field id="po-customer" label="Pelanggan">{control => <POCustomerLookup {...control} customers={customerOptions.data ?? []} selectedId={customerId} selectedLabel={po.customers?.name}
                disabled={customerOptions.isError || customerOptions.isFetching || !customerOptions.data || hasDeliveryHistory || !readReady || !customers || customersError || customersFetching || formLocked}
                onSelect={customer => {
                  const current = customerOptions.getCurrentData(), history = customerHistory.getCurrentData()
                  if (current?.some(row => row.id === customer.id && row.is_enabled) && history?.some(row => row.id === customer.id && row.is_enabled)) setCustomerId(customer.id)
                }} />}</Field>
              {hasDeliveryHistory && <p className="text-[13px] text-brand-secondary mt-1">Pelanggan terkunci karena PO memiliki riwayat pengiriman.</p>}
              {selectedCustomer && (
                <p className="text-[13px] text-blue-600 mt-1">
                  Tier harga: <span className="font-medium">{TIER_LABELS[pricingTier]}</span>
                </p>
              )}
            </div>
            <Field id="po-number" label="Nomor PO">{control => <input {...control}
                type="text"
                value={po?.po_number ?? ''}
                disabled
                className="max-w-full border-gray-100 bg-gray-50 text-brand-secondary cursor-not-allowed"
              />}</Field>
            <Field id="po-order-date" label="Tanggal PO">{control => <input {...control}
                type="text"
                value={po?.order_date ?? ''}
                disabled
                className="max-w-full border-gray-100 bg-gray-50 text-brand-secondary cursor-not-allowed"
              />}</Field>
            <Field id="po-expiry" label="Tanggal Kedaluwarsa PO (opsional)" hint="Jika PO pelanggan memiliki tanggal kedaluwarsa. Bukan tanggal pengiriman.">{control => <input {...control}
                type="date"
                value={expectedDelivery}
                onChange={e => setExpectedDelivery(e.target.value)}
                className="max-w-full focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />}</Field>
            <Field id="po-notes" label="Catatan" className="sm:col-span-2">{control => <textarea {...control}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Catatan (opsional)..."
                className="max-w-full focus:outline-none focus:ring-2 focus:ring-brand-primary resize-none"
              />}</Field>
          </div>
        </fieldset>

        {/* Daftar Barang */}
        <fieldset disabled={formLocked} className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900 mb-1">Daftar Barang</h2>
          <p className="text-[13px] text-brand-secondary mb-4">
            Barang tanpa riwayat pengiriman dapat diganti atau dihapus. Untuk barang yang pernah dikirim, hanya jumlah yang dapat diubah sesuai batas terkirim aktif.
          </p>

          <div className="mb-4 min-w-0">
            <Field id="po-product-search" label="Cari SKU atau nama barang" hint="Ketik SKU tepat lalu Enter, atau klik hasil pencarian untuk menambahkan barang. Ulangi pencarian untuk barang berikutnya.">{control => <POProductLookup {...control} products={productOptions.data ?? []} inputRef={productSearch} onSelect={addProduct}
              disabled={!selectedCustomer?.is_enabled || productOptions.isError || productOptions.isFetching || !productOptions.data || !readReady || !initialized || !selectedCustomer || !products || !customers || customersError || productsError || customersFetching || productsFetching || formLocked} />}</Field>
            {entryNotice && <p role="status" className="text-[13px] text-blue-700 mt-2">{entryNotice}</p>}
          </div>

          {visibleLines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-brand-secondary">Belum ada barang. Cari SKU atau nama untuk menambahkan barang.</p>
          ) : (
            <div className="min-w-0 space-y-2">
              <POLineItemsHeader />
              {visibleLines.map(item => {
                const realIndex = lineItems.indexOf(item)
                const historical = !!item.id && historicalLineIds.has(item.id)
                const minimumQuantity = Math.max(1, deliveredByLine[item.id ?? ''] ?? 0)
                return (
                <POLineRow identityLocked key={item._key} lineKey={item._key!} item={item}
                  onChange={(field, value) => updateLine(realIndex, field, value)}
                  onRemove={() => removeLine(realIndex)}
                  historical={historical} maximumQuantity={maximumQuantity(item)} minimumQuantity={minimumQuantity} deliveredQuantity={deliveredByLine[item.id ?? ''] ?? 0}
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

          <p className="mt-4 text-[13px] text-gray-600">Barang baru harus dipilih dari katalog aktif. Nama dan SKU mengikuti pilihan katalog; harga pesanan tetap dapat ditinjau.</p>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100">
            <div className="min-w-0 text-sm text-brand-secondary [overflow-wrap:anywhere]">
              Total: <span className="text-gray-900 font-semibold text-base ml-1">
                {Number.isFinite(total) ? `Rp ${total.toLocaleString('id-ID')}` : 'Harga belum lengkap'}
              </span>
            </div>
          </div>
        </fieldset>

        {/* Actions */}
        <FormActions className="pb-8">
          <ActionLink variant="quiet" to={`/athel/po/${id}`}

          >Batal</ActionLink>
          <Button variant="primary"
            type="button"
            pending={mutation.isPending} onClick={event => { stockTrigger.current = event.currentTarget; handleSave() }}
            disabled={customerOptions.isError || productOptions.isError || customerOptions.isFetching || productOptions.isFetching || !customerOptions.data || !productOptions.data || formLocked || isPOConflict(mutation.error) || !readReady || !initialized || !customers || !products || customersError || productsError || customersFetching || productsFetching}

          >
            {mutation.isPending ? 'Menyimpan...' : 'Simpan Perubahan'}
          </Button>
        </FormActions>

        {mutation.isError && (
          <div role="alert" className="text-red-700 text-sm text-right">
            {(mutation.error as Error).message}
            {isPOConflict(mutation.error) && <Button variant="secondary" type="button" onClick={() => void refreshPO()} disabled={refreshingPO} className="ml-2">Muat ulang PO</Button>}
          </div>
        )}
      </div>
      </MainContent>
      </div>
    </div>
  )
}
