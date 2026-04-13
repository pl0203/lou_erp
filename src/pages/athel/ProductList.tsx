import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type Product = {
  id: string
  name: string
  sku: string
  size: string | null
  unit_price: number
  harga_pokok: number
  luar_kota: number
  dalam_kota: number
  depo_bangunan: number
}

type ProductForm = {
  name: string
  sku: string
  size: string
  harga_pokok: string
  luar_kota: string
  dalam_kota: string
  depo_bangunan: string
}

type ProductListResponse = {
  items: Product[]
  total: number
}

const EMPTY_FORM: ProductForm = {
  name: '',
  sku: '',
  size: '',
  harga_pokok: '',
  luar_kota: '',
  dalam_kota: '',
  depo_bangunan: '',
}

const PAGE_SIZE = 10

async function fetchProducts(search: string, page: number): Promise<ProductListResponse> {
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const trimmedSearch = search.trim()

  let query = supabase
    .from('products')
    .select('id, name, sku, size, unit_price, harga_pokok, luar_kota, dalam_kota, depo_bangunan', { count: 'exact' })
    .order('name')
    .range(from, to)

  if (trimmedSearch) {
    query = query.or(`name.ilike.%${trimmedSearch}%,sku.ilike.%${trimmedSearch}%`)
  }

  const { data, error, count } = await query
  if (error) throw error

  return {
    items: data ?? [],
    total: count ?? 0,
  }
}

async function saveProduct(form: ProductForm, editingId: string | null) {
  const payload = {
    name: form.name.trim(),
    sku: form.sku.trim().toUpperCase(),
    size: form.size.trim() || null,
    harga_pokok: parseFloat(form.harga_pokok) || 0,
    luar_kota: parseFloat(form.luar_kota) || 0,
    dalam_kota: parseFloat(form.dalam_kota) || 0,
    depo_bangunan: parseFloat(form.depo_bangunan) || 0,
    unit_price: parseFloat(form.luar_kota) || 0, // default unit_price = luar_kota
  }

  if (editingId) {
    const { error } = await supabase.from('products').update(payload).eq('id', editingId)
    if (error) throw error
  } else {
    const { error } = await supabase.from('products').insert(payload)
    if (error) throw error
  }
}

async function deleteProduct(id: string) {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

const TIER_LABELS: Record<string, string> = {
  harga_pokok:  'Harga Pokok',
  luar_kota:    'Luar Kota',
  dalam_kota:   'Dalam Kota',
  depo_bangunan: 'Depo Bangunan',
}

export default function ProductList() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const handleSearch = (value: string) => {
    setSearch(value)
    clearTimeout((window as any)._productSearchTimer)
    ;(window as any)._productSearchTimer = setTimeout(() => setDebouncedSearch(value), 300)
  }

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  const { data, isLoading } = useQuery({
    queryKey: ['products', debouncedSearch, page],
    queryFn: () => fetchProducts(debouncedSearch, page),
    placeholderData: previousData => previousData,
  })

  const products = data?.items ?? []
  const totalItems = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
  const startItem = totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const endItem = totalItems === 0 ? 0 : Math.min(page * PAGE_SIZE, totalItems)

  const saveMutation = useMutation({
    mutationFn: () => saveProduct(form, editingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteProduct(deleteId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setDeleteId(null)
    },
  })

  const openEdit = (p: Product) => {
    setEditingId(p.id)
    setForm({
      name: p.name,
      sku: p.sku,
      size: p.size ?? '',
      harga_pokok: p.harga_pokok.toString(),
      luar_kota: p.luar_kota.toString(),
      dalam_kota: p.dalam_kota.toString(),
      depo_bangunan: p.depo_bangunan.toString(),
    })
    setShowForm(true)
  }

  const handleSave = () => {
    if (!form.sku.trim()) return alert('SKU wajib diisi.')
    if (!form.name.trim()) return alert('Nama barang wajib diisi.')
    saveMutation.mutate()
  }

  const deleteTarget = products.find(p => p.id === deleteId)

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Daftar Barang</h1>
          <p className="text-sm text-gray-500 mt-0.5">{totalItems} barang</p>
        </div>
        <button
          onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true) }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Tambah Barang
        </button>
      </div>

      <div className="px-4 md:px-8 py-4 bg-white border-b border-gray-100">
        <input
          type="text"
          placeholder="Cari berdasarkan nama atau SKU..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full sm:w-80 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="px-4 md:px-8 py-6">
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat data barang...</div>
        )}

        {!isLoading && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium text-gray-500">SKU</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Nama Barang</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Ukuran</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Harga Pokok</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Luar Kota</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Dalam Kota</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Depo Bangunan</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center text-gray-400 py-12">
                        Tidak ada barang ditemukan.
                      </td>
                    </tr>
                  )}
                  {products.map(p => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-4 font-mono text-xs text-gray-500 uppercase">{p.sku}</td>
                      <td className="px-5 py-4 font-medium text-gray-900">{p.name}</td>
                      <td className="px-5 py-4 text-gray-500">{p.size ?? '—'}</td>
                      <td className="px-5 py-4 text-right text-gray-700">
                        Rp {p.harga_pokok.toLocaleString('id-ID')}
                      </td>
                      <td className="px-5 py-4 text-right text-gray-700">
                        Rp {p.luar_kota.toLocaleString('id-ID')}
                      </td>
                      <td className="px-5 py-4 text-right text-gray-700">
                        Rp {p.dalam_kota.toLocaleString('id-ID')}
                      </td>
                      <td className="px-5 py-4 text-right text-gray-700">
                        Rp {p.depo_bangunan.toLocaleString('id-ID')}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openEdit(p)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3"
                        >
                          Ubah
                        </button>
                        <button
                          onClick={() => setDeleteId(p.id)}
                          className="text-red-400 hover:text-red-600 text-xs font-medium"
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {products.map(p => (
                <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-400 font-mono uppercase mt-0.5">{p.sku}</p>
                      {p.size && <p className="text-xs text-gray-400 mt-0.5">{p.size}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEdit(p)}
                        className="text-blue-600 text-xs font-medium"
                      >
                        Ubah
                      </button>
                      <button
                        onClick={() => setDeleteId(p.id)}
                        className="text-red-400 text-xs font-medium"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="text-xs text-blue-600 mb-2"
                  >
                    {expandedId === p.id ? 'Sembunyikan harga ▲' : 'Lihat semua harga ▼'}
                  </button>

                  {expandedId === p.id && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {(['harga_pokok', 'luar_kota', 'dalam_kota', 'depo_bangunan'] as const).map(tier => (
                        <div key={tier} className="bg-gray-50 rounded-lg p-2">
                          <p className="text-gray-400 mb-0.5">{TIER_LABELS[tier]}</p>
                          <p className="font-medium text-gray-900">
                            Rp {p[tier].toLocaleString('id-ID')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {totalItems > 0 && (
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-500">
                  Menampilkan {startItem}-{endItem} dari {totalItems} barang
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(prev => Math.max(1, prev - 1))}
                    disabled={page === 1}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
                  >
                    Sebelumnya
                  </button>
                  <span className="text-sm text-gray-500 min-w-24 text-center">
                    Halaman {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
                  >
                    Berikutnya
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {editingId ? 'Ubah Barang' : 'Barang Baru'}
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">SKU *</label>
                  <input
                    type="text"
                    value={form.sku}
                    onChange={e => setForm(p => ({ ...p, sku: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="mis. MPA035"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Ukuran</label>
                  <input
                    type="text"
                    value={form.size}
                    onChange={e => setForm(p => ({ ...p, size: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="mis. 30x60"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Nama Barang *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="mis. Granit Putih Polos 60x60"
                />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-3">Harga per Tier</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { field: 'harga_pokok',   label: 'Harga Pokok' },
                    { field: 'luar_kota',     label: 'Luar Kota' },
                    { field: 'dalam_kota',    label: 'Dalam Kota' },
                    { field: 'depo_bangunan', label: 'Depo Bangunan' },
                  ] as const).map(({ field, label }) => (
                    <div key={field}>
                      <label className="block text-xs text-gray-500 mb-1">{label} (Rp)</label>
                      <input
                        type="number"
                        min={0}
                        value={form[field]}
                        onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
            {saveMutation.isError && (
              <p className="text-red-500 text-xs px-6 pb-4 text-right">
                {(saveMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Hapus barang ini?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Apakah Anda yakin ingin menghapus <strong>{deleteTarget?.name}</strong>? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
