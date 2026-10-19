import { LoadingState } from '../../../components/ui/LoadingState'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/Feedback'
import { RecordList } from '../../../components/ui/RecordList'
import type { LeaveContext, LeaveStatus } from '../../../lib/leave/contracts'
import { leaveKeys } from '../../../lib/leave/queryKeys'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { fetchDirectorRequests } from '../../../lib/leave/directorRpc'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
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
    <RecordList label="Ringkasan permintaan cuti">{requests.data.rows.map(row=><li key={row.id} className="rounded-[14px] border border-brand-divider bg-white p-4">
     <p className="font-semibold">{row.employeeName}</p><p>{row.startDate} sampai {row.endDate} · {formatLeaveMinutes(row.totalMinutes)}</p>
     <p>{labels[row.status]}</p><p>Penyetuju permohonan: {row.approverName??'Belum ditetapkan'}</p><p>Diajukan: <time dateTime={row.submittedAt}>{row.submittedAt}</time></p>
    </li>)}</RecordList>
    <div className="flex gap-2"><Button type="button" variant="quiet" disabled={!cursors.length} onClick={()=>{setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}}>Lebih baru</Button>
    <Button type="button" variant="quiet" disabled={requests.data.nextBefore===null} onClick={()=>{setCursors([...cursors,before]);setBefore(requests.data!.nextBefore)}}>Lebih lama</Button></div>
   </>}
 </section>
}
