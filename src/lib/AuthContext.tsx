import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

type UserProfile = {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  manager_id: string | null
}
type AuthState = { user: User | null; profile: UserProfile | null; loading: boolean; error: string | null }
export type BeforeSignOutGuard = (signal: AbortSignal) => boolean | Promise<boolean>
type AuthContextType = AuthState & { signOut: () => Promise<boolean>; registerBeforeSignOut: (guard: BeforeSignOutGuard) => () => void }
type SignOutRegistration = { guard?: BeforeSignOutGuard; pending?: AbortController }
function verifiedScope(state: AuthState) { return state.user && state.profile?.is_active && state.profile.id === state.user.id ? `${state.user.id}:${state.profile.role}` : '' }
const emptyState: AuthState = { user: null, profile: null, loading: false, error: null }
const AuthContext = createContext<AuthContextType>({ ...emptyState, loading: true, signOut: async () => false, registerBeforeSignOut: () => () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...emptyState, loading: true })
  const current = useRef(state)
  const generation = useRef(0)
  const queryClient = useQueryClient()
  const authorityEpoch = useRef(0)
  const signOutGuards = useRef(new Map<symbol, SignOutRegistration>())
  const guardRevision = useRef(0)
  const signingOut = useRef<Promise<boolean> | null>(null)
  const invalidateGuards = useCallback(() => {
    for (const entry of signOutGuards.current.values()) { entry.guard = undefined; entry.pending?.abort() }
    signOutGuards.current.clear()
  }, [])
  const publish = useCallback((next: AuthState) => {
    if (verifiedScope(current.current) !== verifiedScope(next)) { authorityEpoch.current++; invalidateGuards() }
    current.current = next; setState(next)
  }, [invalidateGuards])
  const registerBeforeSignOut = useCallback((guard: BeforeSignOutGuard) => {
    if (!verifiedScope(current.current)) return () => {}
    const token = Symbol('editor-signout'), entry: SignOutRegistration = { guard }
    signOutGuards.current.set(token, entry); guardRevision.current++
    return () => { entry.guard = undefined; entry.pending?.abort(); if (signOutGuards.current.delete(token)) guardRevision.current++ }
  }, [])

  useEffect(() => {
    let disposed = false
    const initialGeneration = generation.current
    function clearPrivateCache() { void queryClient.cancelQueries(); queryClient.clear() }
    async function resolveIdentity(user: User | null) {
      const request = ++generation.current
      const previous = current.current
      const sameVerifiedUser = !!user && previous.user?.id === user.id && !!previous.profile?.is_active
      // Background revalidation for the same verified identity must not destroy unsaved forms.
      if (!sameVerifiedUser) {
        clearPrivateCache()
        publish({ user, profile: null, loading: !!user, error: null })
      }
      if (!user) return
      try {
        const { data, error } = await supabase.rpc('pilot_my_profile').single<UserProfile>()
        if (disposed || request !== generation.current) return
        if (error || !data || data.id !== user.id || !data.is_active) {
          clearPrivateCache()
          publish({ user, profile: null, loading: false, error: 'Profil tidak tersedia atau akun tidak aktif. Hubungi administrator atau coba masuk kembali.' })
          return
        }
        if (sameVerifiedUser && previous.profile?.role !== data.role) clearPrivateCache()
        publish({ user, profile: data, loading: false, error: null })
      } catch {
        if (!disposed && request === generation.current) {
          clearPrivateCache()
          publish({ user, profile: null, loading: false, error: 'Tidak dapat memuat profil. Silakan coba masuk kembali.' })
        }
      }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!disposed) void resolveIdentity(session?.user ?? null)
    })
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!disposed && generation.current === initialGeneration) void resolveIdentity(session?.user ?? null)
    }).catch(() => {
      if (!disposed && generation.current === initialGeneration) {
        void queryClient.cancelQueries()
        queryClient.clear()
        publish({ ...emptyState, error: 'Tidak dapat memuat sesi. Silakan masuk kembali.' })
      }
    })
    return () => { disposed = true; generation.current++; authorityEpoch.current++; invalidateGuards(); subscription.unsubscribe() }
  }, [queryClient, publish, invalidateGuards])

  const signOut = useCallback((): Promise<boolean> => {
    if (signingOut.current) return signingOut.current
    const scope = verifiedScope(current.current), epoch = authorityEpoch.current
    if (!scope) return Promise.resolve(false)
    const tokens = [...signOutGuards.current.keys()], registrations = guardRevision.current
    const sameIdentity = () => authorityEpoch.current === epoch && verifiedScope(current.current) === scope
    const sameEditors = () => guardRevision.current === registrations && tokens.every(token => signOutGuards.current.has(token))
    const attempt = (async () => {
      for (const token of tokens) {
        const entry = signOutGuards.current.get(token)
        if (!entry?.guard || !sameIdentity()) return false
        const controller = new AbortController(); entry.pending = controller
        let stop: (() => void) | undefined
        const cancelled = new Promise<false>(resolve => { stop = () => resolve(false); controller.signal.addEventListener('abort', stop, { once:true }) })
        let accepted: boolean
        try { accepted = await Promise.race([Promise.resolve().then(() => !controller.signal.aborted && entry.guard ? entry.guard(controller.signal) : false), cancelled]) }
        finally { if (stop) controller.signal.removeEventListener('abort',stop); if (entry.pending === controller) entry.pending = undefined }
        if (!accepted || !sameIdentity() || !sameEditors()) return false
      }
      if (!sameIdentity() || !sameEditors()) return false
      // Voluntary logout never destroys a verified editor before the auth result.
      // Forced auth/profile loss uses publish/resolveIdentity immediately instead.
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      if (!sameIdentity()) return false
      generation.current++
      void queryClient.cancelQueries(); queryClient.clear(); publish(emptyState)
      return true
    })()
    signingOut.current = attempt
    void attempt.finally(() => { if (signingOut.current === attempt) signingOut.current = null }).catch(() => {})
    return attempt
  }, [publish, queryClient])
  return <AuthContext.Provider value={{ ...state, signOut, registerBeforeSignOut }}>{children}</AuthContext.Provider>
}
export const useAuth = () => useContext(AuthContext)

/** One mounted editor owns its guard. Changing its key invalidates old decisions. */
export function useBeforeSignOut(guard: BeforeSignOutGuard, editorGeneration: string | number) {
  const { registerBeforeSignOut, user, profile, loading } = useAuth()
  const currentGuard = useRef(guard); currentGuard.current = guard
  const scope = !loading && user && profile?.is_active && profile.id === user.id ? `${user.id}:${profile.role}` : ''
  useLayoutEffect(() => {
    if (!scope) return
    return registerBeforeSignOut(signal => currentGuard.current(signal))
  }, [registerBeforeSignOut, scope, editorGeneration])
}
