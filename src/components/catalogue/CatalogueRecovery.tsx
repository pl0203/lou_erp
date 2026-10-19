import { useLayoutEffect, useRef, useState } from 'react'
import type { CatalogueMaintainerRole, CatalogueReceipt } from '../../lib/catalogue/contracts'
import type { CatalogueTransactionSender } from '../../lib/catalogue/transactions'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Feedback'

export interface CatalogueOwner {
  /** Stable operation owner; replace on actor, backend, role or mounted owner changes. */
  key: string
  actorId: string
  role: CatalogueMaintainerRole
  isCurrent(): boolean
}
/** Authority refresh is part of sending/reconciling. It must not retire its own
 * operation lease; owner.isCurrent still checks fresh authority at every boundary. */
export function useCatalogueOwnerLease(owner: CatalogueOwner, sender: CatalogueTransactionSender) {
  const epoch = useRef(0), active = useRef(false)
  useLayoutEffect(() => {
    active.current = true; epoch.current++
    return () => { active.current = false; epoch.current++ }
  }, [owner, sender])
  return () => {
    const captured = epoch.current
    return () => active.current && epoch.current === captured && owner.isCurrent()
  }
}
export interface CatalogueRecoveryProps {
  owner: CatalogueOwner
  sender: CatalogueTransactionSender
  available: boolean
  acceptCanonical(receipt: CatalogueReceipt): Promise<boolean>
  onConfirmed(receipt: CatalogueReceipt): void
  /** Required canonical/authority refresh after a terminal abandoned result. */
  acceptAbandoned?(): Promise<boolean>
  onAbandoned?(): void
}
export function CatalogueRecovery({ owner, sender, available, acceptCanonical, onConfirmed, acceptAbandoned, onAbandoned }: CatalogueRecoveryProps) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null)
  const [confirmAbandon, setConfirmAbandon] = useState(false), [abandoned, setAbandoned] = useState(false)
  const lock = useRef<symbol | null>(null), live = useRef(false)
  const lease = useCatalogueOwnerLease(owner, sender)
  useLayoutEffect(() => {
    live.current = true; lock.current = null; setBusy(false); setMessage(null); setConfirmAbandon(false); setAbandoned(false)
    return () => { live.current = false }
  }, [owner, sender])
  async function check(abandon = false) {
    if (lock.current || !available || !owner.isCurrent() || abandon && (!confirmAbandon || !acceptAbandoned || !onAbandoned)) return
    const current = lease(), operation = Symbol()
    lock.current = operation; setBusy(true); setMessage(null)
    let terminalAbandoned = abandoned
    try {
      // Local terminal state is presentation only. Every explicit check revalidates
      // the actual durable/fallback request before canonical acceptance.
      const result = await sender.reconcile(abandon)
      if (!current()) return
      if (result.status === 'abandoned') {
        terminalAbandoned = true; setAbandoned(true); setConfirmAbandon(false)
        if (acceptAbandoned && onAbandoned && await acceptAbandoned() && current()) {
          await sender.acknowledgeAbandoned()
          if (current()) onAbandoned()
        } else if (current()) setMessage('Permintaan telah dibatalkan. Data dan kewenangan terbaru belum dapat diverifikasi; periksa kembali.')
        return
      }
      setAbandoned(false); terminalAbandoned = false
      if (result.status === 'unknown') {
        setMessage('Hasil belum diketahui. Identitas permintaan tetap disimpan; jangan kirim ulang.'); return
      }
      if (result.receipt.actor_id !== owner.actorId) throw new Error('Pemilik hasil tidak sesuai.')
      const accepted = await acceptCanonical(result.receipt)
      if (!current()) return
      if (!accepted) { setMessage('Data terbaru belum dapat diverifikasi. Periksa hasil kembali.'); return }
      await sender.acknowledgeRecovered()
      if (current()) onConfirmed(result.receipt)
    } catch {
      if (current()) setMessage(terminalAbandoned ? 'Permintaan telah dibatalkan. Data dan kewenangan terbaru belum dapat diverifikasi; periksa kembali.' : 'Pemulihan belum berhasil. Identitas permintaan tetap disimpan; periksa hasil kembali.')
    } finally {
      if (live.current && lock.current === operation) { lock.current = null; setBusy(false) }
    }
  }
  return <Notice tone="warning" title="Hasil belum terkonfirmasi" actions={<>
    <Button size="compact" variant="secondary" pending={busy} disabled={busy || !available || !owner.isCurrent()} onClick={() => { void check(false) }}>Periksa hasil</Button>
    {acceptAbandoned && onAbandoned && !abandoned && <Button size="compact" variant="danger-quiet" disabled={busy || !available || !owner.isCurrent()} onClick={() => setConfirmAbandon(true)}>Batalkan permintaan tersimpan</Button>}
  </>}>
    <p>Jangan kirim ulang. Pemulihan tetap tersedia meskipun baris tidak terlihat pada halaman ini.</p>
    {!available && <p>Pemulihan belum tersedia untuk kewenangan atau backend saat ini.</p>}
    {confirmAbandon && <div>
      <p>Batalkan hanya permintaan yang belum selesai. Jika perubahan sudah tersimpan, hasilnya tetap dipulihkan; perubahan tidak dibatalkan dan tidak dikirim ulang.</p>
      <Button variant="danger" disabled={busy || !available || !owner.isCurrent()} onClick={() => { void check(true) }}>Konfirmasi pembatalan permintaan</Button>
      <Button variant="secondary" disabled={busy} onClick={() => setConfirmAbandon(false)}>Kembali</Button>
    </div>}
    {message && <p>{message}</p>}
  </Notice>
}
