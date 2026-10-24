import { LoadingState } from '../../../components/ui/LoadingState'
import { FormActions } from '../../../components/ui/FormActions'
import { Notice, EmptyState } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { useId, useCallback, useEffect, useRef, useState  } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LeaveContext } from '../../../lib/leave/contracts'
import type { BalanceEntryKind } from '../../../lib/leave/accountContracts'
import { fetchBalanceHistory, formatSignedLeaveMinutes } from '../../../lib/leave/accountRpc'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import { leaveKeys } from '../../../lib/leave/queryKeys'
import { prepareCurrentLeaveAccount } from '../../../lib/leave/prepareAccount'
import {useOwnRequestRead} from '../../../lib/leave/useOwnRequestAuthority'
import { runLeaveInteraction,useLeaveDisplayAuthority } from '../../../lib/leave/useLeaveContext'
import OwnLeaveHistory from './OwnLeaveHistory'
import LeaveRequestForm,{discardLeaveDraftMessage} from './LeaveRequestForm'
import type { LeaveReadState } from './LeaveRequestForm'
const labels:Record<BalanceEntryKind,string>={annual_grant:'Jatah tahunan',opening:'Saldo awal diverifikasi',adjustment:'Penyesuaian',reservation:'Reservasi',approval:'Persetujuan',rejection:'Penolakan',withdrawal:'Penarikan',cancellation:'Pembatalan'}
type Props={actorId:string;context:LeaveContext;onDirtyChange?:(dirty:boolean)=>void;readState?:LeaveReadState}
export default function MyLeave(props:Props){return <MyLeavePanel key={`${props.actorId}:${props.context.scopeVersion}`} {...props}/>}
function MyLeavePanel({actorId,context,onDirtyChange,readState='ready'}:Props){
 const fieldId=useId()
 const client=useQueryClient(),[selected,setSelected]=useState(''),[open,setOpen]=useState(false)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),submitting=useRef(false)
 const [historyOpen,setHistoryOpen]=useState(false),historyDirty=useRef(false),dirtyReporter=useRef(onDirtyChange);dirtyReporter.current=onDirtyChange
 const reportHistoryDirty=useCallback((value:boolean)=>{historyDirty.current=value;dirtyReporter.current?.(value)},[])
 function toggleHistory(){if(readState!=='ready')return;if(!historyOpen||!historyDirty.current||window.confirm(discardLeaveDraftMessage))setHistoryOpen(!historyOpen)}
 const [requestOpen,setRequestOpen]=useState(false),requestOpener=useRef<HTMLButtonElement>(null)
 const allowed=context.capabilities.request&&(context.memberKind==='employee'||context.memberKind==='manager')
 const account=context.balances.find(b=>b.accountId===selected)??context.balances.find(b=>b.year===context.currentPeriod?.year)??context.balances[0]

 if(!allowed)return null
 const currentExists=context.balances.some(b=>b.year===context.currentPeriod?.year)
 const known=(minutes:number|null|undefined)=>account?.reconciled===true&&minutes!==null&&minutes!==undefined?formatLeaveMinutes(minutes):'Belum diverifikasi'
 async function prepare(){
  if(readState!=='ready'||submitting.current)return;submitting.current=true;setBusy(true);setError('')
  try{await runLeaveInteraction(client,actorId,context.scopeVersion,live=>prepareCurrentLeaveAccount(client,actorId,live))}
  catch{setError('Jatah belum dapat disiapkan. Muat ulang konteks untuk memeriksa periode dan akses terbaru.')}
  finally{submitting.current=false;setBusy(false);void client.invalidateQueries({queryKey:leaveKeys.context(actorId,'current')})}
 }
 return <section className="space-y-5" aria-label="Cuti saya">
  {(readState==='ready'||readState==='refreshing')&&<>
   {!context.currentPeriod&&<p className="ui-notice ui-notice--warning">Periode tahunan belum dikonfirmasi. Hubungi administrator HR.</p>}
   {context.currentPeriod&&!currentExists&&<div className="ui-notice ui-notice--warning"><p>Jatah {context.currentPeriod.year} belum disiapkan. Penyiapan jatah tidak memverifikasi saldo awal.</p><Button type="button" disabled={readState!=='ready'||busy} onClick={()=>void prepare()} variant="primary" className="mt-3">{busy?'Menyiapkan...':'Siapkan jatah tahun ini'}</Button></div>}
   {error&&<Notice tone="error" title={<> {error} </>}/>}
   {account&&<section aria-label="Saldo cuti" className="ui-section space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-brand-primary">Saldo cuti</h2><Field id={`${fieldId}-1`} label="Periode">{control=><select {...control} aria-label="Periode saldo" disabled={readState!=='ready'} value={account.accountId} onChange={e=>{setSelected(e.target.value);setOpen(false)}} >{context.balances.map(b=><option key={b.accountId} value={b.accountId}>{b.year}</option>)}</select>}</Field></div>
    <dl className="grid gap-3 sm:grid-cols-4">
     <div className="rounded-[14px] bg-brand-tint p-4 sm:col-span-2"><dt className="text-base font-medium text-brand-primary">Tersedia</dt><dd className="mt-2 text-4xl font-semibold tracking-tight text-brand-primary">{known(account.availableMinutes)}</dd></div>
     {[['Pemakaian disetujui',known(account.approvedMinutes)],['Reservasi tertunda',known(account.pendingMinutes)]].map(([label,value])=><div key={label} className="rounded-[14px] bg-brand-canvas p-4"><dt className="text-base text-brand-secondary">{label}</dt><dd className="mt-2 text-xl font-semibold text-brand-primary">{value}</dd></div>)}
    </dl>
    <p className="text-[13px] text-brand-secondary">Termasuk cuti disetujui di masa depan dalam pemakaian disetujui.</p>
    {account.reconciled!==true&&<p className="ui-notice ui-notice--warning">Saldo awal perlu diverifikasi sebelum saldo tersedia dapat dipakai.</p>}
    {account.reconciled===true&&!!account.expiredMinutes&&<p className="ui-notice ui-notice--warning">Kedaluwarsa, tidak dapat dipakai: <strong>{formatLeaveMinutes(account.expiredMinutes)}</strong></p>}
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-brand-divider pt-3">
     <details className="text-base"><summary className="min-h-[var(--ui-control-size-compact)] cursor-pointer rounded py-[var(--ui-control-padding-y-compact)] text-[length:var(--ui-text-control)] leading-[var(--ui-line-control)] font-medium text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-primary">Rincian saldo</summary><dl className="pt-2"><div><dt>Jatah dan penyesuaian</dt><dd className="font-semibold text-brand-primary">{formatLeaveMinutes(account.allowanceMinutes)}</dd></div></dl></details>
     <Button size="compact" type="button" aria-expanded={open} disabled={readState!=='ready'} variant="quiet" onClick={()=>setOpen(!open)}>{open?'Tutup riwayat saldo':'Riwayat saldo'}</Button>
    </div>
   </section>}
  </>}
  {open&&account&&<BalanceHistoryPanel key={`${account.accountId}:${account.version}`} actorId={actorId} scopeVersion={context.scopeVersion} accountId={account.accountId} year={account.year} version={account.version} readState={readState}/>}
  {(readState==='ready'||readState==='refreshing')&&<FormActions >
   <button ref={requestOpener} type="button" hidden={requestOpen} disabled={readState!=='ready'||requestOpen||historyOpen} onClick={()=>setRequestOpen(true)} className="ui-action ui-action--primary w-full sm:w-auto">Ajukan cuti</button>
   <Button size="compact" type="button" aria-expanded={historyOpen} variant="quiet" disabled={readState!=='ready'||requestOpen} onClick={toggleHistory}>{historyOpen?'Tutup riwayat pengajuan':'Riwayat pengajuan'}</Button>
  </FormActions>}
  {requestOpen&&<LeaveRequestForm actorId={actorId} context={context} onDirtyChange={onDirtyChange} readState={readState} onClose={()=>{setRequestOpen(false);queueMicrotask(()=>requestOpener.current?.focus())}}/>}
  {historyOpen&&<OwnLeaveHistory context={context} actorId={actorId} scopeVersion={context.scopeVersion} readState={readState} onDirtyChange={reportHistoryDirty}/>}
 </section>
}

/** A new opening mounts a fresh authority gate even when its immutable rows are cached. */
function BalanceHistoryPanel({actorId,scopeVersion,accountId,year,version,readState}:{actorId:string;scopeVersion:string;accountId:string;year:number;version:number;readState:LeaveReadState}){
 const client=useQueryClient(),[before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([]),[attempt,setAttempt]=useState(0)
 const displayAuthority=useLeaveDisplayAuthority(client,actorId)
 const interaction=JSON.stringify([actorId,scopeVersion,accountId,version,before,attempt])
 const [authority,setAuthority]=useState<{interaction:string;status:'pending'|'ready'|'denied'}|null>(null)
 useEffect(()=>{
  const abort=new AbortController()
  setAuthority({interaction,status:'pending'})
  displayAuthority.displayLease.startDisplayEpisode()
  void runLeaveInteraction(client,actorId,scopeVersion,live=>{
   abort.signal.throwIfAborted()
   if(!live.capabilities.request||live.memberKind==='director'||!live.balances.some(b=>b.accountId===accountId))throw new Error('Akses riwayat berubah.')
  }).then(()=>{if(!abort.signal.aborted)setAuthority({interaction,status:'ready'})},()=>{if(!abort.signal.aborted)setAuthority({interaction,status:'denied'})})
  return ()=>abort.abort()
 },[client,actorId,scopeVersion,accountId,interaction])
 const ready=authority?.interaction===interaction&&authority.status==='ready'
 const denied=authority?.interaction===interaction&&authority.status==='denied'
 const history=useOwnRequestRead({ready,denied,displayAuthority},leaveKeys.private(actorId,scopeVersion,'balance-history',accountId,version,before),signal=>fetchBalanceHistory(accountId,before,25,signal),readState==='ready',readState==='error')
 const pending=!ready||history.isPending||history.isFetching
 const retry=()=>setAttempt(attempt+1)
 const visible=readState==='ready'&&history.available
 const shown=(readState==='ready'||readState==='refreshing')?history.displayData:undefined
 if(readState!=='ready'&&!shown)return <section aria-label="Riwayat saldo"><LoadingState title="Memeriksa akses riwayat..." shape="compact" className="ui-notice ui-notice--info" /></section>
 return <section aria-label="Riwayat saldo" className="ui-section space-y-3">
  <h2 className="font-semibold">Riwayat saldo {year}</h2>
  {denied&&!shown?<div role="alert" className="ui-notice ui-notice--error"><p>Akses riwayat belum dapat dikonfirmasi. Muat ulang sebelum melanjutkan.</p><Button size="compact" type="button" onClick={retry} variant="secondary">Coba lagi</Button></div>:pending&&!shown?<LoadingState title="Memuat riwayat..." shape="list" className="ui-notice ui-notice--info" />:history.isError?<div role="alert" className="ui-notice ui-notice--error"><p>Riwayat belum dapat dimuat.</p><Button size="compact" type="button" onClick={retry} variant="secondary">Coba lagi</Button></div>:shown&&<>
   {!shown.rows.length&&<EmptyState title="Belum ada entri."/>}
   <ul className="space-y-3">{shown.rows.map(entry=><li key={entry.id} className="border-b pb-2"><p>{entry.date} · {labels[entry.kind]}</p><dl className="flex flex-wrap gap-4"><div><dt>Jatah</dt><dd>{formatSignedLeaveMinutes(entry.allowanceDelta)}</dd></div><div><dt>Reservasi</dt><dd>{formatSignedLeaveMinutes(entry.reservedDelta)}</dd></div><div><dt>Pemakaian</dt><dd>{formatSignedLeaveMinutes(entry.usedDelta)}</dd></div></dl></li>)}</ul>
   <FormActions ><Button size="compact" type="button" disabled={!visible||!cursors.length} onClick={()=>{setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}} variant="quiet">Lebih baru</Button><Button size="compact" type="button" disabled={!visible||shown.nextBefore===null} onClick={()=>{setCursors([...cursors,before]);if(visible&&history.data)setBefore(history.data.nextBefore)}} variant="quiet">Lebih lama</Button></FormActions>
  </>}
 </section>
}
