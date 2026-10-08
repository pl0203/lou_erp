import { useEffect, useRef, useState } from 'react'
import { PromoStockWarningError } from '../lib/promotionStock'
import type { PromoStockNotice as Warning } from '../lib/promotionStock'

/** In-memory draft only; durable transaction metadata never contains draft or acknowledgement. */
export function usePromoStockSubmission<D extends { promo_stock_ack?: Record<string, unknown> }>(submit: (draft: D) => Promise<unknown>) {
  const [refusal, setRefusal] = useState<{ warning: Warning; draft: D } | null>(null)
  const busy = useRef(false)
  const run = async (draft: D) => {
    if (busy.current) return
    busy.current = true
    const snapshot = structuredClone(draft)
    try { await submit(snapshot); setRefusal(null) }
    catch (error) {
      if (error instanceof PromoStockWarningError) {
        const { promo_stock_ack: _ack, ...base } = snapshot
        setRefusal({ warning: error.warning, draft: base as D })
      } else setRefusal(null)
    } finally { busy.current = false }
  }
  return {
    warning: refusal?.warning ?? null,
    run,
    continue: () => refusal && run({ ...refusal.draft, promo_stock_ack: refusal.warning.ack }),
    cancel: () => setRefusal(null),
  }
}

export default function PromoStockWarning({ warning, pending, onContinue, onCancel }: {
  warning: Warning; pending: boolean; onContinue: () => void; onCancel: () => void
}) {
  const changed = warning.code === 'PROMO_STOCK_CHANGED'
  const title = changed ? 'Alokasi promosi berubah' : 'Stok promosi tidak mencukupi'
  const dialog = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    return () => previous?.focus()
  }, [])
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onKeyDown={event => {
    if (event.key === 'Escape' && !pending) { event.preventDefault(); onCancel() }
    if (event.key === 'Tab') {
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      if (!buttons?.length) { event.preventDefault(); return }
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="promo-warning-title" aria-describedby="promo-warning-description" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
      <h2 id="promo-warning-title" className="text-lg font-semibold text-[#192D43]">{title}</h2>
      <p id="promo-warning-description" className="mt-2 text-sm text-gray-600">Jumlah dan harga PO tetap sesuai isian Anda. Unit di luar stok promosi memakai harga yang sudah Anda isi. Periksa ketersediaan dan alokasi promosi terbaru sebelum melanjutkan.</p>
      <ul className="my-4 space-y-3" aria-live="polite">
        {warning.code === 'PROMO_STOCK_WARNING' && warning.shortages.map(item => <li key={item.promotion_id} className="rounded-lg border border-[#C69942] bg-[#F5EDD9] p-3 text-sm">
          <p className="font-semibold text-[#192D43]">{item.product_name} · {item.sku}</p>
          <div className="mt-1 flex flex-wrap gap-x-4"><span>Tersisa: {item.remaining_quantity}</span><span>Diminta: {item.requested_quantity}</span></div>
          <p className="mt-1 text-xs">Tambahan: {item.incremental_quantity} · Kekurangan: {item.shortfall}</p>
        </li>)}
        {warning.code === 'PROMO_STOCK_CHANGED' && warning.allocations.map(item => <li key={item.product_id} className="rounded-lg border border-[#C69942] bg-[#F5EDD9] p-3 text-sm">
          <p className="font-semibold text-[#192D43]">{item.product_name} · {item.sku}</p>
          {item.promotion_id === null ? <p className="mt-1">Tidak ada promosi aktif untuk alokasi. Unit promosi tersedia: 0.</p> : <p className="mt-1">Stok promosi tersedia: {item.remaining_quantity}</p>}
          <p className="mt-1">Diminta: {item.requested_quantity} · Tambahan: {item.incremental_quantity}</p>
          <p className="mt-1 font-medium">Unit promosi dialokasikan: {item.allocation_quantity}</p>
          <p className="mt-1 text-xs">Unit tambahan di luar alokasi promosi: {item.incremental_quantity - item.allocation_quantity}. Harga tetap sesuai isian PO.</p>
        </li>)}
      </ul>
      {warning.code === 'PROMO_STOCK_CHANGED' && warning.allocations.length === 0 && <p className="mb-4 text-sm text-gray-600">Tidak ada tambahan unit katalog untuk dialokasikan. Periksa perubahan ini sebelum melanjutkan; harga PO tetap sesuai isian.</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button ref={cancel} type="button" disabled={pending} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C69942]">Kembali ke formulir</button>
        <button type="button" disabled={pending} onClick={onContinue} className="rounded-lg bg-[#192D43] px-4 py-2 text-sm text-white hover:bg-[#243F5B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C69942] disabled:opacity-50">{pending ? 'Menyimpan...' : 'Lanjutkan'}</button>
      </div>
    </div>
  </div>
}
