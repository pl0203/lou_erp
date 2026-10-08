import { useAuth } from '../lib/AuthContext'
import AppNavigation from './AppNavigation'
import type { NavigationLink } from './navigationModules'

const ROLE_LINKS: Record<string, NavigationLink[]> = {
  sales_person: [
    { to: '/girard/schedule',  label: 'Kunjungan Hari Ini', icon: 'calendar' },
    { to: '/girard/my-orders', label: 'Pesanan Saya', icon: 'orders' },
  ],
  sales_manager: [
    { to: '/girard/schedule',    label: 'Jadwal', icon: 'calendar' },
    { to: '/girard/my-visits',   label: 'Kunjungan Saya', icon: 'visit' },
    { to: '/girard/team',        label: 'Tim Saya', icon: 'people' },
    { to: '/girard/dashboard',   label: 'Dashboard', icon: 'dashboard' },
  ],
  sales_head: [
    { to: '/girard/schedule',    label: 'Jadwal', icon: 'calendar' },
    { to: '/girard/my-visits',   label: 'Kunjungan Saya', icon: 'visit' },
    { to: '/girard/customers',   label: 'Pelanggan', icon: 'customers' },
    { to: '/girard/managers',    label: 'Manajer', icon: 'manager' },
    { to: '/girard/promotions',  label: 'Promosi', icon: 'promotion' },
    { to: '/girard/dashboard',   label: 'Dashboard', icon: 'dashboard' },
  ],
  executive: [
    { to: '/girard/schedule',    label: 'Jadwal', icon: 'calendar' },
    { to: '/girard/my-visits',   label: 'Kunjungan Saya', icon: 'visit' },
    { to: '/girard/customers',   label: 'Pelanggan', icon: 'customers' },
    { to: '/girard/managers',    label: 'Manajer', icon: 'manager' },
    { to: '/girard/promotions',  label: 'Promosi', icon: 'promotion' },
    { to: '/girard/dashboard',   label: 'Dashboard', icon: 'dashboard' },
  ],
}


export default function GirardNav() {
  const { profile } = useAuth()
  const links: NavigationLink[] = profile ? [...(ROLE_LINKS[profile.role] ?? []), { to: ['sales_person', 'sales_manager'].includes(profile.role) ? '/ihr/leave?tab=mine' : '/ihr/leave', label: 'HR', icon: 'leave' }] : []
  return <AppNavigation module="girard" links={links} />
}
