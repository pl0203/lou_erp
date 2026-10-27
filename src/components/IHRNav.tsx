import { useEmployeeContext } from '../lib/employees/useEmployeeContext'
import { useAuth } from '../lib/AuthContext'
import AppNavigation from './AppNavigation'
import type { NavigationLink } from './navigationModules'

export default function IHRNav({ beforeSignOut }: { beforeSignOut?: () => boolean } = {}) {
  const { profile } = useAuth()
  const employees = useEmployeeContext()
  const canSeeEmployees = employees.displayAllowed && employees.displayContext?.canMaintainBasic
  const canSeeAccounts = profile?.role === 'executive'
  const personal = ['sales_person', 'sales_manager'].includes(profile?.role ?? '')
  const links: NavigationLink[] = [
    ...(canSeeEmployees || canSeeAccounts ? [{ to: canSeeEmployees ? '/ihr/employees' : '/ihr/users', label: 'Karyawan', icon: 'people' as const, activePaths: ['/ihr/employees', '/ihr/users'] }] : []),
    { to: personal ? '/ihr/leave?tab=mine' : '/ihr/leave', label: personal ? 'Ajukan Cuti' : 'Manajemen Cuti', icon: 'leave' },
  ]
  return <AppNavigation module="ihr" links={links} beforeSignOut={beforeSignOut} />
}
