import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create admin client using service role key
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verify the calling user is an executive
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userError || !user) throw new Error('Unauthorized')

    const { data: callerProfile } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (callerProfile?.role !== 'executive') {
      throw new Error('Only executives can invite users')
    }

    // Get invite payload
    const { email, full_name, role, phone, birth_date, manager_id } = await req.json()

    if (!email || !full_name || !role) {
      throw new Error('email, full_name and role are required')
    }

    // Invite user via Supabase Auth (sends email with password setup link)
    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      { redirectTo: `${req.headers.get('origin')}/reset-password` }
    )
    if (inviteError) throw inviteError

    // Create user profile in public.users
    const { error: profileError } = await supabaseAdmin
      .from('users')
      .insert({
        id: invited.user.id,
        full_name,
        email,
        role,
        phone: phone || null,
        birth_date: birth_date || null,
        manager_id: manager_id || null,
        is_active: true,
        invited_at: new Date().toISOString(),
      })
    if (profileError) throw profileError

    return new Response(
      JSON.stringify({ success: true, user_id: invited.user.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})