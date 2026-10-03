import { useMemo } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabase'
import { isPOConflict, POConflictError } from './poConflict'

export type TransactionResult = { id: string; po_id?: string; updated_at?: string }
type Recovery = { state: 'committed' | 'abandoned' | 'unknown'; result?: TransactionResult; operation?: string }
export type TransactionSender = ((operation: string, payload: unknown) => Promise<TransactionResult>) & {
  hasUnresolved: () => boolean
  reconcile: () => Promise<Recovery>
  acknowledgeRecovered: () => void
}
type Options = { validateResult?: (result: TransactionResult, expectedOperation?: string) => boolean; storage?: () => Storage; storageKey?: string; rpcName?: 'pilot_order_transaction' | 'pilot_finalize_visit' | 'leave_transaction_v1'; recoveryRpcName?: 'pilot_reconcile_request' | 'pilot_reconcile_visit' | 'leave_reconcile_request_v1' }
type Pending = { key: string; id: string; uncertain: boolean; committed?: TransactionResult }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
async function fingerprint(operation: string, payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([operation, canonical(payload)]))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}
function compatibilityError(error: { code?: string; message: string }): Error {
  if (isPOConflict(error)) return new POConflictError(true)
  return new Error(error.code === 'PGRST202' || error.code === '42883'
    ? 'Pembaruan database diperlukan sebelum menyimpan. Hubungi administrator; jangan kirim ulang melalui versi lama.' : error.message)
}

/** Durable metadata stores only actor/form-scoped request UUID + hash, never order contents. */
export function createTransactionSender(options: Options = {}): TransactionSender {
  let pending: Pending | null = null
  function read() {
    if (options.storage && options.storageKey) {
      const raw = options.storage().getItem(options.storageKey)
      if (raw) {
        const saved = JSON.parse(raw)
        if (typeof saved.id !== 'string' || typeof saved.key !== 'string' || typeof saved.uncertain !== 'boolean') throw new Error('Metadata pemulihan tidak valid. Hubungi administrator.')
        pending = saved
      } else pending = null
    }
    return pending
  }
  function save(value: Pending | null) {
    if (options.storage && options.storageKey) {
      if (value) options.storage().setItem(options.storageKey, JSON.stringify(value))
      else options.storage().removeItem(options.storageKey)
    }
    pending = value
  }
  // Opt-in semantic receipt checks must run before any confirmation consumes recovery identity.
  function validateReceipt(value: TransactionResult, request: Pending, operation?: string) {
    if (!options.validateResult) return
    try {
      if (!options.validateResult(value, operation)) throw new Error('Respons penyimpanan tidak valid. Pulihkan hasil sebelum mencoba kembali.')
    } catch (error) {
      if (read()?.id === request.id) save({ key: request.key, id: request.id, uncertain: true })
      throw error
    }
  }
  const send = async (operation: string, payload: unknown) => {
    const key = await fingerprint(operation, payload)
    const current = read()
    if (current?.committed && current.key === key) { validateReceipt(current.committed, current, operation); save(null); return current.committed }
    if ((current?.uncertain || current?.committed) && current.key !== key) throw new Error('Hasil penyimpanan sebelumnya belum terkonfirmasi. Pulihkan hasilnya sebelum mengubah pesanan.')
    const request = current?.key === key ? current : { key, id: crypto.randomUUID(), uncertain: true }
    save({ ...request, uncertain: true }) // before the request: survives reload while HTTP is in flight
    const { data, error } = await supabase.rpc(options.rpcName ?? 'pilot_order_transaction', { p_request_id: request.id, p_operation: operation, p_payload: payload })
    if (error) {
      // A returned SQL error aborts the RPC transaction. Network/gateway ambiguity must stay unresolved.
      if ((/^[0-9A-Z]{5}$/.test(error.code ?? '') && !error.code?.startsWith('08') && error.code !== '40003') || error.code === 'PGRST202') save({ ...request, uncertain: false })
      throw compatibilityError(error)
    }
    if (!data || typeof data.id !== 'string') throw new Error('Respons penyimpanan tidak valid. Pulihkan hasil sebelum mencoba kembali.')
    validateReceipt(data as TransactionResult, request, operation)
    if (read()?.id === request.id) save(null)
    return data as TransactionResult
  }
  return Object.assign(send, {
    hasUnresolved() { try { const value = read(); return !!(value?.uncertain || value?.committed) } catch { return true } },
    acknowledgeRecovered() { if (read()?.committed) save(null) },
    async reconcile(): Promise<Recovery> {
      const request = read()
      if (!request) return { state: 'unknown' }
      const { data, error } = await supabase.rpc(options.recoveryRpcName ?? 'pilot_reconcile_request', { p_request_id: request.id, p_abandon: true })
      if (error) throw compatibilityError(error)
      if (!data || !['committed', 'abandoned'].includes(data.state)) throw new Error('Hasil belum dapat dipastikan. Jangan buat permintaan baru.')
      if (data.state === 'committed' && typeof data.result?.id !== 'string') throw new Error('Hasil pemulihan tidak valid. Jangan buat permintaan baru.')
      if (data.state === 'committed') validateReceipt(data.result as TransactionResult, request)
      // The server either found the committed result or recorded a terminal cancellation tombstone.
      if (read()?.id === request.id) save(data.state === 'committed' ? { ...request, uncertain: false, committed: data.result } : null)
      return data as Recovery
    },
  })
}
export function useTransactionSender(scope: string, visit = false): TransactionSender {
  const { user } = useAuth()
  return useMemo(() => createTransactionSender({ ...(visit ? { rpcName: 'pilot_finalize_visit', recoveryRpcName: 'pilot_reconcile_visit' } as const : {}), ...(user?.id ? {
    storage: () => window.localStorage, storageKey: `pilot-request:${user.id}:${scope}`,
  } : {}) }), [user?.id, scope, visit])
}
