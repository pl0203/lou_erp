import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/AuthContext'
import { fetchPromotionImage } from '../lib/promotions'
import type { ActivePromotion } from '../lib/promotions'

export default function PromotionImage({ promotion }: { promotion: ActivePromotion }) {
  const { user, profile, loading, error } = useAuth()
  const actorKey = !loading && !error && user && profile?.id === user.id && profile.is_active ? `${user.id}:${profile.role}` : ''
  const [imageError, setImageError] = useState(false)
  const image = useQuery({ queryKey: ['promotion-image', actorKey, promotion.id, promotion.image_path], queryFn: () => fetchPromotionImage(promotion.id), enabled: !!actorKey && !!promotion.image_path,
    retry: false, staleTime: 0, refetchInterval: 240000, refetchOnWindowFocus: true,
  })
  if (!actorKey || !promotion.image_path) return <p className="text-xs text-gray-500">Gambar belum tersedia</p>
  if (image.isError || imageError) return <div className="text-xs text-gray-600"><p>Gambar belum dapat dimuat.</p><button type="button" onClick={() => { setImageError(false); void image.refetch() }} className="mt-1 underline">Coba gambar lagi</button></div>
  if (!image.data || image.isFetching) return <p role="status" className="text-xs text-gray-500">Memuat gambar…</p>
  return <img src={image.data} alt={`Promosi ${promotion.product_name}`} onError={() => setImageError(true)} className="h-32 w-full rounded-lg bg-brand-canvas object-contain" />
}
