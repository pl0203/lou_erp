import { LoadingState } from '../../../components/ui/LoadingState'
import { RecordList } from '../../../components/ui/RecordList'
import { FormActions } from '../../../components/ui/FormActions'
import { StatusBadge, EmptyState } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import type { HrHistoryCursor,HrRequestEvent } from '../../../lib/leave/adminContracts'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LeaveContext,LeaveStatus } from '../../../lib/leave/contracts'
import type { OwnRequestSummary } from '../../../lib/leave/requestContracts'
import { fetchOwnLeaveHistory,fetchOwnLeaveRequest,fetchOwnRequestEvents } from '../../../lib/leave/requestRpc'
import { ownRequestKeys } from '../../../lib/leave/requestHistoryKeys'
import { useOwnRequestAuthority,useOwnRequestRead } from '../../../lib/leave/useOwnRequestAuthority'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import OwnRequestActions from './OwnRequestActions'
import { discardLeaveDraftMessage } from './LeaveRequestForm'
import type { LeaveReadState } from './LeaveRequestForm'
const labels:Record<LeaveStatus,string>={submitted:'Menunggu persetujuan',approved:'Disetujui',rejected:'Ditolak',withdrawn:'Ditarik',cancellation_pending:'Pembatalan menunggu persetujuan',cancelled:'Dibatalkan'}
const statusTones:Record<LeaveStatus,'neutral'|'success'|'warning'|'error'>={submitted:'warning',approved:'success',rejected:'error',withdrawn:'neutral',cancellation_pending:'warning',cancelled:'neutral'}
type Props={context:LeaveContext;actorId:string;scopeVersion:string;readState:LeaveReadState;onDirtyChange?:(dirty:boolean)=>void}
export default function OwnLeaveHistory({context,actorId,scopeVersion,readState,onDirtyChange}:Props){
 const client=useQueryClient(),[before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([]),[selected,setSelected]=useState<OwnRequestSummary|null>(null)
 const dirty=useRef(false),report=useRef(onDirtyChange);report.current=onDirtyChange
 const changeDirty=useCallback((value:boolean)=>{dirty.current=value;report.current?.(value)},[])
 const guard=(action:()=>void)=>{if(!dirty.current||window.confirm(discardLeaveDraftMessage))action()}
 const opener=useRef<HTMLButtonElement|null>(null),authority=useOwnRequestAuthority(actorId,scopeVersion,JSON.stringify(['history',before])),key=ownRequestKeys.history(actorId,scopeVersion,before,25)
 const history=useOwnRequestRead(authority,key,signal=>fetchOwnLeaveHistory(before,25,signal),readState==='ready',readState==='error')
 useEffect(()=>{if(readState==='error')void client.cancelQueries({queryKey:key,exact:true})},[client,readState,authority.ready,JSON.stringify(key)])
 const visible=readState==='ready'&&history.available
 const navigationReady=useRef(visible);navigationReady.current=visible
 const shown=(readState==='ready'||readState==='refreshing')?history.displayData:undefined
 function closeDetail(){guard(()=>{setSelected(null);queueMicrotask(()=>opener.current?.focus())})}
 return <section aria-label="Riwayat pengajuan cuti" className="ui-section space-y-4">
  <h2 className="font-semibold text-brand-primary">Riwayat pengajuan cuti</h2>
  {readState!=='ready'&&!shown?<LoadingState title="Memeriksa akses riwayat..." shape="compact" className="ui-notice ui-notice--info" />:authority.denied&&!shown?<div role="alert" className="ui-notice ui-notice--error"><p>Akses riwayat pengajuan belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={authority.retry} variant="secondary">Coba lagi riwayat pengajuan</Button></div>:!shown&&!authority.denied&&!history.isError?<LoadingState title="Memuat riwayat pengajuan..." shape="list" className="ui-notice ui-notice--info" />:history.isError?<div role="alert" className="ui-notice ui-notice--error"><p>Riwayat pengajuan belum dapat dimuat.</p><Button size="compact" type="button" onClick={authority.retry} variant="secondary">Coba lagi riwayat pengajuan</Button></div>:shown&&<>
   {!shown.rows.length&&<EmptyState title="Belum ada pengajuan cuti."/>}
   <RecordList  label="Riwayat pengajuan">{shown.rows.map(row=><li key={row.id} className="space-y-3 rounded-[14px] border border-brand-divider p-4"><div className="flex flex-wrap items-start justify-between gap-3"><p className="font-medium text-brand-primary">{row.startDate} sampai {row.endDate}</p><p className="font-semibold text-brand-primary">{formatLeaveMinutes(row.totalMinutes)}</p></div><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><StatusBadge tone={statusTones[row.status]} aria-label={`Status pengajuan: ${labels[row.status]}`}>{labels[row.status]}</StatusBadge>{row.sourceKind==='opening'&&<StatusBadge tone="neutral">Saldo awal</StatusBadge>}</div><button type="button" disabled={!visible} className="ui-action ui-action--quiet ui-action--compact" aria-label={`Lihat rincian ${row.startDate} sampai ${row.endDate}`} onClick={event=>{if(!navigationReady.current)return;const button=event.currentTarget;guard(()=>{opener.current=button;setSelected(row)})}}>Lihat rincian</button></div></li>)}</RecordList>
   <FormActions ><Button size="compact" type="button" disabled={!visible||!cursors.length} onClick={()=>{if(!navigationReady.current)return;guard(()=>{setSelected(null);setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))})}} variant="quiet">Pengajuan lebih baru</Button><Button size="compact" type="button" disabled={!visible||shown.nextBefore===null} onClick={()=>{if(!navigationReady.current)return;guard(()=>{setSelected(null);setCursors([...cursors,before]);setBefore(history.data!.nextBefore)})}} variant="quiet">Pengajuan lebih lama</Button></FormActions>
  </>}
  {selected&&<OwnRequestDetail key={`${selected.id}:${selected.version}`} actorId={actorId} scopeVersion={scopeVersion} context={context} summary={selected} readState={visible?'ready':shown?'refreshing':readState==='error'||!history.displayAllowed?'error':'pending'} onClose={closeDetail} onDirtyChange={changeDirty}/>}
 </section>
}
function OwnRequestDetail({context,actorId,scopeVersion,summary,readState,onClose,onDirtyChange}:Props&{summary:OwnRequestSummary;onClose:()=>void}){
 const client=useQueryClient(),authority=useOwnRequestAuthority(actorId,scopeVersion,JSON.stringify(['detail',summary.id,summary.version])),key=ownRequestKeys.detail(actorId,scopeVersion,summary.id,summary.version),heading=useRef<HTMLHeadingElement>(null),focused=useRef(false)
 const detail=useOwnRequestRead(authority,key,signal=>fetchOwnLeaveRequest(summary.id,signal),readState==='ready',readState==='error')
 useEffect(()=>{if(readState==='error')void client.cancelQueries({queryKey:key,exact:true})},[client,readState,authority.ready,JSON.stringify(key)])
 const visible=readState==='ready'&&detail.available
 const shown=(readState==='ready'||readState==='refreshing')?detail.displayData:undefined
 useLayoutEffect(()=>{if(visible&&!focused.current){focused.current=true;heading.current?.focus()}},[visible])
 return <section aria-label="Rincian pengajuan cuti" className="space-y-3 border-t pt-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 ref={heading} tabIndex={-1} className="font-semibold">Rincian pengajuan cuti</h3><Button size="compact" type="button" disabled={!visible} onClick={authority.retry} variant="secondary">Muat ulang rincian</Button><Button size="compact" type="button" onClick={onClose} variant="quiet">Tutup rincian</Button></div>
  {readState!=='ready'&&!shown?<LoadingState title="Memeriksa akses rincian..." shape="compact" className="ui-notice ui-notice--info" />:authority.denied&&!shown?<div role="alert" className="ui-notice ui-notice--error"><p>Akses rincian belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={authority.retry} variant="secondary">Coba lagi rincian</Button></div>:!shown&&!authority.denied&&!detail.isError?<LoadingState title="Memuat rincian..." shape="compact" className="ui-notice ui-notice--info" />:detail.isError?<div role="alert" className="ui-notice ui-notice--error"><p>Rincian pengajuan belum dapat dimuat.</p><Button size="compact" type="button" onClick={authority.retry} variant="secondary">Coba lagi rincian</Button></div>:shown&&<>
   <p>{labels[shown.status]} · {shown.startDate} sampai {shown.endDate}</p>
   <p>Durasi: {shown.duration.mode==='full_scheduled_day'?'Sehari sesuai jadwal':formatLeaveMinutes(shown.duration.minutes)} · total {formatLeaveMinutes(shown.totalMinutes)}</p>
   <p>Penyetuju: <span>{shown.approverName}</span></p><div><h4 className="font-medium">Alasan pribadi</h4><p className="whitespace-pre-wrap">{shown.reason||'Tidak ada alasan yang diisi.'}</p></div>
   <details className="rounded-[14px] border border-brand-divider px-4 py-2"><summary className="min-h-[var(--ui-control-size-compact)] cursor-pointer rounded py-[var(--ui-control-padding-y-compact)] text-[length:var(--ui-text-control)] leading-[var(--ui-line-control)] font-medium text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-primary">Rincian tanggal dan periode</summary><div className="space-y-3 py-2">
   <div role="region" aria-label="Tanggal cuti yang disimpan" tabIndex={0} className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Tanggal cuti yang disimpan</caption><thead><tr><th>Tanggal</th><th>Jadwal</th><th>Keterangan</th><th>Potongan</th></tr></thead><tbody>{shown.days.map(day=><tr key={day.date}><th scope="row">{day.date}</th><td>{formatLeaveMinutes(day.scheduledMinutes)}</td><td>{day.exclusion==='holiday'?'Libur kalender':day.exclusion==='off_duty'?'Tidak bertugas':'Hari kerja'}{day.groupName&&<span className="block text-[13px]">{day.groupName}</span>}</td><td>{formatLeaveMinutes(day.chargedMinutes)}</td></tr>)}</tbody></table></div>
   <ul>{shown.allocations.map(allocation=><li key={allocation.year}>Periode {allocation.year}: {allocation.startDate} sampai sebelum {allocation.endDate} · {formatLeaveMinutes(allocation.chargedMinutes)}</li>)}</ul>
   </div></details>
  </>}
  {detail.displayData&&<OwnRequestEvents key={`${actorId}:${scopeVersion}:${detail.displayData.id}:${detail.displayData.version}`} context={context} actorId={actorId} scopeVersion={scopeVersion} requestId={detail.displayData.id} version={detail.displayData.version} readState={visible?'ready':shown?'refreshing':readState==='error'||!detail.displayAllowed?'error':'pending'}/>}
  <OwnRequestActions actorId={actorId} scopeVersion={scopeVersion} requestId={summary.id} requestVersion={summary.version} readState={visible?'ready':shown?'refreshing':readState==='error'||!detail.displayAllowed?'error':'pending'} onDirtyChange={onDirtyChange}/>
 </section>
}

const eventLabels:Record<HrRequestEvent['event'],string>={submitted:'Pengajuan dikirim',opening_imported:'Riwayat saldo awal',approved:'Cuti disetujui',rejected:'Cuti ditolak',withdrawn:'Pengajuan ditarik',cancellation_requested:'Pembatalan diajukan',cancellation_accepted:'Pembatalan disetujui',cancellation_declined:'Pembatalan ditolak',reassigned:'Penyetuju dialihkan'}
function OwnRequestEvents({actorId,scopeVersion,context,requestId,version,readState}:Props&{requestId:string;version:number}){
 const client=useQueryClient(),[before,setBefore]=useState<HrHistoryCursor|null>(null),[cursors,setCursors]=useState<(HrHistoryCursor|null)[]>([])
 const key=ownRequestKeys.events(actorId,scopeVersion,requestId,version,before,25)
 const events=useAuthorizedLeaveRead(actorId,context,key,signal=>fetchOwnRequestEvents(requestId,version,scopeVersion,before,25,signal),true,live=>live.capabilities.request&&['employee','manager'].includes(live.memberKind??''))
 useEffect(()=>{if(readState==='error')void client.cancelQueries({queryKey:key,exact:true})},[client,readState,JSON.stringify(key)])
 const visible=readState==='ready'&&events.available&&events.isCurrent(events.data)
 const shown=(readState==='ready'||readState==='refreshing')?events.displayData:undefined
 return <section aria-label="Peristiwa permohonan cuti" className="space-y-3"><h4 className="font-semibold">Peristiwa permohonan</h4>
  {!shown&&(readState!=='ready'||events.isFetching)?<LoadingState title="Memeriksa peristiwa..." shape="compact" className="ui-notice ui-notice--info" />:!shown?<div role="alert" className="ui-notice ui-notice--error"><p>Peristiwa belum dapat dikonfirmasi. Muat ulang rincian bila versi berubah.</p><Button size="compact" type="button" onClick={()=>void events.refetch()} variant="secondary">Muat ulang peristiwa</Button></div>:shown&&<>
   <ol className="space-y-3">{shown.rows.map(event=><li key={event.id}><p>{eventLabels[event.event]}</p><p>{event.atTime} · {event.actor.name}</p>{event.approverName&&<p>Penyetuju: {event.approverName}</p>}{event.reason&&<p className="whitespace-pre-wrap">{event.reason}</p>}</li>)}</ol>
   <FormActions ><Button size="compact" type="button" disabled={!visible||!cursors.length} onClick={()=>{setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}} variant="quiet">Peristiwa lebih baru</Button><Button size="compact" type="button" disabled={!visible||!shown.nextBefore} onClick={()=>{setCursors([...cursors,before]);setBefore(events.data!.nextBefore)}} variant="quiet">Peristiwa lebih lama</Button></FormActions>
  </>}
 </section>
}
