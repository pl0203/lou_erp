import { useState } from 'react'
import BrandLogo from '../components/BrandLogo'
import AppNavigation from '../components/AppNavigation'
import NavigationIcon from '../components/NavigationIcon'
import { moduleOptions } from '../components/navigationModules'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const modules = [
  {
    key: 'athel',
    label: 'Procurement',
    description: 'Manajemen purchase order, pelanggan, dan pelacakan pemenuhan.',
    icon: 'purchase' as const,
    path: '/athel/po',
  },
  {
    key: 'girard',
    label: 'Sales',
    description: 'Manajemen tim penjualan, kunjungan pelanggan, dan pencatatan pesanan.',
    icon: 'sales' as const,
    path: '/girard/schedule',
  },
  {
    key: 'ihr',
    label: 'HR',
    description: 'Manajemen pengguna, cuti, pendataan pekerja, dan operasional SDM.',
    icon: 'people' as const,
    path: '/ihr/users',
  },
]

export default function Landing() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()
  const [signOutError, setSignOutError] = useState('')
  const handleSignOut = async () => {
    setSignOutError('')
    try { if (!await signOut()) return /* ProtectedRoute owns the redirect. */ }
    catch { setSignOutError('Tidak dapat keluar. Silakan coba lagi.') }
  }

  return (
    <div className="min-h-screen bg-brand-canvas">
      <AppNavigation module="home" links={moduleOptions(profile?.role)} />
      <main className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      <div className="mb-10 text-center">
        <BrandLogo className="mx-auto mb-8" />
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
            className="bg-white border border-gray-200 hover:border-brand-accent hover:shadow-md rounded-2xl p-8 text-left transition-all group"
          >
            <div
              className="w-10 h-10 rounded-xl bg-brand-tint flex items-center justify-center mb-4"
            >
              <span className="font-bold text-sm text-brand-primary"><NavigationIcon name={mod.icon} /></span>
            </div>
            <h2 className="text-lg font-semibold mb-1 text-brand-primary transition-colors">
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
      {signOutError && <p role="alert">{signOutError}</p>}
      </main>
    </div>
  )
}