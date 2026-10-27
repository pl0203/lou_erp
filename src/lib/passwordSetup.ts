import type { SupabaseClient } from '@supabase/supabase-js'

export type PasswordSetupResult = {
  identity: { userId: string; email: string } | null
  error: string | null
}
const invalidLink = 'Tautan tidak valid atau kedaluwarsa. Minta tautan undangan atau reset kata sandi baru.'

// Capture the URL before Auth initializes and removes its fragment. A stored
// session alone is never evidence that an invitation/recovery link succeeded.
export async function preparePasswordSetup(
  auth: Pick<SupabaseClient['auth'], 'initialize' | 'getSession'>,
  callbackUrl: string,
): Promise<PasswordSetupResult> {
  const denied = { identity: null, error: invalidLink }
  try {
    const url = new URL(callbackUrl)
    const params = new URLSearchParams(url.hash.slice(1))
    if (url.pathname !== '/reset-password' ||
      ['error', 'error_code', 'error_description'].some(key => params.has(key) || url.searchParams.has(key)) ||
      !['invite', 'recovery'].includes(params.get('type') ?? '') ||
      !params.get('access_token') || !params.get('refresh_token') ||
      params.get('token_type') !== 'bearer' || !/^\d+$/.test(params.get('expires_in') ?? '') ||
      Number(params.get('expires_in')) <= 0) return denied

    const { error: initializationError } = await auth.initialize()
    if (initializationError) return denied
    const { data: { session }, error } = await auth.getSession()
    if (error || !session?.user?.id || session.access_token !== params.get('access_token')) return denied
    return { identity: { userId: session.user.id, email: session.user.email ?? '' }, error: null }
  } catch {
    return denied
  }
}

export async function updateBoundPassword(
  sourceAuth: Pick<SupabaseClient['auth'], 'getSession'>,
  createScopedAuth: () => Pick<SupabaseClient['auth'], 'setSession' | 'updateUser' | 'stopAutoRefresh'>,
  userId: string,
  password: string,
): Promise<{ error: string | null; sessionChanged: boolean }> {
  const changed = { error: 'Sesi akun berubah. Buka kembali tautan undangan atau reset kata sandi yang valid.', sessionChanged: true }
  const { data: { session }, error } = await sourceAuth.getSession()
  if (error || session?.user.id !== userId || !session.access_token || !session.refresh_token) return changed
  // updateUser on the shared client would read mutable browser storage again.
  // The scoped client has its own memory-only session, so an account switch in
  // another tab cannot redirect this password write to that other account.
  const scoped = createScopedAuth()
  try {
    const { data, error: setupError } = await scoped.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
    if (setupError || data.user?.id !== userId) return changed
    const { error: updateError } = await scoped.updateUser({ password })
    return { error: updateError?.message ?? null, sessionChanged: false }
  } finally {
    await scoped.stopAutoRefresh()
  }
}
