import { visitDateLabel } from '../../lib/visitUsability'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
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
import { RecordList } from '../../components/ui/RecordList'
import { SummaryList } from '../../components/ui/SummaryList'
import { formatVisitTimestamp } from '../../lib/visitTimestamp'

type NoteSnapshot = { id: string; notes: string | null; note_version: number }
type DiscardConfirmation = (action: () => void, options?: { when?: boolean }) => void
export async function fetchCurrentVisitNote(visitId: string): Promise<NoteSnapshot> {
  const { data, error } = await supabase.from('outlet_visits').select('id, notes, note_version').eq('id', visitId).maybeSingle()
  if (error) throw error
  if (!data || data.id !== visitId || !Number.isSafeInteger(data.note_version) || data.note_version < 1 || (data.notes !== null && typeof data.notes !== 'string')) throw new Error('Catatan terbaru tidak tersedia.')
  return data as NoteSnapshot
}

/** The containing page owns the sole router blocker, including all row drafts. */
export function VisitNoteEditor({ visit, onDirtyChange, confirmDiscard }: {
  visit: NoteSnapshot
  onDirtyChange?: (id: string, dirty: boolean) => void
  confirmDiscard?: DiscardConfirmation
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
  return <section className="mt-4 space-y-3">
    <TransactionRecovery send={send} onCommitted={saved} onAbandoned={() => setRecoveryRevision(revision => revision + 1)} />
    {editing ? <>
      <Field id={noteId} label="Catatan kunjungan" hint="Maksimal 2.000 karakter.">
        {control => <textarea {...control} maxLength={2000} value={notes} disabled={busy || send.hasUnresolved()} onChange={e => setNotes(e.target.value)} />}
      </Field>
      <FormActions>
        <Button pending={busy} disabled={send.hasUnresolved() || conflict} onClick={() => save()}>Simpan catatan</Button>
        <Button variant="secondary" disabled={busy} onClick={() => confirmDiscard ? confirmDiscard(() => setEditing(false), { when: dirty }) : setEditing(false)}>Batal</Button>
      </FormActions>
      {conflict && <Notice tone="warning" title="Catatan berubah sejak Anda mulai mengedit. Draf Anda tetap disimpan di formulir ini.">
        {current ? <div className="space-y-3">
          <p className="font-medium">Catatan terbaru di server (versi {current.note_version})</p>
          <p className="whitespace-pre-wrap">{current.notes || 'Belum ada catatan.'}</p>
          <p>Bandingkan dengan draf Anda sebelum memilih catatan yang akan disimpan.</p>
          <FormActions>
            <Button pending={busy} disabled={send.hasUnresolved()} onClick={() => save(current.note_version)}>Simpan draf pada versi terbaru</Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setNotes(current.notes ?? ''); setBaseNotes(current.notes ?? ''); setVersion(current.note_version); setConflict(false); setCurrent(null); setError('') }}>Gunakan catatan terbaru</Button>
          </FormActions>
        </div> : readError ? <div className="space-y-3"><p>Catatan terbaru belum tersedia.</p><Button variant="secondary" disabled={busy} onClick={reloadCurrent}>Muat catatan terbaru</Button></div> : <p role="status">Memuat catatan terbaru...</p>}
      </Notice>}
    </> : <>
      <h3 className="font-medium">Catatan kunjungan</h3>
      <p className="whitespace-pre-wrap">{visit.notes || 'Belum ada catatan.'}</p>
      <Button variant="secondary" onClick={() => { setNotes(visit.notes ?? ''); setBaseNotes(visit.notes ?? ''); setVersion(visit.note_version); setConflict(false); setCurrent(null); setError(''); setEditing(true) }}>Edit catatan</Button>
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
    <MainContent className="max-w-2xl mx-auto p-4 space-y-4" aria-busy={query.isPending}>
      <PageHeader title="Riwayat kunjungan saya" description={<>Hanya kunjungan yang Anda lakukan sendiri. {profile?.role !== 'sales_person' && <ActionLink variant="secondary" to="/girard/schedule">Lihat jadwal dan kunjungan tim</ActionLink>}</>} />
      {query.isError ? <Notice tone="error" title="Riwayat belum tersedia." actions={<Button variant="secondary" pending={query.isFetching} onClick={() => query.refetch()}>Coba lagi</Button>} />
        : query.isPending ? <Notice tone="info" title="Memuat riwayat..." /> : <>
          {query.data?.items.length === 0 && <EmptyState title="Belum ada kunjungan." />}
          <RecordList label="Daftar kunjungan saya">
            {query.data?.items.map(visit => <li key={visit.id}>
              <article className="ui-section space-y-4">
                <h2 className="ui-section__title">{visit.customers?.name ?? 'Toko tidak tersedia'}</h2>
                <SummaryList items={[
                  { label: 'Jadwal', value: visit.sales_schedules?.scheduled_date ? visitDateLabel(visit.sales_schedules.scheduled_date) : 'Kunjungan historis' },
                  { label: 'Waktu check-in', value: formatVisitTimestamp(visit.checked_in_at) },
                  { label: 'Lokasi', value: visit.lat === null || visit.lng === null ? 'Tidak dicatat' : `${visit.lat}, ${visit.lng}` },
                ]} />
                {visit.schedule_id && <ActionLink variant="secondary" to={`/girard/visit/${visit.schedule_id}`}>Lihat detail kunjungan</ActionLink>}
                <VisitNoteEditor visit={visit} onDirtyChange={noteDirtyChanged} confirmDiscard={unsaved.confirmDiscard} />
              </article>
            </li>)}
          </RecordList>
          <PaginationControls page={page} total={query.data?.total ?? 0} pageSize={20} pending={query.isFetching} onPageChange={changePage} />
        </>}
    </MainContent>
  </div>
}
