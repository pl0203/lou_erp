/** A business version conflict is definitive and must never become a serialization retry. */
export class POConflictError extends Error {
  readonly code = 'PT409'
  constructor(saving = false) {
    super(saving
      ? 'PO berubah. Muat ulang dan periksa perubahan sebelum menyimpan kembali.'
      : 'PO berubah. Muat ulang sebelum melanjutkan.')
    this.name = 'POConflictError'
  }
}
export function isPOConflict(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'PT409'
}

type QueryRetry = boolean | number | ((failureCount: number, error: Error) => boolean)
/** Preserve the caller's ordinary retry policy, but stop a pinned stale-version read. */
export function retryUnlessPOConflict(failureCount: number, error: Error, retry?: QueryRetry): boolean {
  if (isPOConflict(error)) return false
  if (typeof retry === 'function') return retry(failureCount, error)
  return retry === true || (retry !== false && failureCount < (retry ?? 3))
}
