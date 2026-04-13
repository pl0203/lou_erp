import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const modules = [
  {
    key: 'athel',
    label: 'Athel',
    description: 'Manajemen purchase order, pelanggan, dan pelacakan pemenuhan.',
    color: '#2563eb',
    bg: '#eff6ff',
    letter: 'A',
    path: '/athel/po',
  },
  {
    key: 'girard',
    label: 'Girard',
    description: 'Manajemen tim penjualan, kunjungan pelanggan, dan pencatatan pesanan.',
    color: '#16a34a',
    bg: '#f0fdf4',
    letter: 'G',
    path: '/girard/schedule',
  },
  {
    key: 'ihr',
    label: 'iHR',
    description: 'Manajemen pengguna, cuti, pendataan pekerja, dan operasional SDM.',
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
          Selamat datang, {profile?.full_name?.split(' ')[0]}
        </h1>
        <p className="text-gray-500 text-sm mt-2">Pilih sistem yang ingin Anda buka</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        {modules.map(mod => (
          <button
            key={mod.key}
            onClick={() => navigate(mod.path)}
            className="bg-white border border-gray-200 hover:shadow-md rounded-2xl p-8 text-left transition-all group"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
              style={{ backgroundColor: mod.bg }}
            >
              <span className="font-bold text-sm" style={{ color: mod.color }}>{mod.letter}</span>
            </div>
            <h2 className="text-lg font-semibold mb-1 transition-colors" style={{ color: mod.color }}>
              {mod.label}
            </h2>
            <p className="text-sm text-gray-500">{mod.description}</p>
          </button>
        ))}
      </div>
      
      <button
        onClick={handleSignOut}
        className="w-20 h-10 border justify-center rounded-xl flex items-center border-gray-200 mt-12 text-xs text-gray-300 hover:shadow-md text-gray-800"
      >
        Keluar
      </button>
    </div>
  )
}