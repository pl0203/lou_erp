// @vitest-environment node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
const file = resolve('src/lib/reads/literalSearch.ts')
const api = existsSync(file) ? await import(file) : {}
function build(value: string) { expect(api.literalSearchFilter).toBeTypeOf('function'); return api.literalSearchFilter(['name', 'sku'], value) }
// Independent small decoder for the two quoted PostgREST values, not SQL execution.
function terms(filter: string): string[] {
  const result: string[] = []; let value = ''; let quoted = false; let escaped = false
  for (const char of filter) {
    if (escaped) { value += char; escaped = false }
    else if (quoted && char === '\\') escaped = true
    else if (char === '"') quoted = !quoted
    else if (!quoted && char === ',') { result.push(value); value = '' }
    else value += char
  }
  expect(quoted).toBe(false); expect(escaped).toBe(false); result.push(value); return result
}
for (const input of ['Common name', '100%_size*', 'a,b(c):d', 'Quote:" and slash:\\', '(?i).*|secret', 'x",or(name.eq.secret),name.eq."y', 'PT Àçme 中文', 'line\nbreak']) {
  test(`catalog search serializes literal input ${JSON.stringify(input)} into exactly two conditions`, () => {
    expect(terms(build(input))).toEqual([`name.imatch.***=${input}`, `sku.imatch.***=${input}`])
  })
}
test('catalog filter rejects unrecognized column expressions', () => {
  expect(api.literalSearchFilter).toBeTypeOf('function')
  expect(() => api.literalSearchFilter(['name),or(id'], 'value')).toThrow()
  expect(() => api.literalSearchFilter([], 'value')).toThrow()
})
test('Supabase transports the filter with exactly one URL-encoding layer', async () => {
  const filter = build('a%_*,"\\(b)')
  let received: URL | undefined
  const client = createClient('https://example.invalid', 'synthetic-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => { received = new URL(String(input)); return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) } },
  })
  await client.from('products').select('id').or(filter).range(0, 9)
  expect(received!.searchParams.get('or')).toBe(`(${filter})`)
})
