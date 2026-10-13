/** Indonesian compact hours/minutes display; never use binary day fractions. */
export function formatLeaveMinutes(minutes: number): string {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new RangeError('Leave minutes must be a nonnegative safe integer')
  const hours = Math.floor(minutes / 60), remainder = minutes % 60
  if (remainder === 0) return `${hours}j`
  return hours === 0 ? `${remainder}m` : `${hours}j ${remainder}m`
}
