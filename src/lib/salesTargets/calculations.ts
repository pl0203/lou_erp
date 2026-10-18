import { METRICS, validMoney, validMonth } from './contracts'
import type { BaselinePerson, Metric, Money, MonthValue, TargetLine } from './contracts'
/** Only decimal strings cross the money boundary; no floating-point summing or writes. */
export function moneyCents(value: Money): bigint {
  if (!validMoney(value)) throw new Error('Masukkan nominal positif atau nol, maksimum 2 angka desimal.')
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}
export function centsMoney(value: bigint): Money {
  const negative = value < 0n, digits = (negative ? -value : value).toString().padStart(3, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`
}
export function canonicalMoney(value: Money): Money { return centsMoney(moneyCents(value)) }
export function addMoney(values: Money[]): Money { return centsMoney(values.reduce((sum, value) => sum + moneyCents(value), 0n)) }
export function moneyDifference(amount: Money, baseline: Money): Money { return centsMoney(moneyCents(amount) - moneyCents(baseline)) }
export function monthShift(value: string, by: number): string {
  if (!validMonth(value)) throw new Error('Bulan target tidak valid.')
  const date = new Date(`${value}T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + by)
  return date.toISOString().slice(0, 10)
}
export function currentTargetMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(now)
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-01`
}
export function nextTargetMonth(now = new Date()): string { return monthShift(currentTargetMonth(now), 1) }
export function completedMonths(targetMonth: string, now = new Date(), count = 3): string[] {
  if (!validMonth(targetMonth)) throw new Error('Bulan target tidak valid.')
  const current = currentTargetMonth(now)
  const cutoff = targetMonth < current ? targetMonth : current
  return Array.from({ length: count }, (_, index) => monthShift(cutoff, index - count))
}
export function baselineForCustomer(months: MonthValue[]): Money | null {
  if (months.length !== 3 || months.some((value, index) => value.quality !== 'complete' || value.amount === null || !validMonth(value.month) || (index > 0 && monthShift(months[index - 1].month, 1) !== value.month))) return null
  return centsMoney((months.reduce((sum, value) => sum + moneyCents(value.amount!), 0n) + 1n) / 3n)
}
export function baselineForPerson(person: BaselinePerson, metric: Metric): Money | null {
  if (!person.customers.length) return null
  const baselines = person.customers.map(customer => {
    const cell = customer.cells.find(value => value.metric === metric)
    return cell?.complete ? baselineForCustomer(cell.months) : null
  })
  return baselines.includes(null) ? null : addMoney(baselines as Money[])
}
export function buildSuggestedLines(people: BaselinePerson[]): TargetLine[] {
  return people.flatMap(person => METRICS.map(metric => ({ personId: person.personId, metric, amount: baselineForPerson(person, metric), applicability: 'target' as const, reason: null })))
}
export type LineError = { personId: string; metric: Metric; message: string }
export function validateLines(lines: TargetLine[], people: BaselinePerson[]): LineError[] {
  const errors: LineError[] = []
  for (const person of people) for (const metric of METRICS) {
    const matches = lines.filter(line => line.personId === person.personId && line.metric === metric), line = matches[0]
    let message = ''
    if (matches.length !== 1) message = 'Target tidak lengkap atau terduplikasi. Muat ulang dasar target.'
    else if (line.applicability === 'not_applicable') { if (!line.reason?.trim()) message = 'Tambahkan alasan tidak berlaku.' }
    else if (line.amount === null || !validMoney(line.amount)) message = 'Isi target (Rp), termasuk nol bila memang tidak ada target.'
    else {
      const baseline = baselineForPerson(person, metric)
      if (requiresTransferReview(person, metric) && !line.reason?.trim()) message = 'Tambahkan alasan peninjauan order/stok warisan: kredit aktual tetap pada sales sebelumnya.'
      else if ((baseline === null || moneyCents(baseline) !== moneyCents(line.amount)) && !line.reason?.trim()) message = baseline === null ? 'Tambahkan alasan penetapan manual karena riwayat belum lengkap.' : 'Tambahkan alasan penyesuaian dari dasar historis.'
    }
    if (message) errors.push({ personId: person.personId, metric, message })
  }
  for (const line of lines) if (!people.some(person => person.personId === line.personId)) errors.push({ ...line, message: 'Anggota tim berubah. Muat ulang dasar target.' })
  return errors
}

export function requiresTransferReview(person: BaselinePerson, metric: Metric): boolean {
  return person.customers.some(customer => customer.cells.some(cell => cell.metric === metric && cell.warningCodes.includes('TRANSFER_ACTUALS_REMAIN_PREDECESSOR')))
}
/** Restore saved values, but never invent values for roster rows absent from an old draft. */
export function restoreTargetLines(lines: TargetLine[], people: BaselinePerson[], reviewedRosterChange = false): TargetLine[] {
  if (!reviewedRosterChange && lines.some(line => !people.some(person => person.personId === line.personId))) throw new Error('Tim pada draf berbeda dari portofolio saat ini. Tinjau ulang rencana.')
  return people.flatMap(person => METRICS.map(metric => {
    const matches = lines.filter(line => line.personId === person.personId && line.metric === metric)
    if (matches.length > 1) throw new Error('Target terduplikasi. Muat ulang rencana.')
    return matches[0] ?? { personId: person.personId, metric, amount: null, applicability: 'target' as const, reason: null }
  }))
}
