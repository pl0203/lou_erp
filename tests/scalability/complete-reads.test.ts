// @vitest-environment node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
const file = resolve('src/lib/reads/completeReads.ts')
const api = existsSync(file) ? await import(file) : {}
const load = (...args: any[]) => {
  expect(api.readComplete, 'complete-reader implementation is required').toBeTypeOf('function')
  return api.readComplete(...args)
}
const key = (row: { id: number }) => String(row.id)

test('complete reader advances by actual received rows when API cap is below requested 500', async () => {
  const rows = Array.from({ length: 1001 }, (_, id) => ({ id })); const offsets: number[] = []
  const result = await load(async (offset: number, limit: number) => { expect(limit).toBe(500); offsets.push(offset); return { items: rows.slice(offset, offset + 100), total: rows.length } }, key)
  expect(result).toEqual(rows); expect(offsets).toEqual([0,100,200,300,400,500,600,700,800,900,1000])
})
test('complete reader returns a genuine empty collection', async () => {
  await expect(load(async () => ({ items: [], total: 0 }), key)).resolves.toEqual([])
})
test('complete reader propagates page failure instead of returning partial items', async () => {
  await expect(load(async (offset: number) => { if (offset) throw new Error('second page failed'); return { items: [{ id: 0 }], total: 2 } }, key)).rejects.toThrow('second page failed')
})
test('complete reader rejects an empty page before the exact total', async () => {
  await expect(load(async (offset: number) => ({ items: offset ? [] : [{ id: 0 }], total: 2 }), key)).rejects.toMatchObject({ code: 'READ_INCOMPLETE' })
})
test('complete reader rejects repeated identities instead of miscounting progress', async () => {
  await expect(load(async () => ({ items: [{ id: 0 }], total: 2 }), key)).rejects.toMatchObject({ code: 'READ_INCOMPLETE' })
})
test('complete reader restarts once when the collection count changes', async () => {
  let calls = 0
  const result = await load(async (offset: number) => { calls++; if (calls === 1) return { items: [{ id: 0 }], total: 2 }; return { items: [{ id: offset }], total: 3 } }, key)
  expect(result).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]); expect(calls).toBe(5)
})
test('complete reader refuses a second collection count change', async () => {
  let calls = 0
  await expect(load(async () => ({ items: [{ id: calls }], total: ++calls + 1 }), key)).rejects.toMatchObject({ code: 'READ_INCOMPLETE' })
  expect(calls).toBe(4)
})
for (const total of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) test(`complete reader rejects invalid total ${total}`, async () => {
  await expect(load(async () => ({ items: [], total }), key)).rejects.toMatchObject({ code: 'READ_INCOMPLETE' })
})
test('complete reader rejects rows beyond total', async () => {
  await expect(load(async () => ({ items: [{ id: 1 }], total: 0 }), key)).rejects.toMatchObject({ code: 'READ_INCOMPLETE' })
})
test('complete reader honors an already aborted signal without requesting data', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0
  await expect(load(async () => { calls++; return { items: [], total: 0 } }, key, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(calls).toBe(0)
})
test('complete reader honors cancellation during a page response', async () => {
  const controller = new AbortController()
  await expect(load(async (_offset: number, _limit: number, signal: AbortSignal) => { expect(signal).toBe(controller.signal); controller.abort(); return { items: [{ id: 1 }], total: 1 } }, key, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
test('ID chunks are deduplicated and bounded at 100 by default', () => {
  expect(api.chunkIds).toBeTypeOf('function')
  const ids = Array.from({ length: 201 }, (_, i) => String(i))
  const chunks = api.chunkIds([...ids, '0'])
  expect(chunks.map((x: string[]) => x.length)).toEqual([100,100,1])
  expect(chunks.flat()).toEqual(ids)
  expect(api.chunkIds([])).toEqual([])
  expect(() => api.chunkIds(ids, 0)).toThrow()
  expect(() => api.chunkIds(ids, 101)).toThrow()
})
