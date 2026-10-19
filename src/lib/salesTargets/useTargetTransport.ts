import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { connectTargetTransport, unavailableTargetTransport } from './transport'
import type { TargetTransport } from './transport'
/** Off unless an explicitly reviewed build flag and server capability agree. */
export function useTargetTransport(actorKey: string, injected?: TargetTransport): TargetTransport {
  const [connection, setConnection] = useState<{ actorKey: string; transport: TargetTransport } | null>(null)
  useEffect(() => {
    setConnection(null)
    if (injected || !actorKey || import.meta.env.VITE_SALES_TARGETS_V1 !== 'enabled') return
    let cancelled = false
    const source = supabase as unknown as { supabaseUrl: string }
    void connectTargetTransport(supabase, true, source.supabaseUrl).then(transport => { if (!cancelled) setConnection({ actorKey, transport }) })
    return () => { cancelled = true }
  }, [actorKey, injected])
  return injected ?? (connection?.actorKey === actorKey ? connection.transport : unavailableTargetTransport)
}
