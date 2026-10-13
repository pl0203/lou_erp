// The platform supplies existing server environment. Never expose or accept a service key.
// Browser Storage SELECT is denied; this bounded signer is the only user-facing mint path.
type Config = { url: string; anonKey: string; serviceKey: string }
type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' }
const answer = (status: number, body: unknown) => Response.json(body, { status, headers: cors })
export function createPromotionImageHandler(config: Config, fetcher: Fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return answer(405, { error: 'POST required' })
    const authorization = request.headers.get('authorization')
    if (!authorization || !/^Bearer \S+$/.test(authorization)) return answer(401, { error: 'Authentication required' })
    let body: Record<string, unknown>
    try {
      if (Number(request.headers.get('content-length') ?? 0) > 1024) return answer(400, { error: 'Invalid image request' })
      const text = await request.text()
      if (text.length > 1024) return answer(400, { error: 'Invalid image request' })
      body = JSON.parse(text)
      if (!body || Array.isArray(body) || Object.keys(body).join() !== 'promotion_id' || typeof body.promotion_id !== 'string' || !uuid.test(body.promotion_id)) return answer(400, { error: 'Promotion ID required' })
    } catch { return answer(400, { error: 'Invalid image request' }) }
    if (!config.url || !config.anonKey || !config.serviceKey) return answer(503, { error: 'Image service unavailable' })
    const origin = config.url.replace(/\/$/, '')
    try {
      const authorized = await fetcher(`${origin}/rest/v1/rpc/pilot_promotion_image_v1`, {
        method: 'POST', headers: { Authorization: authorization, apikey: config.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_promotion_id: body.promotion_id }), signal: AbortSignal.timeout(10_000),
      })
      if (!authorized.ok) return answer(authorized.status >= 500 ? 502 : 403, { error: 'Linked promotion image unavailable' })
      const image = await authorized.json()
      const parts = typeof image.path === 'string' ? image.path.split('/') : []
      if (image.version !== 1 || image.promotion_id !== body.promotion_id || image.bucket !== 'promotion-images' || image.expires_in !== 300 || parts.length !== 4 || parts[0] !== 'promotions' || !uuid.test(parts[1]) || parts[2] !== body.promotion_id || !/^[0-9a-f-]{36}\.(webp|png|jpg)$/.test(parts[3]) || !uuid.test(parts[3].split('.')[0])) return answer(502, { error: 'Invalid image authorization' })
      const storagePath = `/object/sign/promotion-images/${parts.map(encodeURIComponent).join('/')}`
      const signed = await fetcher(`${origin}/storage/v1${storagePath}`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 300 }), signal: AbortSignal.timeout(10_000),
      })
      if (!signed.ok) return answer(502, { error: 'Image signing unavailable' })
      const result = await signed.json()
      if (typeof result.signedURL !== 'string' || !result.signedURL.startsWith(`${storagePath}?token=`)) return answer(502, { error: 'Invalid signed image response' })
      return answer(200, { promotion_id: body.promotion_id, signed_url: `${origin}/storage/v1${result.signedURL}`, expires_in: 300 })
    } catch { return answer(503, { error: 'Image service unavailable; retry' }) }
  }
}
const platform = (globalThis as unknown as { Deno?: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void } }).Deno
if (platform) platform.serve(createPromotionImageHandler({ url: platform.env.get('SUPABASE_URL') ?? '', anonKey: platform.env.get('SUPABASE_ANON_KEY') ?? '', serviceKey: platform.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' }))
