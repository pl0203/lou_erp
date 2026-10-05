import { useEffect, useId, useRef, useState } from 'react'
import type { Customer, Product } from '../../lib/poImport/contracts'
import { usePOImport } from '../../lib/poImport/usePOImport'
import type { ImportApply } from '../../lib/poImport/usePOImport'
import DocumentPreview from './DocumentPreview'
import POImportReview from './POImportReview'

type Props = { customers: Customer[]; products: Product[]; actorKey: string; disabled: boolean; hasFormEdits: boolean; onApply: ImportApply; onDirtyChange(dirty: boolean): void }
export default function PODocumentImport({ customers, products, actorKey, disabled, hasFormEdits, onApply, onDirtyChange }: Props) {
  const [open, setOpen] = useState(false), [tab, setTab] = useState<'document' | 'review'>('review')
  const [desktop, setDesktop] = useState(() => window.matchMedia?.('(min-width: 768px)').matches ?? false)
  useEffect(() => {
    const query = window.matchMedia?.('(min-width: 768px)')
    if (!query) return
    const update = () => setDesktop(query.matches)
    update(); query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const documentTab = useRef<HTMLButtonElement>(null), reviewTab = useRef<HTMLButtonElement>(null)
  const id = useId()
  const importer = usePOImport({ customers, products, actorKey, disabled }, onApply, onDirtyChange)
  const tabs = (key: string, from: 'document' | 'review') => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    const next = key === 'Home' ? 'document' : key === 'End' ? 'review' : from === 'review' ? 'document' : 'review'
    setTab(next); (next === 'document' ? documentTab : reviewTab).current?.focus()
  }
  return <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-label="Impor dokumen PO lokal">
    <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-medium text-blue-700 disabled:opacity-50">Import dokumen PO</button>
    <p className="mt-2 text-xs text-gray-500">Dokumen dibaca di browser ini. Tidak diunggah atau dilampirkan. Hasil wajib diperiksa; Terapkan tidak menyimpan PO.</p>
    {open && <div className="mt-4 min-w-0 space-y-4">
      <div><label htmlFor={`${id}-file`} className="block text-sm font-medium">Dokumen PO</label><input id={`${id}-file`} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={disabled} className="block max-w-full w-full text-sm" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''
        if (file) { setTab('review'); void importer.start(file) }
      }} /><p className="mt-1 text-xs text-gray-500">Satu PDF maksimal 5 halaman atau JPEG/PNG/WebP statis. Maksimal 10 MB, 20 megapiksel dan 100 barang. HEIC dan animasi tidak didukung.</p></div>
      {hasFormEdits && <p className="text-xs text-amber-700">Terapkan akan meminta persetujuan sebelum mengganti formulir yang sudah diedit.</p>}
      {importer.phase === 'reading' && <p role="status" className="text-sm text-blue-700">Membaca dokumen lokal… {importer.progress?.stage}{importer.progress?.pages ? ` · ${importer.progress.page}/${importer.progress.pages} halaman` : ''}</p>}
      {importer.error && <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-800">{importer.error}</p>}
      {importer.phase === 'applied' && <p role="status" className="text-sm text-green-700">Hasil sudah diterapkan. Periksa formulir lalu gunakan Simpan PO jika benar.</p>}
      {importer.phase === 'review' && importer.parsed && importer.decision && importer.document && <>
        <div hidden={desktop} style={{ display: desktop ? 'none' : undefined }} role="tablist" aria-label="Dokumen dan hasil impor" className="flex border-b gap-2">
          <button type="button" id={`${id}-document-tab`} ref={documentTab} role="tab" aria-selected={tab === 'document'} aria-controls={`${id}-document-panel`} tabIndex={tab === 'document' ? 0 : -1} onClick={() => setTab('document')} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); tabs(event.key, 'document') } }} className="px-3 py-2 text-sm">Dokumen</button>
          <button type="button" id={`${id}-review-tab`} ref={reviewTab} role="tab" aria-selected={tab === 'review'} aria-controls={`${id}-review-panel`} tabIndex={tab === 'review' ? 0 : -1} onClick={() => setTab('review')} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); tabs(event.key, 'review') } }} className="px-3 py-2 text-sm">Periksa data</button>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
          <div hidden={!desktop && tab !== 'document'} id={`${id}-document-panel`} role="tabpanel" aria-labelledby={`${id}-document-tab`} tabIndex={0} className="min-w-0 md:sticky md:top-4 md:max-h-[75vh] md:overflow-auto"><h3 hidden={!desktop} className="mb-2 text-sm font-medium">Dokumen</h3><DocumentPreview previews={importer.document.previews} /></div>
          <div hidden={!desktop && tab !== 'review'} id={`${id}-review-panel`} role="tabpanel" aria-labelledby={`${id}-review-tab`} tabIndex={0} className="min-w-0"><h3 hidden={!desktop} className="mb-2 text-sm font-medium">Periksa data</h3><POImportReview parsed={importer.parsed} decision={importer.decision} customers={customers} products={products} issues={importer.issues} disabled={disabled} onChange={importer.updateDecision} onApply={importer.requestApply} /></div>
        </div>
      </>}
      {(importer.phase === 'reading' || importer.phase === 'review' || importer.phase === 'error') && <button type="button" onClick={importer.cancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Batalkan impor</button>}
    </div>}
  </section>
}
