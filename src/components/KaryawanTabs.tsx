import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useEmployeeContext } from '../lib/employees/useEmployeeContext'

/** Route links styled as tabs: native history, deep links and dirty guards stay intact.
 * Display eligibility is not mutation authority; each destination keeps its own gates.
 */
export default function KaryawanTabs() {
  const { profile } = useAuth()
  const employees = useEmployeeContext()
  const links = [
    ...(employees.displayAllowed && employees.displayContext?.canMaintainBasic ? [{ to: '/ihr/employees', label: 'Data Karyawan' }] : []),
    ...(profile?.role === 'executive' ? [{ to: '/ihr/users', label: 'Akun & Akses' }] : []),
  ]
  if (!links.length) return null
  return <nav aria-label="Karyawan" className="flex flex-wrap gap-x-6 gap-y-1 border-b border-brand-divider mb-4">
    {links.map(link => <NavLink key={link.to} to={link.to}
      className={({ isActive }) => `inline-flex min-h-11 items-center py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary ${isActive ? 'text-brand-primary underline decoration-2 decoration-brand-primary underline-offset-8' : 'text-brand-secondary hover:text-brand-primary'}`}>
      {link.label}
    </NavLink>)}
  </nav>
}
