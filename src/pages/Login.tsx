import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const ROLE_HOME: Record<string, string> = {
  po_admin:      '/athel/po',
  sales_person:  '/girard/schedule',
  sales_manager: '/girard/schedule',
  sales_head:    '/girard/schedule',
  executive:     '/landing',
}

export default function Login() {
  const navigate = useNavigate()
  const { profile, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && profile) {
      navigate(ROLE_HOME[profile.role] ?? '/login', { replace: true })
    }
  }, [profile, loading])

  const handleLogin = async () => {
    if (!email || !password) return setError('Masukkan email dan kata sandi Anda.')
    setSubmitting(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError('Email atau kata sandi salah. Silakan coba lagi.')
      setSubmitting(false)
      return
    }

    const { data: profileData } = await supabase
      .from('users')
      .select('is_active')
      .eq('email', email)
      .single()

    if (profileData && !profileData.is_active) {
      await supabase.auth.signOut()
      setError('Akun Anda telah dinonaktifkan. Hubungi administrator Anda.')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-sm">Memuat...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 w-full max-w-sm shadow-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Selamat datang</h1>
          <p className="text-sm text-gray-500 mt-1">Masuk ke akun Anda</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="anda@perusahaan.com"
              autoComplete="email"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-gray-600">Kata Sandi</label>
              <button
                onClick={() => navigate('/forgot-password')}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Lupa kata sandi?
              </button>
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <button
            onClick={handleLogin}
            disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting ? 'Masuk...' : 'Masuk'}
          </button>
        </div>
      </div>
    </div>
  )
}