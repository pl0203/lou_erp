import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type Customer = {
  id: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
}

type CustomerForm = {
  name: string
  address: string
  phone: string
  email: string
}

const EMPTY_FORM: CustomerForm = { name: '', address: '', phone: '', email: '' }

async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, address, phone, email')
    .order('name')
  if (error) throw error
  return data
}

async function upsertCustomer(form: CustomerForm & { id?: string }) {
  const payload = {
    name: form.name,
    address: form.address || null,
    phone: form.phone || null,
    email: form.email || null,
  }
  if (form.id) {
    const { error } = await supabase.from('customers').update(payload).eq('id', form.id)
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
    queryKey: ['customers'],
    queryFn: fetchCustomers,
  })

  const upsertMutation = useMutation({
    mutationFn: upsertCustomer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      setDeleteId(null)
    },
  })

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (c: Customer) => {
    setEditingId(c.id)
    setForm({
      name: c.name,
      address: c.address ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
    })
    setShowForm(true)
  }

  const filtered = customers?.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  const deleteTarget = customers?.find(c => c.id === deleteId)

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />

      <div className="px-4 md:px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Daftar Toko/Customer</h1>
            <p className="text-sm text-gray-500 mt-0.5">{customers?.length ?? 0} pelanggan</p>
          </div>
          <button
            onClick={openCreate}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Tambah Toko/Customer
          </button>
        </div>

        <input
          type="text"
          placeholder="Cari toko/customer..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full sm:w-72 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {isLoading && (
          <div className="text-gray-400 text-sm py-12 text-center">Memuat...</div>
        )}

        {/* Desktop table */}
        {!isLoading && (
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Nama Toko/Customer</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Alamat</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Nomor Telepon</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Email</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-400 py-12">
                      Tidak ada pelanggan ditemukan.
                    </td>
                  </tr>
                )}
                {filtered?.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4 font-medium text-gray-900">{c.name}</td>
                    <td className="px-5 py-4 text-gray-600">{c.address ?? '—'}</td>
                    <td className="px-5 py-4 text-gray-600">{c.phone ?? '—'}</td>
                    <td className="px-5 py-4 text-gray-600">{c.email ?? '—'}</td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => openEdit(c)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-4"
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
        )}

        {/* Mobile cards */}
        {!isLoading && (
          <div className="md:hidden space-y-3">
            {filtered?.length === 0 && (
              <p className="text-center text-gray-400 py-12 text-sm">Tidak ada pelanggan ditemukan.</p>
            )}
            {filtered?.map(c => (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">{c.name}</p>
                    {c.address && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{c.address}</p>
                    )}
                  </div>
                  <div className="flex gap-3 shrink-0 ml-3">
                    <button
                      onClick={() => openEdit(c)}
                      className="text-blue-600 text-xs font-medium"
                    >
                      Ubah
                    </button>
                    <button
                      onClick={() => setDeleteId(c.id)}
                      className="text-red-400 text-xs font-medium"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mt-3 pt-3 border-t border-gray-100">
                  <div>
                    <p className="text-gray-400">Nomor Telepon</p>
                    <p className="text-gray-700 mt-0.5">{c.phone ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Email</p>
                    <p className="text-gray-700 mt-0.5 truncate">{c.email ?? '—'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              {editingId ? 'Edit Customer' : 'New Customer'}
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Nama Toko/Customer *', field: 'name', placeholder: 'e.g. Toko Bangunan Maju' },
                { label: 'Alamat', field: 'address', placeholder: 'e.g. Jl. Sudirman No. 12, Jakarta' },
                { label: 'Nomor Telepon', field: 'phone', placeholder: 'e.g. 021-5551234' },
                { label: 'Email', field: 'email', placeholder: 'e.g. toko@majujaya.com' },
              ].map(({ label, field, placeholder }) => (
                <div key={field}>
                  <label className="block text-sm text-gray-600 mb-1">{label}</label>
                  <input
                    type="text"
                    placeholder={placeholder}
                    value={form[field as keyof CustomerForm]}
                    onChange={e => setForm(prev => ({ ...prev, [field]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (!form.name.trim()) return alert('Nama pelanggan wajib diisi.')
                  upsertMutation.mutate({ ...form, id: editingId ?? undefined })
                }}
                disabled={upsertMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {upsertMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete customer?</h3>
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
                onClick={() => deleteMutation.mutate(deleteId)}
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