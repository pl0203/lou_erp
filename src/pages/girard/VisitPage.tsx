import { compressVisitPhoto } from '../../lib/visitPhoto'
import { PRICE_TIERS, resolveCatalogPrice, resolvePromotionPrice, formatCatalogPrice, formatLineAmount } from '../../lib/catalogPricing'
import { fetchSalesOrderPage } from '../../lib/reads/orders'
import { fetchSalesOrderLines, fetchCompleteRows } from '../../lib/reads/detailReads'
import { readComplete } from '../../lib/reads/completeReads'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { formatMoney } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import { createVisitCheckIn } from '../../lib/visitCheckIn'
import TransactionRecovery from '../../components/TransactionRecovery'
import { createTransactionSender, useTransactionSender } from '../../lib/orderTransactions'
import type { TransactionSender } from '../../lib/orderTransactions'
import { singleRelation } from '../../lib/relations'
import { validateOrderLines } from '../../lib/orderValidation'
import { hasOrderItemChanges, useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { useState, useRef, useEffect, useMemo } from 'react'
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
    pricing_tier: string
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
  is_promo?: boolean
  promotion_id?: string | null
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

const TIER_LABELS: Record<string, string> = {
  harga_pokok:   'Harga Pokok',
  luar_kota:     'Luar Kota',
  dalam_kota:    'Dalam Kota',
  depo_bangunan: 'Depo Bangunan',
  others: 'Others',
}

const ORDER_STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
}


class ScheduleCustomerUnavailableError extends Error {}

export async function fetchSchedule(scheduleId: string): Promise<Schedule | null> {
  const { data, error } = await supabase
    .from('sales_schedules')
    .select('id, scheduled_date, status, customers!sales_schedules_outlet_id_fkey(id, name, address, city, pricing_tier)')
    .eq('id', scheduleId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const customer = singleRelation(data.customers)
  if (!customer) throw new ScheduleCustomerUnavailableError('Pelanggan untuk jadwal ini tidak tersedia. Hubungi administrator.')
  return { ...data, customers: customer }
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

async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  return (await fetchCompleteRows<Product>('products', 'id, name, sku, size, unit_price, harga_pokok, luar_kota, dalam_kota, depo_bangunan', {}, signal)).sort((a, b) => a.name.localeCompare(b.name))
}

export async function submitOrder(payload: {
  customer_id: string; visit_id: string; submitted_by: string; items: OrderItem[]
}, send: TransactionSender = createTransactionSender()) {
  validateOrderLines(payload.items)
  return send('submit_sales', { customer_id: payload.customer_id, visit_id: payload.visit_id, items: payload.items })
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
        placeholder="Cari SKU atau nama barang..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-blue-50"
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

function LiveCamera({ onCapture }: { onCapture: (blob: Blob, preview: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mounted = useRef(false)
  const generation = useRef(0)
  const captureBusy = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const startCamera = async () => {
    const request = ++generation.current
    setError(null)
    setStarting(true)
    setReady(false)
    stopCamera()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (!mounted.current || generation.current !== request) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setError(null)
    } catch {
      if (mounted.current && generation.current === request) setError('Akses kamera ditolak. Izinkan akses kamera dan coba lagi.')
    } finally {
      if (mounted.current && generation.current === request) setStarting(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    void startCamera()
    return () => {
      mounted.current = false
      generation.current++
      stopCamera()
    }
  }, [])

  const capturePhoto = async () => {
    const video = videoRef.current
    if (!video || !ready || !video.videoWidth || !video.videoHeight || captureBusy.current) return
    const request = generation.current
    captureBusy.current = true
    setCapturing(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas tidak didukung')
      ctx.drawImage(video, 0, 0)
      const raw = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Foto tidak tersedia')), 'image/webp', 0.9)
      })
      const compressed = await compressVisitPhoto(raw)
      if (!mounted.current || generation.current !== request) return
      const preview = URL.createObjectURL(compressed)
      stopCamera()
      onCapture(compressed, preview)
    } catch {
      if (mounted.current && generation.current === request) {
        stopCamera()
        setReady(false)
        setError('Foto gagal diproses. Coba ambil foto lagi.')
      }
    } finally {
      captureBusy.current = false
      if (mounted.current && generation.current === request) setCapturing(false)
    }
  }

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-black">
      <video ref={videoRef} autoPlay playsInline muted onLoadedData={() => setReady(!!streamRef.current && !!videoRef.current?.videoWidth && !!videoRef.current?.videoHeight)} className="w-full h-56 object-cover" />
      {!error && <button
        aria-label="Ambil foto"
        onClick={capturePhoto}
        disabled={capturing || starting || !ready}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-white border-4 border-gray-300 hover:border-green-500 transition-colors disabled:opacity-50 flex items-center justify-center"
      >
        <div className="w-10 h-10 rounded-full bg-green-500" />
      </button>}
      {(starting || capturing) && <div role="status" className="absolute inset-0 bg-white/70 flex items-center justify-center">
        <p className="text-sm text-gray-700 font-medium">{starting ? 'Membuka kamera...' : 'Mengambil foto...'}</p>
      </div>}
      {error && <div className="absolute inset-0 bg-gray-100 flex flex-col items-center justify-center gap-2 p-4">
        <span className="text-3xl" aria-hidden="true">📷</span>
        <p role="alert" className="text-sm text-red-500 text-center">{error}</p>
        <button onClick={startCamera} disabled={starting} className="text-xs text-brand-primary font-medium underline mt-1">Coba lagi</button>
      </div>}
    </div>
  )
}

function CheckInPhoto({ storagePath }: { storagePath: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    supabase.storage
      .from('visits')
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => { if (data) setUrl(data.signedUrl) })
  }, [storagePath])
  if (!url) return null
  return <img src={url} alt="Foto check-in" className="w-full h-48 object-cover rounded-xl" />
}

type ActivePromo = {
  id: string
  product_id: string
  harga_pokok: number | null
  luar_kota: number | null
  dalam_kota: number | null
  depo_bangunan: number | null
  products: {
    name: string
    sku: string
    size: string | null
    harga_pokok: number | null
    luar_kota: number | null
    dalam_kota: number | null
    depo_bangunan: number | null
  } | null
}

async function fetchActivePromos(signal?: AbortSignal): Promise<ActivePromo[]> {
  const today = new Date().toISOString().split('T')[0]
  return readComplete<ActivePromo>(async (offset, limit) => {
    let query = supabase.from('promotions')
      .select('id, product_id, harga_pokok, luar_kota, dalam_kota, depo_bangunan, products(name, sku, size, harga_pokok, luar_kota, dalam_kota, depo_bangunan)', { count: 'exact' })
      .eq('is_active', true).lte('start_date', today).gte('end_date', today).order('id').range(offset, offset + limit - 1)
    if (signal) query = query.abortSignal(signal)
    const { data, error, count } = await query
    if (error) throw error
    return { items: (data ?? []).map(row => ({ ...row, products: singleRelation(row.products) })), total: count as number }
  }, row => row.id, signal)
}

function getActivePromoTierPrice(
  promo: ActivePromo,
  tier: 'harga_pokok' | 'luar_kota' | 'dalam_kota' | 'depo_bangunan'
): number | null {
  return resolvePromotionPrice(promo, tier)
}

function VisitOrderHistory({ customerId, visitId }: { customerId: string; visitId: string }) {
  const orders = usePagedRead('visit_orders', { status: 'all' as const, ownOnly: false, customerId, visitId }, fetchSalesOrderPage)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const lines = useQuery({ queryKey: ['sales_order_lines', selectedId], queryFn: ({ signal }) => fetchSalesOrderLines(selectedId!, signal), enabled: !!selectedId })
  if (orders.isError) return <div role="alert" className="p-5 text-sm text-red-600">Riwayat pesanan gagal dimuat. <button onClick={() => orders.refetch()} className="underline">Coba lagi</button></div>
  return <div className="p-5" aria-busy={orders.isPending}>
    {!orders.isPending && orders.data?.total === 0 && <p className="text-sm text-gray-400">Belum ada pesanan dalam kunjungan ini.</p>}
    {orders.data?.items?.map(order => <div key={order.id} className="py-4 border-b border-gray-100">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${ORDER_STATUS_STYLES[order.status] ?? 'bg-gray-100 text-gray-600'}`}>{order.status === 'pending' ? 'Menunggu' : order.status === 'approved' ? 'Disetujui' : order.status === 'rejected' ? 'Ditolak' : order.status}</span>
        <span className="text-xs text-gray-400">{new Date(order.created_at).toLocaleString('id-ID')}</span>
      </div>
      <div className="flex justify-between text-sm"><button disabled={orders.isPending} className="text-brand-primary" onClick={() => setSelectedId(selectedId === order.id ? null : order.id)}>{selectedId === order.id ? 'Tutup barang' : 'Lihat barang'}</button><span>Rp {formatMoney(order.total_value, 'full')}</span></div>
      {selectedId === order.id && (lines.isError ? <p role="alert" className="text-sm text-red-600">Barang pesanan gagal dimuat. <button onClick={() => lines.refetch()}>Coba lagi</button></p>
        : lines.isPending ? <p role="status">Memuat barang…</p> : <table className="w-full mt-3 text-xs"><thead><tr><th className="text-left">Barang</th><th>Jml</th><th>Harga</th><th>Total</th></tr></thead><tbody>
          {lines.data?.map(item => <tr key={item.id}><td>{item.product_name}</td><td>{item.quantity}</td><td>Rp {item.unit_price.toLocaleString('id-ID')}</td><td>{formatLineAmount(item.quantity, item.unit_price)}</td></tr>)}
        </tbody></table>)}
    </div>)}
    <PaginationControls page={orders.page} total={orders.data?.total ?? 0} pageSize={10} pending={orders.isPending} onPageChange={page => { setSelectedId(null); orders.setPage(page) }} />
  </div>
}

export default function VisitPage() {
  const { data: activePromos, isError: promosError, refetch: refetchPromos } = useQuery({
    queryKey: ['active_promos', 'complete'],
    queryFn: ({ signal }) => fetchActivePromos(signal),
  })
  const { scheduleId } = useParams<{ scheduleId: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sendTransaction = useTransactionSender(`sales-visit:${scheduleId}`)
  const sendVisit = useTransactionSender(`check-in:${scheduleId}`, true)
  const uploadKey = `pilot-upload:${profile?.id}:${scheduleId}`
  const checkIn = useMemo(() => createVisitCheckIn(sendVisit, () => window.localStorage, uploadKey), [sendVisit, uploadKey])

  const [showCamera, setShowCamera] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview) }, [photoPreview])
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'granted' | 'denied' | 'unavailable'>('idle')
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [orderItems, setOrderItems] = useState<OrderItem[]>([
    { product_id: null, product_name: '', sku: '', quantity: 1, unit_price: Number.NaN }
  ])
  const unsaved = useUnsavedChanges(showOrderForm && hasOrderItemChanges(orderItems))

  const { data: schedule, isLoading: scheduleLoading, error: scheduleError } = useQuery({
    queryKey: ['schedule', scheduleId],
    queryFn: () => fetchSchedule(scheduleId!),
    enabled: !!scheduleId,
  })

  const { data: visit, isLoading: visitLoading } = useQuery({
    queryKey: ['visit', scheduleId],
    queryFn: () => fetchVisit(scheduleId!),
    enabled: !!scheduleId,
  })

  const { data: products, isError: productsError, refetch: refetchProducts } = useQuery({
    queryKey: ['products', 'complete', 'visit'], queryFn: ({ signal }) => fetchProducts(signal),
  })

  const checkInMutation = useMutation({
    mutationFn: checkIn,
    onSuccess: () => {
      queryClient.invalidateQueries()
      setShowCamera(false)
      setPhotoPreview(null)
      setPhotoBlob(null)
      window.localStorage.removeItem(uploadKey)
    },
  })

  const orderMutation = useMutation({
    mutationFn: (payload: Parameters<typeof submitOrder>[0]) => submitOrder(payload, sendTransaction),
    onSuccess: () => {
      queryClient.invalidateQueries()
      setShowOrderForm(false)
      setOrderItems([{ product_id: null, product_name: '', sku: '', quantity: 1, unit_price: Number.NaN }])
    },
  })

  const handleCapture = (blob: Blob, preview: string) => {
    setPhotoBlob(blob)
    setPhotoPreview(preview)
    setShowCamera(false)
  }

  const handleGetLocation = async () => {
    setLocationStatus('loading')
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' })
        if (result.state === 'denied') { setLocationStatus('denied'); return }
      } catch { }
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocationStatus('granted')
      },
      err => {
        if (err.code === err.PERMISSION_DENIED) setLocationStatus('denied')
        else setLocationStatus('unavailable')
      },
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

  const handleCheckIn = () => {
    if (!photoBlob) return alert('Ambil foto terlebih dahulu.')
    if (!profile || !schedule?.customers) return
    checkInMutation.mutate({
      schedule_id: scheduleId!,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      photo_blob: photoBlob,
    })
  }

  const updateOrderItem = (index: number, field: keyof OrderItem, value: string | number | null) => {
    setOrderItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const fillFromProduct = (index: number, product: Product) => {
    const tier = schedule?.customers?.pricing_tier ?? 'others'
    const price = resolveCatalogPrice(product, tier) ?? Number.NaN
    setOrderItems(prev => prev.map((item, i) =>
      i === index
        ? { ...item, product_id: product.id, product_name: product.name, sku: product.sku, unit_price: price }
        : item
    ))
  }

  const addPromoItem = (promo: ActivePromo) => {
    if (!promo.products) return
    const tier = schedule?.customers?.pricing_tier ?? 'others'
    const price = getActivePromoTierPrice(
      promo,
      tier as 'harga_pokok' | 'luar_kota' | 'dalam_kota' | 'depo_bangunan'
    )
    if (price === null) return alert(PRICE_TIERS.some(known => known === tier) ? 'Harga promosi untuk tier pelanggan belum diisi. Hubungi admin untuk melengkapi harga promosi.' : 'Promosi tidak tersedia untuk kelompok pelanggan ini.')
    setOrderItems(prev => {
      const exists = prev.find(i => i.product_id === promo.product_id && i.is_promo)
      if (exists) return prev
      return [...prev, {
        product_id: promo.product_id,
        product_name: promo.products.name,
        sku: promo.products.sku,
        quantity: 1,
        unit_price: price,
        is_promo: true,
        promotion_id: promo.id,
      }]
    })
  }

  const addOrderItem = () => setOrderItems(prev => [
    ...prev,
    { product_id: null, product_name: '', sku: '', quantity: 1, unit_price: Number.NaN }
  ])

  const removeOrderItem = (index: number) => {
    if (orderItems.length === 1) return
    setOrderItems(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmitOrder = () => {
    if (!visit || !schedule?.customers || !profile) return
    if (orderItems.some(i => !i.product_name.trim())) return alert('Semua barang harus memiliki nama produk.')
    if (orderItems.every(i => i.quantity === 0)) return alert('Minimal satu barang harus memiliki jumlah.')
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
      <div className="min-h-screen bg-brand-canvas">
        {unsaved.dialog}
        <GirardNav />
        <TransactionRecovery send={sendVisit} onCommitted={() => { queryClient.invalidateQueries(); setShowCamera(false); setPhotoPreview(null); setPhotoBlob(null); window.localStorage.removeItem(uploadKey) }} />
        <TransactionRecovery send={sendTransaction} onCommitted={() => { queryClient.invalidateQueries(); setShowOrderForm(false); setOrderItems([{ product_id: null, product_name: '', sku: '', quantity: 1, unit_price: Number.NaN }]) }} />
        <div className="p-8 text-gray-400 text-sm text-center">Memuat...</div>
      </div>
    )
  }

  if (!schedule || !schedule.customers) {
    return (
      <div className="min-h-screen bg-brand-canvas">
        {unsaved.dialog}
        <GirardNav />
        <TransactionRecovery send={sendVisit} onCommitted={() => { queryClient.invalidateQueries(); setShowCamera(false); setPhotoPreview(null); setPhotoBlob(null); window.localStorage.removeItem(uploadKey) }} />
        <TransactionRecovery send={sendTransaction} onCommitted={() => { queryClient.invalidateQueries(); setShowOrderForm(false); setOrderItems([{ product_id: null, product_name: '', sku: '', quantity: 1, unit_price: Number.NaN }]) }} />
        <div className="p-8 text-red-500 text-sm">{scheduleError
          ? scheduleError instanceof ScheduleCustomerUnavailableError ? scheduleError.message : 'Gagal memuat jadwal. Silakan muat ulang halaman untuk mencoba lagi.'
          : !schedule ? 'Jadwal tidak ditemukan atau Anda tidak memiliki akses.' : 'Pelanggan untuk jadwal ini tidak tersedia. Hubungi administrator.'}</div>
      </div>
    )
  }

  const hasVisit = !!visit
  const customer = schedule.customers

  return (
    <div className="min-h-screen bg-brand-canvas">
      {unsaved.dialog}
      <GirardNav />
        <TransactionRecovery send={sendVisit} onCommitted={() => { queryClient.invalidateQueries(); setShowCamera(false); setPhotoPreview(null); setPhotoBlob(null); window.localStorage.removeItem(uploadKey) }} />
        <TransactionRecovery send={sendTransaction} onCommitted={() => { queryClient.invalidateQueries(); setShowOrderForm(false); setOrderItems([{ product_id: null, product_name: '', sku: '', quantity: 1, unit_price: Number.NaN }]) }} />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 text-sm">
          ← Kembali
        </button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{customer.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {[customer.address, customer.city].filter(Boolean).join(', ') || 'Tidak ada alamat'}
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
              {showCamera && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">Ambil foto langsung</p>
                  <LiveCamera onCapture={handleCapture} />
                  <button onClick={() => setShowCamera(false)} className="text-xs text-gray-400 mt-2 hover:text-gray-600">
                    Batal
                  </button>
                </div>
              )}

              {!showCamera && photoPreview && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">Foto berhasil diambil</p>
                  <div className="relative">
                    <img src={photoPreview} alt="Foto check-in" className="w-full h-48 object-cover rounded-xl" />
                    <button
                      onClick={() => { setPhotoPreview(null); setPhotoBlob(null); setShowCamera(true) }}
                      className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-lg"
                    >
                      Ambil ulang
                    </button>
                  </div>
                </div>
              )}

              {!showCamera && !photoPreview && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">Ambil foto langsung di lokasi</p>
                  <button
                    onClick={() => setShowCamera(true)}
                    className="w-full h-36 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-2 hover:border-green-300 hover:bg-green-50 transition-colors"
                  >
                    <span className="text-3xl">📷</span>
                    <span className="text-sm text-gray-400">Ketuk untuk membuka kamera</span>
                    <span className="text-xs text-gray-300">Hanya foto langsung</span>
                  </button>
                </div>
              )}

              {!showCamera && (
                <div className="space-y-2">
                  {locationStatus === 'idle' && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleGetLocation}
                        className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Dapatkan lokasi
                      </button>
                      <span className="text-xs text-gray-400">Opsional tapi dianjurkan</span>
                    </div>
                  )}
                  {locationStatus === 'loading' && (
                    <span className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-400 inline-block">
                      Mendapatkan lokasi...
                    </span>
                  )}
                  {locationStatus === 'granted' && (
                    <span className="inline-flex text-sm px-4 py-2 rounded-lg border border-green-200 bg-green-50 text-green-700">
                      ✓ Lokasi berhasil didapat
                    </span>
                  )}
                  {locationStatus === 'denied' && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3">
                      <div>
                        <p className="text-xs font-medium text-orange-700 mb-1">Akses lokasi diblokir</p>
                        <p className="text-xs text-orange-600">Anda perlu mengizinkan akses lokasi di pengaturan browser.</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-orange-100">
                        <p className="text-xs font-medium text-gray-700 mb-2">Android (Chrome):</p>
                        <ol className="text-xs text-gray-600 space-y-1 list-decimal ml-4">
                          <li>Ketuk <strong>ikon gembok</strong> di bilah alamat</li>
                          <li>Ketuk <strong>Izin</strong></li>
                          <li>Ketuk <strong>Lokasi</strong> → Izinkan</li>
                          <li>Muat ulang halaman dan coba lagi</li>
                        </ol>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-orange-100">
                        <p className="text-xs font-medium text-gray-700 mb-2">iPhone (Safari):</p>
                        <ol className="text-xs text-gray-600 space-y-1 list-decimal ml-4">
                          <li>Buka <strong>Pengaturan</strong> → <strong>Privasi</strong></li>
                          <li>Ketuk <strong>Layanan Lokasi</strong></li>
                          <li>Cari <strong>Safari</strong> → atur ke <strong>Saat Digunakan</strong></li>
                          <li>Kembali dan coba lagi</li>
                        </ol>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => { setLocationStatus('idle'); handleGetLocation() }}
                          className="text-xs bg-orange-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-orange-700"
                        >
                          Coba lagi
                        </button>
                        <button
                          onClick={() => setLocationStatus('idle')}
                          className="text-xs text-orange-500 hover:text-orange-700"
                        >
                          Lewati lokasi
                        </button>
                      </div>
                    </div>
                  )}
                  {locationStatus === 'unavailable' && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">Lokasi tidak tersedia — Anda tetap bisa check-in tanpa lokasi.</span>
                      <button onClick={() => setLocationStatus('idle')} className="text-xs text-brand-primary underline">
                        Coba lagi
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!showCamera && (
                <>
                  <button
                    onClick={handleCheckIn}
                    disabled={!photoBlob || checkInMutation.isPending}
                    className="w-full bg-brand-primary hover:bg-brand-hover text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 text-sm"
                  >
                    {checkInMutation.isPending ? 'Memproses check-in...' : 'Konfirmasi Check-in'}
                  </button>
                  {checkInMutation.isError && (
                    <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-red-600 text-xs">{(checkInMutation.error as Error).message}</p>
                      <button onClick={handleCheckIn} className="text-xs text-red-600 font-medium underline ml-2">
                        Coba lagi
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="px-5 py-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                  <span className="text-green-600 text-sm">✓</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Sudah check-in</p>
                  <p className="text-xs text-gray-400">{new Date(visit.checked_in_at).toLocaleString('id-ID')}</p>
                </div>
              </div>
              {visit.lat && visit.lng && (
                <p className="text-xs text-gray-400 mb-3">📍 {visit.lat.toFixed(5)}, {visit.lng.toFixed(5)}</p>
              )}
              {visit.visit_photos?.[0] && (
                <CheckInPhoto storagePath={visit.visit_photos[0].storage_path} />
              )}
            </div>
          )}
        </div>

        {/* Orders section */}
        {hasVisit && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-medium text-gray-900">Pesanan</h2>
              {!showOrderForm && (
                <button
                  onClick={() => setShowOrderForm(true)}
                  className="text-sm text-brand-primary font-medium hover:text-brand-hover"
                >
                  + Pesanan Baru
                </button>
              )}
            </div>

            {showOrderForm && (
              <div className="px-5 py-4 border-b border-gray-100 space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  <p className="text-xs text-blue-600">
                    Harga yang digunakan: <span className="font-semibold">
                      {TIER_LABELS[schedule?.customers?.pricing_tier ?? 'others']}
                    </span>
                  </p>
                </div>

                <p className="text-sm font-medium text-gray-700">Pesanan Baru</p>
                {/* Active promos */}
                {activePromos && activePromos.length > 0 && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-semibold text-orange-700">🔥 Product Highlight — Harga Spesial</p>
                    <p className="text-xs text-orange-500">
                      Harga sudah sesuai tier pelanggan ({TIER_LABELS[schedule?.customers?.pricing_tier ?? 'others']}) dan tidak dapat diubah.
                    </p>
                    <div className="space-y-2">
                      {activePromos.map(promo => {
                        const tier = schedule?.customers?.pricing_tier ?? 'others'
                        const price = getActivePromoTierPrice(
                          promo,
                          tier as 'harga_pokok' | 'luar_kota' | 'dalam_kota' | 'depo_bangunan'
                        )
                        const alreadyAdded = orderItems.some(i => i.product_id === promo.product_id && i.is_promo)
                        return (
                          <div key={promo.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-orange-100">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-900 truncate">{promo.products?.name ?? 'Produk tidak tersedia'}</p>
                              <p className="text-xs text-gray-500">
                                {formatCatalogPrice(price)}
                              </p>
                              {price === null && <p className="text-xs text-orange-700">{PRICE_TIERS.some(known => known === tier) ? 'Hubungi admin untuk melengkapi harga promosi tier ini.' : 'Promosi tidak tersedia untuk kelompok pelanggan ini.'}</p>}
                            </div>
                            <button
                              onClick={() => addPromoItem(promo)}
                              disabled={alreadyAdded || !promo.products || price === null}
                              className={`ml-3 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 transition-colors ${
                                alreadyAdded || !promo.products || price === null
                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                  : 'bg-orange-500 text-white hover:bg-orange-600'
                              }`}
                            >
                              {price === null ? 'Harga belum diisi' : alreadyAdded ? '✓ Ditambah' : '+ Tambah'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  {orderItems.map((item, i) => (
                    <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-400">Barang {i + 1}</p>
                        <button
                          onClick={() => removeOrderItem(i)}
                          disabled={orderItems.length === 1}
                          className="text-gray-300 hover:text-red-400 disabled:opacity-20 text-lg"
                        >×</button>
                      </div>
                      {products && <SKULookup products={products} onSelect={p => fillFromProduct(i, p)} />}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Nama Barang</label>
                          <input
                            type="text"
                            value={item.product_name}
                            onChange={e => updateOrderItem(i, 'product_name', e.target.value)}
                            placeholder="Nama produk"
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">SKU</label>
                          <input
                            type="text"
                            value={item.sku}
                            onChange={e => updateOrderItem(i, 'sku', e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-brand-primary"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Jumlah</label>
                          <input
                            type="number" min={1}
                            value={Number.isNaN(item.quantity) ? '' : item.quantity}
                            onChange={e => updateOrderItem(i, 'quantity', e.target.valueAsNumber)}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                          />
                        </div>
                        <div className="col-span-4">
                          <label className="block text-xs text-gray-400 mb-1">
                            Harga Satuan (Rp)
                            {item.is_promo
                              ? <span className="ml-1 text-orange-500 font-medium">🔥 Harga Promosi</span>
                              : item.product_id && <span className="text-blue-400 ml-1">— dapat diubah</span>
                            }
                          </label>
                          <input
                            type="number" min={0} step="0.01"
                            aria-label="Harga satuan"
                        required
                        placeholder="Harga belum diisi"
                        value={Number.isNaN(item.unit_price) ? '' : item.unit_price}
                            onChange={e => !item.is_promo && updateOrderItem(i, 'unit_price', e.target.valueAsNumber)}
                            readOnly={item.is_promo}
                            className={`w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 ${
                              item.is_promo
                                ? 'border-orange-200 bg-orange-50 text-orange-700 cursor-not-allowed focus:ring-brand-primary'
                                : 'border-gray-200 focus:ring-brand-primary'
                            }`}
                          />
                        </div>
                      </div>
                      {Number.isNaN(item.unit_price) && <p className="text-xs text-amber-700">Isi harga satuan sebelum menyimpan. Nol hanya untuk barang gratis.</p>}
                  <p className="text-right text-xs text-gray-400">
                        Subtotal: <span className="text-gray-700 font-medium">
                          {formatLineAmount(item.quantity, item.unit_price)}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
                <button onClick={addOrderItem} className="text-brand-primary text-sm font-medium hover:text-brand-hover">
                  + Tambah barang
                </button>
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <p className="text-sm text-gray-500">
                    Total: <span className="font-semibold text-gray-900">{Number.isFinite(orderTotal) ? `Rp ${orderTotal.toLocaleString('id-ID')}` : 'Harga belum lengkap'}</span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        unsaved.confirmDiscard(() => {
                          setShowOrderForm(false)
                          setOrderItems([{ product_id: null, product_name: '', sku: '', quantity: 1, unit_price: Number.NaN }])
                        })
                      }}
                      className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      Batal
                    </button>
                    <button
                      onClick={handleSubmitOrder}
                      disabled={orderMutation.isPending}
                      className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-hover disabled:opacity-50"
                    >
                      {orderMutation.isPending ? 'Mengirim...' : 'Kirim Pesanan'}
                    </button>
                  </div>
                </div>
                {orderMutation.isError && (
                  <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-red-600 text-xs">{(orderMutation.error as Error).message}</p>
                    <button onClick={handleSubmitOrder} className="text-xs text-red-600 font-medium underline ml-2">
                      Coba lagi
                    </button>
                  </div>
                )}
              </div>
            )}

            {(productsError || promosError) && <div role="alert" className="p-5 text-sm text-red-600">Pilihan produk atau promosi belum lengkap. <button onClick={() => { refetchProducts(); refetchPromos() }} className="underline">Coba lagi</button></div>}
            <VisitOrderHistory key={visit.id} customerId={schedule.customers.id} visitId={visit.id} />
          </div>
        )}
      </div>
    </div>
  )
}
