import { existsSync, readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LeaveContext, LeaveStatus } from '../../src/lib/leave/contracts'
import type { DirectorRequest } from '../../src/lib/leave/directorContracts'
import { directorA, employeeA } from './fixtures'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: { user: { id: '71000000-0000-0000-0000-000000000004' }, profile: { id: '71000000-0000-0000-0000-000000000004', is_active: true }, loading: false } }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => mocks.auth }))
import DirectorLeaveOverview from '../../src/pages/ihr/leave/DirectorLeaveOverview'

const context: LeaveContext = { scopeVersion: 'overview-responsive', memberKind: 'director', timezone: null, balances: [], setup: { ready: false, blockers: [] }, capabilities: { request: false, approve: true, configure: false, adjust: false, readPrivate: false, manageAccess: false } }
const row = (sequence: number, overrides: Partial<DirectorRequest> = {}): DirectorRequest => ({ id: `82000000-0000-0000-0000-${String(sequence).padStart(12, '0')}`, sequence, employeeId: employeeA, employeeName: `Synthetic colleague ${sequence}`, startDate: '2026-11-01', endDate: '2026-11-02', totalMinutes: 450, status: 'submitted', submittedAt: '2026-10-20T06:19:45.992082+00:00', approverName: 'Synthetic reviewer', ...overrides })
let live: LeaveContext, records: DirectorRequest[], failRead: boolean
const clients: QueryClient[] = []
function mount(props: { readState?: 'ready' | 'pending' | 'error'; context?: LeaveContext } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  const element = (next = props) => <QueryClientProvider client={client}><DirectorLeaveOverview actorId={directorA} context={next.context ?? context} readState={next.readState} /></QueryClientProvider>
  const view = render(element()); return { client, rerender: (next: typeof props) => view.rerender(element(next)) }
}
beforeEach(() => {
  live = context; records = [row(30), row(20, { approverName: null, status: 'approved' })]; failRead = false
  mocks.auth.profile.is_active = true; mocks.rpc.mockReset()
  mocks.rpc.mockImplementation((name: string, args: { p_before?: number | null } = {}) => ({ abortSignal: () => {
    if (name === 'leave_context_v1') return Promise.resolve({ data: live, error: null })
    if (name === 'leave_director_requests_v1') return Promise.resolve({ data: failRead ? null : { rows: args.p_before ? [row(10)] : records, nextBefore: args.p_before || !records.length ? null : records.at(-1)!.sequence }, error: failRead ? { message: 'Private transport diagnostic' } : null })
    throw new Error(`Unexpected RPC: ${name}`)
  } }))
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

test('director summary uses one six-column table with every existing public field and no decision form', async () => {
  mount()
  const table = await screen.findByRole('table', { name: 'Ringkasan permintaan cuti' })
  expect(table.tagName).toBe('TABLE'); expect(table.classList.contains('director-leave-table')).toBe(true)
  const headers = within(table).getAllByRole('columnheader')
  expect(headers.map(header => header.textContent)).toEqual(['Karyawan', 'Tanggal cuti', 'Durasi', 'Status', 'Penyetuju permohonan', 'Diajukan'])
  expect(headers.every(header => header.getAttribute('scope') === 'col')).toBe(true)
  const rows = table.querySelectorAll('tbody > tr'); expect(rows).toHaveLength(2)
  for (const record of rows) { expect(record.getAttribute('role')).toBe('row'); expect(within(record as HTMLElement).getAllByRole('cell')).toHaveLength(6) }
  expect(within(table).getAllByText('2026-11-01 sampai 2026-11-02')).toHaveLength(2)
  expect(within(table).getAllByText('7j 30m')).toHaveLength(2)
  expect(within(table).getByText('Belum ditetapkan')).toBeTruthy()
  expect(Array.from(table.querySelectorAll('time'), time => [time.dateTime, time.textContent])).toEqual(records.map(record => [record.submittedAt, record.submittedAt]))
  expect(table.querySelectorAll('form,input,textarea,button,a')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: /Setujui|Tolak/ })).toBeNull()
  expect(mocks.rpc.mock.calls.filter(([name]) => name === 'leave_director_requests_v1')).toHaveLength(1)
  expect(mocks.rpc.mock.calls.every(([name]) => ['leave_context_v1', 'leave_director_requests_v1'].includes(name))).toBe(true)
})

test.each<[LeaveStatus, string]>([['submitted', 'Menunggu persetujuan'], ['approved', 'Disetujui'], ['rejected', 'Ditolak'], ['withdrawn', 'Ditarik'], ['cancellation_pending', 'Menunggu pembatalan'], ['cancelled', 'Dibatalkan']])('table preserves the %s status label', async (status, label) => {
  records = [row(30, { status })]; mount()
  const table = await screen.findByRole('table', { name: 'Ringkasan permintaan cuti' })
  expect(within(table).getByRole('cell', { name: label })).toBeTruthy()
})

test('CSS stacks the same cells into phone cards and restores native table layout at 1024px', () => {
  const path = 'src/pages/ihr/leave/director-leave-overview.css'
  expect(existsSync(path)).toBe(true)
  const css = readFileSync(path, 'utf8')
  expect(css).toMatch(/\.director-leave-table\s*\{[^}]*display:\s*block/)
  expect(css).toContain('@media (min-width: 1024px)')
  expect(css).toMatch(/@media[\s\S]*\.director-leave-table\s*\{[^}]*display:\s*table/)
  expect(css).toMatch(/\.director-leave-table thead\s*\{[^}]*clip:\s*rect/)
  expect(css).not.toMatch(/thead[^}]*display:\s*none/)
  expect(css).toContain('table-layout: fixed'); expect(css).toContain('overflow-wrap: anywhere')
})

test('cursor pagination and the same focused controls survive phone and desktop resizing without extra reads', async () => {
  vi.stubGlobal('innerWidth', 390); mount(); await screen.findByText('Synthetic colleague 30')
  fireEvent.click(screen.getByRole('button', { name: 'Lebih lama' })); await screen.findByText('Synthetic colleague 10')
  expect(screen.queryByText('Synthetic colleague 30')).toBeNull()
  const table = screen.getByRole('table'), newer = screen.getByRole('button', { name: 'Lebih baru' })
  newer.focus(); const reads = mocks.rpc.mock.calls.length
  for (const width of [1440, 1023, 1024, 390]) {
    vi.stubGlobal('innerWidth', width); fireEvent(window, new Event('resize'))
    expect(screen.getByRole('table')).toBe(table); expect(document.activeElement).toBe(newer)
    expect(screen.getAllByRole('button', { name: 'Lebih baru' })).toEqual([newer])
    expect(within(table).getAllByText('Synthetic colleague 10')).toHaveLength(1)
  }
  expect(mocks.rpc).toHaveBeenCalledTimes(reads)
  expect(screen.getByRole('button', { name: 'Lebih lama' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(newer); await screen.findByText('Synthetic colleague 30')
  expect(screen.getByRole('button', { name: 'Lebih baru' }).hasAttribute('disabled')).toBe(true)
  expect(mocks.rpc).toHaveBeenCalledWith('leave_director_requests_v1', { p_before: 20, p_limit: 25 })
})

test.each(['pending', 'error'] as const)('shared %s authority masks the entire table and pagination immediately', async readState => {
  const view = mount(); await screen.findByText('Synthetic colleague 30')
  view.rerender({ readState })
  expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByText('Synthetic colleague 30')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Lebih lama' })).toBeNull()
  if (readState === 'pending') expect(screen.getByText('Memeriksa akses dan memuat ringkasan...')).toBeTruthy()
  else expect(screen.getByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Ringkasan belum tersedia'))
})

test('revoked live director authority hides previous rows and cannot trigger another summary read', async () => {
  mount(); await screen.findByText('Synthetic colleague 30')
  const reads = mocks.rpc.mock.calls.filter(([name]) => name === 'leave_director_requests_v1').length
  live = { ...context, memberKind: 'manager' }
  await act(async () => { fireEvent(window, new Event('focus')) })
  await screen.findByRole('alert')
  expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByText('Synthetic colleague 30')).toBeNull()
  expect(mocks.rpc.mock.calls.filter(([name]) => name === 'leave_director_requests_v1')).toHaveLength(reads)
})

test('read failure remains a safe retry, not an empty result, and recovery restores the same summary fields', async () => {
  failRead = true; mount(); await screen.findByRole('alert')
  expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByText('Belum ada permintaan cuti.')).toBeNull()
  expect(screen.queryByText('Private transport diagnostic')).toBeNull()
  failRead = false; fireEvent.click(screen.getByRole('button', { name: 'Muat ulang ringkasan' }))
  expect(await screen.findByRole('table')).toBeTruthy()
})

test('empty overview retains its existing empty message and disabled pagination without an empty table', async () => {
  records = []; mount(); await screen.findByText('Belum ada permintaan cuti.')
  expect(screen.queryByRole('table')).toBeNull()
  for (const name of ['Lebih baru', 'Lebih lama']) expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
})

test.each(['employee', 'manager', null] as const)('non-director %s starts no overview reads', memberKind => {
  mount({ context: { ...context, memberKind } })
  expect(screen.queryByRole('table')).toBeNull(); expect(mocks.rpc).not.toHaveBeenCalled()
})
