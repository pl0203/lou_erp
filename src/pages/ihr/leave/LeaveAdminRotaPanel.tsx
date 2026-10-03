import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LeaveContext } from '../../../lib/leave/contracts'
import type { LeaveCalendarSetup, RosterPreviewInput } from '../../../lib/leave/setupContracts'
import { createLeaveSetupTransport, fetchLeaveRota, previewLeaveRoster } from '../../../lib/leave/setupRpc'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { LEAVE_BACKEND, leaveKeys } from '../../../lib/leave/queryKeys'
import { runLeaveInteraction } from '../../../lib/leave/useLeaveContext'
import { useAdminCommand } from './LeaveAdminWritePanels'
import { useAdminEditorContinuity } from './useAdminEditorContinuity'
import { leaveErrorMessage } from '../../../lib/leave/rpc'
import { fetchLeaveAdminRotaContext } from '../../../lib/leave/adminRpc'
import { adminKeys } from '../../../lib/leave/adminQueryKeys'
import LeaveRotaSettings from './LeaveRotaSettings'
import { discardLeaveDraftMessage } from './LeaveRequestForm'
import type { LeaveReadState } from './LeaveRequestForm'
type Props={actorId:string;context:LeaveContext;readState:LeaveReadState;onDirtyChange:(dirty:boolean)=>void;onClose:()=>void}
export default function LeaveAdminRotaPanel({actorId,context,readState,onDirtyChange,onClose}:Props){
 const [page,setPage]=useState(1),[selected,setSelected]=useState<LeaveCalendarSetup|null>(null),[dirty,setDirty]=useState(false)
 const query=useAuthorizedLeaveRead(actorId,context,leaveKeys.private(actorId,context.scopeVersion,'admin','rota',page,25),signal=>fetchLeaveRota(page,25,signal),context.capabilities.configure,live=>live.memberKind!=='director'&&live.capabilities.configure)
 useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false)},[dirty,onDirtyChange])
 function close(){if(!dirty||window.confirm(discardLeaveDraftMessage)){setDirty(false);if(selected)setSelected(null);else onClose()}}
 return <div className="space-y-4">
  {readState==='ready'&&<button type="button" className="min-h-11 underline" onClick={close}>{selected?'Kembali ke daftar kalender':'Kembali ke daftar anggota'}</button>}
  {selected?<RotaEditor key={selected.id} actorId={actorId} context={context} calendar={selected} readState={readState} onDirtyChange={setDirty}/>:readState==='ready'&&((query.isError||!query.available&&!query.isFetching)?<div role="alert"><p>Kalender dan roster memerlukan izin konfigurasi global yang dikonfirmasi.</p><button type="button" onClick={()=>void query.refetch()}>Muat ulang kalender perusahaan</button></div>:!query.available?<p role="status">Memuat kalender perusahaan...</p>:<>
   <h2 className="font-semibold">Kalender dan roster perusahaan</h2>{!query.data?.rows.length&&<p>Belum ada kalender perusahaan yang dapat diatur.</p>}
   <ul className="space-y-2">{query.data?.rows.map(calendar=><li key={calendar.id}><button type="button" className="min-h-11 underline" onClick={()=>setSelected(calendar)}>Atur kalender {calendar.name}</button></li>)}</ul>
   <div className="flex gap-3"><button type="button" disabled={page===1} onClick={()=>setPage(page-1)}>Kalender sebelumnya</button><button type="button" disabled={page*25>=(query.data?.total??0)} onClick={()=>setPage(page+1)}>Kalender berikutnya</button></div>
  </>)}
 </div>
}
function RotaEditor({actorId,context,calendar,readState,onDirtyChange}:{actorId:string;context:LeaveContext;calendar:LeaveCalendarSetup;readState:LeaveReadState;onDirtyChange:(dirty:boolean)=>void}){
 const client=useQueryClient(),[dirty,setDirty]=useState(false),activePreview=useRef<AbortController|null>(null)
 const query=useAuthorizedLeaveRead(actorId,context,adminKeys.rotaContext(actorId,context.scopeVersion,calendar.id),signal=>fetchLeaveAdminRotaContext(calendar.id,context.scopeVersion,signal),context.capabilities.configure,live=>live.memberKind!=='director'&&live.capabilities.configure)
 const fresh=readState==='ready'&&query.available
 const denied=query.isError&&query.error.message===leaveErrorMessage({code:'42501'})
 const continuity=useAdminEditorContinuity(context.scopeVersion,query.data?.authorityKey,fresh,query.isCurrent,denied)
 const last=useRef({scope:context.scopeVersion,data:calendar});if(query.data)last.current={scope:context.scopeVersion,data:query.data.calendar}
 const data=denied?undefined:query.data?.calendar??(last.current.scope===context.scopeVersion||continuity.retaining?last.current.data:undefined)
 const command=useAdminCommand({actorId,context,formScope:`rota:${calendar.id}`,readState,fresh,draftDirty:dirty,onDirtyChange,makeTransport:authorize=>createLeaveSetupTransport({actorId,backendScope:LEAVE_BACKEND,formScope:`rota:${calendar.id}`,storage:()=>localStorage,authorize}),onReceipt:continuity.onReceipt,onConfirmed:continuity.wait})
 useEffect(()=>()=>activePreview.current?.abort(),[])
 useEffect(()=>{if(readState==='error')activePreview.current?.abort()},[readState])
 async function preview(input:RosterPreviewInput){
  if(!fresh||command.recovery)throw new Error('Akses roster belum dikonfirmasi.')
  activePreview.current?.abort();const abort=new AbortController();activePreview.current=abort
  return runLeaveInteraction(client,actorId,context.scopeVersion,live=>{abort.signal.throwIfAborted();if(!live.capabilities.configure)throw new Error('Akses roster berubah.');return previewLeaveRoster(input,abort.signal)})
 }
 return <div className="space-y-4">{command.recoveryUI}{data&&<LeaveRotaSettings key={continuity.key} calendar={data} send={command.send} preview={preview} authorityReady={continuity.ready&&!command.recovery} onDirtyChange={setDirty} onSaved={continuity.onSaved}/>}
  {readState==='ready'&&!query.available&&!query.isFetching&&<div role="alert"><p>Kalender belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void query.refetch()}>Muat ulang kalender terpilih</button></div>}
 </div>
}
