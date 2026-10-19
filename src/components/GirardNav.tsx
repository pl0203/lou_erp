import { useAuth } from '../lib/AuthContext'
import { usePendingVisitReviewCount } from '../lib/visitRequestBadge'
import AppNavigation from './AppNavigation'
import { dashboardFeatureEnabled } from '../lib/salesDashboard/feature'
import type { NavigationGroup, NavigationLink } from './navigationModules'

const ROLE_LINKS: Record<string, NavigationLink[]> = {
  sales_person: [
    { to: '/girard/my-sales', label: 'Penjualan Saya', icon: 'dashboard' },
    { to: '/girard/schedule',  label: 'Jadwal Kunjungan', icon: 'calendar' },
    { to: '/girard/visit-requests', label: 'Permintaan Kunjungan', icon: 'orders' },
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
    roleLinks.push({ to: '/girard/visit-history', label: 'Riwayat Kunjungan Saya', icon: 'visit' })
    if (!roleLinks.some(link => link.to === '/girard/promotions')) roleLinks.push({ to: '/girard/promotions', label: 'Promosi', icon: 'promotion' })
  }
  const dashboard: NavigationGroup = {
    id: 'sales-dashboard', label: 'Dashboard', icon: 'dashboard', children: [
      ...(['sales_manager', 'sales_head', 'executive'].includes(profile?.role ?? '') ? [
        { to: '/girard/dashboard?tab=team', label: 'Performa Tim', icon: 'people' as const, activeSearch: { key: 'tab', value: 'team', fallback: dashboardFeatureEnabled ? 'team' : 'customers', allowed: ['team', 'customers'] } },
        { to: '/girard/dashboard?tab=customers', label: 'Performa Toko', icon: 'customers' as const, activeSearch: { key: 'tab', value: 'customers', fallback: dashboardFeatureEnabled ? 'team' : 'customers', allowed: ['team', 'customers'] } },
      ] : []),
      { to: '/girard/targets', label: 'Target Penjualan', icon: 'sales' },
    ],
  }
  const hasSalesAccess = ['sales_person', 'sales_manager', 'sales_head', 'executive'].includes(profile?.role ?? '')
  // Keep the existing dashboard position. Sales staff retain targets only, not wider dashboard access.
  const links = roleLinks.map(link => link.to === '/girard/dashboard' ? dashboard : link)
  if (hasSalesAccess && !roleLinks.some(link => link.to === '/girard/dashboard')) links.push(dashboard)
  return <AppNavigation module="girard" links={links} />
}

