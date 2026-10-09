import {useEffect,useRef,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {useAuth} from '../lib/AuthContext'
import {useVisitPlanningSender} from '../lib/visitTransactions'
import {fetchVisitCustomers,fetchVisitPeople,fetchVisitRequests,MAX_VISIT_NOTE_LENGTH} from '../lib/visitPlanning'
import {calendarDateKey,parseCalendarDate} from '../lib/calendarDate'
import NavigationIcon from './NavigationIcon'
import type {VisitRequest} from '../lib/visitPlanning'
import TransactionRecovery from './TransactionRecovery'
export function VisitProposalForm({source,onDone,onDirtyChange,confirmDiscard}:{source?:{id:string;version:number;outlet_id:string;scheduled_date:string};onDone?:()=>void;onDirtyChange?:(dirty:boolean)=>void;confirmDiscard?:(action:()=>void,options?:{when?:boolean})=>void}){
 const {profile}=useAuth();const client=useQueryClient();const send=useVisitPlanningSender(`proposal:${source?.id??'new'}`)
 const [customer,setCustomer]=useState(source?.outlet_id??'');const [date,setDate]=useState(source?.scheduled_date??calendarDateKey());const [notes,setNotes]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const lock=useRef(false)
 const dirty=customer!==(source?.outlet_id??'') || date!==(source?.scheduled_date??calendarDateKey()) || notes!==''
 useEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange])
 useEffect(()=>()=>{onDirtyChange?.(false)},[onDirtyChange])
 const customers=useQuery({queryKey:['visit_customers',profile?.id,profile?.role],queryFn:({signal})=>fetchVisitCustomers(signal),enabled:!!profile?.id})
 const done=()=>{client.invalidateQueries();setNotes('');setCustomer(source?.outlet_id??'');setMessage('Permintaan tersimpan. Menunggu persetujuan manajer.');onDone?.()}
 async function submit(){if(lock.current || !customer || !date)return;lock.current=true;setBusy(true);setMessage('');try{await send(source?'amend_visit':'propose_visit',{customer_id:customer,scheduled_date:date,notes,...(source?{schedule_id:source.id,expected_version:source.version}:{})});done()}catch(e){setMessage((e as Error).message)}finally{lock.current=false;setBusy(false)}}
 return <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
  <TransactionRecovery send={send} onCommitted={done}/><h2 className="font-medium">{source?'Ajukan perubahan jadwal':'Ajukan kunjungan'}</h2>
  {source && <p className="text-sm text-gray-500">Jadwal yang disetujui tetap berlaku sampai perubahan disetujui manajer.</p>}
  {customers.isError ? <p role="alert">Daftar toko belum tersedia. <button className={secondaryButton} onClick={()=>customers.refetch()}>Coba lagi</button></p> : <>
   <label className="block">Toko<select className="block w-full border rounded p-2" aria-label="Toko" value={customer} onChange={e=>setCustomer(e.target.value)} disabled={busy||send.hasUnresolved()}><option value="">Pilih toko</option>{customers.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="block">Tanggal kunjungan<input className="block border rounded p-2" aria-label="Tanggal kunjungan" type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={busy||send.hasUnresolved()}/></label>
   <label className="block">Catatan permintaan<textarea className="block w-full border rounded p-2" aria-label="Catatan permintaan" maxLength={MAX_VISIT_NOTE_LENGTH} value={notes} onChange={e=>setNotes(e.target.value)} disabled={busy||send.hasUnresolved()}/></label>
   <button className={primaryButton} disabled={busy||!customer||!date||send.hasUnresolved()} onClick={submit}>{source?'Ajukan perubahan':'Ajukan kunjungan'}</button>
  </>}
  {onDone && <button disabled={busy} className={`${secondaryButton} ml-3`} onClick={()=>confirmDiscard?confirmDiscard(onDone,{when:dirty}):onDone()}>Batal</button>}
  {message && <p role="status">{message}</p>}
 </section>
}
const buttonBase = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45'
const primaryButton = `${buttonBase} border-brand-primary bg-brand-primary text-white hover:bg-brand-hover disabled:hover:bg-brand-primary`
const secondaryButton = `${buttonBase} border-gray-300 bg-white text-brand-primary hover:bg-brand-tint disabled:hover:bg-white`
const dangerButton = `${buttonBase} border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:hover:bg-white`
const statuses: Record<VisitRequest['status'], { label: string; style: string }> = {
 pending: { label: 'Menunggu persetujuan', style: 'border-amber-200 bg-brand-tint text-amber-900' },
 approved: { label: 'Disetujui', style: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
 rejected: { label: 'Ditolak', style: 'border-red-200 bg-red-50 text-red-700' },
 withdrawn: { label: 'Ditarik', style: 'border-gray-200 bg-gray-100 text-gray-600' },
}

export default function VisitRequestInbox() {
 const {profile}=useAuth()
 const client=useQueryClient()
 const [page,setPage]=useState(1)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const lock=useRef(false)
 const send=useVisitPlanningSender('request-decisions')
 const requests=useQuery({queryKey:['visit_requests',profile?.id,profile?.role,page],queryFn:()=>fetchVisitRequests(page),enabled:!!profile?.id})
 const customers=useQuery({queryKey:['visit_customers',profile?.id,profile?.role],queryFn:({signal})=>fetchVisitCustomers(signal),enabled:!!profile?.id})
 const peopleIds=[...new Set(requests.data?.items.map(r=>r.requester_id)??[])]
 const people=useQuery({queryKey:['visit_request_people',profile?.id,profile?.role,peopleIds],queryFn:({signal})=>fetchVisitPeople(peopleIds,signal),enabled:peopleIds.length>0})
 async function decide(operation:string,id:string,version:number) {
  if(lock.current)return
  lock.current=true;setBusy(true);setError('')
  try { await send(operation,{request_id:id,expected_version:version});client.invalidateQueries() }
  catch(e) { setError((e as Error).message) }
  finally { lock.current=false;setBusy(false) }
 }
 const total=requests.data?.total??0
 // RLS scope can shrink on refetch; never strand a later page behind hidden controls.
 useEffect(()=>{
  if(requests.isSuccess) setPage(current=>Math.min(current,Math.max(1,Math.ceil(total/20))))
 },[requests.isSuccess,total])
 return <section aria-label="Daftar permintaan kunjungan" className="space-y-5">
  <TransactionRecovery send={send} onCommitted={()=>client.invalidateQueries()}/>
  {requests.isError ? <div role="alert" className="rounded-2xl border border-red-200 bg-white p-6">
   <p className="font-semibold text-brand-primary">Permintaan belum tersedia.</p>
   <p className="mt-1 text-sm text-gray-500">Coba muat ulang untuk melihat permintaan kunjungan.</p>
   <button className={`${secondaryButton} mt-4`} onClick={()=>requests.refetch()}>Coba lagi</button>
  </div> : requests.isPending ? <div role="status" className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Memuat permintaan...</div> : <>
   <div className="flex flex-wrap items-center justify-between gap-2">
    <h2 className="text-sm font-semibold text-brand-primary">Daftar permintaan <span className="ml-2 rounded-full bg-white px-2.5 py-1 text-xs text-gray-600 ring-1 ring-gray-200">{total}</span></h2>
    {total>0 && <p className="text-xs text-gray-500">Terbaru lebih dahulu</p>}
   </div>
   {requests.data?.items.length===0 && <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
    <div className="mb-4 rounded-2xl bg-brand-tint p-4 text-brand-primary"><NavigationIcon name="orders" className="h-7 w-7"/></div>
    <h3 className="font-semibold text-brand-primary">Belum ada permintaan kunjungan</h3>
    <p className="mt-2 max-w-sm text-sm leading-6 text-gray-500">{profile?.role==='sales_person'?'Ajukan kunjungan dari halaman Jadwal. Status pengajuan Anda akan muncul di sini.':'Permintaan kunjungan dari tim Anda akan muncul di sini untuk ditinjau.'}</p>
   </div>}
   <div className="space-y-4">
    {requests.data?.items.map(r=>{
     const status=statuses[r.status]
     const canWithdraw=profile?.role==='sales_person' && r.requester_id===profile.id
     const canReview=['sales_manager','sales_head','executive'].includes(profile?.role??'') && r.requester_id!==profile?.id
     return <article aria-labelledby={`visit-request-${r.id}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" key={r.id}>
      <div className="p-5 sm:p-6">
       <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
         <p className="mb-1.5 text-xs font-medium text-gray-500">{r.kind==='amendment'?'Perubahan jadwal':'Kunjungan baru'}</p>
         <h3 id={`visit-request-${r.id}`} className="break-words text-lg font-semibold text-brand-primary">{customers.data?.find(c=>c.id===r.customer_id)?.name??'Toko belum tersedia'}</h3>
        </div>
        <span className={`inline-flex shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${status.style}`}>{status.label}</span>
       </div>
       <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
        <p className="inline-flex items-center gap-2"><NavigationIcon name="calendar" className="h-4 w-4 text-gray-400"/><span>{parseCalendarDate(r.scheduled_date).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}</span></p>
        <p className="break-words">Pengaju: {people.data?.find(person=>person.id===r.requester_id)?.full_name??r.requester_id}</p>
       </div>
       {r.notes && <div className="mt-4 rounded-xl bg-brand-canvas px-4 py-3"><p className="mb-1 text-xs font-semibold text-gray-500">Catatan permintaan</p><p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">{r.notes}</p></div>}
      </div>
      {r.status==='pending' && (canWithdraw||canReview) && <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 bg-gray-50/60 px-5 py-4 sm:px-6" aria-busy={busy}>
       {canWithdraw ? <button className={secondaryButton} disabled={busy||send.hasUnresolved()} onClick={()=>decide('withdraw_request',r.id,r.version)}>Tarik permintaan</button> : <>
        <button className={dangerButton} disabled={busy||send.hasUnresolved()} onClick={()=>decide('reject_request',r.id,r.version)}>Tolak</button>
        <button className={primaryButton} disabled={busy||send.hasUnresolved()} onClick={()=>decide('approve_request',r.id,r.version)}>Setujui</button>
       </>}
      </div>}
     </article>
    })}
   </div>
   {total>20 && <nav aria-label="Halaman permintaan" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
    <button className={secondaryButton} disabled={page===1||busy||requests.isFetching} onClick={()=>setPage(page-1)}><span aria-hidden="true">←</span>Sebelumnya</button>
    <span className="text-sm text-gray-500">Halaman {page} dari {Math.ceil(total/20)}</span>
    <button className={secondaryButton} disabled={page*20>=total||busy||requests.isFetching} onClick={()=>setPage(page+1)}>Berikutnya<span aria-hidden="true">→</span></button>
   </nav>}
  </>}
  {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
 </section>
}
