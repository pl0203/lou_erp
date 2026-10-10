import StorePOContext from '../../components/StorePOContext'
import { VisitNoteEditor } from './OwnVisitHistory'
import { compressVisitPhoto } from '../../lib/visitPhoto'
import { formatLineAmount } from '../../lib/catalogPricing'
import { fetchSalesOrderPage } from '../../lib/reads/orders'
import { fetchSalesOrderLines } from '../../lib/reads/detailReads'
import { usePagedRead } from '../../lib/reads/usePagedRead'
import { formatMoney } from '../../lib/reads/money'
import PaginationControls from '../../components/PaginationControls'
import { createVisitCheckIn } from '../../lib/visitCheckIn'
import TransactionRecovery from '../../components/TransactionRecovery'
import { useTransactionSender } from '../../lib/orderTransactions'
import { singleRelation } from '../../lib/relations'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type Schedule = {
  version: number
  sales_person_id: string
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
  note_version: number
  sales_person_id: string
  id: string
  checked_in_at: string
  lat: number | null
  lng: number | null
  notes: string | null
  visit_photos: { id: string; storage_path: string; taken_at: string }[]
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
    .select('id, version, sales_person_id, scheduled_date, status, customers!sales_schedules_outlet_id_fkey(id, name, address, city, pricing_tier)')
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
    .select('id, sales_person_id, checked_in_at, lat, lng, notes, note_version, visit_photos(id, storage_path, taken_at)')
    .eq('schedule_id', scheduleId)
    .maybeSingle()
  if (error) throw error
  return data as Visit | null
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

export default function VisitPage(){const {scheduleId}=useParams<{scheduleId:string}>();const {profile}=useAuth();return <VisitPageContent key={`${profile?.id}:${profile?.role}:${scheduleId}`}/>}
function VisitPageContent(){
 const {scheduleId}=useParams<{scheduleId:string}>();const {profile}=useAuth();const navigate=useNavigate();const queryClient=useQueryClient();const sendVisit=useTransactionSender(`check-in:${scheduleId}`,true);const uploadKey=`pilot-upload:${profile?.id}:${scheduleId}`
 const checkIn=useMemo(()=>createVisitCheckIn(sendVisit,()=>window.localStorage,uploadKey),[sendVisit,uploadKey]);const [showCamera,setShowCamera]=useState(false);const [photoPreview,setPhotoPreview]=useState<string|null>(null);const [photoBlob,setPhotoBlob]=useState<Blob|null>(null);const [notes,setNotes]=useState('');const [location,setLocation]=useState<{lat:number;lng:number}|null>(null);const [locationStatus,setLocationStatus]=useState('idle');const [staleMessage,setStaleMessage]=useState('');const busy=useRef(false)
 type Binding={expected_schedule_version:number;customer_id:string;scheduled_date:string}
 const cameraBinding=useRef<Binding|null>(null);const [photoBinding,setPhotoBinding]=useState<Binding|null>(null)
 useEffect(()=>()=>{if(photoPreview)URL.revokeObjectURL(photoPreview)},[photoPreview])
 const [noteDirty,setNoteDirty]=useState(false)
 const noteDirtyChanged=useCallback((_id:string,dirty:boolean)=>setNoteDirty(dirty),[])
 const unsaved=useUnsavedChanges(!!photoBlob||notes!==''||noteDirty)
 const {data:schedule,isLoading:scheduleLoading,error:scheduleError}=useQuery({queryKey:['schedule',scheduleId,profile?.id,profile?.role],queryFn:()=>fetchSchedule(scheduleId!),enabled:!!scheduleId})
 const {data:visit,isLoading:visitLoading,isError:visitError,refetch:retryVisit}=useQuery({queryKey:['visit',scheduleId,profile?.id,profile?.role],queryFn:()=>fetchVisit(scheduleId!),enabled:!!scheduleId})
 const discardCapture=()=>{setShowCamera(false);setPhotoPreview(null);setPhotoBlob(null);setPhotoBinding(null);cameraBinding.current=null;setLocation(null);setLocationStatus('idle');window.localStorage.removeItem(uploadKey)}
 const saved=()=>{queryClient.invalidateQueries();discardCapture();setNotes('');setStaleMessage('')}
 const checkInMutation=useMutation({mutationFn:checkIn,onSuccess:saved,onError:(error)=>{if(error.message.includes('VISIT_SCHEDULE_CHANGED')){discardCapture();setStaleMessage('Jadwal berubah. Periksa toko dan tanggal terbaru, lalu ambil foto baru.');queryClient.invalidateQueries({queryKey:['schedule',scheduleId]})}},onSettled:()=>{busy.current=false}})
 const openCamera=()=>{if(!schedule||sendVisit.hasUnresolved())return;cameraBinding.current={expected_schedule_version:schedule.version,customer_id:schedule.customers.id,scheduled_date:schedule.scheduled_date};setStaleMessage('');setPhotoBlob(null);setPhotoPreview(null);setPhotoBinding(null);setShowCamera(true)}
 const handleCapture=(blob:Blob,preview:string)=>{setPhotoBlob(blob);setPhotoPreview(preview);setPhotoBinding(cameraBinding.current);setShowCamera(false)}
 const handleCheckIn=()=>{if(!photoBlob||!photoBinding||busy.current)return;busy.current=true;checkInMutation.mutate({schedule_id:scheduleId!,...photoBinding,photo_blob:photoBlob,lat:location?.lat??null,lng:location?.lng??null,notes})}
 const getLocation=()=>{setLocationStatus('loading');if(!navigator.geolocation){setLocationStatus('unavailable');return}navigator.geolocation.getCurrentPosition(pos=>{setLocation({lat:pos.coords.latitude,lng:pos.coords.longitude});setLocationStatus('granted')},()=>setLocationStatus('unavailable'),{timeout:10000,enableHighAccuracy:true})}
 const recovery=<TransactionRecovery send={sendVisit} onCommitted={saved}/>
 if(scheduleLoading||visitLoading)return <div><GirardNav/>{recovery}<p className="p-8">Memuat...</p></div>
 if(!schedule||!schedule.customers)return <div><GirardNav/>{recovery}<p className="p-8 text-red-600">{scheduleError ? scheduleError instanceof ScheduleCustomerUnavailableError ? scheduleError.message:'Gagal memuat jadwal. Silakan muat ulang halaman untuk mencoba lagi.' : !schedule?'Jadwal tidak ditemukan atau Anda tidak memiliki akses.':'Pelanggan untuk jadwal ini tidak tersedia. Hubungi administrator.'}</p></div>
 const customer=schedule.customers
 const canCheckIn=!visit && !visitError && schedule.status==='pending' && schedule.sales_person_id===profile?.id
 return <div className="min-h-screen bg-brand-canvas"><GirardNav/>{unsaved.dialog}{recovery}<header className="bg-white border-b px-4 md:px-8 py-5"><button onClick={()=>navigate(-1)}>← Kembali</button><h1 className="text-xl font-semibold">{customer.name}</h1><p>{[customer.address,customer.city].filter(Boolean).join(', ')}</p><p className="text-sm">Jadwal: {schedule.scheduled_date}</p></header>
 <main className="max-w-2xl mx-auto p-4 space-y-4"><StorePOContext customerId={customer.id}/><section className="bg-white border rounded-2xl p-5 space-y-4"><h2 className="font-medium">Check-in</h2>
 {visitError ? <p role="alert">Status kunjungan belum tersedia. <button onClick={()=>retryVisit()}>Coba lagi</button></p> : visit ? <><p>Sudah check-in</p><p>{new Date(visit.checked_in_at).toLocaleString('id-ID')}</p>{visit.lat!==null && visit.lng!==null && <p>📍 {visit.lat}, {visit.lng}</p>}{visit.visit_photos?.[0] && <CheckInPhoto storagePath={visit.visit_photos[0].storage_path}/>}{visit.sales_person_id===profile?.id ? <VisitNoteEditor visit={visit} onDirtyChange={noteDirtyChanged} confirmDiscard={unsaved.confirmDiscard}/> : <p className="whitespace-pre-wrap">Catatan kunjungan: {visit.notes||'Belum ada catatan.'}</p>}</> : canCheckIn ? <>
 {staleMessage && <p role="alert">{staleMessage}</p>}
 {showCamera ? <><LiveCamera onCapture={handleCapture}/><button onClick={()=>setShowCamera(false)}>Batal</button></> : photoPreview ? <><p>Foto berhasil diambil</p><img src={photoPreview} alt="Foto check-in" className="w-full h-48 object-cover rounded-xl"/><button disabled={checkInMutation.isPending||sendVisit.hasUnresolved()} onClick={openCamera}>Ambil ulang</button></> : <button className="w-full h-36 border-2 border-dashed rounded-xl" onClick={openCamera} disabled={sendVisit.hasUnresolved()}>📷 Ketuk untuk membuka kamera</button>}
 <label className="block">Catatan kunjungan<textarea className="block w-full border rounded p-2" aria-label="Catatan kunjungan" maxLength={2000} value={notes} disabled={checkInMutation.isPending||sendVisit.hasUnresolved()} onChange={e=>setNotes(e.target.value)}/></label>
 {locationStatus==='granted'?<p>✓ Lokasi berhasil didapat</p>:<><button disabled={checkInMutation.isPending||sendVisit.hasUnresolved()||locationStatus==='loading'} onClick={getLocation}>Dapatkan lokasi</button>{locationStatus==='unavailable' && <p>Lokasi tidak tersedia. Anda tetap bisa check-in tanpa lokasi.</p>}</>}
 {!showCamera && <button className="block w-full bg-brand-primary text-white rounded-xl p-3 disabled:opacity-50" onClick={handleCheckIn} disabled={!photoBlob||checkInMutation.isPending}>{checkInMutation.isPending?'Memproses check-in...':'Konfirmasi Check-in'}</button>}
 {checkInMutation.isError && <p role="alert">{checkInMutation.error.message}</p>}
 </> : <p>Check-in hanya tersedia untuk pemilik jadwal yang masih pending.</p>}
 </section>{visit && <section className="bg-white border rounded-2xl"><h2 className="p-5 font-medium">Riwayat pesanan kunjungan</h2><VisitOrderHistory customerId={customer.id} visitId={visit.id}/></section>}<button onClick={()=>navigate('/girard/my-orders')}>Riwayat pesanan saya</button><button className="ml-4" onClick={()=>navigate('/girard/visit-history')}>Riwayat kunjungan saya</button>
 </main></div>
}
