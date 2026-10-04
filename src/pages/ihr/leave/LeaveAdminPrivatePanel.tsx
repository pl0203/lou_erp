import { useEffect, useRef, useState } from 'react'
import type { LeaveContext, LeaveStatus } from '../../../lib/leave/contracts'
import type { HrHistoryCursor, LeaveAdminTarget } from '../../../lib/leave/adminContracts'
import { fetchHrRequest, fetchHrRequestHistory, fetchHrRequests } from '../../../lib/leave/adminRpc'
import { adminKeys } from '../../../lib/leave/adminQueryKeys'
import { fetchBalanceAccounts, fetchBalanceHistory, formatSignedLeaveMinutes } from '../../../lib/leave/accountRpc'
import { leaveKeys } from '../../../lib/leave/queryKeys'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import type { LeaveReadState } from './LeaveRequestForm'
type Props={actorId:string;context:LeaveContext;target:LeaveAdminTarget;readState:LeaveReadState}
const permitted=(context:LeaveContext)=>context.memberKind!=='director'&&context.capabilities.readPrivate
const statuses:Record<LeaveStatus,string>={submitted:'Menunggu persetujuan',approved:'Disetujui',rejected:'Ditolak',withdrawn:'Ditarik',cancellation_pending:'Pembatalan menunggu persetujuan',cancelled:'Dibatalkan'}
const events:Record<string,string>={submitted:'Diajukan',opening_imported:'Saldo awal dicatat',approved:'Disetujui',rejected:'Ditolak',withdrawn:'Ditarik',cancellation_requested:'Pembatalan diminta',cancellation_accepted:'Pembatalan disetujui',cancellation_declined:'Pembatalan ditolak',reassigned:'Penugasan dialihkan'}
export default function LeaveAdminPrivatePanel(props:Props){
 const [mode,setMode]=useState<'requests'|'balances'>('requests')
 return <section aria-label="Tinjauan privat anggota" className="space-y-4">
  {props.readState==='ready'&&<nav aria-label="Data privat anggota" className="flex flex-wrap gap-3"><button type="button" aria-pressed={mode==='requests'} className="min-h-11 rounded border px-3" onClick={()=>setMode('requests')}>Permohonan anggota</button><button type="button" aria-pressed={mode==='balances'} className="min-h-11 rounded border px-3" onClick={()=>setMode('balances')}>Saldo dan riwayat anggota</button></nav>}
  {mode==='requests'?<PrivateRequests {...props}/>:<PrivateBalances {...props}/>}
 </section>
}
function PrivateRequests({actorId,context,target,readState}:Props){
 const [before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([]),[selected,setSelected]=useState<string|null>(null)
 const query=useAuthorizedLeaveRead(actorId,context,adminKeys.hrRequests(actorId,context.scopeVersion,target.id,before,50),signal=>fetchHrRequests(target.id,context.scopeVersion,before,50,signal),target.capabilities.readPrivate,permitted)
 const fresh=readState==='ready'&&query.available
 return <section aria-label="Permohonan privat anggota" className="space-y-3">
  {readState!=='ready'?<p role="status">Memeriksa akses tinjauan privat...</p>:(query.isError||!query.available&&!query.isFetching)?<div role="alert"><p>Permohonan privat belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void query.refetch()}>Muat ulang permohonan privat</button></div>:!fresh?<p role="status">Memuat permohonan privat...</p>:<>
   <h3 className="font-semibold">Permohonan anggota dalam lingkup Anda</h3>
   {!query.data?.rows.length&&<p>Belum ada permohonan anggota.</p>}
   <ul className="space-y-3">{query.data?.rows.map(row=><li key={row.id} className="rounded border bg-white p-3"><p>{row.startDate} sampai {row.endDate} · {formatLeaveMinutes(row.totalMinutes)}</p><p>{statuses[row.status]}</p><button type="button" className="min-h-11 underline" aria-label={`Tinjau pengajuan ${row.startDate} sampai ${row.endDate}`} onClick={()=>setSelected(row.id)}>Buka rincian privat</button></li>)}</ul>
   <div className="flex flex-wrap gap-3"><button type="button" disabled={!cursors.length} onClick={()=>{setSelected(null);setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}}>Permohonan privat lebih baru</button><button type="button" disabled={query.data?.nextBefore==null} onClick={()=>{setSelected(null);setCursors([...cursors,before]);setBefore(query.data!.nextBefore)}}>Permohonan privat lebih lama</button></div>
  </>}
  {selected&&<PrivateDetail key={selected} actorId={actorId} context={context} target={target} readState={fresh?'ready':readState==='error'||query.isError?'error':'pending'} requestId={selected} listAuthority={query.data?.authorityKey} onClose={()=>setSelected(null)}/>}
 </section>
}
function PrivateDetail({actorId,context,target,readState,requestId,listAuthority,onClose}:Props&{requestId:string;listAuthority?:string;onClose:()=>void}){
 const query=useAuthorizedLeaveRead(actorId,context,adminKeys.hrRequest(actorId,context.scopeVersion,target.id,requestId),signal=>fetchHrRequest(target.id,context.scopeVersion,requestId,signal),target.capabilities.readPrivate,permitted)
 const fresh=readState==='ready'&&query.available&&query.data?.authorityKey===listAuthority,heading=useRef<HTMLHeadingElement>(null)
 useEffect(()=>{if(fresh)heading.current?.focus()},[fresh])
 return <section aria-label="Rincian privat anggota" className="space-y-3 rounded-xl border bg-white p-4">
  {readState==='ready'&&<button type="button" className="min-h-11 underline" onClick={onClose}>Tutup rincian privat</button>}
  {(query.isError||!fresh&&!query.isFetching)&&readState==='ready'?<div role="alert"><p>Rincian privat belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void query.refetch()}>Muat ulang rincian privat</button></div>:!fresh?<p role="status">Memeriksa rincian privat...</p>:query.data&&<>
   <h3 ref={heading} tabIndex={-1} className="font-semibold">Rincian permohonan anggota</h3><p>{statuses[query.data.request.status]} · {query.data.request.startDate} sampai {query.data.request.endDate}</p><p>{query.data.request.reason||'Tidak ada alasan yang diisi.'}</p><p>Penyetuju asal: {query.data.request.approverName}</p>
   <div className="overflow-x-auto"><table className="w-full text-left"><caption>Tanggal dan potongan yang disimpan</caption><thead><tr><th>Tanggal</th><th>Jadwal asal</th><th>Potongan</th><th>Keterangan</th></tr></thead><tbody>{query.data.request.days.map(day=><tr key={day.date}><th scope="row">{day.date}</th><td>{formatLeaveMinutes(day.scheduledMinutes)}</td><td>{formatLeaveMinutes(day.chargedMinutes)}</td><td>{day.exclusion==='holiday'?'Libur kalender':day.exclusion==='off_duty'?'Tidak bertugas':'Hari kerja'}{day.groupName&&` · ${day.groupName}`}</td></tr>)}</tbody></table></div>
   <ul>{query.data.request.allocations.map(allocation=><li key={allocation.year}>Periode {allocation.year}: {allocation.startDate} sampai sebelum {allocation.endDate} · {formatLeaveMinutes(allocation.chargedMinutes)}</li>)}</ul>
  </>}
  <PrivateHistory actorId={actorId} context={context} target={target} readState={fresh?'ready':readState==='error'||query.isError?'error':'pending'} requestId={requestId} detailAuthority={query.data?.authorityKey}/>
 </section>
}
function PrivateHistory({actorId,context,target,readState,requestId,detailAuthority}:Props&{requestId:string;detailAuthority?:string}){
 const [before,setBefore]=useState<HrHistoryCursor|null>(null),[cursors,setCursors]=useState<(HrHistoryCursor|null)[]>([])
 const query=useAuthorizedLeaveRead(actorId,context,adminKeys.hrHistory(actorId,context.scopeVersion,target.id,requestId,before,50),signal=>fetchHrRequestHistory(target.id,context.scopeVersion,requestId,before,50,signal),target.capabilities.readPrivate,permitted)
 const fresh=readState==='ready'&&query.available&&query.data?.authorityKey===detailAuthority
 return <section aria-label="Riwayat privat permohonan" className="space-y-3 border-t pt-3">
  {readState!=='ready'?<p role="status">Memeriksa akses riwayat peristiwa...</p>:(query.isError||!fresh&&!query.isFetching)?<div role="alert"><p>Riwayat peristiwa belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void query.refetch()}>Muat ulang riwayat peristiwa</button></div>:!fresh?<p role="status">Memuat riwayat peristiwa...</p>:<>
   <h4 className="font-semibold">Riwayat peristiwa</h4>{!query.data?.rows.length&&<p>Belum ada peristiwa.</p>}
   <ul className="space-y-3">{query.data?.rows.map(row=><li key={row.id} className="border-b pb-2"><p>{events[row.event]} · <time dateTime={row.atTime}>{row.atTime}</time></p><p>{row.actor.name}</p>{row.reason&&<p className="whitespace-pre-wrap">{row.reason}</p>}{row.approverName&&<p>Penyetuju tercatat: {row.approverName}</p>}</li>)}</ul>
   <div className="flex flex-wrap gap-3"><button type="button" disabled={!cursors.length} onClick={()=>{setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}}>Riwayat peristiwa lebih baru</button><button type="button" disabled={query.data?.nextBefore==null} onClick={()=>{setCursors([...cursors,before]);setBefore(query.data!.nextBefore)}}>Riwayat peristiwa lebih lama</button></div>
  </>}
 </section>
}
function PrivateBalances({actorId,context,target,readState}:Props){
 const [selected,setSelected]=useState<string|null>(null),[history,setHistory]=useState<string|null>(null)
 const query=useAuthorizedLeaveRead(actorId,context,leaveKeys.private(actorId,context.scopeVersion,'admin','private-balances',target.id),signal=>fetchBalanceAccounts(target.id,signal),target.capabilities.readPrivate,permitted)
 const fresh=readState==='ready'&&query.available,account=query.data?.balances.find(row=>row.accountId===selected)??query.data?.balances.find(row=>row.year===query.data?.currentPeriod?.year)??query.data?.balances[0]
 return <section aria-label="Saldo privat anggota" className="space-y-3">
  {readState!=='ready'?<p role="status">Memeriksa akses saldo privat...</p>:(query.isError||!query.available&&!query.isFetching)?<div role="alert"><p>Saldo anggota belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void query.refetch()}>Muat ulang saldo anggota</button></div>:!fresh?<p role="status">Memuat saldo anggota...</p>:account?<>
   <label>Periode saldo anggota<select aria-label="Periode saldo anggota" value={account.accountId} onChange={event=>{setSelected(event.target.value);setHistory(null)}}>{query.data?.balances.map(row=><option key={row.accountId} value={row.accountId}>{row.year}</option>)}</select></label>
   <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Jatah',account.allowanceMinutes],['Disetujui',account.approvedMinutes],['Tertunda',account.pendingMinutes],['Tersedia',account.availableMinutes],['Kedaluwarsa',account.expiredMinutes]].map(([label,minutes])=><div key={label}><dt>{label}</dt><dd>{account.reconciled&&typeof minutes==='number'?formatLeaveMinutes(minutes):'Belum diverifikasi'}</dd></div>)}</dl>
   <button type="button" className="min-h-11 underline" onClick={()=>setHistory(history?null:account.accountId)}>{history?'Tutup riwayat saldo anggota':'Buka riwayat saldo anggota'}</button>
  </>:<p>Belum ada akun saldo anggota.</p>}
  {history&&<PrivateBalanceHistory key={history} actorId={actorId} context={context} target={target} readState={fresh?'ready':readState==='error'||query.isError?'error':'pending'} accountId={history}/>}
 </section>
}
function PrivateBalanceHistory({actorId,context,target,readState,accountId}:Props&{accountId:string}){
 const [before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([])
 const query=useAuthorizedLeaveRead(actorId,context,leaveKeys.private(actorId,context.scopeVersion,'admin','private-balance-history',target.id,accountId,before,50),signal=>fetchBalanceHistory(accountId,before,50,signal),target.capabilities.readPrivate,permitted)
 const labels:Record<string,string>={annual_grant:'Jatah tahunan',opening:'Saldo awal',adjustment:'Penyesuaian jatah',reservation:'Reservasi',approval:'Persetujuan',rejection:'Penolakan',withdrawal:'Penarikan',cancellation:'Pembatalan'}
 return <section aria-label="Riwayat saldo privat anggota" className="space-y-3">
  {readState!=='ready'?<p role="status">Memeriksa akses riwayat saldo...</p>:(query.isError||!query.available&&!query.isFetching)?<div role="alert"><p>Riwayat saldo anggota belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void query.refetch()}>Muat ulang riwayat saldo anggota</button></div>:!query.available?<p role="status">Memuat riwayat saldo anggota...</p>:<>
   {!query.data?.rows.length&&<p>Belum ada entri saldo.</p>}<ul className="space-y-2">{query.data?.rows.map(row=><li key={row.id}><p>{labels[row.kind]}</p><p>{row.date} · Jatah {formatSignedLeaveMinutes(row.allowanceDelta)} · Reservasi {formatSignedLeaveMinutes(row.reservedDelta)} · Pemakaian {formatSignedLeaveMinutes(row.usedDelta)}</p></li>)}</ul>
   <div className="flex flex-wrap gap-3"><button type="button" disabled={!cursors.length} onClick={()=>{setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}}>Saldo lebih baru</button><button type="button" disabled={query.data?.nextBefore==null} onClick={()=>{setCursors([...cursors,before]);setBefore(query.data!.nextBefore)}}>Saldo lebih lama</button></div>
  </>}
 </section>
}
