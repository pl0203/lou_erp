import { useQuery } from '@tanstack/react-query'
import { fetchPromotions, isCurrentlyActive } from '../lib/promotions'

export default function ActivePromotionsBanner() {
  const { data: promotions } = useQuery({
    queryKey: ['promotions', 'highlights'],
    queryFn: fetchPromotions,
  })

  const activePromotions = promotions?.filter(isCurrentlyActive) ?? []

  if (activePromotions.length === 0) return null

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
      <p className="text-sm font-medium text-orange-800 mb-3">
        🔥 Product Highlight Aktif Sekarang
      </p>
      <div className="flex flex-wrap gap-3">
        {activePromotions.map(promo => (
          <div key={promo.id} className="bg-white border border-orange-200 rounded-lg px-3 py-2 text-xs">
            <p className="font-semibold text-gray-900">{promo.products?.name}</p>
            <p className="text-gray-400 mt-0.5">
              s/d {new Date(promo.end_date).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
