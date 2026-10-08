import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const emailInput = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)

  const handleReset = async () => {
    if (submitting.current || sent) return
    const address = email.trim()
    if (!address) return setError('Masukkan email Anda.')
    if (address.length > 254 || emailInput.current?.validity.typeMismatch || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return setError('Masukkan alamat email yang valid.')
    }

    submitting.current = true
    setLoading(true)
    setError('')

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (resetError) {
        setError(resetError.status === 429
          ? 'Terlalu banyak permintaan. Tunggu beberapa saat sebelum mencoba lagi.'
          : 'Permintaan belum dapat diproses. Periksa koneksi Anda dan coba lagi nanti.')
        return
      }

      // Auth intentionally returns success for unknown addresses. Never infer delivery or account existence.
      setSent(true)
    } catch {
      setError('Permintaan belum dapat diproses. Periksa koneksi Anda dan coba lagi nanti.')
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 w-full max-w-sm shadow-sm">
        <button onClick={() => navigate('/login')} className="text-gray-400 hover:text-gray-600 text-sm mb-6 block">
          ← Kembali ke halaman masuk
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Reset kata sandi</h1>
          <p className="text-sm text-gray-500 mt-1">Masukkan email akun Anda untuk meminta tautan reset.</p>
        </div>

        {sent ? (
          <div role="status" className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-700 font-medium">Permintaan diproses</p>
            <p className="text-xs text-green-600 mt-1">
              Jika email terdaftar, tautan untuk mengatur ulang kata sandi akan dikirim.
            </p>
            <p className="text-xs text-green-600 mt-2">
              Periksa kotak masuk dan folder spam. Jika email belum diterima, pastikan alamat email benar atau hubungi administrator.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="reset-email" className="block text-sm text-gray-600 mb-1">Email</label>
              <input
                ref={emailInput}
                id="reset-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                disabled={loading}
                aria-invalid={!!error}
                aria-describedby={error ? 'reset-error' : undefined}
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleReset()}
                placeholder="anda@perusahaan.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {error && <p id="reset-error" role="alert" className="text-red-500 text-xs">{error}</p>}
            <button
              onClick={handleReset}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Mengirim...' : 'Kirim tautan reset'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
