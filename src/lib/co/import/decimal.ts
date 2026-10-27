import type { Money } from '../contracts'
import { minorUnits, parseMoney, parseQuantity } from '../validation'
import type { SourceNumber } from './types'

/** Layout is a parser decision; malformed or missing source values stay unresolved. */
export function normalizeSourceNumber(raw: string, decimalSeparator: '.' | ','): SourceNumber {
  const convention = decimalSeparator === ',' ? 'decimal_comma' : 'decimal_dot'
  const text = raw.trim()
  const pattern = decimalSeparator === ','
    ? /^(?:[0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+)(?:,[0-9]+)?$/
    : /^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?$/
  if (!pattern.test(text)) return { raw, decimal: null, convention }
  const grouping = decimalSeparator === ',' ? '.' : ','
  const normalized = text.split(grouping).join('').replace(decimalSeparator, '.')
  const [integer, fraction] = normalized.split('.')
  const decimal = integer.replace(/^0+(?=[0-9])/, '') + (fraction === undefined ? '' : `.${fraction}`)
  return { raw, decimal, convention }
}

/** Discount is a line amount, not a per-unit or percentage policy. */
export function lineAmount(qty: string, price: Money, discount: Money): Money {
  const quantity = BigInt(parseQuantity(qty))
  const amount = quantity * minorUnits(parseMoney(price)) - minorUnits(parseMoney(discount))
  if (amount < 0n) throw new RangeError('Line discount exceeds extended amount')
  return parseMoney(`${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`)
}
