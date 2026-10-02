import { supabase } from '../supabase'
import { parseUUID } from './contracts'
import type { Balance, LeaveContext, Page, SetupBlocker, UUID } from './contracts'
export type LeavePerson = { id: UUID; name: string; applicationRole: string; active: boolean }

/** Backend messages/details can contain private values. Never expose or log them. */
export function leaveErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  if (code === '42501') return 'Akses cuti tidak tersedia. Muat ulang atau hubungi administrator HR.'
  if (code === '55000') return 'Data atau akses cuti berubah. Muat ulang sebelum melanjutkan.'
  if (code === '22023') return 'Data cuti tidak valid atau tindakan belum tersedia. Periksa isian Anda.'
  return 'Layanan cuti tidak dapat dihubungi. Silakan coba lagi.'
}
function invalid(): never { throw new Error('Respons layanan cuti tidak valid. Silakan muat ulang.') }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function parseBalance(value: unknown): Balance {
  if (!object(value)) invalid()
  let accountId: UUID
  try { accountId = parseUUID(value.accountId) } catch { return invalid() }
  const keys = ['year', 'allowanceMinutes', 'approvedMinutes', 'pendingMinutes', 'availableMinutes', 'expiredMinutes', 'version'] as const
  if (!keys.every(key => integer(value[key]))) invalid()
  return { accountId, ...Object.fromEntries(keys.map(key => [key, value[key]])) } as Balance
}
function parseContext(value: unknown): LeaveContext {
  if (!object(value) || typeof value.scopeVersion !== 'string' || !value.scopeVersion ||
      ![null, 'employee', 'manager', 'director'].includes(value.memberKind as string | null) ||
      !(value.timezone === null || (typeof value.timezone === 'string' && !!value.timezone.trim())) ||
      !object(value.capabilities) || !object(value.setup) || typeof value.setup.ready !== 'boolean' ||
      !Array.isArray(value.setup.blockers) || !Array.isArray(value.balances)) invalid()
  const capNames = ['request', 'approve', 'configure', 'adjust', 'readPrivate', 'manageAccess'] as const
  const sourceCaps = value.capabilities as Record<string, unknown>
  if (!capNames.every(key => typeof sourceCaps[key] === 'boolean')) invalid()
  const capabilities = Object.fromEntries(capNames.map(key => [key, sourceCaps[key]])) as LeaveContext['capabilities']
  const blockers: SetupBlocker[] = (value.setup.blockers as unknown[]).map(row => {
    if (!object(row) || typeof row.code !== 'string' || typeof row.message !== 'string' || (row.field !== undefined && typeof row.field !== 'string')) invalid()
    return { code: row.code, message: row.message, ...(row.field === undefined ? {} : { field: row.field as string }) }
  })
  if (value.setup.ready && blockers.length) invalid()
  const balances = value.balances.map(parseBalance)
  if (value.memberKind === 'director' && (capNames.some(key => key !== 'approve' && capabilities[key]) || balances.length)) invalid()
  if (value.memberKind === null && (capabilities.request || balances.length)) invalid()
  return { scopeVersion: value.scopeVersion, memberKind: value.memberKind as LeaveContext['memberKind'], capabilities,
    setup: { ready: value.setup.ready, blockers }, balances, timezone: value.timezone as string | null }
}
export async function fetchLeaveContext(signal: AbortSignal): Promise<LeaveContext> {
  const { data, error } = await supabase.rpc('leave_context_v1').abortSignal(signal)
  signal.throwIfAborted()
  if (error) throw new Error(leaveErrorMessage(error))
  return parseContext(data)
}
export async function fetchLeavePeople(page: number, pageSize: number, signal: AbortSignal): Promise<Page<LeavePerson>> {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Halaman direktori cuti tidak valid.')
  const { data, error } = await supabase.rpc('leave_admin_setup_v1', { p_section: 'people', p_page: page, p_page_size: pageSize }).abortSignal(signal)
  signal.throwIfAborted()
  if (error) throw new Error(leaveErrorMessage(error))
  if (!object(data) || !Array.isArray(data.rows) || !integer(data.total) || data.page !== page || data.pageSize !== pageSize) invalid()
  const rows = data.rows.map((row: unknown) => {
    if (!object(row) || typeof row.name !== 'string' || typeof row.applicationRole !== 'string' || typeof row.active !== 'boolean') invalid()
    let id: UUID
    try { id = parseUUID(row.id) } catch { return invalid() }
    return { id, name: row.name, applicationRole: row.applicationRole, active: row.active }
  })
  return { rows, total: data.total, page, pageSize }
}
