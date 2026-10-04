function decimal(value: string) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Nilai uang tidak valid')
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  return { units: BigInt(whole + fraction), scale: fraction.length, negative }
}

function rounded(value: string, fractionDigits: number, divisorDigits = 0) {
  const parsed = decimal(value)
  const shift = parsed.scale + divisorDigits - fractionDigits
  const denominator = 10n ** BigInt(Math.max(0, shift))
  const units = shift > 0
    ? (parsed.units + denominator / 2n) / denominator
    : parsed.units * 10n ** BigInt(-shift)
  const digits = units.toString().padStart(fractionDigits + 1, '0')
  return { negative: parsed.negative && units !== 0n, whole: fractionDigits ? digits.slice(0, -fractionDigits) : digits, fraction: fractionDigits ? digits.slice(-fractionDigits) : '' }
}

/** Formats the SQL decimal text directly. It never rounds through a JS number. */
export function formatMoney(value: string, style: 'full' | 'millions'): string {
  const result = rounded(value, style === 'full' ? 3 : 1, style === 'millions' ? 6 : 0)
  const sign = result.negative ? '-' : ''
  if (style === 'millions') return `${sign}${result.whole}.${result.fraction}`
  const fraction = result.fraction.replace(/0+$/, '')
  return `${sign}${result.whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction ? `,${fraction}` : ''}`
}

/** Lossy finite projection exclusively for visual scales, never totals or writes. */
export function moneyToChartNumber(value: string): number {
  decimal(value)
  const projected = Number(value)
  if (!Number.isFinite(projected)) throw new Error('Nilai uang terlalu besar untuk grafik')
  return projected
}

export function moneyPercentage(value: string, total: string, digits = 0): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > 3) throw new Error('Presisi persentase tidak valid')
  const a = decimal(value)
  const b = decimal(total)
  const numerator = a.units * 10n ** BigInt(b.scale + digits + 2)
  const denominator = b.units * 10n ** BigInt(a.scale)
  const units = denominator === 0n ? 0n : (numerator + denominator / 2n) / denominator
  const text = units.toString().padStart(digits + 1, '0')
  const sign = a.negative !== b.negative && units !== 0n ? '-' : ''
  return `${sign}${digits ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text}`
}

export function formatCompactMoney(value: string): string {
  const parsed = decimal(value)
  for (const [exponent, digits, suffix] of [[9, 2, 'B'], [6, 1, 'M'], [3, 0, 'K']] as const) {
    if (parsed.units >= 10n ** BigInt(parsed.scale + exponent)) {
      const result = rounded(value, digits, exponent)
      return `Rp${result.negative ? '-' : ''}${result.whole}${digits ? `.${result.fraction}` : ''}${suffix}`
    }
  }
  return `Rp${formatMoney(value, 'full')}`
}
