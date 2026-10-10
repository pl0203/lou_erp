import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Customer, FormDraft, Issue, LocalDocument, ParsedPO, Product, Progress, ReviewDecision } from './contracts'
import { parsePODocument } from './parse'
import { matchPODraft, skuKey } from './matching'
import { preparePOFormDraft, isFinancialReviewIssue } from './review'
import { initialReviewNotes } from './reviewNotes'

export type ImportApply = (draft: FormDraft, accept?: () => FormDraft | null) => void
export type ImportContext = { customers: Customer[]; products: Product[]; actorKey: string; disabled: boolean }
type ImportState = { phase: 'idle' | 'reading' | 'review' | 'applied' | 'error'; progress: Progress | null; document: LocalDocument | null; parsed: ParsedPO | null; decision: ReviewDecision | null; issues: Issue[]; error: string }
const empty = (): ImportState => ({ phase: 'idle', progress: null, document: null, parsed: null, decision: null, issues: [], error: '' })
const readFailureMessages: Record<string, string> = {
  UNSUPPORTED_TYPE: 'Jenis dokumen tidak didukung, termasuk HEIC. Gunakan PDF, JPEG, PNG, atau WebP statis; atau isi PO manual.',
  TOO_LARGE: 'Dokumen melebihi 10.000.000 byte (10 MB). Gunakan berkas yang lebih kecil atau isi PO manual.',
  INVALID_SIGNATURE: 'Tipe atau tanda berkas tidak sesuai, atau metadata tidak aman. Pilih dokumen yang valid atau isi PO manual.',
  ANIMATED_IMAGE: 'Gambar animasi tidak didukung. Gunakan gambar statis atau isi PO manual.',
  TOO_MANY_PIXELS: 'Gambar melebihi 20 megapiksel. Gunakan gambar yang lebih kecil atau isi PO manual.',
  TOO_MANY_PAGES: 'PDF melebihi 5 halaman. Gunakan satu PO maksimal lima halaman atau isi PO manual.',
  PDF_ENCRYPTED: 'PDF terenkripsi tidak didukung. Gunakan PDF tanpa kata sandi atau isi PO manual.',
  INVALID_PDF: 'PDF tidak valid atau tidak dapat dibaca. Pilih dokumen yang valid atau isi PO manual.',
  BLANK_DOCUMENT: 'Dokumen kosong atau teks tidak dapat ditemukan. Coba gambar lebih jelas atau isi PO manual.',
  WORKER_UNAVAILABLE: 'Aset pembaca lokal belum tersedia. Coba lagi setelah koneksi pulih atau isi PO manual.',
  OCR_UNAVAILABLE: 'Aset OCR lokal belum tersedia. Coba lagi setelah koneksi pulih atau isi PO manual.',
  TIMEOUT: 'Pembacaan melebihi 120 detik. Coba dokumen yang lebih jelas atau isi PO manual.',
  ABORTED: 'Pembacaan dibatalkan. Pilih dokumen kembali atau isi PO manual.',
  BUSY: 'Pembacaan lain masih berjalan. Batalkan pembacaan sebelumnya atau isi PO manual.',
}
const readFailureMessage = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : ''
  return (Object.hasOwn(readFailureMessages, code) ? readFailureMessages[code] : null) ?? 'Dokumen tidak dapat dibaca. Gunakan satu PDF (maksimal 5 halaman), JPEG, PNG, atau WebP statis hingga 10 MB; atau isi PO manual.'
}
const catalogKey = (context: ImportContext) => JSON.stringify([context.customers.map(c => [c.id, c.name, c.pricing_tier]), context.products.map(p => [p.id, p.name, p.sku, p.size, p.harga_pokok, p.luar_kota, p.dalam_kota, p.depo_bangunan])])
function initialDecision(po: ParsedPO, context: ImportContext): ReviewDecision {
  const matches = matchPODraft(po, context.customers, context.products)
  return { customerId: matches.customerIds.length === 1 ? matches.customerIds[0] : '', poNumber: po.poNumber.value ?? '', orderDate: po.orderDate.value ?? '', expiry: po.expiry.value ?? '', notes: initialReviewNotes(po), idrConfirmed: false, acknowledgedIssueIds: [], rows: Object.fromEntries(po.rows.map(row => {
    const candidates = matches.productIdsByRow[row.id] ?? []
    const suggested = candidates.length === 1 ? context.products.find(p => p.id === candidates[0]) : undefined
    const product = suggested && row.sku.value && skuKey(row.sku.value) === skuKey(suggested.sku) && !row.issues.some(issue => issue.code === 'source-sku-review') ? suggested : undefined
    return [row.id, { productId: product?.id ?? null, manual: false, sku: product?.sku ?? row.sku.value ?? row.sku.raw, name: product?.name ?? row.name.value ?? row.name.raw, quantity: row.quantity.value ?? '', unitPrice: row.unitPrice.value, unitConfirmed: false }]
  })) }
}

/** Document, extraction, decisions and previews exist only for this mounted form. */
export function usePOImport(context: ImportContext, onApply: ImportApply, onDirtyChange: (dirty: boolean) => void) {
  const [state, setState] = useState<ImportState>(empty)
  const current = useRef(state); current.current = state
  const generation = useRef(0), revision = useRef(0), contextVersion = useRef(0)
  const job = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null)
  const heldDocument = useRef<LocalDocument | null>(null)
  const mounted = useRef(true)
  const key = catalogKey(context)
  const live = useRef({ ...context, key })
  if (live.current.key !== key || live.current.actorKey !== context.actorKey || live.current.disabled !== context.disabled) contextVersion.current++
  live.current = { ...context, key }
  const release = () => {
    const running = job.current; job.current = null
    if (running) { clearTimeout(running.timer); running.controller.abort() }
    heldDocument.current?.dispose(); heldDocument.current = null
  }
  const cancel = () => { generation.current++; revision.current++; release(); setState(empty()) }
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current++; release() }
  }, [])
  const previous = useRef({ actorKey: context.actorKey, key })
  useEffect(() => {
    const changedActor = previous.current.actorKey !== context.actorKey
    const changedCatalog = previous.current.key !== key
    previous.current = { actorKey: context.actorKey, key }
    if (changedActor || changedCatalog) {
      generation.current++; revision.current++; release()
      setState(changedCatalog && !changedActor && current.current.phase !== 'idle'
        ? { ...empty(), phase: 'error', error: 'Katalog berubah. Impor ulang dokumen agar pilihan menggunakan katalog terbaru.' } : empty())
    }
  }, [context.actorKey, key])
  const dirty = state.phase === 'reading' || state.phase === 'review'
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])

  const start = async (file: File) => {
    if (live.current.disabled || !live.current.actorKey) return
    generation.current++; revision.current++; release()
    const id = generation.current, actor = live.current.actorKey, catalog = live.current.key
    const controller = new AbortController()
    setState({ ...empty(), phase: 'reading', progress: { stage: 'loading', page: 0, pages: 0 } })
    const isCurrent = () => mounted.current && id === generation.current && actor === live.current.actorKey && catalog === live.current.key && !controller.signal.aborted
    const timer = setTimeout(() => {
      if (!isCurrent()) return
      generation.current++; release()
      setState({ ...empty(), phase: 'error', error: 'Pembacaan melebihi 120 detik. Coba dokumen yang lebih jelas atau isi PO manual.' })
    }, 120_000)
    job.current = { controller, timer }
    try {
      const { readPODocument } = await import('./reader')
      if (!isCurrent()) return
      const document = await readPODocument(file, { signal: controller.signal, onProgress: progress => {
        if (isCurrent()) setState(prev => ({ ...prev, progress }))
      } })
      if (!isCurrent() || live.current.disabled) { document.dispose(); if (isCurrent()) { release(); setState({ ...empty(), phase: 'error', error: 'Katalog sedang diperbarui. Coba impor kembali setelah selesai.' }) }; return }
      heldDocument.current = document
      const parsed = parsePODocument(document.pages)
      const decision = initialDecision(parsed, live.current)
      clearTimeout(timer); job.current = null
      setState({ ...empty(), phase: 'review', document, parsed, decision })
    } catch (error) {
      if (!isCurrent()) return
      release()
      setState({ ...empty(), phase: 'error', error: readFailureMessage(error) })
    }
  }
  const updateDecision = (decision: ReviewDecision) => {
    if (live.current.disabled || current.current.phase !== 'review') return
    revision.current++
    setState(prev => ({ ...prev, decision, issues: [] }))
  }
  const requestApply = () => {
    const snapshot = current.current
    if (live.current.disabled || !live.current.actorKey || snapshot.phase !== 'review' || !snapshot.parsed || !snapshot.decision) return
    const prepared = preparePOFormDraft(snapshot.parsed, snapshot.decision, live.current.customers, live.current.products)
    setState(prev => ({ ...prev, issues: prepared.issues }))
    if (!prepared.draft || prepared.issues.some(issue => isFinancialReviewIssue(issue) && !snapshot.decision!.acknowledgedIssueIds.includes(issue.id))) return
    const id = generation.current, rev = revision.current, version = contextVersion.current, actor = live.current.actorKey, catalog = live.current.key
    const accept = (): FormDraft | null => {
      if (!mounted.current || generation.current !== id || revision.current !== rev || contextVersion.current !== version || live.current.actorKey !== actor || live.current.key !== catalog || live.current.disabled || current.current.phase !== 'review') return null
      const latest = current.current
      if (!latest.parsed || !latest.decision) return null
      const checked = preparePOFormDraft(latest.parsed, latest.decision, live.current.customers, live.current.products)
      if (!checked.draft || checked.issues.some(issue => isFinancialReviewIssue(issue) && !latest.decision!.acknowledgedIssueIds.includes(issue.id))) { setState(prev => ({ ...prev, issues: checked.issues })); return null }
      generation.current++; revision.current++; release()
      setState({ ...empty(), phase: 'applied' })
      return checked.draft
    }
    onApply(prepared.draft, accept)
  }
  return { ...state, dirty, start, cancel, updateDecision, requestApply }
}
