import type { ExtractedReport, SourceRow } from './types'
import { normalizeSourceNumber } from './decimal'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

const VERSION = 'co-searchable-pdf-3'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_PAGES = 50
const MAX_ROWS = 10_000
const MAX_ITEMS_PER_PAGE = 200_000

type Line = { y: number; items: { x: number; text: string }[] }
function linesFrom(items: TextItem[]): Line[] {
  const lines: Line[] = []
  for (const item of items.sort((a,b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    if (!item.str.trim()) continue
    if (!item.transform.every(Number.isFinite)) throw new Error('coordinates')
    const y = item.transform[5]
    let line = lines.at(-1)
    if (!line || Math.abs(line.y - y) > 1.5) { line = {y, items:[]}; lines.push(line) }
    line.items.push({x:item.transform[4], text:item.str.trim()})
  }
  for (const line of lines) line.items.sort((a,b) => a.x - b.x)
  return lines
}
function cell(line: Line, left: number, right = Infinity): string {
  return line.items.filter(i => i.x >= left && i.x < right).map(i => i.text).join(' ').trim()
}
function isoDate(raw: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(raw)
  if (!match) return null
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  const iso = `${year}-${match[2]}-${match[1]}`
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === iso ? iso : null
}
function period(raw: string): string | null {
  const match = /^(\d{2}\/\d{2}\/\d{2,4})\s*(?:-|sd)\s*(\d{2}\/\d{2}\/\d{2,4})$/.exec(raw)
  if (!match) return null
  const first = isoDate(match[1]), last = isoDate(match[2])
  if (!first || !last || !first.endsWith('-01') || first.slice(0,7) !== last.slice(0,7)) return null
  const end = new Date(`${first}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth()+1); end.setUTCDate(0)
  return end.toISOString().slice(0,10) === last ? first : null
}

/** Text evidence only. Never renders, executes document actions, follows URLs or starts OCR.
 * All failures discard partial rows: unsupported evidence must return to manual review.
 */
export async function extractPdf(bytes: Uint8Array, sha256: string, signal: AbortSignal): Promise<ExtractedReport> {
  const empty = (warning: string): ExtractedReport => ({sha256, format:'pdf', parserVersion:VERSION, sourceRows:[], sections:[], periodCandidates:[], customerCandidates:[], warnings:[warning]})
  signal.throwIfAborted()
  if (bytes.byteLength > MAX_BYTES) return empty('manual_review:byte_limit')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  signal.throwIfAborted()
  if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = '/po-reader/pdf/pdf.worker.min.mjs'
  const parameters = {data:bytes.slice(), isEvalSupported:false, verbosity:0,
    useWorkerFetch:false, useSystemFonts:false, disableFontFace:true, isOffscreenCanvasSupported:false,
    isImageDecoderSupported:false, stopAtErrors:true}
  const loading = pdfjs.getDocument(parameters)
  const abortError = () => new DOMException('PDF extraction cancelled', 'AbortError')
  let rejectAbort: (error: Error) => void = () => {}
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject })
  const abort = () => { rejectAbort(abortError()); void loading.destroy().catch(() => {}) }
  signal.addEventListener('abort', abort, {once:true})
  const wait = <T>(promise: Promise<T>) => Promise.race([promise, cancelled])
  try {
    signal.throwIfAborted()
    const document = await wait(loading.promise)
    if (document.numPages > MAX_PAGES) return empty('manual_review:page_limit')
    const metadata = await wait(document.getMetadata())
    if ('EncryptFilterName' in metadata.info && metadata.info.EncryptFilterName) return empty('manual_review:invalid_or_encrypted_pdf')
    let unsupportedLayout = false
    const result: ExtractedReport = {...empty(''), warnings:[]}
    let layout: 'bj' | 'september' | null = null
    let section: ExtractedReport['sections'][number] | null = null
    let candidateCount = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await wait(document.getPage(pageNumber))
      const reader = page.streamTextContent().getReader()
      const items: TextItem[] = []
      try {
        while (true) {
          const chunk = await wait(reader.read())
          if (chunk.done) break
          for (const item of chunk.value.items) if ('str' in item) items.push(item)
          if (items.length > MAX_ITEMS_PER_PAGE) return empty('manual_review:text_item_limit')
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      const lines = linesFrom(items)
      const pageText = lines.map(l => cell(l, -Infinity)).join('\n')
      const current = /BJ Home Supermarket Bangunan/.test(pageText) && /No Transaksi/.test(pageText) && /Hrg Sat/.test(pageText) ? 'bj'
        : /REKAP PENJUALAN/.test(pageText) && /no_trans/.test(pageText) && /kd_pro/.test(pageText) && /diskon/.test(pageText) ? 'september' : null
      if (!current || (layout && layout !== current)) { unsupportedLayout = true; page.cleanup(); continue }
      layout = current
      let tableOpen = false
      for (const [index,line] of lines.entries()) {
        signal.throwIfAborted()
        const text = cell(line, -Infinity)
        if (layout === 'bj') {
          for (const item of line.items) {
            if (item.text.startsWith('POS, Tgl:') || item.text.startsWith('DO, Tgl BK:')) {
              const value = period(item.text.replace(/^(?:POS, Tgl:|DO, Tgl BK:)\s*/, ''))
              if (value && !result.periodCandidates.includes(value)) result.periodCandidates.push(value)
            }
          }
          if (text.includes('BJ Home Supermarket Bangunan') && !result.customerCandidates.length) result.customerCandidates.push('BJ Home Supermarket Bangunan')
        } else {
          const value = period(text)
          if (value && !result.periodCandidates.includes(value)) result.periodCandidates.push(value)
          if (/^CV\s/.test(text) && !result.customerCandidates.includes(text)) result.customerCandidates.push(text)
        }
        const header = layout === 'bj' ? /No Transaksi/.test(text) && /Hrg Sat/.test(text) : /no_trans/.test(text) && /kd_pro/.test(text) && /diskon/.test(text)
        if (header) {
          tableOpen = true
          if (layout === 'september' || !section) {
            const id = layout === 'bj' ? 'bj:report' : `september:p${pageNumber}:r${index+1}`
            section = {id, label:layout === 'bj' ? 'BJ Home report' : `Table ${result.sections.length+1}`, rowIds:[], printedTotal:null}
            result.sections.push(section)
          }
          continue
        }
        if (!section || !tableOpen) continue
        if (line.items.some(i => /^(?:TOTAL|Total PMJ)$/i.test(i.text)) && !/^\d{2}\//.test(text)) {
          const summaryLabel = line.items.find(i => i.text === 'Penjualan Rp.')
          const raw = (layout === 'bj' && summaryLabel ? cell(line, summaryLabel.x + 1) : cell(line, layout === 'bj' ? 530 : 468)).replace(/^Rp\s*/, '')
          const total = normalizeSourceNumber(raw, layout === 'bj' ? '.' : ',')
          if (total.decimal === null) return empty('manual_review:unresolved_total')
          if (section.printedTotal && section.printedTotal.decimal !== total.decimal) return empty('manual_review:conflicting_totals')
          section.printedTotal = total
          if (layout === 'september') tableOpen = false
          continue
        }
        const rawDate = cell(line, -Infinity, layout === 'bj' ? 49 : 95)
        const bj = layout === 'bj'
        const ref = cell(line, bj ? 49 : 95, 140)
        const sku = cell(line, 140, bj ? 181 : 173)
        const name = cell(line, bj ? 181 : 173, bj ? 425 : 335)
        // Recognise row structure before validating the date: missing/unreadable
        // dates must not silently drop otherwise intact transactions. Decorations
        // lack the independent reference + SKU/name transaction shape.
        const transactionShape = !!ref && (!!sku || !!name)
        if (!/^\d{2}\//.test(rawDate) && !transactionShape) continue
        if (++candidateCount > MAX_ROWS) return empty('manual_review:transaction_row_limit')
        const date = isoDate(rawDate)
        if (!date || !ref || !/^\d+$/.test(sku) || !name) return empty('manual_review:malformed_transaction')
        const number = (raw: string) => normalizeSourceNumber(raw.replace(/^Rp\s*/, ''), bj ? '.' : ',')
        const sourceRef = {fileSha256:sha256, page:pageNumber, sheet:null, row:`r${index+1}`, section:section.id}
        const id = `${sha256}:p${pageNumber}:${sourceRef.row}:${section.id}`
        const discountRaw = bj ? null : cell(line,419,468).replace(/^Rp\s*/, '')
        const row: SourceRow = {id, ref:sourceRef, sourceSku:sku, name, transactionDate:date, transactionReference:ref,
          quantity:number(cell(line,bj ? 425 : 335,bj ? 448.8 : 360)), returned:null,
          unit:bj ? cell(line,448.8,480) || null : null,
          unitPrice:number(cell(line,bj ? 480 : 360,bj ? 530 : 419)),
          discount:discountRaw === null ? null : discountRaw === '-' ? {raw:'-',decimal:'0',convention:'dash_zero'} : number(discountRaw),
          discountBasis:bj ? null : 'line_amount', netUnitPrice:null, amount:number(cell(line,bj ? 530 : 468)),
          currency:bj ? null : 'IDR', priceBasisLabel:bj && pageText.includes('[HPP Saat Penjualan]') ? 'HPP Saat Penjualan' : null,
          flags:bj ? [] : ['unit_missing','section_scope_requires_review']}
        if ([row.quantity,row.unitPrice,row.amount,row.discount].some(n => n && n.decimal === null)) row.flags.push('unresolved_source_number')
        result.sourceRows.push(row); section.rowIds.push(id)
      }
      page.cleanup()
    }
    if (unsupportedLayout) return empty('manual_review:unsupported_layout_or_image_only')
    if (!result.sourceRows.length) return empty('manual_review:no_transactions')
    result.warnings.push('review_required:source_prices_are_not_CO_prices')
    if (layout === 'september') result.warnings.push('review_required:section_scope_and_units')
    if (!result.periodCandidates.length) result.warnings.push('review_required:period_missing')
    return result
  } catch {
    if (signal.aborted) throw abortError()
    return empty('manual_review:invalid_or_encrypted_pdf')
  } finally {
    signal.removeEventListener('abort', abort)
    await loading.destroy().catch(() => {})
  }
}
