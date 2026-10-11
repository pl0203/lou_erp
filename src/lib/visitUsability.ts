import { parseCalendarDate } from './calendarDate'

export function isVisitDate(value: string): boolean {
  return /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
export function visitDateLabel(value: string): string {
  return isVisitDate(value) ? parseCalendarDate(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Tanggal belum dipilih'
}
export function isVisitScheduleConflict(error: unknown): boolean {
  return /one_rep_per_customer_per_day/.test((error as Error | null)?.message ?? '')
}
export function visitSaveError(error: unknown): string {
  return isVisitScheduleConflict(error)
    ? 'Pelanggan ini sudah memiliki jadwal pada tanggal tersebut. Pilih tanggal lain atau tinjau jadwal yang sudah ada.'
    : (error as Error | null)?.message ?? 'Penyimpanan belum berhasil. Silakan coba lagi.'
}
const roles: Record<string, string> = { sales_person: 'Staf Penjualan', sales_manager: 'Manajer Penjualan', sales_head: 'Kepala Penjualan', executive: 'Direktur' }
export function visitAssigneeLabel(person: { full_name: string; role?: string; manager_id?: string | null }, team: { id: string; full_name: string }[]): string {
  const manager = team.find(member => member.id === person.manager_id)
  return [person.full_name, person.role ? roles[person.role] ?? 'Tim Penjualan' : null, manager ? `Tim ${manager.full_name}` : null].filter(Boolean).join(' · ')
}
/** Match the existing elapsed-time rule exactly. A revisit reminder is not appointment lateness. */
export function visitCadence(lastVisit: string | null | undefined, frequencyDays: number, now = Date.now()) {
  if (!lastVisit) return { label: 'Belum pernah dikunjungi', explanation: 'Belum ada kunjungan terakhir yang tercatat untuk pelanggan ini.' }
  const deadline = new Date(lastVisit).getTime() + frequencyDays * 86_400_000
  if (!Number.isFinite(deadline) || now <= deadline) return null
  const cutoff = new Date(deadline).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
  return { label: 'Interval kunjungan terlewati', explanation: `Pengingat kunjungan ulang pelanggan: ${frequencyDays} hari sejak kunjungan terakhir, melewati ${cutoff} UTC.` }
}
export function visitScheduleHref(date: string, person?: string, manager?: string, status?: string): string {
  const query = new URLSearchParams({ date })
  if (person) query.set('person', person)
  if (manager) query.set('manager', manager)
  if (status) query.set('status', status)
  return `/girard/schedule?${query}`
}
