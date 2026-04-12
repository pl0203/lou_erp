import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type PO = {
  id: string
  po_number: string
  status: string
  order_date: string
  expected_delivery_date: string | null
  total_value: number
  customers: { name: string }
  surat_jalan: { sj_number: string }[]
}

const STATUS_STYLES: Record<string, string> = {
  confirm:     'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  complete:    'bg-green-100 text-green-700',
  cancelled:   'bg-gray-200 text-gray-500',
}

const STATUS_LABELS: Record<string, string> = {
  confirm:     'Dikonfirmasi',
  in_progress: 'Dalam Proses',
  complete:    'Selesai',
  cancelled:   'Dibatalkan',
}

async function fetchPOs(status: string, search: string): Promise<PO[]> {
  let query = supabase
    .from('purchase_orders')
    .select('id, po_number, status, order_date, expected_delivery_date, total_value, customers(name), surat_jalan(sj_number)')
    .order('created_at', { ascending: false })

  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw error

  if (!search.trim()) return data as PO[]

  const q = search.toLowerCase()
  return (data as PO[]).filter(po =>
    po.po_number.toLowerCase().includes(q) ||
    po.customers?.name?.toLowerCase().includes(q) ||
    po.surat_jalan?.some(sj => sj.sj_number.toLowerCase().includes(q))
  )
}

export default function POList() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const handleSearch = (val: string) => {
    setSearch(val)
    clearTimeout((window as any)._searchTimer)
    ;(window as any)._searchTimer = setTimeout(() => setDebouncedSearch(val), 300)
  }

  const { data: pos, isLoading, isError } = useQuery({
    queryKey: ['purchase_orders', status, debouncedSearch],
    queryFn: () => fetchPOs(status, debouncedSearch),
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pesanan Pembelian</h1>
          <p className="text-sm text-gray-500 mt-0.5">{pos?.length ?? 0} pesanan</p>
        </div>
        <button
          onClick={() => navigate('/athel/po/new')}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + PO Baru
        </button>
      </div>

      <div className="px-4 md:px-8 py-3 flex flex-col sm:flex-row gap-2 bg-white border-b border-gray-100">
        <input
          type="text"
          placeholder="Cari nomor PO, pelanggan, atau SJ..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full sm:w-80 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Semua status</option>
          <option value="confirm">Dikonfirmasi</option>
          <option value="in_progress">Dalam Proses</option>
          <option value="complete">Selesai</option>
        </select>
      </div>

      <div className="px-4 md:px-8 py-6">
        {isLoading && (
          <div className="text-center text-gray-400 py-24 text-sm">Memuat pesanan pembelian...</div>
        )}
        {isError && (
          <div className="text-center text-red-500 py-24 text-sm">Gagal memuat data. Periksa koneksi Anda.</div>
        )}
        {!isLoading && !isError && pos?.length === 0 && (
          <div className="text-center text-gray-400 py-24 text-sm">Tidak ada pesanan pembelian ditemukan.</div>
        )}

        {!isLoading && !isError && pos && pos.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Nomor PO</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Pelanggan</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Tanggal Pesanan</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Estimasi Pengiriman</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Total Nilai</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map(po => (
                    <tr key={po.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4 font-medium text-gray-900">{po.po_number}</td>
                      <td className="px-5 py-4 text-gray-600">{po.customers?.name ?? '—'}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[po.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[po.status] ?? po.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-600">{po.order_date}</td>
                      <td className="px-5 py-4 text-gray-600">{po.expected_delivery_date ?? '—'}</td>
                      <td className="px-5 py-4 text-right text-gray-900 font-medium">
                        Rp {po.total_value.toLocaleString('id-ID')}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => navigate(`/athel/po/${po.id}`)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3"
                        >
                          Lihat
                        </button>
                        {po.status !== 'complete' && (
                          <button
                            onClick={() => navigate(`/athel/po/${po.id}/edit`)}
                            className="text-gray-500 hover:text-gray-800 text-xs font-medium"
                          >
                            Ubah
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {pos.map(po => (
                <div key={po.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{po.po_number}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{po.customers?.name ?? '—'}</p>
                    </div>
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${STATUS_STYLES[po.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[po.status] ?? po.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div>
                      <p className="text-gray-400">Tanggal Pesanan</p>
                      <p className="text-gray-700 font-medium">{po.order_date}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Estimasi Pengiriman</p>
                      <p className="text-gray-700 font-medium">{po.expected_delivery_date ?? '—'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-gray-400">Total Nilai</p>
                      <p className="text-gray-900 font-semibold">Rp {po.total_value.toLocaleString('id-ID')}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => navigate(`/athel/po/${po.id}`)}
                      className="flex-1 text-center text-blue-600 text-xs font-medium py-2 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"
                    >
                      Lihat
                    </button>
                    {po.status !== 'complete' && (
                      <button
                        onClick={() => navigate(`/athel/po/${po.id}/edit`)}
                        className="flex-1 text-center text-gray-600 text-xs font-medium py-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                      >
                        Ubah
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}