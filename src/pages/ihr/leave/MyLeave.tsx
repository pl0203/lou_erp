import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LeaveContext } from '../../../lib/leave/contracts'
import type { BalanceEntryKind } from '../../../lib/leave/accountContracts'
import { fetchBalanceHistory, formatSignedLeaveMinutes } from '../../../lib/leave/accountRpc'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import { leaveKeys } from '../../../lib/leave/queryKeys'
import { prepareCurrentLeaveAccount } from '../../../lib/leave/prepareAccount'
import { runLeaveInteraction } from '../../../lib/leave/useLeaveContext'
import LeaveRequestForm from './LeaveRequestForm'
import type { LeaveReadState } from './LeaveRequestForm'
const labels:Record<BalanceEntryKind,string>={annual_grant:'Jatah tahunan',opening:'Saldo awal diverifikasi',adjustment:'Penyesuaian',reservation:'Reservasi',approval:'Persetujuan',rejection:'Penolakan',withdrawal:'Penarikan',cancellation:'Pembatalan'}
type Props={actorId:string;context:LeaveContext;onDirtyChange?:(dirty:boolean)=>void;readState?:LeaveReadState}
export default function MyLeave(props:Props){return <MyLeavePanel key={`${props.actorId}:${props.context.scopeVersion}`} {...props}/>}
function MyLeavePanel({actorId,context,onDirtyChange,readState='ready'}:Props){
 const client=useQueryClient(),[selected,setSelected]=useState(''),[open,setOpen]=useState(false)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),submitting=useRef(false)
 const [requestOpen,setRequestOpen]=useState(false),requestOpener=useRef<HTMLButtonElement>(null)
 const allowed=context.capabilities.request&&context.memberKind!=='director'
 const account=context.balances.find(b=>b.accountId===selected)??context.balances.find(b=>b.year===context.currentPeriod?.year)??context.balances[0]

 if(!allowed)return null
 const currentExists=context.balances.some(b=>b.year===context.currentPeriod?.year)
 const known=(minutes:number|null|undefined)=>account?.reconciled===true&&minutes!==null&&minutes!==undefined?formatLeaveMinutes(minutes):'Belum diverifikasi'
 async function prepare(){
  if(submitting.current)return;submitting.current=true;setBusy(true);setError('')
  try{await runLeaveInteraction(client,actorId,context.scopeVersion,live=>prepareCurrentLeaveAccount(client,actorId,live))}
  catch{setError('Jatah belum dapat disiapkan. Muat ulang konteks untuk memeriksa periode dan akses terbaru.')}
  finally{submitting.current=false;setBusy(false);void client.invalidateQueries({queryKey:leaveKeys.context(actorId,'current')})}
 }
 return <section className="space-y-4" aria-label="Cuti saya">
  {readState==='ready'&&<button ref={requestOpener} type="button" disabled={requestOpen} onClick={()=>setRequestOpen(true)} className="rounded bg-orange-600 px-4 py-2 text-white disabled:opacity-50">Buat pratinjau cuti</button>}
  {requestOpen&&<LeaveRequestForm actorId={actorId} context={context} onDirtyChange={onDirtyChange} readState={readState} onClose={()=>{setRequestOpen(false);queueMicrotask(()=>requestOpener.current?.focus())}}/>}
  {readState==='ready'&&<>
  {!context.currentPeriod&&<p>Periode tahunan belum dikonfirmasi. Hubungi administrator HR.</p>}
  {context.currentPeriod&&!currentExists&&<div className="rounded-xl border bg-white p-4"><p>Jatah {context.currentPeriod.year} belum disiapkan. Penyiapan jatah tidak memverifikasi saldo awal.</p><button type="button" disabled={busy} onClick={()=>void prepare()} className="mt-2 rounded bg-orange-600 px-3 py-2 text-white">{busy?'Menyiapkan...':'Siapkan jatah tahun ini'}</button></div>}
  {error&&<p role="alert">{error}</p>}
  {account&&<>
   <label className="block">Periode<select aria-label="Periode saldo" value={account.accountId} onChange={e=>{setSelected(e.target.value);setOpen(false)}} className="ml-2 rounded border p-2">{context.balances.map(b=><option key={b.accountId} value={b.accountId}>{b.year}</option>)}</select></label>
   <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
    {[['Jatah dan penyesuaian',formatLeaveMinutes(account.allowanceMinutes)],['Pemakaian disetujui',known(account.approvedMinutes)],['Reservasi tertunda',known(account.pendingMinutes)],['Tersedia',known(account.availableMinutes)]].map(([label,value])=><div key={label} className="rounded-xl border bg-white p-4"><dt className="text-sm text-gray-600">{label}</dt><dd className="mt-2 text-lg font-semibold text-gray-900">{value}</dd></div>)}
   </dl>
   <p className="text-sm">Termasuk cuti disetujui di masa depan dalam pemakaian disetujui.</p>
   {account.reconciled!==true&&<p className="text-sm">Saldo awal perlu diverifikasi sebelum saldo tersedia dapat dipakai.</p>}
   {account.reconciled===true&&!!account.expiredMinutes&&<p>Kedaluwarsa, tidak dapat dipakai: <strong>{formatLeaveMinutes(account.expiredMinutes)}</strong></p>}
   <button type="button" className="underline" onClick={()=>setOpen(!open)}>{open?'Tutup riwayat saldo':'Riwayat saldo'}</button>
  </>}
  </>}
  {open&&account&&<BalanceHistoryPanel key={`${account.accountId}:${account.version}`} actorId={actorId} scopeVersion={context.scopeVersion} accountId={account.accountId} year={account.year} version={account.version} readState={readState}/>}
 </section>
}

/** A new opening mounts a fresh authority gate even when its immutable rows are cached. */
function BalanceHistoryPanel({actorId,scopeVersion,accountId,year,version,readState}:{actorId:string;scopeVersion:string;accountId:string;year:number;version:number;readState:LeaveReadState}){
 const client=useQueryClient(),[before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([]),[attempt,setAttempt]=useState(0)
 const interaction=JSON.stringify([actorId,scopeVersion,accountId,version,before,attempt])
 const [authority,setAuthority]=useState<{interaction:string;status:'pending'|'ready'|'denied'}|null>(null)
 useEffect(()=>{
  const abort=new AbortController()
  setAuthority({interaction,status:'pending'})
  void runLeaveInteraction(client,actorId,scopeVersion,live=>{
   abort.signal.throwIfAborted()
   if(!live.capabilities.request||live.memberKind==='director'||!live.balances.some(b=>b.accountId===accountId))throw new Error('Akses riwayat berubah.')
  }).then(()=>{if(!abort.signal.aborted)setAuthority({interaction,status:'ready'})},()=>{if(!abort.signal.aborted)setAuthority({interaction,status:'denied'})})
  return ()=>abort.abort()
 },[client,actorId,scopeVersion,accountId,interaction])
 const ready=authority?.interaction===interaction&&authority.status==='ready'
 const history=useQuery({queryKey:leaveKeys.private(actorId,scopeVersion,'balance-history',accountId,version,before),queryFn:({signal})=>fetchBalanceHistory(accountId,before,25,signal),enabled:ready&&readState==='ready',retry:false})
 const denied=authority?.interaction===interaction&&authority.status==='denied'
 const pending=!ready||history.isPending||history.isFetching
 const retry=()=>setAttempt(attempt+1)
 if(readState!=='ready')return <section aria-label="Riwayat saldo"><p role="status">Memeriksa akses riwayat...</p></section>
 return <section aria-label="Riwayat saldo" className="space-y-3 rounded-xl border bg-white p-4">
  <h2 className="font-semibold">Riwayat saldo {year}</h2>
  {denied?<div role="alert"><p>Akses riwayat belum dapat dikonfirmasi. Muat ulang sebelum melanjutkan.</p><button type="button" onClick={retry}>Coba lagi</button></div>:pending?<p role="status">Memuat riwayat...</p>:history.isError?<div role="alert"><p>Riwayat belum dapat dimuat.</p><button type="button" onClick={retry}>Coba lagi</button></div>:history.data&&<>
   {!history.data.rows.length&&<p>Belum ada entri.</p>}
   <ul className="space-y-3">{history.data.rows.map(entry=><li key={entry.id} className="border-b pb-2"><p>{entry.date} · {labels[entry.kind]}</p><dl className="flex flex-wrap gap-4"><div><dt>Jatah</dt><dd>{formatSignedLeaveMinutes(entry.allowanceDelta)}</dd></div><div><dt>Reservasi</dt><dd>{formatSignedLeaveMinutes(entry.reservedDelta)}</dd></div><div><dt>Pemakaian</dt><dd>{formatSignedLeaveMinutes(entry.usedDelta)}</dd></div></dl></li>)}</ul>
   <div className="flex gap-3"><button type="button" disabled={!cursors.length} onClick={()=>{setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}}>Lebih baru</button><button type="button" disabled={history.data.nextBefore===null} onClick={()=>{setCursors([...cursors,before]);setBefore(history.data.nextBefore)}}>Lebih lama</button></div>
  </>}
 </section>
}
