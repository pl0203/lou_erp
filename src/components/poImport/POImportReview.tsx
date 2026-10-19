import { Button } from '../ui/Button'
import { preparePOFormDraft, isFinancialReviewIssue } from '../../lib/poImport/review'
import { matchPODraft } from '../../lib/poImport/matching'
import { POProductLookup } from '../POLookup'
import { useId, useMemo, useRef, useState } from 'react'
import type { Customer, Issue, ParsedPO, Product, ReviewDecision, RowDecision, SourceField } from '../../lib/poImport/contracts'

type Props = { hasExtractedText?: boolean; parsed: ParsedPO; decision: ReviewDecision; customers: Customer[]; products: Product[]; issues: Issue[]; disabled: boolean; onChange(decision: ReviewDecision): void; onApply(): void }
const inputClass = 'ui-control max-w-full disabled:opacity-50'
function Source({ field }: { field: SourceField }) {
  return <p className="mt-1 text-[13px] text-brand-secondary [overflow-wrap:anywhere]">Dokumen: {field.raw || '(tidak tercantum)'}{field.page ? ` · halaman ${field.page}` : ''}</p>
}
export default function POImportReview({ hasExtractedText = false, parsed, decision, customers, products, issues, disabled, onChange, onApply }: Props) {
  const id = useId()
  const [selectingRow, setSelectingRow] = useState<string | null>(null)
  const productButtons = useRef<Record<string, HTMLButtonElement | null>>({})
  const suggestions = useMemo(() => matchPODraft(parsed, customers, products), [parsed, customers, products])
  const productsById = useMemo(() => new Map(products.map(product => [product.id, product])), [products])
  const prepared = useMemo(() => preparePOFormDraft(parsed, decision, customers, products), [parsed, decision, customers, products])
  const blockingIssues = issues.filter(issue => issue.blocking)
  const financialIssues = prepared.issues.filter(isFinancialReviewIssue)
  const financialIds = new Set(financialIssues.map(issue => issue.id))
  const set = <K extends keyof ReviewDecision>(field: K, value: ReviewDecision[K]) => onChange({ ...decision, [field]: value, ...(field === 'customerId' ? { acknowledgedIssueIds: [] } : {}) })
  const rowSet = (rowId: string, patch: Partial<RowDecision>) => {
    const financialChange = Object.keys(patch).some(field => ['unitPrice', 'quantity', 'productId', 'manual', 'sku', 'name'].includes(field))
    const sourceIds = new Set([...(parsed.rows.find(row => row.id === rowId)?.issues.map(issue => issue.id) ?? []), ...parsed.issues.map(issue => issue.id)])
    onChange({ ...decision, rows: { ...decision.rows, [rowId]: { ...decision.rows[rowId], ...patch } }, acknowledgedIssueIds: financialChange ? decision.acknowledgedIssueIds.filter(id => !id.startsWith(`${rowId}:`) && !sourceIds.has(id) && !financialIds.has(id)) : decision.acknowledgedIssueIds })
  }
  const acknowledge = (issueId: string, checked: boolean) => set('acknowledgedIssueIds', checked ? [...new Set([...decision.acknowledgedIssueIds, issueId])] : decision.acknowledgedIssueIds.filter(value => value !== issueId))
  const sourceIssues = [...parsed.issues, ...parsed.rows.flatMap(row => row.issues)]
  const fallback = !parsed.complete || !parsed.layout || !parsed.rows.length
  return <div className="min-w-0 space-y-4">
    <p className="text-sm text-amber-800">Periksa setiap nilai dengan dokumen. Belum diterapkan dan belum disimpan. Harga dokumen tidak dikonversi atau diubah berdasarkan pajak.</p>
    {fallback && <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-800">{hasExtractedText ? 'Teks dokumen sudah terbaca, tetapi struktur tabel atau kelengkapan baris belum dapat dipastikan. Isi PO secara manual; tidak ada barang yang disimpan otomatis.' : 'Dokumen belum dapat diimpor dengan aman. Isi PO secara manual; tidak ada barang yang disimpan otomatis.'}</p>}
    <fieldset disabled={disabled || fallback} className="min-w-0 space-y-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label htmlFor={`${id}-customer`} className="text-[length:var(--ui-text-label)] font-medium">Pelanggan hasil impor</label>
          <select id={`${id}-customer`} className={inputClass} value={decision.customerId} onChange={e => set('customerId', e.target.value)}>
            <option value="">Pilih pelanggan secara jelas</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}
          </select><Source field={parsed.buyer} /></div>
        <div><label htmlFor={`${id}-number`} className="text-[length:var(--ui-text-label)] font-medium">Nomor PO hasil impor</label><input id={`${id}-number`} value={decision.poNumber} onChange={e => set('poNumber', e.target.value)} className={inputClass} /><Source field={parsed.poNumber} /></div>
        <div><label htmlFor={`${id}-date`} className="text-[length:var(--ui-text-label)] font-medium">Tanggal PO hasil impor</label><input id={`${id}-date`} type="date" value={decision.orderDate} onChange={e => set('orderDate', e.target.value)} className={inputClass} /><Source field={parsed.orderDate} /></div>
        <div><label htmlFor={`${id}-expiry`} className="text-[length:var(--ui-text-label)] font-medium">Kedaluwarsa PO hasil impor (opsional)</label><input id={`${id}-expiry`} type="date" value={decision.expiry} onChange={e => set('expiry', e.target.value)} className={inputClass} /><Source field={parsed.expiry} /></div>
      </div>
      <div><label htmlFor={`${id}-notes`} className="text-[length:var(--ui-text-label)] font-medium">Catatan hasil impor</label><textarea id={`${id}-notes`} value={decision.notes} onChange={e => set('notes', e.target.value)} className={inputClass} rows={3} /></div>
      <div className="rounded bg-gray-50 p-3 text-[13px] text-gray-600 [overflow-wrap:anywhere]">Pemasok: {parsed.supplier.raw || 'Tidak tercantum'} · Pengiriman: {parsed.delivery.raw || 'Tidak tercantum'} · Pembayaran: {parsed.paymentTerms.raw || 'Tidak tercantum'} · Mata uang: {parsed.currency.raw || 'IDR (default)'} · Total tercetak: {parsed.printedTotal.raw || 'Tidak tercantum'} · Dasar harga: {parsed.priceBasis}</div>
      {parsed.rows.map((source, index) => {
        const row = decision.rows[source.id]
        if (!row) return null
        const product = row.productId ? productsById.get(row.productId) : undefined
        const candidates = (suggestions.productMatchesByRow[source.id] ?? []).flatMap(match => {
          const candidate = productsById.get(match.productId)
          return candidate ? [{ ...match, product: candidate }] : []
        })
        const exactCollision = (suggestions.exactSkuIdsByRow[source.id] ?? []).length > 1
        const missingId = source.issues.find(issue => issue.code === 'missing-price')?.id ?? `${source.id}:missing-price`
        const zeroId = source.issues.find(issue => issue.code === 'zero-price')?.id ?? `${source.id}:zero-price`
        return <section key={source.id} aria-label={`Barang hasil impor ${index + 1}`} className="min-w-0 rounded-lg border border-gray-200 p-3 space-y-3">
          <h3 className="font-medium text-sm">Barang {index + 1}</h3>
          <div className="min-w-0">
            <p className="text-sm [overflow-wrap:anywhere]">Produk dipilih: {product ? `${product.sku} · ${product.name}` : row.manual ? 'Barang manual' : 'Belum dipilih'}</p>
            {!row.productId && !row.manual && candidates.length > 0 && <div className="mt-2 space-y-2">
              <p className="text-[13px] text-amber-800">Saran belum dipilih. Hingga 5 saran, teks SKU cocok didahulukan. Skor kemiripan 0–100 membandingkan kata deskripsi dan ukuran/model, bukan probabilitas atau jaminan kecocokan. Pilih dan periksa dengan dokumen.</p>
              {exactCollision && <p className="text-[13px] text-amber-800">Kode sumber cocok dengan lebih dari satu produk katalog. Pilih produk secara jelas; tidak ada pilihan otomatis.</p>}
              <ol aria-label={`Saran produk barang ${index + 1}`} className="space-y-2">
                {candidates.map(candidate => <li key={candidate.productId} className="min-w-0 rounded border border-gray-200 p-2 text-[13px] [overflow-wrap:anywhere]">
                  <p className="font-medium">{candidate.product.sku} · {candidate.product.name}{candidate.product.size ? ` · ${candidate.product.size}` : ''}</p>
                  <p className="text-brand-secondary">{candidate.kind === 'exact-sku' ? 'Teks SKU cocok; periksa asal kode dan pilih secara sengaja' : candidate.kind === 'exact-name' ? 'nama saja; pilih SKU ERP secara sengaja' : 'Deskripsi/ukuran/model mirip; pilih SKU ERP secara sengaja'} · Skor kemiripan {candidate.score}/100</p>
                  {candidate.specification === 'conflict' && <p className="text-amber-800">Angka ukuran/model berbeda; periksa spesifikasi dengan dokumen.</p>}
                  <Button variant="quiet" size="compact" type="button" disabled={disabled} aria-label={`Pilih ${candidate.product.sku} untuk barang ${index + 1}: ${candidate.product.name}`} onClick={() => {
                    const chosen = candidate.product
                    rowSet(source.id, { productId: chosen.id, name: chosen.name, sku: chosen.sku, manual: false, unitConfirmed: false })
                    setSelectingRow(null); productButtons.current[source.id]?.focus()
                  }} className="mt-2">Pilih {candidate.product.sku}</Button>
                </li>)}
              </ol>
            </div>}
            <span ref={node => { productButtons.current[source.id] = node?.querySelector<HTMLButtonElement>('button') ?? null }}><Button variant="quiet" size="compact" type="button" disabled={disabled} onClick={() => setSelectingRow(selectingRow === source.id ? null : source.id)} className="mt-2">Pilih produk barang {index + 1}</Button></span>
            {selectingRow === source.id && <div className="mt-2"><POProductLookup products={products} label={`Cari produk hasil impor ${index + 1}`} disabled={disabled} onSelect={chosen => {
              rowSet(source.id, { productId: chosen.id, name: chosen.name, sku: chosen.sku, manual: false, unitConfirmed: false })
              setSelectingRow(null); productButtons.current[source.id]?.focus()
            }} /></div>}
            <p className="mt-1 text-[13px] text-brand-secondary [overflow-wrap:anywhere]">SKU dokumen: {source.sku.raw || '(kosong)'} · Barcode: {source.barcode.raw || '(kosong)'}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
            <div><label htmlFor={`${id}-${source.id}-name`} className="text-[length:var(--ui-text-label)] font-medium">Nama barang hasil impor {index + 1}</label><input id={`${id}-${source.id}-name`} value={row.name} readOnly className={inputClass} /><Source field={source.name} /></div>
            <div><label htmlFor={`${id}-${source.id}-sku`} className="text-[length:var(--ui-text-label)] font-medium">SKU hasil impor {index + 1}</label><input id={`${id}-${source.id}-sku`} value={row.sku} readOnly className={inputClass} /></div>
            <div><label htmlFor={`${id}-${source.id}-quantity`} className="text-[length:var(--ui-text-label)] font-medium">Jumlah hasil impor {index + 1}</label><input id={`${id}-${source.id}-quantity`} inputMode="numeric" value={row.quantity} onChange={e => rowSet(source.id, { quantity: e.target.value })} className={inputClass} /><Source field={source.quantity} /></div>
            <div><label htmlFor={`${id}-${source.id}-price`} className="text-[length:var(--ui-text-label)] font-medium">Harga hasil impor {index + 1}</label><input id={`${id}-${source.id}-price`} inputMode="decimal" value={row.unitPrice ?? ''} onChange={e => rowSet(source.id, { unitPrice: e.target.value.trim() || null })} className={inputClass} /><Source field={source.unitPrice} />
              </div>
          </div>
          <p className="text-[13px] text-brand-secondary">Satuan dokumen: {source.uom.raw || '(tidak jelas)'} · Satuan katalog: {product?.size || '(tidak tercantum)'}. Tidak ada konversi satuan otomatis.</p>
          <label className="flex min-h-[var(--ui-control-size)] items-center gap-2 text-sm"><input type="checkbox" aria-label={`Saya sudah memeriksa satuan barang ${index + 1}`} checked={row.unitConfirmed} onChange={e => rowSet(source.id, { unitConfirmed: e.target.checked })} />Saya sudah memeriksa jumlah dan satuan</label>
          {row.unitPrice === null && <label className="flex min-h-[var(--ui-control-size)] items-center gap-2 text-sm text-amber-800"><input type="checkbox" aria-label={`Harga kosong akan saya lengkapi di formulir (barang ${index + 1})`} checked={decision.acknowledgedIssueIds.includes(missingId)} onChange={e => acknowledge(missingId, e.target.checked)} />Harga kosong akan saya lengkapi di formulir; Save masih akan menolak harga kosong</label>}
          {row.unitPrice !== null && Number(row.unitPrice) === 0 && <label className="flex min-h-[var(--ui-control-size)] items-center gap-2 text-sm text-amber-800"><input type="checkbox" aria-label={`Harga nol sudah saya periksa (barang ${index + 1})`} checked={decision.acknowledgedIssueIds.includes(zeroId)} onChange={e => acknowledge(zeroId, e.target.checked)} />Harga nol sudah saya periksa dan memang dimaksudkan</label>}
        </section>
      })}
      {!!financialIssues.length && <section aria-label="Tinjauan keuangan wajib" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <h3 className="text-sm font-medium text-amber-900">Tinjauan keuangan wajib</h3>
        <p className="text-[13px] text-amber-800">Periksa perbedaan harga, total, pajak dan biaya terhadap dokumen. Tidak ada penyesuaian harga atau komponen biaya otomatis. Semua peringatan ini harus ditinjau sebelum Terapkan.</p>
        {financialIssues.map(issue => {
          const index = parsed.rows.findIndex(row => issue.field.startsWith(`rows.${row.id}.`))
          const context = index >= 0 ? ` (barang ${index + 1})` : ''
          return <label key={issue.id} className="flex min-h-[var(--ui-control-size)] gap-2 items-center text-sm text-amber-900"><input type="checkbox" aria-label={`Saya telah meninjau: ${issue.message}${context}`} checked={decision.acknowledgedIssueIds.includes(issue.id)} onChange={e => acknowledge(issue.id, e.target.checked)} /><span>{issue.message}{context}</span></label>
        })}
      </section>}
      {sourceIssues.filter(issue => !['missing-price', 'zero-price'].includes(issue.code) && !isFinancialReviewIssue(issue)).map(issue => <div key={issue.id} className="rounded bg-amber-50 p-3 text-sm text-amber-800"><p>{issue.message}</p></div>)}
    </fieldset>
    {!!blockingIssues.length && <div role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700"><p>Periksa sebelum menerapkan:</p><ul className="list-disc pl-5">{blockingIssues.map(issue => <li key={issue.id}>{issue.message}</li>)}</ul></div>}
    <Button variant="primary" type="button" disabled={disabled || fallback} onClick={onApply} >Terapkan ke formulir</Button>
  </div>
}
