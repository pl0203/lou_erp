import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const IHR_COLOR = '#e56d3a'

const allLinks = [
  { to: '/ihr/users', label: 'Manajemen Pengguna' },
  { to: '/ihr/leave', label: 'Manajemen Cuti' },
]

export default function IHRNav({ beforeSignOut }: { beforeSignOut?: () => boolean } = {}) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const roleHome: Record<string, string> = { po_admin: '/athel/po', sales_person: '/girard/schedule', sales_manager: '/girard/schedule', sales_head: '/girard/schedule', executive: '/landing' }
  const home = roleHome[profile?.role ?? ''] ?? '/ihr/leave'
  const links = allLinks.filter(link => link.to !== '/ihr/users' || profile?.role === 'executive').map(link=>link.to==='/ihr/leave'&&['sales_person','sales_manager'].includes(profile?.role??'')?{...link,to:'/ihr/leave?tab=mine',label:'Ajukan Cuti'}:link)
  const [showSwitcher,setShowSwitcher]=useState(false)
  const switcherRef=useRef<HTMLDivElement>(null)
  const canAccessAthel=['po_admin','executive'].includes(profile?.role??'')
  const canAccessGirard=['sales_person','sales_manager','sales_head','executive'].includes(profile?.role??'')
  const [showUser, setShowUser] = useState(false)
  const userRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if(switcherRef.current&&!switcherRef.current.contains(e.target as Node))setShowSwitcher(false)
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUser(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSignOut = async () => {
    if (beforeSignOut && !beforeSignOut()) return
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
    <div className="bg-white border-b border-gray-200 px-4 md:px-8" onKeyDown={event=>{if(event.key==='Escape'&&showSwitcher){setShowSwitcher(false);switcherRef.current?.querySelector('button')?.focus()}}}>
      <div className="flex items-center gap-1 h-14">
        <div className="relative mr-4" ref={switcherRef}>
          <button aria-expanded={showSwitcher} aria-controls="ihr-module-options" onClick={()=>setShowSwitcher(value=>!value)} className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-orange-600">
            <span className="text-lg font-bold" style={{color:IHR_COLOR}}>iHR</span>
            <svg aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
          </button>
          {showSwitcher&&<div id="ihr-module-options" aria-label="Pilihan modul" className="absolute left-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            {canAccessAthel&&<button type="button" onClick={()=>{navigate('/athel/po');setShowSwitcher(false)}} className="min-h-11 w-full border-b border-gray-100 px-4 py-3 text-left text-sm hover:bg-gray-50"><span className="font-medium text-blue-600">Athel</span><p className="mt-0.5 text-xs text-gray-500">Manajemen pembelian</p></button>}
            {canAccessGirard&&<button type="button" onClick={()=>{navigate('/girard/schedule');setShowSwitcher(false)}} className="min-h-11 w-full border-b border-gray-100 px-4 py-3 text-left text-sm hover:bg-gray-50"><span className="font-medium text-green-600">Girard</span><p className="mt-0.5 text-xs text-gray-500">Manajemen penjualan</p></button>}
            <button type="button" onClick={()=>{navigate(profile?.role==='executive'?'/ihr/users':['sales_person','sales_manager'].includes(profile?.role??'')?'/ihr/leave?tab=mine':'/ihr/leave');setShowSwitcher(false)}} className="min-h-11 w-full px-4 py-3 text-left text-sm hover:bg-gray-50"><span className="font-medium text-orange-700">iHR</span><p className="mt-0.5 text-xs text-gray-500">{profile?.role==='executive'?'Manajemen SDM':'Ajukan cuti dan saldo'}</p></button>
          </div>}
        </div>

        <div className="hidden md:flex items-center gap-1 flex-1">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `px-4 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                  isActive ? 'border-[#e56d3a] text-[#e56d3a]' : 'border-transparent text-gray-500 hover:text-gray-800'
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
                `px-3 py-4 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1 ${
                  isActive ? 'border-[#e56d3a] text-[#e56d3a]' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="relative ml-auto" ref={userRef}>
          <button
            aria-label="Menu pengguna"
            onClick={() => setShowUser(p => !p)}
            className="w-8 h-8 rounded-full text-white text-xs font-semibold flex items-center justify-center transition-opacity hover:opacity-80"
            style={{ backgroundColor: IHR_COLOR }}
          >
            {initials}
          </button>

          {showUser && (
            <div className="absolute top-full right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50 w-52">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900 truncate">{profile?.full_name}</p>
                <p className="text-xs text-gray-400 mt-0.5 capitalize">{profile?.role.replace(/_/g, ' ')}</p>
              </div>
              <button
                onClick={() => { navigate(home); setShowUser(false) }}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors border-b border-gray-100"
              >
                {profile?.role === 'executive' ? 'Ganti modul' : 'Kembali ke modul'}
              </button>
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
