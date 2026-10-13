import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { FormActions } from './ui/FormActions'
import { Section } from './ui/Section'
import { EmptyState, Notice, StatusBadge } from './ui/Feedback'
import VisitCustomerSelect from './VisitCustomerSelect'
import { isVisitDate, visitSaveError } from '../lib/visitUsability'
import type { TransactionResult } from '../lib/orderTransactions'
import {useEffect,useId,useRef,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {useAuth} from '../lib/AuthContext'
import {useVisitPlanningSender} from '../lib/visitTransactions'
import {fetchVisitCustomers,fetchVisitPeople,fetchVisitRequests,MAX_VISIT_NOTE_LENGTH} from '../lib/visitPlanning'
import {calendarDateKey,parseCalendarDate} from '../lib/calendarDate'
import NavigationIcon from './NavigationIcon'
import type {VisitRequest} from '../lib/visitPlanning'
import TransactionRecovery from './TransactionRecovery'
export function VisitProposalForm({source,onDone,onSubmitted,onDirtyChange,confirmDiscard}:{source?:{id:string;version:number;outlet_id:string;scheduled_date:string};onDone?:()=>void;onSubmitted?:(result:{id:string;date?:string})=>void;onDirtyChange?:(dirty:boolean)=>void;confirmDiscard?:(action:()=>void,options?:{when?:boolean})=>void}){
 const {profile}=useAuth();const client=useQueryClient();const send=useVisitPlanningSender(`proposal:${source?.id??'new'}`)
 const [customer,setCustomer]=useState(source?.outlet_id??'');const [date,setDate]=useState(source?.scheduled_date??calendarDateKey());const [notes,setNotes]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const lock=useRef(false)
 const fieldId=useId();const [,refreshRecovery]=useState(0)
 const dirty=customer!==(source?.outlet_id??'') || date!==(source?.scheduled_date??calendarDateKey()) || notes!==''
 useEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange])
 useEffect(()=>()=>{onDirtyChange?.(false)},[onDirtyChange])
 const customers=useQuery({queryKey:['visit_customers',profile?.id,profile?.role],queryFn:({signal})=>fetchVisitCustomers(signal),enabled:!!profile?.id})
 const done=(result:TransactionResult,recovered=false)=>{client.invalidateQueries();setNotes('');setCustomer(source?.outlet_id??'');setMessage('Permintaan tersimpan. Menunggu persetujuan manajer.');onSubmitted?.({id:result.id,...(!recovered?{date}:{})});onDone?.()}
 async function submit(){if(lock.current || !customer || !isVisitDate(date))return;lock.current=true;setBusy(true);setMessage('');try{const result=await send(source?'amend_visit':'propose_visit',{customer_id:customer,scheduled_date:date,notes,...(source?{schedule_id:source.id,expected_version:source.version}:{})});done(result)}catch(e){setMessage(visitSaveError(e))}finally{lock.current=false;setBusy(false)}}
 return <Section title={source?'Ajukan perubahan jadwal':'Ajukan kunjungan'}><div className="space-y-4">
  <TransactionRecovery send={send} onAbandoned={()=>refreshRecovery(value=>value+1)} onCommitted={result=>done(result,true)}/>
  {source && <p className="text-base text-brand-secondary">Jadwal yang disetujui tetap berlaku sampai perubahan disetujui manajer.</p>}
  {customers.isError ? <Notice tone="error" title="Daftar toko belum tersedia." actions={<Button size="compact" variant="secondary" onClick={()=>customers.refetch()}>Coba lagi</Button>} /> : <>
   <VisitCustomerSelect label="Toko" customers={customers.data??[]} value={customer} onChange={value=>{setCustomer(value);setMessage('')}} disabled={busy||send.hasUnresolved()}/>
   <Field id={`${fieldId}-date`} label="Tanggal kunjungan">{control=><input {...control} type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={busy||send.hasUnresolved()}/>}</Field>
   <Field id={`${fieldId}-notes`} label="Catatan permintaan">{control=><textarea {...control} maxLength={MAX_VISIT_NOTE_LENGTH} value={notes} onChange={e=>setNotes(e.target.value)} disabled={busy||send.hasUnresolved()}/>}</Field>
  </>}
  <FormActions>{!customers.isError && <Button pending={busy} disabled={busy||!customer||!isVisitDate(date)||send.hasUnresolved()} onClick={submit}>{busy?'Mengirim permintaan...':source?'Ajukan perubahan':'Ajukan kunjungan'}</Button>}{onDone && <Button variant="quiet" disabled={busy||send.hasUnresolved()} onClick={()=>confirmDiscard?confirmDiscard(()=>onDone(),{when:dirty}):onDone()}>Batal</Button>}</FormActions>
  {message && <Notice tone={message==='Permintaan tersimpan. Menunggu persetujuan manajer.'?'success':'error'} className="mt-3" title={message} />}
 </div></Section>
}
const statuses: Record<VisitRequest['status'], { label: string; tone: 'warning'|'success'|'error'|'neutral' }> = {
 pending: { label: 'Menunggu persetujuan', tone: 'warning' },
 approved: { label: 'Disetujui', tone: 'success' },
 rejected: { label: 'Ditolak', tone: 'error' },
 withdrawn: { label: 'Ditarik', tone: 'neutral' },
}

export default function VisitRequestInbox() {
 const {profile}=useAuth()
 const client=useQueryClient()
 const [page,setPage]=useState(1)
 const [,refreshRecovery]=useState(0)
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
  catch(e) { setError(visitSaveError(e)) }
  finally { lock.current=false;setBusy(false) }
 }
 const total=requests.data?.total??0
 // RLS scope can shrink on refetch; never strand a later page behind hidden controls.
 useEffect(()=>{
  if(requests.isSuccess) setPage(current=>Math.min(current,Math.max(1,Math.ceil(total/20))))
 },[requests.isSuccess,total])
 return <section aria-label="Daftar permintaan kunjungan" className="space-y-5">
  <TransactionRecovery send={send} onAbandoned={()=>refreshRecovery(value=>value+1)} onCommitted={()=>client.invalidateQueries()}/>
  {requests.isError ? <Notice tone="error" title="Permintaan belum tersedia." actions={<Button size="compact" variant="secondary" onClick={()=>requests.refetch()}>Coba lagi</Button>}><p>Coba muat ulang untuk melihat permintaan kunjungan.</p></Notice>
   : requests.isPending ? <Notice tone="info" title="Memuat permintaan..." /> : <>
   <div className="flex flex-wrap items-center justify-between gap-2">
    <h2 className="text-base font-semibold text-brand-primary">Daftar permintaan <span className="ml-2 rounded-full bg-white px-2.5 py-1 text-[13px] text-gray-600 ring-1 ring-gray-200">{total}</span></h2>
    {total>0 && <p className="text-[13px] text-brand-secondary">Terbaru lebih dahulu</p>}
   </div>
   {requests.data?.items.length===0 && <EmptyState title="Belum ada permintaan kunjungan"><div aria-hidden="true" className="mb-4 rounded-xl bg-brand-tint p-4 text-brand-primary w-fit"><NavigationIcon name="orders" className="h-7 w-7"/></div><p>{profile?.role==='sales_person'?'Ajukan kunjungan dari halaman Jadwal. Status pengajuan Anda akan muncul di sini.':'Permintaan kunjungan dari tim Anda akan muncul di sini untuk ditinjau.'}</p></EmptyState>}
   <div className="space-y-4">
    {requests.data?.items.map(r=>{
     const status=statuses[r.status]
     const canWithdraw=profile?.role==='sales_person' && r.requester_id===profile.id
     const canReview=['sales_manager','sales_head','executive'].includes(profile?.role??'') && r.requester_id!==profile?.id
     return <article id={`visit-request-${r.id}`} aria-labelledby={`visit-request-title-${r.id}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" key={r.id}>
      <div className="p-5 sm:p-6">
       <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
         <p className="mb-1.5 text-[13px] font-medium text-brand-secondary">{r.kind==='amendment'?'Perubahan jadwal':'Kunjungan baru'}</p>
         <h3 id={`visit-request-title-${r.id}`} className="break-words text-lg font-semibold text-brand-primary">{customers.data?.find(c=>c.id===r.customer_id)?.name??'Toko belum tersedia'}</h3>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
       </div>
       <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-base text-gray-600">
        <p className="inline-flex items-center gap-2"><NavigationIcon name="calendar" className="h-4 w-4 text-brand-secondary"/><span>{parseCalendarDate(r.scheduled_date).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}</span></p>
        <p className="break-words">Pengaju: {people.data?.find(person=>person.id===r.requester_id)?.full_name??'Nama belum tersedia'}</p>
       </div>
       {r.notes && <div className="mt-4 rounded-xl bg-brand-canvas px-4 py-3"><p className="mb-1 text-[13px] font-semibold text-brand-secondary">Catatan permintaan</p><p className="whitespace-pre-wrap break-words text-base leading-6 text-gray-700">{r.notes}</p></div>}
      </div>
      {r.status==='pending' && (canWithdraw||canReview) && <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 bg-gray-50/60 px-5 py-4 sm:px-6" aria-busy={busy}>
       {canWithdraw ? <Button size="compact" variant="secondary" pending={busy} disabled={busy||send.hasUnresolved()} onClick={()=>decide('withdraw_request',r.id,r.version)}>Tarik permintaan</Button> : <>
        <Button size="compact" variant="danger" pending={busy} disabled={busy||send.hasUnresolved()} onClick={()=>decide('reject_request',r.id,r.version)}>Tolak</Button>
        <Button size="compact" pending={busy} disabled={busy||send.hasUnresolved()} onClick={()=>decide('approve_request',r.id,r.version)}>Setujui</Button>
       </>}
      </div>}
     </article>
    })}
   </div>
   {total>20 && <nav aria-label="Halaman permintaan" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
    <Button size="compact" variant="quiet" disabled={page===1||busy||requests.isFetching} onClick={()=>setPage(page-1)}><span aria-hidden="true">←</span>Sebelumnya</Button>
    <span className="text-base text-brand-secondary">Halaman {page} dari {Math.ceil(total/20)}</span>
    <Button size="compact" variant="quiet" disabled={page*20>=total||busy||requests.isFetching} onClick={()=>setPage(page+1)}>Berikutnya<span aria-hidden="true">→</span></Button>
   </nav>}
  </>}
  {error && <Notice tone="error" title={error} />}
 </section>
}
