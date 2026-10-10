import { useQuery } from '@tanstack/react-query'
import { fetchPromotions, isCurrentlyActive, promotionStatus } from '../lib/promotions'
import { useAuth } from '../lib/AuthContext'
import PromotionImage from './PromotionImage'

export default function ActivePromotionsBanner() {
  const { user, profile, loading, error } = useAuth()
  const actorKey = !loading && !error && user && profile?.id === user.id && profile.is_active ? `${user.id}:${profile.role}` : ''
  const promotions = useQuery({ queryKey: ['promotions', 'highlights', actorKey], queryFn: ({ signal }) => fetchPromotions(signal), enabled: !!actorKey, retry: false,
    staleTime: 0, refetchInterval: 30_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, refetchOnReconnect: true,
  })
  if (!actorKey) return null
  if (promotions.isError) return <div role="alert" className="rounded-xl border border-brand-accent bg-brand-tint p-4 text-sm text-brand-primary">Highlight belum dapat dimuat. <button type="button" className="underline" onClick={() => void promotions.refetch()}>Coba lagi</button></div>
  if (promotions.isPending) return <p role="status" className="text-sm text-gray-500">Memuat highlight…</p>
  const visible = (promotions.data ?? []).filter(isCurrentlyActive)
  if (!visible.length) return <div>{promotions.isFetching && <p role="status" className="text-sm text-gray-500">Memperbarui highlight…</p>}<p className="text-sm text-gray-500">Belum ada product highlight aktif.</p></div>
  return <section aria-label="Product highlight" className="rounded-xl border border-brand-accent bg-brand-tint p-4">
    <h2 className="mb-3 text-sm font-medium text-brand-primary">Product Highlight</h2>
    {promotions.isFetching && <p role="status" className="mb-3 text-xs text-gray-500">Memperbarui highlight…</p>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map(promo => <article key={promo.id} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
        <PromotionImage key={promo.image_path} promotion={promo} />
        <h3 className="mt-2 text-sm font-semibold text-brand-primary">{promo.product_name}</h3>
        <p className="text-xs text-gray-500">{promo.sku}{promo.size ? ` · ${promo.size}` : ''}</p>
        <p className="mt-2 text-sm text-brand-primary">{promo.stock_managed ? `Stok tersedia: ${promo.remaining_quantity}` : 'Legacy · stok belum ditetapkan'}</p>
        <p className="mt-1 text-xs text-gray-500">{promotionStatus(promo)}</p>
      </article>)}
    </div>
  </section>
}
