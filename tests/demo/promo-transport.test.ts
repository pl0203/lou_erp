import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
import { createTransactionSender } from '../../src/lib/orderTransactions'
const id = '11111111-1111-4111-8111-111111111111'
const details = { code: 'PROMO_STOCK_WARNING', shortages: [{ promotion_id: id, product_id: id, product_name: 'Product', sku: 'SKU', remaining_quantity: 2, requested_quantity: 5, incremental_quantity: 5, shortfall: 3, stock_version: 1 }], ack: { version: 1, stocks: [{ promotion_id: id, stock_version: 1 }], payload_hash: 'opaque' } }
beforeEach(() => { mocks.rpc.mockReset(); localStorage.clear() })
test('confirmed SQL shortage keeps its typed facts and releases request identity', async () => {
 const send = createTransactionSender()
 mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'promo stock shortage', details: JSON.stringify(details) } })
 await expect(send('create_po', { items: [{ product_id: id, quantity: 5, unit_price: 71 }] })).rejects.toMatchObject({ name: 'PromoStockWarningError', warning: details })
 expect(send.hasUnresolved()).toBe(false)
})
test('Continue sends unchanged draft plus opaque ack with a fresh request after refusal', async () => {
 const send = createTransactionSender(); const draft = { notes: 'keep me', items: [{ product_id: id, quantity: 5, unit_price: 0 }] }
 mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'warning', details: JSON.stringify(details) } }).mockResolvedValueOnce({ data: { id }, error: null })
 await expect(send('create_po', draft)).rejects.toThrow()
 await send('create_po', { ...draft, promo_stock_ack: details.ack })
 const [first, second] = mocks.rpc.mock.calls.map(call => call[1])
 expect(second.p_request_id).not.toBe(first.p_request_id)
 expect(second.p_payload).toEqual({ ...first.p_payload, promo_stock_ack: details.ack })
 expect(draft.items[0].unit_price).toBe(0)
})
test('malformed warning details cannot enable Continue', async () => {
 for (const broken of ['not JSON', JSON.stringify({ ...details, shortages: [{ ...details.shortages[0], remaining_quantity: -1 }] }), JSON.stringify({ ...details, ack: null }), JSON.stringify({ ...details, shortages: [] })]) {
  const send = createTransactionSender(); mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'warning', details: broken } })
  await expect(send('create_po', {})).rejects.not.toMatchObject({ name: 'PromoStockWarningError' })
 }
})
test('a network warning-shaped error must reconcile before any changed payload', async () => {
 const send = createTransactionSender({ storage: () => localStorage, storageKey: 'promo-network' })
 mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'response lost', details: JSON.stringify(details) } })
 await expect(send('create_po', { notes: 'private note' })).rejects.toThrow('response lost')
 expect(localStorage.getItem('promo-network')).not.toContain('private note')
 expect(send.hasUnresolved()).toBe(true)
 await expect(send('create_po', { notes: 'changed' })).rejects.toThrow('belum terkonfirmasi')
 mocks.rpc.mockResolvedValueOnce({ data: { state: 'abandoned' }, error: null })
 await send.reconcile(); expect(send.hasUnresolved()).toBe(false)
 mocks.rpc.mockResolvedValueOnce({ data: { id }, error: null }); await send('create_po', { notes: 'changed' })
 expect(mocks.rpc.mock.calls[1][0]).toBe('pilot_reconcile_request')
})
test.each([
 ['pilot_promotion_transaction_v1', 'pilot_reconcile_promotion_v1'],
 ['pilot_schedule_transaction_v1', 'pilot_reconcile_schedule_v1'],
] as const)('named %s family retains strict receipt and recovery behavior', async (rpcName, recoveryRpcName) => {
 const send = createTransactionSender({ rpcName, recoveryRpcName })
 mocks.rpc.mockResolvedValueOnce({ data: {}, error: null })
 await expect(send('operation', {})).rejects.toThrow('Respons penyimpanan tidak valid')
 expect(send.hasUnresolved()).toBe(true)
 mocks.rpc.mockResolvedValueOnce({ data: { state: 'committed', result: {} }, error: null })
 await expect(send.reconcile()).rejects.toThrow('Hasil pemulihan tidak valid')
 expect(mocks.rpc.mock.calls[0][0]).toBe(rpcName); expect(mocks.rpc.mock.calls[1][0]).toBe(recoveryRpcName)
})
test('PO readback rejects omitted or invalid product identity while preserving nullable noncatalog lines', async () => {
 const { fetchPOLinePage } = await import('../../src/lib/reads/orders')
 const line = { id, product_name: 'Product', sku: 'SKU', quantity: 1, unit_price: '0', line_total: '0', delivered_quantity: 0, has_delivery_history: false }
 const envelope = { version: 1, as_of: '2026-10-08T12:00:00Z', po_updated_at: '2026-10-08T12:00:00Z', po_has_delivery_history: false, items: [line], total: 1, page: 1, page_size: 100 }
 mocks.rpc.mockResolvedValue({ data: envelope, error: null })
 await expect(fetchPOLinePage(id, 1)).rejects.toThrow(/identitas produk/i)
 mocks.rpc.mockResolvedValue({ data: { ...envelope, items: [{ ...line, product_id: null }] }, error: null })
 expect((await fetchPOLinePage(id, 1)).items[0].product_id).toBeNull()
 mocks.rpc.mockResolvedValue({ data: { ...envelope, items: [{ ...line, product_id: id }] }, error: null })
 expect((await fetchPOLinePage(id, 1)).items[0].product_id).toBe(id)
})
test('empty receipt IDs cannot consume request identity on write or recovery', async () => {
 const send = createTransactionSender(); mocks.rpc.mockResolvedValueOnce({ data: { id: '' }, error: null })
 await expect(send('create_po', {})).rejects.toThrow('Respons penyimpanan tidak valid'); expect(send.hasUnresolved()).toBe(true)
 mocks.rpc.mockResolvedValueOnce({ data: { state: 'committed', result: { id: '' } }, error: null })
 await expect(send.reconcile()).rejects.toThrow('Hasil pemulihan tidak valid'); expect(send.hasUnresolved()).toBe(true)
})
const allocation = (changes = {}) => ({ product_id: id, product_name: 'Tiles', sku: 'SKU', promotion_id: id, stock_version: 2, remaining_quantity: 9, requested_quantity: 5, incremental_quantity: 5, allocation_quantity: 5, ...changes })
const changedQuote = (paused = false) => ({ code: 'PROMO_STOCK_CHANGED', shortages: [], allocations: [allocation(paused ? { promotion_id: null, stock_version: null, remaining_quantity: 0, allocation_quantity: 0 } : {})], ack: { version: 1, allocations: [allocation(paused ? { promotion_id: null, stock_version: null, remaining_quantity: 0, allocation_quantity: 0 } : {})], payload_hash: 'fresh quote' } })
test.each([['paused campaign', true], ['shortage-free replenishment', false]] as const)('%s stale quote remains an actionable typed refusal requiring a fresh acknowledgment', async (_case, paused) => {
 const send = createTransactionSender(); const draft = { notes: 'preserved', items: [{ product_id: id, quantity: 5, unit_price: 71 }] }
 const changed = changedQuote(paused)
 mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'old quote', details: JSON.stringify(changed) } }).mockResolvedValueOnce({ data: { id }, error: null })
 await expect(send('create_po', { ...draft, promo_stock_ack: details.ack })).rejects.toMatchObject({ name: 'PromoStockWarningError', code: 'PROMO_STOCK_CHANGED', warning: changed })
 expect(send.hasUnresolved()).toBe(false)
 await send('create_po', { ...draft, promo_stock_ack: changed.ack })
 const [refused, continued] = mocks.rpc.mock.calls.map(call => call[1])
 expect(continued.p_request_id).not.toBe(refused.p_request_id)
 expect(continued.p_payload).toEqual({ ...draft, promo_stock_ack: changed.ack })
})
test('changed quote without incremental catalog demand still requires explicit review', async () => {
 const send = createTransactionSender(); const changed = { code: 'PROMO_STOCK_CHANGED', shortages: [], allocations: [], ack: { version: 1, allocations: [], payload_hash: 'no demand' } }
 mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'old quote', details: JSON.stringify(changed) } })
 await expect(send('edit_po', { promo_stock_ack: details.ack })).rejects.toMatchObject({ name: 'PromoStockWarningError', code: 'PROMO_STOCK_CHANGED', warning: changed })
})
test('malformed changed allocation facts cannot enable Continue', async () => {
 for (const row of [allocation({ allocation_quantity: 6 }), allocation({ requested_quantity: 4 }), allocation({ promotion_id: null }), allocation({ stock_version: null }), allocation({ promotion_id: null, stock_version: null, remaining_quantity: 1, allocation_quantity: 0 }), allocation({ remaining_quantity: -1 })]) {
  const send = createTransactionSender(); const changed = { ...changedQuote(), allocations: [row] }
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'old quote', details: JSON.stringify(changed) } })
  await expect(send('create_po', {})).rejects.not.toMatchObject({ name: 'PromoStockWarningError' })
 }
})
test('changed-quote-shaped network errors must reconcile before new data or acknowledgment', async () => {
 const send = createTransactionSender(); mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'response lost', details: JSON.stringify(changedQuote()) } })
 await expect(send('create_po', { notes: 'draft' })).rejects.toThrow('response lost'); expect(send.hasUnresolved()).toBe(true)
 await expect(send('create_po', { notes: 'changed', promo_stock_ack: changedQuote().ack })).rejects.toThrow('belum terkonfirmasi')
 expect(mocks.rpc).toHaveBeenCalledTimes(1)
})
test('a normal initial PO without an enabled promotion does not require an acknowledgment', async () => {
 const send = createTransactionSender(); mocks.rpc.mockResolvedValueOnce({ data: { id }, error: null })
 await expect(send('create_po', { items: [{ product_id: null, quantity: 5, unit_price: 71 }] })).resolves.toEqual({ id })
 expect(mocks.rpc.mock.calls[0][1].p_payload).not.toHaveProperty('promo_stock_ack')
})
test('replacement campaign uses its refreshed identity and may still have a shortage', async () => {
 const replacementId = '22222222-2222-4222-8222-222222222222'
 const row = allocation({ promotion_id: replacementId, stock_version: 1, remaining_quantity: 2, allocation_quantity: 2 })
 const changed = { code: 'PROMO_STOCK_CHANGED', shortages: [{ ...details.shortages[0], promotion_id: replacementId, stock_version: 1 }], allocations: [row], ack: { version: 1, allocations: [row], shortages: [{ ...details.shortages[0], promotion_id: replacementId, stock_version: 1 }], payload_hash: 'replacement' } }
 const send = createTransactionSender(); mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'changed campaign', details: JSON.stringify(changed) } })
 await expect(send('create_po', { promo_stock_ack: details.ack })).rejects.toMatchObject({ name: 'PromoStockWarningError', code: 'PROMO_STOCK_CHANGED', warning: changed })
})
