import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), invoke: vi.fn(), items: [] as any[], role: 'po_admin', from: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from, storage: { from: () => ({ upload: mocks.upload }) }, functions: { invoke: mocks.invoke } } }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: mocks.role, is_active: true }, loading: false }) }))
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('react-router-dom', () => ({ useBlocker: () => ({ state: 'unblocked' }), useBeforeUnload: () => {} }))
import { fetchPromotions, isCurrentlyActive } from '../../src/lib/promotions'
import * as api from '../../src/lib/promotionTransactions'
import Page from '../../src/pages/athel/Promotions'
const SalesPage = (await import('../../src/pages/girard/Promotions')).default
const id = '11111111-1111-4111-8111-111111111111', actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const item = (changes = {}) => ({ id, product_id: id, product_name: 'Tiles', sku: 'SKU', size: null, start_date: '2020-01-01', end_date: '2020-01-02', is_active: true, stock_managed: true, remaining_quantity: 3, stock_version: 1, image_path: `promotions/${actor}/${id}/22222222-2222-4222-8222-222222222222.png`, harga_pokok: null, luar_kota: 0, dalam_kota: 71, depo_bangunan: null, ...changes })
const clients: QueryClient[] = []
beforeEach(() => {
 mocks.rpc.mockReset().mockImplementation((_name, args) => { const result = Promise.resolve(args?.p_operation ? { data: { id: args.p_payload.id ?? args.p_payload.promotion_id, stock_version: 2 }, error: null } : { data: { version: 1, as_of: '2026-10-08T12:00:00Z', items: mocks.items }, error: null }); return Object.assign(result, { abortSignal: () => result }) })
 mocks.upload.mockReset().mockResolvedValue({ error: null }); mocks.invoke.mockReset().mockResolvedValue({ data: { promotion_id: id, signed_url: 'https://example.invalid/image', expires_in: 300 }, error: null }); mocks.items = [item()]; mocks.role = 'po_admin'; localStorage.clear()
 mocks.from.mockImplementation(() => { const q: any = { select: () => q, order: () => q, range: () => q, abortSignal: () => q, then: (resolve: any) => resolve({ data: [{ id, name: 'Tiles', sku: 'SKU', size: null, harga_pokok: null, luar_kota: 0, dalam_kota: 71, depo_bangunan: null }], count: 1, error: null }) }; return q })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()) })
const file = () => new File(['image'], 'example.png', { type: 'image/png' })
function mount(component = Page) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client); const Component = component; render(<QueryClientProvider client={client}><Component /></QueryClientProvider>) }
test('managed stock ignores legacy dates; exhausted and paused are separate states', () => {
 expect(isCurrentlyActive(item())).toBe(true); expect(isCurrentlyActive(item({ remaining_quantity: 0 }))).toBe(false); expect(isCurrentlyActive(item({ is_active: false }))).toBe(false)
})
test('promotion reads use the authorized versioned RPC and preserve missing/zero prices', async () => {
 const rows = await fetchPromotions(undefined, true)
 expect(mocks.rpc).toHaveBeenCalledWith('pilot_promotions_v1', { p_include_inactive: true })
 expect(rows[0]).toMatchObject({ remaining_quantity: 3, harga_pokok: null, luar_kota: 0, products: { name: 'Tiles', sku: 'SKU' } })
})
test('create links an immutable private upload before publication and preserves zero tier prices', async () => {
 expect(api.createPromotion).toBeTypeOf('function')
 const send = vi.fn().mockResolvedValue({ id, stock_version: 1 })
 await api.createPromotion({ id, product_id: id, opening_quantity: 3, harga_pokok: null, luar_kota: 0, dalam_kota: 71, depo_bangunan: null, is_active: true }, file(), actor, send)
 expect(mocks.upload).toHaveBeenCalledOnce()
 expect(mocks.upload.mock.calls[0][0]).toMatch(new RegExp(`^promotions/${actor}/${id}/[0-9a-f-]+\\.png$`))
 expect(mocks.upload.mock.calls[0][2]).toEqual({ contentType: 'image/png', upsert: false })
 expect(send).toHaveBeenCalledWith('create_promotion', expect.objectContaining({ id, product_id: id, opening_quantity: 3, luar_kota: 0, harga_pokok: null, image_path: mocks.upload.mock.calls[0][0] }))
})
test('failed replacement upload preserves the old linked image and sends no edit', async () => {
 expect(api.editPromotion).toBeTypeOf('function'); mocks.upload.mockResolvedValue({ error: { message: 'Upload failed' } })
 const current = item(); const send = vi.fn()
 await expect(api.editPromotion(current, { harga_pokok: null, luar_kota: 0, dalam_kota: 71, depo_bangunan: null }, file(), actor, send)).rejects.toThrow('Upload failed')
 expect(send).not.toHaveBeenCalled(); expect(current.image_path).toBe(item().image_path)
})
test('uploaded replacement is not shown as linked if edit outcome is ambiguous', async () => {
 expect(api.editPromotion).toBeTypeOf('function'); const current = item(); const send = vi.fn().mockRejectedValue(new Error('response lost'))
 await expect(api.editPromotion(current, { harga_pokok: null, luar_kota: 0, dalam_kota: 71, depo_bangunan: null }, file(), actor, send)).rejects.toThrow('response lost')
 expect(current.image_path).toBe(item().image_path); expect(send.mock.calls[0][1].image_path).not.toBe(current.image_path)
})
test('stock adjustment rejects blank reason before transport', async () => {
 expect(api.adjustPromotionStock).toBeTypeOf('function'); const send = vi.fn()
 await expect(api.adjustPromotionStock(item(), 2, ' ', send)).rejects.toThrow(/alasan/i); expect(send).not.toHaveBeenCalled()
 await api.adjustPromotionStock(item(), 2, 'Opening correction', send)
 expect(send).toHaveBeenCalledWith('adjust_stock', { promotion_id: id, expected_stock_version: 1, quantity_delta: 2, reason: 'Opening correction' })
})
test('Athel create form requires opening stock and image while keeping blank/zero prices distinct', async () => {
 mount(); fireEvent.click(screen.getByRole('button', { name: /Tambah Promosi/ }))
 await screen.findByRole('option', { name: /Tiles/ })
 fireEvent.change(screen.getByLabelText('Produk'), { target: { value: id } })
 expect((screen.getByLabelText('Harga Pokok (Rp)') as HTMLInputElement).value).toBe('')
 expect((screen.getByLabelText('Luar Kota (Rp)') as HTMLInputElement).value).toBe('0')
 fireEvent.change(screen.getByLabelText('Stok awal'), { target: { value: '5' } })
 fireEvent.change(screen.getByLabelText('Gambar promosi'), { target: { files: [file()] } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan promosi' }))
 await waitFor(() => expect(mocks.rpc.mock.calls.some(call => call[1]?.p_operation === 'create_promotion')).toBe(true))
 const payload = mocks.rpc.mock.calls.find(call => call[1]?.p_operation === 'create_promotion')![1].p_payload
 expect(payload).toMatchObject({ opening_quantity: 5, harga_pokok: null, luar_kota: 0 })
})
test('read-only Sales highlights expose stock and images without create, ordering, or mutations', async () => {
 mocks.role = 'sales_head'; mount(SalesPage)
 await screen.findByText('Tiles'); expect(screen.getByText(/Stok tersedia: 3/)).toBeTruthy()
 expect(screen.queryByRole('button', { name: /Tambah Promosi|Aktifkan|Hapus|Tambah ke/ })).toBeNull()
 expect(mocks.rpc.mock.calls.some(call => call[1]?.p_operation)).toBe(false)
})
test('signer request accepts only canonical promotion ID and fixed five-minute response', async () => {
 const { fetchPromotionImage } = await import('../../src/lib/promotions')
 expect(await fetchPromotionImage(id)).toBe('https://example.invalid/image')
 expect(mocks.invoke).toHaveBeenCalledWith('promotion-image-url', { body: { promotion_id: id } })
 for (const bad of [{ promotion_id: id, signed_url: 'https://example.invalid/image', expires_in: 301 }, { promotion_id: actor, signed_url: 'https://example.invalid/image', expires_in: 300 }, { promotion_id: id, signed_url: 'javascript:bad', expires_in: 300 }]) {
  mocks.invoke.mockResolvedValueOnce({ data: bad, error: null }); await expect(fetchPromotionImage(id)).rejects.toThrow('Tautan gambar promosi tidak valid')
 }
})
test('promotion read fails closed on duplicate or malformed stock records', async () => {
 mocks.items = [item(), item()]; await expect(fetchPromotions()).rejects.toThrow('Data promosi tidak valid')
 mocks.items = [item({ remaining_quantity: -1 })]; await expect(fetchPromotions()).rejects.toThrow('Data stok promosi tidak valid')
})
test('unsafe image type, size, or actor is rejected before upload', async () => {
 expect(api.uploadPromotionImage).toBeTypeOf('function')
 for (const invalid of [new File(['x'], 'evil.svg', { type: 'image/svg+xml' }), new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }), new File([], 'empty.png', { type: 'image/png' })]) {
  await expect(api.uploadPromotionImage(invalid, actor, id)).rejects.toThrow(/gambar/i)
 }
 expect(mocks.upload).not.toHaveBeenCalled()
})
test('pending unknown promotion outcome blocks changed data and replacement upload until recovery', async () => {
 const send = Object.assign(vi.fn(), { hasUnresolved: () => true })
 await expect(api.editPromotion(item(), { harga_pokok: null, luar_kota: 0, dalam_kota: 71, depo_bangunan: null }, file(), actor, send)).rejects.toThrow('Pulihkan hasil')
 expect(send).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled()
})
test('exhausted campaign stays enabled until an explicit pause and requires a reason for stock adjustment', async () => {
 mocks.items = [item({ remaining_quantity: 0 })]; mount(); await screen.findByText('Stok habis')
 expect(screen.getByRole('button', { name: 'Jeda' })).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: 'Sesuaikan stok' })); const save = screen.getByRole('button', { name: 'Simpan penyesuaian' })
 expect((save as HTMLButtonElement).disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('Perubahan stok'), { target: { value: '5' } }); fireEvent.change(screen.getByLabelText('Alasan penyesuaian'), { target: { value: 'Restock verified' } }); fireEvent.click(save)
 await waitFor(() => expect(mocks.rpc.mock.calls.some(call => call[1]?.p_operation === 'adjust_stock')).toBe(true))
})
test('sales administration is refused before loading catalog or creating an upload', () => {
 mocks.role = 'sales_head'; mount(); expect(screen.getByRole('alert').textContent).toContain('Procurement Admin')
 expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled()
})
test('a valid-shaped receipt for another promotion stays unresolved until recovery', async () => {
 const { createTransactionSender } = await import('../../src/lib/orderTransactions')
 const send = createTransactionSender({ rpcName: 'pilot_promotion_transaction_v1', recoveryRpcName: 'pilot_reconcile_promotion_v1', validateResult: api.validatePromotionReceipt })
 mocks.rpc.mockResolvedValueOnce({ data: { id: actor, stock_version: 2 }, error: null })
 await expect(send('set_active', { promotion_id: id, expected_stock_version: 1, is_active: false })).rejects.toThrow('Respons penyimpanan tidak valid')
 expect(send.hasUnresolved()).toBe(true)
})
function concurrentPromotionChange() {
 let writes = 0
 mocks.rpc.mockImplementation((_name, args) => {
  const result = Promise.resolve(args?.p_operation ? (++writes === 1 ? { data: null, error: { code: 'PT409', message: 'PROMOTION_VERSION_CONFLICT' } } : { data: { id: args.p_payload.promotion_id, stock_version: 3 }, error: null }) : { data: { version: 1, as_of: '2026-10-08T12:00:00Z', items: mocks.items }, error: null })
  return Object.assign(result, { abortSignal: () => result })
 })
}
test('stock conflict reload requires explicit version review while retaining adjustment and reason', async () => {
 concurrentPromotionChange(); mount(); await screen.findByRole('button', { name: 'Sesuaikan stok' })
 fireEvent.click(screen.getByRole('button', { name: 'Sesuaikan stok' })); fireEvent.change(screen.getByLabelText('Perubahan stok'), { target: { value: '5' } }); fireEvent.change(screen.getByLabelText('Alasan penyesuaian'), { target: { value: 'Verified replenishment' } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan penyesuaian' })); await screen.findByText(/Promosi berubah. Muat ulang/)
 mocks.items = [item({ stock_version: 2, remaining_quantity: 8, luar_kota: 90 })]
 fireEvent.click(screen.getByRole('button', { name: 'Muat ulang promosi' })); await screen.findByText('Stok saat ini: 8')
 expect((screen.getByLabelText('Perubahan stok') as HTMLInputElement).value).toBe('5'); expect((screen.getByLabelText('Alasan penyesuaian') as HTMLTextAreaElement).value).toBe('Verified replenishment')
 expect((screen.getByRole('button', { name: 'Simpan penyesuaian' }) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button', { name: 'Gunakan versi promosi yang sudah diperiksa' })); fireEvent.click(screen.getByRole('button', { name: 'Simpan penyesuaian' }))
 await waitFor(() => expect(mocks.rpc.mock.calls.filter(call => call[1]?.p_operation === 'adjust_stock')).toHaveLength(2))
 expect(mocks.rpc.mock.calls.filter(call => call[1]?.p_operation === 'adjust_stock')[1][1].p_payload).toEqual({ promotion_id: id, expected_stock_version: 2, quantity_delta: 5, reason: 'Verified replenishment' })
})
test('image/price conflict reload keeps file and overrides and blocks another upload until review', async () => {
 concurrentPromotionChange(); mount(); await screen.findByRole('button', { name: 'Ubah harga / gambar' })
 fireEvent.click(screen.getByRole('button', { name: 'Ubah harga / gambar' })); fireEvent.change(screen.getByLabelText('Luar Kota (Rp)'), { target: { value: '123' } }); const replacement = file(); fireEvent.change(screen.getByLabelText('Gambar promosi'), { target: { files: [replacement] } })
 fireEvent.click(screen.getByRole('button', { name: 'Simpan promosi' })); await screen.findByText(/Promosi berubah. Muat ulang/); expect(mocks.upload).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button', { name: 'Simpan promosi' })); expect(mocks.upload).toHaveBeenCalledTimes(1)
 mocks.items = [item({ stock_version: 2, remaining_quantity: 8, luar_kota: 90 })]
 fireEvent.click(screen.getByRole('button', { name: 'Muat ulang promosi' })); await screen.findByText('Stok saat ini: 8')
 expect((screen.getByLabelText('Luar Kota (Rp)') as HTMLInputElement).value).toBe('123'); expect(screen.getByText('Harga saat ini · Luar Kota: Rp 90')).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: 'Simpan promosi' })); expect(mocks.upload).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button', { name: 'Gunakan versi promosi yang sudah diperiksa' })); fireEvent.click(screen.getByRole('button', { name: 'Simpan promosi' }))
 await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2)); expect(mocks.upload.mock.calls[1][1]).toBe(replacement)
 await waitFor(() => expect(mocks.rpc.mock.calls.filter(call => call[1]?.p_operation === 'edit_promotion')).toHaveLength(2))
 expect(mocks.rpc.mock.calls.filter(call => call[1]?.p_operation === 'edit_promotion')[1][1].p_payload).toMatchObject({ expected_stock_version: 2, luar_kota: 123 })
})
test.each(['missing', 'stale', 'failed'] as const)('promotion %s reload keeps the rejected draft blocked', async state => {
 concurrentPromotionChange(); mount(); await screen.findByRole('button', { name: 'Sesuaikan stok' }); fireEvent.click(screen.getByRole('button', { name: 'Sesuaikan stok' }))
 fireEvent.change(screen.getByLabelText('Perubahan stok'), { target: { value: '5' } }); fireEvent.change(screen.getByLabelText('Alasan penyesuaian'), { target: { value: 'Keep this reason' } }); fireEvent.click(screen.getByRole('button', { name: 'Simpan penyesuaian' })); await screen.findByText(/Promosi berubah. Muat ulang/)
 if (state === 'missing') mocks.items = []
 if (state === 'failed') mocks.rpc.mockImplementation(() => { const result = Promise.resolve({ data: null, error: { message: 'Read failed' } }); return Object.assign(result, { abortSignal: () => result }) })
 fireEvent.click(screen.getByRole('button', { name: 'Muat ulang promosi' })); await screen.findByText(/Data promosi terbaru belum lengkap atau masih memakai versi lama/)
 expect(screen.queryByRole('button', { name: 'Gunakan versi promosi yang sudah diperiksa' })).toBeNull()
 expect((screen.getByRole('button', { name: 'Simpan penyesuaian' }) as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByLabelText('Alasan penyesuaian') as HTMLTextAreaElement).value).toBe('Keep this reason')
})

async function assertLegacyHistoryAndManagedControls() {
 const legacyTitle = await screen.findByRole('heading', { name: 'Legacy history product' })
 const managedTitle = screen.getByRole('heading', { name: 'Managed campaign product' })
 const legacy = within(legacyTitle.closest('article')!), managed = within(managedTitle.closest('article')!)
 expect(legacy.getByText('Legacy · stok belum ditetapkan')).toBeTruthy()
 expect(legacy.getByText(/Riwayat legacy dipertahankan/)).toBeTruthy()
 expect(legacy.queryByRole('button', { name: /Sesuaikan stok|Ubah harga|Jeda/ })).toBeNull()
 expect(managed.getByText('Stok tersedia: 3')).toBeTruthy()
 for (const name of ['Sesuaikan stok', 'Ubah harga / gambar', 'Jeda']) expect((managed.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false)
 expect(screen.queryByText('Promosi belum dapat dimuat.')).toBeNull()
}
test('admin renders preserved legacy history alongside managed campaign controls', async () => {
 mocks.items = [item({ id: actor, product_name: 'Legacy history product', stock_managed: false, remaining_quantity: null, image_path: null }), item({ product_name: 'Managed campaign product' })]
 mount(); await assertLegacyHistoryAndManagedControls()
})
test.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('managed promotion balance %s still fails closed', async remaining_quantity => {
 mocks.items = [item({ remaining_quantity })]
 await expect(fetchPromotions(undefined, true)).rejects.toThrow('Data stok promosi tidak valid')
})
const realContract = process.env.DEMO_PROMOTION_CONTRACT_JSON
function useActualSQLContract() {
 const data = JSON.parse(realContract!)
 mocks.rpc.mockImplementation(() => { const result = Promise.resolve({ data, error: null }); return Object.assign(result, { abortSignal: () => result }) })
 return data
}
test.skipIf(!realContract)('actual migrated legacy and managed RPC output passes the unchanged client decoder', async () => {
 const data = useActualSQLContract(), rows = await fetchPromotions(undefined, true)
 expect(data.items).toHaveLength(2)
 expect(rows.find(row => row.product_name === 'Legacy history product')).toMatchObject({ stock_managed: false, remaining_quantity: null, stock_version: 1, image_path: null })
 expect(rows.find(row => row.product_name === 'Managed campaign product')).toMatchObject({ stock_managed: true, remaining_quantity: 3, stock_version: 1, harga_pokok: null, luar_kota: 0 })
})
test.skipIf(!realContract)('actual migrated RPC response renders legacy history and managed admin controls together', async () => {
 useActualSQLContract(); mount(); await assertLegacyHistoryAndManagedControls()
})
