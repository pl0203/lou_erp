import { LoadingState } from '../../../components/ui/LoadingState'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/Feedback'
import type { LeaveContext, LeaveStatus } from '../../../lib/leave/contracts'
import { leaveKeys } from '../../../lib/leave/queryKeys'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { fetchDirectorRequests } from '../../../lib/leave/directorRpc'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import './director-leave-overview.css'
type Props={actorId:string;context:LeaveContext;readState?:'ready'|'pending'|'error'}
const labels:Record<LeaveStatus,string>={submitted:'Menunggu persetujuan',approved:'Disetujui',rejected:'Ditolak',withdrawn:'Ditarik',cancellation_pending:'Menunggu pembatalan',cancelled:'Dibatalkan'}
export default function DirectorLeaveOverview(props:Props){return props.context.memberKind==='director'?<Overview key={`${props.actorId}:${props.context.scopeVersion}`} {...props}/>:null}
function Overview({actorId,context,readState='ready'}:Props){
 const [before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([])
 // The hook independently refreshes authority. Do not disable it during shared
 // context refresh or it would restart its own authority/read cycle.
 const requests=useAuthorizedLeaveRead(actorId,context,leaveKeys.private(actorId,context.scopeVersion,'director-overview',before,25),signal=>fetchDirectorRequests(before,signal),true,live=>live.memberKind==='director')
 return <section aria-label="Ringkasan cuti seluruh karyawan" className="space-y-4">
  <h2 className="font-semibold text-brand-primary">Ringkasan Cuti</h2>
  <p>Seluruh anggota cuti karyawan dan manajer yang aktif. Hanya untuk dilihat; keputusan tetap melalui penyetuju yang ditugaskan.</p>
  <p>Alasan pribadi dan saldo cuti tidak ditampilkan.</p>
  {readState==='pending'||requests.isFetching?<LoadingState title="Memeriksa akses dan memuat ringkasan..." shape="compact" />:
   readState==='error'||requests.isError||!requests.available?<div role="alert"><p>Ringkasan belum tersedia atau akses berubah.</p><Button type="button" variant="secondary" onClick={()=>void requests.refetch()}>Muat ulang ringkasan</Button></div>:
   requests.data&&<>
    {!requests.data.rows.length&&<EmptyState title="Belum ada permintaan cuti."/>}
    {/* One read and one row tree: CSS changes presentation without duplicating state. */}
    {!!requests.data.rows.length&&<table role="table" className="director-leave-table">
     <caption className="sr-only">Ringkasan permintaan cuti</caption>
     <thead role="rowgroup"><tr role="row">
      <th role="columnheader" scope="col">Karyawan</th><th role="columnheader" scope="col">Tanggal cuti</th>
      <th role="columnheader" scope="col">Durasi</th><th role="columnheader" scope="col">Status</th>
      <th role="columnheader" scope="col">Penyetuju permohonan</th><th role="columnheader" scope="col">Diajukan</th>
     </tr></thead>
     <tbody role="rowgroup">{requests.data.rows.map(row=><tr role="row" key={row.id}>
      <td role="cell" className="font-semibold">{row.employeeName}</td>
      <td role="cell" className="director-leave-dates">{row.startDate} sampai {row.endDate}</td>
      <td role="cell" className="director-leave-duration"><span className="director-leave-mobile-label" aria-hidden="true"> · </span><span>{formatLeaveMinutes(row.totalMinutes)}</span></td>
      <td role="cell">{labels[row.status]}</td>
      <td role="cell"><span className="director-leave-mobile-label" aria-hidden="true">Penyetuju permohonan: </span><span>{row.approverName??'Belum ditetapkan'}</span></td>
      <td role="cell"><span className="director-leave-mobile-label" aria-hidden="true">Diajukan: </span><time dateTime={row.submittedAt}>{row.submittedAt}</time></td>
     </tr>)}</tbody>
    </table>}
    <div className="flex gap-2"><Button type="button" variant="quiet" disabled={!cursors.length} onClick={()=>{setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}}>Lebih baru</Button>
    <Button type="button" variant="quiet" disabled={requests.data.nextBefore===null} onClick={()=>{setCursors([...cursors,before]);setBefore(requests.data!.nextBefore)}}>Lebih lama</Button></div>
   </>}
 </section>
}
