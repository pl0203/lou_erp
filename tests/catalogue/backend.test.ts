import { createClient } from '@supabase/supabase-js'
import { expect, test, vi } from 'vitest'
import { createCatalogueBackend } from '../../src/lib/catalogue/backend'
let sequence = 0
function actualClient(url = 'https://catalogue.example.invalid/') { return createClient(url, 'fictional-anon-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `fictional-catalogue-${++sequence}` } }) }
test('backend label and abortable RPC derive from the same actual client without ambient configuration', async () => {
 const client = actualClient(), response = { version: 1 }, calls: string[] = []
 vi.stubGlobal('fetch', vi.fn(async (request: Request) => { calls.push(typeof request === 'string' ? request : request.url); return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } }) }))
 const backend = createCatalogueBackend(client), controller = new AbortController()
 expect(backend.backend).toBe('https://catalogue.example.invalid')
 expect((await backend.rpc('pilot_catalog_page_v1', { p_kind: 'product' }, controller.signal)).data).toEqual(response)
 expect(calls).toEqual(['https://catalogue.example.invalid/rest/v1/rpc/pilot_catalog_page_v1'])
})
test('no native cross-context lock means no action, never a module mutex fallback', async () => {
 vi.stubGlobal('navigator', {}); const action = vi.fn(async () => 'saved')
 await expect(createCatalogueBackend(actualClient()).withExclusiveLock('scope', action)).rejects.toThrow()
 expect(action).not.toHaveBeenCalled()
})
test('native exclusive lock remains owned until action settles and validates granted lock', async () => {
 const action = vi.fn(async () => 'saved'), request = vi.fn(async (name, options, callback) => { expect(options).toEqual({ mode: 'exclusive' }); return callback({ name, mode: 'exclusive' }) })
 vi.stubGlobal('navigator', { locks: { request } }); const backend = createCatalogueBackend(actualClient())
 expect(await backend.withExclusiveLock('scope', action)).toBe('saved'); expect(request.mock.calls[0][0]).toContain('scope')
 request.mockImplementation(async (_n, _o, callback) => callback(null)); await expect(backend.withExclusiveLock('scope', action)).rejects.toThrow(); expect(action).toHaveBeenCalledTimes(1)
})
test('client endpoint drift or unknown RPC refuses before dispatch', async () => {
 const client = actualClient(), backend = createCatalogueBackend(client); (client as any).supabaseUrl = 'https://other.example.invalid'
 await expect(backend.rpc('pilot_catalog_page_v1', {})).rejects.toThrow()
 await expect(createCatalogueBackend(actualClient()).rpc('legacy_write' as any, {})).rejects.toThrow()
})

test('REST endpoint/schema mismatch and drift cannot hide behind a matching constructor label', async () => {
 const client = actualClient(); (client as any).rest.url = 'https://other.example.invalid/rest/v1'
 expect(() => createCatalogueBackend(client)).toThrow()
 const original = actualClient(), backend = createCatalogueBackend(original); (original as any).rest.schemaName = 'private'
 await expect(backend.rpc('pilot_catalog_page_v1', {})).rejects.toThrow()
})

test('native request cannot report success before the complete action settles', async () => {
 let finish!: (value: string) => void
 const action = vi.fn(() => new Promise<string>(yes => { finish = yes }))
 const request = vi.fn(async (name, _options, callback) => callback({ name, mode: 'exclusive' }))
 vi.stubGlobal('navigator', { locks: { request } }); const backend = createCatalogueBackend(actualClient())
 let settled = false; const result = backend.withExclusiveLock('held', action).finally(() => { settled = true })
 await Promise.resolve(); expect(settled).toBe(false); finish('done'); expect(await result).toBe('done')
 request.mockImplementation(async () => undefined as any)
 await expect(backend.withExclusiveLock('not-granted', action)).rejects.toThrow(); expect(action).toHaveBeenCalledTimes(1)
})
