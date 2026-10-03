import { useEffect, useRef } from 'react'
import IHRNav from '../../components/IHRNav'
import { useAuth } from '../../lib/AuthContext'
import { leaveErrorMessage } from '../../lib/leave/rpc'
import { useLeaveContext } from '../../lib/leave/useLeaveContext'
import LeaveSetupStatus from './leave/LeaveSetupStatus'
import LeaveTabs from './leave/LeaveTabs'
export default function LeaveManagement() {
  const context = useLeaveContext()
  const { user, profile, loading } = useAuth()
  const identity = !loading && user && profile?.is_active && profile.id === user.id ? user.id : null
  const readState = context.isFetching || context.isPending || context.authorityPending ? 'pending' : context.authorityReady ? 'ready' : 'error'
  // The accepted context adapter strips raw diagnostics; this is its exact 42501
  // denial message. Explicit denial must destroy retained input, unlike transport failure.
  const denied = context.isError && context.error.message === leaveErrorMessage({code:'42501'})
  const errorPanel = useRef<HTMLDivElement>(null)
  useEffect(() => { if (readState === 'error') errorPanel.current?.focus() }, [readState])
  return <div className="min-h-screen bg-gray-50">
    <IHRNav />
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 md:px-8">
      <h1 className="text-xl font-semibold text-gray-900">Manajemen Cuti</h1>
      {readState === 'pending' || !identity ? <p role="status">Memuat akses cuti...</p> : readState === 'error' ?
        <div role="alert" ref={errorPanel} tabIndex={-1} className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>Akses cuti belum dapat dikonfirmasi. Silakan coba lagi.</p><button type="button" onClick={() => void context.refetch()} className="mt-2 underline">Coba lagi</button></div> : null}
      {/* Keep only the same actor/scope's ephemeral owner through read failures. Its
          protected UI is suspended until the shared authority read succeeds again. */}
      {identity && !denied && context.data && <>
        {readState === 'ready' && <LeaveSetupStatus context={context.data} />}
        <LeaveTabs key={`${identity}:${context.data.scopeVersion}`} context={context.data} readState={readState} />
      </>}
    </main>
  </div>
}
