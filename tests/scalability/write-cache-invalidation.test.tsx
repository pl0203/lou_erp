import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cacheProbe } from './cache-probe'

const state = vi.hoisted(() => ({ send: vi.fn(), data: {} as Record<string, unknown>, write: vi.fn(), navigate: vi.fn() }))
vi.mock('../../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'actor', role: 'executive' } }) }))
vi.mock('react-router-dom', async original => ({ ...await original<any>(), useNavigate: () => state.navigate, useBlocker: () => ({ state: 'unblocked' }), useBeforeUnload: () => {} }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({ data: state.data[queryKey[0]], isLoading: false }) }))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
  from: (table: string) => {
    let operation: string, payload: unknown
    const result = () => state.write(table, operation, payload)
    const q: any = { select: () => q, eq: () => q, single: result, then: (resolve: any, reject: any) => result().then(resolve, reject) }
    for (const method of ['insert', 'update', 'delete', 'upsert']) q[method] = (value: unknown) => { operation = method; payload = value; return q }
    return q
  },
} }))
import ManagerSchedule, { getNext30Days } from '../../src/pages/girard/ManagerSchedule'
import GirardCustomers from '../../src/pages/girard/GirardCustomers'

const clients: QueryClient[] = []
const stops: (() => void)[] = []
beforeEach(() => {
  state.write.mockReset().mockImplementation(async (table, _operation, payload) => ({ data: [table === 'customers' ? { id: payload?.id ?? 'customer' } : { customer_id: payload?.customer_id ?? 'customer', manager_id: payload?.manager_id }], error: null }))
  state.send.mockReset().mockResolvedValue({ id: 'schedule', version: 2 })
  state.navigate.mockReset()
  const customers = [{ id: 'customer', name: 'Customer A', city: null, address: null, last_visit_date: null, visit_frequency_days: 7, pricing_tier: 'luar_kota', customer_category: null }]
  state.data = {
    manager_customers: customers, all_customers: customers,
    manager_team: [{ id: 'sales', full_name: 'Sales A' }],
    managers_list: [{ id: 'manager-a', full_name: 'Manager A' }, { id: 'manager-b', full_name: 'Manager B' }],
    assignments: [],
    manager_schedules: [{ id: 'schedule', version: 1, outlet_id: 'customer', sales_person_id: 'sales', scheduled_date: getNext30Days()[2], status: 'pending', notes: 'Existing notes', customers: customers[0], users: { id: 'sales', full_name: 'Sales A' } }],
  }
})
afterEach(() => { cleanup(); stops.splice(0).forEach(stop => stop()); clients.splice(0).forEach(client => client.clear()) })

function mount(component: React.ReactNode, customer = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  clients.push(client)
  const probe = customer ? customerCacheProbe(client) : cacheProbe(client); stops.push(probe.stop)
  render(<QueryClientProvider client={client}><MemoryRouter>{component}</MemoryRouter></QueryClientProvider>)
  return probe
}
function customerCacheProbe(client: QueryClient) {
  const keys = ['customers', 'athel_customers', 'all_customers', 'assignments', 'my_customers'].map(key => [key, 'probe'])
  const unrelated = ['purchase_orders', 'po_line_state', 'products', 'performance', 'revenue', 'today_activity', 'athel_dashboard'].map(key => [key, 'probe'])
  ;[...keys, ...unrelated].forEach(key => client.setQueryData(key, { before: true }))
  const activeKey = ['girard_customer', 'actor', 'customer']
  client.setQueryData(activeKey, { before: true })
  const refetch = vi.fn(async () => ({ before: false }))
  const observer = new QueryObserver(client, { queryKey: activeKey, queryFn: refetch, staleTime: Infinity })
  const stop = observer.subscribe(() => {})
  const untouched = () => unrelated.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(false))
  return {
    stop,
    unchanged() { keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(false)); expect(refetch).not.toHaveBeenCalled(); untouched() },
    refreshed() { keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(true)); expect(refetch).toHaveBeenCalledTimes(1); expect(client.getQueryData(activeKey)).toEqual({ before: false }); untouched() },
  }
}
function choose(option: string, value: string) {
  const select = screen.getByRole('option', { name: option }).closest('select')!
  fireEvent.change(select, { target: { value } })
  return select
}
function editSchedule() {
  // The third date tab is the first editable date under the existing rule.
  const tabs = screen.getAllByRole('button').filter(button => /\bvisits?\b/.test(button.textContent ?? ''))
  fireEvent.click(tabs[2])
}
function submitSchedule(mode: 'create' | 'update' | 'delete') {
  if (mode === 'create') {
    fireEvent.click(screen.getByRole('button', { name: '+ Kunjungan' }))
    choose('Customer A', 'customer')
    choose('Pilih anggota team sales anda...', 'sales')
  } else {
    editSchedule()
    fireEvent.click(screen.getAllByRole('button', { name: mode === 'update' ? 'Ubah' : 'Hapus' })[0])
  }
  if (mode === 'delete') fireEvent.click(screen.getAllByRole('button', { name: 'Hapus' }).at(-1)!)
  else {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep these notes' } })
    fireEvent.click(screen.getByRole('button', { name: mode === 'create' ? 'Assign' : 'Save Changes' }))
  }
}

test.each(['create', 'update', 'delete'] as const)('schedule %s refreshes active summaries and invalidates cohorts only after commit', async mode => {
  let commit!: (value: unknown) => void
  state.send.mockReturnValueOnce(new Promise(resolve => { commit = resolve }))
  const probe = mount(<ManagerSchedule />)
  submitSchedule(mode)
  await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1))
  probe.unchanged()
  if (mode !== 'delete') expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep these notes')
  await act(async () => commit({ id: 'schedule', version: 2 }))
  await waitFor(() => probe.refreshed())
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  expect(screen.queryByText('Hapus jadwal kunjungan?')).toBeNull()
})

test.each(['create', 'update'] as const)('failed schedule %s keeps the draft and does not report fresh summaries', async mode => {
  state.send.mockRejectedValueOnce(new Error('Schedule write failed'))
  const probe = mount(<ManagerSchedule />)
  submitSchedule(mode)
  await screen.findByText('Schedule write failed')
  probe.unchanged()
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep these notes')
})

type CustomerMode = 'create' | 'assign' | 'reassign' | 'unassign'
function submitCustomer(mode: CustomerMode) {
  if (mode === 'create') {
    fireEvent.click(screen.getByRole('button', { name: '+ Pelanggan Baru' }))
    fireEvent.change(screen.getByPlaceholderText('mis. Toko Bangunan Maju'), { target: { value: 'Keep customer name' } })
    choose('Pilih kategori...', 'perorangan')
    choose('Belum ada manajer', 'manager-b')
    fireEvent.click(screen.getByRole('button', { name: 'Buat' }))
  } else if (mode === 'assign') {
    fireEvent.click(screen.getByRole('button', { name: 'Tugaskan yang Ada' }))
    choose('Pilih pelanggan...', 'customer')
    choose('Pilih manajer...', 'manager-b')
    choose('1x per bulan', '30')
    fireEvent.click(screen.getByRole('button', { name: 'Tugaskan' }))
  } else {
    fireEvent.click(screen.getAllByRole('button', { name: 'Ubah' })[0])
    choose('Belum ditugaskan', mode === 'reassign' ? 'manager-b' : '')
    choose('1x per bulan', '30')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
  }
}
function customerProbe(mode: CustomerMode) {
  if (mode === 'reassign' || mode === 'unassign') state.data.assignments = [{ customer_id: 'customer', manager_id: 'manager-a', managers: { id: 'manager-a', full_name: 'Manager A' } }]
  return mount(<GirardCustomers />, true)
}

test.each(['create', 'assign', 'reassign', 'unassign'] as const)('customer %s refreshes only customer caches after explicit final acknowledgement', async mode => {
  let commit!: (value: unknown) => void
  state.write.mockImplementationOnce(async (_table, _operation, payload) => ({ data: [{ id: payload?.id ?? 'customer' }], error: null }))
    .mockReturnValueOnce(new Promise(resolve => { commit = resolve }))
  const probe = customerProbe(mode)
  submitCustomer(mode)
  await waitFor(() => expect(state.write).toHaveBeenCalledTimes(2))
  probe.unchanged()
  expect(screen.getByRole('button', { name: 'Menyimpan...' })).toBeTruthy()
  const customerId = mode === 'create' ? state.write.mock.calls[0][2].id : 'customer'
  await act(async () => commit({ data: [{ customer_id: customerId, manager_id: 'manager-b' }], error: null }))
  await waitFor(() => probe.refreshed())
  expect(screen.queryByRole('button', { name: 'Batal' })).toBeNull()
  expect(state.write.mock.calls[1][1]).toBe(mode === 'create' ? 'insert' : mode === 'unassign' ? 'delete' : 'upsert')
  if (mode !== 'unassign') expect(state.write.mock.calls[1][2]).toEqual(expect.objectContaining({ manager_id: 'manager-b', assigned_by: 'actor' }))
})

test.each([
  ['create', 1], ['create', 2], ['assign', 1], ['assign', 2],
  ['reassign', 1], ['reassign', 2], ['unassign', 2],
] as const)('unconfirmed customer %s write %i keeps input and refreshes only affected caches', async (mode, failureAt) => {
  if (failureAt === 2) state.write.mockImplementationOnce(async (_table, _operation, payload) => ({ data: [{ id: payload?.id ?? 'customer' }], error: null }))
  state.write.mockResolvedValueOnce({ data: null, error: new Error('Customer write failed') })
  const probe = customerProbe(mode)
  submitCustomer(mode)
  await screen.findByText(/Customer write failed/)
  await waitFor(() => probe.refreshed())
  const alert = screen.getByRole('alert').textContent
  expect(alert).toMatch(/belum terkonfirmasi/)
  if (failureAt === 2) expect(alert).toMatch(/Data pelanggan tersimpan/)
  else expect(alert).not.toMatch(/Data pelanggan tersimpan/)
  expect(state.write).toHaveBeenCalledTimes(failureAt)
  expect(screen.getByRole('button', { name: 'Batal' })).toBeTruthy()
  if (mode === 'create') expect((screen.getByPlaceholderText('mis. Toko Bangunan Maju') as HTMLInputElement).value).toBe('Keep customer name')
  else expect((screen.getByRole('option', { name: mode === 'assign' ? 'Pilih manajer...' : 'Belum ditugaskan' }).closest('select') as HTMLSelectElement).value).toBe(mode === 'unassign' ? '' : 'manager-b')
})

vi.mock('../../src/lib/visitTransactions', () => ({ useVisitPlanningSender: () => Object.assign(state.send, { hasUnresolved: () => false }) }))
vi.mock('../../src/components/VisitRequestInbox', () => ({ default: () => null }))
