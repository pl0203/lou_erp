import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { LeaveContext } from '../../src/lib/leave/contracts'
import { employeeA } from './fixtures'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: { user: { id: '71000000-0000-0000-0000-000000000001' }, profile: { id: '71000000-0000-0000-0000-000000000001', full_name: 'Fictional Employee', role: 'sales_person', is_active: true }, loading: false, signOut: vi.fn() } }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => mocks.auth }))
import { fetchLeaveContext, fetchLeavePeople, leaveErrorMessage } from '../../src/lib/leave/rpc'
import LeaveManagement from '../../src/pages/ihr/LeaveManagement'
const base: LeaveContext = { scopeVersion: '1', memberKind: 'employee', timezone: null, capabilities: { request: true, approve: false, configure: false, adjust: false, readPrivate: false, manageAccess: false }, setup: { ready: false, blockers: [{ code: 'SCHEMA_NOT_READY', message: 'Layanan cuti belum siap.' }] }, balances: [] }
function reply(data: unknown, error: unknown = null) { return { abortSignal: vi.fn().mockResolvedValue({ data, error }) } }
beforeEach(() => { mocks.rpc.mockReset(); mocks.rpc.mockReturnValue(reply(base)) })
afterEach(cleanup)
test('actor-free dedicated context RPC receives the cancellation signal', async () => {
  const response = reply(base), signal = new AbortController().signal; mocks.rpc.mockReturnValue(response)
  expect(await fetchLeaveContext(signal)).toEqual(base)
  expect(mocks.rpc).toHaveBeenCalledWith('leave_context_v1')
  expect(response.abortSignal).toHaveBeenCalledWith(signal)
})
test('missing setup is shown as blockers, not zero balances or an enabled submission', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><LeaveManagement /></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByText('Layanan cuti belum siap.')).toBeTruthy()
  expect(screen.queryByText('Manajemen Pengguna')).toBeNull()
  expect(screen.queryByText(/0 jam/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Ajukan Cuti' })).toBeNull(); client.clear()
})
test('director has approval-only navigation and no implied future personal balance', async () => {
  const data: LeaveContext = { ...base, memberKind: 'director', capabilities: { ...base.capabilities, request: false, approve: true }, setup: { ready: false, blockers: [{ code: 'director_excluded', message: 'Direktur tidak dapat mengajukan cuti dalam kebijakan ini.' }] } }
  mocks.rpc.mockReturnValue(reply(data))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><LeaveManagement /></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByRole('tab', { name: 'Persetujuan' })).toBeTruthy()
  expect(screen.queryByRole('tab', { name: 'Cuti Saya' })).toBeNull()
  expect(screen.queryByText(/Saldo belum dapat ditampilkan/)).toBeNull()
  expect(data.capabilities.request).toBe(false); expect(data.balances).toEqual([]); client.clear()
})
test.each([
  { ...base, capabilities: { request: 'true' } },
  { ...base, memberKind: 'director' },
  { ...base, scopeVersion: '' },
  { ...base, setup: { ready: true, blockers: base.setup.blockers } },
])('malformed context fails closed', async data => {
  mocks.rpc.mockReturnValue(reply(data)); await expect(fetchLeaveContext(new AbortController().signal)).rejects.toThrow('Respons layanan cuti tidak valid')
})
test('directory is paginated and reconstructs exactly four fields, discarding private extras', async () => {
  const row = { id: employeeA, name: 'Fictional Employee', applicationRole: 'sales_person', active: true }
  mocks.rpc.mockReturnValue(reply({ rows: [{ ...row, email: 'private@example.invalid' }], total: 1, page: 1, pageSize: 20 }))
  expect(await fetchLeavePeople(1, 20, new AbortController().signal)).toEqual({ rows: [row], total: 1, page: 1, pageSize: 20 })
  expect(mocks.rpc).toHaveBeenCalledWith('leave_admin_setup_v1', { p_section: 'people', p_page: 1, p_page_size: 20 })
  await expect(fetchLeavePeople(0, 1000, new AbortController().signal)).rejects.toThrow()
})
test.each(['42501', '55000', '22023'])('SQLSTATE %s produces safe Indonesian copy', async code => {
  mocks.rpc.mockReturnValue(reply(null, { code, message: 'private reason', details: 'raw SQL and secret' }))
  await expect(fetchLeaveContext(new AbortController().signal)).rejects.toThrow(leaveErrorMessage({ code }))
  expect(leaveErrorMessage({ code })).not.toMatch(/private reason|raw SQL|secret/)
})
test('aborted transport does not publish a response that ignored the abort signal', async () => {
  const abort = new AbortController(); abort.abort()
  await expect(fetchLeaveContext(abort.signal)).rejects.toThrow()
})
