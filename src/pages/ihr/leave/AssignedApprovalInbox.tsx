import { LoadingState } from '../../../components/ui/LoadingState'
import { RecordList } from '../../../components/ui/RecordList'
import { FormActions } from '../../../components/ui/FormActions'
import { StatusBadge, Notice, EmptyState } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { useId, useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore  } from 'react'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { LeaveContext } from '../../../lib/leave/contracts'
import type { TransitionCommand } from '../../../lib/leave/transitionContracts'
import { fetchAssignedInbox,fetchAssignedRequest } from '../../../lib/leave/transitionRpc'
import { createLeaveTransitionTransport } from '../../../lib/leave/transitionTransport'
import { invalidateRequestCaches } from '../../../lib/leave/requestTransport'
import { LEAVE_BACKEND,leaveKeys } from '../../../lib/leave/queryKeys'
import {runBoundedHRCheck} from '../../../lib/hr/revalidation'
import {useHRDisplayContinuity,useHRDisplayOwner} from '../../../lib/hr/useHRDisplayContinuity'
import { runLeaveInteraction,useLeaveDisplayAuthority } from '../../../lib/leave/useLeaveContext'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import { useSetupUnsaved } from './useSetupUnsaved'
import type { LeaveReadState } from './LeaveRequestForm'
type Props={actorId:string;context:LeaveContext;readState?:LeaveReadState;onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void}
const permitted=(c:LeaveContext)=>c.capabilities.approve&&(c.memberKind==='manager'||c.memberKind==='director')
type ReadReceipt={attempt:number;state:'unvalidated'|'pending'|'ready';terminal?:boolean}
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
export function useAssignedRead<T extends object>(key:readonly unknown[],authorize:()=>Promise<void>,fetcher:(signal:AbortSignal)=>Promise<T>,active:boolean,readState:LeaveReadState){
 const client=useQueryClient(),serialized=JSON.stringify(key)
 const displayAuthority=useLeaveDisplayAuthority(client,key[2] as string),owner=useHRDisplayOwner(displayAuthority.displayLease,serialized,displayAuthority.displayEpoch)
 const read=useMemo(()=>assignedRead(client,serialized),[client,serialized])
 const entry=useMemo(()=>({started:false,floor:Infinity}),[read])
 const [,render]=useState(0)
 const subscribe=useCallback((listener:()=>void)=>{read.listeners.add(listener);return()=>{read.listeners.delete(listener)}},[read])
 const receipt=useSyncExternalStore(subscribe,()=>read.receipt,()=>read.receipt)
 useLayoutEffect(()=>client.getQueryCache().subscribe(event=>{
  if(JSON.stringify(event.query.queryKey)!==serialized)return
  if(event.type==='removed'||event.type==='updated'&&(event.action.type==='pause'||event.action.type==='error'||event.action.type==='success'&&event.action.manual))publish(read,{...read.receipt,state:'unvalidated',terminal:true})
 }),[client,serialized,read])
 const query=useQuery({queryKey:key,queryFn:async({signal})=>{
  owner.begin()
  const attempt=read.receipt.attempt+1
  publish(read,{attempt,state:'pending'})
  const interrupted=()=>{if(read.receipt.attempt===attempt)publish(read,{attempt,state:'unvalidated',terminal:true})}
  signal.addEventListener('abort',interrupted,{once:true})
  try{
   const result=await runBoundedHRCheck(signal,async bounded=>{
    await authorize();bounded.throwIfAborted()
    const value=await fetcher(bounded);bounded.throwIfAborted();return value
   },interrupted)
   signal.throwIfAborted()
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
 const displayAllowed=active&&readState!=='error'&&displayAuthority.displayAllowed
 const terminalFailure=!!receipt.terminal||query.isError||readState==='error'
 const display=useHRDisplayContinuity({key:serialized,epoch:displayAuthority.displayEpoch,allowed:displayAllowed,validatedData:ready?query.data:undefined,pending:displayAuthority.refreshing||receipt.state==='pending',terminalFailure})
 const episodeId=displayAuthority.displayLease.getDisplayEpisode()?.id
 useLayoutEffect(()=>{if(!displayAllowed||terminalFailure||display.displayData===undefined)owner.eligible(false);else if(ready&&displayAuthority.ready)owner.settle(true,episodeId)},[owner,ready,displayAllowed,terminalFailure,display.displayData,displayAuthority.ready,episodeId])
 return {...query,...display,displayAllowed,refetch:refresh,isCurrent,ready,isError:query.isError||(entry.started&&receipt.state!=='pending'&&!ready),isPending:!entry.started||receipt.state==='pending',data:ready?query.data:undefined}
}
export default function AssignedApprovalInbox(props:Props){
 return permitted(props.context)?<Inbox key={`${props.actorId}:${props.context.scopeVersion}`} {...props}/>:null
}
function Inbox({actorId,context,readState='ready',onDirtyChange,onBusyChange}:Props){
 const fieldId=useId(),currentReadState=useRef(readState);currentReadState.current=readState
 const client=useQueryClient(),[before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([])
 const [selected,setSelected]=useState<string|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[recovery,setRecovery]=useState(false)
 const alive=useRef(true),working=useRef(false),focusedDetail=useRef<string|null>(null),detailHeading=useRef<HTMLHeadingElement>(null),alert=useRef<HTMLDivElement>(null),openers=useRef(new Map<string,HTMLButtonElement>())
 const authorize=()=>runLeaveInteraction(client,actorId,context.scopeVersion,live=>{if(!permitted(live))throw new Error('Akses persetujuan berubah.')})
 const transport=useMemo(()=>createLeaveTransitionTransport({actorId,backendScope:LEAVE_BACKEND,formScope:'assigned-decisions',storage:()=>window.localStorage,authorize}),[actorId,context.scopeVersion,client])
 useEffect(()=>{alive.current=true;setRecovery(transport.hasUnresolved());return()=>{alive.current=false}},[transport])
 const dirty=!!reason||recovery;useSetupUnsaved(dirty)
 useLayoutEffect(()=>{onBusyChange?.(busy)},[busy,onBusyChange]);useEffect(()=>()=>onBusyChange?.(false),[onBusyChange])
 useLayoutEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange]);useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange])
 const inbox=useAssignedRead(leaveKeys.private(actorId,context.scopeVersion,'assigned-inbox',before,25),authorize,signal=>fetchAssignedInbox(before,25,signal),true,readState)
 const detail=useAssignedRead(leaveKeys.private(actorId,context.scopeVersion,'assigned-detail',selected),authorize,signal=>fetchAssignedRequest(selected!,signal),!!selected,readState)
 const refresh=useRef(()=>{});refresh.current=()=>{if(document.visibilityState==='visible'&&!working.current){void inbox.refetch();if(selected)void detail.refetch()}}
 useEffect(()=>{const foreground=()=>refresh.current();window.addEventListener('focus',foreground);document.addEventListener('visibilitychange',foreground);const timer=window.setInterval(foreground,60_000);return()=>{window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground);window.clearInterval(timer)}},[])
 useLayoutEffect(()=>{if(readState==='ready'){if(error)alert.current?.focus();else if(detail.data&&!detail.isFetching&&focusedDetail.current!==selected){focusedDetail.current=selected;detailHeading.current?.focus()}}},[readState,error,detail.data,detail.isFetching])
 function select(id:string|null){
  if(currentReadState.current!=='ready'||!inbox.isCurrent()||working.current||recovery)return false
  if(reason&&!window.confirm('Buang alasan penolakan yang belum disimpan?'))return false
  const old=selected;if(selected!==id)focusedDetail.current=null;setReason('');setError('');setMessage('')
  if(id!==null&&id===selected)void detail.refetch()
  setSelected(id)
  if(id===null&&old)queueMicrotask(()=>openers.current.get(old)?.focus())
  return true
 }
 async function complete(){setReason('');setSelected(null);setRecovery(false);setError('');setMessage('Keputusan tersimpan.');await invalidateRequestCaches(client)}
 async function decide(accept:boolean){
  const r=detail.data;if(working.current||currentReadState.current!=='ready'||!r||!detail.isCurrent()||detail.isFetching||detail.isError||recovery||(!accept&&!reason.trim()))return
  working.current=true;setBusy(true);setError('');setMessage('')
  const base={requestId:r.id,expectedVersion:r.version}
  const command:TransitionCommand=r.status==='cancellation_pending'?(accept?{...base,operation:'approve_cancellation',attemptId:r.cancellation!.id}:{...base,operation:'decline_cancellation',attemptId:r.cancellation!.id,reason}):(accept?{...base,operation:'approve_request'}:{...base,operation:'reject_request',reason})
  try{await transport.send(command);if(alive.current)await complete()}
  catch{if(alive.current){const uncertain=transport.hasUnresolved();setRecovery(uncertain);setError(uncertain?'Hasil keputusan belum pasti. Pulihkan hasil sebelum membuat keputusan lain.':'Keputusan belum tersimpan. Muat ulang permintaan dan akses. Jika jadwal atau kebijakan berubah, pemohon perlu menarik dan mengajukan ulang cuti.')}}
  finally{working.current=false;if(alive.current)setBusy(false)}
 }
 async function recover(){
  if(working.current||currentReadState.current!=='ready')return;working.current=true;setBusy(true);setError('')
  try{const result=await transport.reconcile();if(!alive.current)return
   if(result.state==='committed'){transport.acknowledgeRecovered();await complete()}else{setRecovery(false);setMessage('Percobaan sebelumnya tidak tersimpan. Muat ulang sebelum mencoba lagi.');await invalidateRequestCaches(client)}
  }catch{if(alive.current){setRecovery(true);setError('Hasil keputusan belum pasti. Periksa akses lalu pulihkan kembali.')}}
  finally{working.current=false;if(alive.current)setBusy(false)}
 }
 const shownInbox=(readState==='ready'||readState==='refreshing')?inbox.displayData:undefined
 const shownDetail=shownInbox?detail.displayData:undefined
 const actionReady=readState==='ready'&&detail.isCurrent()&&!!detail.data
 const listReady=readState==='ready'&&inbox.isCurrent()
 if(readState!=='ready'&&!shownInbox)return <section aria-label="Daftar persetujuan"><LoadingState title="Memeriksa akses persetujuan..." shape="compact" className="ui-notice ui-notice--info" /></section>
 return <section aria-label="Daftar persetujuan" className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Permintaan yang ditugaskan kepada Anda</h2><Button size="compact" type="button" disabled={readState!=='ready'||busy} onClick={()=>{void inbox.refetch();if(selected)void detail.refetch()}} variant="secondary" className="underline">Muat ulang daftar</Button></div>
  {message&&<p role="status" className="ui-notice ui-notice--info">{message}</p>}
  {error&&<div ref={alert} tabIndex={-1} role="alert" className="ui-notice ui-notice--error">{error}</div>}
  {recovery&&<div className="ui-notice ui-notice--warning"><p>Keputusan sebelumnya perlu dipulihkan.</p><Button size="compact" type="button" disabled={readState!=='ready'||busy} onClick={()=>void recover()} variant="secondary">{busy?'Memeriksa hasil...':'Pulihkan hasil keputusan'}</Button></div>}
  {inbox.isError&&!shownInbox?<Notice tone="error" title={<> Daftar persetujuan belum dapat dimuat. Coba muat ulang daftar. </>}/>:!shownInbox&&(inbox.isFetching||inbox.isPending)?<LoadingState title="Memuat permintaan..." shape="list" className="ui-notice ui-notice--info" />:shownInbox&&<>
   {!shownInbox.rows.length&&<EmptyState title="Tidak ada permintaan yang menunggu keputusan."/>}
   <RecordList  label="Permintaan ditugaskan">{shownInbox.rows.map(row=><li key={row.id} className="space-y-3 rounded-[14px] border border-brand-divider bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-brand-primary">{row.employee.name}</p><p className="mt-1 text-brand-secondary">{row.startDate} sampai {row.endDate}</p></div><p className="font-semibold text-brand-primary">{formatLeaveMinutes(row.totalMinutes)}</p></div><div className="flex flex-wrap items-center justify-between gap-3"><StatusBadge tone="warning" aria-label={`Status permintaan: ${row.status==='cancellation_pending'?'Menunggu pembatalan seluruh cuti':'Menunggu persetujuan cuti'}`}>{row.status==='cancellation_pending'?'Menunggu pembatalan seluruh cuti':'Menunggu persetujuan cuti'}</StatusBadge><button ref={el=>{if(el)openers.current.set(row.id,el);else openers.current.delete(row.id)}} type="button" disabled={!listReady||busy||recovery} aria-label={`Tinjau ${row.employee.name}`} onClick={()=>select(row.id)} className="ui-action ui-action--quiet ui-action--compact">Tinjau permintaan</button></div></li>)}</RecordList>
   <FormActions ><Button size="compact" type="button" disabled={!listReady||!cursors.length||busy||recovery} onClick={()=>{if(select(null)){setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}}} variant="quiet">Lebih baru</Button><Button size="compact" type="button" disabled={!listReady||shownInbox.nextBefore===null||busy||recovery} onClick={()=>{if(select(null)){setCursors([...cursors,before]);setBefore(inbox.data.nextBefore)}}} variant="quiet">Lebih lama</Button></FormActions>
  </>}
  {selected&&<section aria-label="Detail permintaan ditugaskan" className="ui-section space-y-4">
   <Button size="compact" type="button" disabled={!actionReady||busy||recovery} onClick={()=>select(null)} variant="quiet" className="underline">Tutup detail</Button>
   {detail.isError&&!shownDetail?<div role="alert" className="ui-notice ui-notice--error"><p>Detail tidak tersedia atau penugasan berubah.</p><Button size="compact" type="button" onClick={()=>void detail.refetch()} variant="secondary">Muat ulang detail</Button></div>:!shownDetail&&(detail.isPending||detail.isFetching)?<LoadingState title="Memuat detail..." shape="compact" className="ui-notice ui-notice--info" />:shownDetail&&<>
    <h3 ref={detailHeading} tabIndex={-1} className="font-semibold">{shownDetail.employee.name} · {formatLeaveMinutes(shownDetail.totalMinutes)}</h3>
    <p className="text-brand-secondary">{shownDetail.startDate} sampai {shownDetail.endDate}</p>
    <p>Durasi: {shownDetail.duration.mode==='full_scheduled_day'?'Sehari sesuai jadwal':`${formatLeaveMinutes(shownDetail.duration.minutes)} per hari kerja`}</p>
    <p>{shownDetail.reason}</p><p>Penyetuju: {shownDetail.approverName}</p>
    <details className="rounded-[14px] border border-brand-divider px-4 py-2"><summary className="min-h-[var(--ui-control-size-compact)] cursor-pointer rounded py-[var(--ui-control-padding-y-compact)] text-[length:var(--ui-text-control)] leading-[var(--ui-line-control)] font-medium text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-primary">Rincian tanggal dan periode</summary><div className="space-y-2 py-2"><p className="text-[13px] text-brand-secondary">Versi permohonan: {shownDetail.version}</p>
    <ul>{shownDetail.days.map(day=><li key={day.date}>{day.date} · Jadwal {formatLeaveMinutes(day.scheduledMinutes)} · Diminta {formatLeaveMinutes(day.chargedMinutes)}{day.exclusion==='holiday'?' · Libur kalender':day.exclusion==='off_duty'?' · Tidak bertugas':''}{day.groupName&&` · ${day.groupName}`}</li>)}</ul>
    <ul>{shownDetail.allocations.map(a=><li key={a.year}>Periode {a.year}: {formatLeaveMinutes(a.chargedMinutes)}</li>)}</ul>
    </div></details>
    <section aria-label="Konteks saldo permohonan" className="space-y-2 rounded-[14px] bg-brand-canvas p-4"><h4 className="font-semibold text-brand-primary">Saldo terkini untuk periode permohonan</h4><p>Dibaca pada {shownDetail.balanceContext.asOf}. Termasuk reservasi dan pemakaian saat ini; bukan saldo saat pengajuan.</p>
     <ul>{shownDetail.balanceContext.periods.map(period=><li key={period.year}>Periode {period.year}: {period.reconciled?<>Tersedia: {formatLeaveMinutes(period.availableMinutes!)} · Reservasi: {formatLeaveMinutes(period.reservedMinutes!)} · Pemakaian: {formatLeaveMinutes(period.usedMinutes!)}{period.expiredMinutes!>0&&<> · Kedaluwarsa: {formatLeaveMinutes(period.expiredMinutes!)}</>}</>:'Saldo awal belum diverifikasi.'}</li>)}</ul>
    </section>
    {shownDetail.cancellation&&<div className="ui-notice ui-notice--warning"><h4 className="font-semibold">Permintaan pembatalan seluruh cuti</h4><p>{shownDetail.cancellation.reason}</p><p>Penyetuju pembatalan: {shownDetail.cancellation.approverName}</p><p>Pemakaian dan tanggal tetap terpakai sampai pembatalan disetujui. Pengembalian masuk ke periode asal; jatah kedaluwarsa tetap tidak tersedia.</p></div>}
    <Field id={`${fieldId}-1`} label="Alasan penolakan">{control=><textarea {...control} maxLength={1000} disabled={!actionReady||busy||recovery} value={reason} onChange={e=>setReason(e.target.value)} />}</Field>
    <FormActions ><Button type="button" disabled={!actionReady||busy||recovery} onClick={()=>void decide(true)} variant="primary">{busy?'Memproses...':shownDetail.cancellation?'Setujui pembatalan':'Setujui cuti'}</Button><Button type="button" disabled={!actionReady||busy||recovery||!reason.trim()} onClick={()=>void decide(false)} variant="secondary">{shownDetail.cancellation?'Tolak pembatalan':'Tolak cuti'}</Button></FormActions>
   </>}
  </section>}
 </section>
}
