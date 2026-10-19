import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/AuthContext'
import { fetchNewPOSalesPreview } from '../lib/poSales'
import { Button } from './ui/Button'

export default function NewPOSalesPreview({ customerId }: { customerId: string }) {
  const { user, profile, loading, error } = useAuth()
  const actorKey = !loading && !error && user && profile?.id === user.id && profile.is_active ? `${user.id}:${profile.role}` : ''
  const query = useQuery({ queryKey: ['new_po_sales_preview', actorKey, customerId],
    queryFn: ({ signal }) => fetchNewPOSalesPreview(customerId, signal), enabled: !!actorKey && profile?.role === 'executive' && !!customerId,
    retry: false, staleTime: 0, refetchOnWindowFocus: true })
  // Procurement's current RLS intentionally hides owner-assignment rows. A
  // hidden row is not evidence that the customer has no assigned salesperson.
  if (actorKey && profile?.role !== 'executive') return <p className="mt-1 text-sm text-brand-secondary">Sales: Ditetapkan otomatis saat PO disimpan.</p>
  if (!actorKey || query.isPending || query.isFetching) return <p role="status" className="mt-1 text-sm text-brand-secondary">Sales: Memuat penanggung jawab…</p>
  if (query.isError || (query.data !== null && typeof query.data !== 'string')) return <p className="mt-1 text-sm text-brand-secondary">Sales: Belum dapat dimuat. <Button size="compact" variant="quiet" onClick={() => void query.refetch()}>Coba lagi</Button></p>
  return <div className="mt-1 text-sm text-brand-secondary"><p>Sales: <span className="font-medium">{query.data ?? 'Belum ditugaskan'}</span></p><p className="text-[13px]">Pratinjau penanggung jawab pelanggan. Ditetapkan otomatis saat PO disimpan.</p></div>
}
