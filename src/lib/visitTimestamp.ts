/** Display visit check-in instants in WIB without changing stored timestamps. */
const visitTimestamp = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatVisitTimestamp(value: string | null): string {
  if (!value) return 'Waktu tidak tersedia'
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime())) return 'Waktu tidak tersedia'
  const parts = visitTimestamp.formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}.${part('minute')} WIB`
}
