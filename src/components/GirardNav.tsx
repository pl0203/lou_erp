import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const ROLE_LINKS: Record<string, { to: string; label: string }[]> = {
  sales_person: [
    { to: '/girard/schedule',  label: 'Kunjungan Hari Ini' },
    { to: '/girard/my-orders', label: 'Pesanan Saya' },
  ],
  sales_manager: [
    { to: '/girard/schedule',     label: 'Jadwal' },
    { to: '/girard/my-visits',    label: 'Kunjungan Saya' },
    { to: '/girard/my-customers', label: 'Pelanggan Saya' },
    { to: '/girard/team',         label: 'Tim Saya' },
    { to: '/girard/performance',  label: 'Performa' },
  ],
  sales_head: [
    { to: '/girard/schedule',    label: 'Jadwal' },
    { to: '/girard/my-visits',   label: 'Kunjungan Saya' },
    { to: '/girard/customers',   label: 'Pelanggan' },
    { to: '/girard/managers',    label: 'Manajer' },
    { to: '/girard/performance', label: 'Performa' },
    { to: '/girard/revenue',     label: 'Pendapatan' },
  ],
  executive: [
    { to: '/girard/schedule',    label: 'Jadwal' },
    { to: '/girard/my-visits',   label: 'Kunjungan Saya' },
    { to: '/girard/customers',   label: 'Pelanggan' },
    { to: '/girard/managers',    label: 'Manajer' },
    { to: '/girard/performance', label: 'Performa' },
    { to: '/girard/revenue',     label: 'Pendapatan' },
  ],
}

const ATHEL_ROLES  = ['po_admin', 'executive']
const GIRARD_ROLES = ['sales_person', 'sales_manager', 'sales_head', 'executive']

export default function GirardNav() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showUser, setShowUser] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  const links = profile ? (ROLE_LINKS[profile.role] ?? []) : []
  const canAccessAthel  = profile && ATHEL_ROLES.includes(profile.role)
  const canAccessGirard = profile && GIRARD_ROLES.includes(profile.role)
  const showSwitcherBtn = canAccessAthel && canAccessGirard

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setShowSwitcher(false)
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUser(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const initials = profile?.full_name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? '?'

  return (
    <div className="bg-white border-b border-gray-200 px-4 md:px-8">
      <div className="flex items-center gap-1 h-14">
        <div className="relative mr-4" ref={switcherRef}>
          <button
            onClick={() => showSwitcherBtn && setShowSwitcher(p => !p)}
            className={`flex items-center gap-1.5 py-1.5 px-2 rounded-lg transition-colors
              ${showSwitcherBtn ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'}`}
          >
            <span className="text-lg font-bold text-green-600">Girard</span>
            {showSwitcherBtn && (
              <svg className="w-3.5 h-3.5 text-gray-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>

          {showSwitcher && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50 w-44">
              <button
                onClick={() => { navigate('/athel/po'); setShowSwitcher(false) }}
                className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 transition-colors border-b border-gray-100"
              >
                <span className="font-medium text-blue-600">Athel</span>
                <p className="text-xs text-gray-400 mt-0.5">Manajemen pembelian</p>
              </button>
              <button
                onClick={() => { navigate('/girard/schedule'); setShowSwitcher(false) }}
                className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 transition-colors border-b border-gray-100"
              >
                <span className="font-medium text-green-600">Girard</span>
                <p className="text-xs text-gray-400 mt-0.5">Manajemen penjualan</p>
              </button>
              <button
                onClick={() => { navigate('/ihr/users'); setShowSwitcher(false) }}
                className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 transition-colors"
              >
                <span className="font-medium" style={{ color: '#e56d3a' }}>iHR</span>
                <p className="text-xs text-gray-400 mt-0.5">Manajemen SDM</p>
              </button>
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-1 flex-1">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `px-4 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="flex md:hidden items-center gap-1 flex-1 overflow-x-auto">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `px-3 py-4 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive ? 'border-green-600 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="relative ml-auto" ref={userRef}>
          <button
            onClick={() => setShowUser(p => !p)}
            className="w-8 h-8 rounded-full bg-green-600 text-white text-xs font-semibold flex items-center justify-center hover:bg-green-700 transition-colors"
          >
            {initials}
          </button>

          {showUser && (
            <div className="absolute top-full right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50 w-52">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900 truncate">{profile?.full_name}</p>
                <p className="text-xs text-gray-400 mt-0.5 capitalize">{profile?.role.replace(/_/g, ' ')}</p>
              </div>
              {(profile?.role === 'executive') && (
                <button
                  onClick={() => { navigate('/landing'); setShowUser(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors border-b border-gray-100"
                >
                  Ganti modul
                </button>
              )}
              <button
                onClick={handleSignOut}
                className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
              >
                Keluar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}