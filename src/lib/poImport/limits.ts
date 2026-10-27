/** Limits apply to the source; an over-limit document is never silently truncated. */
export const LIMITS = Object.freeze({ bytes: 10_000_000, pages: 5, rows: 100, pixels: 20_000_000, renderEdge: 2400, timeoutMs: 120_000 })

const MESSAGES = {
  UNSUPPORTED_TYPE: 'Choose one PDF, JPEG, PNG, or WebP file.',
  TOO_LARGE: 'The file must be at most 10,000,000 bytes.',
  INVALID_SIGNATURE: 'The file format or metadata is invalid. Try a fresh PDF or static image.',
  ANIMATED_IMAGE: 'Animated images are not supported. Choose a static image.',
  TOO_MANY_PIXELS: 'The image must be at most 20 megapixels.',
  TOO_MANY_PAGES: 'The PDF must contain at most five pages.',
  PDF_ENCRYPTED: 'Encrypted PDFs are not supported. Use an unencrypted copy.',
  INVALID_PDF: 'This PDF could not be read. Try a fresh copy or enter the PO manually.',
  BLANK_DOCUMENT: 'No usable text was found. Try a clearer document or enter the PO manually.',
  WORKER_UNAVAILABLE: 'Local document reading is unavailable in this browser.',
  OCR_UNAVAILABLE: 'Local image reading is unavailable. Try a selectable-text PDF or enter the PO manually.',
  READ_FAILED: 'The document could not be read. Try a clearer copy or enter the PO manually.',
  ABORTED: 'Document reading was cancelled.',
  TIMEOUT: 'Document reading exceeded 120 seconds. Try a smaller or clearer document.',
  BUSY: 'Another document is being read. Cancel it before trying again.',
} as const
export type ReaderErrorCode = keyof typeof MESSAGES

/** Never preserve a dependency error, cause, filename, image or extracted text. */
export class POReaderError extends Error {
  readonly code: ReaderErrorCode
  constructor(code: ReaderErrorCode) { super(MESSAGES[code]); this.name = 'POReaderError'; this.code = code }
}
export const readerError = (code: ReaderErrorCode) => new POReaderError(code)
export function sanitizeReaderError(error: unknown): POReaderError {
  if (error instanceof POReaderError) return error
  // Exact fixed error from pinned PDF.js buildPaintImageXObject with stopAtErrors:true.
  // Do not inspect substrings or propagate any dependency error payload.
  if (typeof error === 'object' && error !== null && 'message' in error && error.message === 'Image exceeded maximum allowed size and was removed.') return readerError('TOO_MANY_PIXELS')
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : null
  if (name === 'PasswordException') return readerError('PDF_ENCRYPTED')
  if (name === 'InvalidPDFException' || name === 'MissingPDFException' || name === 'UnexpectedResponseException') return readerError('INVALID_PDF')
  return readerError('READ_FAILED')
}
export const ASSETS = Object.freeze({
  pdfWorker: '/po-reader/pdf/pdf.worker.min.mjs',
  cmaps: '/po-reader/pdf/cmaps/', fonts: '/po-reader/pdf/standard_fonts/', wasm: '/po-reader/pdf/wasm/',
  ocrWorker: '/po-reader/ocr/worker.min.js', core: '/po-reader/ocr/core/', language: '/po-reader/ocr/lang/',
})
export type ReadContext = {
  signal: AbortSignal
  check(): void
  fail(code: ReaderErrorCode): void
  wait<T>(promise: PromiseLike<T>): Promise<T>
  defer(cleanup: () => void | Promise<unknown>): () => void
}
export function boundedSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw readerError('INVALID_SIGNATURE')
  const scale = Math.min(1, LIMITS.renderEdge / Math.max(width, height))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale }
}
export function releaseCanvas(canvas: HTMLCanvasElement) { canvas.width = 0; canvas.height = 0 }
export function canvasPreview(canvas: HTMLCanvasElement, context: ReadContext): Promise<Blob> {
  return context.wait(new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(readerError('READ_FAILED')), 'image/png')
  }))
}
