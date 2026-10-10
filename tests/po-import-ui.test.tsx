import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LocalDocument, ParsedPO, ReviewDecision } from '../src/lib/poImport/contracts'

const state = vi.hoisted(() => ({ send: vi.fn(), read: vi.fn(), parse: vi.fn(), prepare: vi.fn(), navigate: vi.fn(),
 customers: [] as any[], products: [] as any[], fetching: false, error: false, actor: 'u', role: 'po_admin', profileActive: true, realMatches: false }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ user: state.actor ? { id: state.actor } : null, profile: state.actor ? { id: state.actor, role: state.role, is_active: state.profileActive } : null, loading: false, error: null }) }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('react-router-dom', async () => { const { useEffect } = await import('react'); return { useNavigate: () => state.navigate, useBlocker: () => ({ state: 'unblocked' }), useBeforeUnload: (callback: any) => useEffect(() => { window.addEventListener('beforeunload', callback); return () => window.removeEventListener('beforeunload', callback) }, [callback]) } })
vi.mock('../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => false }) }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === 'customers' ? state.customers : state.products, isFetching: state.fetching, isError: state.error, refetch: vi.fn() }) }))
vi.mock('../src/lib/poImport/reader', () => ({ readPODocument: (...args: any[]) => state.read(...args) }))
vi.mock('../src/lib/poImport/parse', () => ({ parsePODocument: (...args: any[]) => state.parse(...args) }))
vi.mock('../src/lib/poImport/matching', async original => { const actual = await original<any>(); return { ...actual, matchPODraft: (...args: any[]) => state.realMatches ? actual.matchPODraft(...args) : ({ customerIds: state.customers.filter(c => c.name === 'Synthetic buyer').map(c => c.id), productIdsByRow: { r1: state.products.filter(p => p.sku === 'SYN-1').map(p => p.id) } }) } })
vi.mock('../src/lib/poImport/review', async original => { const actual = await original<any>(); return { preparePOFormDraft: (...args: any[]) => state.prepare(...args), isFinancialReviewIssue: actual.isFinancialReviewIssue } })
import PONew from '../src/pages/athel/PONew'
const field = (value: string | null) => ({ raw: value ?? '', value, page: 1 })
function parsed(price: string | null = '125'): ParsedPO {
 return { version: 1, layout: 'photo-grid', complete: true, buyer: field('Synthetic buyer'), supplier: field('Synthetic supplier'), poNumber: field('SYN-PO'), orderDate: field('2026-10-05'), expiry: field(null), delivery: field('Synthetic delivery'), paymentTerms: field('Net 30'), currency: field('IDR'), printedTotal: field('250'), priceBasis: 'gross', notes: '',
 rows: [{ id: 'r1', sku: field('SYN-1'), barcode: field(null), name: field('Synthetic product'), quantity: field('2'), unitPrice: field(price), uom: field('pcs'), issues: price === null ? [{ id: 'r1:missing-price', field: 'rows.r1.unitPrice', code: 'missing-price', message: 'Harga dokumen kosong', blocking: false }] : [] }], issues: [] }
}
function localDocument(): LocalDocument { return { pages: [], previews: [new Blob(['synthetic'], { type: 'image/png' })], dispose: vi.fn() } }
const clients: QueryClient[] = []
beforeEach(() => {
 state.send.mockReset().mockResolvedValue({ id: 'saved' }); state.navigate.mockReset(); state.fetching = false; state.error = false; state.actor = 'u'; state.role = 'po_admin'; state.profileActive = true; state.realMatches = false
 state.customers = [{ id: 'c', name: 'Synthetic buyer', pricing_tier: 'luar_kota' }, { id: 'd', name: 'Other buyer', pricing_tier: 'dalam_kota' }]
 state.products = [{ id: 'p', sku: 'SYN-1', name: 'Synthetic product', size: 'pcs', unit_price: 999, harga_pokok: 20, luar_kota: 30, dalam_kota: 40, depo_bangunan: null }]
 state.read.mockReset().mockResolvedValue(localDocument()); state.parse.mockReset().mockReturnValue(parsed())
 state.prepare.mockReset().mockImplementation((po: ParsedPO, d: ReviewDecision, customers: any[], products: any[]) => {
  const issues: any[] = []; const row = d.rows.r1
  if (!po.complete || !po.layout) issues.push({ id: 'fallback', message: 'Dokumen tidak lengkap; isi PO secara manual', blocking: true })
  if (!customers.some(c => c.id === d.customerId)) issues.push({ id: 'customer', message: 'Pilih pelanggan', blocking: true })
  if (!d.poNumber || !d.orderDate) issues.push({ id: 'header', message: 'Lengkapi nomor dan tanggal PO', blocking: true })
  if (!row || (!row.manual && !products.some(p => p.id === row.productId))) issues.push({ id: 'product', message: 'Pilih produk atau barang manual', blocking: true })
  if (row && !row.unitConfirmed) issues.push({ id: 'unit', message: 'Konfirmasi satuan', blocking: true })
  const missingId = po.rows[0].issues.find(i => i.code === 'missing-price')?.id ?? `${po.rows[0].id}:missing-price`
  if (row && row.unitPrice === null && !d.acknowledgedIssueIds.includes(missingId)) issues.push({ id: missingId, message: 'Akui harga kosong', blocking: true })
  if (row && row.unitPrice !== null && Number(row.unitPrice) === 0 && !d.acknowledgedIssueIds.includes(`${po.rows[0].id}:zero-price`)) issues.push({ id: `${po.rows[0].id}:zero-price`, message: 'Akui harga nol', blocking: true })
  if (!d.idrConfirmed) issues.push({ id: 'currency', message: 'Konfirmasi IDR', blocking: true })
  return { issues, draft: issues.length ? null : { customerId: d.customerId, poNumber: d.poNumber, orderDate: d.orderDate, expectedDelivery: d.expiry, notes: d.notes, lineItems: [{ _key: 'import-r1', product_id: row.productId, product_name: row.name, sku: row.sku, quantity: Number(row.quantity), unit_price: row.unitPrice === null ? Number.NaN : Number(row.unitPrice) }] } }
 })
 vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, media: '(min-width: 768px)', addEventListener: vi.fn(), removeEventListener: vi.fn() })))
 vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:synthetic'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.useRealTimers() })
function mount() { const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client); return render(<QueryClientProvider client={client}><PONew /></QueryClientProvider>) }
function upload(name = 'synthetic.png') { fireEvent.change(screen.getByLabelText('Dokumen PO'), { target: { files: [new File(['synthetic'], name, { type: 'image/png' })] } }) }
async function review() { fireEvent.click(screen.getByRole('button', { name: 'Import dokumen PO' })); upload(); await screen.findByRole('button', { name: 'Terapkan ke formulir' }) }
function confirmReview() { fireEvent.click(screen.getByLabelText('Saya sudah memeriksa satuan barang 1')); fireEvent.click(screen.getByLabelText('Saya memastikan nilai harga dalam IDR tanpa konversi')) }
function acknowledgeFinancial() { screen.queryAllByRole('checkbox', { name: /^Saya telah meninjau:/ }).forEach(checkbox => { if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox) }) }
function apply() { fireEvent.click(screen.getByRole('button', { name: 'Terapkan ke formulir' })) }
function forceRerender(value = 'manual rerender') { fireEvent.change(screen.getByPlaceholderText('mis. PO-2024-001'), { target: { value } }) }

test('Import, extraction, review and Apply never send a transaction; only ordinary Save writes once', async () => {
 mount(); await review(); expect(state.send).not.toHaveBeenCalled(); confirmReview(); apply()
 await waitFor(() => expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO'))
 expect(state.send).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
 await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1)); expect(state.send.mock.calls[0][1].items[0]).toMatchObject({ product_id: 'p', quantity: 2, unit_price: 125 })
 expect(JSON.stringify(state.send.mock.calls)).not.toMatch(/synthetic\.png|previews|tokens|blob:/)
})

test('blank document prices require acknowledgement and remain blank; Save blocks until manual completion', async () => {
 state.parse.mockReturnValue(parsed(null)); mount(); await review(); confirmReview(); apply(); expect(state.send).not.toHaveBeenCalled()
 expect(screen.queryByDisplayValue('SYN-PO')).toBeTruthy() // review header only; no ordinary form replacement
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(screen.getByLabelText('Harga kosong akan saya lengkapi di formulir (barang 1)')); apply()
 await waitFor(() => expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO'))
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe(''); fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
 expect(screen.getByRole('alert').textContent).toMatch(/Harga wajib diisi/); expect(state.send).not.toHaveBeenCalled()
})

test.each([false, null])('unknown/incomplete documents provide honest manual fallback (%s)', async layout => {
 const po = parsed(); if (layout === null) po.layout = null; else po.complete = false; state.parse.mockReturnValue(po)
 mount(); await review(); expect(screen.getByText(/Dokumen belum dapat diimpor/)).toBeTruthy()
 expect((screen.getByRole('button', { name: 'Terapkan ke formulir' }) as HTMLButtonElement).disabled).toBe(true); expect(state.send).not.toHaveBeenCalled()
})

test('customer ambiguity requires deliberate choice and unmatched row requires deliberate manual decision', async () => {
 state.customers.push({ id: 'duplicate', name: 'Synthetic buyer', pricing_tier: 'others' }); state.products = []
 mount(); await review(); expect((screen.getByLabelText('Pelanggan hasil impor') as HTMLSelectElement).value).toBe('')
 fireEvent.change(screen.getByLabelText('Pelanggan hasil impor'), { target: { value: 'c' } }); fireEvent.click(screen.getByLabelText('Gunakan barang manual 1')); confirmReview(); apply()
 await waitFor(() => expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO'))
 expect(state.send).not.toHaveBeenCalled(); expect(screen.getByDisplayValue('Synthetic product')).toBeTruthy()
})

test('declining replacement preserves manual edits and importer remains usable', async () => {
 mount(); forceRerender(); await review(); confirmReview(); apply(); fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }))
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('manual rerender'); expect(state.send).not.toHaveBeenCalled()
 apply(); fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO')
})

test('old replacement confirmation cannot apply after a newer upload', async () => {
 mount(); forceRerender(); await review(); confirmReview(); apply(); upload('newer.png');
 await screen.findByLabelText('Saya sudah memeriksa satuan barang 1'); fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('manual rerender'); expect(state.send).not.toHaveBeenCalled()
})

test('late first upload result is disposed and cannot replace second upload', async () => {
 let resolveFirst!: (d: LocalDocument) => void; const first = localDocument(); state.read.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve })).mockResolvedValueOnce(localDocument())
 mount(); fireEvent.click(screen.getByRole('button', { name: 'Import dokumen PO' })); upload('first.png'); await waitFor(() => expect(state.read).toHaveBeenCalledTimes(1)); upload('second.png')
 await screen.findByRole('button', { name: 'Terapkan ke formulir' }); await act(async () => resolveFirst(first))
 expect(first.dispose).toHaveBeenCalledTimes(1); expect(state.parse).toHaveBeenCalledTimes(1); expect(state.send).not.toHaveBeenCalled()
})

test('repeated Apply cannot replace subsequent manual form edits', async () => {
 mount(); await review(); confirmReview(); apply(); forceRerender()
 expect(screen.queryByRole('button', { name: 'Terapkan ke formulir' })).toBeNull(); expect(state.send).not.toHaveBeenCalled()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('manual rerender')
})

test('Cancel aborts startup and ignores its later result', async () => {
 let resolve!: (d: LocalDocument) => void; const doc = localDocument(); state.read.mockImplementation(() => new Promise(r => { resolve = r }))
 mount(); fireEvent.click(screen.getByRole('button', { name: 'Import dokumen PO' })); upload(); await waitFor(() => expect(state.read).toHaveBeenCalled())
 const signal = state.read.mock.calls[0][1].signal; fireEvent.click(screen.getByRole('button', { name: 'Batalkan impor' })); expect(signal.aborted).toBe(true)
 await act(async () => resolve(doc)); expect(doc.dispose).toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Terapkan ke formulir' })).toBeNull()
})

test('extraction has a cancellable 120-second deadline', async () => {
 vi.useFakeTimers(); state.read.mockImplementation(() => new Promise(() => {})); mount(); fireEvent.click(screen.getByRole('button', { name: 'Import dokumen PO' })); upload()
 await act(async () => { await Promise.resolve(); await Promise.resolve() }); expect(state.read).toHaveBeenCalled()
 await act(async () => vi.advanceTimersByTime(120_000)); expect(state.read.mock.calls[0][1].signal.aborted).toBe(true)
 expect(screen.getByRole('alert').textContent).toMatch(/120 detik/); expect(state.send).not.toHaveBeenCalled()
})

test.each(['catalog', 'refetch', 'logout', 'role', 'inactive'])('pending Apply revalidates live %s at acceptance', async change => {
 mount(); forceRerender(); await review(); confirmReview(); apply()
 if (change === 'catalog') state.products = [{ ...state.products[0], name: 'Revised authorized product' }]
 if (change === 'refetch') state.fetching = true
 if (change === 'logout') state.actor = ''
 if (change === 'role') state.role = 'sales_person'
 if (change === 'inactive') state.profileActive = false
 forceRerender('manual changed'); const discard = screen.queryByRole('button', { name: 'Buang perubahan' }); if (discard) fireEvent.click(discard)
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('manual changed'); expect(state.send).not.toHaveBeenCalled()
})

test('changing ordinary customer cancels pending import and preserves ordinary PO details', async () => {
 mount(); await review(); const input = screen.getByRole('combobox', { name: 'Pelanggan' }); fireEvent.change(input, { target: { value: 'Other' } }); fireEvent.click(within(screen.getByRole('listbox', { name: 'Pelanggan' })).getByRole('option', { name: /Other buyer/ }))
 expect(screen.queryByRole('button', { name: 'Terapkan ke formulir' })).toBeNull(); expect((input as HTMLInputElement).value).toBe('Other buyer')
})

test('unapplied document triggers beforeunload protection', async () => {
 mount(); await review(); const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event)
 expect(event.defaultPrevented).toBe(true); expect(screen.getByText(/Belum diterapkan/)).toBeTruthy(); expect(state.send).not.toHaveBeenCalled()
})

test('preview URLs are revoked and tab keyboard navigation shows one accessible panel', async () => {
 const { unmount } = mount(); await review()
 const preview = screen.getByRole('tab', { name: 'Dokumen' }); const reviewTab = screen.getByRole('tab', { name: 'Periksa data' })
 preview.focus(); fireEvent.keyDown(preview, { key: 'ArrowRight' }); expect(document.activeElement).toBe(reviewTab)
 expect(screen.getAllByRole('tabpanel')).toHaveLength(1); fireEvent.click(preview); expect(screen.getByAltText('Pratinjau dokumen halaman 1')).toBeTruthy()
 unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic')
})

test('changing a reviewed value invalidates an already open Apply confirmation', async () => {
 mount(); forceRerender(); await review(); confirmReview(); apply()
 fireEvent.change(screen.getByLabelText('Nomor PO hasil impor'), { target: { value: 'NEW-REVIEW' } })
 fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('manual rerender'); expect(state.send).not.toHaveBeenCalled()
 apply(); fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('NEW-REVIEW')
})

test('Cancel while Apply confirmation is open preserves the ordinary manual draft', async () => {
 mount(); forceRerender(); await review(); confirmReview(); apply(); fireEvent.click(screen.getByRole('button', { name: 'Batalkan impor' }))
 fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('manual rerender'); expect(state.send).not.toHaveBeenCalled()
})

test('catalog refresh disables review without repricing document values, and stale confirmation stays invalid after refresh ends', async () => {
 mount(); forceRerender(); await review(); confirmReview(); apply(); state.fetching = true; forceRerender('during refresh')
 expect((screen.getByRole('button', { name: 'Terapkan ke formulir' }) as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByLabelText('Harga hasil impor 1') as HTMLInputElement).value).toBe('125')
 state.fetching = false; forceRerender('after refresh'); fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }))
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('after refresh'); expect(state.send).not.toHaveBeenCalled()
})

test('memory-only importer performs no storage, telemetry or document network request', async () => {
 const local = vi.spyOn(Storage.prototype, 'setItem'); const logging = vi.spyOn(console, 'log'); const warning = vi.spyOn(console, 'warn'); const error = vi.spyOn(console, 'error')
 mount(); await review(); confirmReview(); apply()
 expect(globalThis.fetch).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled(); expect(logging).not.toHaveBeenCalled(); expect(warning).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled()
 expect(state.send).not.toHaveBeenCalled()
})

test.each([
 ['UNSUPPORTED_TYPE', /HEIC/], ['ANIMATED_IMAGE', /animasi/], ['TOO_MANY_PIXELS', /20 megapiksel/], ['TOO_MANY_PAGES', /5 halaman/],
 ['PDF_ENCRYPTED', /PDF terenkripsi/], ['INVALID_PDF', /PDF tidak valid/], ['INVALID_SIGNATURE', /tanda berkas.*metadata/], ['WORKER_UNAVAILABLE', /Aset pembaca lokal/],
 ['OCR_UNAVAILABLE', /Aset OCR lokal/], ['BLANK_DOCUMENT', /Dokumen kosong/], ['TIMEOUT', /120 detik/], ['READ_FAILED', /tidak dapat dibaca/],
])('reader failure %s has a clear sanitized manual fallback', async (code, message) => {
 state.read.mockRejectedValue(Object.assign(new Error('PRIVATE ORIGINAL MUST NOT DISPLAY'), { code })); mount()
 fireEvent.click(screen.getByRole('button', { name: 'Import dokumen PO' })); upload(); expect((await screen.findByRole('alert')).textContent).toMatch(message)
 expect(screen.queryByText(/PRIVATE ORIGINAL/)).toBeNull(); expect(state.send).not.toHaveBeenCalled()
})

test('review rows reuse bounded shared catalog search, preserve source prices and fill explicitly chosen canonical fields', async () => {
 state.products.push({ ...state.products[0], id: 'other', sku: 'OTHER-2', name: 'Other canonical product', luar_kota: 800 })
 mount(); await review()
 fireEvent.click(screen.getByRole('button', { name: 'Pilih produk barang 1' }))
 const search = screen.getByRole('combobox', { name: 'Cari produk hasil impor 1' })
 fireEvent.change(search, { target: { value: 'OTHER-2' } }); fireEvent.keyDown(search, { key: 'Enter' })
 expect((screen.getByLabelText('Nama barang hasil impor 1') as HTMLInputElement).value).toBe('Other canonical product')
 expect((screen.getByLabelText('SKU hasil impor 1') as HTMLInputElement).value).toBe('OTHER-2')
 expect((screen.getByLabelText('Harga hasil impor 1') as HTMLInputElement).value).toBe('125'); expect(state.send).not.toHaveBeenCalled()
})

test('many source rows do not create a catalog-sized option list for each row', async () => {
 const po = parsed(); po.rows = Array.from({ length: 30 }, (_, i) => ({ ...po.rows[0], id: `r${i + 1}` })); state.parse.mockReturnValue(po)
 state.products.push(...Array.from({ length: 50 }, (_, i) => ({ ...state.products[0], id: `extra-${i}`, sku: `EXTRA-${i}` })))
 mount(); await review(); expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(state.customers.length + 1)
})

test.each(['UNRECOGNIZED_PRIVATE_ERROR', '__proto__', 'constructor'])('unknown reader code %s never exposes raw content', async code => {
 state.read.mockRejectedValue(Object.assign(new Error('PRIVATE ORIGINAL MUST NOT DISPLAY'), { code })); mount()
 fireEvent.click(screen.getByRole('button', { name: 'Import dokumen PO' })); upload(); expect((await screen.findByRole('alert')).textContent).toMatch(/Dokumen tidak dapat dibaca/)
 expect(screen.queryByText(/PRIVATE ORIGINAL/)).toBeNull(); expect(state.send).not.toHaveBeenCalled()
})

test('keyed actor change rejects old acceptance during commit, before passive cleanup', async () => {
 let accept: (() => any) | undefined; let accepted: any = 'not checked'
 const Importer = (await import('../src/components/poImport/PODocumentImport')).default
 function Harness() {
  const [actor, setActor] = React.useState('u:po_admin')
  React.useLayoutEffect(() => { if (actor !== 'u:po_admin') accepted = accept?.() }, [actor])
  return <><button type="button" onClick={() => setActor('other:po_admin')}>Change actor</button><Importer key={actor} customers={state.customers} products={state.products} actorKey={actor} disabled={false} hasFormEdits={true} onDirtyChange={() => {}} onApply={(_draft, check) => { accept = check }} /></>
 }
 render(<Harness />); await review(); confirmReview(); apply(); expect(accept).toBeTypeOf('function')
 fireEvent.click(screen.getByRole('button', { name: 'Change actor' })); expect(accepted).toBeNull(); expect(state.send).not.toHaveBeenCalled()
})

test('StrictMode lifecycle remount still allows one current import acceptance', async () => {
 let applied = 0
 const Importer = (await import('../src/components/poImport/PODocumentImport')).default
 render(<React.StrictMode><Importer customers={state.customers} products={state.products} actorKey="u:po_admin" disabled={false} hasFormEdits={false} onDirtyChange={() => {}} onApply={(_draft, accept) => { if (accept?.()) applied++ }} /></React.StrictMode>)
 await review(); confirmReview(); apply(); expect(applied).toBe(1); expect(screen.queryByRole('button', { name: 'Terapkan ke formulir' })).toBeNull(); expect(state.send).not.toHaveBeenCalled()
})

test('clearing a previously priced source row offers explicit blank-price acknowledgement', async () => {
 mount(); await review(); fireEvent.change(screen.getByLabelText('Harga hasil impor 1'), { target: { value: '' } }); confirmReview()
 const acknowledge = screen.getByLabelText('Harga kosong akan saya lengkapi di formulir (barang 1)'); apply()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(acknowledge); apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO')
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe(''); expect(state.send).not.toHaveBeenCalled()
})

test('changing a reviewed source price to explicit zero requires its current zero-price acknowledgement', async () => {
 mount(); await review(); fireEvent.change(screen.getByLabelText('Harga hasil impor 1'), { target: { value: '0' } }); confirmReview(); apply()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(screen.getByLabelText('Harga nol sudah saya periksa (barang 1)')); apply()
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('0'); expect(state.send).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' })); await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
 expect(state.send.mock.calls[0][1].items[0].unit_price).toBe(0)
})

test.each(['', '0'])('real preparePOFormDraft integrates reviewed %s price acknowledgement without saving', async value => {
 const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft)
 mount(); await review(); fireEvent.change(screen.getByLabelText('Harga hasil impor 1'), { target: { value } }); confirmReview(); apply()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(screen.getByLabelText(value === '' ? 'Harga kosong akan saya lengkapi di formulir (barang 1)' : 'Harga nol sudah saya periksa (barang 1)')); acknowledgeFinancial(); apply()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO'); expect(state.send).not.toHaveBeenCalled()
 expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe(value)
 fireEvent.click(screen.getByRole('button', { name: 'Simpan PO' }))
 if (value === '') { expect(screen.getByRole('alert').textContent).toMatch(/Harga wajib diisi/); expect(state.send).not.toHaveBeenCalled() }
 else { await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1)); expect(state.send.mock.calls[0][1].items[0].unit_price).toBe(0) }
})

test.each(['price', 'quantity', 'customer', 'product'])('financial acknowledgement is revoked after reviewed %s changes', async change => {
 const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft); state.parse.mockReturnValue(parsed(null))
 state.products.push({ ...state.products[0], id: 'other', sku: 'OTHER-2', name: 'Other canonical product' })
 mount(); await review(); confirmReview(); const acknowledge = screen.getByLabelText('Harga kosong akan saya lengkapi di formulir (barang 1)') as HTMLInputElement; fireEvent.click(acknowledge); expect(acknowledge.checked).toBe(true)
 if (change === 'price') { fireEvent.change(screen.getByLabelText('Harga hasil impor 1'), { target: { value: '125' } }); fireEvent.change(screen.getByLabelText('Harga hasil impor 1'), { target: { value: '' } }) }
 if (change === 'quantity') fireEvent.change(screen.getByLabelText('Jumlah hasil impor 1'), { target: { value: '3' } })
 if (change === 'customer') fireEvent.change(screen.getByLabelText('Pelanggan hasil impor'), { target: { value: 'd' } })
 if (change === 'product') { fireEvent.click(screen.getByRole('button', { name: 'Pilih produk barang 1' })); const search = screen.getByRole('combobox', { name: 'Cari produk hasil impor 1' }); fireEvent.change(search, { target: { value: 'OTHER-2' } }); fireEvent.keyDown(search, { key: 'Enter' }) }
 expect((screen.getByLabelText('Harga kosong akan saya lengkapi di formulir (barang 1)') as HTMLInputElement).checked).toBe(false)
 apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe(''); expect(state.send).not.toHaveBeenCalled()
})

test('unique name-only suggestion with a conflicting source SKU requires deliberate canonical selection', async () => {
 const po = parsed(); po.rows[0].sku = field('BUYER-ONLY-CODE'); state.parse.mockReturnValue(po)
 mount(); await review(); expect(screen.getByText('Produk dipilih: Belum dipilih')).toBeTruthy()
 expect((screen.getByLabelText('SKU hasil impor 1') as HTMLInputElement).value).toBe('BUYER-ONLY-CODE'); expect(screen.getByText(/nama saja; pilih SKU ERP secara sengaja/)).toBeTruthy()
 confirmReview(); apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(screen.getByRole('button', { name: 'Pilih produk barang 1' })); const search = screen.getByRole('combobox', { name: 'Cari produk hasil impor 1' }); fireEvent.change(search, { target: { value: 'SYN-1' } }); fireEvent.keyDown(search, { key: 'Enter' })
 expect((screen.getByLabelText('SKU hasil impor 1') as HTMLInputElement).value).toBe('SYN-1'); expect((screen.getByLabelText('Harga hasil impor 1') as HTMLInputElement).value).toBe('125')
 fireEvent.click(screen.getByLabelText('Saya sudah memeriksa satuan barang 1')); apply()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO'); expect(state.send).not.toHaveBeenCalled()
})

test('unproven source SKU coincidence offers a deliberate one-click suggestion choice', async () => {
 const po = parsed(); po.rows[0].issues.push({ id: 'r1:source-sku-review', field: 'rows.r1.sku', code: 'source-sku-review', message: 'Kode sumber belum diverifikasi sebagai SKU ERP', blocking: false }); state.parse.mockReturnValue(po)
 const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft)
 mount(); await review(); expect(screen.getByText('Produk dipilih: Belum dipilih')).toBeTruthy(); expect((screen.getByLabelText('SKU hasil impor 1') as HTMLInputElement).value).toBe('SYN-1')
 confirmReview(); apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(screen.getByRole('button', { name: 'Gunakan saran produk barang 1: SYN-1 · Synthetic product' })); fireEvent.click(screen.getByLabelText('Saya sudah memeriksa satuan barang 1')); acknowledgeFinancial(); apply()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO'); expect(state.send).not.toHaveBeenCalled()
})

test.each(['tax-review', 'total-mismatch', 'line-total-mismatch'])('real financial %s warning is visible before Apply and blocks until explicitly acknowledged', async code => {
 const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft)
 const po = parsed(); const issue = { id: code === 'line-total-mismatch' ? `r1:${code}` : `source:${code}`, field: code === 'line-total-mismatch' ? 'rows.r1.unitPrice' : 'printedTotal', code, message: `Synthetic financial ${code}`, blocking: false }
 if (code === 'line-total-mismatch') po.rows[0].issues.push(issue); else po.issues.push(issue)
 if (code === 'total-mismatch') po.printedTotal = field('260')
 state.parse.mockReturnValue(po); state.products[0].luar_kota = 125; mount(); await review(); confirmReview()
 const checkbox = screen.getByRole('checkbox', { name: code === 'total-mismatch' ? /Saya telah meninjau:.*Total sumber/ : new RegExp(`Saya telah meninjau: ${issue.message}`) }) as HTMLInputElement
 expect(checkbox.checked).toBe(false); apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(checkbox); apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO'); expect(state.send).not.toHaveBeenCalled()
})

test('current generated catalog warning is visible before Apply and requires real review acknowledgement', async () => {
 const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft)
 mount(); await review(); confirmReview(); const warning = screen.getByRole('checkbox', { name: /Saya telah meninjau:.*harga tier katalog/i }) as HTMLInputElement
 expect(warning.checked).toBe(false); apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(warning); apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO'); expect(state.send).not.toHaveBeenCalled()
})

test('desktop shows source and review together, mobile retains one keyboard-selected panel', async () => {
 let listener: (() => void) | undefined; const media = { matches: true, media: '(min-width: 768px)', addEventListener: (_event: string, callback: () => void) => { listener = callback }, removeEventListener: vi.fn() }; vi.stubGlobal('matchMedia', vi.fn(() => media))
 mount(); await review(); expect(screen.getAllByRole('tabpanel')).toHaveLength(2); expect(await screen.findByAltText('Pratinjau dokumen halaman 1')).toBeTruthy(); expect(screen.queryByRole('tablist')).toBeNull()
 await act(async () => { media.matches = false; listener?.() }); expect(screen.getAllByRole('tabpanel')).toHaveLength(1); expect(screen.getByRole('tablist')).toBeTruthy()
 const reviewTab = screen.getByRole('tab', { name: 'Periksa data' }); reviewTab.focus(); fireEvent.keyDown(reviewTab, { key: 'ArrowLeft' }); const docTab = screen.getByRole('tab', { name: 'Dokumen' })
 expect(document.activeElement).toBe(docTab); expect(screen.getAllByRole('tabpanel')).toHaveLength(1); expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(docTab.id)
 fireEvent.keyDown(docTab, { key: 'End' }); expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(reviewTab.id)
})

test.each(['CONFLICTING-BUYER-CODE', null])('real matching and prepare keep %s source SKU unresolved until deliberate choice', async sourceSku => {
 state.realMatches = true; const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft)
 const po = parsed(); po.rows[0].sku = field(sourceSku); state.parse.mockReturnValue(po); state.products[0].luar_kota = 125
 mount(); await review(); expect(screen.getByText('Produk dipilih: Belum dipilih')).toBeTruthy(); expect((screen.getByLabelText('SKU hasil impor 1') as HTMLInputElement).value).toBe(sourceSku ?? '')
 confirmReview(); apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(screen.getByRole('button', { name: 'Gunakan saran produk barang 1: SYN-1 · Synthetic product' })); fireEvent.click(screen.getByLabelText('Saya sudah memeriksa satuan barang 1')); acknowledgeFinancial(); apply()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('SYN-PO'); expect(state.send).not.toHaveBeenCalled()
})

test.each(['price', 'quantity', 'customer'])('current bound financial review must be redone after %s changes, even if values change back', async change => {
 const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft)
 const po = parsed(); po.issues.push({ id: 'source:tax-review', field: 'priceBasis', code: 'tax-review', message: 'Synthetic tax review', blocking: false }); state.parse.mockReturnValue(po); state.products[0].luar_kota = 125; state.products[0].dalam_kota = 125
 mount(); await review(); confirmReview(); const initial = screen.getByRole('checkbox', { name: 'Saya telah meninjau: Synthetic tax review' }) as HTMLInputElement; fireEvent.click(initial); expect(initial.checked).toBe(true)
 if (change === 'price') { fireEvent.change(screen.getByLabelText('Harga hasil impor 1'), { target: { value: '126' } }); fireEvent.change(screen.getByLabelText('Harga hasil impor 1'), { target: { value: '125' } }) }
 if (change === 'quantity') { fireEvent.change(screen.getByLabelText('Jumlah hasil impor 1'), { target: { value: '3' } }); fireEvent.change(screen.getByLabelText('Jumlah hasil impor 1'), { target: { value: '2' } }) }
 if (change === 'customer') { fireEvent.change(screen.getByLabelText('Pelanggan hasil impor'), { target: { value: 'd' } }); fireEvent.change(screen.getByLabelText('Pelanggan hasil impor'), { target: { value: 'c' } }) }
 expect((screen.getByRole('checkbox', { name: 'Saya telah meninjau: Synthetic tax review' }) as HTMLInputElement).checked).toBe(false); apply()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe(''); expect(state.send).not.toHaveBeenCalled()
})

test('intrinsic source and validation blockers never receive acknowledgement controls', async () => {
 const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft)
 const po = parsed(); po.rows[0].quantity = field('1.5'); po.issues.push({ id: 'source:integrity', field: 'document', code: 'unknown-integrity', message: 'Synthetic intrinsic integrity blocker', blocking: true }); state.parse.mockReturnValue(po); state.products[0].luar_kota = 125
 mount(); await review(); confirmReview(); expect(screen.queryByRole('checkbox', { name: /Synthetic intrinsic|Jumlah harus/ })).toBeNull(); apply()
 expect(screen.getByRole('alert').textContent).toMatch(/Synthetic intrinsic integrity blocker/); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe(''); expect(state.send).not.toHaveBeenCalled()
})

test('catalog price missing warning also needs explicit current review without silently filling document price', async () => {
 const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft); state.products[0].luar_kota = null
 mount(); await review(); confirmReview(); const warning = screen.getByRole('checkbox', { name: /Saya telah meninjau:.*Harga tier pelanggan belum tersedia/ })
 expect((screen.getByLabelText('Harga hasil impor 1') as HTMLInputElement).value).toBe('125'); apply(); expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(warning); apply(); expect((screen.getByLabelText('Harga satuan') as HTMLInputElement).value).toBe('125'); expect(state.send).not.toHaveBeenCalled()
})

test('unsupported charge review is explicit and its reviewed context stays in ordinary notes', async () => {
 const actual = await vi.importActual<any>('../src/lib/poImport/review'); state.prepare.mockImplementation(actual.preparePOFormDraft)
 const po = parsed(); po.notes = 'Synthetic delivery surcharge needs separate review'; po.issues.push({ id: 'source:charge', field: 'notes', code: 'unsupported-charge', message: 'Synthetic delivery surcharge is not a structured PO charge', blocking: false }); state.parse.mockReturnValue(po); state.products[0].luar_kota = 125
 mount(); await review(); confirmReview(); const checkbox = screen.getByRole('checkbox', { name: 'Saya telah meninjau: Synthetic delivery surcharge is not a structured PO charge' }); apply()
 expect((screen.getByPlaceholderText('mis. PO-2024-001') as HTMLInputElement).value).toBe('')
 fireEvent.click(checkbox); apply(); expect((screen.getByPlaceholderText('Catatan (opsional)...') as HTMLTextAreaElement).value).toContain('Synthetic delivery surcharge'); expect(state.send).not.toHaveBeenCalled()
})

async function useActualSource(make: () => import('../src/lib/poImport/contracts').PageText[]) {
 const parser = await vi.importActual<typeof import('../src/lib/poImport/parse')>('../src/lib/poImport/parse')
 const policy = await vi.importActual<typeof import('../src/lib/poImport/review')>('../src/lib/poImport/review')
 const pages = make(), po = parser.parsePODocument(pages)
 state.realMatches = true; state.parse.mockImplementation(parser.parsePODocument); state.prepare.mockImplementation(policy.preparePOFormDraft)
 state.read.mockResolvedValue({ ...localDocument(), pages })
 state.customers = [{ id: 'c', name: po.buyer.value!, pricing_tier: 'luar_kota' }]
 state.products = po.rows.map((row, i) => ({ id: `product-${i}`, sku: row.sku.value || `MANUAL-${i}`, name: row.name.value!, size: row.uom.value, harga_pokok: 0, luar_kota: Number(row.unitPrice.value), dalam_kota: null, depo_bangunan: null }))
 return po
}
function confirmActualRows(count: number) {
 for (let i = 1; i <= count; i++) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Gunakan saran produk barang ${i}:`) }))
  fireEvent.click(screen.getByLabelText(`Saya sudah memeriksa satuan barang ${i}`))
 }
 fireEvent.click(screen.getByLabelText('Saya memastikan nilai harga dalam IDR tanpa konversi')); acknowledgeFinancial()
}
test.each(['photo', 'priced'] as const)('actual %s source context initializes editable notes and survives real Apply by default', async layout => {
 const fixtures = await import('./fixtures/po-import-layouts')
 const po = await useActualSource(() => {
  const pages = layout === 'photo' ? fixtures.photoGrid() : fixtures.pricedIndent()
  if (layout === 'photo') pages[0].tokens.push(fixtures.token('Currency : IDR', 80, 210, 180, 18, 98), fixtures.token('Shipping Fee : 10.000', 80, 700, 210, 18, 98))
  return pages
 })
 mount(); await review()
 const initial = (screen.getByLabelText('Catatan hasil impor') as HTMLTextAreaElement).value
 const expected = layout === 'photo' ? ['15-01-2028', '40 Hari', 'PCS', 'IDR', '16.000.000', 'Shipping Fee : 10.000'] : ['DPP : 1,171,171.17', 'Pajak : 128,828.83', '1,300,000', 'gross', 'PCS']
 expect(initial).toContain(po.notes)
 for (const fact of expected) expect(initial).toContain(fact)
 expect(initial).toMatch(/sumber/i); expect(initial).toMatch(/Pengiriman|Total tercetak/i); expect(initial).toContain('halaman 1')
 if (layout === 'photo') expect(initial.split('Shipping Fee : 10.000')).toHaveLength(2)
 confirmActualRows(po.rows.length); apply()
 expect((screen.getByPlaceholderText('Catatan (opsional)...') as HTMLTextAreaElement).value).toBe(initial)
 expect((screen.getByLabelText('Tanggal Kedaluwarsa PO (opsional)') as HTMLInputElement).value).toBe('')
 expect(state.send).not.toHaveBeenCalled()
})
test.each(['  Reviewed delivery only\nKeep these exact spaces  ', ''])('real Apply honors intentional source-context notes edit %j verbatim', async reviewed => {
 const fixtures = await import('./fixtures/po-import-layouts'), po = await useActualSource(fixtures.photoGrid)
 mount(); await review(); const notes = screen.getByLabelText('Catatan hasil impor') as HTMLTextAreaElement
 expect(notes.value).toContain('15-01-2028'); expect(notes.value).toContain('40 Hari')
 fireEvent.change(notes, { target: { value: reviewed } }); confirmActualRows(po.rows.length); apply()
 expect((screen.getByPlaceholderText('Catatan (opsional)...') as HTMLTextAreaElement).value).toBe(reviewed)
 expect(state.send).not.toHaveBeenCalled()
})
