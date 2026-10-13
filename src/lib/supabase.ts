import { createClient } from '@supabase/supabase-js'
import { preparePasswordSetup, updateBoundPassword } from './passwordSetup'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let passwordSetupUrl = window.location.href
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
const passwordSetupIdentity = preparePasswordSetup(supabase.auth, passwordSetupUrl)
passwordSetupUrl = '' // Do not retain callback credentials in module state.
export const getPasswordSetupIdentity = () => passwordSetupIdentity
export const updatePasswordForSetup = (userId: string, password: string) => updateBoundPassword(
  supabase.auth,
  () => createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `password-setup-${crypto.randomUUID()}` },
  }).auth,
  userId,
  password,
)
