import { useLayoutEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/AuthContext'
import { fetchLastPOPrice, type LastPOPrice } from '../lib/reads/poPriceHistory'
import { formatMoney } from '../lib/reads/money'
import { Button } from './ui/Button'

export type POLastPriceSuggestionProps = {
  customerId: string; productId: string | null; sku: string;
  currentUnitPrice: number; enabled?: boolean; disabled?: boolean; onUsePrice: (price: number) => void;
}

/** Advisory only. This component never owns or automatically changes a draft. */
export default function POLastPriceSuggestion(props: POLastPriceSuggestionProps) {
  const { customerId, productId, sku, currentUnitPrice, disabled } = props
  const auth = useAuth(), client = useQueryClient()
  const actor = !auth.loading && !auth.error && auth.user && auth.profile?.id === auth.user.id && auth.profile.is_active &&
    ['po_admin', 'executive'].includes(auth.profile.role) ? `${auth.user.id}:${auth.profile.role}` : ''
  const scope = JSON.stringify([actor, customerId, productId, sku])
  const queryKey = ['po-last-price', actor, customerId, productId, sku]
  const eligible = props.enabled !== false && !!actor && !!customerId && !!productId && !!sku.trim()
  const current = useRef({ scope, ...props }); current.current = { scope, ...props }
  const mounted = useRef(false)
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const query = useQuery({
    queryKey, enabled: eligible,
    queryFn: ({ signal }) => {
      if (!eligible || !productId) throw new Error('Identitas riwayat harga belum tersedia.')
      return fetchLastPOPrice(customerId, productId, sku, signal)
    },
    staleTime: 0, refetchOnMount: 'always', retry: false,
  })
  if (!eligible) return null
  const state = client.getQueryState<LastPOPrice>(queryKey)
  const ready = query.isSuccess && query.fetchStatus === 'idle' && !state?.isInvalidated && !query.error
  const result = ready ? query.data : undefined
  function useSuggestion() {
    const live = current.current, latest = client.getQueryState<LastPOPrice>(queryKey)
    // The cache check also blocks an old enabled DOM button in the same turn as
    // invalidation, before React paints the loading state. The caller separately
    // guards the stable line key, current customer and transaction identity.
    if (!mounted.current || live.scope !== scope || live.enabled === false || live.disabled || !Object.is(live.currentUnitPrice, currentUnitPrice) ||
      latest?.status !== 'success' || latest.fetchStatus !== 'idle' || latest.isInvalidated || latest.error ||
      latest.data !== result || result?.kind !== 'suggestion') return
    live.onUsePrice(result.unitPrice)
  }
  return <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600" aria-live="polite" aria-atomic="true">
    {query.isPaused ? <p role="status">Koneksi terputus. Sambungkan kembali untuk memuat riwayat harga.</p> : query.isError ? <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
      <p>Riwayat harga belum dapat dimuat. Harga yang diisi tetap tersimpan di formulir.</p>
      <Button variant="secondary" disabled={disabled} onClick={() => { if (mounted.current && current.current.scope === scope && !current.current.disabled) void query.refetch() }}>Coba lagi</Button>
    </div> : !result ? <p role="status">Memuat riwayat harga…</p> : result.kind === 'none' ?
      <p>Ini pertama kali pelanggan ini memesan item ini. Belum ada PO nonbatal untuk item ini.</p> : <>
      {result.kind === 'legacy' ? <p>Riwayat lama belum memiliki identitas produk yang pasti. Periksa PO dan isi harga secara manual.</p> :
        result.kind === 'ambiguous' ? <p>PO terakhir memuat beberapa harga untuk item ini. Periksa PO dan isi harga secara manual.</p> :
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-medium text-slate-800">Harga satuan terakhir: Rp {formatMoney(result.price, 'full')}</p>
            <Button variant="secondary" className="w-full sm:w-auto" aria-label={`${currentUnitPrice === result.unitPrice ? 'Harga ini sudah digunakan' : 'Gunakan harga ini'} untuk ${sku}`}
              disabled={disabled || currentUnitPrice === result.unitPrice} onClick={useSuggestion}>
              {currentUnitPrice === result.unitPrice ? 'Harga ini sudah digunakan' : 'Gunakan harga ini'}
            </Button>
          </div>}
      <p className="mt-1 break-words text-[13px]">PO {result.po.po_number} · {result.po.order_date.split('-').reverse().join('/')}. Berdasarkan PO nonbatal yang terakhir dimasukkan.</p>
      {result.kind === 'suggestion' && <p className="mt-1 text-[13px]">Harga yang sudah diisi tidak berubah otomatis.</p>}
    </>}
  </div>
}
