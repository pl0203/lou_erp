import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'
import ActivePromotionsBanner from '../../components/ActivePromotionsBanner'
import { isCurrentlyActive } from '../../lib/promotions'

type Product = {
  id: string
  name: string
  sku: string
  size: string | null
  harga_pokok: number
  luar_kota: number
  dalam_kota: number
  depo_bangunan: number
}

type Promotion = {
  id: string
  product_id: string
  start_date: string
  end_date: string
  harga_pokok: number | null
  luar_kota: number | null
  dalam_kota: number | null
  depo_bangunan: number | null
  is_active: boolean
  created_at: string
  products: {
    name: string
    sku: string
    size: string | null
    harga_pokok: number | null
    luar_kota: number | null
    dalam_kota: number | null
    depo_bangunan: number | null
  } | null
}

type PromoForm = {
  product_id: string
  start_date: string
  end_date: string
  harga_pokok: string
  luar_kota: string
  dalam_kota: string
  depo_bangunan: string
  discount: string  // add this
}

const EMPTY_FORM: PromoForm = {
  product_id: '',
  start_date: new Date().toISOString().split('T')[0],
  end_date: '',
  harga_pokok: '',
  luar_kota: '',
  dalam_kota: '',
  depo_bangunan: '',
  discount: '',  // add this
}

const TIER_LABELS: Record<string, string> = {
  harga_pokok:   'Harga Pokok',
  luar_kota:     'Luar Kota',
  dalam_kota:    'Dalam Kota',
  depo_bangunan: 'Depo Bangunan',
}

function formatCurrency(value: number | null | undefined): string {
  return `Rp ${(value ?? 0).toLocaleString('id-ID')}`
}

function getPromotionTierPrice(
  promo: Promotion,
  tier: 'harga_pokok' | 'luar_kota' | 'dalam_kota' | 'depo_bangunan'
): number | null {
  return promo[tier] ?? promo.products?.[tier] ?? null
}

async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, size, harga_pokok, luar_kota, dalam_kota, depo_bangunan')
    .order('name')
  if (error) throw error
  return data
}

async function fetchPromotions(): Promise<Promotion[]> {
  const { data, error } = await supabase
    .from('promotions')
    .select('id, product_id, start_date, end_date, harga_pokok, luar_kota, dalam_kota, depo_bangunan, is_active, created_at, products(name, sku, size, harga_pokok, luar_kota, dalam_kota, depo_bangunan)')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as Promotion[]
}

async function createPromotion(form: PromoForm, createdBy: string) {
  const { error } = await supabase
    .from('promotions')
    .insert({
      product_id: form.product_id,
      start_date: form.start_date,
      end_date: form.end_date,
      harga_pokok: parseFloat(form.harga_pokok) || 0,
      luar_kota: parseFloat(form.luar_kota) || 0,
      dalam_kota: parseFloat(form.dalam_kota) || 0,
      depo_bangunan: parseFloat(form.depo_bangunan) || 0,
      created_by: createdBy,
      is_active: true,
    })
  if (error) throw error
}

async function togglePromotion(id: string, isActive: boolean) {
  const { error } = await supabase
    .from('promotions')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) throw error
}

async function deletePromotion(id: string) {
  const { error } = await supabase
    .from('promotions')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export default function Promotions() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<PromoForm>(EMPTY_FORM)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  })

  const { data: promotions, isLoading } = useQuery({
    queryKey: ['promotions'],
    queryFn: fetchPromotions,
  })

  const activeCount = promotions?.filter(isCurrentlyActive).length ?? 0

  const createMutation = useMutation({
    mutationFn: () => createPromotion(form, profile!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] })
      queryClient.invalidateQueries({ queryKey: ['promotions', 'highlights'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      togglePromotion(id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] })
      queryClient.invalidateQueries({ queryKey: ['promotions', 'highlights'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deletePromotion(deleteId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] })
      queryClient.invalidateQueries({ queryKey: ['promotions', 'highlights'] })
      setDeleteId(null)
    },
  })

  const handleDiscount = (discountPct: string) => {
    const product = products?.find(p => p.id === form.product_id)
    if (!product) return
    setForm(prev => ({ ...prev, discount: discountPct }))
    const pct = parseFloat(discountPct)
    if (isNaN(pct) || pct < 0 || pct > 100) return
    const apply = (base: number) => Math.round(base * (1 - pct / 100))
    setForm(prev => ({
      ...prev,
      discount: discountPct,
      harga_pokok: apply(product.harga_pokok).toString(),
      luar_kota: apply(product.luar_kota).toString(),
      dalam_kota: apply(product.dalam_kota).toString(),
      depo_bangunan: apply(product.depo_bangunan).toString(),
    }))
  }
  
  const fillFromProduct = (productId: string) => {
    const product = products?.find(p => p.id === productId)
    if (!product) return
    setForm(prev => ({
      ...prev,
      product_id: productId,
      harga_pokok: product.harga_pokok.toString(),
      luar_kota: product.luar_kota.toString(),
      dalam_kota: product.dalam_kota.toString(),
      depo_bangunan: product.depo_bangunan.toString(),
      discount: '',
    }))
  }

  const handleSave = () => {
    if (!form.product_id) return alert('Pilih produk terlebih dahulu.')
    if (!form.end_date) return alert('Masukkan tanggal akhir promosi.')
    if (form.end_date < form.start_date) return alert('Tanggal akhir harus setelah tanggal mulai.')
    if (activeCount >= 3 && !showForm) return
    createMutation.mutate()
  }

  const deleteTarget = promotions?.find(p => p.id === deleteId)

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Promosi</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Product highlight untuk tim sales —{' '}
            <span className={activeCount >= 3 ? 'text-red-500 font-medium' : 'text-gray-500'}>
              {activeCount}/3 aktif
            </span>
          </p>
        </div>
        <button
          onClick={() => {
            if (activeCount >= 3) {
              alert('Maksimal 3 produk highlight aktif. Nonaktifkan salah satu terlebih dahulu.')
              return
            }
            setShowForm(true)
          }}
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Tambah Promosi
        </button>
      </div>

      <div className="px-4 md:px-8 py-6 space-y-4">
        <ActivePromotionsBanner />

        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat data promosi...</div>
        )}

        {!isLoading && (!promotions || promotions.length === 0) && (
          <div className="text-center py-24">
            <p className="text-gray-400 text-sm">Belum ada promosi dibuat.</p>
          </div>
        )}

        {/* Desktop table */}
        {!isLoading && promotions && promotions.length > 0 && (
          <>
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Produk</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Periode</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Harga Pokok</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Luar Kota</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Dalam Kota</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Depo Bangunan</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-500">Status</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.map(promo => {
                    const active = isCurrentlyActive(promo)
                    return (
                      <tr key={promo.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-5 py-4">
                          <p className="font-medium text-gray-900">{promo.products?.name}</p>
                          <p className="text-xs text-gray-400 font-mono uppercase mt-0.5">{promo.products?.sku}</p>
                        </td>
                        <td className="px-5 py-4 text-xs text-gray-600">
                          {new Date(promo.start_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {' — '}
                          {new Date(promo.end_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-5 py-4 text-right text-gray-700 text-xs">
                          {formatCurrency(getPromotionTierPrice(promo, 'harga_pokok'))}
                        </td>
                        <td className="px-5 py-4 text-right text-gray-700 text-xs">
                          {formatCurrency(getPromotionTierPrice(promo, 'luar_kota'))}
                        </td>
                        <td className="px-5 py-4 text-right text-gray-700 text-xs">
                          {formatCurrency(getPromotionTierPrice(promo, 'dalam_kota'))}
                        </td>
                        <td className="px-5 py-4 text-right text-gray-700 text-xs">
                          {formatCurrency(getPromotionTierPrice(promo, 'depo_bangunan'))}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            active ? 'bg-orange-100 text-orange-700'
                            : promo.is_active ? 'bg-gray-100 text-gray-500'
                            : 'bg-gray-100 text-gray-400'
                          }`}>
                            {active ? 'Aktif' : promo.is_active ? 'Terjadwal' : 'Nonaktif'}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={() => toggleMutation.mutate({ id: promo.id, isActive: !promo.is_active })}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3"
                          >
                            {promo.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          <button
                            onClick={() => setDeleteId(promo.id)}
                            className="text-red-400 hover:text-red-600 text-xs font-medium"
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {promotions.map(promo => {
                const active = isCurrentlyActive(promo)
                return (
                  <div key={promo.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">{promo.products?.name}</p>
                        <p className="text-xs text-gray-400 font-mono uppercase mt-0.5">{promo.products?.sku}</p>
                      </div>
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ml-2 shrink-0 ${
                        active ? 'bg-orange-100 text-orange-700'
                        : promo.is_active ? 'bg-gray-100 text-gray-500'
                        : 'bg-gray-100 text-gray-400'
                      }`}>
                        {active ? 'Aktif' : promo.is_active ? 'Terjadwal' : 'Nonaktif'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      {new Date(promo.start_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                      {' — '}
                      {new Date(promo.end_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      {(['harga_pokok', 'luar_kota', 'dalam_kota', 'depo_bangunan'] as const).map(tier => (
                        <div key={tier} className="bg-gray-50 rounded-lg p-2">
                          <p className="text-gray-400 mb-0.5">{TIER_LABELS[tier]}</p>
                          <p className="font-medium text-gray-900">
                            {formatCurrency(getPromotionTierPrice(promo, tier))}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => toggleMutation.mutate({ id: promo.id, isActive: !promo.is_active })}
                        className="flex-1 text-center text-blue-600 text-xs font-medium py-2 rounded-lg bg-blue-50"
                      >
                        {promo.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button
                        onClick={() => setDeleteId(promo.id)}
                        className="flex-1 text-center text-red-500 text-xs font-medium py-2 rounded-lg bg-red-50"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Create modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Tambah Product Highlight</h3>
              <p className="text-xs text-gray-400 mt-0.5">Sisa slot: {3 - activeCount} dari 3</p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Produk *</label>
                <select
                  value={form.product_id}
                  onChange={e => fillFromProduct(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Pilih produk...</option>
                  {products?.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.size ? `(${p.size})` : ''} — {p.sku}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Tanggal Mulai *</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Tanggal Akhir *</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              {/* Discount field */}
              {form.product_id && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <label className="block text-sm font-medium text-blue-800 mb-2">
                    Diskon otomatis <span className="font-normal text-blue-500">(opsional)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={form.discount}
                      onChange={e => handleDiscount(e.target.value)}
                      placeholder="mis. 10"
                      className="w-24 border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    />
                    <span className="text-sm text-blue-700 font-medium">%</span>
                    <span className="text-xs text-blue-500">
                      — harga semua tier akan dihitung otomatis
                    </span>
                  </div>
                  {form.discount && !isNaN(parseFloat(form.discount)) && (
                    <p className="text-xs text-blue-600 mt-2">
                      Diskon {form.discount}% diterapkan ke semua tier. Anda masih bisa mengubah harga secara manual di bawah.
                    </p>
                  )}
                </div>
              )}

              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-1">Harga Promosi per Tier</p>
                <p className="text-xs text-gray-400 mb-3">
                  Harga sudah diisi otomatis dari data produk. Ubah sesuai harga promosi.
                </p>
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
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={createMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
            {createMutation.isError && (
              <p className="text-red-500 text-xs px-6 pb-4 text-right">
                {(createMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Hapus promosi ini?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Apakah Anda yakin ingin menghapus highlight untuk{' '}
              <strong>{deleteTarget?.products?.name}</strong>? Tindakan ini tidak dapat dibatalkan.
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
