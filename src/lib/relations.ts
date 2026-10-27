/** Normalize a to-one embedded relation without guessing which of multiple rows is correct. */
export function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  if (!Array.isArray(value)) return value
  if (value.length > 1) throw new Error('Expected one related record, received multiple records.')
  return value[0] ?? null
}
