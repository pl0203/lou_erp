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
  sender: CatalogueTransactionSender
  disabled?: boolean
}
type Intent = { is_enabled: boolean; row: CatalogueRow }

/** Status-only commands. Legacy create/edit/direct-delete gates remain in the page.
 * Recovery is deliberately owned by the page, never by an individual row. */
export function CatalogueStatusActions(props: CatalogueStatusActionsProps) {
  return <Actions key={`${props.owner.key}:${props.kind}:${props.row.id}`} {...props} />
}
function Actions({ kind, row, owner, authority, commandsAvailable, sender, disabled = false }: CatalogueStatusActionsProps) {
  const [intent, setIntent] = useState<Intent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef<symbol | null>(null), returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId(), lease = useCatalogueOwnerLease(owner, sender)
  const live = useRef(false)
  useLayoutEffect(() => { live.current = true; return () => { live.current = false } }, [owner, sender])
  let access: ProcurementAccessV2 | null = null
  try { if (authority && owner.isCurrent()) access = decodeProcurementAccessV2(authority, { actorId: owner.actorId, role: owner.role }) } catch { /* Fail closed. */ }
  const canStatus = !disabled && !busy && !sender.hasUnresolved() && commandsAvailable && !!access?.[`${kind}_set_enabled`]
  function close() { if (!lock.current) setIntent(null) }
  async function confirm() {
    if (!intent || lock.current || !canStatus || !owner.isCurrent()) return
    if (row.id !== intent.row.id || row.catalog_version !== intent.row.catalog_version || row.is_enabled !== intent.row.is_enabled) {
      setError('Data berubah. Batalkan dan periksa versi terbaru sebelum mengonfirmasi lagi.'); return
    }
    const current = lease(), operation = Symbol()
    lock.current = operation; setBusy(true); setError(null)
    try {
      await sender('set_enabled', { kind, id: intent.row.id, expected_version: intent.row.catalog_version, is_enabled: intent.is_enabled })
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
  const label = intent?.is_enabled ? 'Aktifkan' : 'Nonaktifkan'
  return <div className="ui-form-actions">
    <StatusBadge tone={row.is_enabled ? 'success' : 'neutral'}>{row.is_enabled ? 'Aktif' : 'Nonaktif'}</StatusBadge>
    <Button size="compact" variant="secondary" disabled={!canStatus} onClick={() => {
      if (!canStatus || !owner.isCurrent()) return
      returnFocus.current = document.activeElement as HTMLElement
      setError(null); setIntent({ is_enabled: !row.is_enabled, row: { ...row } })
    }}>{row.is_enabled ? 'Nonaktifkan' : 'Aktifkan'}</Button>
    <Button size="compact" variant="danger-quiet" disabled title="Penghapusan terjaga belum tersedia; gunakan Nonaktifkan bila sesuai.">Hapus bila tidak digunakan</Button>
    {intent && <Dialog labelledBy={titleId} pending={busy} onClose={close} returnFocus={returnFocus.current} fallbackFocus={() => null}>
      <h2 id={titleId}>{label}: {intent.row.name}</h2>
      <p>Versi: {intent.row.catalog_version}</p>
      {error && <Notice tone="warning" title={error} />}
      <Button pending={busy} disabled={!canStatus} onClick={confirm}>Konfirmasi {label}</Button>
      <Button variant="secondary" disabled={busy} onClick={close}>Batal</Button>
    </Dialog>}
  </div>
}
