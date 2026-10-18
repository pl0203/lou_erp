import { useAuth } from '../lib/AuthContext'
import { usePendingVisitReviewCount } from '../lib/visitRequestBadge'
import AppNavigation from './AppNavigation'
import type { NavigationLink } from './navigationModules'

const ROLE_LINKS: Record<string, NavigationLink[]> = {
  sales_person: [
    { to: '/girard/my-sales', label: 'Penjualan Saya', icon: 'dashboard' },
    { to: '/girard/schedule',  label: 'Jadwal Kunjungan', icon: 'calendar' },
    { to: '/girard/visit-requests', label: 'Permintaan Kunjungan', icon: 'orders' },
    { to: '/girard/my-orders', label: 'Riwayat Pesanan', icon: 'orders' },
  ],
  sales_manager: [
    { to: '/girard/schedule',    label: 'Jadwal', icon: 'calendar' },
    { to: '/girard/visit-requests', label: 'Permintaan Kunjungan', icon: 'orders' },
    { to: '/girard/my-visits',   label: 'Kunjungan Saya', icon: 'visit' },
    { to: '/girard/team',        label: 'Tim Saya', icon: 'people' },
    { to: '/girard/dashboard',   label: 'Dashboard', icon: 'dashboard' },
  ],
  sales_head: [
    { to: '/girard/schedule',    label: 'Jadwal', icon: 'calendar' },
    { to: '/girard/visit-requests', label: 'Permintaan Kunjungan', icon: 'orders' },
    { to: '/girard/my-visits',   label: 'Kunjungan Saya', icon: 'visit' },
    { to: '/girard/customers',   label: 'Pelanggan', icon: 'customers' },
    { to: '/girard/managers',    label: 'Manajer', icon: 'manager' },
    { to: '/girard/promotions',  label: 'Promosi', icon: 'promotion' },
    { to: '/girard/dashboard',   label: 'Dashboard', icon: 'dashboard' },
  ],
  executive: [
    { to: '/girard/schedule',    label: 'Jadwal', icon: 'calendar' },
    { to: '/girard/visit-requests', label: 'Permintaan Kunjungan', icon: 'orders' },
    { to: '/girard/my-visits',   label: 'Kunjungan Saya', icon: 'visit' },
    { to: '/girard/customers',   label: 'Pelanggan', icon: 'customers' },
    { to: '/girard/managers',    label: 'Manajer', icon: 'manager' },
    { to: '/girard/promotions',  label: 'Promosi', icon: 'promotion' },
    { to: '/girard/dashboard',   label: 'Dashboard', icon: 'dashboard' },
  ],
}


export default function GirardNav() {
  const { profile } = useAuth()
  const pendingReviews = usePendingVisitReviewCount(profile?.id, profile?.role)
  const roleLinks = profile ? (ROLE_LINKS[profile.role] ?? []).map(link =>
    link.to === '/girard/visit-requests' ? { ...link, badge: pendingReviews } : link
  ) : []
  if (profile && ['sales_person', 'sales_manager', 'sales_head', 'executive'].includes(profile.role)) {
    roleLinks.push({ to: '/girard/targets', label: 'Target Penjualan', icon: 'dashboard' })
    roleLinks.push({ to: '/girard/visit-history', label: 'Riwayat Kunjungan Saya', icon: 'visit' })
    if (!roleLinks.some(link => link.to === '/girard/promotions')) roleLinks.push({ to: '/girard/promotions', label: 'Promosi', icon: 'promotion' })
    if (!roleLinks.some(link => link.to === '/girard/my-orders')) roleLinks.push({ to: '/girard/my-orders', label: 'Riwayat Pesanan', icon: 'orders' })
  }
  return <AppNavigation module="girard" links={roleLinks} />
}

