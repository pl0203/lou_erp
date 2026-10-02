import IHRNav from '../../components/IHRNav'
import { useLeaveContext } from '../../lib/leave/useLeaveContext'
import LeaveSetupStatus from './leave/LeaveSetupStatus'
import LeaveTabs from './leave/LeaveTabs'
export default function LeaveManagement() {
  const context = useLeaveContext()
  return <div className="min-h-screen bg-gray-50">
    <IHRNav />
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 md:px-8">
      <h1 className="text-xl font-semibold text-gray-900">Manajemen Cuti</h1>
      {context.isPending ? <p role="status">Memuat akses cuti...</p> : context.isError ?
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>{context.error.message}</p><button type="button" onClick={() => void context.refetch()} className="mt-2 underline">Coba lagi</button></div> :
        <><LeaveSetupStatus context={context.data} /><LeaveTabs key={context.data.scopeVersion} context={context.data} /></>}
    </main>
  </div>
}
