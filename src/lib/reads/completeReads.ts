import { COMPLETE_READ_CHUNK, RELATED_ID_CHUNK } from './contracts'

export class IncompleteReadError extends Error {
  readonly code = 'READ_INCOMPLETE'
  constructor(message = 'Data belum lengkap. Muat ulang sebelum melanjutkan.') {
    super(message)
    this.name = 'IncompleteReadError'
  }
}

export type CompleteReadPage<T> = { items: T[]; total: number }
export type CompletePageFetcher<T> = (offset: number, limit: number, signal?: AbortSignal) => Promise<CompleteReadPage<T>>

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The read was aborted', 'AbortError')
}

/** Complete metadata or one-entity detail, never a substitute for report aggregation.
 * The caller owns an unchanged authorized predicate and a stable unique ordering.
 * Separate requests do not constitute a database snapshot. A changing count gets
 * one full restart; duplicate IDs or an incomplete response always fail closed.
 */
export async function readComplete<T>(
  fetchPage: CompletePageFetcher<T>,
  keyOf: (row: T) => string,
  signal?: AbortSignal,
): Promise<T[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let expectedTotal: number | null = null
    const items: T[] = []
    const seen = new Set<string>()
    while (true) {
      checkAbort(signal)
      const page = await fetchPage(items.length, COMPLETE_READ_CHUNK, signal)
      checkAbort(signal)
      if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0 || page.items.length > COMPLETE_READ_CHUNK) {
        throw new IncompleteReadError()
      }
      if (expectedTotal !== null && page.total !== expectedTotal) {
        if (attempt === 1) throw new IncompleteReadError('Data terus berubah. Muat ulang sebelum melanjutkan.')
        break
      }
      expectedTotal = page.total
      if (items.length + page.items.length > expectedTotal) throw new IncompleteReadError()
      for (const row of page.items) {
        const key = keyOf(row)
        if (typeof key !== 'string' || key.length === 0 || seen.has(key)) throw new IncompleteReadError()
        seen.add(key)
        items.push(row)
      }
      if (items.length === expectedTotal) return items
      if (page.items.length === 0) throw new IncompleteReadError()
    }
  }
  throw new IncompleteReadError()
}

/** Keep related-ID URLs bounded while avoiding repeated rows across chunks. */
export function chunkIds(ids: string[], size = RELATED_ID_CHUNK): string[][] {
  if (!Number.isInteger(size) || size < 1 || size > RELATED_ID_CHUNK) throw new RangeError('ID chunk size must be between 1 and 100')
  const unique = [...new Set(ids)]
  if (unique.some(id => typeof id !== 'string' || id.length === 0)) throw new TypeError('IDs must be nonempty strings')
  const chunks: string[][] = []
  for (let offset = 0; offset < unique.length; offset += size) chunks.push(unique.slice(offset, offset + size))
  return chunks
}
