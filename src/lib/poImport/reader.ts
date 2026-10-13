import type { LocalDocument, Progress, PageText } from './contracts'
import { validatePOFile } from './fileValidation'
import { LIMITS, boundedSize, canvasPreview, readerError, releaseCanvas, sanitizeReaderError } from './limits'
import type { ReadContext, ReaderErrorCode } from './limits'
let active = false

/** Lazy, browser-memory-only extraction. There is one extraction owner at a time. */
export async function readPODocument(file: File, options: { signal: AbortSignal; onProgress(p: Progress): void }): Promise<LocalDocument> {
  if (options.signal.aborted) throw readerError('ABORTED')
  if (active) throw readerError('BUSY')
  active = true
  const controller = new AbortController(), cleanups = new Set<() => void | Promise<unknown>>()
  const pages: PageText[] = [], previews: Blob[] = []
  const cleanup = () => {
    for (const fn of [...cleanups].reverse()) {
      cleanups.delete(fn)
      try { Promise.resolve(fn()).catch(() => {}) } catch { /* Never leak dependency diagnostics. */ }
    }
  }
  const fail = (code: ReaderErrorCode) => { if (!controller.signal.aborted) controller.abort(readerError(code)); cleanup() }
  const externalAbort = () => fail('ABORTED')
  options.signal.addEventListener('abort', externalAbort, { once: true })
  const timeout = setTimeout(() => fail('TIMEOUT'), LIMITS.timeoutMs)
  const context: ReadContext = {
    signal: controller.signal,
    fail,
    check() { if (controller.signal.aborted) throw controller.signal.reason },
    defer(fn) { cleanups.add(fn); if (controller.signal.aborted) cleanup(); return () => cleanups.delete(fn) },
    wait<T>(promise: PromiseLike<T>) {
      if (controller.signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(controller.signal.reason) }
      return new Promise<T>((resolve, reject) => {
        const abort = () => { controller.signal.removeEventListener('abort', abort); reject(controller.signal.reason) }
        controller.signal.addEventListener('abort', abort, { once: true })
        Promise.resolve(promise).then(value => { controller.signal.removeEventListener('abort', abort); controller.signal.aborted ? reject(controller.signal.reason) : resolve(value) }, error => { controller.signal.removeEventListener('abort', abort); controller.signal.aborted ? reject(controller.signal.reason) : reject(error) })
      })
    },
  }
  try {
    context.check(); options.onProgress({ stage: 'validating', page: 0, pages: 0 })
    const format = await context.wait(validatePOFile(file))
    context.check(); options.onProgress({ stage: 'loading', page: 0, pages: format.kind === 'image' ? 1 : 0 })
    if (format.kind === 'pdf') {
      const { readLocalPDF } = await context.wait(import('./pdfReader'))
      await readLocalPDF(file, context, pages, previews, options.onProgress)
    } else {
      if (typeof createImageBitmap !== 'function') throw readerError('READ_FAILED')
      const bitmapPromise = createImageBitmap(file)
      // The browser decoder itself cannot be cancelled; close a bitmap that resolves late.
      bitmapPromise.then(bitmap => { if (context.signal.aborted) bitmap.close() }, () => {})
      const bitmap = await context.wait(bitmapPromise)
      const removeBitmap = context.defer(() => bitmap.close())
      try {
        if (bitmap.width * bitmap.height > LIMITS.pixels) throw readerError('TOO_MANY_PIXELS')
        const size = boundedSize(bitmap.width, bitmap.height), canvas = document.createElement('canvas')
        canvas.width = size.width; canvas.height = size.height
        const release = context.defer(() => releaseCanvas(canvas))
        try {
          const draw = canvas.getContext('2d', { alpha: false })
          if (!draw) throw readerError('READ_FAILED')
          draw.fillStyle = '#fff'; draw.fillRect(0, 0, canvas.width, canvas.height); draw.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          const preview = await canvasPreview(canvas, context); previews.push(preview)
          options.onProgress({ stage: 'reading', page: 1, pages: 1 })
          const { createLocalOCR } = await context.wait(import('./ocrReader'))
          pages.push(await createLocalOCR(context).read(preview, 1, size.width, size.height))
        } finally { releaseCanvas(canvas); release() }
      } finally { bitmap.close(); removeBitmap() }
    }
    context.check()
    if (!pages.some(page => page.tokens.some(token => /[\p{L}\p{N}]/u.test(token.text)))) throw readerError('BLANK_DOCUMENT')
    return { pages, previews, dispose() { for (const page of pages) page.tokens.length = 0; pages.length = 0; previews.length = 0 } }
  } catch (error) {
    for (const page of pages) page.tokens.length = 0
    pages.length = 0; previews.length = 0
    throw sanitizeReaderError(controller.signal.aborted ? controller.signal.reason : error)
  } finally { clearTimeout(timeout); options.signal.removeEventListener('abort', externalAbort); cleanup(); active = false }
}
