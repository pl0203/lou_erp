import { formatDisplayDate } from './displayDate'
import type { AuditEntry } from './reads/detailReads'

export const PO_STATUS_LABELS: Record<string, string> = {
  confirm: 'Dikonfirmasi',
  in_progress: 'Dalam proses',
  complete: 'Selesai',
  cancelled: 'Dibatalkan',
}

/** Do not invent names for historical IDs or reinterpret unknown audit payloads. */
export function summarizePOAudit(entry: AuditEntry): string {
  const actor = entry.users?.full_name || 'Pengguna tercatat'
  if (entry.field_changed === 'status') {
    const before = entry.old_value && PO_STATUS_LABELS[entry.old_value]
    const after = entry.new_value && PO_STATUS_LABELS[entry.new_value]
    return before && after ? `${actor} mengubah status PO dari ${before} menjadi ${after}.` : `${actor} mengubah status PO.`
  }
  const actions: Record<string, string> = {
    po_items_revised: 'memperbarui daftar barang PO',
    sj_lines_revised: 'memperbarui jumlah barang pada surat jalan',
    sj_voided: 'membatalkan surat jalan',
    po_cancelled: 'membatalkan PO',
    customer: 'mengganti pelanggan PO',
    notes: 'mengubah catatan PO',
    expected_delivery_date: 'mengubah tanggal kedaluwarsa PO',
    sj_date_returned: 'mengubah tanggal SJ kembali',
  }
  const action = actions[entry.field_changed]
  if (!action) return `${actor} memperbarui data PO. Rincian asli tersedia di detail teknis.`
  if (['expected_delivery_date', 'sj_date_returned'].includes(entry.field_changed)) {
    return `${actor} ${action}: ${formatDisplayDate(entry.old_value)} → ${formatDisplayDate(entry.new_value)}.`
  }
  return `${actor} ${action}.`
}
