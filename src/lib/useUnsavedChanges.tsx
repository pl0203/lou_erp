import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import { Dialog } from '../components/ui/Dialog'
import { Button } from '../components/ui/Button'
import { FormActions } from '../components/ui/FormActions'

const DEFAULT_MESSAGE = 'Perubahan yang belum disimpan akan hilang. Permintaan yang sudah dikirim tidak dibatalkan; pulihkan hasilnya jika belum terkonfirmasi.'

function DiscardDialog({ message, onKeep, onDiscard }: { message: string; onKeep: () => void; onDiscard: () => void }) {
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const title = useId()
  const description = useId()
  return <Dialog labelledBy={title} aria-describedby={description} pending={false} onClose={onKeep} returnFocus={returnFocus.current} fallbackFocus={() => null}>
    <h2 id={title} className="ui-dialog__title">Buang perubahan?</h2>
    <p id={description} className="ui-dialog__description">{message}</p>
    <FormActions className="mt-5">
      <Button autoFocus variant="secondary" onClick={onKeep}>Tetap mengedit</Button>
      <Button variant="danger" onClick={onDiscard}>Buang perubahan</Button>
    </FormActions>
  </Dialog>
}

/** In-memory navigation protection only. Never changes transaction recovery metadata. */
export function useUnsavedChanges(isDirty: boolean) {
  const dirty = useRef(isDirty)
  dirty.current = isDirty
  const bypass = useRef(false)
  type Pending = { action: () => void; message: string; settle?: (accepted: boolean) => void }
  const [pending, publishPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const setPending = (next: Pending | null) => {
    const previous = pendingRef.current
    pendingRef.current = next; publishPending(next)
    if (previous !== next) previous?.settle?.(false)
  }
  useEffect(() => () => { pendingRef.current?.settle?.(false); pendingRef.current = null }, [])
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) =>
    dirty.current && !bypass.current && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`, []))
  const latestBlocker = useRef(blocker)
  latestBlocker.current = blocker
  useEffect(() => {
    if (!isDirty) {
      bypass.current = false
      setPending(null)
      if (blocker.state === 'blocked') blocker.reset()
    }
  }, [isDirty, blocker])
  useBeforeUnload(useCallback(event => {
    if (dirty.current && !bypass.current) { event.preventDefault(); event.returnValue = '' }
  }, []))

  const keep = () => {
    setPending(null)
    if (blocker.state === 'blocked') blocker.reset()
  }
  const discard = () => {
    if (pending?.settle) pending.settle(true)
    else if (blocker.state === 'blocked') blocker.proceed()
    else pending?.action()
    setPending(null)
  }
  return {
    confirmDiscardDecision(options: { message?: string; signal?: AbortSignal } = {}): Promise<boolean> {
      if (options.signal?.aborted || latestBlocker.current.state === 'blocked') return Promise.resolve(false)
      if (!dirty.current) return Promise.resolve(true)
      return new Promise(resolve => {
        let finished = false
        const settle = (accepted: boolean) => {
          if (finished) return
          finished = true; options.signal?.removeEventListener('abort', cancel); resolve(accepted)
        }
        const decision: Pending = { action: () => {}, message: options.message ?? DEFAULT_MESSAGE, settle }
        const cancel = () => { if (pendingRef.current === decision) setPending(null); else settle(false) }
        setPending(decision); options.signal?.addEventListener('abort', cancel, { once:true })
      })
    },
    confirmDiscard(action: () => void, options: { when?: boolean; message?: string } = {}) {
      if (options.when ?? dirty.current) setPending({ action, message: options.message ?? DEFAULT_MESSAGE })
      else action()
    },
    runWithoutPrompt(action: () => void) {
      bypass.current = true
      setPending(null)
      if (latestBlocker.current.state === 'blocked') latestBlocker.current.reset()
      action()
    },
    dialog: blocker.state === 'blocked' || pending
      ? <DiscardDialog message={pending?.message ?? DEFAULT_MESSAGE} onKeep={keep} onDiscard={discard} /> : null,
  }
}

// Draft-only NaN means no price has been entered; an explicit zero is a real edit.
export function hasOrderItemChanges(items: { product_id: string | null; product_name: string; sku: string; quantity: number; unit_price: number; is_promo?: boolean; promotion_id?: string | null }[]) {
  return items.length !== 1 || items.some(item => item.product_id !== null || item.product_name !== '' || item.sku !== '' || item.quantity !== 1 || !Number.isNaN(item.unit_price) || item.is_promo || item.promotion_id)
}
