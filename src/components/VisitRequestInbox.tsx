import {useEffect,useRef,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {useAuth} from '../lib/AuthContext'
import {useVisitPlanningSender} from '../lib/visitTransactions'
import {fetchVisitCustomers,fetchVisitPeople,fetchVisitRequests,MAX_VISIT_NOTE_LENGTH} from '../lib/visitPlanning'
import {calendarDateKey} from '../lib/calendarDate'
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
  {customers.isError ? <p role="alert">Daftar toko belum tersedia. <button onClick={()=>customers.refetch()}>Coba lagi</button></p> : <>
   <label className="block">Toko<select className="block w-full border rounded p-2" aria-label="Toko" value={customer} onChange={e=>setCustomer(e.target.value)} disabled={busy||send.hasUnresolved()}><option value="">Pilih toko</option>{customers.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="block">Tanggal kunjungan<input className="block border rounded p-2" aria-label="Tanggal kunjungan" type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={busy||send.hasUnresolved()}/></label>
   <label className="block">Catatan permintaan<textarea className="block w-full border rounded p-2" aria-label="Catatan permintaan" maxLength={MAX_VISIT_NOTE_LENGTH} value={notes} onChange={e=>setNotes(e.target.value)} disabled={busy||send.hasUnresolved()}/></label>
   <button className="bg-brand-primary text-white px-4 py-2 rounded" disabled={busy||!customer||!date||send.hasUnresolved()} onClick={submit}>{source?'Ajukan perubahan':'Ajukan kunjungan'}</button>
  </>}
  {onDone && <button disabled={busy} className="ml-3" onClick={()=>confirmDiscard?confirmDiscard(onDone,{when:dirty}):onDone()}>Batal</button>}
  {message && <p role="status">{message}</p>}
 </section>
}
export default function VisitRequestInbox(){
 const {profile}=useAuth();const client=useQueryClient();const [page,setPage]=useState(1);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const lock=useRef(false);const send=useVisitPlanningSender('request-decisions')
 const requests=useQuery({queryKey:['visit_requests',profile?.id,profile?.role,page],queryFn:()=>fetchVisitRequests(page),enabled:!!profile?.id})
 const customers=useQuery({queryKey:['visit_customers',profile?.id,profile?.role],queryFn:({signal})=>fetchVisitCustomers(signal),enabled:!!profile?.id})
 const peopleIds=[...new Set(requests.data?.items.map(r=>r.requester_id)??[])]
 const people=useQuery({queryKey:['visit_request_people',profile?.id,profile?.role,peopleIds],queryFn:({signal})=>fetchVisitPeople(peopleIds,signal),enabled:peopleIds.length>0})
 async function decide(operation:string,id:string,version:number){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await send(operation,{request_id:id,expected_version:version});client.invalidateQueries()}catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}}
 return <section className="bg-white border rounded-xl p-5 space-y-3"><h2 className="font-medium">Permintaan kunjungan</h2><TransactionRecovery send={send} onCommitted={()=>client.invalidateQueries()}/>
 {requests.isError ? <p role="alert">Permintaan belum tersedia. <button onClick={()=>requests.refetch()}>Coba lagi</button></p> : requests.isPending ? <p>Memuat permintaan...</p> : <>
 {requests.data?.items.length===0 && <p className="text-sm text-gray-500">Belum ada permintaan.</p>}
 {requests.data?.items.map(r=><article className="border-t py-3 space-y-2" key={r.id}><p>{customers.data?.find(c=>c.id===r.customer_id)?.name??'Toko belum tersedia'} · {r.scheduled_date} · {r.kind==='amendment'?'Perubahan':'Baru'}</p><p>Pengaju: {people.data?.find(person=>person.id===r.requester_id)?.full_name??r.requester_id}</p><p>Status: {r.status}</p>{r.notes && <p className="whitespace-pre-wrap">{r.notes}</p>}{r.status==='pending' && <div className="flex gap-4">
 {profile?.role==='sales_person' && r.requester_id===profile.id ? <button disabled={busy||send.hasUnresolved()} onClick={()=>decide('withdraw_request',r.id,r.version)}>Tarik permintaan</button> : ['sales_manager','sales_head','executive'].includes(profile?.role??'') && r.requester_id!==profile?.id ? <><button disabled={busy||send.hasUnresolved()} onClick={()=>decide('approve_request',r.id,r.version)}>Setujui</button><button disabled={busy||send.hasUnresolved()} onClick={()=>decide('reject_request',r.id,r.version)}>Tolak</button></>:null}</div>}</article>)}
 <div className="flex justify-between"><button disabled={page===1||busy} onClick={()=>setPage(page-1)}>Sebelumnya</button><span>Halaman {page}</span><button disabled={page*20>=(requests.data?.total??0)||busy} onClick={()=>setPage(page+1)}>Berikutnya</button></div></>}
 {error && <p role="alert">{error}</p>}
 </section>
}
