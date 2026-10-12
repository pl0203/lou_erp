import { Button } from './ui/Button'
import { ActionLink } from './ui/ActionLink'
import { Section } from './ui/Section'
import { Notice } from './ui/Feedback'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { readCompleteQuery } from '../lib/reads/completeQuery'
import { visitDateLabel } from '../lib/visitUsability'
export default function PendingVisitRequests({ actorId, date }: { actorId: string; date: string }) {
  const pending = useQuery({ queryKey: ['own_pending_visit_requests', actorId, date], queryFn: ({ signal }) => readCompleteQuery((offset, limit) => supabase.from('visit_requests').select('id', { count: 'exact' }).eq('requester_id', actorId).eq('scheduled_date', date).eq('status', 'pending').order('id').range(offset, offset + limit - 1), row => row.id, signal), enabled: !!actorId })
  if (pending.isPending) return <Notice tone="info" title="Memuat status permintaan kunjungan..." />
  if (pending.isError) return <Notice tone="error" title="Status permintaan belum tersedia." actions={<Button variant="secondary" onClick={() => pending.refetch()}>Coba lagi status permintaan</Button>} />
  if (!pending.data?.length) return null
  return <Section title={`${pending.data.length} permintaan menunggu persetujuan`}>
    <p className="mt-1">Tanggal {visitDateLabel(date)}. Permintaan belum menjadi jadwal sampai disetujui.</p>
    <ActionLink variant="secondary" className="mt-3" to="/girard/visit-requests">Buka permintaan kunjungan</ActionLink>
  </Section>
}
