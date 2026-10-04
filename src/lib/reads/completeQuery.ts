import { IncompleteReadError, readComplete } from './completeReads'

type QueryResult<T> = { data: T[] | null; count: number | null; error: unknown }
type CompleteQuery<T> = PromiseLike<QueryResult<T>> & { abortSignal?: (signal: AbortSignal) => CompleteQuery<T> }

/** Transport bridge only: callers retain the explicit projection, filters and ordering. */
export function readCompleteQuery<T>(
  build: (offset: number, limit: number) => CompleteQuery<T>,
  keyOf: (row: T) => string,
  signal?: AbortSignal,
): Promise<T[]> {
  return readComplete(async (offset, limit, currentSignal) => {
    let query = build(offset, limit)
    if (currentSignal && query.abortSignal) query = query.abortSignal(currentSignal)
    const { data, count, error } = await query
    if (error) throw error
    if (!Array.isArray(data) || typeof count !== 'number') throw new IncompleteReadError()
    return { items: data, total: count }
  }, keyOf, signal)
}
