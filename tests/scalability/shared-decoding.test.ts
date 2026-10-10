// @vitest-environment node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { RESPONSE_ARGS, RESPONSE_EXAMPLES } from './response-examples'
import type { ReadRpcName } from '../../src/lib/reads/contracts'
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))
const file = resolve('src/lib/reads/rpc.ts')
const api = existsSync(file) ? await import(file) : {}

for (const name of Object.keys(RESPONSE_EXAMPLES) as ReadRpcName[]) test(`decoder accepts the shared ${name} wire example`, () => {
  expect(api.decodeRead).toBeTypeOf('function')
  expect(api.decodeRead(name, RESPONSE_ARGS[name], structuredClone(RESPONSE_EXAMPLES[name]))).toEqual(RESPONSE_EXAMPLES[name])
})

const mutations: [string, (page: any) => void][] = [
  ['missing version', page => { delete page.version }],
  ['unsafe exact count', page => { page.total = Number.MAX_SAFE_INTEGER + 1 }],
  ['negative count', page => { page.total = -1 }],
  ['wrong page', page => { page.page = 2 }],
  ['truncated required page', page => { page.items = [] }],
  ['numeric money', page => { page.items[0].total_value = 100 }],
]
for (const [label, mutate] of mutations) test(`decoder rejects ${label} instead of accepting partial or unsafe data`, () => {
  expect(api.decodeRead).toBeTypeOf('function')
  const page = structuredClone(RESPONSE_EXAMPLES.pilot_po_page_v1)
  mutate(page)
  expect(() => api.decodeRead('pilot_po_page_v1', RESPONSE_ARGS.pilot_po_page_v1, page)).toThrow()
})
