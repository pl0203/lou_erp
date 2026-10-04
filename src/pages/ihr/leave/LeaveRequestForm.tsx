import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { DurationSelection, LeaveContext } from '../../../lib/leave/contracts'
import type { AuthoritativeLeaveQuote, LeaveQuoteInput } from '../../../lib/leave/quoteContracts'
import { fetchLeaveQuote, toQuotePayload } from '../../../lib/leave/quoteRpc'
import { runLeaveInteraction } from '../../../lib/leave/useLeaveContext'
import { createLeaveRequestTransport, invalidateRequestCaches } from '../../../lib/leave/requestTransport'
import { LEAVE_BACKEND, leaveKeys } from '../../../lib/leave/queryKeys'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import { useSetupUnsaved } from './useSetupUnsaved'

export const discardLeaveDraftMessage='Buang isian cuti yang belum disimpan?'
export type LeaveReadState='ready'|'pending'|'error'
type Props={actorId:string;context:LeaveContext;onClose:()=>void;onDirtyChange?:(dirty:boolean)=>void;readState?:LeaveReadState}
const emptyInput=():LeaveQuoteInput=>({startDate:'',endDate:'',duration:{mode:'full_scheduled_day'},reason:''})
const canRequest=(context:LeaveContext)=>context.capabilities.request&&(context.memberKind==='employee'||context.memberKind==='manager')
const durationChoices=[['full','Sehari sesuai jadwal'],['60','1 jam'],['120','2 jam'],['180','3 jam'],['225','3 jam 45 menit (setengah hari)'],['240','4 jam'],['300','5 jam'],['360','6 jam']] as const

/** The existing data router owns push/replace/Back/Forward blocking. No history monkey patch. */
export function NavigationGuard({dirty}:{dirty:boolean}){
 const blocker=useBlocker(dirty)
 useEffect(()=>{if(blocker.state==='blocked'){if(window.confirm(discardLeaveDraftMessage))blocker.proceed();else blocker.reset()}},[blocker])
 return null
}

/** Draft and quote live only in this keyed form. Neither is stored in QueryClient or recovery. */
export default function LeaveRequestForm({actorId,context,onClose,onDirtyChange,readState='ready'}:Props){
 const client=useQueryClient(),router=useContext(UNSAFE_DataRouterContext)
 const [input,setInput]=useState(emptyInput),[ready,setReady]=useState(false),[revoked,setRevoked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [preview,setPreview]=useState<{quote:AuthoritativeLeaveQuote;signature:string}|null>(null)
 const first=useRef<HTMLInputElement>(null),alert=useRef<HTMLDivElement>(null),result=useRef<HTMLElement>(null)
 const active=useRef<{abort:AbortController;serial:number}|null>(null),serial=useRef(0),alive=useRef(true),firstFocus=useRef(false)
 const signature=JSON.stringify([actorId,context.scopeVersion,context.memberKind,context.capabilities.request,context.currentPeriod,context.timezone,context.balances])
 const signatureRef=useRef(signature);signatureRef.current=signature
 const transport=useMemo(()=>createLeaveRequestTransport({actorId,backendScope:LEAVE_BACKEND,formScope:'own-request',storage:()=>window.localStorage,authorize:()=>runLeaveInteraction(client,actorId,context.scopeVersion,live=>{
  if(!alive.current||active.current?.abort.signal.aborted||!canRequest(live))throw new Error('authority-revoked')
 })}),[client,actorId,context.scopeVersion])
 const [unresolved,setUnresolved]=useState(()=>transport.hasUnresolved()),mutating=useRef(false)
 const dirty=input.startDate!==''||input.endDate!==''||input.reason!==''||input.duration.mode!=='full_scheduled_day'
 useSetupUnsaved(dirty)
 useLayoutEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange])
 useEffect(()=>()=>{onDirtyChange?.(false)},[onDirtyChange])
 useLayoutEffect(()=>{if(readState!=='ready')return;if(error)alert.current?.focus();else if(preview)result.current?.focus();else if(ready&&!firstFocus.current&&first.current){firstFocus.current=true;first.current.focus()}},[error,preview,ready,readState])
 function invalidate(){serial.current++;active.current?.abort.abort();active.current=null;setBusy(false);setPreview(null)}
 function revoke(){invalidate();setInput(emptyInput());setReady(false);setRevoked(true);setError('Akses formulir berubah. Tutup dan muat ulang akses cuti.')}
 async function check(quoteInput?:LeaveQuoteInput){
  if(active.current||revoked||mutating.current)return
  setError('');setPreview(null);setBusy(true)
  const abort=new AbortController(),turn=++serial.current,startedSignature=signatureRef.current
  active.current={abort,serial:turn}
  const current=()=>alive.current&&!abort.signal.aborted&&serial.current===turn&&signatureRef.current===startedSignature
  try{
   if(quoteInput){if(transport.hasUnresolved()){setUnresolved(true);return}toQuotePayload(quoteInput)}
   await runLeaveInteraction(client,actorId,context.scopeVersion,live=>{
    abort.signal.throwIfAborted()
    if(!canRequest(live))throw new Error('authority-revoked')
   })
   if(!current())return
   setReady(true)
   if(quoteInput){
    const quote=await fetchLeaveQuote(quoteInput,abort.signal)
    if(!current())return
    if(quote.scopeVersion!==context.scopeVersion){revoke();return}
    setPreview({quote,signature:startedSignature})
   }
  }catch{
   if(!current())return
   const live=client.getQueryData<LeaveContext>(leaveKeys.context(actorId,'current'))
   if(live&&(live.scopeVersion!==context.scopeVersion||!canRequest(live))){revoke();return}
   setError(quoteInput?'Pratinjau belum dapat dihitung. Periksa tanggal, durasi, alasan, saldo, dan kelengkapan aturan cuti; lalu coba lagi.':'Akses formulir belum dapat dikonfirmasi. Silakan coba lagi.')
  }finally{if(current()){active.current=null;setBusy(false)}}
 }
 // A fresh mount gates all private content; obsolete reads cannot publish after close or identity change.
 useEffect(()=>{alive.current=true;void check();return()=>{alive.current=false;serial.current++;active.current?.abort.abort();active.current=null}},[])
 const previousSignature=useRef(signature)
 useEffect(()=>{if(previousSignature.current!==signature){previousSignature.current=signature;invalidate()}},[signature])
 // A shared page read failure suspends this owner's rendering, not its private draft
 // or dirty guards. Drop pending/previous quotes so a retry cannot revive them.
 useEffect(()=>{if(readState==='error'){invalidate();setError('')}},[readState])
 // Backgrounding invalidates a preview immediately. Foreground and bounded visible polling recheck authority.
 const refresh=useRef(()=>{});refresh.current=()=>{if(mutating.current)return;invalidate();if(document.visibilityState==='visible')void check()}
 useEffect(()=>{
  const foreground=()=>refresh.current(),poll=()=>{if(document.visibilityState==='visible')refresh.current()}
  window.addEventListener('focus',foreground);document.addEventListener('visibilitychange',foreground)
  const timer=window.setInterval(poll,60_000)
  return()=>{window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground);window.clearInterval(timer)}
 },[])
 function edit(change:Partial<LeaveQuoteInput>){if(mutating.current||transport.hasUnresolved())return;invalidate();setError('');setNotice('');setInput(previous=>({...previous,...change}))}
 async function submitOrRecover(recover=false){
  if(mutating.current||active.current||revoked||readState!=='ready')return
  const quote=preview?.signature===signatureRef.current?preview.quote:null
  if(!recover&&(!quote||transport.hasUnresolved())){setUnresolved(transport.hasUnresolved());return}
  mutating.current=true;setBusy(true);setError('');setNotice('')
  const abort=new AbortController(),turn=++serial.current,startedSignature=signatureRef.current
  active.current={abort,serial:turn}
  const current=()=>alive.current&&!abort.signal.aborted&&serial.current===turn&&signatureRef.current===startedSignature
  try{
   const outcome=recover?await transport.reconcile():{state:'committed' as const,result:await transport.send(input,quote!.fingerprint)}
   if(outcome.state==='committed'){
    // Confirmed results refresh affected views even if this form has since closed.
    if(current()){setInput(emptyInput());setPreview(null);setNotice('Cuti berhasil diajukan. Saldo telah direservasi.');setUnresolved(false)}
    await invalidateRequestCaches(client)
    if(recover)transport.acknowledgeRecovered()
   }else if(current()){
    setPreview(null);setUnresolved(false);setNotice('Pengajuan sebelumnya tidak tersimpan. Hitung pratinjau sebelum mengajukan lagi.')
   }
  }catch{
   if(!current())return
   const live=client.getQueryData<LeaveContext>(leaveKeys.context(actorId,'current'))
   if(live&&(live.scopeVersion!==context.scopeVersion||!canRequest(live))){revoke();return}
   setPreview(null);setUnresolved(transport.hasUnresolved())
   setError(transport.hasUnresolved()?'Hasil pengajuan belum pasti. Pulihkan hasil sebelum membuat pengajuan lain.':'Cuti belum diajukan. Periksa isian, saldo, dan akses terbaru; lalu hitung pratinjau lagi.')
  }finally{
   mutating.current=false
   if(alive.current&&serial.current===turn){active.current=null;setBusy(false);setUnresolved(transport.hasUnresolved())}
  }
 }
 function close(){if(!dirty||window.confirm(discardLeaveDraftMessage))onClose()}
 const quote=preview?.signature===signature?preview.quote:null
 return <section aria-label="Formulir pratinjau cuti" className="space-y-4 rounded-xl border bg-white p-4">
  {router&&<NavigationGuard dirty={dirty}/>}
  <div className="flex items-center justify-between gap-4"><h2 className="font-semibold text-gray-900">Pratinjau cuti tahunan</h2><button type="button" onClick={close} className="underline">Tutup formulir</button></div>
  {readState==='ready'&&notice&&<p role="status">{notice}</p>}
  {readState==='ready'&&error&&<div role="alert" tabIndex={-1} ref={alert} className="rounded border border-red-200 bg-red-50 p-3 text-red-900">{error}</div>}
  {readState==='ready'&&!ready&&!revoked&&<div>{busy?<p role="status">Memeriksa akses formulir...</p>:<button type="button" onClick={()=>void check()}>Coba lagi</button>}</div>}
  {readState==='ready'&&ready&&!revoked&&unresolved&&<div className="space-y-2"><p>Hasil pengajuan sebelumnya belum dikonfirmasi. Pulihkan hasil untuk melanjutkan.</p><button type="button" disabled={busy} onClick={()=>void submitOrRecover(true)} className="rounded border px-4 py-2">Pulihkan hasil pengajuan</button></div>}
  {readState==='ready'&&ready&&!revoked&&!unresolved&&<form className="space-y-4" noValidate onSubmit={event=>{event.preventDefault();void check(input)}}>
   <p>Satu durasi berlaku untuk semua tanggal kerja. Gunakan formulir terpisah untuk durasi berbeda.</p>
   <fieldset disabled={busy} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">
    <label>Tanggal mulai<input ref={first} type="date" value={input.startDate} onChange={event=>edit({startDate:event.target.value})} className="block w-full rounded border p-2"/></label>
    <label>Tanggal selesai<input type="date" value={input.endDate} onChange={event=>edit({endDate:event.target.value})} className="block w-full rounded border p-2"/></label>
   </div>
   <label className="block">Durasi setiap tanggal<select value={input.duration.mode==='full_scheduled_day'?'full':String(input.duration.minutes)} onChange={event=>edit({duration:event.target.value==='full'?{mode:'full_scheduled_day'}:{mode:'fixed_minutes',minutes:Number(event.target.value) as Extract<DurationSelection,{mode:'fixed_minutes'}>['minutes']}})} className="mt-1 block w-full rounded border p-2">{durationChoices.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <p className="text-sm">Sehari sesuai jadwal: 7j 30m pada hari kerja biasa dan 3j 45m pada Sabtu bertugas. Durasi tetap harus muat pada setiap tanggal kerja.</p>
   <label className="block">Alasan pribadi<textarea maxLength={1000} value={input.reason} onChange={event=>edit({reason:event.target.value})} className="mt-1 block w-full rounded border p-2"/></label>
   <p className="text-sm">Kewajiban mengisi alasan mengikuti aturan HR. Isian hanya disimpan selama formulir ini terbuka.</p>
   </fieldset>
   <button type="submit" disabled={busy} className="rounded bg-orange-600 px-4 py-2 text-white disabled:opacity-50">{busy?'Memeriksa...':'Hitung pratinjau'}</button>
  </form>}
  {readState==='ready'&&!unresolved&&quote&&<section aria-label="Pratinjau cuti" tabIndex={-1} ref={result} className="space-y-3 border-t pt-4">
   <h3 className="font-semibold text-gray-900">Total potongan: <span>{formatLeaveMinutes(quote.totalMinutes)}</span></h3>
   <p>Penyetuju: <span>{quote.approver.name}</span></p>
   <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Rincian tanggal dan potongan</caption><thead><tr><th>Tanggal</th><th>Jadwal</th><th>Keterangan</th><th>Potongan</th></tr></thead><tbody>{quote.days.map(day=><tr key={day.date} className="border-t"><th scope="row" className="py-2">{day.date}</th><td>{formatLeaveMinutes(day.scheduledMinutes)}</td><td><span>{day.exclusion==='holiday'?'Libur kalender':day.exclusion==='off_duty'?'Tidak bertugas':'Hari kerja'}</span>{day.sources.groupName&&<span className="block text-xs">{day.sources.groupName}</span>}</td><td>{formatLeaveMinutes(day.chargedMinutes)}</td></tr>)}</tbody></table></div>
   <ul>{quote.allocations.map(allocation=><li key={allocation.accountId}>Periode {allocation.year} · potongan {formatLeaveMinutes(allocation.chargedMinutes)} · tersedia setelah pratinjau: <strong>{formatLeaveMinutes(allocation.availableAfter)}</strong></li>)}</ul>
   <button type="button" disabled={busy} onClick={()=>void submitOrRecover()} className="rounded bg-orange-600 px-4 py-2 text-white disabled:opacity-50">Ajukan cuti</button>
   <p className="text-sm">Pratinjau belum mengajukan cuti atau mereservasi saldo. Perubahan isian atau data membutuhkan perhitungan ulang.</p>
  </section>}
 </section>
}
