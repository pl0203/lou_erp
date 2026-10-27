import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LeaveContext, LeaveResult, Page, Recovery } from '../../../lib/leave/contracts'
import type { LeaveAdminTarget } from '../../../lib/leave/adminContracts'
import type { LeaveMemberSetup } from '../../../lib/leave/setupContracts'
import { fetchLeaveAdminWriteContext } from '../../../lib/leave/adminRpc'
import { fetchLeaveApprovers, fetchLeaveMembers, createLeaveSetupTransport } from '../../../lib/leave/setupRpc'
import { createLeaveBalanceTransport } from '../../../lib/leave/balanceTransport'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { LEAVE_BACKEND, leaveKeys } from '../../../lib/leave/queryKeys'
import { runLeaveInteraction } from '../../../lib/leave/useLeaveContext'
import { invalidateRequestCaches } from '../../../lib/leave/requestTransport'
import LeaveBalanceSettings from './LeaveBalanceSettings'
import { useSetupUnsaved } from './useSetupUnsaved'
import LeavePeopleSettings from './LeavePeopleSettings'
import { useAdminEditorContinuity } from './useAdminEditorContinuity'
import { leaveErrorMessage } from '../../../lib/leave/rpc'
import type { LeaveReadState } from './LeaveRequestForm'

type PanelProps={actorId:string;context:LeaveContext;target:LeaveAdminTarget;readState:LeaveReadState;onDirtyChange:(dirty:boolean)=>void}
type CommandTransport<C>={send:(command:C)=>Promise<LeaveResult>;hasUnresolved:()=>boolean;reconcile:()=>Promise<Recovery>;acknowledgeRecovered:()=>void}
/** The existing canonical transports own identity, retry fences and minimal recovery storage. */
export function useAdminCommand<C>({actorId,context,formScope,readState,fresh,draftDirty,onDirtyChange,makeTransport,onConfirmed,onReceipt}:{actorId:string;context:LeaveContext;formScope:string;readState:LeaveReadState;fresh:boolean;draftDirty:boolean;onDirtyChange:(dirty:boolean)=>void;makeTransport:(authorize:()=>Promise<void>)=>CommandTransport<C>;onConfirmed:()=>Promise<unknown>;onReceipt?:()=>void}){
 const client=useQueryClient(),[recovery,setRecovery]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),working=useRef(false),alive=useRef(true)
 const transport=useMemo(()=>makeTransport(()=>runLeaveInteraction(client,actorId,context.scopeVersion,live=>{if(!alive.current||live.memberKind==='director')throw new Error('Akses pengaturan berubah.')})),[actorId,context.scopeVersion,formScope,client])
 useEffect(()=>{alive.current=true;setRecovery(transport.hasUnresolved());return()=>{alive.current=false}},[transport])
 useSetupUnsaved(recovery)
 useEffect(()=>{onDirtyChange(draftDirty||recovery);return()=>onDirtyChange(false)},[draftDirty,recovery,onDirtyChange])
 async function complete(){await invalidateRequestCaches(client);if(alive.current)await onConfirmed()}
 async function send(command:C){
  if(working.current||!fresh||recovery||readState!=='ready')throw new Error('Akses pengaturan belum dikonfirmasi.')
  working.current=true;setBusy(true);setError('')
  try{const result=await transport.send(command);if(alive.current)onReceipt?.();await complete();return result}
  finally{working.current=false;if(alive.current){setBusy(false);setRecovery(transport.hasUnresolved())}}
 }
 async function recover(){
  if(working.current||readState!=='ready')return;working.current=true;setBusy(true);setError('')
  try{const result=await transport.reconcile();if(!alive.current)return;if(result.state==='committed')transport.acknowledgeRecovered();setRecovery(false);await complete()}
  catch{if(alive.current)setError('Hasil perubahan belum pasti. Periksa akses lalu pulihkan kembali.')}
  finally{working.current=false;if(alive.current)setBusy(false)}
 }
 const recoveryUI=readState==='ready'?<>{recovery&&<div role="status"><p>Perubahan sebelumnya perlu dipulihkan sebelum percobaan berikutnya.</p><button type="button" className="min-h-11 underline" disabled={busy} onClick={()=>void recover()}>Pulihkan hasil perubahan</button></div>}{error&&<p role="alert">{error}</p>}</>:null
 return {send,busy,recovery,recoveryUI}
}
async function findMember(employeeId:string,signal:AbortSignal):Promise<LeaveMemberSetup>{
 for(let page=1;;page++){
  const result=await fetchLeaveMembers(page,100,signal),member=result.rows.find(row=>row.id===employeeId)
  if(member)return member
  if(page*100>=result.total)throw new Error('Anggota belum tersedia dalam lingkup konfigurasi.')
 }
}
async function allOptions<T>(read:(page:number,size:number,signal:AbortSignal)=>Promise<Page<T>>,signal:AbortSignal){
 const rows:T[]=[]
 for(let page=1;;page++){const result=await read(page,100,signal);rows.push(...result.rows);if(page*100>=result.total)return rows}
}
export function LeaveAdminMemberPanel({actorId,context,target,readState,onDirtyChange}:PanelProps){
 const [dirty,setDirty]=useState(false)
 const query=useAuthorizedLeaveRead(actorId,context,leaveKeys.private(actorId,context.scopeVersion,'admin','member-write',target.id),async signal=>{
  const [write,member,approvers]=await Promise.all([fetchLeaveAdminWriteContext(target.id,context.scopeVersion,signal),findMember(target.id,signal),allOptions(fetchLeaveApprovers,signal)])
  if(!write.capabilities.configure||!write.memberOptions)throw new Error('Akses konfigurasi anggota berubah.')
  return {write,member,approvers}
 },target.capabilities.configure,live=>live.capabilities.configure&&live.memberKind!=='director')
 const fresh=readState==='ready'&&query.available
 const denied=query.isError&&query.error.message===leaveErrorMessage({code:'42501'})
 const continuity=useAdminEditorContinuity(context.scopeVersion,query.data?.write.authorityKey,fresh,query.isCurrent,denied)
 const last=useRef<{scope:string;data:typeof query.data}>({scope:context.scopeVersion,data:undefined});if(query.data)last.current={scope:context.scopeVersion,data:query.data}
 const command=useAdminCommand({actorId,context,formScope:`member:${target.id}`,readState,fresh,draftDirty:dirty,onDirtyChange,makeTransport:authorize=>createLeaveSetupTransport({actorId,backendScope:LEAVE_BACKEND,formScope:`member:${target.id}`,storage:()=>localStorage,authorize}),onReceipt:continuity.onReceipt,onConfirmed:continuity.wait})
 const data=denied?undefined:query.data??(last.current.scope===context.scopeVersion||continuity.retaining?last.current.data:undefined)
 return <div className="space-y-4">{command.recoveryUI}
  {data&&<LeavePeopleSettings key={continuity.key} actorId={actorId} member={data.member} approvers={data.approvers} calendars={data.write.memberOptions?.calendars??[]} groups={data.write.memberOptions?.groups??[]} impacts={data.member.impacts??{available:false,pendingCount:null,approvedCount:null}} send={command.send} authorityReady={continuity.ready&&!command.recovery} onDirtyChange={setDirty} onSaved={continuity.onSaved}/>}
  {fresh&&data?.write.memberOptions?.state!=='available'&&<p role="status">Lajur kalender anggota belum ditetapkan. Pilihan kalender memerlukan penyiapan yang berwenang.</p>}
  {readState==='ready'&&!fresh&&<div role={query.isError?'alert':'status'}><p>Data pengaturan anggota belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void query.refetch()}>Muat ulang anggota terpilih</button></div>}
 </div>
}
export function LeaveAdminBalancePanel({actorId,context,target,readState,onDirtyChange}:PanelProps){
 const [dirty,setDirty]=useState(false)
 const query=useAuthorizedLeaveRead(actorId,context,leaveKeys.private(actorId,context.scopeVersion,'admin','balance-write',target.id),signal=>fetchLeaveAdminWriteContext(target.id,context.scopeVersion,signal),target.capabilities.configure||target.capabilities.adjust,live=>live.memberKind!=='director'&&(live.capabilities.configure||live.capabilities.adjust))
 const fresh=readState==='ready'&&query.available
 const last=useRef<typeof query.data>(undefined);if(query.data)last.current=query.data
 const command=useAdminCommand({actorId,context,formScope:`balance:${target.id}`,readState,fresh,draftDirty:dirty,onDirtyChange,makeTransport:authorize=>createLeaveBalanceTransport({actorId,backendScope:LEAVE_BACKEND,formScope:`balance:${target.id}`,storage:()=>localStorage,authorize}),onConfirmed:()=>query.refetch()})
 const data=query.data??last.current
 return <div className="space-y-4">{command.recoveryUI}
  {data&&<LeaveBalanceSettings key={data.authorityKey} actorId={actorId} employeeId={target.id} currentPeriod={data.balance.currentPeriod} accountMetadata={data.balance.account??undefined} canConfigure={data.capabilities.configure} canAdjust={data.capabilities.adjust} send={command.send} authorityReady={fresh&&!command.recovery} onDirtyChange={setDirty}/>}
  {readState==='ready'&&!fresh&&<div role={query.isError?'alert':'status'}><p>Konteks perubahan saldo belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void query.refetch()}>Muat ulang konteks saldo</button></div>}
 </div>
}
