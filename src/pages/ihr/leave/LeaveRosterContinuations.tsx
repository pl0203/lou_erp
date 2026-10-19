import { useEffect,useId,useRef,useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { LoadingState } from '../../../components/ui/LoadingState'
import { canConfigureLeaveCalendar } from '../../../lib/leave/contracts'
import type { LeaveContext } from '../../../lib/leave/contracts'
import type { LeaveSetupSend,RosterContinuation } from '../../../lib/leave/setupContracts'
import { fetchLeaveRosterContinuations } from '../../../lib/leave/setupRpc'
import { leaveKeys } from '../../../lib/leave/queryKeys'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { useSetupUnsaved } from './useSetupUnsaved'

type Props={actorId:string;context:LeaveContext;calendarId:string;authorityReady:boolean;blockedByCalendarDraft?:boolean;send:LeaveSetupSend;onDirtyChange:(dirty:boolean)=>void;onSaved:()=>void}
/** Fixed server-supplied continuations only. This is not an employee/group assignment editor. */
export default function LeaveRosterContinuations({actorId,context,calendarId,authorityReady,blockedByCalendarDraft=false,send,onDirtyChange,onSaved}:Props){
 const [page,setPage]=useState(1),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),working=useRef(false),id=useId()
 useSetupUnsaved(!!reason)
 const allowed=context.memberKind==='director'&&canConfigureLeaveCalendar(context)
 const query=useAuthorizedLeaveRead(actorId,context,leaveKeys.private(actorId,context.scopeVersion,'admin','roster-continuations',calendarId,page,25),signal=>fetchLeaveRosterContinuations(calendarId,context.scopeVersion,page,25,signal),allowed,live=>live.memberKind==='director'&&canConfigureLeaveCalendar(live))
 useEffect(()=>{onDirtyChange(!!reason);return()=>onDirtyChange(false)},[reason,onDirtyChange])
 async function save(row:RosterContinuation){
  if(working.current||blockedByCalendarDraft||!authorityReady||!query.available||!query.isCurrent(query.data)||!reason.trim())return
  working.current=true;setBusy(true);setError('')
  try{await send({operation:'set_group_membership',continuationFingerprint:row.continuationFingerprint,employeeId:row.employeeId,groupId:row.groupId,effectiveFrom:row.effectiveFrom,effectiveUntil:row.effectiveUntil,replaceMembershipId:null,expectedVersion:row.memberVersion,reason});setReason('');onSaved()}
  catch{setError('Perpanjangan belum dapat dikonfirmasi. Muat ulang; pulihkan hasil bila status belum pasti.')}
  finally{working.current=false;setBusy(false)}
 }
 if(!authorityReady)return <LoadingState title="Memeriksa akses perpanjangan roster..." shape="compact"/>
 if(!query.available)return query.isError||!query.isFetching?<div role="alert"><p>Daftar perpanjangan kelompok belum dapat dikonfirmasi.</p><Button variant="secondary" size="compact" onClick={()=>void query.refetch()}>Muat ulang perpanjangan kelompok</Button></div>:<LoadingState title="Memuat perpanjangan kelompok..." shape="compact"/>
 return <section className="ui-section space-y-3" aria-label="Perpanjangan kelompok Sabtu">
  <h2 className="font-semibold">Perpanjang kelompok Sabtu yang sama</h2>
  {blockedByCalendarDraft&&<p role="status">Simpan atau batalkan perubahan kalender sebelum memperpanjang kelompok.</p>}
  <p>Hanya melanjutkan kelompok yang sedang berlaku sampai batas kalender dan roster terbit. Tidak mengubah kelompok, interval lama, kebijakan, atau saldo.</p>
  {!query.data?.rows.length?<p>Belum ada kelompok yang dapat diperpanjang. Kalender dan seluruh roster Sabtu harus terbit, dengan batas akhir; cakupan yang sudah lengkap tidak ditampilkan.</p>:<>
   <Field id={id} label="Alasan perpanjangan kelompok">{control=><input {...control} value={reason} maxLength={1000} disabled={busy} onChange={event=>setReason(event.target.value)}/>}</Field>
   <ul className="space-y-3">{query.data.rows.map(row=><li key={row.employeeId} className="flex flex-wrap items-center justify-between gap-2">
    <div><p>{row.employeeName}</p><p>{row.groupName} · {row.effectiveFrom} sampai {row.effectiveUntil} (eksklusif)</p></div>
    <Button size="compact" disabled={busy||blockedByCalendarDraft||!reason.trim()} onClick={()=>void save(row)} aria-label={`Perpanjang kelompok ${row.employeeName}`}>Perpanjang kelompok</Button>
   </li>)}</ul>
  </>}
  <div className="flex gap-2"><Button size="compact" variant="quiet" disabled={busy||page===1} onClick={()=>setPage(page-1)}>Kelompok sebelumnya</Button><Button size="compact" variant="quiet" disabled={busy||page*25>=(query.data?.total??0)} onClick={()=>setPage(page+1)}>Kelompok berikutnya</Button></div>
  {error&&<p role="alert">{error}</p>}
 </section>
}
