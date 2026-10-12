import { useState } from 'react'
import { Button } from './ui/Button'
import { Notice } from './ui/Feedback'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/AuthContext'
import { fetchPromotionImage } from '../lib/promotions'
import type { ActivePromotion } from '../lib/promotions'

export default function PromotionImage({ promotion }: { promotion: ActivePromotion }) {
  const { user, profile, loading, error } = useAuth()
  const actorKey = !loading && !error && user && profile?.id === user.id && profile.is_active ? `${user.id}:${profile.role}` : ''
  const [failedImage, setFailedImage] = useState<{ url: string } | null>(null)
  const image = useQuery({ queryKey: ['promotion-image', actorKey, promotion.id, promotion.image_path], queryFn: async () => ({ url: await fetchPromotionImage(promotion.id) }), enabled: !!actorKey && !!promotion.image_path,
    // Each authorization gets its own response identity, even if the provider reuses a URL.
    structuralSharing: false, retry: false, staleTime: 0, refetchInterval: 240000, refetchOnWindowFocus: true, refetchOnReconnect: true,
  })
  if (!actorKey || !promotion.image_path) return <p className="text-[13px] text-brand-secondary">Gambar belum tersedia</p>
  if (image.isError || image.fetchStatus === 'idle' && image.data && failedImage === image.data) return <Notice tone="info" title="Gambar belum dapat dimuat." actions={<Button variant="secondary" onClick={() => { setFailedImage(null); void image.refetch() }}>Coba gambar lagi</Button>} />
  if (!image.data || image.fetchStatus !== 'idle') return <p role="status" className="text-[13px] text-brand-secondary">Memuat gambar…</p>
  return <img src={image.data.url} alt={`Promosi ${promotion.product_name}`} onError={() => setFailedImage(image.data ?? null)} className="h-32 w-full rounded-lg bg-brand-canvas object-contain" />
}
