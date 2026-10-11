/** SQL DATE values are calendar dates, never device-local instants. */
export function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return '—'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value
  return date.toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
}

/** Display convention only; stored instants and business/reporting boundaries are unchanged. */
export function formatAuditTimestamp(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Waktu tidak tersedia'
  return `${date.toLocaleString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} UTC`
}
