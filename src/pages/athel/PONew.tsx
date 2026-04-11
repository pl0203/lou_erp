import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type LineItem = {
  product_id: string | null
  product_name: string
  sku: string
  quantity: number
  unit_price: number
}

type Customer = { id: string; name: string }
type Product = { id: string; name: string; sku: string; size: string | null; unit_price: number }

const EMPTY_LINE: LineItem = {
  product_id: null,
  product_name: '',
  sku: '',
  quantity: 1,
  unit_price: 0,
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

async function createPO(payload: {
  customer_id: string
  po_number: string
  order_date: string
  expected_delivery_date: string
  notes: string
  lineItems: LineItem[]
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      customer_id: payload.customer_id,
      created_by: user.id,
      po_number: payload.po_number,
      status: 'confirm',
      order_date: payload.order_date,
      expected_delivery_date: payload.expected_delivery_date || null,
      notes: payload.notes || null,
    })
    .select()
    .single()

  if (poError) throw poError

  const { error: lineError } = await supabase
    .from('po_line_items')
    .insert(
      payload.lineItems.map(item => ({
        purchase_order_id: po.id,
        product_name: item.product_name,
        sku: item.sku || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }))
    )

  if (lineError) throw lineError
  return po
}

function SKULookup({
  products,
  onSelect,
}: {
  products: Product[]
  onSelect: (p: Product) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const results = query.trim()
    ? products.filter(
        p =>
          p.sku.toLowerCase().includes(query.toLowerCase()) ||
          p.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : []

  const handleSelect = (p: Product) => {
    onSelect(p)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        placeholder="Search SKU or name..."
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
              onMouseDown={() => handleSelect(p)}
              className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
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

export default function PONew() {
  const navigate = useNavigate()
  const [customerId, setCustomerId] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0])
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([{ ...EMPTY_LINE }])

  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers })
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: fetchProducts })

  const mutation = useMutation({
    mutationFn: createPO,
    onSuccess: po => navigate(`/athel/po/${po.id}`),
  })

  const updateLine = (index: number, field: keyof LineItem, value: string | number | null) => {
    setLineItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const fillFromProduct = (index: number, product: Product) => {
    setLineItems(prev => prev.map((item, i) =>
      i === index
        ? { ...item, product_id: product.id, product_name: product.name, sku: product.sku, unit_price: product.unit_price }
        : item
    ))
  }

  const addLine = () => setLineItems(prev => [...prev, { ...EMPTY_LINE }])
  const removeLine = (index: number) => {
    if (lineItems.length === 1) return
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  const total = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)

  const handleSubmit = () => {
    if (!customerId) return alert('Please select a customer.')
    if (!poNumber.trim()) return alert('Please enter a PO number.')
    if (lineItems.some(l => !l.product_name.trim())) return alert('All line items need a product name.')
    mutation.mutate({ customer_id: customerId, po_number: poNumber, order_date: orderDate, expected_delivery_date: expectedDelivery, notes, lineItems })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <button onClick={() => navigate('/athel/po')} className="text-gray-400 hover:text-gray-600 text-sm">← Back</button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">New Purchase Order</h1>
          <p className="text-sm text-gray-500 mt-0.5">Athel — PO Management</p>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">
        {/* Order Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Order Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Customer</label>
              <select
                value={customerId}
                onChange={e => setCustomerId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select customer...</option>
                {customers?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">PO Number</label>
              <input
                type="text"
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                placeholder="e.g. PO-2024-001"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Order Date</label>
              <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Expected Delivery</label>
              <input type="date" value={expectedDelivery} onChange={e => setExpectedDelivery(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Optional notes..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-1">Line Items</h2>
          <p className="text-xs text-gray-400 mb-4">Search by SKU or name to auto-fill. You can override the price per order.</p>

          <div className="space-y-4">
            {lineItems.map((item, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-4 space-y-3 relative">
                {/* SKU Lookup */}
                <div className="grid grid-cols-12 gap-3 items-end">
                  <div className="col-span-11">
                    <label className="block text-xs text-gray-400 mb-1">Search item by SKU or name</label>
                    {products && (
                      <SKULookup
                        products={products}
                        onSelect={p => fillFromProduct(i, p)}
                      />
                    )}
                  </div>
                  <button
                    onClick={() => removeLine(i)}
                    disabled={lineItems.length === 1}
                    className="col-span-1 text-gray-300 hover:text-red-400 disabled:opacity-20 text-xl text-center pb-1"
                  >
                    ×
                  </button>
                </div>

                {/* Filled fields */}
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-1">
                    <label className="block text-xs text-gray-400 mb-1">SKU</label>
                    <input
                      type="text"
                      value={item.sku}
                      onChange={e => updateLine(i, 'sku', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                    />
                  </div>
                  <div className="col-span-5">
                    <label className="block text-xs text-gray-400 mb-1">Item Name</label>
                    <input
                      type="text"
                      value={item.product_name}
                      onChange={e => updateLine(i, 'product_name', e.target.value)}
                      placeholder="Product name"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Qty</label>
                    <input
                      type="number" min={1}
                      value={item.quantity}
                      onChange={e => updateLine(i, 'quantity', parseInt(e.target.value) || 1)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-4">
                    <label className="block text-xs text-gray-400 mb-1">
                      Unit Price (Rp)
                      {item.product_id && <span className="text-blue-400 ml-1">— editable for this order</span>}
                    </label>
                    <input
                      type="number" min={0}
                      value={item.unit_price}
                      onChange={e => updateLine(i, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Line subtotal */}
                <div className="text-right text-xs text-gray-400">
                  Subtotal: <span className="text-gray-700 font-medium">
                    Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
            <button onClick={addLine} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
              + Add line item
            </button>
            <div className="text-sm text-gray-500">
              Total: <span className="text-gray-900 font-semibold text-base ml-1">
                Rp {total.toLocaleString('id-ID')}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pb-8">
          <button onClick={() => navigate('/athel/po')}
            className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={mutation.isPending}
            className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors">
            {mutation.isPending ? 'Saving...' : 'Save PO'}
          </button>
        </div>

        {mutation.isError && (
          <p className="text-red-500 text-sm text-right">{(mutation.error as Error).message}</p>
        )}
      </div>
    </div>
  )
}