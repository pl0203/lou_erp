import { LoadingState } from '../../components/ui/LoadingState'
import { visitDateLabel } from '../../lib/visitUsability'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../lib/AuthContext'
import { singleRelation } from '../../lib/relations'
import { supabase } from '../../lib/supabase'
import { useVisitPlanningSender } from '../../lib/visitTransactions'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import TransactionRecovery from '../../components/TransactionRecovery'
import GirardNav from '../../components/GirardNav'
import PaginationControls from '../../components/PaginationControls'
import { ActionLink } from '../../components/ui/ActionLink'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormActions } from '../../components/ui/FormActions'
import { EmptyState, Notice } from '../../components/ui/Feedback'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { SummaryList } from '../../components/ui/SummaryList'
import { formatVisitTimestamp } from '../../lib/visitTimestamp'
import './own-visit-history.css'

type NoteSnapshot = { id: string; notes: string | null; note_version: number }
type DiscardConfirmation = (action: () => void, options?: { when?: boolean }) => void
export async function fetchCurrentVisitNote(visitId: string): Promise<NoteSnapshot> {
  const { data, error } = await supabase.from('outlet_visits').select('id, notes, note_version').eq('id', visitId).maybeSingle()
  if (error) throw error
  if (!data || data.id !== visitId || !Number.isSafeInteger(data.note_version) || data.note_version < 1 || (data.notes !== null && typeof data.notes !== 'string')) throw new Error('Catatan terbaru tidak tersedia.')
  return data as NoteSnapshot
}

/** The containing page owns the sole router blocker, including all row drafts. */
export function VisitNoteEditor({ visit, onDirtyChange, confirmDiscard, compact = false, leadingAction }: {
  visit: NoteSnapshot
  onDirtyChange?: (id: string, dirty: boolean) => void
  confirmDiscard?: DiscardConfirmation
  compact?: boolean
  leadingAction?: ReactNode
}) {
  const noteId = useId()
  const send = useVisitPlanningSender(`note:${visit.id}`)
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  // Sender recovery state is mutable; refresh controls without resetting the note draft.
  const [, setRecoveryRevision] = useState(0)
  const [notes, setNotes] = useState(visit.notes ?? '')
  const [baseNotes, setBaseNotes] = useState(visit.notes ?? '')
  const [version, setVersion] = useState(visit.note_version)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [current, setCurrent] = useState<NoteSnapshot | null>(null)
  const [readError, setReadError] = useState(false)
  const lock = useRef(false)
  const dirty = editing && notes !== baseNotes
  useEffect(() => { onDirtyChange?.(visit.id, dirty) }, [visit.id, dirty, onDirtyChange])
  useEffect(() => () => { onDirtyChange?.(visit.id, false) }, [visit.id, onDirtyChange])
  const saved = () => { client.invalidateQueries(); setEditing(false); setError(''); setConflict(false); setCurrent(null) }
  async function reloadCurrent() {
    setReadError(false)
    setCurrent(null)
    try { setCurrent(await fetchCurrentVisitNote(visit.id)) } catch { setReadError(true) }
  }
  async function save(reviewedVersion?: number) {
    if (lock.current || (conflict && reviewedVersion === undefined)) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await send('edit_visit_note', { visit_id: visit.id, expected_version: reviewedVersion ?? version, notes })
      saved()
    } catch (e) {
      const message = (e as Error).message
      setError(message)
      if (message.includes('VISIT_NOTE_CHANGED') || message === 'Visit notes changed; refresh') {
        setConflict(true)
        await reloadCurrent()
      }
    } finally { lock.current = false; setBusy(false) }
  }
  const startEditing = () => { setNotes(visit.notes ?? ''); setBaseNotes(visit.notes ?? ''); setVersion(visit.note_version); setConflict(false); setCurrent(null); setError(''); setEditing(true) }
  return <section className={compact ? 'space-y-3' : 'mt-4 space-y-3'}>
    <TransactionRecovery send={send} onCommitted={saved} onAbandoned={() => setRecoveryRevision(revision => revision + 1)} />
    {compact && <>
      {!editing && visit.notes && <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-brand-secondary">{visit.notes}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {leadingAction}
        {!editing && <Button size="compact" variant="quiet" aria-label="Edit catatan" onClick={startEditing}>Catatan</Button>}
      </div>
    </>}
    {editing ? <>
      <Field id={noteId} label="Catatan kunjungan" hint="Maksimal 2.000 karakter.">
        {control => <textarea {...control} maxLength={2000} value={notes} disabled={busy || send.hasUnresolved()} onChange={e => setNotes(e.target.value)} />}
      </Field>
      <FormActions>
        <Button pending={busy} disabled={send.hasUnresolved() || conflict} onClick={() => save()}>Simpan catatan</Button>
        <Button variant="quiet" disabled={busy} onClick={() => confirmDiscard ? confirmDiscard(() => setEditing(false), { when: dirty }) : setEditing(false)}>Batal</Button>
      </FormActions>
      {conflict && <Notice tone="warning" title="Catatan berubah sejak Anda mulai mengedit. Draf Anda tetap disimpan di formulir ini.">
        {current ? <div className="space-y-3">
          <p className="font-medium">Catatan terbaru di server (versi {current.note_version})</p>
          <p className="whitespace-pre-wrap">{current.notes || 'Belum ada catatan.'}</p>
          <p>Bandingkan dengan draf Anda sebelum memilih catatan yang akan disimpan.</p>
          <FormActions>
            <Button pending={busy} disabled={send.hasUnresolved()} onClick={() => save(current.note_version)}>Simpan draf pada versi terbaru</Button>
            <Button size="compact" variant="secondary" disabled={busy} onClick={() => { setNotes(current.notes ?? ''); setBaseNotes(current.notes ?? ''); setVersion(current.note_version); setConflict(false); setCurrent(null); setError('') }}>Gunakan catatan terbaru</Button>
          </FormActions>
        </div> : readError ? <div className="space-y-3"><p>Catatan terbaru belum tersedia.</p><Button size="compact" variant="secondary" disabled={busy} onClick={reloadCurrent}>Muat catatan terbaru</Button></div> : <LoadingState title="Memuat catatan terbaru..." shape="list" />}
      </Notice>}
    </> : !compact && <>
      <h3 className="font-medium">Catatan kunjungan</h3>
      <p className="whitespace-pre-wrap">{visit.notes || 'Belum ada catatan.'}</p>
      <Button size="compact" variant="quiet" onClick={startEditing}>Edit catatan</Button>
    </>}
    {error && !conflict && <Notice tone="error" title={error} />}
  </section>
}
export async function fetchOwnVisitHistory(actorId:string,page:number){
 const {data,error,count}=await supabase.from('outlet_visits').select('id,outlet_id,sales_person_id,schedule_id,checked_in_at,lat,lng,notes,note_version,customers!outlet_visits_outlet_id_fkey(id,name),sales_schedules(scheduled_date)',{count:'exact'}).eq('sales_person_id',actorId).order('checked_in_at',{ascending:false}).order('id').range((page-1)*20,page*20-1)
 if(error)throw error;if(count===null)throw new Error('Riwayat belum tersedia.');return {items:(data??[]).map(row=>({...row,customers:singleRelation(row.customers),sales_schedules:singleRelation(row.sales_schedules)})) as {customers:{id:string;name:string}|null;sales_schedules:{scheduled_date:string}|null;id:string;outlet_id:string;sales_person_id:string;schedule_id:string|null;checked_in_at:string;lat:number|null;lng:number|null;notes:string|null;note_version:number}[],total:count}
}
export default function OwnVisitHistory() {
  const { profile } = useAuth()
  return <OwnVisitHistoryPage key={`${profile?.id}:${profile?.role}`} />
}
function OwnVisitHistoryPage() {
  const { profile } = useAuth()
  const [page, setPage] = useState(1)
  const [dirtyNotes, setDirtyNotes] = useState<Record<string, boolean>>({})
  const noteDirtyChanged = useCallback((id: string, dirty: boolean) => {
    setDirtyNotes(previous => !!previous[id] === dirty ? previous : { ...previous, [id]: dirty })
  }, [])
  const unsaved = useUnsavedChanges(Object.values(dirtyNotes).some(Boolean))
  const changePage = (next: number) => unsaved.confirmDiscard(() => { setDirtyNotes({}); setPage(next) })
  const query = useQuery({ queryKey: ['own_visit_history', profile?.id, profile?.role, page], queryFn: () => fetchOwnVisitHistory(profile!.id, page), enabled: !!profile?.id })
  return <div className="min-h-screen bg-brand-canvas">
    <GirardNav />{unsaved.dialog}
    <MainContent className="max-w-2xl lg:max-w-6xl mx-auto p-4 lg:p-6 space-y-4" aria-busy={query.isPending}>
      <PageHeader title="Riwayat kunjungan saya" actions={profile?.role !== 'sales_person' ? <ActionLink size="compact" variant="quiet" to="/girard/schedule">Jadwal tim</ActionLink> : undefined} />
      {query.isError ? <Notice tone="error" title="Riwayat belum tersedia." actions={<Button size="compact" variant="secondary" pending={query.isFetching} onClick={() => query.refetch()}>Coba lagi</Button>} />
        : query.isPending ? <LoadingState title="Memuat riwayat..." shape="list" /> : <>
          {query.data?.items.length === 0 && <EmptyState title="Belum ada kunjungan." />}
          {/* One DOM/editor per visit: CSS changes only the layout, never draft ownership. */}
          {!!query.data?.items.length && <table role="table" className="own-visit-history-table">
            <caption className="sr-only">Daftar kunjungan saya</caption>
            <thead role="rowgroup"><tr role="row">
              <th role="columnheader" scope="col">Toko</th>
              <th role="columnheader" scope="col">Waktu check-in</th>
              <th role="columnheader" scope="col">Lokasi</th>
              <th role="columnheader" scope="col">Tindakan</th>
            </tr></thead>
            <tbody role="rowgroup">{query.data.items.map(visit => <tr role="row" key={visit.id}>
              <td role="cell">
                <h2 className="text-base font-semibold break-words">{visit.customers?.name ?? 'Toko tidak tersedia'}</h2>
              </td>
              <td role="cell">
                <dl className="text-sm text-brand-secondary">
                  <dt className="sr-only">Waktu check-in</dt>
                  <dd>{formatVisitTimestamp(visit.checked_in_at)}</dd>
                </dl>
              </td>
              <td role="cell">
                <details className="text-sm">
                  <summary className="min-h-[var(--ui-control-size-compact)] cursor-pointer py-[var(--ui-control-padding-y-compact)] leading-[var(--ui-line-control)] text-brand-secondary rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">
                    {visit.lat == null || visit.lng == null ? 'Lokasi tidak dicatat' : 'Lokasi tercatat'}
                  </summary>
                  <SummaryList className="pb-3" items={[
                    { label: 'Jadwal', value: visit.sales_schedules?.scheduled_date ? visitDateLabel(visit.sales_schedules.scheduled_date) : 'Kunjungan historis' },
                    { label: 'Koordinat GPS', value: visit.lat == null || visit.lng == null ? 'Tidak dicatat' : `${visit.lat}, ${visit.lng}` },
                  ]} />
                </details>
              </td>
              <td role="cell">
                <VisitNoteEditor visit={visit} compact onDirtyChange={noteDirtyChanged} confirmDiscard={unsaved.confirmDiscard}
                  leadingAction={visit.schedule_id ? <ActionLink size="compact" variant="quiet" to={`/girard/visit/${visit.schedule_id}`} aria-label={`Lihat detail kunjungan di ${visit.customers?.name ?? 'Toko tidak tersedia'}`}>Detail</ActionLink> : undefined} />
              </td>
            </tr>)}</tbody>
          </table>}
          {(query.data?.total ?? 0) > 20 || page > 1
            ? <PaginationControls page={page} total={query.data?.total ?? 0} pageSize={20} pending={query.isFetching} onPageChange={changePage} />
            : !!query.data?.total && <p className="text-sm text-brand-secondary">{query.data.total} kunjungan</p>}
        </>}
    </MainContent>
  </div>
}
