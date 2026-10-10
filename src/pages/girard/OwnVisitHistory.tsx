import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { singleRelation } from '../../lib/relations'
import { supabase } from '../../lib/supabase'
import { useVisitPlanningSender } from '../../lib/visitTransactions'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import TransactionRecovery from '../../components/TransactionRecovery'
import GirardNav from '../../components/GirardNav'

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
  const send = useVisitPlanningSender(`note:${visit.id}`)
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
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
  return <section className="mt-4 space-y-2">
    <TransactionRecovery send={send} onCommitted={saved} />
    <h3 className="text-sm font-medium">Catatan kunjungan</h3>
    {editing ? <>
      <textarea aria-label="Catatan kunjungan" className="w-full border rounded p-2" maxLength={2000} value={notes} disabled={busy || send.hasUnresolved()} onChange={e => setNotes(e.target.value)} />
      <div className="flex gap-3">
        <button disabled={busy || send.hasUnresolved() || conflict} onClick={() => save()}>Simpan catatan</button>
        <button disabled={busy} onClick={() => confirmDiscard ? confirmDiscard(() => setEditing(false), { when: dirty }) : setEditing(false)}>Batal</button>
      </div>
      {conflict && <div className="border border-amber-300 rounded p-3 space-y-2">
        <p>Catatan berubah sejak Anda mulai mengedit. Draf Anda tetap disimpan di formulir ini.</p>
        {current ? <>
          <p className="font-medium">Catatan terbaru di server (versi {current.note_version})</p>
          <p className="whitespace-pre-wrap">{current.notes || 'Belum ada catatan.'}</p>
          <p>Bandingkan dengan draf Anda sebelum memilih catatan yang akan disimpan.</p>
          <button disabled={busy || send.hasUnresolved()} onClick={() => save(current.note_version)}>Simpan draf pada versi terbaru</button>
          <button className="ml-3" disabled={busy} onClick={() => { setNotes(current.notes ?? ''); setBaseNotes(current.notes ?? ''); setVersion(current.note_version); setConflict(false); setCurrent(null); setError('') }}>Gunakan catatan terbaru</button>
        </> : readError ? <p role="alert">Catatan terbaru belum tersedia. <button disabled={busy} onClick={reloadCurrent}>Muat catatan terbaru</button></p> : <p role="status">Memuat catatan terbaru...</p>}
      </div>}
    </> : <>
      <p className="whitespace-pre-wrap text-sm">{visit.notes || 'Belum ada catatan.'}</p>
      <button className="text-sm text-brand-primary" onClick={() => { setNotes(visit.notes ?? ''); setBaseNotes(visit.notes ?? ''); setVersion(visit.note_version); setConflict(false); setCurrent(null); setError(''); setEditing(true) }}>Edit catatan</button>
    </>}
    {error && <p role="alert">{error}</p>}
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
  const navigate = useNavigate()
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
    <main className="max-w-2xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">Riwayat kunjungan saya</h1>
      {query.isError ? <p role="alert">Riwayat belum tersedia. <button onClick={() => query.refetch()}>Coba lagi</button></p>
        : query.isPending ? <p>Memuat riwayat...</p> : <>
          {query.data?.items.length === 0 && <p>Belum ada kunjungan.</p>}
          {query.data?.items.map(visit => <article key={visit.id} className="bg-white rounded-xl border p-5">
            <h2 className="font-medium">{visit.customers?.name ?? 'Toko tidak tersedia'}</h2>
            <p>Jadwal: {visit.sales_schedules?.scheduled_date ?? 'Kunjungan historis'}</p>
            <p>{new Date(visit.checked_in_at).toLocaleString('id-ID')}</p>
            <p className="text-sm text-gray-500">Lokasi: {visit.lat === null || visit.lng === null ? 'Tidak dicatat' : `${visit.lat}, ${visit.lng}`}</p>
            {visit.schedule_id && <button className="text-brand-primary" onClick={() => navigate(`/girard/visit/${visit.schedule_id}`)}>Lihat foto dan bukti kunjungan</button>}
            <VisitNoteEditor visit={visit} onDirtyChange={noteDirtyChanged} confirmDiscard={unsaved.confirmDiscard} />
          </article>)}
          <div className="flex justify-between">
            <button disabled={page === 1} onClick={() => changePage(page - 1)}>Sebelumnya</button>
            <span>Halaman {page}</span>
            <button disabled={page * 20 >= (query.data?.total ?? 0)} onClick={() => changePage(page + 1)}>Berikutnya</button>
          </div>
        </>}
    </main>
  </div>
}
