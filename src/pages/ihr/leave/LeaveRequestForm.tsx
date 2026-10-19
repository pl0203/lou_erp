import { LoadingState } from '../../../components/ui/LoadingState'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { useId, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState  } from 'react'
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
 const fieldId=useId()
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
 return <section aria-label="Formulir pratinjau cuti" className="ui-section space-y-5">
  {router&&<NavigationGuard dirty={dirty}/>}
  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="mb-1 text-[13px] font-medium text-brand-primary">1 · Tanggal dan durasi</p><h2 className="text-lg font-semibold text-brand-primary">Pengajuan cuti tahunan</h2></div><Button size="compact" type="button" onClick={close} variant="quiet">Tutup formulir</Button></div>
  {readState==='ready'&&notice&&<p role="status" className="ui-notice ui-notice--info">{notice}</p>}
  {readState==='ready'&&error&&<div role="alert" tabIndex={-1} ref={alert} className="ui-notice ui-notice--error">{error}</div>}
  {readState==='ready'&&!ready&&!revoked&&<div>{busy?<LoadingState title="Memeriksa akses formulir..." shape="compact" className="ui-notice ui-notice--info" />:<Button size="compact" type="button" onClick={()=>void check()} variant="secondary">Coba lagi</Button>}</div>}
  {readState==='ready'&&ready&&!revoked&&unresolved&&<div className="space-y-2"><p>Hasil pengajuan sebelumnya belum dikonfirmasi. Pulihkan hasil untuk melanjutkan.</p><Button size="compact" type="button" disabled={busy} onClick={()=>void submitOrRecover(true)} variant="secondary">Pulihkan hasil pengajuan</Button></div>}
  {readState==='ready'&&ready&&!revoked&&!unresolved&&<form className="space-y-4" noValidate onSubmit={event=>{event.preventDefault();void check(input)}}>
   <p className="text-base text-brand-secondary">Satu durasi berlaku untuk semua tanggal kerja. Gunakan formulir terpisah untuk durasi berbeda.</p>
   <fieldset disabled={busy} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Field id={`${fieldId}-1`} label="Tanggal mulai">{control=><input {...control} ref={first} type="date" value={input.startDate} onChange={event=>edit({startDate:event.target.value})} />}</Field>
    <Field id={`${fieldId}-2`} label="Tanggal selesai">{control=><input {...control} type="date" value={input.endDate} onChange={event=>edit({endDate:event.target.value})} />}</Field>
   <Field id={`${fieldId}-3`} label="Durasi setiap tanggal" className="sm:col-span-2 lg:col-span-1">{control=><select {...control} value={input.duration.mode==='full_scheduled_day'?'full':String(input.duration.minutes)} onChange={event=>edit({duration:event.target.value==='full'?{mode:'full_scheduled_day'}:{mode:'fixed_minutes',minutes:Number(event.target.value) as Extract<DurationSelection,{mode:'fixed_minutes'}>['minutes']}})} >{durationChoices.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}</Field>
   </div>
   <Field id={`${fieldId}-4`} label="Alasan pribadi">{control=><textarea {...control} rows={3} maxLength={1000} value={input.reason} onChange={event=>edit({reason:event.target.value})} />}</Field>
   <details className="rounded-[10px] bg-brand-canvas px-3 py-2 text-base text-brand-secondary"><summary className="min-h-[var(--ui-control-size-compact)] cursor-pointer rounded py-[var(--ui-control-padding-y-compact)] text-[length:var(--ui-text-control)] leading-[var(--ui-line-control)] font-medium text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-primary">Aturan durasi dan alasan</summary><div className="space-y-2 pt-2"><p>Sehari sesuai jadwal: 7j 30m pada hari kerja biasa dan 3j 45m pada Sabtu bertugas. Durasi tetap harus muat pada setiap tanggal kerja.</p><p>Kewajiban mengisi alasan mengikuti aturan HR. Isian hanya disimpan selama formulir ini terbuka.</p></div></details>
   </fieldset>
   <Button type="submit" disabled={busy} variant={quote?'secondary':'primary'} className="w-full sm:w-auto">{busy?'Memeriksa...':'Hitung pratinjau'}</Button>
  </form>}
  {readState==='ready'&&!unresolved&&quote&&<section aria-label="Pratinjau cuti" tabIndex={-1} ref={result} className="space-y-4 border-t border-brand-divider pt-5 focus-visible:outline-2 focus-visible:outline-brand-primary">
   <p className="text-[13px] font-medium text-brand-primary">2 · Tinjau pengajuan</p>
   <div className="grid gap-3 sm:grid-cols-3">
    <div className="rounded-[14px] bg-brand-tint p-4"><h3 className="text-base font-medium text-brand-primary">Total potongan: <span className="mt-2 block text-3xl font-semibold tracking-tight text-brand-primary">{formatLeaveMinutes(quote.totalMinutes)}</span></h3></div>
    <div className="rounded-[14px] bg-brand-canvas p-4"><p className="text-base text-brand-secondary">Sisa tersedia</p><ul className="mt-2 space-y-2">{quote.allocations.map(allocation=><li key={allocation.accountId}><strong className="text-xl font-semibold text-brand-primary">{formatLeaveMinutes(allocation.availableAfter)}</strong><span className="mt-1 block text-[13px] text-brand-secondary">Periode {allocation.year} · potongan {formatLeaveMinutes(allocation.chargedMinutes)}</span></li>)}</ul></div>
    <div className="rounded-[14px] bg-brand-canvas p-4"><p className="text-base text-brand-secondary">Penyetuju: <span className="mt-2 block text-base font-semibold text-brand-primary">{quote.approver.name}</span></p></div>
   </div>
   <details className="rounded-[14px] border border-brand-divider px-4 py-2"><summary className="min-h-[var(--ui-control-size-compact)] cursor-pointer rounded py-[var(--ui-control-padding-y-compact)] text-[length:var(--ui-text-control)] leading-[var(--ui-line-control)] font-medium text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-primary">Rincian per tanggal</summary><div role="region" aria-label="Rincian tanggal dan potongan" tabIndex={0} className="overflow-x-auto pb-2 pt-2"><table className="w-full text-left text-sm"><caption className="sr-only">Rincian tanggal dan potongan</caption><thead className="text-brand-secondary"><tr><th className="pr-4 pb-2">Tanggal</th><th className="pr-4 pb-2">Jadwal</th><th className="pr-4 pb-2">Keterangan</th><th className="pb-2">Potongan</th></tr></thead><tbody>{quote.days.map(day=><tr key={day.date} className="border-t border-brand-divider"><th scope="row" className="whitespace-nowrap py-3 pr-4 font-medium">{day.date}</th><td className="whitespace-nowrap pr-4">{formatLeaveMinutes(day.scheduledMinutes)}</td><td className="pr-4"><span>{day.exclusion==='holiday'?'Libur kalender':day.exclusion==='off_duty'?'Tidak bertugas':'Hari kerja'}</span>{day.sources.groupName&&<span className="block text-[13px] text-brand-secondary">{day.sources.groupName}</span>}</td><td className="whitespace-nowrap font-medium">{formatLeaveMinutes(day.chargedMinutes)}</td></tr>)}</tbody></table></div></details>
   <p className="ui-notice ui-notice--warning">Pratinjau belum mengajukan cuti atau mereservasi saldo. Perubahan isian atau data membutuhkan perhitungan ulang.</p>
   <Button type="button" disabled={busy} onClick={()=>void submitOrRecover()} variant="primary" className="w-full sm:w-auto">Ajukan cuti</Button>
  </section>}
 </section>
}
