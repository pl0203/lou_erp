import { useAuth } from '../lib/AuthContext'
import AppNavigation from './AppNavigation'
import type { NavigationLink } from './navigationModules'

export default function IHRNav({ beforeSignOut }: { beforeSignOut?: () => boolean } = {}) {
  const { profile } = useAuth()
  const personal = ['sales_person', 'sales_manager'].includes(profile?.role ?? '')
  const links: NavigationLink[] = [
    ...(profile?.role === 'executive' ? [{ to: '/ihr/users', label: 'Manajemen Pengguna', icon: 'people' as const }] : []),
    { to: personal ? '/ihr/leave?tab=mine' : '/ihr/leave', label: personal ? 'Ajukan Cuti' : 'Manajemen Cuti', icon: 'leave' },
  ]
  return <AppNavigation module="ihr" links={links} beforeSignOut={beforeSignOut} />
}
