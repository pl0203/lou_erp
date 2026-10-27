import { useCallback, useId, useMemo, useState } from 'react'

export type TargetEditorLayout = 'desktop' | 'mobile'
type Lease = { owner: symbol | null }
export type TargetEditorLock = {
  busy: boolean
  layout: TargetEditorLayout | null
  descriptionId: string
  claim: (owner: symbol, layout: TargetEditorLayout) => boolean
  release: (owner: symbol) => void
}

/** Coordinates presentation only; inline editors keep their own typed drafts. */
export function useTargetEditorLock(scope: string): TargetEditorLock {
  const descriptionId = useId()
  const lease = useMemo<Lease>(() => ({ owner: null }), [scope])
  const [active, setActive] = useState<{ lease: Lease; owner: symbol; layout: TargetEditorLayout } | null>(null)
  const claim = useCallback((owner: symbol, layout: TargetEditorLayout) => {
    // Claim synchronously, before another opener in the same event turn.
    if (lease.owner !== null) return false
    lease.owner = owner
    setActive({ lease, owner, layout })
    return true
  }, [lease])
  const release = useCallback((owner: symbol) => {
    if (lease.owner !== owner) return
    lease.owner = null
    // A previous scope's cleanup/completion cannot unlock a newer lease.
    setActive(current => current?.lease === lease && current.owner === owner ? null : current)
  }, [lease])
  return { busy: active?.lease === lease, layout: active?.lease === lease ? active.layout : null, descriptionId, claim, release }
}
