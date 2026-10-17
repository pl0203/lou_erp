import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabase'
import { createCatalogueBackend } from './backend'
import { createCustomerTargetSender } from './customerTargets'
import type { CustomerTargetInput, CustomerTargetReceipt, CustomerTargetTransport } from './customerTargets'

/** One actor/backend owner across pages and months. The adapter binds the target
 * RPCs to the same verified real client as the existing catalogue transport. */
export function useCustomerTargetSave(acceptCanonical: (receipt: CustomerTargetReceipt) => Promise<boolean>) {
  const auth = useAuth()
  const backend = useMemo(() => {
    try {
      const source = supabase, base = createCatalogueBackend(source)
      const transport: CustomerTargetTransport = {
        backend: base.backend, withExclusiveLock: base.withExclusiveLock,
        async rpc(name, args) {
          if (!['pilot_customer_target_write_access_v1', 'pilot_customer_target_upsert_v1', 'pilot_reconcile_customer_target_v1'].includes(name)) throw new Error('Operasi target tidak dikenal.')
          base.assertCurrent()
          const result = await source.rpc(name, args)
          base.assertCurrent(); return { data: result.data, error: result.error }
        },
      }
      return transport
    } catch { return null }
  }, [supabase])
  const actor = !auth.loading && !auth.error && auth.user?.id === auth.profile?.id && auth.profile?.is_active ? auth.user?.id : undefined
  const role = auth.profile?.role === 'sales_head' || auth.profile?.role === 'executive' ? auth.profile.role : undefined
  const binding = useMemo(() => ({ actor, role, backend }), [actor, role, backend])
  type Owner = { binding: typeof binding; active: boolean; retired: boolean }
  const live = useRef<Owner | null>(null)
  if (!live.current || live.current.binding !== binding || live.current.retired) live.current = { binding, active: false, retired: false }
  const owner = live.current
  const [version, render] = useState(0), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null)
  const operation = useRef<symbol | null>(null)
  const current = useCallback(() => owner.active && !owner.retired && live.current === owner && !!actor && !!role && !!backend, [owner, actor, role, backend])
  const sender = useMemo(() => backend && actor && role ? createCustomerTargetSender({ backend: backend.backend, actorId: actor, role,
    scope: 'customer-target-pages', storage: () => localStorage, isCurrent: current }, backend) : null, [backend, actor, role, current])
  useLayoutEffect(() => {
    // StrictMode replay gets a new incarnation; a retired async callback cannot revive.
    let token = live.current
    if (!token || token.binding !== binding || token.retired) { token = { binding, active: false, retired: false }; live.current = token }
    token.active = true; operation.current = null; setBusy(false); setMessage(null); render(n => n + 1)
    const changed = () => { if (token.active && live.current === token) render(n => n + 1) }
    window.addEventListener('storage', changed)
    return () => { token.active = false; token.retired = true; window.removeEventListener('storage', changed) }
  }, [binding])
  // Storage is advisory for rendering; every sender action checks under its lock.
  const unresolved = !!sender && sender.hasUnresolved()
  void version
  async function run<T>(action: () => Promise<T>): Promise<T> {
    if (!current() || !sender || operation.current) throw new Error('Penyimpanan target belum tersedia.')
    const token = Symbol(); operation.current = token; setBusy(true); setMessage(null)
    try { return await action() }
    catch (error) { if (current()) setMessage('Hasil target belum terkonfirmasi. Periksa hasil; jangan simpan ulang.'); throw error }
    finally {
      if (current() && operation.current === token) { operation.current = null; setBusy(false); render(n => n + 1) }
    }
  }
  return {
    available: !!sender && current(), busy, unresolved, message, isCurrent: current,
    write(input: CustomerTargetInput, legacy: (input: CustomerTargetInput) => Promise<void>) {
      return run(async () => {
        const result = await sender!.save(input, legacy)
        if (result !== 'legacy') {
          const recovered = await sender!.recover(acceptCanonical)
          if (recovered.status !== 'committed') throw new Error('Hasil target belum diketahui.')
        }
      })
    },
    recover() {
      return run(async () => {
        const result = await sender!.recover(acceptCanonical)
        if (current() && result.status === 'unknown') setMessage('Hasil belum diketahui. Identitas permintaan tetap disimpan; jangan kirim ulang.')
        return result
      })
    },
  }
}
