import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type Customer = { id: string; name: string }
type Product = { id: string; name: string; sku: string; size: string | null; unit_price: number }

type LineItemRow = {
  id: string | null        // null = new item not yet in DB
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
  total_value: number
  notes: string | null
  customer_id: string
  customers: { name: string }
}

async function fetchPO(id: string): Promise<POData> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id, po_number, status, order_date, expected_delivery_date, total_value, notes, customer_id, customers(name)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as POData
}

async function fetchLineItems(poId: string) {
  const { data, error } = await supabase
    .from('po_line_items')
    .select('id, product_name, sku, quantity, unit_price, line_total')
    .eq('purchase_order_id', poId)
  if (error) throw error
  return data
}

async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase.from('customers').select('id, name').order('name')
  if (error) throw error
  return data
}

async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, size, unit_price')
    .order('name')
  if (error) throw error
  return data
}

async function saveEdits(poId: string, payload: {
  customer_id: string
  expected_delivery_date: string | null
  notes: string | null
  lineItems: LineItemRow[]
}) {
  // Update PO header fields
  const { error: poError } = await supabase
    .from('purchase_orders')
    .update({
      customer_id: payload.customer_id,
      expected_delivery_date: payload.expected_delivery_date,
      notes: payload.notes,
    })
    .eq('id', poId)
  if (poError) throw poError

  // Delete removed line items
  const toDelete = payload.lineItems.filter(l => l._deleted && l.id)
  for (const item of toDelete) {
    const { error } = await supabase.from('po_line_items').delete().eq('id', item.id!)
    if (error) throw error
  }

  // Update existing line items
  const toUpdate = payload.lineItems.filter(l => !l._deleted && l.id)
  for (const item of toUpdate) {
    const { error } = await supabase
      .from('po_line_items')
      .update({
        product_name: item.product_name,
        sku: item.sku || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })
      .eq('id', item.id!)
    if (error) throw error
  }

  // Insert new line items
  const toInsert = payload.lineItems.filter(l => !l._deleted && !l.id)
  if (toInsert.length > 0) {
    const { error } = await supabase.from('po_line_items').insert(
      toInsert.map(item => ({
        purchase_order_id: poId,
        product_name: item.product_name,
        sku: item.sku || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }))
    )
    if (error) throw error
  }
}

function SKULookup({ products, onSelect }: { products: Product[]; onSelect: (p: Product) => void }) {
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
                <span className="text-sm text-gray-600 font-medium">
                  Rp {p.unit_price.toLocaleString('id-ID')}
                </span>
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

  const [customerId, setCustomerId] = useState('')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])
  const [initialized, setInitialized] = useState(false)

  const { data: po, isLoading: poLoading } = useQuery({
    queryKey: ['po', id],
    queryFn: () => fetchPO(id!),
  })

  const { data: existingLines, isLoading: linesLoading } = useQuery({
    queryKey: ['po_line_items', id],
    queryFn: () => fetchLineItems(id!),
    enabled: !!id,
  })

  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers })
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: fetchProducts })

  // Initialize form once data loads
  useEffect(() => {
    if (po && existingLines && !initialized) {
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
      setInitialized(true)
    }
  }, [po, existingLines, initialized])

  const mutation = useMutation({
    mutationFn: () => saveEdits(id!, {
      customer_id: customerId,
      expected_delivery_date: expectedDelivery || null,
      notes: notes || null,
      lineItems,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po', id] })
      queryClient.invalidateQueries({ queryKey: ['po_line_items', id] })
      queryClient.invalidateQueries({ queryKey: ['po_audit_log', id] })
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] })
      navigate(`/athel/po/${id}`)
    },
  })

  const updateLine = (index: number, field: keyof LineItemRow, value: string | number) => {
    setLineItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const fillFromProduct = (index: number, product: Product) => {
    setLineItems(prev => prev.map((item, i) =>
      i === index
        ? { ...item, product_name: product.name, sku: product.sku, unit_price: product.unit_price }
        : item
    ))
  }

  const addLine = () => setLineItems(prev => [
    ...prev,
    { id: null, product_name: '', sku: '', quantity: 1, unit_price: 0 }
  ])

  const removeLine = (index: number) => {
    setLineItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      // If it's an existing DB row, mark as deleted; if new, remove entirely
      return item.id ? { ...item, _deleted: true } : null
    }).filter(Boolean) as LineItemRow[])
  }

  const visibleLines = lineItems.filter(l => !l._deleted)
  const total = visibleLines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)

  const handleSave = () => {
    if (!customerId) return alert('Pilih toko/customer terlebih dahulu.')
    if (visibleLines.some(l => !l.product_name.trim())) return alert('Semua barang harus memiliki nama produk.')
    if (visibleLines.length === 0) return alert('PO harus memiliki minimal satu barang.')
    mutation.mutate()
  }

  if (poLoading || linesLoading) {
    return <div className="p-8 text-gray-400 text-sm">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <button
          onClick={() => navigate(`/athel/po/${id}`)}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          ← Kembali
        </button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Ubah {po?.po_number}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Perubahan akan tercatat di riwayat audit</p>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

        {/* Order Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Detail PO</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Toko/Customer</label>
              <select
                value={customerId}
                onChange={e => setCustomerId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Pilih toko/customer...</option>
                {customers?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
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
              <label className="block text-sm text-gray-600 mb-1">Tanggal PO Expired</label>
              <input
                type="date"
                value={expectedDelivery}
                onChange={e => setExpectedDelivery(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Catatan</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-1">Daftar Barang</h2>
          <p className="text-xs text-gray-400 mb-4">
            Cari untuk mengganti barang atau ubah langsung. Barang yang dihapus akan dihilangkan saat disimpan.
          </p>

          <div className="space-y-4">
            {visibleLines.map((item, i) => {
              const realIndex = lineItems.indexOf(item)
              return (
                <div key={item.id ?? `new-${i}`} className="border border-gray-100 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-12 gap-3 items-end">
                    <div className="col-span-11">
                      <label className="block text-xs text-gray-400 mb-1">
                        Ganti dengan barang lain (opsional)
                      </label>
                      {products && (
                        <SKULookup
                          products={products}
                          onSelect={p => fillFromProduct(realIndex, p)}
                        />
                      )}
                    </div>
                    <button
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
                        value={item.sku}
                        onChange={e => updateLine(realIndex, 'sku', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                      />
                    </div>
                    <div className="col-span-5">
                      <label className="block text-xs text-gray-400 mb-1">Nama Produk</label>
                      <input
                        type="text"
                        value={item.product_name}
                        onChange={e => updateLine(realIndex, 'product_name', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Qty</label>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={e => updateLine(realIndex, 'quantity', parseInt(e.target.value) || 1)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="col-span-4">
                      <label className="block text-xs text-gray-400 mb-1">Harga Satuan (Rp)</label>
                      <input
                        type="number"
                        min={0}
                        value={item.unit_price}
                        onChange={e => updateLine(realIndex, 'unit_price', parseFloat(e.target.value) || 0)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="text-right text-xs text-gray-400">
                    Subtotal:{' '}
                    <span className="text-gray-700 font-medium">
                      Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}
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
              Total:{' '}
              <span className="text-gray-900 font-semibold text-base ml-1">
                Rp {total.toLocaleString('id-ID')}
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
            disabled={mutation.isPending}
            className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
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