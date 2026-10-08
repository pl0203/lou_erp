import { useContext,useEffect,useLayoutEffect,useMemo,useRef,useState } from 'react'
import { UNSAFE_DataRouterContext } from 'react-router-dom'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { LEAVE_BACKEND } from '../../../lib/leave/queryKeys'
import { ownRequestKeys } from '../../../lib/leave/requestHistoryKeys'
import { useOwnRequestAuthority } from '../../../lib/leave/useOwnRequestAuthority'
import { runLeaveInteraction } from '../../../lib/leave/useLeaveContext'
import { fetchOwnTransitionState } from '../../../lib/leave/transitionRpc'
import { createLeaveTransitionTransport } from '../../../lib/leave/transitionTransport'
import type { TransitionCommand,TransitionReceipt } from '../../../lib/leave/transitionContracts'
import { invalidateRequestCaches } from '../../../lib/leave/requestTransport'
import { NavigationGuard,discardLeaveDraftMessage } from './LeaveRequestForm'
import type { LeaveReadState } from './LeaveRequestForm'
import { useSetupUnsaved } from './useSetupUnsaved'
type Props={actorId:string;scopeVersion:string;requestId:string;requestVersion:number;readState:LeaveReadState;onDirtyChange?:(dirty:boolean)=>void}
const blockers:Record<string,string>={CANCELLATION_RULES_UNCONFIRMED:'Aturan pembatalan belum dikonfirmasi HR.',CANCELLATION_PAST_DATE_BLOCKED:'Aturan HR tidak mengizinkan pembatalan tanggal yang sudah lewat.',CANCELLATION_REPEAT_BLOCKED:'Aturan HR tidak mengizinkan permintaan pembatalan ulang.',APPROVER_UNAVAILABLE:'Penyetuju pembatalan belum tersedia.'}
const success=(receipt:TransitionReceipt)=>receipt.operation==='withdraw_request'?'Pengajuan cuti telah ditarik. Reservasi saldo dilepas.':'Permintaan pembatalan telah dikirim. Pemakaian saldo tetap berlaku sampai pembatalan disetujui.'
export default function OwnRequestActions({actorId,scopeVersion,requestId,requestVersion,readState,onDirtyChange}:Props){
 const client=useQueryClient(),router=useContext(UNSAFE_DataRouterContext),authority=useOwnRequestAuthority(actorId,scopeVersion,JSON.stringify(['actions',requestId,requestVersion]))
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[completedVersion,setCompletedVersion]=useState<number|null>(null)
 const alive=useRef(true),active=useRef<AbortController|null>(null),mutating=useRef(false),first=useRef<HTMLTextAreaElement>(null),opener=useRef<HTMLButtonElement>(null)
 const transport=useMemo(()=>createLeaveTransitionTransport({actorId,backendScope:LEAVE_BACKEND,formScope:`own-transition:${requestId}`,storage:()=>window.localStorage,authorize:()=>runLeaveInteraction(client,actorId,scopeVersion,live=>{
  if(!alive.current||active.current?.signal.aborted||!live.capabilities.request||!['employee','manager'].includes(live.memberKind??''))throw new Error('authority-revoked')
 })}),[client,actorId,scopeVersion,requestId])
 const [unresolved,setUnresolved]=useState(()=>transport.hasUnresolved()),dirty=reason!==''
 useSetupUnsaved(dirty)
 useLayoutEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange]);useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;active.current?.abort()}},[])
 const key=ownRequestKeys.transition(actorId,scopeVersion,requestId,requestVersion)
 const state=useQuery({queryKey:key,queryFn:({signal})=>fetchOwnTransitionState(requestId,signal),enabled:authority.ready&&readState==='ready'&&!busy,retry:false})
 useEffect(()=>{if(readState!=='ready'||!authority.ready)void client.cancelQueries({queryKey:key,exact:true})},[client,readState,authority.ready,JSON.stringify(key)])
 const visible=readState==='ready'&&authority.ready&&!state.isPending&&!state.isFetching&&!state.isError
 useLayoutEffect(()=>{if(open&&visible&&!unresolved)first.current?.focus()},[open,visible,unresolved])
 useEffect(()=>{if(visible&&state.data&&!state.data.canRequestCancellation){setOpen(false);setReason('')}},[visible,state.data])
 function close(){if(!dirty||window.confirm(discardLeaveDraftMessage)){setOpen(false);setReason('');setError('');queueMicrotask(()=>opener.current?.focus())}}
 async function send(recover=false,command?:TransitionCommand){
  if(mutating.current||readState!=='ready'||!authority.ready||(!recover&&(!visible||!command||transport.hasUnresolved())))return
  mutating.current=true;active.current=new AbortController();const abort=active.current;setBusy(true);setError('');setNotice('')
  const current=()=>alive.current&&!abort.signal.aborted
  try{
   const outcome=recover?await transport.reconcile():{state:'committed' as const,result:await transport.send(command!)}
   if(outcome.state==='committed'){
    if(outcome.result.id!==requestId||!['withdraw_request','request_cancellation'].includes(outcome.result.operation))throw new Error('invalid-receipt')
    if(current()){setReason('');setOpen(false);setUnresolved(false);setCompletedVersion(outcome.result.version);setNotice(success(outcome.result))}
    await invalidateRequestCaches(client)
    if(recover)transport.acknowledgeRecovered()
   }else if(current()){
    setUnresolved(false);setNotice('Tindakan sebelumnya tidak tersimpan. Periksa status terbaru sebelum mencoba lagi.');await client.invalidateQueries({queryKey:key,exact:true})
   }
  }catch{if(current()){setUnresolved(transport.hasUnresolved());setError(transport.hasUnresolved()?'Hasil tindakan belum pasti. Pulihkan hasil sebelum mencoba tindakan lain.':'Tindakan belum tersimpan. Periksa status dan akses terbaru sebelum mencoba lagi.')}}
  finally{mutating.current=false;if(current()){active.current=null;setBusy(false);setUnresolved(transport.hasUnresolved())}}
 }
 const completed=completedVersion!==null&&(!state.data||state.data.version<=completedVersion)
 return <section aria-label="Tindakan pengajuan cuti" className="space-y-3 border-t pt-3">
  {router&&<NavigationGuard dirty={dirty}/>}
  {readState!=='ready'?<p role="status">Memeriksa akses tindakan...</p>:<>
   {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
   {authority.denied?<div role="alert"><p>Akses tindakan belum dapat dikonfirmasi.</p><button type="button" onClick={authority.retry}>Coba lagi tindakan</button></div>:!authority.ready?<p role="status">Memeriksa akses tindakan...</p>:unresolved?<div><p>Hasil tindakan sebelumnya belum dikonfirmasi.</p><button type="button" disabled={busy} onClick={()=>void send(true)}>Pulihkan hasil tindakan</button></div>:state.isError?<div role="alert"><p>Status tindakan belum dapat dimuat.</p><button type="button" onClick={authority.retry}>Coba lagi tindakan</button></div>:!visible?<p role="status">Memuat status tindakan...</p>:state.data&&!completed&&<>
    {state.data.canWithdraw&&<button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={()=>void send(false,{operation:'withdraw_request',requestId,expectedVersion:state.data!.version})}>Tarik pengajuan</button>}
    {state.data.cancellationBlocker&&<p>{blockers[state.data.cancellationBlocker]??'Pembatalan belum tersedia berdasarkan aturan dan akses terbaru.'}</p>}
    {state.data.canRequestCancellation&&!open&&<button ref={opener} type="button" disabled={busy} className="rounded border px-3 py-2" onClick={()=>{setOpen(true);setNotice('')}}>Minta pembatalan seluruh pengajuan</button>}
    {open&&state.data.canRequestCancellation&&<form className="space-y-3" onSubmit={event=>{event.preventDefault();void send(false,{operation:'request_cancellation',requestId,expectedVersion:state.data!.version,reason})}}>
     <p>Pembatalan berlaku untuk seluruh pengajuan. Pemakaian saldo tetap berlaku sampai penyetuju menerima pembatalan.</p>
     <label className="block">Alasan pembatalan<textarea ref={first} maxLength={1000} disabled={busy} value={reason} onChange={event=>setReason(event.target.value)} className="block w-full rounded border p-2"/></label>
     <p className="text-sm">Kewajiban mengisi alasan mengikuti aturan HR. Isian disimpan hanya selama rincian ini terbuka.</p>
     <div className="flex gap-3"><button type="submit" disabled={busy} className="rounded bg-brand-primary px-3 py-2 text-white">Kirim permintaan pembatalan</button><button type="button" disabled={busy} onClick={close}>Tutup pembatalan</button></div>
    </form>}
   </>}
  </>}
 </section>
}
