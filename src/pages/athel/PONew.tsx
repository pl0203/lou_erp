import { Button } from '../../components/ui/Button'
import { ActionLink } from '../../components/ui/ActionLink'
import { MainContent } from '../../components/ui/MainContent'
import { Field } from '../../components/ui/Field'
import { FormActions } from '../../components/ui/FormActions'
import PromoStockWarning, { usePromoStockSubmission } from '../../components/PromoStockWarning'
import PODocumentImport from '../../components/poImport/PODocumentImport'
import { useAuth } from '../../lib/AuthContext'
import { POCustomerLookup, POProductLookup } from '../../components/POLookup'
import { POLineItemsHeader, POLineRow } from '../../components/POLineItems'
import { useCatalogueOrderOptions } from '../../lib/catalogue/useCatalogueOrderOptions'
import { resolveCatalogPrice } from '../../lib/catalogPricing'
import ReadFailure from '../../components/ReadFailure'
import TransactionRecovery from '../../components/TransactionRecovery'
import { createTransactionSender, useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { validateOrderLines } from '../../lib/orderValidation'
import { hasOrderItemChanges, useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import AthelNav from '../../components/AthelNav'

type LineItem = {
  _key?: string
  product_id: string | null
  product_name: string
  sku: string
  quantity: number
  unit_price: number
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

export async function createPO(payload: {
  customer_id: string; po_number: string; order_date: string; expected_delivery_date: string; notes: string; lineItems: LineItem[]; promo_stock_ack?: Record<string, unknown>
}, send: TransactionSender = createTransactionSender()) {
  validateOrderLines(payload.lineItems)
  return send('create_po', {
    customer_id: payload.customer_id, po_number: payload.po_number, order_date: payload.order_date,
    expected_delivery_date: payload.expected_delivery_date || null, notes: payload.notes || null, items: payload.lineItems.map(({ _key, ...line }) => line),
    ...(payload.promo_stock_ack ? { promo_stock_ack: payload.promo_stock_ack } : {}),
  })
}

export default function PONew() {
  const navigate = useNavigate()
  const { user, profile, loading: identityLoading, error: identityError } = useAuth()
  const actorKey = !identityLoading && !identityError && user && profile?.id === user.id && profile.is_active && ['po_admin', 'executive'].includes(profile.role) ? `${user.id}:${profile.role}` : ''
  const [importDirty, setImportDirty] = useState(false)
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
  const stockTrigger = useRef<HTMLElement | null>(null)
  const formFocus = useRef<HTMLDivElement>(null)
  const quantityInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const nameInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const priceInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const pendingFocus = useRef<{ key: string; field: 'quantity' | 'name' } | null>(null)
  const [entryNotice, setEntryNotice] = useState('')
  const [entryError, setEntryError] = useState<{ key: string; message: string } | null>(null)
  const itemsDirty = lineItems.length > 0 && hasOrderItemChanges(lineItems)
  const formDirty = !!customerId || !!poNumber || !!expectedDelivery || !!notes || orderDate !== initialOrderDate || itemsDirty
  const unsaved = useUnsavedChanges(formDirty || importDirty)

  const { data: customers, isError: customerReadError, isFetching: customersFetching, refetch: retryCustomers } = useCatalogueOrderOptions('customer', 'enabled-for-order')
  const { data: products, isError: productReadError, isFetching: productsFetching, refetch: retryProducts } = useCatalogueOrderOptions('product', 'enabled-for-order')

  const onCommitted = (po: { id: string }) => {
    queryClient.invalidateQueries()
    unsaved.runWithoutPrompt(() => navigate(`/athel/po/${po.id}`))
  }

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof createPO>[0]) => createPO(payload, sendTransaction),
    onSuccess: onCommitted,
  })

  const stockSubmission = usePromoStockSubmission((draft: Parameters<typeof createPO>[0]) => mutation.mutateAsync(draft))
  const formLocked = mutation.isPending

  // Get selected customer's pricing tier
  const selectedCustomer = customers?.find(c => c.id === customerId)
  const pricingTier = selectedCustomer?.pricing_tier ?? 'others'

  const updateLine = (index: number, field: keyof LineItem, value: string | number) => {
    if (field !== 'quantity' && field !== 'unit_price') return
    setLineItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
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
      const product = products?.find(product => product.id === item.product_id)
      if (!product || product.sku !== item.sku || product.name !== item.product_name) throw new Error('Pilih ulang barang dari katalog aktif.')
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
    if (mutation.isPending) return
    if (!selectedCustomer) return alert('Pilih pelanggan aktif terlebih dahulu.')
    if (!poNumber.trim()) return alert('Masukkan nomor PO terlebih dahulu.')
    if (lineItems.length === 0) {
      alert('PO harus memiliki minimal satu barang.')
      productSearch.current?.focus()
      return
    }
    if (!lineItems.every(validateLine)) return
    setEntryError(null)
    void stockSubmission.run({
      customer_id: customerId,
      po_number: poNumber,
      order_date: orderDate,
      expected_delivery_date: expectedDelivery,
      notes,
      lineItems,
    })
  }

  return (
    <div className="min-h-screen bg-brand-canvas">
      {unsaved.dialog}
      {stockSubmission.warning && <PromoStockWarning warning={stockSubmission.warning} returnFocus={stockTrigger.current} fallbackFocus={() => formFocus.current} pending={mutation.isPending} onContinue={() => void stockSubmission.continue()} onCancel={() => { stockSubmission.cancel(); mutation.reset() }} />}
      <div inert={!!stockSubmission.warning} aria-hidden={stockSubmission.warning ? true : undefined}>

      <AthelNav /><MainContent>
      {(customerReadError || productReadError) && <ReadFailure onRetry={() => { void retryCustomers(); void retryProducts() }} />}
        {!stockSubmission.warning && <TransactionRecovery send={sendTransaction} onCommitted={onCommitted} />}
      <div ref={formFocus} tabIndex={-1} className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <ActionLink variant="quiet" to={'/athel/po'} >← Kembali</ActionLink>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">PO Baru</h1>
          <p className="text-sm text-brand-secondary mt-0.5">Procurement · Purchase Order</p>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

        <PODocumentImport key={`${actorKey}:${customerId}`} customers={customers ?? []} products={products ?? []} actorKey={actorKey}
          disabled={!actorKey || !customers || !products || customerReadError || productReadError || customersFetching || productsFetching || formLocked}
          hasFormEdits={formDirty} onDirtyChange={setImportDirty}
          onApply={(proposed, accept) => unsaved.confirmDiscard(() => {
            const draft = accept ? accept() : proposed
            if (!draft) return
            setCustomerId(draft.customerId); setPoNumber(draft.poNumber); setOrderDate(draft.orderDate)
            setExpectedDelivery(draft.expectedDelivery); setNotes(draft.notes); setLineItems(draft.lineItems)
            setEntryError(null); setEntryNotice(''); setImportDirty(false)
          }, { when: formDirty, message: 'Ganti detail PO dan semua barang dengan hasil dokumen yang sudah diperiksa? Dokumen tidak disimpan dan PO belum dikirim.' })} />

        {/* Detail Pesanan */}
        <fieldset disabled={formLocked} className="min-w-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Detail Pesanan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Field id="po-customer" label="Pelanggan">{control => <POCustomerLookup {...control} customers={customers ?? []} selectedId={customerId} disabled={!customers || customerReadError || customersFetching || formLocked}
                onSelect={customer => {
                  const nextCustomer = customer.id
                  if (nextCustomer === customerId) return
                  unsaved.confirmDiscard(() => {
                    setCustomerId(nextCustomer)
                    setLineItems([])
                    setEntryError(null); setEntryNotice('')
                  }, { when: itemsDirty, message: 'Mengganti pelanggan akan menghapus daftar barang dan harga yang sudah diisi. Detail PO lainnya tetap dipertahankan. Permintaan yang sudah dikirim tidak dibatalkan.' })
                }} />}</Field>
              {selectedCustomer && (
                <p className="text-[13px] text-blue-600 mt-1">
                  Tier harga: <span className="font-medium">{TIER_LABELS[pricingTier]}</span>
                </p>
              )}
            </div>
            <Field id="po-number" label="Nomor PO">{control => <input {...control}
                type="text"
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                placeholder="mis. PO-2024-001"
                className="max-w-full focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />}</Field>
            <Field id="po-order-date" label="Tanggal PO">{control => <input {...control}
                type="date"
                value={orderDate}
                onChange={e => setOrderDate(e.target.value)}
                className="max-w-full focus:outline-none focus:ring-2 focus:ring-brand-primary"
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
            Cari berdasarkan SKU atau nama untuk mengisi otomatis. Harga otomatis sesuai tier pelanggan dan dapat diubah per pesanan.
          </p>

          {!customerId && (
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-4 py-3 mb-4">
              <p className="text-[13px] text-yellow-700">Pilih pelanggan terlebih dahulu agar harga otomatis sesuai tier.</p>
            </div>
          )}

          <div className="mb-4 min-w-0">
            <Field id="po-product-search" label="Cari SKU atau nama barang" hint="Ketik SKU tepat lalu Enter, atau klik hasil pencarian untuk menambahkan barang. Ulangi pencarian untuk barang berikutnya.">{control => <POProductLookup {...control} products={products ?? []} inputRef={productSearch} onSelect={addProduct}
              disabled={!customerId || !selectedCustomer || !products || !customers || customerReadError || productReadError || customersFetching || productsFetching || formLocked} />}</Field>
            {entryNotice && <p role="status" className="text-[13px] text-blue-700 mt-2">{entryNotice}</p>}
          </div>

          {lineItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-brand-secondary">Belum ada barang. Cari SKU atau nama untuk menambahkan barang.</p>
          ) : (
            <div className="min-w-0 space-y-2">
              <POLineItemsHeader />
              {lineItems.map((item, i) => (
                <POLineRow identityLocked key={item._key} lineKey={item._key!} item={item}
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
          <ActionLink variant="quiet" to={'/athel/po'}

          >Batal</ActionLink>
          <Button variant="primary"
            type="button"
            pending={mutation.isPending} onClick={event => { stockTrigger.current = event.currentTarget; handleSubmit() }}
            disabled={formLocked || customerReadError || productReadError || !customers || !products || customersFetching || productsFetching}

          >
            {mutation.isPending ? 'Menyimpan...' : 'Simpan PO'}
          </Button>
        </FormActions>

        {mutation.isError && (
          <p className="text-red-700 text-sm text-right">{(mutation.error as Error).message}</p>
        )}
      </div>
      </MainContent>
      </div>
    </div>
  )
}
