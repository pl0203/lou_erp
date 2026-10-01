import { useQuery } from '@tanstack/react-query'
import { fetchSalesOrderLines } from '../lib/reads/detailReads'

/** Mounted only for a selected order; the child read is complete or unavailable. */
export default function SalesOrderItems({ orderId }: { orderId: string }) {
  const { data, isPending, isError, refetch } = useQuery({ queryKey: ['sales_order_lines', orderId], queryFn: ({ signal }) => fetchSalesOrderLines(orderId, signal) })
  if (isError) return <div role="alert" className="py-3 text-sm text-red-600">Barang pesanan belum dapat dimuat. <button onClick={() => refetch()} className="underline">Coba lagi</button></div>
  if (isPending || !data) return <p role="status" className="py-3 text-sm text-gray-500">Memuat semua barang pesanan...</p>
  return <div className="overflow-x-auto"><table className="w-full text-xs">
    <thead><tr className="text-gray-400"><th className="py-2 text-left font-medium">Produk</th><th className="py-2 text-left font-medium hidden sm:table-cell">SKU</th><th className="py-2 text-right font-medium">Qty</th><th className="py-2 text-right font-medium">Harga Satuan</th><th className="py-2 text-right font-medium">Total</th></tr></thead>
    <tbody>{data.map(item => <tr key={item.id} className="border-t border-gray-50">
      <td className="py-2 text-gray-700">{item.product_name}{item.is_promo && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-orange-600">Harga Promosi</span>}</td>
      <td className="py-2 text-gray-400 font-mono uppercase hidden sm:table-cell">{item.sku ?? '—'}</td>
      <td className="py-2 text-right text-gray-700">{item.quantity}</td><td className="py-2 text-right text-gray-700">Rp {item.unit_price.toLocaleString('id-ID')}</td><td className="py-2 text-right font-medium text-gray-900">Rp {(item.quantity * item.unit_price).toLocaleString('id-ID')}</td>
    </tr>)}</tbody>
  </table></div>
}
