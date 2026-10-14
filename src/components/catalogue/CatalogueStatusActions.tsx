import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { CatalogueKind, CatalogueReceipt, CatalogueRow, ProcurementAccessV2 } from '../../lib/catalogue/contracts'
import type { CatalogueTransactionSender } from '../../lib/catalogue/transactions'
import { CatalogueCommandError } from '../../lib/catalogue/transactions'
import { decodeProcurementAccessV2 } from '../../lib/catalogue/validation'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Notice, StatusBadge } from '../ui/Feedback'
import { CatalogueRecovery, useCatalogueOwnerLease } from './CatalogueRecovery'
import type { CatalogueOwner } from './CatalogueRecovery'

export interface CatalogueStatusActionsProps {
  kind: CatalogueKind
  row: CatalogueRow
  owner: CatalogueOwner
  /** Only current confirmed authority; pass null while loading, stale or errored. */
  authority: ProcurementAccessV2 | null
  /** False until deployment/backend command guards are confirmed available. */
  commandsAvailable: boolean
  sender: CatalogueTransactionSender
  onEdit(): void
  /** Separate PO/executive product-delete UI. Must confirm an affected row itself.
   * This is deliberately not a guarded sender fallback or a completion callback. */
  onDirectProductDelete?: () => void
  acceptCanonical(receipt: CatalogueReceipt): Promise<boolean>
  onConfirmed(receipt: CatalogueReceipt): void
}
type Intent = { action: 'enable' | 'disable' | 'delete'; row: CatalogueRow }

export function CatalogueStatusActions(props: CatalogueStatusActionsProps) {
  // Remount transient confirmation state when the explicit owner changes. Durable recovery belongs to sender.
  return <Actions key={`${props.owner.key}:${props.kind}:${props.row.id}`} {...props} />
}
function Actions({ kind, row, owner, authority, commandsAvailable, sender, onEdit, onDirectProductDelete, acceptCanonical, onConfirmed }: CatalogueStatusActionsProps) {
  const [intent, setIntent] = useState<Intent | null>(null)
  const [busy, setBusy] = useState(false)
  const [needsRecovery, setNeedsRecovery] = useState(() => sender.hasUnresolved())
  const [error, setError] = useState<string | null>(null)
  const [, refreshSenderState] = useState(0)
  const liveScope = useRef<{ owner: CatalogueOwner; sender: CatalogueTransactionSender } | null>(null)
  const lock = useRef<symbol | null>(null), returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const lease = useCatalogueOwnerLease(owner, sender, authority)
  useLayoutEffect(() => {
    liveScope.current = { owner, sender }
    return () => { liveScope.current = null }
  }, [owner, sender])
  useLayoutEffect(() => {
    // Only transient ownership is reset. Durable unresolved identity remains in sender.
    lock.current = null; setBusy(false)
  }, [owner, sender, authority])
  let access: ProcurementAccessV2 | null = null
  try { if (authority && owner.isCurrent()) access = decodeProcurementAccessV2(authority, { actorId: owner.actorId, role: owner.role }) } catch { /* Fail closed. */ }
  const unresolved = needsRecovery || sender.hasUnresolved()
  const blocked = busy || unresolved || !access
  const canStatus = !blocked && commandsAvailable && !!access?.[`${kind}_set_enabled`]
  const mode = access?.[`${kind}_delete_mode`] ?? 'none'
  const canGuardedDelete = !blocked && commandsAvailable && owner.role === 'co_admin' && mode === 'guarded' && !!access?.[`${kind}_delete`]
  const direct = kind === 'product' && mode === 'direct' && (owner.role === 'po_admin' || owner.role === 'executive')
  function open(action: Intent['action']) {
    if (blocked || !owner.isCurrent() || (action === 'delete' ? !canGuardedDelete : !canStatus)) return
    returnFocus.current = document.activeElement as HTMLElement
    setError(null); setIntent({ action, row: { ...row } })
  }
  function close() { if (!lock.current && !sender.hasUnresolved() && !needsRecovery) setIntent(null) }
  async function confirm() {
    if (!intent || lock.current || !owner.isCurrent() || (intent.action === 'delete' ? !canGuardedDelete : !canStatus)) return
    // Never silently rebase a captured confirmation onto a newly refreshed row.
    if (row.id !== intent.row.id || row.catalog_version !== intent.row.catalog_version || row.is_enabled !== intent.row.is_enabled) {
      setError('Data berubah. Batalkan dan periksa versi terbaru sebelum mengonfirmasi lagi.'); return
    }
    const current = lease()
    const operation = Symbol()
    lock.current = operation; setBusy(true); setError(null)
    try {
      const target = { kind, id: intent.row.id, expected_version: intent.row.catalog_version }
      if (intent.action === 'delete') await sender('delete_unused', target)
      else await sender('set_enabled', { ...target, is_enabled: intent.action === 'enable' })
      // A receipt is durable but not yet accepted canonical UI state. Recovery owns acknowledgement.
      if (current()) setNeedsRecovery(true)
    } catch (reason) {
      if (current()) {
        setNeedsRecovery(sender.hasUnresolved())
        setError(reason instanceof CatalogueCommandError ? reason.message : 'Hasil belum dapat dipastikan. Periksa hasil sebelum mencoba lagi.')
      }
    } finally {
      if (liveScope.current?.owner === owner && liveScope.current.sender === sender) {
        // Refresh only current durable/advisory state after a stale operation settles.
        // Never publish its result or unlock a newer attempt.
        if (lock.current === operation) { lock.current = null; setBusy(false) }
        refreshSenderState(value => value + 1)
      }
    }
  }
  const label = intent?.action === 'delete' ? 'Hapus bila tidak digunakan' : intent?.action === 'enable' ? 'Aktifkan' : 'Nonaktifkan'
  const recovery = <CatalogueRecovery owner={owner} sender={sender} available={!!access && commandsAvailable} acceptCanonical={receipt => receipt.kind === kind && receipt.id === row.id ? acceptCanonical(receipt) : Promise.resolve(false)} onConfirmed={receipt => {
    setNeedsRecovery(false); setBusy(false); setIntent(null); setError(null); onConfirmed(receipt)
  }} />
  return <div className="ui-form-actions">
    <StatusBadge tone={row.is_enabled ? 'success' : 'neutral'}>{row.is_enabled ? 'Aktif' : 'Nonaktif'}</StatusBadge>
    <Button size="compact" variant="secondary" disabled={blocked || !access?.[`${kind}_edit`]} onClick={() => { if (owner.isCurrent()) onEdit() }}>Edit</Button>
    <Button size="compact" variant="secondary" disabled={!canStatus} onClick={() => open(row.is_enabled ? 'disable' : 'enable')}>{row.is_enabled ? 'Nonaktifkan' : 'Aktifkan'}</Button>
    <Button size="compact" variant="danger-quiet" disabled={!canGuardedDelete} onClick={() => open('delete')}>Hapus bila tidak digunakan</Button>
    {direct && <Button size="compact" variant="danger-quiet" disabled={blocked || !access?.product_delete || !onDirectProductDelete} onClick={() => { if (owner.isCurrent()) onDirectProductDelete?.() }}>Hapus produk langsung</Button>}
    {!commandsAvailable && <Notice tone="info" title="Perubahan status dan penghapusan terjaga belum tersedia" />}
    {!access && <Notice tone="warning" title="Kewenangan katalog belum terkonfirmasi" />}
    {unresolved && !intent && recovery}
    {intent && <Dialog labelledBy={titleId} pending={busy || unresolved} onClose={close} returnFocus={returnFocus.current} fallbackFocus={() => null}>
      <h2 id={titleId}>{label}: {intent.row.name}</h2>
      <p>Versi: {intent.row.catalog_version}</p>
      {intent.action === 'delete' && <p>Penghapusan hanya tersedia bila penggunaan atau riwayat data dapat dikesampingkan. Nonaktifkan bila sesuai.</p>}
      {error && <Notice tone="warning" title={error} />}
      {unresolved ? recovery : <Button pending={busy} disabled={intent.action === 'delete' ? !canGuardedDelete : !canStatus} onClick={confirm}>Konfirmasi {label}</Button>}
      <Button variant="secondary" disabled={busy || unresolved} onClick={close}>Batal</Button>
    </Dialog>}
  </div>
}
