import { RecordList } from '../../../components/ui/RecordList'
import { FormActions } from '../../../components/ui/FormActions'
import { StatusBadge, EmptyState } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import type { HrHistoryCursor,HrRequestEvent } from '../../../lib/leave/adminContracts'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import type { LeaveContext,LeaveStatus } from '../../../lib/leave/contracts'
import type { OwnRequestSummary } from '../../../lib/leave/requestContracts'
import { fetchOwnLeaveHistory,fetchOwnLeaveRequest,fetchOwnRequestEvents } from '../../../lib/leave/requestRpc'
import { ownRequestKeys } from '../../../lib/leave/requestHistoryKeys'
import { useOwnRequestAuthority } from '../../../lib/leave/useOwnRequestAuthority'
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
 const history=useQuery({queryKey:key,queryFn:({signal})=>fetchOwnLeaveHistory(before,25,signal),enabled:authority.ready&&readState==='ready',retry:false})
 useEffect(()=>{if(readState!=='ready'||!authority.ready)void client.cancelQueries({queryKey:key,exact:true})},[client,readState,authority.ready,JSON.stringify(key)])
 const visible=readState==='ready'&&authority.ready&&!history.isFetching&&!history.isPending&&!history.isError
 function closeDetail(){guard(()=>{setSelected(null);queueMicrotask(()=>opener.current?.focus())})}
 return <section aria-label="Riwayat pengajuan cuti" className="ui-section space-y-4">
  <h2 className="font-semibold text-brand-primary">Riwayat pengajuan cuti</h2>
  {readState!=='ready'?<p role="status" className="ui-notice ui-notice--info">Memeriksa akses riwayat...</p>:authority.denied?<div role="alert" className="ui-notice ui-notice--error"><p>Akses riwayat pengajuan belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={authority.retry} variant="secondary">Coba lagi riwayat pengajuan</Button></div>:!authority.ready||history.isFetching||history.isPending?<p role="status" className="ui-notice ui-notice--info">Memuat riwayat pengajuan...</p>:history.isError?<div role="alert" className="ui-notice ui-notice--error"><p>Riwayat pengajuan belum dapat dimuat.</p><Button size="compact" type="button" onClick={authority.retry} variant="secondary">Coba lagi riwayat pengajuan</Button></div>:history.data&&<>
   {!history.data.rows.length&&<EmptyState title="Belum ada pengajuan cuti."/>}
   <RecordList  label="Riwayat pengajuan">{history.data.rows.map(row=><li key={row.id} className="space-y-3 rounded-[14px] border border-brand-divider p-4"><div className="flex flex-wrap items-start justify-between gap-3"><p className="font-medium text-brand-primary">{row.startDate} sampai {row.endDate}</p><p className="font-semibold text-brand-primary">{formatLeaveMinutes(row.totalMinutes)}</p></div><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><StatusBadge tone={statusTones[row.status]} aria-label={`Status pengajuan: ${labels[row.status]}`}>{labels[row.status]}</StatusBadge>{row.sourceKind==='opening'&&<StatusBadge tone="neutral">Saldo awal</StatusBadge>}</div><button type="button" className="ui-action ui-action--quiet ui-action--compact" aria-label={`Lihat rincian ${row.startDate} sampai ${row.endDate}`} onClick={event=>{const button=event.currentTarget;guard(()=>{opener.current=button;setSelected(row)})}}>Lihat rincian</button></div></li>)}</RecordList>
   <FormActions ><Button size="compact" type="button" disabled={!cursors.length} onClick={()=>guard(()=>{setSelected(null);setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))})} variant="quiet">Pengajuan lebih baru</Button><Button size="compact" type="button" disabled={history.data.nextBefore===null} onClick={()=>guard(()=>{setSelected(null);setCursors([...cursors,before]);setBefore(history.data!.nextBefore)})} variant="quiet">Pengajuan lebih lama</Button></FormActions>
  </>}
  {selected&&<OwnRequestDetail key={`${selected.id}:${selected.version}`} actorId={actorId} scopeVersion={scopeVersion} context={context} summary={selected} readState={visible?'ready':readState==='error'?'error':'pending'} onClose={closeDetail} onDirtyChange={changeDirty}/>}
 </section>
}
function OwnRequestDetail({context,actorId,scopeVersion,summary,readState,onClose,onDirtyChange}:Props&{summary:OwnRequestSummary;onClose:()=>void}){
 const client=useQueryClient(),authority=useOwnRequestAuthority(actorId,scopeVersion,JSON.stringify(['detail',summary.id,summary.version])),key=ownRequestKeys.detail(actorId,scopeVersion,summary.id,summary.version),heading=useRef<HTMLHeadingElement>(null)
 const detail=useQuery({queryKey:key,queryFn:({signal})=>fetchOwnLeaveRequest(summary.id,signal),enabled:authority.ready&&readState==='ready',retry:false})
 useEffect(()=>{if(readState!=='ready'||!authority.ready)void client.cancelQueries({queryKey:key,exact:true})},[client,readState,authority.ready,JSON.stringify(key)])
 const visible=readState==='ready'&&authority.ready&&!detail.isPending&&!detail.isFetching&&!detail.isError
 useLayoutEffect(()=>{if(visible)heading.current?.focus()},[visible])
 return <section aria-label="Rincian pengajuan cuti" className="space-y-3 border-t pt-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 ref={heading} tabIndex={-1} className="font-semibold">Rincian pengajuan cuti</h3><Button size="compact" type="button" onClick={authority.retry} variant="secondary">Muat ulang rincian</Button><Button size="compact" type="button" onClick={onClose} variant="quiet">Tutup rincian</Button></div>
  {readState!=='ready'?<p role="status" className="ui-notice ui-notice--info">Memeriksa akses rincian...</p>:authority.denied?<div role="alert" className="ui-notice ui-notice--error"><p>Akses rincian belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={authority.retry} variant="secondary">Coba lagi rincian</Button></div>:!authority.ready||detail.isPending||detail.isFetching?<p role="status" className="ui-notice ui-notice--info">Memuat rincian...</p>:detail.isError?<div role="alert" className="ui-notice ui-notice--error"><p>Rincian pengajuan belum dapat dimuat.</p><Button size="compact" type="button" onClick={authority.retry} variant="secondary">Coba lagi rincian</Button></div>:detail.data&&<>
   <p>{labels[detail.data.status]} · {detail.data.startDate} sampai {detail.data.endDate}</p>
   <p>Durasi: {detail.data.duration.mode==='full_scheduled_day'?'Sehari sesuai jadwal':formatLeaveMinutes(detail.data.duration.minutes)} · total {formatLeaveMinutes(detail.data.totalMinutes)}</p>
   <p>Penyetuju: <span>{detail.data.approverName}</span></p><div><h4 className="font-medium">Alasan pribadi</h4><p className="whitespace-pre-wrap">{detail.data.reason||'Tidak ada alasan yang diisi.'}</p></div>
   <details className="rounded-[14px] border border-brand-divider px-4 py-2"><summary className="min-h-[var(--ui-control-size-compact)] cursor-pointer rounded py-[var(--ui-control-padding-y-compact)] text-[length:var(--ui-text-control)] leading-[var(--ui-line-control)] font-medium text-brand-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-primary">Rincian tanggal dan periode</summary><div className="space-y-3 py-2">
   <div role="region" aria-label="Tanggal cuti yang disimpan" tabIndex={0} className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Tanggal cuti yang disimpan</caption><thead><tr><th>Tanggal</th><th>Jadwal</th><th>Keterangan</th><th>Potongan</th></tr></thead><tbody>{detail.data.days.map(day=><tr key={day.date}><th scope="row">{day.date}</th><td>{formatLeaveMinutes(day.scheduledMinutes)}</td><td>{day.exclusion==='holiday'?'Libur kalender':day.exclusion==='off_duty'?'Tidak bertugas':'Hari kerja'}{day.groupName&&<span className="block text-[13px]">{day.groupName}</span>}</td><td>{formatLeaveMinutes(day.chargedMinutes)}</td></tr>)}</tbody></table></div>
   <ul>{detail.data.allocations.map(allocation=><li key={allocation.year}>Periode {allocation.year}: {allocation.startDate} sampai sebelum {allocation.endDate} · {formatLeaveMinutes(allocation.chargedMinutes)}</li>)}</ul>
   </div></details>
  </>}
  {detail.data&&<OwnRequestEvents key={`${actorId}:${scopeVersion}:${detail.data.id}:${detail.data.version}`} context={context} actorId={actorId} scopeVersion={scopeVersion} requestId={detail.data.id} version={detail.data.version} readState={visible?'ready':readState==='error'?'error':'pending'}/>}
  <OwnRequestActions actorId={actorId} scopeVersion={scopeVersion} requestId={summary.id} requestVersion={summary.version} readState={visible?'ready':readState==='error'?'error':'pending'} onDirtyChange={onDirtyChange}/>
 </section>
}

const eventLabels:Record<HrRequestEvent['event'],string>={submitted:'Pengajuan dikirim',opening_imported:'Riwayat saldo awal',approved:'Cuti disetujui',rejected:'Cuti ditolak',withdrawn:'Pengajuan ditarik',cancellation_requested:'Pembatalan diajukan',cancellation_accepted:'Pembatalan disetujui',cancellation_declined:'Pembatalan ditolak',reassigned:'Penyetuju dialihkan'}
function OwnRequestEvents({actorId,scopeVersion,context,requestId,version,readState}:Props&{requestId:string;version:number}){
 const client=useQueryClient(),[before,setBefore]=useState<HrHistoryCursor|null>(null),[cursors,setCursors]=useState<(HrHistoryCursor|null)[]>([])
 const key=ownRequestKeys.events(actorId,scopeVersion,requestId,version,before,25)
 const events=useAuthorizedLeaveRead(actorId,context,key,signal=>fetchOwnRequestEvents(requestId,version,scopeVersion,before,25,signal),true,live=>live.capabilities.request&&['employee','manager'].includes(live.memberKind??''))
 useEffect(()=>{if(readState==='error')void client.cancelQueries({queryKey:key,exact:true})},[client,readState,JSON.stringify(key)])
 const visible=readState==='ready'&&events.available&&events.isCurrent(events.data)
 return <section aria-label="Peristiwa permohonan cuti" className="space-y-3"><h4 className="font-semibold">Peristiwa permohonan</h4>
  {readState!=='ready'||events.isFetching?<p role="status" className="ui-notice ui-notice--info">Memeriksa peristiwa...</p>:!visible?<div role="alert" className="ui-notice ui-notice--error"><p>Peristiwa belum dapat dikonfirmasi. Muat ulang rincian bila versi berubah.</p><Button size="compact" type="button" onClick={()=>void events.refetch()} variant="secondary">Muat ulang peristiwa</Button></div>:events.data&&<>
   <ol className="space-y-3">{events.data.rows.map(event=><li key={event.id}><p>{eventLabels[event.event]}</p><p>{event.atTime} · {event.actor.name}</p>{event.approverName&&<p>Penyetuju: {event.approverName}</p>}{event.reason&&<p className="whitespace-pre-wrap">{event.reason}</p>}</li>)}</ol>
   <FormActions ><Button size="compact" type="button" disabled={!cursors.length} onClick={()=>{setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}} variant="quiet">Peristiwa lebih baru</Button><Button size="compact" type="button" disabled={!events.data.nextBefore} onClick={()=>{setCursors([...cursors,before]);setBefore(events.data!.nextBefore)}} variant="quiet">Peristiwa lebih lama</Button></FormActions>
  </>}
 </section>
}
