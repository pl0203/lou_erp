import { createContext, useContext, useEffect, useRef, useState } from 'react'
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
type AuthContextType = AuthState & { signOut: () => Promise<void> }
const emptyState: AuthState = { user: null, profile: null, loading: false, error: null }
const AuthContext = createContext<AuthContextType>({ ...emptyState, loading: true, signOut: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...emptyState, loading: true })
  const current = useRef(state)
  const generation = useRef(0)
  const queryClient = useQueryClient()

  useEffect(() => {
    let disposed = false
    const initialGeneration = generation.current
    function publish(next: AuthState) { current.current = next; setState(next) }
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
    return () => { disposed = true; generation.current++; subscription.unsubscribe() }
  }, [queryClient])

  const signOut = async () => {
    generation.current++
    void queryClient.cancelQueries()
    queryClient.clear()
    current.current = emptyState
    setState(emptyState)
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }
  return <AuthContext.Provider value={{ ...state, signOut }}>{children}</AuthContext.Provider>
}
export const useAuth = () => useContext(AuthContext)
