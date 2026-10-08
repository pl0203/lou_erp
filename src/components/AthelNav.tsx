import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import AppNavigation from './AppNavigation'
import type { NavigationLink } from './navigationModules'

const ATHEL_ROLES = ['po_admin', 'executive']
async function fetchPendingSalesOrders(): Promise<number> {
  const { count, error } = await supabase.from('girard_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}
export default function AthelNav() {
  const { profile } = useAuth()
  const { data: pendingCount } = useQuery({ queryKey: ['pending_sales_orders'], queryFn: fetchPendingSalesOrders, refetchInterval: 60_000, enabled: !!profile && ATHEL_ROLES.includes(profile.role) })
  const links: NavigationLink[] = profile && ATHEL_ROLES.includes(profile.role) ? [
    { to: '/athel/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/athel/po', label: 'Purchase Order', icon: 'purchase' },
    { to: '/athel/sales-orders', label: 'Antrean Sales lama', icon: 'orders', badge: pendingCount },
    { to: '/athel/customers', label: 'Daftar Pelanggan', icon: 'customers' },
    { to: '/athel/promotions', label: 'Promosi', icon: 'promotion' },
    { to: '/athel/products', label: 'Daftar Barang', icon: 'products' },
    { to: '/ihr/leave', label: 'Cuti', icon: 'leave' },
  ] : []
  return <AppNavigation module="athel" links={links} />
}
