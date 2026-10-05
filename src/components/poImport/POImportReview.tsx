import { preparePOFormDraft, isFinancialReviewIssue } from '../../lib/poImport/review'
import { matchPODraft, skuKey } from '../../lib/poImport/matching'
import { POProductLookup } from '../POLookup'
import { useId, useMemo, useRef, useState } from 'react'
import type { Customer, Issue, ParsedPO, Product, ReviewDecision, RowDecision, SourceField } from '../../lib/poImport/contracts'
import { resolveCatalogPrice } from '../../lib/catalogPricing'

type Props = { parsed: ParsedPO; decision: ReviewDecision; customers: Customer[]; products: Product[]; issues: Issue[]; disabled: boolean; onChange(decision: ReviewDecision): void; onApply(): void }
const inputClass = 'min-w-0 max-w-full w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50'
function Source({ field }: { field: SourceField }) {
  return <p className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]">Dokumen: {field.raw || '(tidak tercantum)'}{field.page ? ` · halaman ${field.page}` : ''}</p>
}
export default function POImportReview({ parsed, decision, customers, products, issues, disabled, onChange, onApply }: Props) {
  const id = useId()
  const [selectingRow, setSelectingRow] = useState<string | null>(null)
  const productButtons = useRef<Record<string, HTMLButtonElement | null>>({})
  const suggestions = useMemo(() => matchPODraft(parsed, customers, products), [parsed, customers, products])
  const prepared = useMemo(() => preparePOFormDraft(parsed, decision, customers, products), [parsed, decision, customers, products])
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
  const customer = customers.find(c => c.id === decision.customerId)
  return <div className="min-w-0 space-y-4">
    <p className="text-sm text-amber-800">Periksa setiap nilai dengan dokumen. Belum diterapkan dan belum disimpan. Harga dokumen tidak dikonversi atau diubah berdasarkan pajak.</p>
    {fallback && <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-800">Dokumen belum dapat diimpor dengan aman. Isi PO secara manual; tidak ada barang yang disimpan otomatis.</p>}
    <fieldset disabled={disabled || fallback} className="min-w-0 space-y-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label htmlFor={`${id}-customer`} className="text-sm">Pelanggan hasil impor</label>
          <select id={`${id}-customer`} className={inputClass} value={decision.customerId} onChange={e => set('customerId', e.target.value)}>
            <option value="">Pilih pelanggan secara jelas</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}
          </select><Source field={parsed.buyer} /></div>
        <div><label htmlFor={`${id}-number`} className="text-sm">Nomor PO hasil impor</label><input id={`${id}-number`} value={decision.poNumber} onChange={e => set('poNumber', e.target.value)} className={inputClass} /><Source field={parsed.poNumber} /></div>
        <div><label htmlFor={`${id}-date`} className="text-sm">Tanggal PO hasil impor</label><input id={`${id}-date`} type="date" value={decision.orderDate} onChange={e => set('orderDate', e.target.value)} className={inputClass} /><Source field={parsed.orderDate} /></div>
        <div><label htmlFor={`${id}-expiry`} className="text-sm">Kedaluwarsa PO hasil impor (opsional)</label><input id={`${id}-expiry`} type="date" value={decision.expiry} onChange={e => set('expiry', e.target.value)} className={inputClass} /><Source field={parsed.expiry} /></div>
      </div>
      <div><label htmlFor={`${id}-notes`} className="text-sm">Catatan hasil impor</label><textarea id={`${id}-notes`} value={decision.notes} onChange={e => set('notes', e.target.value)} className={inputClass} rows={3} /></div>
      <div className="rounded bg-gray-50 p-3 text-xs text-gray-600 [overflow-wrap:anywhere]">Pemasok: {parsed.supplier.raw || 'Tidak tercantum'} · Pengiriman: {parsed.delivery.raw || 'Tidak tercantum'} · Pembayaran: {parsed.paymentTerms.raw || 'Tidak tercantum'} · Mata uang: {parsed.currency.raw || 'Tidak tercantum'} · Total tercetak: {parsed.printedTotal.raw || 'Tidak tercantum'} · Dasar harga: {parsed.priceBasis}</div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={decision.idrConfirmed} onChange={e => set('idrConfirmed', e.target.checked)} />Saya memastikan nilai harga dalam IDR tanpa konversi</label>
      {parsed.rows.map((source, index) => {
        const row = decision.rows[source.id]
        if (!row) return null
        const product = products.find(p => p.id === row.productId)
        const candidates = products.filter(p => (suggestions.productIdsByRow[source.id] ?? []).includes(p.id))
        const catalogPrice = product ? resolveCatalogPrice(product, customer?.pricing_tier ?? 'others') : null
        const missingId = source.issues.find(issue => issue.code === 'missing-price')?.id ?? `${source.id}:missing-price`
        const zeroId = source.issues.find(issue => issue.code === 'zero-price')?.id ?? `${source.id}:zero-price`
        return <section key={source.id} aria-label={`Barang hasil impor ${index + 1}`} className="min-w-0 rounded-lg border border-gray-200 p-3 space-y-3">
          <h3 className="font-medium text-sm">Barang {index + 1}</h3>
          <div className="min-w-0">
            <p className="text-sm [overflow-wrap:anywhere]">Produk dipilih: {product ? `${product.sku} · ${product.name}` : row.manual ? 'Barang manual' : 'Belum dipilih'}</p>
            {!row.productId && !row.manual && candidates.length > 0 && <p className="mt-1 text-xs text-amber-800 [overflow-wrap:anywhere]">Saran belum dipilih: {candidates.map(candidate => `${candidate.sku} · ${candidate.name} (${source.sku.value && skuKey(source.sku.value) === skuKey(candidate.sku) ? 'teks SKU cocok; periksa asal kode dan pilih secara sengaja' : 'nama saja; pilih SKU ERP secara sengaja'})`).join('; ')}</p>}
            {!row.productId && !row.manual && candidates.length === 1 && <button type="button" disabled={disabled} aria-label={`Gunakan saran produk barang ${index + 1}: ${candidates[0].sku} · ${candidates[0].name}`} onClick={() => {
              const chosen = candidates[0]
              rowSet(source.id, { productId: chosen.id, name: chosen.name, sku: chosen.sku, manual: false, unitConfirmed: false })
              setSelectingRow(null); productButtons.current[source.id]?.focus()
            }} className="mt-2 mr-2 rounded-lg border border-blue-300 px-3 py-2 text-sm text-blue-700 disabled:opacity-50">Gunakan saran barang {index + 1}</button>}
            <button type="button" ref={node => { productButtons.current[source.id] = node }} disabled={row.manual} onClick={() => setSelectingRow(selectingRow === source.id ? null : source.id)} className="mt-2 rounded-lg border border-blue-300 px-3 py-2 text-sm text-blue-700 disabled:opacity-50">Pilih produk barang {index + 1}</button>
            {selectingRow === source.id && <div className="mt-2"><POProductLookup products={products} label={`Cari produk hasil impor ${index + 1}`} disabled={disabled || row.manual} onSelect={chosen => {
              rowSet(source.id, { productId: chosen.id, name: chosen.name, sku: chosen.sku, manual: false, unitConfirmed: false })
              setSelectingRow(null); productButtons.current[source.id]?.focus()
            }} /></div>}
            <p className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]">SKU dokumen: {source.sku.raw || '(kosong)'} · Barcode: {source.barcode.raw || '(kosong)'}</p>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={`Gunakan barang manual ${index + 1}`} checked={row.manual} onChange={e => rowSet(source.id, { manual: e.target.checked, productId: null, name: source.name.value ?? source.name.raw, sku: source.sku.value ?? source.sku.raw, unitConfirmed: false })} />Gunakan barang manual (tanpa membuat master produk)</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
            <div><label htmlFor={`${id}-${source.id}-name`} className="text-sm">Nama barang hasil impor {index + 1}</label><input id={`${id}-${source.id}-name`} value={row.name} readOnly={!row.manual} onChange={e => rowSet(source.id, { name: e.target.value })} className={inputClass} /><Source field={source.name} /></div>
            <div><label htmlFor={`${id}-${source.id}-sku`} className="text-sm">SKU hasil impor {index + 1}</label><input id={`${id}-${source.id}-sku`} value={row.sku} readOnly={!row.manual} onChange={e => rowSet(source.id, { sku: e.target.value })} className={inputClass} /></div>
            <div><label htmlFor={`${id}-${source.id}-quantity`} className="text-sm">Jumlah hasil impor {index + 1}</label><input id={`${id}-${source.id}-quantity`} inputMode="numeric" value={row.quantity} onChange={e => rowSet(source.id, { quantity: e.target.value })} className={inputClass} /><Source field={source.quantity} /></div>
            <div><label htmlFor={`${id}-${source.id}-price`} className="text-sm">Harga hasil impor {index + 1}</label><input id={`${id}-${source.id}-price`} inputMode="decimal" value={row.unitPrice ?? ''} onChange={e => rowSet(source.id, { unitPrice: e.target.value.trim() || null })} className={inputClass} /><Source field={source.unitPrice} />
              <p className="mt-1 text-xs text-gray-500">Harga tier katalog (referensi saja): {catalogPrice === null ? 'Tidak tersedia' : `Rp ${catalogPrice.toLocaleString('id-ID')}`}. Harga dokumen tetap.</p></div>
          </div>
          <p className="text-xs text-gray-500">Satuan dokumen: {source.uom.raw || '(tidak jelas)'} · Satuan katalog: {product?.size || '(tidak tercantum)'}. Tidak ada konversi satuan otomatis.</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={`Saya sudah memeriksa satuan barang ${index + 1}`} checked={row.unitConfirmed} onChange={e => rowSet(source.id, { unitConfirmed: e.target.checked })} />Saya sudah memeriksa jumlah dan satuan</label>
          {row.unitPrice === null && <label className="flex items-start gap-2 text-sm text-amber-800"><input type="checkbox" aria-label={`Harga kosong akan saya lengkapi di formulir (barang ${index + 1})`} checked={decision.acknowledgedIssueIds.includes(missingId)} onChange={e => acknowledge(missingId, e.target.checked)} />Harga kosong akan saya lengkapi di formulir; Save masih akan menolak harga kosong</label>}
          {row.unitPrice !== null && Number(row.unitPrice) === 0 && <label className="flex items-start gap-2 text-sm text-amber-800"><input type="checkbox" aria-label={`Harga nol sudah saya periksa (barang ${index + 1})`} checked={decision.acknowledgedIssueIds.includes(zeroId)} onChange={e => acknowledge(zeroId, e.target.checked)} />Harga nol sudah saya periksa dan memang dimaksudkan</label>}
        </section>
      })}
      {!!financialIssues.length && <section aria-label="Tinjauan keuangan wajib" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <h3 className="text-sm font-medium text-amber-900">Tinjauan keuangan wajib</h3>
        <p className="text-xs text-amber-800">Periksa perbedaan harga, total, pajak dan biaya terhadap dokumen. Tidak ada penyesuaian harga atau komponen biaya otomatis. Semua peringatan ini harus ditinjau sebelum Terapkan.</p>
        {financialIssues.map(issue => {
          const index = parsed.rows.findIndex(row => issue.field.startsWith(`rows.${row.id}.`))
          const context = index >= 0 ? ` (barang ${index + 1})` : ''
          return <label key={issue.id} className="flex gap-2 items-start text-sm text-amber-900"><input type="checkbox" aria-label={`Saya telah meninjau: ${issue.message}${context}`} checked={decision.acknowledgedIssueIds.includes(issue.id)} onChange={e => acknowledge(issue.id, e.target.checked)} /><span>{issue.message}{context}</span></label>
        })}
      </section>}
      {sourceIssues.filter(issue => !['missing-price', 'zero-price'].includes(issue.code) && !isFinancialReviewIssue(issue)).map(issue => <div key={issue.id} className="rounded bg-amber-50 p-3 text-sm text-amber-800"><p>{issue.message}</p></div>)}
    </fieldset>
    {!!issues.length && <div role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700"><p>Periksa sebelum menerapkan:</p><ul className="list-disc pl-5">{issues.map(issue => <li key={issue.id}>{issue.message}</li>)}</ul></div>}
    <button type="button" disabled={disabled || fallback} onClick={onApply} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Terapkan ke formulir</button>
  </div>
}
