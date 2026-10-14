import { useLayoutEffect, useRef, useState } from 'react'
import type { CatalogueMaintainerRole, CatalogueReceipt } from '../../lib/catalogue/contracts'
import type { CatalogueTransactionSender } from '../../lib/catalogue/transactions'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Feedback'

export interface CatalogueOwner {
  /** Stable mounted form/record owner; replace on actor, backend, role or authority epoch changes. */
  key: string
  actorId: string
  role: CatalogueMaintainerRole
  isCurrent(): boolean
}
/** A committed-owner lease, invalidated by cleanup even during an A → B → A transition. */
export function useCatalogueOwnerLease(owner: CatalogueOwner, sender: CatalogueTransactionSender, authority: unknown) {
  const epoch = useRef(0)
  const active = useRef(false)
  useLayoutEffect(() => {
    active.current = true
    epoch.current += 1
    return () => { active.current = false; epoch.current += 1 }
  }, [owner, sender, authority])
  return () => {
    const captured = epoch.current
    return () => active.current && epoch.current === captured && owner.isCurrent()
  }
}

export interface CatalogueRecoveryProps {
  owner: CatalogueOwner
  sender: CatalogueTransactionSender
  available: boolean
  /** Refresh and validate current canonical state for this exact receipt, including deletion.
   * Return true only after accepting that state; never treat RPC success alone as acceptance. */
  acceptCanonical(receipt: CatalogueReceipt): Promise<boolean>
  /** Invoked only after canonical acceptance AND durable sender acknowledgement. */
  onConfirmed(receipt: CatalogueReceipt): void
}

export function CatalogueRecovery({ owner, sender, available, acceptCanonical, onConfirmed }: CatalogueRecoveryProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const lock = useRef<symbol | null>(null)
  const lease = useCatalogueOwnerLease(owner, sender, available)
  useLayoutEffect(() => {
    lock.current = null; setBusy(false); setMessage(null)
  }, [owner, sender, available])
  async function check() {
    if (lock.current || !available || !owner.isCurrent()) return
    const current = lease()
    const operation = Symbol()
    lock.current = operation; setBusy(true); setMessage(null)
    try {
      const result = await sender.reconcile(false)
      if (!current()) return
      if (result.status !== 'committed') {
        setMessage('Hasil belum diketahui. Identitas permintaan tetap disimpan; jangan kirim ulang.')
        return
      }
      if (result.receipt.actor_id !== owner.actorId) throw new Error('Pemilik hasil tidak sesuai.')
      const accepted = await acceptCanonical(result.receipt)
      if (!current()) return
      if (!accepted) { setMessage('Data terbaru belum dapat diverifikasi. Periksa hasil kembali.'); return }
      await sender.acknowledgeRecovered()
      if (current()) onConfirmed(result.receipt)
    } catch {
      if (current()) setMessage('Pemulihan belum berhasil. Identitas permintaan tetap disimpan; periksa hasil kembali.')
    } finally {
      if (lock.current === operation) lock.current = null
      if (current()) setBusy(false)
    }
  }
  return <Notice tone="warning" title="Hasil belum terkonfirmasi" actions={<Button size="compact" variant="secondary" pending={busy} disabled={!available || !owner.isCurrent()} onClick={check}>Periksa hasil</Button>}>
    <p>Jangan kirim ulang. Tutup hanya setelah hasil dan data terbaru terverifikasi.</p>
    {!available && <p>Pemulihan belum tersedia untuk kewenangan atau backend saat ini.</p>}
    {message && <p>{message}</p>}
  </Notice>
}
