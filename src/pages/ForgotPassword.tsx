import BrandLogo from '../components/BrandLogo'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { ActionLink } from '../components/ui/ActionLink'
import { Field } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { Notice } from '../components/ui/Feedback'
import { MainContent } from '../components/ui/MainContent'
import { supabase } from '../lib/supabase'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [failedSubmit, setFailedSubmit] = useState(0)
  const errorSummary = useRef<HTMLDivElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)

  const fail = (message: string, invalidEmail = false) => {
    setError(message); setEmailError(invalidEmail ? message : ''); setFailedSubmit(attempt => attempt + 1)
  }
  useEffect(() => { if (error) errorSummary.current?.focus() }, [error, failedSubmit])

  const handleReset = async () => {
    if (submitting.current || sent) return
    const address = email.trim()
    if (!address) return fail('Masukkan email Anda.', true)
    if (address.length > 254 || emailInput.current?.validity.typeMismatch || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return fail('Masukkan alamat email yang valid.', true)
    }

    submitting.current = true
    setLoading(true)
    setError('')
    setEmailError('')

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (resetError) {
        fail(resetError.status === 429
          ? 'Terlalu banyak permintaan. Tunggu beberapa saat sebelum mencoba lagi.'
          : 'Permintaan belum dapat diproses. Periksa koneksi Anda dan coba lagi nanti.')
        return
      }

      // Auth intentionally returns success for unknown addresses. Never infer delivery or account existence.
      setSent(true)
    } catch {
      fail('Permintaan belum dapat diproses. Periksa koneksi Anda dan coba lagi nanti.')
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  return (
    <MainContent className="min-h-screen bg-brand-canvas flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-[14px] border border-brand-divider p-8 w-full max-w-sm shadow-sm">
        <BrandLogo className="mb-8" />
        <ActionLink to="/login" variant="quiet" className="mb-6">← Kembali ke halaman masuk</ActionLink>
        <PageHeader className="mb-8" title="Reset kata sandi" description="Masukkan email akun Anda untuk meminta tautan reset." />
        {sent ? (
          <Notice tone="success" title="Permintaan diproses">
            <p>Jika email terdaftar, tautan untuk mengatur ulang kata sandi akan dikirim.</p>
            <p className="mt-2">Periksa kotak masuk dan folder spam. Jika email belum diterima, pastikan alamat email benar atau hubungi administrator.</p>
          </Notice>
        ) : (
          <form noValidate onSubmit={event => { event.preventDefault(); void handleReset() }} className="space-y-4">
            <Field id="reset-email" label="Email (wajib)" error={emailError}>
              {control => <input {...control} ref={emailInput} type="email" autoComplete="email" maxLength={254}
                disabled={loading} value={email} onChange={event => { setEmail(event.target.value); setEmailError('') }} placeholder="anda@perusahaan.com" />}
            </Field>
            {error && <div ref={errorSummary} role="group" aria-label="Ringkasan kesalahan permintaan reset" tabIndex={-1}><Notice id="reset-error" tone="error" title={error} /></div>}
            <Button type="submit" pending={loading} className="w-full">{loading ? 'Mengirim...' : 'Kirim tautan reset'}</Button>
          </form>
        )}
      </div>
    </MainContent>
  )
}
