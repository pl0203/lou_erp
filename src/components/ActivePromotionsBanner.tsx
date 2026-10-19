import { LoadingState } from './ui/LoadingState'
import { Button } from './ui/Button'
import { EmptyState, Notice, StatusBadge } from './ui/Feedback'
import { RecordList } from './ui/RecordList'
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
  if (promotions.isError) return <Notice tone="error" title="Promosi belum dapat dimuat." actions={<Button size="compact" variant="secondary" onClick={() => void promotions.refetch()}>Coba lagi</Button>} />
  if (promotions.isPending) return <LoadingState title="Memuat promosi…" shape="list" />
  const visible = (promotions.data ?? []).filter(isCurrentlyActive)
  if (!visible.length) return <div>{promotions.isFetching && <p role="status" className="text-sm text-brand-secondary">Memperbarui promosi…</p>}<EmptyState title="Belum ada promosi produk aktif." /></div>
  return <section aria-label="Promosi produk" className="rounded-xl border border-brand-accent bg-brand-tint p-4">
    <h2 className="mb-3 text-sm font-medium text-brand-primary">Promosi Produk</h2>
    {promotions.isFetching && <p role="status" className="mb-3 text-[13px] text-brand-secondary">Memperbarui promosi…</p>}
    <RecordList label="Promosi produk aktif" className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map(promo => <li key={promo.id}><article className="min-w-0 rounded-[14px] border border-brand-divider bg-white p-4">
        <PromotionImage key={promo.image_path} promotion={promo} />
        <h3 className="mt-2 text-base font-semibold text-brand-primary [overflow-wrap:anywhere]">{promo.product_name}</h3>
        <p className="text-[13px] text-brand-secondary">{promo.sku}{promo.size ? ` · ${promo.size}` : ''}</p>
        <p className="mt-2 text-base text-brand-primary">{promo.stock_managed ? `Stok tersedia: ${promo.remaining_quantity}` : 'Legacy · stok belum ditetapkan'}</p>
        <StatusBadge tone="neutral" className="mt-2">{promotionStatus(promo)}</StatusBadge>
      </article></li>)}
    </RecordList>
  </section>
}
