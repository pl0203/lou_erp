import { useAuth } from '../lib/AuthContext'
import AppNavigation from './AppNavigation'
import type { NavigationLink } from './navigationModules'

const ATHEL_ROLES = ['po_admin', 'executive']
export default function AthelNav() {
  const { profile } = useAuth()
  const links: NavigationLink[] = profile && ATHEL_ROLES.includes(profile.role) ? [
    { to: '/athel/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/athel/po', label: 'Purchase Order', icon: 'purchase' },
    { to: '/athel/customers', label: 'Daftar Pelanggan', icon: 'customers' },
    { to: '/athel/promotions', label: 'Promosi', icon: 'promotion' },
    { to: '/athel/products', label: 'Daftar Barang', icon: 'products' },
    { to: '/ihr/leave', label: 'Cuti', icon: 'leave' },
  ] : []
  return <AppNavigation module="athel" links={links} />
}
