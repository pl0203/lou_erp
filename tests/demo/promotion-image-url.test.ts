// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createPromotionImageHandler } from '../../supabase/functions/promotion-image-url/index'
const promotion = 'de500000-0000-0000-0000-000000000001'
const path = `promotions/de000000-0000-0000-0000-000000000001/${promotion}/de900000-0000-0000-0000-000000000001.webp`
const config = { url: 'https://synthetic.invalid', anonKey: 'synthetic-anon', serviceKey: 'synthetic-server' }
const request = (body: unknown = { promotion_id: promotion }) => new Request('https://function.invalid', { method: 'POST', headers: { Authorization: 'Bearer synthetic-user', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const metadata = { version: 1, promotion_id: promotion, bucket: 'promotion-images', path, expires_in: 300 }
describe('promotion image signer boundary', () => {
  it('signs only the canonical authorized path for exactly 300 seconds', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const handler = createPromotionImageHandler(config, async (url, init) => {
      calls.push({ url: String(url), init: init! })
      return Response.json(calls.length === 1 ? metadata : { signedURL: `/object/sign/promotion-images/${path}?token=synthetic-token` })
    })
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ promotion_id: promotion, signed_url: `https://synthetic.invalid/storage/v1/object/sign/promotion-images/${path}?token=synthetic-token`, expires_in: 300 })
    expect(calls[0].url).toBe('https://synthetic.invalid/rest/v1/rpc/pilot_promotion_image_v1')
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer synthetic-user' })
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ p_promotion_id: promotion })
    expect(calls[1].url).toBe(`https://synthetic.invalid/storage/v1/object/sign/promotion-images/${path}`)
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ expiresIn: 300 })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('rejects client paths or expiry overrides before making any service call', async () => {
    let calls = 0
    const handler = createPromotionImageHandler(config, async () => { calls++; return Response.json(metadata) })
    expect((await handler(request({ promotion_id: promotion, path, expires_in: 9999 }))).status).toBe(400)
    expect(calls).toBe(0)
  })
  it('does not sign when current SQL authorization denies an inactive or unlinked image', async () => {
    const calls: string[] = []
    const handler = createPromotionImageHandler(config, async url => { calls.push(String(url)); return Response.json({ error: 'denied' }, { status: 403 }) })
    expect((await handler(request())).status).toBe(403)
    expect(calls).toHaveLength(1)
  })
  it('reauthorizes each read; an earlier bearer URL is not claimed to be revoked', async () => {
    let authorized = true, signed = 0
    const handler = createPromotionImageHandler(config, async url => {
      if (String(url).includes('/rest/')) return authorized ? Response.json(metadata) : Response.json({}, { status: 403 })
      signed++; return Response.json({ signedURL: `/object/sign/promotion-images/${path}?token=old` })
    })
    const earlier = await (await handler(request())).json()
    authorized = false
    expect((await handler(request())).status).toBe(403)
    expect(signed).toBe(1)
    expect(earlier.expires_in).toBe(300)
  })
  it('rejects anonymous calls, malformed provider metadata, and signing errors without credential disclosure', async () => {
    const noAuth = new Request('https://function.invalid', { method: 'POST', body: '{}' })
    const handler = createPromotionImageHandler(config, async () => Response.json({ ...metadata, path: '../wrong' }))
    expect((await handler(noAuth)).status).toBe(401)
    const invalid = await handler(request())
    expect(invalid.status).toBe(502)
    expect(await invalid.text()).not.toContain(config.serviceKey)
    const failed = createPromotionImageHandler(config, async url => String(url).includes('/rest/') ? Response.json(metadata) : Response.json({ secret: config.serviceKey }, { status: 500 }))
    const response = await failed(request())
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain(config.serviceKey)
  })
})
