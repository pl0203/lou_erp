import { useState } from 'react'
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
  if (!actorKey || !promotion.image_path) return <p className="text-xs text-gray-500">Gambar belum tersedia</p>
  if (image.isError || image.fetchStatus === 'idle' && image.data && failedImage === image.data) return <div className="text-xs text-gray-600"><p>Gambar belum dapat dimuat.</p><button type="button" onClick={() => { setFailedImage(null); void image.refetch() }} className="mt-1 underline">Coba gambar lagi</button></div>
  if (!image.data || image.fetchStatus !== 'idle') return <p role="status" className="text-xs text-gray-500">Memuat gambar…</p>
  return <img src={image.data.url} alt={`Promosi ${promotion.product_name}`} onError={() => setFailedImage(image.data ?? null)} className="h-32 w-full rounded-lg bg-brand-canvas object-contain" />
}
