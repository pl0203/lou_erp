import BrandLogo from '../components/BrandLogo'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPasswordSetupIdentity, updatePasswordForSetup } from '../lib/supabase'
import { Button } from '../components/ui/Button'
import { ActionLink } from '../components/ui/ActionLink'
import { Field } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { Notice } from '../components/ui/Feedback'
import { MainContent } from '../components/ui/MainContent'
import type { PasswordSetupResult } from '../lib/passwordSetup'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [invalidField, setInvalidField] = useState<'password' | 'confirm' | null>(null)
  const [failedSubmit, setFailedSubmit] = useState(0)
  const errorSummary = useRef<HTMLDivElement>(null)
  const [setup, setSetup] = useState<PasswordSetupResult | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)

  const fail = (message: string, field: typeof invalidField = null) => {
    setError(message); setInvalidField(field); setFailedSubmit(attempt => attempt + 1)
  }
  useEffect(() => {
    if (error || setup?.error) errorSummary.current?.focus()
  }, [error, setup?.error, failedSubmit])

  useEffect(() => {
    let active = true
    mounted.current = true
    void getPasswordSetupIdentity().then(result => { if (active) setSetup(result) })
    return () => { active = false; mounted.current = false }
  }, [])

  const handleReset = async () => {
    if (submitting.current || !setup?.identity) return
    if (!password) return fail('Masukkan kata sandi baru.', 'password')
    if (password.length < 8) return fail('Kata sandi minimal 8 karakter.', 'password')
    if (password !== confirm) return fail('Kata sandi tidak cocok.', 'confirm')

    submitting.current = true
    setLoading(true)
    setError('')
    setInvalidField(null)
    try {
      const result = await updatePasswordForSetup(setup.identity.userId, password)
      if (!mounted.current) return
      if (result.sessionChanged) {
        setSetup({ identity: null, error: result.error })
        setFailedSubmit(attempt => attempt + 1)
        return
      }
      if (result.error) { fail(result.error); return }
      navigate('/login', { replace: true })
    } catch {
      if (mounted.current) fail('Tidak dapat menyimpan kata sandi. Periksa koneksi dan coba lagi.')
    } finally {
      submitting.current = false
      if (mounted.current) setLoading(false)
    }
  }

  return (
    <MainContent className="min-h-screen bg-brand-canvas flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-[14px] border border-brand-divider p-8 w-full max-w-sm shadow-sm">
        <BrandLogo className="mb-8" />
        <PageHeader className="mb-8" title="Buat kata sandi baru" description="Pilih kata sandi yang kuat untuk akun Anda." />
        {!setup ? <Notice tone="info" title="Memeriksa tautan..." /> : !setup.identity ? (
          <div ref={errorSummary} role="group" aria-label="Ringkasan kesalahan kata sandi" tabIndex={-1}><Notice tone="error" title={setup.error} actions={<ActionLink to="/forgot-password" variant="secondary">Minta tautan reset baru</ActionLink>} /></div>
        ) : <form noValidate onSubmit={event => { event.preventDefault(); void handleReset() }} className="space-y-4">
          <p className="text-brand-secondary">{setup.identity.email}</p>
          <Field id="new-password" label="Kata sandi baru (wajib)" hint="Minimal 8 karakter." error={invalidField === 'password' ? error : undefined}>
            {control => <input {...control} type="password" autoComplete="new-password" value={password} disabled={loading}
              onChange={event => { setPassword(event.target.value); setInvalidField(null) }} placeholder="Minimal 8 karakter" />}
          </Field>
          <Field id="confirm-password" label="Konfirmasi kata sandi (wajib)" error={invalidField === 'confirm' ? error : undefined}>
            {control => <input {...control} type="password" autoComplete="new-password" value={confirm} disabled={loading}
              onChange={event => { setConfirm(event.target.value); setInvalidField(null) }} placeholder="Ulangi kata sandi Anda" />}
          </Field>
          {error && <div ref={errorSummary} role="group" aria-label="Ringkasan kesalahan kata sandi" tabIndex={-1}><Notice tone="error" title={error} /></div>}
          <Button type="submit" pending={loading} className="w-full">{loading ? 'Menyimpan...' : 'Simpan kata sandi'}</Button>
        </form>}
      </div>
    </MainContent>
  )
}
