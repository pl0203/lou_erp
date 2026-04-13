import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type Customer = {
  id: string
  name: string
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  pricing_tier: string
}

type CustomerForm = {
  name: string
  address: string
  city: string
  phone: string
  email: string
  pricing_tier: string
}

const EMPTY_FORM: CustomerForm = {
  name: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  pricing_tier: 'luar_kota',
}

const TIER_LABELS: Record<string, string> = {
  harga_pokok:   'Harga Pokok',
  luar_kota:     'Luar Kota',
  dalam_kota:    'Dalam Kota',
  depo_bangunan: 'Depo Bangunan',
}

async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, address, city, phone, email, pricing_tier')
    .order('name')
  if (error) throw error
  return data
}

async function saveCustomer(form: CustomerForm, editingId: string | null) {
  const payload = {
    name: form.name.trim(),
    address: form.address.trim() || null,
    city: form.city.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    pricing_tier: form.pricing_tier,
  }
  if (editingId) {
    const { error } = await supabase.from('customers').update(payload).eq('id', editingId)
    if (error) throw error
  } else {
    const { error } = await supabase.from('customers').insert(payload)
    if (error) throw error
  }
}

async function deleteCustomer(id: string) {
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) throw error
}

export default function CustomerList() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: customers, isLoading } = useQuery({
    queryKey: ['athel_customers'],
    queryFn: fetchCustomers,
  })

  const saveMutation = useMutation({
    mutationFn: () => saveCustomer(form, editingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['athel_customers'] })
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteCustomer(deleteId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['athel_customers'] })
      setDeleteId(null)
    },
  })

  const openEdit = (c: Customer) => {
    setEditingId(c.id)
    setForm({
      name: c.name,
      address: c.address ?? '',
      city: c.city ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      pricing_tier: c.pricing_tier ?? 'luar_kota',
    })
    setShowForm(true)
  }

  const handleSave = () => {
    if (!form.name.trim()) return alert('Nama pelanggan wajib diisi.')
    saveMutation.mutate()
  }

  const filtered = customers?.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.city?.toLowerCase().includes(search.toLowerCase())
  )

  const deleteTarget = customers?.find(c => c.id === deleteId)

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Daftar Pelanggan</h1>
          <p className="text-sm text-gray-500 mt-0.5">{customers?.length ?? 0} pelanggan</p>
        </div>
        <button
          onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true) }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Tambah Pelanggan
        </button>
      </div>

      <div className="px-4 md:px-8 py-4 bg-white border-b border-gray-100">
        <input
          type="text"
          placeholder="Cari pelanggan..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full sm:w-80 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="px-4 md:px-8 py-6">
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat data pelanggan...</div>
        )}

        {!isLoading && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Nama Pelanggan</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Kota</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Telepon</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Email</th>
                    <th className="text-left px-5 py-3 font-medium text-gray-500">Tier Harga</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-500">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered?.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-gray-400 py-12">
                        Tidak ada pelanggan ditemukan.
                      </td>
                    </tr>
                  )}
                  {filtered?.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-4 font-medium text-gray-900">{c.name}</td>
                      <td className="px-5 py-4 text-gray-600">{c.city ?? '—'}</td>
                      <td className="px-5 py-4 text-gray-600">{c.phone ?? '—'}</td>
                      <td className="px-5 py-4 text-gray-600">{c.email ?? '—'}</td>
                      <td className="px-5 py-4">
                        <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-medium">
                          {TIER_LABELS[c.pricing_tier] ?? c.pricing_tier}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openEdit(c)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3"
                        >
                          Ubah
                        </button>
                        <button
                          onClick={() => setDeleteId(c.id)}
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
              {filtered?.map(c => (
                <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{c.name}</p>
                      {c.city && <p className="text-xs text-gray-400 mt-0.5">{c.city}</p>}
                    </div>
                    <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-medium ml-2 shrink-0">
                      {TIER_LABELS[c.pricing_tier] ?? c.pricing_tier}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div>
                      <p className="text-gray-400">Telepon</p>
                      <p className="text-gray-700 mt-0.5">{c.phone ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Email</p>
                      <p className="text-gray-700 mt-0.5">{c.email ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => openEdit(c)}
                      className="flex-1 text-center text-blue-600 text-xs font-medium py-2 rounded-lg bg-blue-50"
                    >
                      Ubah
                    </button>
                    <button
                      onClick={() => setDeleteId(c.id)}
                      className="flex-1 text-center text-red-500 text-xs font-medium py-2 rounded-lg bg-red-50"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {editingId ? 'Ubah Pelanggan' : 'Pelanggan Baru'}
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Nama Pelanggan *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="mis. Toko Bangunan Maju"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Alamat</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                  placeholder="mis. Jl. Sudirman No. 12"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Kota</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
                  placeholder="mis. Jakarta"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Telepon</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="mis. 021-5551234"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="mis. toko@example.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Tier Harga</label>
                <select
                  value={form.pricing_tier}
                  onChange={e => setForm(p => ({ ...p, pricing_tier: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="harga_pokok">Harga Pokok</option>
                  <option value="luar_kota">Luar Kota</option>
                  <option value="dalam_kota">Dalam Kota</option>
                  <option value="depo_bangunan">Depo Bangunan</option>
                </select>
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
            <h3 className="text-base font-semibold text-gray-900 mb-2">Hapus pelanggan ini?</h3>
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