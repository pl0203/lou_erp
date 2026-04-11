import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const IHR_COLOR = '#e56d3a'

const links = [
  { to: '/ihr/users',  label: 'User Management' },
  { to: '/ihr/leave',  label: 'Leave Management', comingSoon: true },
]

export default function IHRNav() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [showUser, setShowUser] = useState(false)
  const userRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
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

        {/* Logo — clicking goes back to landing */}
        <button
          onClick={() => navigate('/landing')}
          className="flex items-center gap-1.5 py-1.5 px-2 rounded-lg hover:bg-gray-100 transition-colors mr-4"
        >
          <span className="text-lg font-bold" style={{ color: IHR_COLOR }}>iHR</span>
        </button>

        {/* Nav links — desktop */}
        <div className="hidden md:flex items-center gap-1 flex-1">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `px-4 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                  isActive
                    ? 'border-[#e56d3a] text-[#e56d3a]'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`
              }
            >
              {link.label}
              {link.comingSoon && (
                <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full font-normal">
                  Soon
                </span>
              )}
            </NavLink>
          ))}
        </div>

        {/* Nav links — mobile */}
        <div className="flex md:hidden items-center gap-1 flex-1 overflow-x-auto">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `px-3 py-4 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1 ${
                  isActive
                    ? 'border-[#e56d3a] text-[#e56d3a]'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`
              }
            >
              {link.label}
              {link.comingSoon && (
                <span className="text-xs bg-gray-100 text-gray-400 px-1 py-0.5 rounded-full font-normal">
                  Soon
                </span>
              )}
            </NavLink>
          ))}
        </div>

        {/* User menu */}
        <div className="relative ml-auto" ref={userRef}>
          <button
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
                <p className="text-xs text-gray-400 mt-0.5 capitalize">
                  {profile?.role.replace(/_/g, ' ')}
                </p>
              </div>
              <button
                onClick={() => { navigate('/landing'); setShowUser(false) }}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors border-b border-gray-100"
              >
                Switch module
              </button>
              <button
                onClick={handleSignOut}
                className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}