import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'

const state = vi.hoisted(() => ({
  actor: 'sales-a', role: 'sales_person', customerMissing: false, customerError: false,
  visitError: false, orderError: false, evidenceError: false, scheduleError: false, deliveryError: false, photoError: false,
  empty: false, noSchedule: false, noEvidence: false, emptyEvidence: false, customerGate: null as Promise<void> | null,
  visitGate: null as Promise<void> | null, evidenceGate: null as Promise<void> | null, photoGate: null as Promise<void> | null,
  evidenceRequests: [] as string[], deliveryRequests: [] as string[], photoRequests: [] as string[],
}))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: state.actor, role: state.role } }) }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/lib/CustomerStats', () => ({ fetchCustomerStatsDetail: async () => ({ first_order_date: null, order_count_3mo: 0, total_sales_3mo: '0.00', top_items: [] }) }))
// Mock the network boundary, keeping the real query cache, reads, and routing.
vi.mock('../src/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const filters: Record<string, string> = {}; let offset = 0; let last = 19; let single = false
    const q: any = {
      select: () => q, eq: (key: string, value: string) => { filters[key] = value; return q },
      gte: () => q, order: () => q, limit: () => q, abortSignal: () => q,
      range: (start: number, end: number) => { offset = start; last = end; return q },
      maybeSingle: () => { single = true; return q }, single: () => { single = true; return q },
      then: async (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        try {
          const actor = state.actor
          const customerId = filters.outlet_id ?? filters.customer_id ?? filters.id
          if (table === 'customers') {
            await state.customerGate
            return resolve({ data: state.customerMissing ? null : { id: filters.id, name: `Customer ${filters.id}`, address: 'Address', city: 'City', phone: null, email: null, last_visit_date: null, visit_frequency_days: 7 }, error: state.customerError ? new Error('private backend error') : null })
          }
          if (table === 'sales_schedules') return resolve({ data: state.noSchedule ? [] : [{ id: 'next', scheduled_date: '2026-10-05', status: 'pending', notes: 'Bring the new samples', users: { full_name: 'Assigned Sales' } }], error: state.scheduleError ? new Error('private backend error') : null })
          if (table === 'outlet_visits' && single) {
            state.evidenceRequests.push(filters.id); await state.evidenceGate
            return resolve({ data: state.noEvidence ? null : { id: filters.id, notes: state.emptyEvidence ? null : `Visit note ${customerId}`, visit_photos: state.emptyEvidence ? [] : [{ id: 'photo', storage_path: `${actor}/${customerId}/${filters.id}.webp`, taken_at: '2026-10-01T10:00:00Z' }] }, error: state.evidenceError ? new Error('private backend error') : null })
          }
          if (table === 'outlet_visits') {
            await state.visitGate
            return resolve({ data: state.empty ? [] : Array.from({ length: 11 }, (_, i) => ({ id: `visit-${customerId}-${i}`, checked_in_at: '2026-10-01T10:00:00Z', users: { full_name: `Rep ${actor} ${i}` } })).slice(offset, last + 1), count: state.empty ? 0 : 11, error: state.visitError ? new Error('private backend error') : null })
          }
          if (table === 'purchase_orders') return resolve({ data: state.empty ? [] : Array.from({ length: 21 }, (_, i) => ({ id: `po-${customerId}-${i}`, po_number: `PO ${customerId} ${i}`, status: 'in_progress', total_value: 1200000, order_date: '2026-10-01', expected_delivery_date: '2026-10-08' })).slice(offset, last + 1), count: state.empty ? 0 : 21, error: state.orderError ? new Error('private backend error') : null })
          if (table === 'surat_jalan') {
            state.deliveryRequests.push(filters.purchase_order_id)
            return resolve({ data: state.empty ? [] : Array.from({ length: 21 }, (_, i) => ({ id: `sj-${i}`, sj_number: `SJ ${filters.purchase_order_id} ${i}`, sj_date: '2026-10-02', sj_date_received: '2026-10-03', sj_date_returned: '2026-10-04', voided_at: i === 0 ? '2026-10-02T00:00:00Z' : null, void_reason: i === 0 ? 'Correction' : null })).slice(offset, last + 1), count: state.empty ? 0 : 21, error: state.deliveryError ? new Error('private backend error') : null })
          }
          return resolve({ data: [], count: 0, error: null })
        } catch (error) { return reject(error) }
      },
    }
    return q
  },
  storage: { from: () => ({ createSignedUrl: async (path: string) => {
    state.photoRequests.push(path); await state.photoGate
    return { data: state.photoError ? null : { signedUrl: `https://example.invalid/${path}` }, error: state.photoError ? new Error('private storage error') : null }
  } }) },
} }))
import CustomerDetail from '../src/pages/girard/GirardCustomerDetail'
const clients: QueryClient[] = []
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/customer/a']}><Link to="/customer/a">Go A</Link><Link to="/customer/b">Go B</Link><Routes><Route path="/customer/:id" element={<CustomerDetail />} /></Routes></MemoryRouter></QueryClientProvider>
  const view = render(tree()); return { client, refresh: () => view.rerender(tree()) }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  Object.assign(state, { actor: 'sales-a', role: 'sales_person', customerMissing: false, customerError: false, visitError: false, orderError: false, evidenceError: false, scheduleError: false, deliveryError: false, photoError: false, empty: false, noSchedule: false, noEvidence: false, emptyEvidence: false, customerGate: null, visitGate: null, evidenceGate: null, photoGate: null, evidenceRequests: [], deliveryRequests: [], photoRequests: [] })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })

test('overview presents the next scheduled visit, assigned salesperson and schedule note', async () => {
  mount(); expect(await screen.findByText('Assigned Sales')).toBeTruthy(); expect(screen.getByText('Bring the new samples')).toBeTruthy()
  expect(screen.getByText('5 Oktober 2026')).toBeTruthy(); expect(state.evidenceRequests).toEqual([]); expect(state.deliveryRequests).toEqual([])
})
test('customer read failure is distinct from missing or inaccessible customer and can retry', async () => {
  state.customerError = true; mount()
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Gagal memuat pelanggan'))
  expect(screen.queryByText('private backend error')).toBeNull()
  state.customerError = false; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' })); expect(await screen.findByText('Customer a')).toBeTruthy()
})
test('a hidden customer has safe missing-or-no-access text and no child content', async () => {
  state.customerMissing = true; mount(); expect(await screen.findByText('Pelanggan tidak ditemukan atau Anda tidak memiliki akses.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Pesanan' })).toBeNull(); expect(state.evidenceRequests).toEqual([])
})
test('next schedule read errors have retry rather than a no-schedule message', async () => {
  state.scheduleError = true; mount(); expect(await screen.findByText('Gagal memuat jadwal berikutnya.')).toBeTruthy()
  expect(screen.queryByText('Belum ada kunjungan berikutnya yang dijadwalkan.')).toBeNull()
  state.scheduleError = false; state.noSchedule = true; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
  expect(await screen.findByText('Belum ada kunjungan berikutnya yang dijadwalkan.')).toBeTruthy()
})
test('visit history distinguishes loading and failure from empty and retries successfully', async () => {
  const gate = deferred(); state.visitGate = gate.promise; mount(); await screen.findByText('Customer a')
  fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' })); expect(await screen.findByText('Memuat riwayat kunjungan…')).toBeTruthy()
  expect(screen.queryByText('Belum ada kunjungan tercatat.')).toBeNull()
  state.visitError = true; await act(async () => { gate.resolve(); await gate.promise }); expect(await screen.findByText('Gagal memuat riwayat kunjungan.')).toBeTruthy()
  state.visitError = false; state.empty = true; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
  expect(await screen.findByText('Belum ada kunjungan tercatat.')).toBeTruthy()
})
test('visit histories page past ten and load notes/photos only when opened', async () => {
  mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' }))
  await screen.findByText(/Rep sales-a 0/); expect(state.evidenceRequests).toEqual([])
  fireEvent.click(screen.getAllByRole('button', { name: 'Lihat catatan & foto' })[0]); expect(await screen.findByText('Visit note a')).toBeTruthy()
  expect(await screen.findByRole('img', { name: 'Foto check-in' })).toBeTruthy(); expect(state.photoRequests).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' })); expect(await screen.findByText(/Rep sales-a 10/)).toBeTruthy()
  expect(screen.queryByText('Visit note a')).toBeNull(); expect(screen.getByText('11–11 dari 11')).toBeTruthy()
})
test('unavailable visit evidence is distinct from empty notes and photos', async () => {
  state.noEvidence = true; mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Lihat catatan & foto' }))[0])
  expect(await screen.findByText('Catatan dan foto tidak tersedia atau Anda tidak memiliki akses.')).toBeTruthy()
  expect(screen.queryByText('Tidak ada catatan kunjungan.')).toBeNull()
})
test('private photo failure offers retry and does not leak storage error text', async () => {
  state.photoError = true; mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Lihat catatan & foto' }))[0])
  expect(await screen.findByText('Foto tidak dapat dimuat.')).toBeTruthy(); expect(screen.queryByText('private storage error')).toBeNull()
  state.photoError = false; fireEvent.click(screen.getByRole('button', { name: 'Coba muat foto lagi' })); expect(await screen.findByRole('img', { name: 'Foto check-in' })).toBeTruthy()
  fireEvent.error(screen.getByRole('img', { name: 'Foto check-in' })); expect(await screen.findByText('Foto tidak dapat dimuat.')).toBeTruthy()
})
test('orders expand paged SJ history inline, including void and received/returned dates, without Athel links', async () => {
  mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Pesanan' })); await screen.findByText('PO a 0')
  expect(state.deliveryRequests).toEqual([]); fireEvent.click(screen.getAllByRole('button', { name: 'Lihat pengiriman / SJ' })[0])
  expect(await screen.findByText('SJ po-a-0 0')).toBeTruthy(); expect(screen.getByText(/Dibatalkan: Correction/)).toBeTruthy()
  expect(screen.getAllByText(/Diterima toko: 3 Oktober 2026/).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/SJ kembali: 4 Oktober 2026/).length).toBeGreaterThan(0)
  const region = screen.getByRole('region', { name: 'Riwayat pengiriman PO a 0' })
  fireEvent.click(within(region).getByRole('button', { name: 'Berikutnya' })); expect(await screen.findByText('SJ po-a-0 20')).toBeTruthy()
  expect(document.querySelector('a[href^="/athel"]')).toBeNull()
})
test('orders error is retryable and never shown as no orders', async () => {
  state.orderError = true; mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Pesanan' }))
  expect(await screen.findByText('Gagal memuat riwayat pesanan.')).toBeTruthy(); expect(screen.queryByText('Belum ada PO tercatat.')).toBeNull()
  state.orderError = false; state.empty = true; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' })); expect(await screen.findByText('Belum ada PO tercatat.')).toBeTruthy()
})
test('switching customer while evidence is pending never shows the old note/photo and resets tabs', async () => {
  const gate = deferred(); state.evidenceGate = gate.promise; mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Lihat catatan & foto' }))[0]); await waitFor(() => expect(state.evidenceRequests).toHaveLength(1))
  fireEvent.click(screen.getByRole('link', { name: 'Go B' })); await screen.findByText('Customer b'); await act(async () => { gate.resolve(); await gate.promise })
  expect(screen.queryByText('Visit note a')).toBeNull(); expect(screen.queryByRole('img')).toBeNull(); expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' })); expect(await screen.findByText('1–10 dari 11')).toBeTruthy()
})
test('changing account closes previous expanded evidence even without a cache clear', async () => {
  const view = mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Lihat catatan & foto' }))[0]); await screen.findByRole('img', { name: 'Foto check-in' })
  state.actor = 'sales-b'; view.refresh(); await waitFor(() => expect(screen.queryByRole('img')).toBeNull())
  fireEvent.click(await screen.findByRole('button', { name: 'Riwayat Kunjungan' })); expect(await screen.findByText(/Rep sales-b 0/)).toBeTruthy(); expect(screen.queryByText(/Rep sales-a 0/)).toBeNull()
})

test('visit evidence read failure retries and successful empty evidence is explicit', async () => {
  state.evidenceError = true; mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Lihat catatan & foto' }))[0])
  expect(await screen.findByText('Gagal memuat catatan dan foto.')).toBeTruthy()
  state.evidenceError = false; state.emptyEvidence = true; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
  expect(await screen.findByText('Tidak ada catatan kunjungan.')).toBeTruthy(); expect(screen.getByText('Tidak ada foto kunjungan.')).toBeTruthy()
})
test('delivery failure is retryable without turning it into an empty history', async () => {
  state.deliveryError = true; mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Pesanan' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Lihat pengiriman / SJ' }))[0])
  expect(await screen.findByText('Gagal memuat riwayat pengiriman.')).toBeTruthy(); expect(screen.queryByText('Belum ada pengiriman tercatat.')).toBeNull()
  state.deliveryError = false; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
  expect(await screen.findByText('SJ po-a-0 0')).toBeTruthy()
})
test('PO pagination exposes older orders and resets expanded delivery state', async () => {
  mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Pesanan' })); await screen.findByText('PO a 0')
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' })); await screen.findByText('PO a 20')
  expect(screen.getByText('21–21 dari 21')).toBeTruthy(); expect(screen.queryByText('PO a 0')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Lihat pengiriman / SJ' })); await screen.findByText('SJ po-a-20 0')
  fireEvent.click(screen.getAllByRole('button', { name: 'Sebelumnya' }).at(-1)!); await screen.findByText('PO a 0')
  expect(screen.queryByRole('region', { name: 'Riwayat pengiriman PO a 20' })).toBeNull()
})
test('late private photo result cannot appear after customer navigation', async () => {
  const gate = deferred(); state.photoGate = gate.promise; mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Lihat catatan & foto' }))[0]); await waitFor(() => expect(state.photoRequests).toHaveLength(1))
  fireEvent.click(screen.getByRole('link', { name: 'Go B' })); await screen.findByText('Customer b')
  await act(async () => { gate.resolve(); await gate.promise })
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByText('Visit note a')).toBeNull()
})
test('closing and reopening a visit obtains a fresh signed photo URL', async () => {
  mount(); await screen.findByText('Customer a'); fireEvent.click(screen.getByRole('button', { name: 'Riwayat Kunjungan' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Lihat catatan & foto' }))[0]); await screen.findByRole('img', { name: 'Foto check-in' })
  fireEvent.click(screen.getByRole('button', { name: 'Tutup catatan & foto' })); expect(screen.queryByRole('img')).toBeNull()
  await new Promise(resolve => setTimeout(resolve, 1))
  fireEvent.click(screen.getAllByRole('button', { name: 'Lihat catatan & foto' })[0]); await screen.findByRole('img', { name: 'Foto check-in' })
  expect(state.photoRequests).toHaveLength(2)
})

vi.mock('../src/components/StorePOContext', () => ({ default: () => null }))
