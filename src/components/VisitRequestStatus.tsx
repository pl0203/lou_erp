import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { singleRelation } from '../lib/relations'
import { isVisitDate, visitDateLabel } from '../lib/visitUsability'
import type { VisitRequest } from '../lib/visitPlanning'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const statusLabels: Record<VisitRequest['status'], string> = { pending: 'Menunggu persetujuan', approved: 'Disetujui', rejected: 'Ditolak', withdrawn: 'Ditarik' }

type RequestStatus = Pick<VisitRequest, 'id' | 'scheduled_date' | 'kind' | 'status' | 'notes'> & { customers: { name: string } | null }
async function fetchRequestStatus(requestId: string, signal?: AbortSignal): Promise<RequestStatus | null> {
  // Exact-ID lookup uses the same authenticated table/RLS as the inbox. Never scan other pages to infer visibility.
  let query = supabase.from('visit_requests').select('id, scheduled_date, status, kind, notes, customers!visit_requests_customer_id_fkey(name)').eq('id', requestId)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) return null
  if (data.id !== requestId || !isVisitDate(data.scheduled_date) || !Object.hasOwn(statusLabels, data.status) || !['new', 'amendment'].includes(data.kind)) throw new Error('Status permintaan belum tersedia.')
  return { ...data, customers: singleRelation(data.customers) } as RequestStatus
}

export default function VisitRequestStatus({ requestId }: { requestId: string }) {
  const { profile } = useAuth()
  const valid = UUID.test(requestId)
  const query = useQuery({ queryKey: ['visit_request_status', profile?.id, profile?.role, requestId], queryFn: ({ signal }) => fetchRequestStatus(requestId, signal), enabled: !!profile?.id && valid })
  if (!profile?.id) return null
  return <section id={`visit-request-${requestId}`} aria-labelledby="selected-visit-request-title" className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
    <h2 id="selected-visit-request-title" className="text-lg font-semibold text-brand-primary">Status permintaan yang dipilih</h2>
    {!valid ? <p>Permintaan tidak ditemukan atau Anda tidak memiliki akses.</p>
      : query.isError ? <div role="alert"><p>Status permintaan belum tersedia.</p><button onClick={() => query.refetch()} className="mt-2 min-h-11 text-sm font-semibold text-brand-primary underline">Coba lagi status permintaan</button></div>
      : query.isPending ? <p role="status">Memuat status permintaan...</p>
      : !query.data ? <p>Permintaan tidak ditemukan atau Anda tidak memiliki akses.</p>
      : <>
        <p className="font-semibold text-gray-900">{query.data.customers?.name ?? 'Nama pelanggan belum tersedia'}</p>
        <p className="text-sm text-gray-700">{query.data.kind === 'amendment' ? 'Perubahan jadwal' : 'Kunjungan baru'} · <span>{visitDateLabel(query.data.scheduled_date)}</span></p>
        <p className="inline-block rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-sm font-semibold">{statusLabels[query.data.status]}</p>
        {query.data.notes && <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{query.data.notes}</p>}
      </>}
    <a href="/girard/visit-requests" className="block min-h-11 py-2 text-sm font-semibold text-brand-primary underline">Lihat semua permintaan</a>
  </section>
}
