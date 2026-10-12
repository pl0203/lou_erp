import { useState } from 'react'
import BrandLogo from '../components/BrandLogo'
import AppNavigation from '../components/AppNavigation'
import { Button } from '../components/ui/Button'
import { Notice } from '../components/ui/Feedback'
import { PageHeader } from '../components/ui/PageHeader'
import { MainContent } from '../components/ui/MainContent'
import NavigationIcon from '../components/NavigationIcon'
import { moduleOptions } from '../components/navigationModules'
import { Link } from 'react-router-dom'
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
      <MainContent className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      <div className="mb-10 text-center">
        <BrandLogo className="mx-auto mb-8" />
        <PageHeader title={`Selamat datang, ${profile?.full_name?.split(' ')[0] ?? ''}`} description="Pilih sistem yang ingin Anda buka" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        {modules.map(mod => (
          <Link
            key={mod.key}
            to={mod.path}
            className="bg-white border border-brand-control-border hover:border-brand-accent hover:shadow-md rounded-[14px] p-8 text-left transition-all group"
          >
            <div
              className="w-10 h-10 rounded-xl bg-brand-tint flex items-center justify-center mb-4"
            >
              <span className="font-bold text-sm text-brand-primary"><NavigationIcon name={mod.icon} /></span>
            </div>
            <h2 className="text-lg font-semibold mb-1 text-brand-primary transition-colors">
              {mod.label}
            </h2>
            <p className="text-base text-brand-secondary">{mod.description}</p>
          </Link>
        ))}
      </div>
      
      <Button variant="secondary" onClick={handleSignOut} className="mt-12">Keluar</Button>
      {signOutError && <Notice tone="error" title={signOutError} className="mt-4" />}
      </MainContent>
    </div>
  )
}
