import type { PageText, Progress, Token } from './contracts'
import { ASSETS, LIMITS, canvasPreview, readerError, releaseCanvas } from './limits'
import type { ReadContext } from './limits'
import type { TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api'

type Matrix = [number, number, number, number, number, number]
function transform(a: number[], b: number[]): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]
}
function textToken(item: TextItem, style: TextStyle | undefined, viewport: { transform: number[]; width: number; height: number; scale: number }): Token | null {
  if (!item.str.trim() || !item.transform?.every(Number.isFinite) || !Number.isFinite(item.width)) return null
  const t = transform(viewport.transform, item.transform), baseline = Math.hypot(t[0], t[1]), fontHeight = Math.hypot(t[2], t[3])
  if (!baseline || !fontHeight) return null
  const ascent = Number.isFinite(style?.ascent) ? style!.ascent : 0.8
  const descent = Number.isFinite(style?.descent) ? style!.descent : -0.2
  const dx = t[0] / baseline * Math.abs(item.width) * viewport.scale, dy = t[1] / baseline * Math.abs(item.width) * viewport.scale
  // Four corners in the transformed glyph basis handle flipped/rotated coordinates.
  const corners = [[t[4]+t[2]*ascent,t[5]+t[3]*ascent], [t[4]+dx+t[2]*ascent,t[5]+dy+t[3]*ascent], [t[4]+t[2]*descent,t[5]+t[3]*descent], [t[4]+dx+t[2]*descent,t[5]+dy+t[3]*descent]]
  const x = Math.max(0,Math.min(viewport.width,Math.min(...corners.map(p=>p[0])))), y = Math.max(0,Math.min(viewport.height,Math.min(...corners.map(p=>p[1]))))
  const right = Math.max(x,Math.min(viewport.width,Math.max(...corners.map(p=>p[0])))), bottom = Math.max(y,Math.min(viewport.height,Math.max(...corners.map(p=>p[1]))))
  if (right === x || bottom === y) return null
  return { text: item.str, x, y, width: right-x, height: bottom-y, confidence: null }
}

export async function readLocalPDF(file: File, context: ReadContext, pages: PageText[], previews: Blob[], onProgress: (p: Progress) => void) {
  if (typeof Worker !== 'function') throw readerError('WORKER_UNAVAILABLE')
  const pdfjs = await context.wait(import('pdfjs-dist/legacy/build/pdf.mjs'))
  context.check()
  pdfjs.GlobalWorkerOptions.workerSrc = ASSETS.pdfWorker
  let native: Worker
  try { native = new Worker(ASSETS.pdfWorker, { type: 'module' }) } catch { throw readerError('WORKER_UNAVAILABLE') }
  let terminated = false
  const terminateNative = () => { if (!terminated) { terminated = true; native.terminate() } }
  const disposeNative = context.defer(terminateNative)
  const workerFailure = new Promise<never>((_, reject) => {
    const error = (event: ErrorEvent) => { event.preventDefault(); reject(readerError('WORKER_UNAVAILABLE')) }
    const messageError = () => reject(readerError('WORKER_UNAVAILABLE'))
    const policyError = (event: MessageEvent) => {
      if (event.data?.type !== 'po-reader-policy-error') return
      const code = event.data.code
      if (code === 'TOO_MANY_PIXELS' || code === 'INVALID_PDF') { context.fail(code); reject(readerError(code)) }
    }
    native.addEventListener('message',policyError)
    native.addEventListener('error',error)
    native.addEventListener('messageerror',messageError)
    context.defer(() => { native.removeEventListener('message',policyError); native.removeEventListener('error',error); native.removeEventListener('messageerror',messageError) })
  })
  const workerReady = new Promise<void>(resolve => {
    const ready = (event: MessageEvent) => {
      if (event.data?.type !== 'po-reader-ready') return
      native.removeEventListener('message',ready); removeReady(); resolve()
    }
    const removeReady = context.defer(() => native.removeEventListener('message',ready))
    native.addEventListener('message',ready)
  })
  // An explicit port skips PDF.js's own worker handshake. Our quiet bootstrap
  // has a top-level dynamic import: wait until it confirms the handler exists.
  await context.wait(Promise.race([workerReady,workerFailure]))
  const pdfWorker = pdfjs.PDFWorker.create({ port: native, verbosity: 0 })
  context.defer(() => pdfWorker.destroy())
  let bytes: Uint8Array | undefined
  try {
    bytes = new Uint8Array(await context.wait(file.arrayBuffer()))
    context.defer(() => { try { bytes?.fill(0) } catch { /* The buffer may be transferred to the worker. */ } bytes = undefined })
    // 6.4.299 removed dynamic font evaluation. Retain the explicit false flag
    // as defense-in-depth for compatible APIs; no scripting/XFA APIs are invoked.
    const parameters = {
      data: bytes, worker: pdfWorker, verbosity: 0, isEvalSupported: false, enableXfa: false,
      disableFontFace: true, useSystemFonts: false, cMapUrl: ASSETS.cmaps, cMapPacked: true,
      standardFontDataUrl: ASSETS.fonts, wasmUrl: ASSETS.wasm, iccUrl: '/po-reader/pdf/iccs/',
      maxImageSize: LIMITS.pixels, canvasMaxAreaInBytes: LIMITS.pixels * 4,
      isOffscreenCanvasSupported: false, isImageDecoderSupported: false, stopAtErrors: true,
      disableAutoFetch: true, disableStream: true, disableRange: true, useWorkerFetch: true,
    }
    const loading = pdfjs.getDocument(parameters)
    const removeLoading = context.defer(() => loading.destroy())
    const doc = await context.wait(Promise.race([loading.promise, workerFailure]))
    if (!Number.isSafeInteger(doc.numPages) || doc.numPages < 1) throw readerError('INVALID_PDF')
    if (doc.numPages > LIMITS.pages) throw readerError('TOO_MANY_PAGES')
    // A PDF encrypted with an empty user password may load without onPassword.
    // The pinned API exposes its encryption filter in document info. Do not keep metadata.
    const metadata = await context.wait(Promise.race([doc.getMetadata(), workerFailure]))
    if ('EncryptFilterName' in metadata.info && metadata.info.EncryptFilterName) throw readerError('PDF_ENCRYPTED')
    let ocr: ReturnType<typeof import('./ocrReader').createLocalOCR> | undefined
    for (let number = 1; number <= doc.numPages; number++) {
      context.check(); onProgress({ stage: 'reading', page: number, pages: doc.numPages })
      const page = await context.wait(Promise.race([doc.getPage(number),workerFailure]))
      const cleanupPage = context.defer(() => { page.cleanup() })
      const canvas = document.createElement('canvas'), release = context.defer(() => releaseCanvas(canvas))
      try {
        const initial = page.getViewport({ scale: 1 })
        if (![initial.width,initial.height].every(v => Number.isFinite(v) && v > 0)) throw readerError('INVALID_PDF')
        const scale = LIMITS.renderEdge / Math.max(initial.width,initial.height), viewport = page.getViewport({ scale })
        canvas.width = Math.max(1,Math.floor(viewport.width)); canvas.height = Math.max(1,Math.floor(viewport.height))
        const content = await context.wait(Promise.race([page.getTextContent(),workerFailure]))
        const tokens = content.items.filter((item): item is TextItem => 'str' in item).map(item => textToken(item,content.styles[item.fontName],{transform:viewport.transform,width:canvas.width,height:canvas.height,scale})).filter((item): item is Token => item !== null)
        const drawing = canvas.getContext('2d', { alpha: false })
        if (!drawing) throw readerError('READ_FAILED')
        const render = page.render({ canvas, canvasContext: drawing, viewport, annotationMode: 0 })
        const cancelRender = context.defer(() => render.cancel())
        try { await context.wait(Promise.race([render.promise, workerFailure])) } finally { cancelRender() }
        const preview = await canvasPreview(canvas,context); previews.push(preview)
        if (tokens.some(token => /[\p{L}\p{N}]/u.test(token.text))) pages.push({ page:number,width:canvas.width,height:canvas.height,source:'pdf-text',tokens })
        else {
          if (!ocr) { const { createLocalOCR } = await context.wait(import('./ocrReader')); ocr = createLocalOCR(context) }
          pages.push(await ocr.read(preview,number,canvas.width,canvas.height))
        }
      } finally { releaseCanvas(canvas); release(); page.cleanup(); cleanupPage() }
    }
    await context.wait(Promise.race([Promise.resolve(loading.destroy()),workerFailure]))
    removeLoading()
  } finally {
    // Loading-task cleanup owns its worker transport; terminate the native port as well.
    terminateNative(); disposeNative()
    try { bytes?.fill(0) } catch { /* A transferred array is already detached. */ }
    bytes = undefined
  }
}
