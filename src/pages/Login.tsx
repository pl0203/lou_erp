import SessionLoading from '../components/SessionLoading'
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
  const { profile, loading, identityRevision, error: profileError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [awaitingProfile, setAwaitingProfile] = useState(false)
  const attemptedLogin = useRef(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [failedSubmit, setFailedSubmit] = useState(0)
  const errorSummary = useRef<HTMLDivElement>(null)
  const submittingNow = useRef(false)
  const attemptRevision = useRef(identityRevision)
  const busy = submitting || loading || awaitingProfile

  useEffect(() => {
    // Only a new, completed identity resolution belongs to this attempt.
    // A previous error cannot unlock a retry; SIGNED_OUT is terminal too.
    if (awaitingProfile && !submitting && !loading && identityRevision !== attemptRevision.current) {
      setAwaitingProfile(false)
      if (!profile && !profileError) {
        setError('Sesi berakhir. Silakan coba masuk lagi.')
        setFailedSubmit(attempt => attempt + 1)
      }
    }
  }, [awaitingProfile, submitting, loading, identityRevision, profile, profileError])

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
    if (submittingNow.current || busy) return
    if (!email || !password) {
      const message = 'Masukkan email dan kata sandi Anda.'
      return fail(message, { email: !email ? message : undefined, password: !password ? message : undefined })
    }
    attemptedLogin.current = true
    attemptRevision.current = identityRevision
    submittingNow.current = true
    setSubmitting(true)
    setError('')
    setFieldErrors({})

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) { setAwaitingProfile(false); fail('Email atau kata sandi salah. Silakan coba lagi.') }
      else setAwaitingProfile(true)
      // AuthProvider owns profile validation; do not query by a user-entered email.
    } catch {
      setAwaitingProfile(false)
      fail('Tidak dapat masuk. Periksa koneksi dan coba lagi.')
    } finally {
      submittingNow.current = false
      setSubmitting(false)
    }
  }

  if (loading && !attemptedLogin.current) return <SessionLoading />

  return (
    <MainContent className="min-h-screen bg-brand-canvas flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-[14px] border border-brand-divider p-8 w-full max-w-sm shadow-sm">
        <BrandLogo className="mb-8" />
        <PageHeader className="mb-8" title="Selamat datang" description="Masuk ke akun Anda" />
        <form noValidate onSubmit={event => { event.preventDefault(); void handleLogin() }} className="space-y-4">
          <Field id="login-email" label="Email" error={fieldErrors.email}>
            {control => <input {...control} type="email" required value={email} disabled={busy}
              onChange={event => { setEmail(event.target.value); setFieldErrors(previous => ({ ...previous, email: undefined })) }} placeholder="anda@perusahaan.com" autoComplete="email" />}
          </Field>
          <Field id="login-password" label="Kata Sandi" error={fieldErrors.password}>
            {control => <input {...control} type="password" required value={password} disabled={busy}
              onChange={event => { setPassword(event.target.value); setFieldErrors(previous => ({ ...previous, password: undefined })) }} placeholder="••••••••" autoComplete="current-password" />}
          </Field>
          <ActionLink to="/forgot-password" variant="quiet">Lupa kata sandi?</ActionLink>
          {(error || profileError) && <div ref={errorSummary} role="group" aria-label="Ringkasan kesalahan masuk" tabIndex={-1}><Notice tone="error" title={error || profileError} /></div>}
          <Button type="submit" pending={busy} className="w-full auth-login-submit">{busy ? 'Sedang masuk…' : error || profileError ? 'Coba lagi' : 'Masuk'}</Button>
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{busy ? 'Sedang masuk…' : ''}</span>
        </form>
      </div>
    </MainContent>
  )
}
