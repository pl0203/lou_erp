import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { CatalogueKind, CatalogueRow, ProcurementAccessV2 } from '../../lib/catalogue/contracts'
import type { CatalogueTransactionSender } from '../../lib/catalogue/transactions'
import { CatalogueCommandError } from '../../lib/catalogue/transactions'
import { decodeProcurementAccessV2 } from '../../lib/catalogue/validation'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Notice, StatusBadge } from '../ui/Feedback'
import { useCatalogueOwnerLease } from './CatalogueRecovery'
import type { CatalogueOwner } from './CatalogueRecovery'

export interface CatalogueStatusActionsProps {
  kind: CatalogueKind
  row: CatalogueRow
  owner: CatalogueOwner
  authority: ProcurementAccessV2 | null
  /** Local prerequisites and a validated current list, not a hosted-deployment claim. */
  commandsAvailable: boolean
  /** Independently verified current generation/readiness. Missing means unavailable. */
  guardedDeleteAvailable?: boolean
  sender: CatalogueTransactionSender
  disabled?: boolean
  fallbackFocus?: () => HTMLElement | null
}
type Intent = { operation: 'set_enabled'; is_enabled: boolean; row: CatalogueRow } | { operation: 'delete_unused'; row: CatalogueRow }

/** Receipt-backed status and CO guarded deletion. Native direct-delete stays in the page.
 * Recovery is deliberately owned by the page, never by an individual row. */
export function CatalogueStatusActions(props: CatalogueStatusActionsProps) {
  return <Actions key={`${props.owner.key}:${props.kind}:${props.row.id}`} {...props} />
}
function Actions({ kind, row, owner, authority, commandsAvailable, guardedDeleteAvailable = false, sender, disabled = false, fallbackFocus = () => null }: CatalogueStatusActionsProps) {
  const [intent, setIntent] = useState<Intent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef<symbol | null>(null), returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId(), lease = useCatalogueOwnerLease(owner, sender)
  const live = useRef(false)
  useLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [owner, sender])
  let access: ProcurementAccessV2 | null = null
  try { if (authority && owner.isCurrent()) access = decodeProcurementAccessV2(authority, { actorId: owner.actorId, role: owner.role }) } catch { /* Fail closed. */ }
  const available = !disabled && !busy && !sender.hasUnresolved() && commandsAvailable
  const canStatus = available && !!access?.[`${kind}_set_enabled`]
  const canDelete = available && guardedDeleteAvailable && access?.role === 'co_admin' && !!access[`${kind}_delete`] && access[`${kind}_delete_mode`] === 'guarded'
  const canConfirm = intent?.operation === 'delete_unused' ? canDelete : canStatus
  function close() { if (!lock.current) setIntent(null) }
  async function confirm() {
    if (!intent || lock.current || !canConfirm || !owner.isCurrent()) return
    if (row.id !== intent.row.id || row.catalog_version !== intent.row.catalog_version || row.is_enabled !== intent.row.is_enabled) {
      setError('Data berubah. Batalkan dan periksa versi terbaru sebelum mengonfirmasi lagi.'); return
    }
    const current = lease(), operation = Symbol()
    lock.current = operation; setBusy(true); setError(null)
    try {
      if (intent.operation === 'delete_unused') {
        await sender('delete_unused', { kind, id: intent.row.id, expected_version: intent.row.catalog_version })
      } else {
        await sender('set_enabled', { kind, id: intent.row.id, expected_version: intent.row.catalog_version, is_enabled: intent.is_enabled })
      }
      if (current()) setIntent(null)
    } catch (reason) {
      if (current()) setError(reason instanceof CatalogueCommandError ? reason.message : 'Perubahan belum terkonfirmasi. Periksa hasil di bagian pemulihan katalog.')
    } finally {
      if (live.current && lock.current === operation) {
        lock.current = null; setBusy(false)
        // The page keeps the durable attempt reachable after filter, pagination or navigation.
        if (sender.hasUnresolved()) setIntent(null)
      }
    }
  }
  const label = intent?.operation === 'delete_unused' ? 'Hapus' : intent?.is_enabled ? 'Aktifkan' : 'Nonaktifkan'
  return <div className="ui-form-actions">
    <StatusBadge tone={row.is_enabled ? 'success' : 'neutral'}>{row.is_enabled ? 'Aktif' : 'Nonaktif'}</StatusBadge>
    <Button size="compact" variant="secondary" disabled={!canStatus} onClick={() => {
      if (!canStatus || !owner.isCurrent()) return
      returnFocus.current = document.activeElement as HTMLElement
      setError(null); setIntent({ operation: 'set_enabled', is_enabled: !row.is_enabled, row: { ...row } })
    }}>{row.is_enabled ? 'Nonaktifkan' : 'Aktifkan'}</Button>
    <Button size="compact" variant="danger-quiet" disabled={!canDelete} title="Hanya data yang belum pernah digunakan dapat dihapus." onClick={() => {
      if (!canDelete || !owner.isCurrent()) return
      returnFocus.current = document.activeElement as HTMLElement
      setError(null); setIntent({ operation: 'delete_unused', row: { ...row } })
    }}>Hapus bila tidak digunakan</Button>
    {intent && <Dialog labelledBy={titleId} pending={busy} onClose={close} returnFocus={null} fallbackFocus={() => !sender.hasUnresolved() && returnFocus.current?.isConnected ? returnFocus.current : fallbackFocus()}>
      <h2 id={titleId}>{label}: {intent.row.name}</h2>
      <p>Versi: {intent.row.catalog_version}</p>
      {intent.operation === 'delete_unused' && <p>Penghapusan hanya dapat dilakukan bila data belum pernah digunakan. Tindakan ini tidak dapat dibatalkan.</p>}
      {error && <Notice tone="warning" title={error} />}
      <Button variant={intent.operation === 'delete_unused' ? 'danger' : 'primary'} pending={busy} disabled={!canConfirm} onClick={confirm}>Konfirmasi {label}</Button>
      <Button variant={intent.operation === 'delete_unused' ? 'quiet' : 'secondary'} disabled={busy} onClick={close}>Batal</Button>
    </Dialog>}
  </div>
}

