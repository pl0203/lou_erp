import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { leaveKeys } from '../../lib/leave/queryKeys'
import IHRNav from '../../components/IHRNav'
import { useAuth } from '../../lib/AuthContext'
import { leaveErrorMessage } from '../../lib/leave/rpc'
import { useLeaveContext } from '../../lib/leave/useLeaveContext'
import LeaveSetupStatus from './leave/LeaveSetupStatus'
import LeaveTabs from './leave/LeaveTabs'
import { discardLeaveDraftMessage } from './leave/LeaveRequestForm'
export default function LeaveManagement() {
  const [dirty,setDirty]=useState(false)
  const context = useLeaveContext(), client=useQueryClient(), interrupted=useRef(false)
  const { user, profile, loading } = useAuth()
  const identity = !loading && user && profile?.is_active && profile.id === user.id ? user.id : null
  const readState = context.isFetching || context.isPending || context.authorityPending ? 'pending' : context.authorityReady ? 'ready' : 'error'
  // The accepted context adapter strips raw diagnostics; this is its exact 42501
  // denial message. Explicit denial must destroy retained input, unlike transport failure.
  const denied = context.isError && context.error.message === leaveErrorMessage({code:'42501'})
  // A cancelled authority fetch can leave joined private promises waiting on its
  // reverted query. Cancel those attempts too; only a later genuine context
  // completion may restart active readers. Ephemeral editor owners stay mounted.
  useEffect(()=>{
    if(!identity)return
    const filter={queryKey:leaveKeys.identity(identity),predicate:(query:{queryKey:readonly unknown[]})=>query.queryKey[3]==='private'}
    if(readState==='error'){interrupted.current=true;void client.cancelQueries(filter)}
    else if(readState==='ready'&&interrupted.current){interrupted.current=false;void client.refetchQueries({...filter,type:'active'},{cancelRefetch:false})}
  },[client,identity,readState])
  const errorPanel = useRef<HTMLDivElement>(null)
  useEffect(() => { if (readState === 'error') errorPanel.current?.focus() }, [readState])
  return <div className="min-h-screen bg-brand-canvas">
    <IHRNav beforeSignOut={()=>!dirty||window.confirm(discardLeaveDraftMessage)} />
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:py-8 md:px-8">
      <header><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand-primary">HR</p><h1 className="text-2xl font-semibold tracking-tight text-gray-900">{context.data?.capabilities.request&&['employee','manager'].includes(context.data.memberKind??'')?'Ajukan Cuti':'Manajemen Cuti'}</h1></header>
      {readState === 'pending' || !identity ? <p role="status">Memuat akses cuti...</p> : readState === 'error' ?
        <div role="alert" ref={errorPanel} tabIndex={-1} className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>Akses cuti belum dapat dikonfirmasi. Silakan coba lagi.</p><button type="button" onClick={() => void context.refetch()} className="mt-2 underline">Coba lagi</button></div> : null}
      {/* Keep only the same actor/scope's ephemeral owner through read failures. Its
          protected UI is suspended until the shared authority read succeeds again. */}
      {identity && !denied && context.data && <>
        {readState === 'ready' && <LeaveSetupStatus context={context.data} />}
        <LeaveTabs key={identity} context={context.data} readState={readState} onDirtyChange={setDirty} />
      </>}
    </main>
  </div>
}
