import type { NavigationIconName } from './NavigationIcon'

export type NavigationModule = 'athel' | 'girard' | 'ihr' | 'home'
export type NavigationLink = { to: string; label: string; icon: NavigationIconName; badge?: number }
export const moduleLabels: Record<NavigationModule, string> = { athel: 'Procurement', girard: 'Sales', ihr: 'HR', home: 'Padiwan' }
export function leaveHome(role?: string) {
  return role === 'executive' ? '/ihr/users' : ['sales_person', 'sales_manager'].includes(role ?? '') ? '/ihr/leave?tab=mine' : '/ihr/leave'
}
export function moduleOptions(role?: string) {
  if (!role) return []
  return [
    ...(['po_admin', 'executive'].includes(role) ? [{ to: '/athel/po', label: moduleLabels.athel, icon: 'purchase' as const, description: 'Manajemen pembelian' }] : []),
    ...(['sales_person', 'sales_manager', 'sales_head', 'executive'].includes(role) ? [{ to: '/girard/schedule', label: moduleLabels.girard, icon: 'sales' as const, description: 'Manajemen penjualan' }] : []),
    { to: leaveHome(role), label: moduleLabels.ihr, icon: 'people' as const, description: role === 'executive' ? 'Manajemen SDM' : 'Ajukan cuti dan saldo' },
  ]
}
export function roleHome(role?: string) {
  if (role === 'executive') return '/landing'
  if (role === 'po_admin') return '/athel/po'
  if (['sales_person', 'sales_manager', 'sales_head'].includes(role ?? '')) return '/girard/schedule'
  return '/ihr/leave'
}
