import BrandLogo from '../components/BrandLogo'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPasswordSetupIdentity, updatePasswordForSetup } from '../lib/supabase'
import type { PasswordSetupResult } from '../lib/passwordSetup'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [setup, setSetup] = useState<PasswordSetupResult | null>(null)
  const submitting = useRef(false)

  useEffect(() => {
    let active = true
    void getPasswordSetupIdentity().then(result => { if (active) setSetup(result) })
    return () => { active = false }
  }, [])

  const handleReset = async () => {
    if (submitting.current || !setup?.identity) return
    if (!password) return setError('Masukkan kata sandi baru.')
    if (password.length < 8) return setError('Kata sandi minimal 8 karakter.')
    if (password !== confirm) return setError('Kata sandi tidak cocok.')

    submitting.current = true
    setLoading(true)
    setError('')
    try {
      const result = await updatePasswordForSetup(setup.identity.userId, password)
      if (result.sessionChanged) {
        setSetup({ identity: null, error: result.error })
        return
      }
      if (result.error) { setError(result.error); return }
      navigate('/login', { replace: true })
    } catch {
      setError('Tidak dapat menyimpan kata sandi. Periksa koneksi dan coba lagi.')
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-brand-canvas flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 w-full max-w-sm shadow-sm">
        <BrandLogo className="mb-8" />
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Buat kata sandi baru</h1>
          <p className="text-sm text-gray-500 mt-1">Pilih kata sandi yang kuat untuk akun Anda.</p>
        </div>

        {!setup ? <p role="status">Memeriksa tautan...</p> : !setup.identity ? (
          <div role="alert">
            <p className="text-red-600 text-sm">{setup.error}</p>
            <button onClick={() => navigate('/forgot-password')} className="text-brand-primary text-sm mt-4">Minta tautan reset baru</button>
          </div>
        ) : <div className="space-y-4">
          <p className="text-sm text-gray-600">{setup.identity.email}</p>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Kata sandi baru</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Konfirmasi kata sandi</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleReset()}
              placeholder="Ulangi kata sandi Anda"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <button
            onClick={handleReset}
            disabled={loading}
            className="w-full bg-brand-primary hover:bg-brand-hover text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Menyimpan...' : 'Simpan kata sandi'}
          </button>
        </div>}
      </div>
    </div>
  )
}