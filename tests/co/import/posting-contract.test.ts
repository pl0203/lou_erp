import { describe, expect, test, vi } from 'vitest'
import * as codecs from '../../../src/lib/co/import/manifest'
import { createTransactionSender } from '../../../src/lib/orderTransactions'
vi.mock('../../../src/lib/supabase', () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: { message: 'wrong transport' } })) } }))
const id = '11111111-1111-1111-1111-111111111111'
const binding = { importId: id, importVersion: '1', customerVersion: '4', draftId: id, draftVersion: '3', manifestDigest: 'a'.repeat(64) }
const post = { binding, previewFingerprint: 'b'.repeat(64), requestId: id, mode: 'edit', reason: 'Correct quantity' }
describe('versioned imported publication wire boundary', () => {
 test('strict detached post preserves the single UUID and decimal versions', () => {
  expect(codecs).toHaveProperty('decodeImportPost')
  const result = (codecs as any).decodeImportPost(post)
  expect(result).toEqual(post); expect(result.binding).not.toBe(binding)
 })
 test.each([{ ...post, requestId: 'new' }, { ...post, reason: ' ' }, { ...post, mode: 'manual' }, { ...post, additional: true }, { ...post, binding: { ...binding, draftVersion: 3 } }])('rejects malformed publication %#', value => {
  expect(codecs).toHaveProperty('decodeImportPost')
  expect(() => (codecs as any).decodeImportPost(value)).toThrow()
 })
 test('commit recovery preserves the ordinary five-field receipt and refuses prepare family', () => {
  expect(codecs).toHaveProperty('decodeImportRecovery')
  const receipt = { id, operation: 'correct_report', version: '2', customer_id: id, customer_version: '5' }
  expect((codecs as any).decodeImportRecovery({ status: 'committed', operation: 'correct_report', receipt })).toEqual({ status: 'committed', operation: 'correct_report', receipt })
  expect(() => (codecs as any).decodeImportRecovery({ status: 'committed', operation: 'prepare_import', binding })).toThrow()
  expect(() => (codecs as any).decodeImportRecovery({ status: 'unknown', receipt })).toThrow()
 })
 test('opt-in transport reuses durable UUID after ambiguity and abandons through same transport', async () => {
  localStorage.clear()
  const ids: string[] = []
  const transport = {
   send: async (requestId: string) => { ids.push(requestId); return { data: null, error: { message: 'lost' } } },
   reconcile: async (requestId: string, abandon: boolean) => { expect(requestId).toBe(ids[0]); expect(abandon).toBe(true); return { data: { state: 'abandoned' }, error: null } },
  }
  const options = { storage: () => localStorage, storageKey: 'import-contract', transport }
  await expect(createTransactionSender(options)('post_report', { private: 'evidence' })).rejects.toThrow('lost')
  const second = createTransactionSender(options)
  await expect(second('post_report', { private: 'evidence' })).rejects.toThrow('lost')
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1])
  expect(localStorage.getItem('import-contract')).not.toContain('evidence')
  expect(await second.reconcile()).toEqual({ state: 'abandoned' })
  expect(localStorage.getItem('import-contract')).toBeNull()
 })
})
test('explicit reopen acknowledgments are preserved and bounded, never inferred', () => {
 const acknowledgedReopenOrders = [{coId:id,expectedCoVersion:'7'}]
 expect((codecs as any).decodeImportPost({...post,acknowledgedReopenOrders})).toEqual({...post,acknowledgedReopenOrders})
 expect(() => (codecs as any).decodeImportPost({...post,acknowledgedReopenOrders:[...acknowledgedReopenOrders,...acknowledgedReopenOrders]})).toThrow()
})
test('prepare typed result transport preserves ImportBinding without pretending it is a receipt', async () => {
 localStorage.clear()
 const sender = createTransactionSender({storage:()=>localStorage,storageKey:'typed-prepare',retainCommitted:true,
  resultIdentity:(value:any)=>value.importId,
  transport:{send:async()=>({data:binding,error:null}),reconcile:async()=>({data:{state:'committed',operation:'prepare_import',result:binding},error:null})},
 } as any)
 expect(await sender('prepare_import',{private:'source'})).toEqual(binding)
 expect((await sender.reconcile()).result).toEqual(binding)
 expect(JSON.parse(localStorage.getItem('typed-prepare')!).committed).not.toHaveProperty('id')
 expect(localStorage.getItem('typed-prepare')).not.toContain('source')
})
test('read-only import preview binds draft/customer versions and required explicit reopens', () => {
 const summary = {sold_quantity:'5',revenue:'600',remaining_quantity:'5',complete:true}
 const value = {binding,previewFingerprint:'b'.repeat(64),issues:[],requiredReopenOrders:[{coId:id,expectedCoVersion:'7'}],existingPreview:{version:'1',as_of:'2026-10-26T00:00:00Z',operation:'correct_report',customer_id:id,customer_version:'4',draft_version:'3',preview_fingerprint:'c'.repeat(64),can_post:false,before:summary,after:summary,counts:{report:'1',stock:'1',revenue:'1',credit:'2',reopen:'1',issue:'1',missing_month:'0'}}}
 expect((codecs as any).decodeImportPreview(value)).toEqual(value)
 expect(() => (codecs as any).decodeImportPreview({...value,existingPreview:{...value.existingPreview,draft_version:'9'}})).toThrow()
})
test('explicit review selection codecs keep current selection separate from immutable binding', () => {
 expect(codecs).toHaveProperty('decodeImportSelection')
 const value = {version:'1',selectionId:id,state:'review_open',importId:null,draftId:id,draftVersion:'8',customerVersion:'5',reportHeadId:id,originalRevisionId:id,reportVersion:'2'}
 expect((codecs as any).decodeImportSelection(value)).toEqual(value)
 expect(() => (codecs as any).decodeImportSelection({...value,state:'selected'})).toThrow()
 expect(() => (codecs as any).decodeImportSelection({...value,reportVersion:null})).toThrow()
})
