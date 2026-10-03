import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LeaveContext } from '../../../lib/leave/contracts'
import type { LeaveAdminCommand, LeaveAdminTarget } from '../../../lib/leave/adminContracts'
import { adminKeys } from '../../../lib/leave/adminQueryKeys'
import { fetchLeaveAdminAccess, fetchLeaveAdminRequests, fetchLeaveAdminSettings, fetchLeaveAdminTargets, parseAdminReceipt, toAdminPayload } from '../../../lib/leave/adminRpc'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { createLeaveCommandTransport, invalidateRequestCaches } from '../../../lib/leave/requestTransport'
import { LEAVE_BACKEND, leaveKeys } from '../../../lib/leave/queryKeys'
import { runLeaveInteraction } from '../../../lib/leave/useLeaveContext'
import { leaveErrorMessage } from '../../../lib/leave/rpc'
import LeaveAdminSettings from './LeaveAdminSettings'
import { useSetupUnsaved } from './useSetupUnsaved'
import LeaveAdminRotaPanel from './LeaveAdminRotaPanel'
import LeaveAdminPrivatePanel from './LeaveAdminPrivatePanel'
import { LeaveAdminBalancePanel, LeaveAdminMemberPanel } from './LeaveAdminWritePanels'
import type { LeaveReadState } from './LeaveRequestForm'
import { discardLeaveDraftMessage } from './LeaveRequestForm'

type Props={actorId:string;context:LeaveContext;readState:LeaveReadState;onDirtyChange:(dirty:boolean)=>void}
const adminAllowed=(context:LeaveContext)=>context.memberKind!=='director'&&(context.capabilities.configure||context.capabilities.adjust||context.capabilities.readPrivate||context.capabilities.manageAccess)
export default function LeaveAdministration(props:Props){
 return <Administration key={props.actorId} {...props}/>
}
function Administration({actorId,context,readState,onDirtyChange}:Props){
 const [page,setPage]=useState(1),[target,setTarget]=useState<LeaveAdminTarget|null>(null),[dirty,setDirty]=useState(false),[rota,setRota]=useState(false)
 const targets=useAuthorizedLeaveRead(actorId,context,adminKeys.targets(actorId,context.scopeVersion,page,25),signal=>fetchLeaveAdminTargets(page,25,signal),adminAllowed(context),adminAllowed)
 useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false)},[dirty,onDirtyChange])
 const interrupted=useRef(false)
 useEffect(()=>{if(readState==='error')interrupted.current=true;else if(readState==='ready'&&interrupted.current){interrupted.current=false;void targets.refetch()}},[readState,targets.refetch])
 function close(){if(!dirty||window.confirm(discardLeaveDraftMessage)){setDirty(false);setTarget(null)}}
 useEffect(()=>{if(target&&targets.data){const current=targets.data.rows.find(row=>row.id===target.id);if(!current){setDirty(false);setTarget(null)}else if(JSON.stringify(current.capabilities)!==JSON.stringify(target.capabilities)){setDirty(false);setTarget(current)}}},[target,targets.data])
 const visible=readState==='ready'&&targets.available
 return <section aria-label="Pengaturan cuti" className="space-y-4">
  {target&&readState==='ready'&&!targets.available&&!targets.isFetching&&<div role="alert"><p>Akses anggota belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void targets.refetch()}>Muat ulang akses anggota</button></div>}
  {rota?<LeaveAdminRotaPanel actorId={actorId} context={context} readState={readState} onDirtyChange={setDirty} onClose={()=>{setDirty(false);setRota(false)}}/>:!target&&<>
   {!visible?<div role={targets.isError?'alert':'status'}><p>Daftar anggota berizin belum dapat ditampilkan.</p>{readState==='ready'&&<button type="button" onClick={()=>void targets.refetch()}>Muat ulang anggota</button>}</div>:<>
    <h2 className="font-semibold">Anggota dalam lingkup izin Anda</h2>
    {context.capabilities.configure&&<button type="button" className="min-h-11 underline" onClick={()=>setRota(true)}>Kalender dan roster perusahaan</button>}
    {!targets.data?.rows.length&&<p>Tidak ada anggota dalam lingkup izin ini.</p>}
    <ul className="space-y-3">{targets.data?.rows.map(row=><li key={row.id} className="rounded-xl border bg-white p-4"><p>{row.name}</p><p className="text-xs">{[row.capabilities.configure&&'Konfigurasi',row.capabilities.adjust&&'Penyesuaian',row.capabilities.readPrivate&&'Pembacaan privat',row.capabilities.calendar&&'Kalender',row.capabilities.manageAccess&&'Pengelolaan akses'].filter(Boolean).join(' · ')}</p><button type="button" className="mt-2 min-h-11 underline" aria-label={`Atur ${row.name}`} onClick={()=>setTarget(row)}>Buka anggota</button></li>)}</ul>
    <div className="flex flex-wrap gap-4"><button type="button" disabled={page===1} onClick={()=>setPage(page-1)}>Anggota sebelumnya</button><button type="button" disabled={page*25>=(targets.data?.total??0)} onClick={()=>setPage(page+1)}>Anggota berikutnya</button></div>
   </>}
  </>}
  {target&&<TargetSettings key={`${target.id}:${JSON.stringify(target.capabilities)}`} actorId={actorId} context={context} target={target} readState={visible?readState:readState==='error'||targets.isError?'error':'pending'} onDirtyChange={setDirty} onClose={close}/>}
 </section>
}
function PolicySettings({actorId,context,target,readState,onDirtyChange}:{actorId:string;context:LeaveContext;target:LeaveAdminTarget;readState:LeaveReadState;onDirtyChange:(dirty:boolean)=>void;onClose:()=>void}){
 const client=useQueryClient(),caps=target.capabilities
 const [recovery,setRecovery]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[draftDirty,setDraftDirty]=useState(false)
 const [before,setBefore]=useState<number|null>(null),[cursors,setCursors]=useState<(number|null)[]>([])
 const live=useRef(true),working=useRef(false),dataKey=leaveKeys.private(actorId,context.scopeVersion,'admin','target',target.id,{before,limit:25})
 const targetRead=useAuthorizedLeaveRead(actorId,context,dataKey,async signal=>{
  const [settings,access,requests]=await Promise.all([
   caps.configure?fetchLeaveAdminSettings(target.id,signal):undefined,
   caps.manageAccess?fetchLeaveAdminAccess(target.id,signal):undefined,
   caps.configure&&caps.readPrivate?fetchLeaveAdminRequests(target.id,before,25,signal):undefined,
  ])
  if(settings&&access&&settings.authorityKey!==access.authorityKey)throw new Error('Akses anggota berubah. Muat ulang.')
  return {settings,access,requests}
 },caps.configure||caps.manageAccess,adminAllowed)
 const authorize=()=>runLeaveInteraction(client,actorId,context.scopeVersion,current=>{if(!live.current||!adminAllowed(current))throw new Error('Akses pengaturan berubah.')})
 const transport=useMemo(()=>createLeaveCommandTransport({actorId,backendScope:LEAVE_BACKEND,formScope:`admin:${target.id}`,storage:()=>localStorage,authorize,parseReceipt:parseAdminReceipt}),[actorId,context.scopeVersion,target.id,client])
 useEffect(()=>{live.current=true;setRecovery(transport.hasUnresolved());return()=>{live.current=false}},[transport])
 useSetupUnsaved(recovery)
 useEffect(()=>{onDirtyChange(draftDirty||recovery);return()=>onDirtyChange(false)},[draftDirty,recovery,onDirtyChange])
 const interrupted=useRef(false)
 useEffect(()=>{if(readState==='error')interrupted.current=true;else if(readState==='ready'&&interrupted.current){interrupted.current=false;void targetRead.refetch()}},[readState,targetRead.refetch])
 const fresh=readState==='ready'&&targetRead.available
 const denied=targetRead.isError&&targetRead.error.message===leaveErrorMessage({code:'42501'})
 // Retain only the editor's last grant identity through transient read interruption;
 // no private read response is rendered without a fresh completion proof.
 const grantKey=useRef('');if(targetRead.data)grantKey.current=targetRead.data.settings?.authorityKey??targetRead.data.access?.authorityKey??''
 async function send(command:LeaveAdminCommand){
  if(working.current||!fresh||recovery)throw new Error('Pengaturan belum siap.')
  working.current=true;setBusy(true);setError('')
  try{const result=await transport.send(command.operation,toAdminPayload(command));await invalidateRequestCaches(client);return result}
  finally{working.current=false;if(live.current){setBusy(false);setRecovery(transport.hasUnresolved())}}
 }
 const [refreshTurn,setRefreshTurn]=useState(0)
 const refreshWaiter=useRef<((proof:{employeeId:string;scopeVersion:string}|void)=>void)|null>(null)
 useEffect(()=>{
  const waiter=refreshWaiter.current,currentContext=client.getQueryData<LeaveContext>(leaveKeys.context(actorId,'current'))
  if(!waiter||currentContext?.scopeVersion!==context.scopeVersion)return
  if(readState==='ready'&&targetRead.isCurrent()){
   refreshWaiter.current=null;waiter({employeeId:target.id,scopeVersion:context.scopeVersion})
  }else if(readState==='error'||targetRead.isError&&!targetRead.isFetching){refreshWaiter.current=null;waiter()}
 },[refreshTurn,context.scopeVersion,readState,targetRead.available,targetRead.data,targetRead.isError,targetRead.isFetching])
 useEffect(()=>()=>{refreshWaiter.current?.();refreshWaiter.current=null},[])
 function refresh(){return new Promise<{employeeId:string;scopeVersion:string}|void>(resolve=>{refreshWaiter.current=resolve;setRefreshTurn(turn=>turn+1)})}

 async function recover(){
  if(working.current||readState!=='ready')return;working.current=true;setBusy(true);setError('')
  try{const result=await transport.reconcile();if(!live.current)return;if(result.state==='committed')transport.acknowledgeRecovered();setRecovery(false);await invalidateRequestCaches(client);await targetRead.refetch()}
  catch{if(live.current)setError('Hasil pengaturan belum pasti. Periksa akses lalu pulihkan kembali.')}
  finally{working.current=false;if(live.current)setBusy(false)}
 }
 return <div className="space-y-4">

  {recovery&&readState==='ready'&&<div role="status"><p>Perubahan sebelumnya perlu dipulihkan sebelum percobaan berikutnya.</p><button type="button" disabled={busy} onClick={()=>void recover()}>Pulihkan hasil pengaturan</button></div>}
  {error&&readState==='ready'&&<p role="alert">{error}</p>}
  {(caps.configure||caps.manageAccess)&&<LeaveAdminSettings actorId={actorId} employeeId={target.id} scopeVersion={context.scopeVersion} dataScopeVersion={context.scopeVersion} authorityKey={denied?'':grantKey.current} authorityReady={fresh&&!recovery} canConfigure={caps.configure} canManageAccess={caps.manageAccess} canReadPrivate={caps.readPrivate} settings={targetRead.data?.settings} access={targetRead.data?.access} requests={targetRead.data?.requests?.rows} send={send} onRefresh={refresh} onDirtyChange={setDraftDirty}/>}
  {readState==='ready'&&!targetRead.available&&!targetRead.isFetching&&<div role="alert"><p>Data anggota belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void targetRead.refetch()}>Muat ulang pengaturan</button></div>}
  {fresh&&caps.configure&&caps.readPrivate&&<div className="flex gap-3"><button type="button" disabled={draftDirty||busy||!cursors.length} onClick={()=>{setBefore(cursors.at(-1)!);setCursors(cursors.slice(0,-1))}}>Permohonan lebih baru</button><button type="button" disabled={draftDirty||busy||targetRead.data?.requests?.nextBefore==null} onClick={()=>{setCursors([...cursors,before]);setBefore(targetRead.data?.requests?.nextBefore??null)}}>Permohonan lebih lama</button></div>}

 </div>
}

function TargetSettings(props:{actorId:string;context:LeaveContext;target:LeaveAdminTarget;readState:LeaveReadState;onDirtyChange:(dirty:boolean)=>void;onClose:()=>void}){
 const {target,readState,onDirtyChange,onClose}=props,caps=target.capabilities
 const panels=[...(caps.configure||caps.manageAccess?[{id:'policy',label:'Kebijakan dan akses'}]:[]),...(caps.configure?[{id:'member',label:'Keanggotaan'}]:[]),...(caps.configure||caps.adjust?[{id:'balance',label:'Saldo'}]:[]),...(caps.readPrivate?[{id:'private',label:'Tinjauan privat'}]:[])]
 const [selected,setSelected]=useState(panels[0]?.id??''),[dirty,setDirty]=useState(false)
 useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false)},[dirty,onDirtyChange])
 function select(id:string){if(id!==selected&&(!dirty||window.confirm(discardLeaveDraftMessage))){setDirty(false);setSelected(id)}}
 return <div className="space-y-4">
  {readState==='ready'&&<><h2 className="font-semibold">{target.name}</h2><button type="button" className="min-h-11 underline" onClick={onClose}>Kembali ke daftar anggota</button><nav aria-label="Pengaturan anggota terpilih" className="flex flex-wrap gap-2">{panels.map(panel=><button type="button" key={panel.id} aria-pressed={selected===panel.id} className="min-h-11 rounded border px-3" onClick={()=>select(panel.id)}>{panel.label}</button>)}</nav></>}
  {selected==='policy'&&<PolicySettings {...props} onDirtyChange={setDirty}/>}
  {selected==='member'&&<LeaveAdminMemberPanel {...props} onDirtyChange={setDirty}/>}
  {selected==='balance'&&<LeaveAdminBalancePanel key={props.context.scopeVersion} {...props} onDirtyChange={setDirty}/>}
  {selected==='private'&&<LeaveAdminPrivatePanel key={props.context.scopeVersion} {...props}/>}
 </div>
}
