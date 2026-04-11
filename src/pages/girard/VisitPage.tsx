import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type Schedule = {
  id: string
  scheduled_date: string
  status: string
  customers: {
    id: string
    name: string
    address: string | null
    city: string | null
  }
}

type Visit = {
  id: string
  checked_in_at: string
  lat: number | null
  lng: number | null
  notes: string | null
  visit_photos: { id: string; storage_path: string; taken_at: string }[]
}

type OrderItem = {
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
  unit_price: number
}

type GirardOrder = {
  id: string
  status: string
  total_value: number
  created_at: string
  girard_order_items: {
    id: string
    product_name: string
    sku: string | null
    quantity: number
    unit_price: number
  }[]
}

async function fetchSchedule(scheduleId: string): Promise<Schedule> {
  const { data, error } = await supabase
    .from('sales_schedules')
    .select('id, scheduled_date, status, customers(id, name, address, city)')
    .eq('id', scheduleId)
    .single()
  if (error) throw error
  return data as Schedule
}

async function fetchVisit(scheduleId: string): Promise<Visit | null> {
  const { data, error } = await supabase
    .from('outlet_visits')
    .select('id, checked_in_at, lat, lng, notes, visit_photos(id, storage_path, taken_at)')
    .eq('schedule_id', scheduleId)
    .maybeSingle()
  if (error) throw error
  return data as Visit | null
}

async function fetchOrders(customerId: string, visitId: string): Promise<GirardOrder[]> {
  const { data, error } = await supabase
    .from('girard_orders')
    .select('id, status, total_value, created_at, girard_order_items(id, product_name, sku, quantity, unit_price)')
    .eq('customer_id', customerId)
    .eq('visit_id', visitId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as GirardOrder[]
}

async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, size, unit_price')
    .order('name')
  if (error) throw error
  return data
}

async function checkIn(payload: {
  schedule_id: string
  outlet_id: string
  sales_person_id: string
  lat: number | null
  lng: number | null
  photo_file: File
}): Promise<Visit> {
  // Upload photo to Supabase Storage
  const fileName = `${payload.schedule_id}_${Date.now()}.jpg`
  const storagePath = `visits/${payload.schedule_id}/${fileName}`

  const { error: uploadError } = await supabase.storage
    .from('visits')
    .upload(storagePath, payload.photo_file, { contentType: 'image/jpeg', upsert: false })
  if (uploadError) throw uploadError

  // Create visit record
  const { data: visit, error: visitError } = await supabase
    .from('outlet_visits')
    .insert({
      outlet_id: payload.outlet_id,
      sales_person_id: payload.sales_person_id,
      schedule_id: payload.schedule_id,
      lat: payload.lat,
      lng: payload.lng,
    })
    .select()
    .single()
  if (visitError) throw visitError

  // Create photo record
  const { error: photoError } = await supabase
    .from('visit_photos')
    .insert({
      visit_id: visit.id,
      storage_path: storagePath,
      lat: payload.lat,
      lng: payload.lng,
      taken_at: new Date().toISOString(),
    })
  if (photoError) throw photoError

  // Update schedule status
  await supabase
    .from('sales_schedules')
    .update({ status: 'completed' })
    .eq('id', payload.schedule_id)

  // Update customer last visit date
  await supabase
    .from('customers')
    .update({ last_visit_date: new Date().toISOString().split('T')[0] })
    .eq('id', payload.outlet_id)

  return visit
}

async function submitOrder(payload: {
  customer_id: string
  visit_id: string
  submitted_by: string
  items: OrderItem[]
}) {
  const total = payload.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)

  const { data: order, error: orderError } = await supabase
    .from('girard_orders')
    .insert({
      customer_id: payload.customer_id,
      visit_id: payload.visit_id,
      submitted_by: payload.submitted_by,
      status: 'pending',
      source: 'sales_initiated',
      total_value: total,
    })
    .select()
    .single()
  if (orderError) throw orderError

  const { error: itemError } = await supabase
    .from('girard_order_items')
    .insert(
      payload.items.map(i => ({
        order_id: order.id,
        product_id: i.product_id,
        product_name: i.product_name,
        sku: i.sku || null,
        quantity: i.quantity,
        unit_price: i.unit_price,
      }))
    )
  if (itemError) throw itemError
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
        placeholder="Search SKU or item name..."
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

const ORDER_STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function VisitPage() {
  const { scheduleId } = useParams<{ scheduleId: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Check-in state
  const [showCamera, setShowCamera] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [gettingLocation, setGettingLocation] = useState(false)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Order state
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [orderItems, setOrderItems] = useState<OrderItem[]>([
    { product_id: null, product_name: '', sku: '', quantity: 1, unit_price: 0 }
  ])

  const { data: schedule, isLoading: scheduleLoading } = useQuery({
    queryKey: ['schedule', scheduleId],
    queryFn: () => fetchSchedule(scheduleId!),
    enabled: !!scheduleId,
  })

  const { data: visit, isLoading: visitLoading } = useQuery({
    queryKey: ['visit', scheduleId],
    queryFn: () => fetchVisit(scheduleId!),
    enabled: !!scheduleId,
  })

  const { data: orders } = useQuery({
    queryKey: ['visit_orders', visit?.id],
    queryFn: () => fetchOrders(schedule!.customers.id, visit!.id),
    enabled: !!visit && !!schedule,
  })

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  })

  const checkInMutation = useMutation({
    mutationFn: checkIn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit', scheduleId] })
      queryClient.invalidateQueries({ queryKey: ['daily_schedule'] })
      setShowCamera(false)
      setPhotoPreview(null)
      setPhotoFile(null)
    },
  })

  const orderMutation = useMutation({
    mutationFn: submitOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit_orders', visit?.id] })
      setShowOrderForm(false)
      setOrderItems([{ product_id: null, product_name: '', sku: '', quantity: 1, unit_price: 0 }])
    },
  })

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const handleGetLocation = () => {
    setGettingLocation(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGettingLocation(false)
      },
      () => {
        setGettingLocation(false)
        alert('Could not get location. You can still check in without it.')
      }
    )
  }

  const handleCheckIn = () => {
    if (!photoFile) return alert('Please take a photo first.')
    if (!profile || !schedule) return

    checkInMutation.mutate({
      schedule_id: scheduleId!,
      outlet_id: schedule.customers.id,
      sales_person_id: profile.id,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      photo_file: photoFile,
    })
  }

  const updateOrderItem = (
    index: number,
    field: keyof OrderItem,
    value: string | number | null
  ) => {
    setOrderItems(prev =>
      prev.map((item, i) => i === index ? { ...item, [field]: value } : item)
    )
  }

  const fillFromProduct = (index: number, product: Product) => {
    setOrderItems(prev =>
      prev.map((item, i) =>
        i === index
          ? { ...item, product_id: product.id, product_name: product.name, sku: product.sku, unit_price: product.unit_price }
          : item
      )
    )
  }

  const addOrderItem = () => setOrderItems(prev => [
    ...prev,
    { product_id: null, product_name: '', sku: '', quantity: 1, unit_price: 0 }
  ])

  const removeOrderItem = (index: number) => {
    if (orderItems.length === 1) return
    setOrderItems(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmitOrder = () => {
    if (!visit || !schedule || !profile) return
    if (orderItems.some(i => !i.product_name.trim())) {
      return alert('All items need a product name.')
    }
    if (orderItems.every(i => i.quantity === 0)) {
      return alert('At least one item must have a quantity.')
    }
    orderMutation.mutate({
      customer_id: schedule.customers.id,
      visit_id: visit.id,
      submitted_by: profile.id,
      items: orderItems,
    })
  }

  const orderTotal = orderItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)

  if (scheduleLoading || visitLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <GirardNav />
        <div className="p-8 text-gray-400 text-sm text-center">Loading...</div>
      </div>
    )
  }

  if (!schedule) {
    return (
      <div className="min-h-screen bg-gray-50">
        <GirardNav />
        <div className="p-8 text-red-500 text-sm">Schedule not found.</div>
      </div>
    )
  }

  const hasVisit = !!visit
  const customer = schedule.customers

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <button
          onClick={() => navigate('/girard/schedule')}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          ← Back
        </button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{customer.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {[customer.address, customer.city].filter(Boolean).join(', ') || 'No address'}
          </p>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto space-y-4">

        {/* Check-in card */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-medium text-gray-900">Check-in</h2>
          </div>

          {!hasVisit ? (
            <div className="px-5 py-5 space-y-4">
              {/* Photo capture */}
              <div>
                <p className="text-sm text-gray-600 mb-2">Take a photo at the outlet</p>
                {photoPreview ? (
                  <div className="relative">
                    <img
                      src={photoPreview}
                      alt="Check-in photo"
                      className="w-full h-48 object-cover rounded-xl"
                    />
                    <button
                      onClick={() => { setPhotoPreview(null); setPhotoFile(null) }}
                      className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-lg"
                    >
                      Retake
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-36 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                  >
                    <span className="text-3xl">📷</span>
                    <span className="text-sm text-gray-400">Tap to take photo</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
              </div>

              {/* Location */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleGetLocation}
                  disabled={gettingLocation || !!location}
                  className={`text-sm px-4 py-2 rounded-lg border transition-colors ${
                    location
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  {gettingLocation ? 'Getting location...' : location ? '✓ Location captured' : 'Get location'}
                </button>
                <span className="text-xs text-gray-400">Optional but recommended</span>
              </div>

              {/* Check in button */}
              <button
                onClick={handleCheckIn}
                disabled={!photoFile || checkInMutation.isPending}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 text-sm"
              >
                {checkInMutation.isPending ? 'Checking in...' : 'Confirm Check-in'}
              </button>

              {checkInMutation.isError && (
                <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-red-600 text-xs">
                    {(checkInMutation.error as Error).message}
                  </p>
                  <button
                    onClick={() => handleCheckIn()}
                    className="text-xs text-red-600 font-medium underline ml-2"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="px-5 py-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                  <span className="text-green-600 text-sm">✓</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Checked in</p>
                  <p className="text-xs text-gray-400">
                    {new Date(visit.checked_in_at).toLocaleString('id-ID')}
                  </p>
                </div>
              </div>
              {visit.lat && visit.lng && (
                <p className="text-xs text-gray-400 mb-3">
                  📍 {visit.lat.toFixed(5)}, {visit.lng.toFixed(5)}
                </p>
              )}
              {/* Show check-in photo */}
              {visit.visit_photos?.[0] && (
                <div className="mt-2">
                  <CheckInPhoto storagePath={visit.visit_photos[0].storage_path} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Orders section — only shown after check-in */}
        {hasVisit && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-medium text-gray-900">Orders</h2>
              {!showOrderForm && (
                <button
                  onClick={() => setShowOrderForm(true)}
                  className="text-sm text-blue-600 font-medium hover:text-blue-800"
                >
                  + New Order
                </button>
              )}
            </div>

            {/* New order form */}
            {showOrderForm && (
              <div className="px-5 py-4 border-b border-gray-100 space-y-4">
                <p className="text-sm font-medium text-gray-700">New Order</p>

                <div className="space-y-3">
                  {orderItems.map((item, i) => (
                    <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-400">Item {i + 1}</p>
                        <button
                          onClick={() => removeOrderItem(i)}
                          disabled={orderItems.length === 1}
                          className="text-gray-300 hover:text-red-400 disabled:opacity-20 text-lg"
                        >
                          ×
                        </button>
                      </div>

                      {products && (
                        <SKULookup
                          products={products}
                          onSelect={p => fillFromProduct(i, p)}
                        />
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Item Name</label>
                          <input
                            type="text"
                            value={item.product_name}
                            onChange={e => updateOrderItem(i, 'product_name', e.target.value)}
                            placeholder="Product name"
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">SKU</label>
                          <input
                            type="text"
                            value={item.sku}
                            onChange={e => updateOrderItem(i, 'sku', e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Qty</label>
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={e => updateOrderItem(i, 'quantity', parseInt(e.target.value) || 1)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Unit Price (Rp)</label>
                          <input
                            type="number"
                            min={0}
                            value={item.unit_price}
                            onChange={e => updateOrderItem(i, 'unit_price', parseFloat(e.target.value) || 0)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <p className="text-right text-xs text-gray-400">
                        Subtotal: <span className="text-gray-700 font-medium">
                          Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addOrderItem}
                  className="text-blue-600 text-sm font-medium hover:text-blue-800"
                >
                  + Add item
                </button>

                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <p className="text-sm text-gray-500">
                    Total: <span className="font-semibold text-gray-900">
                      Rp {orderTotal.toLocaleString('id-ID')}
                    </span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowOrderForm(false)
                        setOrderItems([{ product_id: null, product_name: '', sku: '', quantity: 1, unit_price: 0 }])
                      }}
                      className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitOrder}
                      disabled={orderMutation.isPending}
                      className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {orderMutation.isPending ? 'Submitting...' : 'Submit Order'}
                    </button>
                  </div>
                </div>

                {orderMutation.isError && (
                  <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-red-600 text-xs">
                      {(orderMutation.error as Error).message}
                    </p>
                    <button
                      onClick={handleSubmitOrder}
                      className="text-xs text-red-600 font-medium underline ml-2"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Past orders for this visit */}
            {!orders || orders.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-gray-400 text-sm">No orders placed yet during this visit.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {orders.map(order => (
                  <div key={order.id} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium capitalize ${ORDER_STATUS_STYLES[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {order.status}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(order.created_at).toLocaleString('id-ID')}
                      </span>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400">
                          <th className="text-left pb-1 font-medium">Item</th>
                          <th className="text-right pb-1 font-medium">Qty</th>
                          <th className="text-right pb-1 font-medium">Price</th>
                          <th className="text-right pb-1 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.girard_order_items.map(item => (
                          <tr key={item.id}>
                            <td className="py-0.5 text-gray-700">{item.product_name}</td>
                            <td className="py-0.5 text-right text-gray-600">{item.quantity}</td>
                            <td className="py-0.5 text-right text-gray-600">
                              Rp {item.unit_price.toLocaleString('id-ID')}
                            </td>
                            <td className="py-0.5 text-right text-gray-900 font-medium">
                              Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-100">
                          <td colSpan={3} className="pt-2 text-right text-gray-500 font-medium">Total</td>
                          <td className="pt-2 text-right text-gray-900 font-semibold">
                            Rp {order.total_value.toLocaleString('id-ID')}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Separate component to load signed URL for check-in photo
function CheckInPhoto({ storagePath }: { storagePath: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useState(() => {
    supabase.storage
      .from('visits')
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => {
        if (data) setUrl(data.signedUrl)
      })
  })

  if (!url) return null

  return (
    <img
      src={url}
      alt="Check-in photo"
      className="w-full h-48 object-cover rounded-xl"
    />
  )
}