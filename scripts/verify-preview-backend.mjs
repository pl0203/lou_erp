// Runs before Vite loads .env. Never print URL/key values in diagnostics.
// https://vercel.com/docs/environment-variables/system-environment-variables
const env = process.env
if (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'fix/pilot-database') {
  const fail = () => {
    console.error('Database preview build blocked: explicit staging Supabase URL and publishable/anon client key are required in the build environment.')
    process.exit(1)
  }
  const expectedRef = 'mqfpupsuthghubkeiuey'
  let url
  try { url = new URL(env.VITE_SUPABASE_URL ?? '') } catch { fail() }
  if (url.origin !== `https://${expectedRef}.supabase.co` || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail()
  const key = env.VITE_SUPABASE_ANON_KEY ?? ''
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    // Format/scope check only, not cryptographic verification. Never accept a
    // service-role/secret key in browser configuration. The API verifies signing.
    const parts = key.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) fail()
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      if (header.alg !== 'HS256' || claims.role !== 'anon' || claims.ref !== expectedRef) fail()
    } catch { fail() }
  }
  console.info('Database preview backend guard passed.')
}
