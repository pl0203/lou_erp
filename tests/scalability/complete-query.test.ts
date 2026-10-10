// @vitest-environment node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
const file = resolve('src/lib/reads/completeQuery.ts')
const api = existsSync(file) ? await import(file) : {}
const read = (...args: any[]) => { expect(api.readCompleteQuery).toBeTypeOf('function'); return api.readCompleteQuery(...args) }
const key = (row: { id: string }) => row.id
test('query bridge collects independently capped exact-count responses', async () => {
  const rows = [{ id: 'a' }, { id: 'b' }]
  expect(await read((offset: number) => Promise.resolve({ data: rows.slice(offset, offset + 1), count: 2, error: null }), key)).toEqual(rows)
})
test('query bridge preserves the exact backend error', async () => {
  const error = { code: '42501', message: 'denied' }
  await expect(read(() => Promise.resolve({ data: null, count: null, error }), key)).rejects.toBe(error)
})
for (const result of [{ data: [], count: null, error: null }, { data: null, count: 0, error: null }]) test('query bridge rejects absent count or row payload', async () => {
  await expect(read(() => Promise.resolve(result), key)).rejects.toMatchObject({ code: 'READ_INCOMPLETE' })
})
test('query bridge forwards an abort signal to supporting query builders', async () => {
  const controller = new AbortController(); let received: AbortSignal | undefined
  const q: any = Promise.resolve({ data: [], count: 0, error: null }); q.abortSignal = (signal: AbortSignal) => { received = signal; return q }
  expect(await read(() => q, key, controller.signal)).toEqual([])
  expect(received).toBe(controller.signal)
})
