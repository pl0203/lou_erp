import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTargetEditorLock, type TargetEditorLayout } from '../ui/useTargetEditorLock'

type Draft = {
  token: symbol
  recordId: string
  layout: TargetEditorLayout
  value: string
  pending: boolean
  error: boolean
}
type Owner = {
  mounted: boolean
  ready: boolean
  recordIds: Set<string>
  draft: Draft | null
  operation: symbol | null
}
type SaveTarget = (recordId: string, targetValue: number) => Promise<void>
type Submission = {
  owner: Owner
  token: symbol
  recordId: string
  targetValue: number
  write: SaveTarget
  onSaved: (refreshActive: boolean) => void
}
type Options = {
  scope: string
  canEdit: boolean
  /** A checked request is durable and cannot be resubmitted or locally cancelled. */
  unresolved?: boolean
  isPending: boolean
  isError: boolean
  records: readonly { id: string }[] | undefined
  write: SaveTarget
  onSaved: (refreshActive: boolean) => void
}

/** Owns only the target session, above rows that private-read masking removes. */
export function useTargetDraftSession({ scope, canEdit, isPending, isError, records, write, onSaved, unresolved = false }: Options) {
  const lock = useTargetEditorLock(scope)
  const { claim, release } = lock
  const owner = useMemo<Owner>(() => ({ mounted: false, ready: false, recordIds: new Set(), draft: null, operation: null }), [scope])
  const [snapshot, setSnapshot] = useState<{ owner: Owner; draft: Draft | null } | null>(null)

  const publish = useCallback((owner: Owner, draft: Draft | null) => {
    // Keep the synchronous event guard and rendered value together. React may
    // batch a change, Enter and a second Enter in the same event turn.
    owner.draft = draft
    setSnapshot({ owner, draft })
  }, [])
  const clear = useCallback((owner: Owner) => {
    // Clearing private data cannot release a still-pending operation's lease.
    if (owner.draft && !owner.operation) release(owner.draft.token)
    publish(owner, null)
  }, [publish, release])

  useLayoutEffect(() => {
    owner.mounted = true
    return () => {
      owner.mounted = false
      const token = owner.operation ?? owner.draft?.token
      if (token) release(token)
      owner.draft = null
    }
  }, [owner, release])

  useLayoutEffect(() => {
    owner.ready = canEdit && !isPending && !isError && !unresolved
    owner.recordIds = new Set(records?.map(record => record.id))
    // A pending read is not a fresh absence. Terminal errors deliberately clear
    // conservatively, without introducing a shared read-error classification.
    if (owner.draft && (!canEdit || !unresolved && (isError || (!isPending && !owner.recordIds.has(owner.draft.recordId))))) {
      clear(owner)
    }
  }, [owner, canEdit, isPending, isError, records, clear, unresolved])

  const isCurrent = ({ owner, token }: Submission) => owner.mounted && owner.draft?.token === token
  const mutation = useMutation({
    mutationFn: ({ recordId, targetValue, write }: Submission) => write(recordId, targetValue),
    onSuccess: (_result, submitted) => {
      const currentOwner = isCurrent(submitted)
      if (currentOwner) clear(submitted.owner)
      // The submitted callback retains the original actor/role/month prefix.
      // Removed scopes/panels/records cannot refresh or unlock a newer editor.
      submitted.onSaved(currentOwner)
    },
    onError: (_error, submitted) => {
      if (isCurrent(submitted)) publish(submitted.owner, { ...submitted.owner.draft!, pending: false, error: true })
    },
    onSettled: (_result, _error, { owner, token }) => {
      if (owner.operation !== token) return
      owner.operation = null
      if (!owner.mounted) return
      // An error/removal may already have erased the draft. Keep its operation
      // fence until this point, then release it without reviving private data.
      if (!owner.draft) release(token)
      publish(owner, owner.draft)
    },
  })

  const draft = snapshot?.owner === owner && snapshot.draft && canEdit && !isPending && !isError && records?.some(record => record.id === snapshot.draft.recordId)
    ? snapshot.draft : null
  return {
    busy: lock.busy || unresolved,
    unresolved,
    layout: lock.layout,
    descriptionId: lock.descriptionId,
    description: owner.operation
      ? 'Target sedang disimpan. Tunggu hingga penyimpanan selesai sebelum mengubah target lain.'
      : 'Simpan atau batalkan target yang sedang diedit sebelum mengubah target lain.',
    draft: draft && unresolved ? { ...draft, pending: true } : draft,
    confirmRecovered(recordId: string) {
      if (owner.mounted && !owner.operation && owner.draft?.recordId === recordId) clear(owner)
    },
    open(recordId: string, layout: TargetEditorLayout, value: string) {
      if (!owner.mounted || !owner.ready || owner.draft || owner.operation || !owner.recordIds.has(recordId)) return
      const token = Symbol('target-session')
      if (claim(token, layout)) publish(owner, { token, recordId, layout, value, pending: false, error: false })
    },
    change(token: symbol, value: string) {
      if (!owner.ready || owner.draft?.token !== token || owner.draft.pending) return
      publish(owner, { ...owner.draft, value })
    },
    save(token: symbol) {
      if (!owner.mounted || !owner.ready || owner.draft?.token !== token || owner.operation) return
      const draft = { ...owner.draft, pending: true, error: false }
      owner.operation = token
      publish(owner, draft)
      mutation.mutate({ owner, token, recordId: draft.recordId, targetValue: parseFloat(draft.value) || 0, write, onSaved })
    },
    cancel(token: symbol) {
      if (!owner.ready || owner.draft?.token !== token || owner.draft.pending) return
      clear(owner)
    },
  }
}

export type TargetDraftSession = ReturnType<typeof useTargetDraftSession>
