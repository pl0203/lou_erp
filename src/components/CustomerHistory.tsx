import { LoadingState } from './ui/LoadingState'
import { Button } from './ui/Button'
import { Section } from './ui/Section'
import { SummaryList } from './ui/SummaryList'
import { EmptyState, Notice, StatusBadge } from './ui/Feedback'
import { formatVisitTimestamp } from '../lib/visitTimestamp'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { calendarDateKey, parseCalendarDate } from '../lib/calendarDate'
import { formatMoney } from '../lib/reads/money'
import { usePagedRead } from '../lib/reads/usePagedRead'
import { fetchDeliveryPage } from '../lib/reads/detailReads'
import { fetchCustomerOrderPage, fetchCustomerVisitPage, fetchNextCustomerSchedule, fetchVisitEvidence } from '../lib/reads/customerDetailReads'
import PaginationControls from './PaginationControls'

export function customerDate(value: string): string {
  return parseCalendarDate(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}
function useIdentity() {
  const { profile } = useAuth()
  return `${profile?.id ?? ''}:${profile?.role ?? ''}`
}
function ReadError({ message, retry }: { message: string; retry: () => unknown }) {
  return <Notice tone="error" title={message} actions={<Button size="compact" variant="secondary" onClick={() => retry()}>Coba lagi</Button>} />
}
const card = 'min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5'
const action = 'text-left text-brand-primary'

export function NextScheduledVisit({ customerId }: { customerId: string }) {
  const identity = useIdentity(), today = calendarDateKey()
  const query = useQuery({ queryKey: ['next_customer_schedule', identity, customerId, today],
    queryFn: ({ signal }) => fetchNextCustomerSchedule(customerId, today, signal) })
  return <Section title="Kunjungan Berikutnya" aria-label="Kunjungan berikutnya">
    {query.isError ? <ReadError message="Gagal memuat jadwal berikutnya." retry={query.refetch} />
      : query.isPending ? <LoadingState title="Memuat jadwal berikutnya…" shape="compact" className="mt-3 text-base text-brand-secondary" />
      : !query.data ? <EmptyState title="Belum ada kunjungan berikutnya yang dijadwalkan." />
      : <div className="mt-3 space-y-2 text-base break-words [overflow-wrap:anywhere]">
        <p className="font-medium text-gray-900">{customerDate(query.data.scheduled_date)}</p>
        <p className="text-brand-secondary">Sales: <span className="text-gray-900">{query.data.users?.full_name ?? 'Tidak tersedia'}</span></p>
        {query.data.notes && <div><p className="text-[13px] text-brand-secondary">Catatan jadwal</p><p className="mt-1 whitespace-pre-wrap text-gray-700">{query.data.notes}</p></div>}
      </div>}
  </Section>
}

function VisitPhoto({ storagePath, identity }: { storagePath: string; identity: string }) {
  const [imageFailed, setImageFailed] = useState(false)
  const photo = useQuery({
    queryKey: ['customer_visit_photo', identity, storagePath], gcTime: 0, staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('visits').createSignedUrl(storagePath, 3600)
      if (error || !data?.signedUrl) throw new Error('Foto tidak tersedia.')
      return data.signedUrl
    },
  })
  if (photo.isError || imageFailed) return <div className="text-base text-brand-secondary"><p role="alert">Foto tidak dapat dimuat.</p><Button size="compact" variant="secondary" className={action} disabled={photo.isFetching} onClick={() => { setImageFailed(false); void photo.refetch() }}>Coba muat foto lagi</Button></div>
  if (photo.isPending || photo.isFetching) return <LoadingState title="Memuat foto…" shape="compact" className="text-base text-brand-secondary" />
  return <img src={photo.data} onError={() => setImageFailed(true)} alt="Foto check-in" className="max-h-80 w-full rounded-lg object-contain bg-gray-50" />
}

function VisitEvidence({ customerId, visitId }: { customerId: string; visitId: string }) {
  const identity = useIdentity()
  const evidence = useQuery({ queryKey: ['customer_visit_evidence', identity, customerId, visitId],
    queryFn: ({ signal }) => fetchVisitEvidence(customerId, visitId, signal) })
  if (evidence.isError) return <ReadError message="Gagal memuat catatan dan foto." retry={evidence.refetch} />
  if (evidence.isPending) return <LoadingState title="Memuat catatan dan foto…" shape="detail" className="py-3 text-base text-brand-secondary" />
  if (!evidence.data) return <p className="py-3 text-base text-brand-secondary">Catatan dan foto tidak tersedia atau Anda tidak memiliki akses.</p>
  return <div className="space-y-3 border-t border-gray-100 pt-3 text-base">
    <div><h3 className="font-medium text-gray-700">Catatan kunjungan</h3><p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-gray-600">{evidence.data.notes || 'Tidak ada catatan kunjungan.'}</p></div>
    {evidence.data.visit_photos.length === 0 ? <p className="text-brand-secondary">Tidak ada foto kunjungan.</p>
      : evidence.data.visit_photos.map(photo => <VisitPhoto key={`${identity}:${photo.storage_path}`} identity={identity} storagePath={photo.storage_path} />)}
  </div>
}

export function CustomerVisitHistory({ customerId }: { customerId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const history = usePagedRead('visit_history', { customerId }, fetchCustomerVisitPage)
  return <Section title="Riwayat kunjungan" className="space-y-3">
    <p className="text-[13px] text-brand-secondary">Riwayat kunjungan yang dapat Anda akses</p>
    {history.isError ? <ReadError message="Gagal memuat riwayat kunjungan." retry={history.refetch} />
      : !history.data ? <LoadingState title="Memuat riwayat kunjungan…" shape="list" className="py-8 text-base text-brand-secondary" />
      : <div aria-busy={history.isPending} className="space-y-3">
        {history.data.items.length === 0 && <EmptyState title="Belum ada kunjungan tercatat." />}
        {history.data.items.map(visit => <article key={visit.id} className={card}>
          <SummaryList items={[{ label: 'Waktu check-in', value: formatVisitTimestamp(visit.checked_in_at) }, { label: 'Petugas kunjungan', value: visit.users?.full_name ?? 'Tidak tersedia' }]} />
          <Button size="compact" variant="quiet" className={action} aria-expanded={expanded === visit.id} disabled={history.isPending} onClick={() => setExpanded(expanded === visit.id ? null : visit.id)}>{expanded === visit.id ? 'Tutup catatan & foto' : 'Lihat catatan & foto'}</Button>
          {expanded === visit.id && <VisitEvidence customerId={customerId} visitId={visit.id} />}
        </article>)}
        <PaginationControls page={history.data.page} total={history.data.total} pageSize={history.data.page_size} pending={history.isPending} onPageChange={page => { setExpanded(null); history.setPage(page) }} />
      </div>}
  </Section>
}

function CustomerDeliveryHistory({ poId, poNumber }: { poId: string; poNumber: string }) {
  const deliveries = usePagedRead('customer_deliveries', { poId }, (filters, page, signal) => fetchDeliveryPage(filters.poId, page, signal))
  return <section role="region" aria-label={`Riwayat pengiriman ${poNumber}`} className="min-w-0 border-t border-gray-100 pt-3">
    <h3 className="text-base font-medium text-gray-900">Pengiriman / Surat Jalan</h3>
    {deliveries.isError ? <ReadError message="Gagal memuat riwayat pengiriman." retry={deliveries.refetch} />
      : !deliveries.data ? <LoadingState title="Memuat riwayat pengiriman…" shape="list" className="py-3 text-base text-brand-secondary" />
      : <div aria-busy={deliveries.isPending}>
        {deliveries.data.items.length === 0 && <p className="py-3 text-base text-brand-secondary">Belum ada pengiriman tercatat.</p>}
        {deliveries.data.items.map(sj => <div key={sj.id} className="space-y-1 border-b border-gray-100 py-3 text-[13px] text-brand-secondary break-words [overflow-wrap:anywhere]">
          <p className="font-medium text-base text-gray-900">{sj.sj_number}</p>
          {sj.voided_at && <p className="text-red-600">Dibatalkan: {sj.void_reason || 'Tidak ada alasan tercatat'} · {new Date(sj.voided_at).toLocaleString('id-ID')}</p>}
          <p>Tanggal SJ: {customerDate(sj.sj_date)}</p>
          <p>Diterima toko: {sj.sj_date_received ? customerDate(sj.sj_date_received) : 'Belum tercatat'}</p>
          <p>SJ kembali: {sj.sj_date_returned ? customerDate(sj.sj_date_returned) : 'Belum tercatat'}</p>
        </div>)}
        <PaginationControls page={deliveries.data.page} total={deliveries.data.total} pageSize={deliveries.data.page_size} pending={deliveries.isPending} onPageChange={deliveries.setPage} />
      </div>}
  </section>
}
const statusLabels: Record<string, string> = { draft: 'Draft', confirm: 'Dikonfirmasi', in_progress: 'Dalam Proses', complete: 'Selesai', cancelled: 'Dibatalkan' }
export function CustomerOrderHistory({ customerId }: { customerId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const history = usePagedRead('order_history', { customerId }, fetchCustomerOrderPage)
  return <Section title="Riwayat pesanan" className="space-y-3">
    <p className="text-[13px] text-brand-secondary">Riwayat PO yang dapat Anda akses</p>
    {history.isError ? <ReadError message="Gagal memuat riwayat pesanan." retry={history.refetch} />
      : !history.data ? <LoadingState title="Memuat riwayat pesanan…" shape="list" className="py-8 text-base text-brand-secondary" />
      : <div aria-busy={history.isPending} className="space-y-3">
        {history.data.items.length === 0 && <EmptyState title="Belum ada PO tercatat." />}
        {history.data.items.map(po => <article key={po.id} className={card}>
          <div className="flex flex-wrap items-start justify-between gap-2 text-base">
            <p className="min-w-0 font-medium text-gray-900 break-words [overflow-wrap:anywhere]">{po.po_number}</p>
            <StatusBadge tone={po.status === 'complete' ? 'success' : po.status === 'in_progress' ? 'warning' : po.status === 'cancelled' ? 'error' : 'neutral'}>{statusLabels[po.status] ?? po.status.replaceAll('_', ' ')}</StatusBadge>
          </div>
          <p className="mt-2 text-base font-semibold text-gray-900 break-words [overflow-wrap:anywhere]">Rp {formatMoney(String(po.total_value), 'full')}</p>
          <p className="mt-1 text-[13px] text-brand-secondary">Tanggal PO: {customerDate(po.order_date)}</p>
          <Button size="compact" variant="quiet" className={action} disabled={history.isPending} aria-expanded={expanded === po.id} onClick={() => setExpanded(expanded === po.id ? null : po.id)}>{expanded === po.id ? 'Tutup pengiriman / SJ' : 'Lihat pengiriman / SJ'}</Button>
          {expanded === po.id && <CustomerDeliveryHistory key={po.id} poId={po.id} poNumber={po.po_number} />}
        </article>)}
        <PaginationControls page={history.data.page} total={history.data.total} pageSize={history.data.page_size} pending={history.isPending} onPageChange={page => { setExpanded(null); history.setPage(page) }} />
      </div>}
  </Section>
}
