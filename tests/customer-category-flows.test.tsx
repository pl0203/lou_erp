import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { customerBackend } from './helpers/customerBackend'
import { CUSTOMER_CATEGORIES } from '../src/lib/customerCategory'
const state = vi.hoisted(() => ({ backend: null as any }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from: (...args: any[]) => state.backend.from(...args), rpc: (...args: any[]) => state.backend.rpc(...args), auth: { getUser: () => state.backend.auth.getUser() } } }))
vi.mock('../src/components/AthelNav', () => ({ default: () => null }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/components/TransactionRecovery', () => ({ default: () => null }))
vi.mock('../src/lib/orderTransactions', async original => ({ ...await original<any>(), useTransactionSender: () => Object.assign(vi.fn(), { hasUnresolved: () => false }) }))
vi.mock('../src/lib/useUnsavedChanges', () => ({ hasOrderItemChanges: () => true, useUnsavedChanges: () => ({ dialog: null, confirmDiscard: (fn: any) => fn(), runWithoutPrompt: (fn: any) => fn() }) }))
import CustomerList from '../src/pages/athel/CustomerList'
import GirardCustomers from '../src/pages/girard/GirardCustomers'
import PONew from '../src/pages/athel/PONew'
import POEdit from '../src/pages/athel/POEdit'
const clients: QueryClient[] = []
const stops: (() => void)[] = []
beforeEach(() => { state.backend = customerBackend() })
afterEach(() => { cleanup(); stops.splice(0).forEach(stop => stop()); clients.splice(0).forEach(client => client.clear()) })
const kinds = ['Athel', 'Girard'] as const
type Kind = typeof kinds[number]
function mount(kind: Kind, po?: 'new' | 'edit') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } }); clients.push(client)
  const Page = kind === 'Athel' ? CustomerList : GirardCustomers
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/po/po']}><section aria-label="Customer page"><Page /></section>
    {po && <section aria-label="PO draft"><Routes><Route path="/po/:id" element={po === 'new' ? <PONew /> : <POEdit />} /></Routes></section>}
  </MemoryRouter></QueryClientProvider>)
  return client
}
function page() { return within(screen.getByRole('region', { name: 'Customer page' })) }
async function loaded() { await waitFor(() => expect(page().getAllByText('Alpha shop').length).toBeGreaterThan(0)) }
function openNew(kind: Kind) { fireEvent.click(page().getByRole('button', { name: kind === 'Athel' ? '+ Tambah Pelanggan' : '+ Pelanggan Baru' })); fireEvent.change(page().getByPlaceholderText('mis. Toko Bangunan Maju'), { target: { value: 'New shop' } }) }
function save(kind: Kind, creating = false) { fireEvent.click(page().getByRole('button', { name: kind === 'Girard' && creating ? 'Buat' : 'Simpan' })) }
function choose(value: string) { fireEvent.change(page().getByRole('combobox', { name: /Kategori Pelanggan/ }), { target: { value } }) }
function openEdit() { fireEvent.click(page().getAllByRole('button', { name: 'Ubah' })[0]) }

for (const kind of kinds) {
  test(`${kind}: blank creation requires a deliberate category and retains inputs`, async () => {
    mount(kind); await loaded(); openNew(kind)
    expect((page().getByRole('combobox', { name: /Kategori Pelanggan/ }) as HTMLSelectElement).value).toBe('')
    save(kind, true)
    expect(await page().findByRole('alert')).toBeTruthy()
    expect(state.backend.state.writes).toHaveLength(0)
    expect(page().getByDisplayValue('New shop')).toBeTruthy()
  })
  test.each(CUSTOMER_CATEGORIES)(`${kind}: creates and edits $label with category distinct from price tier`, async ({ value, label }) => {
    mount(kind); await loaded(); openNew(kind); choose(value); save(kind, true)
    await waitFor(() => expect(page().queryByRole('heading', { name: 'Pelanggan Baru' })).toBeNull())
    const created = state.backend.state.customers.find((row: any) => row.name === 'New shop')
    expect(created).toMatchObject({ customer_category: value, pricing_tier: 'luar_kota' })
    expect(page().getAllByText(label).length).toBe(2)
    expect(page().getByRole('columnheader', { name: 'Kategori Pelanggan' })).toBeTruthy()
    expect(page().getByRole('columnheader', { name: 'Tier Harga' })).toBeTruthy()
    openEdit(); choose(value); save(kind)
    await waitFor(() => expect(page().queryByRole('combobox', { name: /Kategori Pelanggan/ })).toBeNull())
    expect(state.backend.state.customers[0]).toMatchObject({ customer_category: value, pricing_tier: 'luar_kota' })
  })
  test(`${kind}: legacy explicit null remains editable without an inferred classification`, async () => {
    mount(kind); await loaded(); expect(page().getAllByText('Unclassified')).toHaveLength(2); openEdit()
    expect(page().getByRole('combobox', { name: /Kategori Pelanggan/ }).textContent).toContain('Unclassified')
    save(kind); await waitFor(() => expect(page().queryByRole('combobox', { name: /Kategori Pelanggan/ })).toBeNull())
    expect(state.backend.state.customers[0].customer_category).toBeNull()
  })
  test.each(['bad', undefined])(`${kind}: invalid or missing stored category %s fails visibly`, async value => {
    state.backend.state.customers[0].customer_category = value; mount(kind)
    expect(await page().findByRole('alert')).toBeTruthy(); expect(page().queryByText('Unclassified')).toBeNull()
  })
  test(`${kind}: failed reads are visible and retryable`, async () => {
    state.backend.state.readError = true; mount(kind)
    expect(await page().findByRole('alert')).toBeTruthy()
    state.backend.state.readError = false; fireEvent.click(page().getByRole('button', { name: 'Coba lagi' })); await loaded()
  })
  for (const operation of ['create', 'edit'] as const) test.each(['denied', 'error', 'empty', 'null', 'mismatch', 'transport'])(`${kind}: ${operation} response %s keeps the draft and never assumes no write`, async response => {
    mount(kind); await loaded(); operation === 'create' ? openNew(kind) : openEdit(); choose('perorangan')
    state.backend.state.customerResponse = response; save(kind, operation === 'create')
    const alert = await page().findByRole('alert'); expect(alert.textContent).toMatch(/belum terkonfirmasi/i)
    expect((page().getByRole('combobox', { name: /Kategori Pelanggan/ }) as HTMLSelectElement).value).toBe('perorangan')
    if (operation === 'create') expect(page().getByDisplayValue('New shop')).toBeTruthy()
    expect(state.backend.state.writes.filter((w: any) => w.table === 'customer_manager_assignments')).toHaveLength(0)
  })
}

test('Athel: a category-only edit preserves exact legacy source fields and price tier', async () => {
  const original = { ...state.backend.state.customers[0], name: ' Alpha shop ', address: '', city: ' Jakarta ', phone: '  123 ', email: null, pricing_tier: 'others' }
  state.backend.state.customers[0] = structuredClone(original)
  mount('Athel'); await waitFor(() => expect(page().getAllByText('Alpha shop').length).toBeGreaterThan(0)); openEdit(); choose('supermarket_kecil'); save('Athel')
  await waitFor(() => expect(page().queryByRole('combobox', { name: /Kategori Pelanggan/ })).toBeNull())
  expect(state.backend.state.customers[0]).toEqual({ ...original, customer_category: 'supermarket_kecil' })
  expect(state.backend.state.writes[0].payload).toEqual({ customer_category: 'supermarket_kecil' })
})

type GirardMode = 'create' | 'assign-existing' | 'edit' | 'clear'
function arrangeGirard(mode: GirardMode) {
  if (mode === 'edit' || mode === 'clear') state.backend.state.assignments = [{ id: 'assignment', customer_id: 'c', manager_id: 'm' }]
}
function prepareGirard(mode: GirardMode, changeCustomer = true) {
  if (mode === 'create') { openNew('Girard'); choose('perorangan') }
  else if (mode === 'assign-existing') {
    fireEvent.click(page().getByRole('button', { name: 'Tugaskan yang Ada' }))
    fireEvent.change(page().getByRole('combobox', { name: 'Pilih Pelanggan' }), { target: { value: 'c' } })
  } else openEdit()
  if (changeCustomer && mode !== 'create') {
    if (mode === 'assign-existing') fireEvent.change(page().getByRole('combobox', { name: 'Frekuensi Kunjungan' }), { target: { value: '30' } })
    else choose('perorangan')
  }
  fireEvent.change(page().getByRole('combobox', { name: 'Manajer' }), { target: { value: mode === 'clear' ? '' : 'm2' } })
}
function submitGirard(mode: GirardMode) {
  fireEvent.click(page().getByRole('button', { name: mode === 'create' ? 'Buat' : mode === 'assign-existing' ? 'Tugaskan' : 'Simpan' }))
}
function cacheWitnesses(client: QueryClient) {
  const prefixes = ['athel_customers', 'all_customers', 'customers', 'girard_customer', 'manager_customers', 'my_customers', 'managers_data', 'assignments']
  const keys = prefixes.map(prefix => [prefix, 'category-probe'])
  for (const key of keys) {
    const table = key[0] === 'assignments' ? 'customer_manager_assignments' : 'customers'
    client.setQueryData(key, structuredClone(table === 'customers' ? state.backend.state.customers : state.backend.state.assignments))
    const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => (await state.backend.from(table).select('*')).data, staleTime: Infinity })
    stops.push(observer.subscribe(() => {}))
  }
  const untouched = [['po', 'guard'], ['po_line_state', 'guard'], ['products', 'guard'], ['revenue', 'guard']]
  untouched.forEach(key => client.setQueryData(key, { unchanged: true }))
  return { keys, untouched }
}
for (const mode of ['create', 'assign-existing', 'edit', 'clear'] as const) {
  test.each(['denied', 'error', 'empty', 'null', 'mismatch', 'transport'])(`Girard: ${mode} unconfirmed customer %s never proceeds to assignment`, async response => {
    arrangeGirard(mode); mount('Girard'); await loaded(); prepareGirard(mode)
    state.backend.state.customerResponse = response; submitGirard(mode)
    expect((await page().findByRole('alert')).textContent).toMatch(/Penyimpanan pelanggan belum terkonfirmasi/)
    expect(state.backend.state.writes).toHaveLength(1)
    expect((page().getByRole('combobox', { name: 'Manajer' }) as HTMLSelectElement).value).toBe(mode === 'clear' ? '' : 'm2')
  })
  test.each(['denied', 'empty', 'null', 'mismatch', 'transport'])(`Girard: ${mode} confirmed customer / assignment %s refreshes persisted narrow caches and retains draft`, async response => {
    arrangeGirard(mode); const client = mount('Girard'); await loaded(); const witness = cacheWitnesses(client); prepareGirard(mode)
    state.backend.state.assignmentResponse = response; submitGirard(mode)
    expect((await page().findByRole('alert')).textContent).toMatch(/Data pelanggan tersimpan.*belum terkonfirmasi/)
    expect(state.backend.state.writes).toHaveLength(2)
    const id = mode === 'create' ? state.backend.state.customers.find((c: any) => c.name === 'New shop').id : 'c'
    await waitFor(() => {
      for (const key of witness.keys) {
        const cached = client.getQueryData<any[]>(key)!
        if (key[0] === 'assignments') {
          const assignment = cached.find(row => row.customer_id === id)
          expect(assignment?.manager_id).toBe(response === 'denied' ? (mode === 'edit' || mode === 'clear' ? 'm' : undefined) : mode === 'clear' ? undefined : 'm2')
        } else {
          const customer = cached.find(row => row.id === id)
          expect(customer).toBeTruthy()
          expect(mode === 'assign-existing' ? customer.visit_frequency_days : customer.customer_category).toBe(mode === 'assign-existing' ? 30 : 'perorangan')
        }
      }
    })
    witness.untouched.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(false))
    expect((page().getByRole('combobox', { name: 'Manajer' }) as HTMLSelectElement).value).toBe(mode === 'clear' ? '' : 'm2')
    if (mode === 'create') expect(page().getByDisplayValue('New shop')).toBeTruthy()
    else if (mode === 'assign-existing') {
      expect((page().getByRole('combobox', { name: 'Frekuensi Kunjungan' }) as HTMLSelectElement).value).toBe('30')
      expect((page().getByRole('combobox', { name: 'Pilih Pelanggan' }) as HTMLSelectElement).value).toBe('c')
    }
    else expect((page().getByRole('combobox', { name: /Kategori Pelanggan/ }) as HTMLSelectElement).value).toBe('perorangan')
  })
}
for (const mode of ['assign-existing', 'edit', 'clear'] as const) {
  test.each([null, 'supermarket_besar'])(`Girard: ${mode} assignment-only preserves %s classification and all source fields`, async category => {
    state.backend.state.customers[0].customer_category = category
    state.backend.state.customers[0].pricing_tier = 'others'
    const original = structuredClone(state.backend.state.customers[0])
    arrangeGirard(mode); mount('Girard'); await loaded(); prepareGirard(mode, false); submitGirard(mode)
    await waitFor(() => expect(page().queryByRole('combobox', { name: 'Manajer' })).toBeNull())
    expect(state.backend.state.customers[0]).toEqual(original)
    expect(state.backend.state.writes).toHaveLength(1)
    expect(state.backend.state.writes[0].table).toBe('customer_manager_assignments')
    expect(state.backend.state.assignments[0]?.manager_id).toBe(mode === 'clear' ? undefined : 'm2')
  })
  test.each(['denied', 'empty', 'null', 'mismatch', 'transport'])(`Girard: ${mode} assignment-only %s retains choices and refreshes assignment cache`, async response => {
    arrangeGirard(mode); const client = mount('Girard'); await loaded(); const witness = cacheWitnesses(client); prepareGirard(mode, false)
    state.backend.state.assignmentResponse = response; submitGirard(mode)
    const alert = await page().findByRole('alert'); expect(alert.textContent).toMatch(/belum terkonfirmasi/); expect(alert.textContent).not.toMatch(/Data pelanggan tersimpan/)
    await waitFor(() => expect(client.getQueryData(['assignments', 'category-probe'])).toEqual(state.backend.state.assignments.map((row: any) => ({ ...row, managers: { id: row.manager_id, full_name: row.manager_id === 'm2' ? 'Manager Two' : 'Manager One' } }))))
    expect((page().getByRole('combobox', { name: 'Manajer' }) as HTMLSelectElement).value).toBe(mode === 'clear' ? '' : 'm2')
    expect(state.backend.state.customers[0].customer_category).toBeNull()
    witness.untouched.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(false))
  })
}

for (const kind of kinds) {
  test(`${kind}: background read failure retains an open category draft`, async () => {
    const client = mount(kind); await loaded(); openEdit(); choose('perorangan'); state.backend.state.readError = true
    await act(async () => { await client.invalidateQueries({ queryKey: [kind === 'Athel' ? 'athel_customers' : 'all_customers'] }) })
    expect(await page().findByRole('alert')).toBeTruthy()
    expect((page().getByRole('combobox', { name: /Kategori Pelanggan/ }) as HTMLSelectElement).value).toBe('perorangan')
    expect((page().getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(true)
    state.backend.state.readError = false; fireEvent.click(page().getByRole('button', { name: 'Coba lagi' })); await loaded()
    expect((page().getByRole('combobox', { name: /Kategori Pelanggan/ }) as HTMLSelectElement).value).toBe('perorangan')
  })
  test.each(['new', 'edit'] as const)(`${kind}: category save refetches the mounted %s PO customer query without clearing quantity, manual price or line DOM identity`, async po => {
    const client = mount(kind, po); await loaded()
    const draft = within(screen.getByRole('region', { name: 'PO draft' }))
    const lookup = await draft.findByRole('combobox', { name: 'Cari SKU atau nama barang' })
    if (po === 'new') {
      const customer = draft.getByRole('combobox', { name: 'Pelanggan' })
      fireEvent.change(customer, { target: { value: 'Alpha' } }); fireEvent.click(draft.getByRole('option', { name: /Alpha shop/ }))
    }
    await waitFor(() => expect((lookup as HTMLInputElement).disabled).toBe(false))
    fireEvent.change(lookup, { target: { value: 'SKU' } }); fireEvent.keyDown(lookup, { key: 'Enter' })
    const quantity = draft.getByRole('spinbutton', { name: 'Qty Product p' }) as HTMLInputElement
    const card = quantity.closest('[data-po-line]')!
    const price = within(card as HTMLElement).getByLabelText('Harga satuan') as HTMLInputElement
    expect(price.disabled).toBe(false)
    fireEvent.change(quantity, { target: { value: '9' } }); fireEvent.change(price, { target: { value: '77.25' } })
    let historicalCard: Element | null = null
    if (po === 'edit') {
      const historical = draft.getByRole('spinbutton', { name: 'Qty Historical' }) as HTMLInputElement
      historicalCard = historical.closest('[data-po-line]')!
      fireEvent.change(historical, { target: { value: '9' } })
      const historicalPrice = within(historicalCard as HTMLElement).getByLabelText('Harga satuan') as HTMLInputElement
      expect(historicalPrice.disabled).toBe(true); expect(historicalPrice.value).toBe('123.45')
    }
    const readsBefore = state.backend.state.reads.filter((r: any) => r.table === 'customers' && r.projection === 'id, name, pricing_tier').length
    const productsBefore = state.backend.state.reads.filter((r: any) => r.table === 'products').length
    const linesBefore = state.backend.state.rpcReads
    const poBefore = state.backend.state.reads.filter((r: any) => r.table === 'purchase_orders').length
    openEdit(); choose('perorangan'); save(kind)
    await waitFor(() => expect(page().queryByRole('combobox', { name: /Kategori Pelanggan/ })).toBeNull())
    await waitFor(() => expect(state.backend.state.reads.filter((r: any) => r.table === 'customers' && r.projection === 'id, name, pricing_tier').length).toBe(readsBefore + 1))
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(draft.getByRole('spinbutton', { name: 'Qty Product p' })).toBe(quantity)
    expect(quantity.closest('[data-po-line]')).toBe(card); expect(quantity.value).toBe('9'); expect(price.value).toBe('77.25'); expect(price.disabled).toBe(false)
    if (po === 'edit') {
      const historical = draft.getByRole('spinbutton', { name: 'Qty Historical' }) as HTMLInputElement
      expect(historical.closest('[data-po-line]')).toBe(historicalCard); expect(historical.value).toBe('9')
      const historicalPrice = within(historicalCard as HTMLElement).getByLabelText('Harga satuan') as HTMLInputElement
      expect(historicalPrice.disabled).toBe(true); expect(historicalPrice.value).toBe('123.45')
    }
    expect(state.backend.state.reads.filter((r: any) => r.table === 'products')).toHaveLength(productsBefore)
    expect(state.backend.state.reads.filter((r: any) => r.table === 'purchase_orders')).toHaveLength(poBefore)
    expect(state.backend.state.rpcReads).toBe(linesBefore)
    expect(client.getQueryCache().findAll().filter(query => ['po', 'po_line_state', 'products'].includes(String(query.queryKey[0]))).every(query => !query.state.isInvalidated)).toBe(true)
  })
}

for (const kind of kinds) test(`${kind}: an invalid stale cached category is a visible read failure, not a render crash`, async () => {
  const client = mount(kind); await loaded()
  await act(async () => {
    if (kind === 'Athel') client.setQueryData(['athel_customers', '', 1], { items: [{ ...state.backend.state.customers[0], customer_category: undefined }], total: 1 })
    else client.setQueryData(['all_customers'], [{ ...state.backend.state.customers[0], customer_category: 'UNKNOWN' }])
  })
  expect(await page().findByRole('alert')).toBeTruthy()
  expect(page().queryByText('Unclassified')).toBeNull()
})

for (const kind of kinds) test(`${kind}: category-only save preserves source fields and a concurrently updated price tier`, async () => {
  const client = mount(kind); await loaded(); openEdit(); choose('supermarket_sedang')
  state.backend.state.customers[0].pricing_tier = 'others'
  state.backend.state.customers[0].phone = '  unchanged  '
  await act(async () => { await client.invalidateQueries({ queryKey: [kind === 'Athel' ? 'athel_customers' : 'all_customers'] }) })
  save(kind)
  await waitFor(() => expect(page().queryByRole('combobox', { name: /Kategori Pelanggan/ })).toBeNull())
  expect(state.backend.state.customers[0]).toMatchObject({ customer_category: 'supermarket_sedang', pricing_tier: 'others', phone: '  unchanged  ' })
  expect(state.backend.state.writes[0].payload).toEqual({ customer_category: 'supermarket_sedang' })
})

test('Girard: stale assignment-only form preserves a classification changed elsewhere', async () => {
  arrangeGirard('edit'); const client = mount('Girard'); await loaded(); prepareGirard('edit', false)
  state.backend.state.customers[0].customer_category = 'tradisional_market'
  await act(async () => { await client.invalidateQueries({ queryKey: ['all_customers'] }) })
  submitGirard('edit')
  await waitFor(() => expect(page().queryByRole('combobox', { name: 'Manajer' })).toBeNull())
  expect(state.backend.state.customers[0].customer_category).toBe('tradisional_market')
  expect(state.backend.state.writes.every((write: any) => write.table === 'customer_manager_assignments')).toBe(true)
})
