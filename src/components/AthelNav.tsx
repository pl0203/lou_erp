import { useAuth } from '../lib/AuthContext'
import AppNavigation from './AppNavigation'
import type { NavigationLink } from './navigationModules'

export default function AthelNav() {
  const { profile } = useAuth()
  const role = profile?.role
  const links: NavigationLink[] = ['po_admin', 'co_admin', 'executive'].includes(role ?? '') ? [
    ...(role === 'executive' ? [{ to: '/athel/dashboard', label: 'Dashboard', icon: 'dashboard' as const }] : []),
    ...(role !== 'co_admin' ? [{ to: '/athel/po', label: 'Purchase Order', icon: 'purchase' as const }] : []),
    ...(role !== 'po_admin' ? [{ to: '/athel/co', label: 'Consignment Order', icon: 'purchase' as const }] : []),
    { to: '/athel/customers', label: 'Daftar Pelanggan', icon: 'customers' },
    ...(role === 'executive' ? [{ to: '/athel/promotions', label: 'Promosi', icon: 'promotion' as const }] : []),
    { to: '/athel/products', label: 'Daftar Barang', icon: 'products' },
  ] : []
  return <AppNavigation module="athel" links={links} />
}
