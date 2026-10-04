import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore } from 'react'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { LeaveContext } from '../../../lib/leave/contracts'
import type { TransitionCommand } from '../../../lib/leave/transitionContracts'
import { fetchAssignedInbox,fetchAssignedRequest } from '../../../lib/leave/transitionRpc'
import { createLeaveTransitionTransport } from '../../../lib/leave/transitionTransport'
import { invalidateRequestCaches } from '../../../lib/leave/requestTransport'
import { LEAVE_BACKEND,leaveKeys } from '../../../lib/leave/queryKeys'
import { runLeaveInteraction } from '../../../lib/leave/useLeaveContext'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import { useSetupUnsaved } from './useSetupUnsaved'
import type { LeaveReadState } from './LeaveRequestForm'
type Props={actorId:string;context:LeaveContext;readState?:LeaveReadState;onDirtyChange?:(dirty:boolean)=>void}
const permitted=(c:LeaveContext)=>c.capabilities.approve&&(c.memberKind==='manager'||c.memberKind==='director')
type ReadReceipt={attempt:number;state:'unvalidated'|'pending'|'ready'}
type AssignedRead={receipt:ReadReceipt;completed:WeakMap<object,number>;listeners:Set<()=>void>}
const assignedReads=new WeakMap<QueryClient,Map<string,AssignedRead>>()
function assignedRead(client:QueryClient,key:string):AssignedRead{
 let reads=assignedReads.get(client);if(!reads){reads=new Map();assignedReads.set(client,reads)}
 let read=reads.get(key);if(!read){read={receipt:{attempt:0,state:'unvalidated'},completed:new WeakMap(),listeners:new Set()};reads.set(key,read)}
 return read
}
function publish(read:AssignedRead,receipt:ReadReceipt){read.receipt=receipt;read.listeners.forEach(listener=>listener())}
/** Same completion-receipt pattern as useLeaveContext, bound to the complete private key.
 * Every entry starts or joins a live read. Cached/reverted query status is never proof.
 * Only counters and weak result references survive outside React Query; no private copy. */
function useAssignedRead<T extends object>(key:readonly unknown[],authorize:()=>Promise<void>,fetcher:(signal:AbortSignal)=>Promise<T>,active:boolean,readState:LeaveReadState){
 const client=useQueryClient(),serialized=JSON.stringify(key)
 const read=useMemo(()=>assignedRead(client,serialized),[client,serialized])
 const entry=useMemo(()=>({started:false,floor:Infinity}),[read])
 const [,render]=useState(0)
 const subscribe=useCallback((listener:()=>void)=>{read.listeners.add(listener);return()=>{read.listeners.delete(listener)}},[read])
 const receipt=useSyncExternalStore(subscribe,()=>read.receipt,()=>read.receipt)
 const query=useQuery({queryKey:key,queryFn:async({signal})=>{
  const attempt=read.receipt.attempt+1
  publish(read,{attempt,state:'pending'})
  const interrupted=()=>{if(read.receipt.attempt===attempt)publish(read,{attempt,state:'unvalidated'})}
  signal.addEventListener('abort',interrupted,{once:true})
  try{
   await authorize();signal.throwIfAborted()
   const result=await fetcher(signal);signal.throwIfAborted()
   read.completed.set(result,attempt)
   if(read.receipt.attempt===attempt)publish(read,{attempt,state:'ready'})
   return result
  }catch(error){interrupted();throw error}finally{signal.removeEventListener('abort',interrupted)}
 },enabled:active,networkMode:'always',structuralSharing:false,staleTime:Infinity,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false})
 // Invalidation is an immediate revocation of cached completion, including before React renders.
 // Active observers keep React Query's normal invalidation/refetch path; the receipt still
 // rejects cancellation and cache reversion until a genuine new response completes.
 const isCurrent=()=>active&&!client.getQueryState(key)?.isInvalidated&&entry.started&&read.receipt.state==='ready'&&read.receipt.attempt>=entry.floor&&!!query.data&&read.completed.get(query.data)===read.receipt.attempt
 const refresh=useCallback(async()=>{
  if(!active)return
  // Joining an unfinished read never reuses a completed cached page and does not cancel another observer.
  const joining=read.receipt.state==='pending'
  entry.started=true;entry.floor=read.receipt.attempt+(joining?0:1)
  if(!joining)publish(read,{attempt:read.receipt.attempt,state:'unvalidated'})
  render(value=>value+1)
  await query.refetch({cancelRefetch:false})
 },[active,entry,read,query.refetch])
 useEffect(()=>{
  if(readState==='error'){entry.started=false;entry.floor=Infinity;return}
  if(active&&readState==='ready'&&!entry.started)void refresh()
 },[active,readState,entry,refresh])
 const ready=isCurrent()
 return {...query,refetch:refresh,isCurrent,ready,isError:query.isError||(entry.started&&receipt.state!=='pending'&&!ready),isPending:!entry.started||receipt.state==='pending',data:ready?query.data:undefined}
}
export default function AssignedApprovalInbox(props:Props){
 return permitted(props.context)?<Inbox key={`${props.actorId}:${props.context.scopeVersion}`} {...props}/>:null
}
function Inbox({actorId,context,readState='ready',onDirtyChange}:Props){
 const client=useQueryClient(),[before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([])
 const [selected,setSelected]=useState<string|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[recovery,setRecovery]=useState(false)
 const alive=useRef(true),working=useRef(false),detailHeading=useRef<HTMLHeadingElement>(null),alert=useRef<HTMLDivElement>(null),openers=useRef(new Map<string,HTMLButtonElement>())
 const authorize=()=>runLeaveInteraction(client,actorId,context.scopeVersion,live=>{if(!permitted(live))throw new Error('Akses persetujuan berubah.')})
 const transport=useMemo(()=>createLeaveTransitionTransport({actorId,backendScope:LEAVE_BACKEND,formScope:'assigned-decisions',storage:()=>window.localStorage,authorize}),[actorId,context.scopeVersion,client])
 useEffect(()=>{alive.current=true;setRecovery(transport.hasUnresolved());return()=>{alive.current=false}},[transport])
 const dirty=!!reason||recovery;useSetupUnsaved(dirty)
 useLayoutEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange]);useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange])
 const inbox=useAssignedRead(leaveKeys.private(actorId,context.scopeVersion,'assigned-inbox',before,25),authorize,signal=>fetchAssignedInbox(before,25,signal),true,readState)
 const detail=useAssignedRead(leaveKeys.private(actorId,context.scopeVersion,'assigned-detail',selected),authorize,signal=>fetchAssignedRequest(selected!,signal),!!selected,readState)
 const refresh=useRef(()=>{});refresh.current=()=>{if(document.visibilityState==='visible'&&!working.current){void inbox.refetch();if(selected)void detail.refetch()}}
 useEffect(()=>{const foreground=()=>refresh.current();window.addEventListener('focus',foreground);document.addEventListener('visibilitychange',foreground);const timer=window.setInterval(foreground,60_000);return()=>{window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground);window.clearInterval(timer)}},[])
 useLayoutEffect(()=>{if(readState==='ready'){if(error)alert.current?.focus();else if(detail.data&&!detail.isFetching)detailHeading.current?.focus()}},[readState,error,detail.data,detail.isFetching])
 function select(id:string|null){
  if(working.current||recovery)return false
  if(reason&&!window.confirm('Buang alasan penolakan yang belum disimpan?'))return false
  const old=selected;setReason('');setError('');setMessage('')
  if(id!==null&&id===selected)void detail.refetch()
  setSelected(id)
  if(id===null&&old)queueMicrotask(()=>openers.current.get(old)?.focus())
  return true
 }
 async function complete(){setReason('');setSelected(null);setRecovery(false);setError('');setMessage('Keputusan tersimpan.');await invalidateRequestCaches(client)}
 async function decide(accept:boolean){
  const r=detail.data;if(working.current||readState!=='ready'||!r||!detail.isCurrent()||detail.isFetching||detail.isError||recovery||(!accept&&!reason.trim()))return
  working.current=true;setBusy(true);setError('');setMessage('')
  const base={requestId:r.id,expectedVersion:r.version}
  const command:TransitionCommand=r.status==='cancellation_pending'?(accept?{...base,operation:'approve_cancellation',attemptId:r.cancellation!.id}:{...base,operation:'decline_cancellation',attemptId:r.cancellation!.id,reason}):(accept?{...base,operation:'approve_request'}:{...base,operation:'reject_request',reason})
  try{await transport.send(command);if(alive.current)await complete()}
  catch{if(alive.current){const uncertain=transport.hasUnresolved();setRecovery(uncertain);setError(uncertain?'Hasil keputusan belum pasti. Pulihkan hasil sebelum membuat keputusan lain.':'Keputusan belum tersimpan. Muat ulang permintaan dan akses. Jika jadwal atau kebijakan berubah, pemohon perlu menarik dan mengajukan ulang cuti.')}}
  finally{working.current=false;if(alive.current)setBusy(false)}
 }
 async function recover(){
  if(working.current||readState!=='ready')return;working.current=true;setBusy(true);setError('')
  try{const result=await transport.reconcile();if(!alive.current)return
   if(result.state==='committed'){transport.acknowledgeRecovered();await complete()}else{setRecovery(false);setMessage('Percobaan sebelumnya tidak tersimpan. Muat ulang sebelum mencoba lagi.');await invalidateRequestCaches(client)}
  }catch{if(alive.current){setRecovery(true);setError('Hasil keputusan belum pasti. Periksa akses lalu pulihkan kembali.')}}
  finally{working.current=false;if(alive.current)setBusy(false)}
 }
 if(readState!=='ready')return <section aria-label="Daftar persetujuan"><p role="status">Memeriksa akses persetujuan...</p></section>
 return <section aria-label="Daftar persetujuan" className="space-y-4">
  <div className="flex items-center justify-between"><h2 className="font-semibold">Permintaan yang ditugaskan kepada Anda</h2><button type="button" disabled={busy} onClick={()=>{void inbox.refetch();if(selected)void detail.refetch()}} className="underline">Muat ulang daftar</button></div>
  {message&&<p role="status">{message}</p>}
  {error&&<div ref={alert} tabIndex={-1} role="alert" className="rounded border border-red-200 bg-red-50 p-3">{error}</div>}
  {recovery&&<div className="rounded border border-amber-200 bg-amber-50 p-3"><p>Keputusan sebelumnya perlu dipulihkan.</p><button type="button" disabled={busy} onClick={()=>void recover()}>{busy?'Memeriksa hasil...':'Pulihkan hasil keputusan'}</button></div>}
  {inbox.isError?<p role="alert">Daftar persetujuan belum dapat dimuat. Coba muat ulang daftar.</p>:inbox.isFetching||inbox.isPending?<p role="status">Memuat permintaan...</p>:inbox.data&&<>
   {!inbox.data.rows.length&&<p>Tidak ada permintaan yang menunggu keputusan.</p>}
   <ul className="space-y-3">{inbox.data.rows.map(row=><li key={row.id} className="rounded-xl border bg-white p-4"><p className="font-semibold">{row.employee.name}</p><p>{row.startDate} sampai {row.endDate} · {formatLeaveMinutes(row.totalMinutes)}</p><p>{row.status==='cancellation_pending'?'Menunggu pembatalan seluruh cuti':'Menunggu persetujuan cuti'}</p><button ref={el=>{if(el)openers.current.set(row.id,el);else openers.current.delete(row.id)}} type="button" disabled={busy||recovery} aria-label={`Tinjau ${row.employee.name}`} onClick={()=>select(row.id)} className="mt-2 underline">Tinjau permintaan</button></li>)}</ul>
   <div className="flex gap-4"><button type="button" disabled={!cursors.length||busy||recovery} onClick={()=>{if(select(null)){setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}}}>Lebih baru</button><button type="button" disabled={inbox.data.nextBefore===null||busy||recovery} onClick={()=>{if(select(null)){setCursors([...cursors,before]);setBefore(inbox.data.nextBefore)}}}>Lebih lama</button></div>
  </>}
  {selected&&<section aria-label="Detail permintaan ditugaskan" className="space-y-3 rounded-xl border bg-white p-4">
   <button type="button" disabled={busy||recovery} onClick={()=>select(null)} className="underline">Tutup detail</button>
   {detail.isError?<div role="alert"><p>Detail tidak tersedia atau penugasan berubah.</p><button type="button" onClick={()=>void detail.refetch()}>Muat ulang detail</button></div>:detail.isPending||detail.isFetching?<p role="status">Memuat detail...</p>:detail.data&&<>
    <h3 ref={detailHeading} tabIndex={-1} className="font-semibold">{detail.data.employee.name} · {formatLeaveMinutes(detail.data.totalMinutes)}</h3>
    <p>Versi permohonan: {detail.data.version}</p>
    <p>Durasi: {detail.data.duration.mode==='full_scheduled_day'?'Sehari sesuai jadwal':`${formatLeaveMinutes(detail.data.duration.minutes)} per hari kerja`}</p>
    <p>{detail.data.reason}</p><p>Penyetuju: {detail.data.approverName}</p>
    <ul>{detail.data.days.map(day=><li key={day.date}>{day.date} · Jadwal {formatLeaveMinutes(day.scheduledMinutes)} · Diminta {formatLeaveMinutes(day.chargedMinutes)}{day.exclusion==='holiday'?' · Libur kalender':day.exclusion==='off_duty'?' · Tidak bertugas':''}{day.groupName&&` · ${day.groupName}`}</li>)}</ul>
    <ul>{detail.data.allocations.map(a=><li key={a.year}>Periode {a.year}: {formatLeaveMinutes(a.chargedMinutes)}</li>)}</ul>
    <section aria-label="Konteks saldo permohonan"><h4>Saldo terkini untuk periode permohonan</h4><p>Dibaca pada {detail.data.balanceContext.asOf}. Termasuk reservasi dan pemakaian saat ini; bukan saldo saat pengajuan.</p>
     <ul>{detail.data.balanceContext.periods.map(period=><li key={period.year}>Periode {period.year}: {period.reconciled?<>Tersedia: {formatLeaveMinutes(period.availableMinutes!)} · Reservasi: {formatLeaveMinutes(period.reservedMinutes!)} · Pemakaian: {formatLeaveMinutes(period.usedMinutes!)}{period.expiredMinutes!>0&&<> · Kedaluwarsa: {formatLeaveMinutes(period.expiredMinutes!)}</>}</>:'Saldo awal belum diverifikasi.'}</li>)}</ul>
    </section>
    {detail.data.cancellation&&<div className="rounded bg-amber-50 p-3"><h4 className="font-semibold">Permintaan pembatalan seluruh cuti</h4><p>{detail.data.cancellation.reason}</p><p>Penyetuju pembatalan: {detail.data.cancellation.approverName}</p><p>Pemakaian dan tanggal tetap terpakai sampai pembatalan disetujui. Pengembalian masuk ke periode asal; jatah kedaluwarsa tetap tidak tersedia.</p></div>}
    <label className="block">Alasan penolakan<textarea maxLength={1000} disabled={busy||recovery} value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 block w-full rounded border p-2"/></label>
    <div className="flex gap-3"><button type="button" disabled={busy||recovery} onClick={()=>void decide(true)} className="rounded bg-orange-600 px-4 py-2 text-white disabled:opacity-50">{busy?'Memproses...':detail.data.cancellation?'Setujui pembatalan':'Setujui cuti'}</button><button type="button" disabled={busy||recovery||!reason.trim()} onClick={()=>void decide(false)} className="rounded border px-4 py-2 disabled:opacity-50">{detail.data.cancellation?'Tolak pembatalan':'Tolak cuti'}</button></div>
   </>}
  </section>}
 </section>
}
