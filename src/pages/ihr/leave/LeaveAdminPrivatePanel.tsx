import { LoadingState } from '../../../components/ui/LoadingState'
import { RecordList } from '../../../components/ui/RecordList'
import { FormActions } from '../../../components/ui/FormActions'
import { EmptyState } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { useId, useEffect, useRef, useState  } from 'react'
import type { LeaveContext, LeaveStatus } from '../../../lib/leave/contracts'
import type { HrHistoryCursor, LeaveAdminTarget } from '../../../lib/leave/adminContracts'
import { fetchHrRequest, fetchHrRequestHistory, fetchHrRequests } from '../../../lib/leave/adminRpc'
import { adminKeys } from '../../../lib/leave/adminQueryKeys'
import { fetchBalanceAccounts, fetchBalanceHistory, formatSignedLeaveMinutes } from '../../../lib/leave/accountRpc'
import { leaveKeys } from '../../../lib/leave/queryKeys'
import { useQueryClient } from '@tanstack/react-query'
import { useLeaveDisplayAuthority } from '../../../lib/leave/useLeaveContext'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import type { LeaveReadState } from './LeaveRequestForm'
type Props={actorId:string;context:LeaveContext;target:LeaveAdminTarget;readState:LeaveReadState}
const permitted=(context:LeaveContext)=>context.memberKind!=='director'&&context.capabilities.readPrivate
const statuses:Record<LeaveStatus,string>={submitted:'Menunggu persetujuan',approved:'Disetujui',rejected:'Ditolak',withdrawn:'Ditarik',cancellation_pending:'Pembatalan menunggu persetujuan',cancelled:'Dibatalkan'}
const events:Record<string,string>={submitted:'Diajukan',opening_imported:'Saldo awal dicatat',approved:'Disetujui',rejected:'Ditolak',withdrawn:'Ditarik',cancellation_requested:'Pembatalan diminta',cancellation_accepted:'Pembatalan disetujui',cancellation_declined:'Pembatalan ditolak',reassigned:'Penugasan dialihkan'}
export default function LeaveAdminPrivatePanel(props:Props){
 const displayAuthority=useLeaveDisplayAuthority(useQueryClient(),props.actorId)
 const navigationReady=props.readState==='ready'&&!displayAuthority.refreshing
 const currentNavigation=useRef(navigationReady);currentNavigation.current=navigationReady
 const [mode,setMode]=useState<'requests'|'balances'>('requests')
 return <section aria-label="Tinjauan privat anggota" className="space-y-4">
  {(props.readState==='ready'||props.readState==='refreshing')&&<nav aria-label="Data privat anggota" className="flex flex-wrap gap-3"><Button size="compact" type="button" aria-pressed={mode==='requests'} variant="quiet" className={mode==='requests'?'border-brand-primary bg-brand-tint':''} disabled={!navigationReady} onClick={()=>{if(currentNavigation.current)setMode('requests')}}>Permohonan anggota</Button><Button size="compact" type="button" aria-pressed={mode==='balances'} variant="quiet" className={mode==='balances'?'border-brand-primary bg-brand-tint':''} disabled={!navigationReady} onClick={()=>{if(currentNavigation.current)setMode('balances')}}>Saldo dan riwayat anggota</Button></nav>}
  {mode==='requests'?<PrivateRequests {...props}/>:<PrivateBalances {...props}/>}
 </section>
}
function PrivateRequests({actorId,context,target,readState}:Props){
 const [before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([]),[selected,setSelected]=useState<string|null>(null)
 const query=useAuthorizedLeaveRead(actorId,context,adminKeys.hrRequests(actorId,context.scopeVersion,target.id,before,50),signal=>fetchHrRequests(target.id,context.scopeVersion,before,50,signal),target.capabilities.readPrivate,permitted)
 const displayAuthority=useLeaveDisplayAuthority(useQueryClient(),actorId)
 const navigationReady=readState==='ready'&&!displayAuthority.refreshing
 const fresh=readState==='ready'&&query.available
 const currentNavigation=useRef(false);currentNavigation.current=fresh&&navigationReady
 const shown=(readState==='ready'||readState==='refreshing')?query.displayData:undefined
 return <section aria-label="Permohonan privat anggota" className="space-y-3">
  {readState!=='ready'&&!shown?<LoadingState title="Memeriksa akses tinjauan privat..." shape="compact" className="ui-notice ui-notice--info" />:(!shown&&(query.isError||!query.available&&!query.isFetching))?<div role="alert" className="ui-notice ui-notice--error"><p>Permohonan privat belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={()=>void query.refetch()} variant="secondary">Muat ulang permohonan privat</Button></div>:!shown?<LoadingState title="Memuat permohonan privat..." shape="compact" className="ui-notice ui-notice--info" />:<>
   <h3 className="font-semibold">Permohonan anggota dalam lingkup Anda</h3>
   {!shown?.rows.length&&<EmptyState title="Belum ada permohonan anggota."/>}
   <RecordList  label="Permohonan privat anggota">{shown?.rows.map(row=><li key={row.id} className="rounded border bg-white p-3"><p>{row.startDate} sampai {row.endDate} · {formatLeaveMinutes(row.totalMinutes)}</p><p>{statuses[row.status]}</p><Button size="compact" type="button" variant="quiet" className="underline" aria-label={`Tinjau pengajuan ${row.startDate} sampai ${row.endDate}`} disabled={!fresh||!navigationReady} onClick={()=>{if(currentNavigation.current&&query.isCurrent())setSelected(row.id)}}>Buka rincian privat</Button></li>)}</RecordList>
   <FormActions ><Button size="compact" type="button" disabled={!fresh||!navigationReady||!cursors.length} onClick={()=>{if(!currentNavigation.current||!query.isCurrent())return;setSelected(null);setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}} variant="quiet">Permohonan privat lebih baru</Button><Button size="compact" type="button" disabled={!fresh||!navigationReady||shown?.nextBefore==null} onClick={()=>{if(!currentNavigation.current||!query.isCurrent())return;setSelected(null);setCursors([...cursors,before]);setBefore(query.data!.nextBefore)}} variant="quiet">Permohonan privat lebih lama</Button></FormActions>
  </>}
  {selected&&<PrivateDetail key={selected} actorId={actorId} context={context} target={target} readState={fresh?'ready':shown?'refreshing':readState==='error'||query.isError||!query.displayAllowed?'error':'pending'} requestId={selected} listAuthority={shown?.authorityKey} onClose={()=>setSelected(null)}/>}
 </section>
}
function PrivateDetail({actorId,context,target,readState,requestId,listAuthority,onClose}:Props&{requestId:string;listAuthority?:string;onClose:()=>void}){
 const query=useAuthorizedLeaveRead(actorId,context,adminKeys.hrRequest(actorId,context.scopeVersion,target.id,requestId),signal=>fetchHrRequest(target.id,context.scopeVersion,requestId,signal),target.capabilities.readPrivate,permitted)
 const displayAuthority=useLeaveDisplayAuthority(useQueryClient(),actorId)
 const navigationReady=readState==='ready'&&!displayAuthority.refreshing
 const fresh=readState==='ready'&&query.available&&query.data?.authorityKey===listAuthority,heading=useRef<HTMLHeadingElement>(null)
 const currentNavigation=useRef(false);currentNavigation.current=fresh&&navigationReady
 const shown=(readState==='ready'||readState==='refreshing')&&query.displayData?.authorityKey===listAuthority?query.displayData:undefined
 const focused=useRef(false)
 useEffect(()=>{if(fresh&&!focused.current){focused.current=true;heading.current?.focus()}},[fresh])
 return <section aria-label="Rincian privat anggota" className="ui-section space-y-3">
  {(readState==='ready'||readState==='refreshing')&&<Button disabled={!fresh||!navigationReady} size="compact" type="button" variant="quiet" className="underline" onClick={()=>{if(currentNavigation.current&&query.isCurrent())onClose()}}>Tutup rincian privat</Button>}
  {(query.isError||!fresh&&!query.isFetching)&&readState==='ready'?<div role="alert" className="ui-notice ui-notice--error"><p>Rincian privat belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={()=>void query.refetch()} variant="secondary">Muat ulang rincian privat</Button></div>:!shown?<LoadingState title="Memeriksa rincian privat..." shape="compact" className="ui-notice ui-notice--info" />:shown&&<>
   <h3 ref={heading} tabIndex={-1} className="font-semibold">Rincian permohonan anggota</h3><p>{statuses[shown.request.status]} · {shown.request.startDate} sampai {shown.request.endDate}</p><p>{shown.request.reason||'Tidak ada alasan yang diisi.'}</p><p>Penyetuju asal: {shown.request.approverName}</p>
   <div role="region" aria-label="Tanggal dan potongan yang disimpan" tabIndex={0} className="overflow-x-auto"><table className="w-full text-left"><caption>Tanggal dan potongan yang disimpan</caption><thead><tr><th>Tanggal</th><th>Jadwal asal</th><th>Potongan</th><th>Keterangan</th></tr></thead><tbody>{shown.request.days.map(day=><tr key={day.date}><th scope="row">{day.date}</th><td>{formatLeaveMinutes(day.scheduledMinutes)}</td><td>{formatLeaveMinutes(day.chargedMinutes)}</td><td>{day.exclusion==='holiday'?'Libur kalender':day.exclusion==='off_duty'?'Tidak bertugas':'Hari kerja'}{day.groupName&&` · ${day.groupName}`}</td></tr>)}</tbody></table></div>
   <ul>{shown.request.allocations.map(allocation=><li key={allocation.year}>Periode {allocation.year}: {allocation.startDate} sampai sebelum {allocation.endDate} · {formatLeaveMinutes(allocation.chargedMinutes)}</li>)}</ul>
  </>}
  <PrivateHistory actorId={actorId} context={context} target={target} readState={fresh?'ready':shown?'refreshing':readState==='error'||query.isError||!query.displayAllowed?'error':'pending'} requestId={requestId} detailAuthority={shown?.authorityKey}/>
 </section>
}
function PrivateHistory({actorId,context,target,readState,requestId,detailAuthority}:Props&{requestId:string;detailAuthority?:string}){
 const [before,setBefore]=useState<HrHistoryCursor|null>(null),[cursors,setCursors]=useState<(HrHistoryCursor|null)[]>([])
 const query=useAuthorizedLeaveRead(actorId,context,adminKeys.hrHistory(actorId,context.scopeVersion,target.id,requestId,before,50),signal=>fetchHrRequestHistory(target.id,context.scopeVersion,requestId,before,50,signal),target.capabilities.readPrivate,permitted)
 const displayAuthority=useLeaveDisplayAuthority(useQueryClient(),actorId)
 const navigationReady=readState==='ready'&&!displayAuthority.refreshing
 const fresh=readState==='ready'&&query.available&&query.data?.authorityKey===detailAuthority
 const currentNavigation=useRef(false);currentNavigation.current=fresh&&navigationReady
 const shown=(readState==='ready'||readState==='refreshing')&&query.displayData?.authorityKey===detailAuthority?query.displayData:undefined
 return <section aria-label="Riwayat privat permohonan" className="space-y-3 border-t pt-3">
  {readState!=='ready'&&!shown?<LoadingState title="Memeriksa akses riwayat peristiwa..." shape="compact" className="ui-notice ui-notice--info" />:(!shown&&(query.isError||!fresh&&!query.isFetching))?<div role="alert" className="ui-notice ui-notice--error"><p>Riwayat peristiwa belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={()=>void query.refetch()} variant="secondary">Muat ulang riwayat peristiwa</Button></div>:!shown?<LoadingState title="Memuat riwayat peristiwa..." shape="list" className="ui-notice ui-notice--info" />:<>
   <h4 className="font-semibold">Riwayat peristiwa</h4>{!shown?.rows.length&&<EmptyState title="Belum ada peristiwa."/>}
   <ul className="space-y-3">{shown?.rows.map(row=><li key={row.id} className="border-b pb-2"><p>{events[row.event]} · <time dateTime={row.atTime}>{row.atTime}</time></p><p>{row.actor.name}</p>{row.reason&&<p className="whitespace-pre-wrap">{row.reason}</p>}{row.approverName&&<p>Penyetuju tercatat: {row.approverName}</p>}</li>)}</ul>
   <FormActions ><Button size="compact" type="button" disabled={!fresh||!navigationReady||!cursors.length} onClick={()=>{if(!currentNavigation.current||!query.isCurrent())return;setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}} variant="quiet">Riwayat peristiwa lebih baru</Button><Button size="compact" type="button" disabled={!fresh||!navigationReady||shown?.nextBefore==null} onClick={()=>{if(!currentNavigation.current||!query.isCurrent())return;setCursors([...cursors,before]);setBefore(query.data!.nextBefore)}} variant="quiet">Riwayat peristiwa lebih lama</Button></FormActions>
  </>}
 </section>
}
function PrivateBalances({actorId,context,target,readState}:Props){
 const fieldId=useId()
 const [selected,setSelected]=useState<string|null>(null),[history,setHistory]=useState<string|null>(null)
 const query=useAuthorizedLeaveRead(actorId,context,leaveKeys.private(actorId,context.scopeVersion,'admin','private-balances',target.id),signal=>fetchBalanceAccounts(target.id,signal),target.capabilities.readPrivate,permitted)
 const displayAuthority=useLeaveDisplayAuthority(useQueryClient(),actorId)
 const navigationReady=readState==='ready'&&!displayAuthority.refreshing
 const fresh=readState==='ready'&&query.available
 const currentNavigation=useRef(false);currentNavigation.current=fresh&&navigationReady
 const shown=(readState==='ready'||readState==='refreshing')?query.displayData:undefined
 const account=shown?.balances.find(row=>row.accountId===selected)??shown?.balances.find(row=>row.year===shown?.currentPeriod?.year)??shown?.balances[0]
 return <section aria-label="Saldo privat anggota" className="space-y-3">
  {readState!=='ready'&&!shown?<LoadingState title="Memeriksa akses saldo privat..." shape="compact" className="ui-notice ui-notice--info" />:(!shown&&(query.isError||!query.available&&!query.isFetching))?<div role="alert" className="ui-notice ui-notice--error"><p>Saldo anggota belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={()=>void query.refetch()} variant="secondary">Muat ulang saldo anggota</Button></div>:!shown?<LoadingState title="Memuat saldo anggota..." shape="compact" className="ui-notice ui-notice--info" />:account?<>
   <Field id={`${fieldId}-1`} label="Periode saldo anggota">{control=><select {...control} aria-label="Periode saldo anggota" value={account.accountId} disabled={!fresh||!navigationReady} onChange={event=>{if(!currentNavigation.current||!query.isCurrent())return;setSelected(event.target.value);setHistory(null)}}>{shown?.balances.map(row=><option key={row.accountId} value={row.accountId}>{row.year}</option>)}</select>}</Field>
   <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Jatah',account.allowanceMinutes],['Disetujui',account.approvedMinutes],['Tertunda',account.pendingMinutes],['Tersedia',account.availableMinutes],['Kedaluwarsa',account.expiredMinutes]].map(([label,minutes])=><div key={label}><dt>{label}</dt><dd>{account.reconciled&&typeof minutes==='number'?formatLeaveMinutes(minutes):'Belum diverifikasi'}</dd></div>)}</dl>
   <Button size="compact" type="button" variant="quiet" className="underline" disabled={!fresh||!navigationReady} onClick={()=>{if(currentNavigation.current&&query.isCurrent())setHistory(history?null:account.accountId)}}>{history?'Tutup riwayat saldo anggota':'Buka riwayat saldo anggota'}</Button>
  </>:<EmptyState title="Belum ada akun saldo anggota."/>}
  {history&&<PrivateBalanceHistory key={history} actorId={actorId} context={context} target={target} readState={fresh?'ready':shown?'refreshing':readState==='error'||query.isError||!query.displayAllowed?'error':'pending'} accountId={history}/>}
 </section>
}
function PrivateBalanceHistory({actorId,context,target,readState,accountId}:Props&{accountId:string}){
 const [before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([])
 const query=useAuthorizedLeaveRead(actorId,context,leaveKeys.private(actorId,context.scopeVersion,'admin','private-balance-history',target.id,accountId,before,50),signal=>fetchBalanceHistory(accountId,before,50,signal),target.capabilities.readPrivate,permitted)
 const displayAuthority=useLeaveDisplayAuthority(useQueryClient(),actorId)
 const navigationReady=readState==='ready'&&!displayAuthority.refreshing
 const fresh=readState==='ready'&&query.available
 const currentNavigation=useRef(false);currentNavigation.current=fresh&&navigationReady
 const shown=(readState==='ready'||readState==='refreshing')?query.displayData:undefined
 const labels:Record<string,string>={annual_grant:'Jatah tahunan',opening:'Saldo awal',adjustment:'Penyesuaian jatah',reservation:'Reservasi',approval:'Persetujuan',rejection:'Penolakan',withdrawal:'Penarikan',cancellation:'Pembatalan'}
 return <section aria-label="Riwayat saldo privat anggota" className="space-y-3">
  {readState!=='ready'&&!shown?<LoadingState title="Memeriksa akses riwayat saldo..." shape="compact" className="ui-notice ui-notice--info" />:(!shown&&(query.isError||!query.available&&!query.isFetching))?<div role="alert" className="ui-notice ui-notice--error"><p>Riwayat saldo anggota belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={()=>void query.refetch()} variant="secondary">Muat ulang riwayat saldo anggota</Button></div>:!shown?<LoadingState title="Memuat riwayat saldo anggota..." shape="list" className="ui-notice ui-notice--info" />:<>
   {!shown?.rows.length&&<EmptyState title="Belum ada entri saldo."/>}<ul className="space-y-2">{shown?.rows.map(row=><li key={row.id}><p>{labels[row.kind]}</p><p>{row.date} · Jatah {formatSignedLeaveMinutes(row.allowanceDelta)} · Reservasi {formatSignedLeaveMinutes(row.reservedDelta)} · Pemakaian {formatSignedLeaveMinutes(row.usedDelta)}</p></li>)}</ul>
   <FormActions ><Button size="compact" type="button" disabled={!fresh||!navigationReady||!cursors.length} onClick={()=>{if(!currentNavigation.current||!query.isCurrent())return;setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}} variant="quiet">Saldo lebih baru</Button><Button size="compact" type="button" disabled={!fresh||!navigationReady||shown?.nextBefore==null} onClick={()=>{if(!currentNavigation.current||!query.isCurrent())return;setCursors([...cursors,before]);setBefore(query.data!.nextBefore)}} variant="quiet">Saldo lebih lama</Button></FormActions>
  </>}
 </section>
}
