import { useContext, useEffect, useRef, useState } from 'react'
import { UNSAFE_DataRouterContext } from 'react-router-dom'
import { useAuth } from '../../../lib/AuthContext'
import { useLeaveReadAccess } from '../../../lib/leave/useLeaveReads'
import type { LeaveContext } from '../../../lib/leave/contracts'
import MyLeave from './MyLeave'
import AssignedApprovalInbox from './AssignedApprovalInbox'
import TeamLeaveCalendar from './TeamLeaveCalendar'
import LeaveApprovalBadge from './LeaveApprovalBadge'
import LeaveAdministration from './LeaveAdministration'
import { discardLeaveDraftMessage, NavigationGuard } from './LeaveRequestForm'
import type { LeaveReadState } from './LeaveRequestForm'
/** Capabilities come from current server context; application roles grant no leave access. */
export default function LeaveTabs({ context, readState='ready', onDirtyChange }: { context: LeaveContext; readState?:LeaveReadState; onDirtyChange?:(dirty:boolean)=>void }) {
  const { user } = useAuth()
  return user ? <Tabs key={user.id} actorId={user.id} context={context} readState={readState} onDirtyChange={onDirtyChange}/> : null
}
function Tabs({actorId,context,readState,onDirtyChange}:{actorId:string;context:LeaveContext;readState:LeaveReadState;onDirtyChange?:(dirty:boolean)=>void}) {
  const [selected, setSelected] = useState(''), [dirty,setDirty]=useState(false)
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)},[dirty,onDirtyChange])
  const router=useContext(UNSAFE_DataRouterContext), caps=context.capabilities
  // The read remains enabled through its own fresh context fetch. Toggling it with
  // readState would restart the authority/read cycle whenever that fetch completes.
  const personal=caps.request&&(context.memberKind==='employee'||context.memberKind==='manager')
  const approver=caps.approve&&(context.memberKind==='manager'||context.memberKind==='director')
  const admin=context.memberKind!=='director'&&(caps.configure||caps.adjust||caps.readPrivate||caps.manageAccess)
  const access=useLeaveReadAccess(actorId,context,!personal&&!approver)
  const calendarGrant=useRef({scope:context.scopeVersion,allowed:false})
  if(calendarGrant.current.scope!==context.scopeVersion)calendarGrant.current={scope:context.scopeVersion,allowed:false}
  if(access.data)calendarGrant.current.allowed=access.data.calendarAudiences.length>0
  if(access.isError)calendarGrant.current.allowed=false
  const calendar=context.memberKind==='employee'||context.memberKind==='manager'||approver||calendarGrant.current.allowed
  const tabs=[...(personal?[{id:'mine',label:'Cuti Saya'}]:[]),...(approver?[{id:'approvals',label:'Persetujuan'}]:[]),...(calendar?[{id:'calendar',label:'Kalender'}]:[]),...(admin?[{id:'settings',label:'Pengaturan'}]:[])]
  const active=tabs.some(tab=>tab.id===selected)?selected:personal?'mine':approver?'approvals':admin?'settings':tabs[0]?.id
  function select(id:string){if(id!==active&&(!dirty||window.confirm(discardLeaveDraftMessage))){setDirty(false);setSelected(id)}}
  const accessRetry=!personal&&!approver&&readState==='ready'&&!access.available&&!access.isFetching?<div role="alert"><p>Pilihan akses kalender belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void access.refetch()}>Muat ulang pilihan kalender</button></div>:null
  if(!tabs.length)return accessRetry??(readState==='ready'&&access.available?<p className="text-sm text-gray-600">Belum ada akses cuti yang diberikan. Hubungi administrator HR.</p>:<p role="status">Memeriksa pilihan akses cuti...</p>)
  return <section>
    {accessRetry}
    {/* Own request/history already owns its router guard. The other selected editor
        owns exactly one central guard, even while its controls are suspended. */}
    {router&&active!=='mine'&&<NavigationGuard dirty={dirty}/>}
    <div hidden={readState!=='ready'} role="tablist" aria-label="Manajemen cuti" className="flex flex-wrap gap-2 border-b border-gray-200">
      {tabs.map((tab,index)=><button key={tab.id} id={`leave-tab-${tab.id}`} type="button" role="tab" aria-label={tab.label} aria-selected={tab.id===active} tabIndex={tab.id===active?0:-1}
        aria-controls={`leave-panel-${tab.id}`} onClick={()=>select(tab.id)} onKeyDown={event=>{
          const direction=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0
          const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs.at(-1):direction?tabs[(index+direction+tabs.length)%tabs.length]:undefined
          if(next){event.preventDefault();document.getElementById(`leave-tab-${next.id}`)?.focus()}
        }} className={`min-h-11 px-4 py-3 text-sm font-medium border-b-2 ${tab.id===active?'border-orange-600 text-orange-700':'border-transparent text-gray-600'}`}>
        {tab.label}{tab.id==='approvals'&&<span className="ml-2"><LeaveApprovalBadge actorId={actorId} context={context}/></span>}
      </button>)}
    </div>
    <div id={`leave-panel-${active}`} role="tabpanel" aria-labelledby={`leave-tab-${active}`} className="min-w-0 py-4 text-sm text-gray-600">
      {active==='mine'&&<MyLeave actorId={actorId} context={context} readState={readState} onDirtyChange={setDirty}/>}
      {active==='approvals'&&<AssignedApprovalInbox actorId={actorId} context={context} readState={readState} onDirtyChange={setDirty}/>}
      {active==='calendar'&&<TeamLeaveCalendar actorId={actorId} context={context} readState={readState}/>}
      {active==='settings'&&<LeaveAdministration actorId={actorId} context={context} readState={readState} onDirtyChange={setDirty}/>}
    </div>
  </section>
}
