import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { readCompleteQuery } from '../lib/reads/completeQuery'
import { visitDateLabel } from '../lib/visitUsability'
export default function PendingVisitRequests({ actorId, date }: { actorId: string; date: string }) {
  const pending = useQuery({ queryKey: ['own_pending_visit_requests', actorId, date], queryFn: ({ signal }) => readCompleteQuery((offset, limit) => supabase.from('visit_requests').select('id', { count: 'exact' }).eq('requester_id', actorId).eq('scheduled_date', date).eq('status', 'pending').order('id').range(offset, offset + limit - 1), row => row.id, signal), enabled: !!actorId })
  if (pending.isPending) return <p role="status" className="text-sm text-gray-600">Memuat status permintaan kunjungan...</p>
  if (pending.isError) return <p role="alert" className="text-sm text-red-700">Status permintaan belum tersedia. <button className="underline" onClick={() => pending.refetch()}>Coba lagi status permintaan</button></p>
  if (!pending.data?.length) return null
  return <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
    <h2 className="font-semibold">{pending.data.length} permintaan menunggu persetujuan</h2>
    <p className="mt-1">Tanggal {visitDateLabel(date)}. Permintaan belum menjadi jadwal sampai disetujui.</p>
    <a className="mt-2 inline-block font-medium underline" href="/girard/visit-requests">Buka permintaan kunjungan</a>
  </section>
}
