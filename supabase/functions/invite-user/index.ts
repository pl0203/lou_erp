import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const allowedRoles = ['executive', 'po_admin', 'sales_head', 'sales_manager', 'sales_person']
const managerRoles = ['executive', 'sales_head', 'sales_manager']
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})
function exactOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash || value.includes('*') ||
      value !== url.origin) return null
    return url.origin
  } catch { return null }
}
function optionalText(value: unknown, limit: number): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid optional text')
  return value.trim() || null
}
function payloadFrom(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid payload')
  const input = value as Record<string, unknown>
  if (typeof input.email !== 'string' || typeof input.full_name !== 'string' || typeof input.role !== 'string') throw new Error('Invalid required fields')
  const email = input.email.trim().toLowerCase()
  const full_name = input.full_name.trim()
  if (email.includes('*') || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !full_name || full_name.length > 200 || !allowedRoles.includes(input.role)) throw new Error('Invalid required fields')
  const phone = optionalText(input.phone, 50)
  const birth_date = optionalText(input.birth_date, 10)
  const manager_id = optionalText(input.manager_id, 36)
  if (birth_date && (!/^\d{4}-\d{2}-\d{2}$/.test(birth_date) || !Number.isFinite(Date.parse(birth_date)) || new Date(birth_date).toISOString().slice(0, 10) !== birth_date)) throw new Error('Invalid birth date')
  if (manager_id && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(manager_id)) throw new Error('Invalid manager')
  return { email, full_name, role: input.role, phone, birth_date, manager_id }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })
  let invitedUserId: string | null = null
  let inviteAttempted = false
  const partial = () => reply(502, {
    error: 'An invitation may already have been sent, but the user profile could not be created. Do not resend. Ask an administrator to reconcile this account.',
    code: 'INVITE_PROFILE_FAILED', may_have_sent: true, user_id: invitedUserId,
  })
  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return reply(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' })
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(authHeader.slice(7))
    if (userError || !user) return reply(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' })
    const { data: callerProfile, error: callerError } = await supabaseAdmin.from('users').select('role, is_active').eq('id', user.id).single()
    if (callerError || callerProfile?.role !== 'executive' || callerProfile.is_active !== true) return reply(403, { error: 'Only active executives can invite users', code: 'FORBIDDEN' })

    // Server configuration is the trust boundary. Never fall back to request Origin.
    const configured = (Deno.env.get('INVITE_REDIRECT_ORIGINS') ?? '').split(',').map(value => value.trim())
    if (!configured.length || configured.some(value => !exactOrigin(value))) return reply(503, { error: 'Invitation redirects are not configured. Contact the administrator.', code: 'INVITE_NOT_CONFIGURED' })
    const origin = req.headers.get('Origin')
    if (!origin || !exactOrigin(origin) || !configured.includes(origin)) return reply(400, { error: 'This invitation origin is not allowed.', code: 'INVALID_ORIGIN' })
    let payload: ReturnType<typeof payloadFrom>
    try { payload = payloadFrom(await req.json()) } catch { return reply(400, { error: 'Check the email, full name, role, date and manager fields.', code: 'INVALID_PAYLOAD' }) }

    // Detect ordinary duplicates before any email side effect. This is not an
    // atomic Auth/profile transaction or a cross-request idempotency guarantee.
    const escapedEmail = payload.email.replace(/[\\%_]/g, '\\$&')
    const { data: existing, error: duplicateError } = await supabaseAdmin.from('users').select('id').ilike('email', escapedEmail).limit(1).maybeSingle()
    if (duplicateError) return reply(503, { error: 'Unable to check existing accounts. No invitation was sent.', code: 'LOOKUP_FAILED' })
    if (existing) return reply(409, { error: 'This account already has a profile. Do not send another invitation; review the existing account.', code: 'PROFILE_EXISTS' })
    if (payload.manager_id) {
      const { data: manager, error: managerError } = await supabaseAdmin.from('users').select('role, is_active').eq('id', payload.manager_id).maybeSingle()
      if (managerError) return reply(503, { error: 'Unable to check the manager. No invitation was sent.', code: 'LOOKUP_FAILED' })
      if (!manager || !manager.is_active || !managerRoles.includes(manager.role)) return reply(400, { error: 'Select an active manager, sales head or executive.', code: 'INVALID_MANAGER' })
    }
    inviteAttempted = true
    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(payload.email, { redirectTo: `${origin}/reset-password` })
    if (inviteError) {
      const status = inviteError.status ?? 0
      if (inviteError.name !== 'AuthApiError' || ![400, 401, 403, 404, 409, 422, 429].includes(status)) throw new Error('Invitation outcome uncertain')
      return reply(status, { error: inviteError.message, code: 'INVITE_REJECTED' })
    }
    if (!invited?.user?.id) throw new Error('Invitation response missing identity')
    invitedUserId = invited.user.id
    const { error: profileError } = await supabaseAdmin.from('users').insert({ id: invitedUserId, ...payload, is_active: true, invited_at: new Date().toISOString() })
    if (profileError) return partial()
    return reply(200, { success: true, user_id: invitedUserId })
  } catch {
    if (invitedUserId) return partial()
    if (inviteAttempted) return reply(502, { error: 'The invitation outcome is unknown. Do not resend. Ask an administrator to check the account and email delivery.', code: 'INVITE_OUTCOME_UNKNOWN', may_have_sent: true })
    return reply(503, { error: 'Unable to prepare the invitation. No invitation was sent.', code: 'INVITE_UNAVAILABLE' })
  }
})
