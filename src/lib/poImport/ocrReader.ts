import type { PageText, Token } from './contracts'
import { ASSETS, readerError } from './limits'
import type { ReadContext } from './limits'

type Word = { text?: unknown; confidence?: unknown; bbox?: { x0: number; y0: number; x1: number; y1: number } }
type OCRData = { blocks?: { paragraphs?: { lines?: { words?: Word[] }[] }[] }[] }

/** Narrow adapter for the pinned Tesseract.js 7.0.0 browser worker protocol.
 * createWorker() does not expose its native worker during initialization. Owning
 * the port first makes even a stalled WASM/model startup immediately cancellable.
 * See its src/createWorker.js and src/worker-script/index.js. No worker pooling,
 * URL inputs, FS persistence, text-only fallback or alternate OCR engine is used.
 */
export function createLocalOCR(context: ReadContext) {
  if (typeof Worker !== 'function' || typeof WebAssembly !== 'object') throw readerError('OCR_UNAVAILABLE')
  let port: Worker
  try { port = new Worker(ASSETS.ocrWorker) } catch { throw readerError('OCR_UNAVAILABLE') }
  let sequence = 0, disposed = false
  let pending: { id: string; resolve(data: OCRData): void; reject(error: unknown): void } | null = null
  const terminate = () => {
    if (disposed) return
    disposed = true; port.onmessage = null; port.onerror = null; port.onmessageerror = null
    pending?.reject(readerError('OCR_UNAVAILABLE')); pending = null; port.terminate()
  }
  context.defer(terminate)
  port.onerror = event => { event.preventDefault(); pending?.reject(readerError('OCR_UNAVAILABLE')); terminate() }
  port.onmessageerror = () => { pending?.reject(readerError('OCR_UNAVAILABLE')); terminate() }
  port.onmessage = event => {
    const packet = event.data
    if (!packet || packet.workerId !== 'local-po' || packet.jobId !== pending?.id) return
    if (packet.status === 'resolve') { pending.resolve(packet.data); pending = null }
    else if (packet.status === 'reject') { pending.reject(readerError('OCR_UNAVAILABLE')); pending = null }
    // Progress and dependency error payloads are deliberately never logged or forwarded.
  }
  async function command(action: string, payload: object): Promise<OCRData> {
    context.check()
    if (disposed || pending) throw readerError('OCR_UNAVAILABLE')
    const id = `local-${++sequence}`
    return context.wait(new Promise<OCRData>((resolve, reject) => {
      pending = { id, resolve, reject }
      try { port.postMessage({ workerId: 'local-po', jobId: id, action, payload }) }
      catch { pending = null; reject(readerError('OCR_UNAVAILABLE')) }
    }))
  }
  const ready = (async () => {
    await command('load', { options: { lstmOnly: true, corePath: ASSETS.core, logging: false } })
    await command('loadLanguage', { langs: 'eng', options: { langPath: ASSETS.language, cacheMethod: 'none', gzip: true, lstmOnly: true } })
    await command('initialize', { langs: 'eng', oem: 1, config: {} })
    await command('setParameters', { params: { tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' } })
  })()
  return {
    async read(image: Blob, page: number, width: number, height: number): Promise<PageText> {
      await context.wait(ready)
      let bytes: Uint8Array | undefined
      try {
        bytes = new Uint8Array(await context.wait(image.arrayBuffer()))
        const data = await command('recognize', { image: bytes, options: {}, output: { text: false, blocks: true, hocr: false, tsv: false, pdf: false, debug: false } })
        context.check()
        const tokens: Token[] = []
        for (const block of data.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) for (const word of line.words ?? []) {
          if (typeof word.text !== 'string' || !word.text.trim() || !word.bbox) continue
          const { x0, y0, x1, y1 } = word.bbox
          if (![x0,y0,x1,y1].every(Number.isFinite)) continue
          const x = Math.max(0, Math.min(width, Math.min(x0,x1))), y = Math.max(0, Math.min(height, Math.min(y0,y1)))
          const right = Math.max(x, Math.min(width, Math.max(x0,x1))), bottom = Math.max(y, Math.min(height, Math.max(y0,y1)))
          if (right === x || bottom === y) continue
          tokens.push({ text: word.text, x, y, width: right-x, height: bottom-y, confidence: typeof word.confidence === 'number' && Number.isFinite(word.confidence) ? Math.max(0,Math.min(100,word.confidence)) : null })
        }
        return { page, width, height, source: 'ocr', tokens }
      } finally { bytes?.fill(0) }
    },
  }
}
