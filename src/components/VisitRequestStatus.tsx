import { LoadingState } from './ui/LoadingState'
import { Button } from './ui/Button'
import { ActionLink } from './ui/ActionLink'
import { Section } from './ui/Section'
import { EmptyState, Notice, StatusBadge } from './ui/Feedback'
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
  return <Section id={`visit-request-${requestId}`} title="Status permintaan yang dipilih">
    {!valid ? <EmptyState title="Permintaan tidak ditemukan atau Anda tidak memiliki akses." />
      : query.isError ? <Notice tone="error" title="Status permintaan belum tersedia." actions={<Button size="compact" variant="secondary" onClick={() => query.refetch()}>Coba lagi status permintaan</Button>} />
      : query.isPending ? <LoadingState title="Memuat status permintaan..." shape="compact" />
      : !query.data ? <EmptyState title="Permintaan tidak ditemukan atau Anda tidak memiliki akses." />
      : <>
        <p className="font-semibold text-gray-900">{query.data.customers?.name ?? 'Nama pelanggan belum tersedia'}</p>
        <p className="text-base text-gray-700">{query.data.kind === 'amendment' ? 'Perubahan jadwal' : 'Kunjungan baru'} · <span>{visitDateLabel(query.data.scheduled_date)}</span></p>
        <StatusBadge tone={query.data.status==='approved'?'success':query.data.status==='pending'?'warning':query.data.status==='rejected'?'error':'neutral'}>{statusLabels[query.data.status]}</StatusBadge>
        {query.data.notes && <p className="whitespace-pre-wrap break-words text-base text-gray-700">{query.data.notes}</p>}
      </>}
    <ActionLink size="compact" variant="quiet" className="mt-4" to="/girard/visit-requests">Lihat semua permintaan</ActionLink>
  </Section>
}
