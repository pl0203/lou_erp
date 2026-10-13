/** Keep SQL DATE values in the browser's local calendar; do not parse them as UTC instants. */
export function calendarDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}
export function calendarDayOptions(count: number, now: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, index) => calendarDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + index)))
}
