import { LoadingState } from '../../../components/ui/LoadingState'
import { RecordList } from '../../../components/ui/RecordList'
import { FormActions } from '../../../components/ui/FormActions'
import { EmptyState } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LeaveContext } from '../../../lib/leave/contracts'
import type { LeaveCalendarSetup, RosterPreviewInput, CalendarPreviewInput } from '../../../lib/leave/setupContracts'
import { createLeaveSetupTransport, fetchLeaveRota, previewLeaveRoster, previewLeaveCalendar } from '../../../lib/leave/setupRpc'
import { useAuthorizedLeaveRead } from '../../../lib/leave/useLeaveReads'
import { LEAVE_BACKEND, leaveKeys } from '../../../lib/leave/queryKeys'
import { runLeaveInteraction,useLeaveDisplayAuthority } from '../../../lib/leave/useLeaveContext'
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
 const fresh=readState==='ready'&&query.available
 const displayAuthority=useLeaveDisplayAuthority(useQueryClient(),actorId)
 const navigationReady=fresh&&!displayAuthority.refreshing
 const currentNavigation=useRef(navigationReady);currentNavigation.current=navigationReady
 const visible=(readState==='ready'||readState==='refreshing')&&!!query.displayData
 function close(){if(!currentNavigation.current||!query.isCurrent())return;if(!dirty||window.confirm(discardLeaveDraftMessage)){setDirty(false);if(selected)setSelected(null);else onClose()}}
 return <div className="space-y-4">
  {(readState==='ready'||readState==='refreshing')&&<Button disabled={!navigationReady} size="compact" type="button" variant="quiet" className="underline" onClick={close}>{selected?'Kembali ke daftar kalender':'Kembali ke daftar anggota'}</Button>}
  {selected?<RotaEditor key={selected.id} actorId={actorId} context={context} calendar={selected} readState={fresh?'ready':visible?'refreshing':readState==='error'||query.isError||!query.displayAllowed?'error':'pending'} onDirtyChange={setDirty}/>:(readState==='ready'||readState==='refreshing')&&((!visible&&(query.isError||!query.available&&!query.isFetching))?<div role="alert" className="ui-notice ui-notice--error"><p>Kalender dan roster memerlukan izin konfigurasi global yang dikonfirmasi.</p><Button size="compact" type="button" onClick={()=>void query.refetch()} variant="secondary">Muat ulang kalender perusahaan</Button></div>:!visible?<LoadingState title="Memuat kalender perusahaan..." shape="list" className="ui-notice ui-notice--info" />:<>
   <h2 className="font-semibold">Kalender dan roster perusahaan</h2>{!query.displayData?.rows.length&&<EmptyState title="Belum ada kalender perusahaan yang dapat diatur."/>}
   <RecordList  label="Kalender perusahaan">{query.displayData?.rows.map(calendar=><li key={calendar.id}><Button size="compact" type="button" variant="quiet" className="underline" disabled={!navigationReady} onClick={()=>{const current=query.data?.rows.find(row=>row.id===calendar.id);if(currentNavigation.current&&query.isCurrent()&&current)setSelected(current)}}>Atur kalender {calendar.name}</Button></li>)}</RecordList>
   <FormActions ><Button size="compact" type="button" disabled={!navigationReady||page===1} onClick={()=>{if(currentNavigation.current&&query.isCurrent())setPage(page-1)}} variant="quiet">Kalender sebelumnya</Button><Button size="compact" type="button" disabled={!navigationReady||page*25>=(query.displayData?.total??0)} onClick={()=>{if(currentNavigation.current&&query.isCurrent())setPage(page+1)}} variant="quiet">Kalender berikutnya</Button></FormActions>
  </>)}
 </div>
}
function RotaEditor({actorId,context,calendar,readState,onDirtyChange}:{actorId:string;context:LeaveContext;calendar:LeaveCalendarSetup;readState:LeaveReadState;onDirtyChange:(dirty:boolean)=>void}){
 const client=useQueryClient(),[dirty,setDirty]=useState(false),activePreview=useRef<AbortController|null>(null)
 const query=useAuthorizedLeaveRead(actorId,context,adminKeys.rotaContext(actorId,context.scopeVersion,calendar.id),signal=>fetchLeaveAdminRotaContext(calendar.id,context.scopeVersion,signal),context.capabilities.configure,live=>live.memberKind!=='director'&&live.capabilities.configure)
 const fresh=readState==='ready'&&query.available
 const actionReady=useRef(fresh);actionReady.current=fresh
 const denied=query.isError&&query.error.message===leaveErrorMessage({code:'42501'})
 const continuity=useAdminEditorContinuity(context.scopeVersion,query.data?.authorityKey,fresh,query.isCurrent,denied)
 const last=useRef({scope:context.scopeVersion,data:calendar});if(query.data)last.current={scope:context.scopeVersion,data:query.data.calendar}
 const data=denied?undefined:query.data?.calendar??(last.current.scope===context.scopeVersion||continuity.retaining?last.current.data:undefined)
 const command=useAdminCommand({actorId,context,formScope:`rota:${calendar.id}`,readState,fresh,draftDirty:dirty,onDirtyChange,makeTransport:authorize=>createLeaveSetupTransport({actorId,backendScope:LEAVE_BACKEND,formScope:`rota:${calendar.id}`,storage:()=>localStorage,authorize}),onReceipt:continuity.onReceipt,onConfirmed:continuity.wait})
 useEffect(()=>()=>activePreview.current?.abort(),[])
 // Missing eligible owner display is terminal, unlike the preview's own
 // context preflight (which retains its completed display receipt).
 const previewInvalidated=readState==='error'||!query.displayAllowed||!query.displayData
 useEffect(()=>{if(previewInvalidated)activePreview.current?.abort()},[previewInvalidated])
 async function preview(input:RosterPreviewInput){
  if(!actionReady.current||!query.isCurrent()||command.recovery)throw new Error('Akses roster belum dikonfirmasi.')
  activePreview.current?.abort();const abort=new AbortController();activePreview.current=abort
  const response=await runLeaveInteraction(client,actorId,context.scopeVersion,live=>{abort.signal.throwIfAborted();if(!live.capabilities.configure)throw new Error('Akses roster berubah.');return previewLeaveRoster(input,abort.signal)})
  abort.signal.throwIfAborted();return response
 }
 async function previewCalendar(input:CalendarPreviewInput){
  if(!actionReady.current||!query.isCurrent()||command.recovery)throw new Error('Akses kalender belum dikonfirmasi.')
  activePreview.current?.abort();const abort=new AbortController();activePreview.current=abort
  const response=await runLeaveInteraction(client,actorId,context.scopeVersion,live=>{abort.signal.throwIfAborted();if(!live.capabilities.configure||live.memberKind==='director')throw new Error('Akses kalender berubah.');return previewLeaveCalendar(input,abort.signal)})
  abort.signal.throwIfAborted();return response
 }
 return <div className="space-y-4">{command.recoveryUI}{data&&<LeaveRotaSettings key={continuity.key} calendar={data} send={command.send} preview={preview} previewCalendar={previewCalendar} previewInvalidated={previewInvalidated} authorityReady={continuity.ready&&!command.recovery} displayReady={(readState==='ready'||readState==='refreshing')&&!!query.displayData&&!command.recovery} refreshing={!fresh} onDirtyChange={setDirty} onSaved={continuity.onSaved}/>}
  {readState==='ready'&&!query.available&&!query.isFetching&&<div role="alert" className="ui-notice ui-notice--error"><p>Kalender belum dapat dikonfirmasi.</p><Button size="compact" type="button" onClick={()=>void query.refetch()} variant="secondary">Muat ulang kalender terpilih</Button></div>}
 </div>
}
