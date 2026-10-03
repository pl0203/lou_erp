import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import type { LeaveStatus } from '../../../lib/leave/contracts'
import type { OwnRequestSummary } from '../../../lib/leave/requestContracts'
import { fetchOwnLeaveHistory,fetchOwnLeaveRequest } from '../../../lib/leave/requestRpc'
import { ownRequestKeys } from '../../../lib/leave/requestHistoryKeys'
import { useOwnRequestAuthority } from '../../../lib/leave/useOwnRequestAuthority'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import OwnRequestActions from './OwnRequestActions'
import { discardLeaveDraftMessage } from './LeaveRequestForm'
import type { LeaveReadState } from './LeaveRequestForm'
const labels:Record<LeaveStatus,string>={submitted:'Menunggu persetujuan',approved:'Disetujui',rejected:'Ditolak',withdrawn:'Ditarik',cancellation_pending:'Pembatalan menunggu persetujuan',cancelled:'Dibatalkan'}
type Props={actorId:string;scopeVersion:string;readState:LeaveReadState;onDirtyChange?:(dirty:boolean)=>void}
export default function OwnLeaveHistory({actorId,scopeVersion,readState,onDirtyChange}:Props){
 const client=useQueryClient(),[before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([]),[selected,setSelected]=useState<OwnRequestSummary|null>(null)
 const dirty=useRef(false),report=useRef(onDirtyChange);report.current=onDirtyChange
 const changeDirty=useCallback((value:boolean)=>{dirty.current=value;report.current?.(value)},[])
 const guard=(action:()=>void)=>{if(!dirty.current||window.confirm(discardLeaveDraftMessage))action()}
 const opener=useRef<HTMLButtonElement|null>(null),authority=useOwnRequestAuthority(actorId,scopeVersion,JSON.stringify(['history',before])),key=ownRequestKeys.history(actorId,scopeVersion,before,25)
 const history=useQuery({queryKey:key,queryFn:({signal})=>fetchOwnLeaveHistory(before,25,signal),enabled:authority.ready&&readState==='ready',retry:false})
 useEffect(()=>{if(readState!=='ready'||!authority.ready)void client.cancelQueries({queryKey:key,exact:true})},[client,readState,authority.ready,JSON.stringify(key)])
 const visible=readState==='ready'&&authority.ready&&!history.isFetching&&!history.isPending&&!history.isError
 function closeDetail(){guard(()=>{setSelected(null);queueMicrotask(()=>opener.current?.focus())})}
 return <section aria-label="Riwayat pengajuan cuti" className="space-y-3 rounded-xl border bg-white p-4">
  <h2 className="font-semibold text-gray-900">Riwayat pengajuan cuti</h2>
  {readState!=='ready'?<p role="status">Memeriksa akses riwayat...</p>:authority.denied?<div role="alert"><p>Akses riwayat pengajuan belum dapat dikonfirmasi.</p><button type="button" onClick={authority.retry}>Coba lagi riwayat pengajuan</button></div>:!authority.ready||history.isFetching||history.isPending?<p role="status">Memuat riwayat pengajuan...</p>:history.isError?<div role="alert"><p>Riwayat pengajuan belum dapat dimuat.</p><button type="button" onClick={authority.retry}>Coba lagi riwayat pengajuan</button></div>:history.data&&<>
   {!history.data.rows.length&&<p>Belum ada pengajuan cuti.</p>}
   <ul className="space-y-3">{history.data.rows.map(row=><li key={row.id} className="space-y-1 border-b pb-3"><p>{row.startDate} sampai {row.endDate} · {formatLeaveMinutes(row.totalMinutes)}</p><p>{labels[row.status]}{row.sourceKind==='opening'&&<span className="ml-2">Saldo awal</span>}</p><button type="button" className="underline" aria-label={`Lihat rincian ${row.startDate} sampai ${row.endDate}`} onClick={event=>{const button=event.currentTarget;guard(()=>{opener.current=button;setSelected(row)})}}>Lihat rincian</button></li>)}</ul>
   <div className="flex gap-3"><button type="button" disabled={!cursors.length} onClick={()=>guard(()=>{setSelected(null);setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))})}>Pengajuan lebih baru</button><button type="button" disabled={history.data.nextBefore===null} onClick={()=>guard(()=>{setSelected(null);setCursors([...cursors,before]);setBefore(history.data!.nextBefore)})}>Pengajuan lebih lama</button></div>
  </>}
  {selected&&<OwnRequestDetail key={`${selected.id}:${selected.version}`} actorId={actorId} scopeVersion={scopeVersion} summary={selected} readState={visible?'ready':readState==='error'?'error':'pending'} onClose={closeDetail} onDirtyChange={changeDirty}/>}
 </section>
}
function OwnRequestDetail({actorId,scopeVersion,summary,readState,onClose,onDirtyChange}:Props&{summary:OwnRequestSummary;onClose:()=>void}){
 const client=useQueryClient(),authority=useOwnRequestAuthority(actorId,scopeVersion,JSON.stringify(['detail',summary.id,summary.version])),key=ownRequestKeys.detail(actorId,scopeVersion,summary.id,summary.version),heading=useRef<HTMLHeadingElement>(null)
 const detail=useQuery({queryKey:key,queryFn:({signal})=>fetchOwnLeaveRequest(summary.id,signal),enabled:authority.ready&&readState==='ready',retry:false})
 useEffect(()=>{if(readState!=='ready'||!authority.ready)void client.cancelQueries({queryKey:key,exact:true})},[client,readState,authority.ready,JSON.stringify(key)])
 const visible=readState==='ready'&&authority.ready&&!detail.isPending&&!detail.isFetching&&!detail.isError
 useLayoutEffect(()=>{if(visible)heading.current?.focus()},[visible])
 return <section aria-label="Rincian pengajuan cuti" className="space-y-3 border-t pt-4">
  <div className="flex justify-between gap-3"><h3 ref={heading} tabIndex={-1} className="font-semibold">Rincian pengajuan cuti</h3><button type="button" onClick={onClose}>Tutup rincian</button></div>
  {readState!=='ready'?<p role="status">Memeriksa akses rincian...</p>:authority.denied?<div role="alert"><p>Akses rincian belum dapat dikonfirmasi.</p><button type="button" onClick={authority.retry}>Coba lagi rincian</button></div>:!authority.ready||detail.isPending||detail.isFetching?<p role="status">Memuat rincian...</p>:detail.isError?<div role="alert"><p>Rincian pengajuan belum dapat dimuat.</p><button type="button" onClick={authority.retry}>Coba lagi rincian</button></div>:detail.data&&<>
   <p>{labels[detail.data.status]} · {detail.data.startDate} sampai {detail.data.endDate}</p>
   <p>Durasi: {detail.data.duration.mode==='full_scheduled_day'?'Sehari sesuai jadwal':formatLeaveMinutes(detail.data.duration.minutes)} · total {formatLeaveMinutes(detail.data.totalMinutes)}</p>
   <p>Penyetuju: <span>{detail.data.approverName}</span></p><div><h4 className="font-medium">Alasan pribadi</h4><p className="whitespace-pre-wrap">{detail.data.reason||'Tidak ada alasan yang diisi.'}</p></div>
   <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Tanggal cuti yang disimpan</caption><thead><tr><th>Tanggal</th><th>Jadwal</th><th>Keterangan</th><th>Potongan</th></tr></thead><tbody>{detail.data.days.map(day=><tr key={day.date}><th scope="row">{day.date}</th><td>{formatLeaveMinutes(day.scheduledMinutes)}</td><td>{day.exclusion==='holiday'?'Libur kalender':day.exclusion==='off_duty'?'Tidak bertugas':'Hari kerja'}{day.groupName&&<span className="block text-xs">{day.groupName}</span>}</td><td>{formatLeaveMinutes(day.chargedMinutes)}</td></tr>)}</tbody></table></div>
   <ul>{detail.data.allocations.map(allocation=><li key={allocation.year}>Periode {allocation.year}: {allocation.startDate} sampai sebelum {allocation.endDate} · {formatLeaveMinutes(allocation.chargedMinutes)}</li>)}</ul>
  </>}
  <OwnRequestActions actorId={actorId} scopeVersion={scopeVersion} requestId={summary.id} requestVersion={summary.version} readState={visible?'ready':readState==='error'?'error':'pending'} onDirtyChange={onDirtyChange}/>
 </section>
}
