import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const modules = [
  {
    key: 'athel',
    label: 'Athel',
    description: 'Purchase order management, customers, and fulfilment tracking.',
    color: '#2563eb',
    bg: '#eff6ff',
    letter: 'A',
    path: '/athel/po',
  },
  {
    key: 'girard',
    label: 'Girard',
    description: 'Sales team management, customer visits, and order capture.',
    color: '#16a34a',
    bg: '#f0fdf4',
    letter: 'G',
    path: '/girard/customers',
  },
  {
    key: 'ihr',
    label: 'iHR',
    description: 'User management and people operations.',
    color: '#e56d3a',
    bg: '#fdf0eb',
    letter: 'i',
    path: '/ihr/users',
  },
]

export default function Landing() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-gray-900">
          Good day, {profile?.full_name?.split(' ')[0]}
        </h1>
        <p className="text-gray-500 text-sm mt-2">Which system would you like to open?</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        {modules.map(mod => (
          <button
            key={mod.key}
            onClick={() => navigate(mod.path)}
            className="bg-white border border-gray-200 hover:shadow-md rounded-2xl p-8 text-left transition-all group"
            style={{ ['--hover-color' as string]: mod.color }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
              style={{ backgroundColor: mod.bg }}
            >
              <span className="font-bold text-sm" style={{ color: mod.color }}>
                {mod.letter}
              </span>
            </div>
            <h2
              className="text-lg font-semibold text-gray-900 mb-1 transition-colors group-hover:opacity-80"
              style={{ color: mod.color }}
            >
              {mod.label}
            </h2>
            <p className="text-sm text-gray-500">{mod.description}</p>
          </button>
        ))}
      </div>

      <button
        onClick={handleSignOut}
        className="mt-12 text-xs text-gray-400 hover:text-gray-600"
      >
        Sign out
      </button>
    </div>
  )
}