import { LoadingState } from '../components/ui/LoadingState'
import BrandLogo from '../components/BrandLogo'
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

import { Button } from '../components/ui/Button'
import { ActionLink } from '../components/ui/ActionLink'
import { Field } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { Notice } from '../components/ui/Feedback'
import { MainContent } from '../components/ui/MainContent'

import { roleHome } from '../components/navigationModules'

export default function Login() {
  const navigate = useNavigate()
  const { profile, loading, error: profileError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [failedSubmit, setFailedSubmit] = useState(0)
  const errorSummary = useRef<HTMLDivElement>(null)
  const submittingNow = useRef(false)

  const fail = (message: string, fields: typeof fieldErrors = {}) => {
    setError(message); setFieldErrors(fields); setFailedSubmit(attempt => attempt + 1)
  }
  useEffect(() => {
    if (error || profileError) errorSummary.current?.focus()
  }, [error, profileError, failedSubmit, loading])

  useEffect(() => {
    if (!loading && profile) {
      navigate(roleHome(profile.role), { replace: true })
    }
  }, [profile, loading])

  const handleLogin = async () => {
    if (submittingNow.current) return
    if (!email || !password) {
      const message = 'Masukkan email dan kata sandi Anda.'
      return fail(message, { email: !email ? message : undefined, password: !password ? message : undefined })
    }
    submittingNow.current = true
    setSubmitting(true)
    setError('')
    setFieldErrors({})

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) fail('Email atau kata sandi salah. Silakan coba lagi.')
      // AuthProvider owns profile validation; do not query by a user-entered email.
    } catch {
      fail('Tidak dapat masuk. Periksa koneksi dan coba lagi.')
    } finally {
      submittingNow.current = false
      setSubmitting(false)
    }
  }

  if (loading) {
    return <MainContent className="min-h-screen flex items-center justify-center px-4">
      <LoadingState title="Memuat..." shape="form" className="w-full max-w-sm" />
    </MainContent>
  }

  return (
    <MainContent className="min-h-screen bg-brand-canvas flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-[14px] border border-brand-divider p-8 w-full max-w-sm shadow-sm">
        <BrandLogo className="mb-8" />
        <PageHeader className="mb-8" title="Selamat datang" description="Masuk ke akun Anda" />
        <form noValidate onSubmit={event => { event.preventDefault(); void handleLogin() }} className="space-y-4">
          <Field id="login-email" label="Email" error={fieldErrors.email}>
            {control => <input {...control} type="email" required value={email} disabled={submitting}
              onChange={event => { setEmail(event.target.value); setFieldErrors(previous => ({ ...previous, email: undefined })) }} placeholder="anda@perusahaan.com" autoComplete="email" />}
          </Field>
          <Field id="login-password" label="Kata Sandi" error={fieldErrors.password}>
            {control => <input {...control} type="password" required value={password} disabled={submitting}
              onChange={event => { setPassword(event.target.value); setFieldErrors(previous => ({ ...previous, password: undefined })) }} placeholder="••••••••" autoComplete="current-password" />}
          </Field>
          <ActionLink to="/forgot-password" variant="quiet">Lupa kata sandi?</ActionLink>
          {(error || profileError) && <div ref={errorSummary} role="group" aria-label="Ringkasan kesalahan masuk" tabIndex={-1}><Notice tone="error" title={error || profileError} /></div>}
          <Button type="submit" pending={submitting} className="w-full">{submitting ? 'Masuk...' : 'Masuk'}</Button>
        </form>
      </div>
    </MainContent>
  )
}
