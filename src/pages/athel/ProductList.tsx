import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'

type Product = {
  id: string
  name: string
  sku: string
  size: string | null
  unit_price: number
}

type ProductForm = {
  name: string
  sku: string
  size: string
  unit_price: string
}

const EMPTY_FORM: ProductForm = { name: '', sku: '', size: '', unit_price: '' }

async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, size, unit_price')
    .order('name')
  if (error) throw error
  return data
}

async function upsertProduct(form: ProductForm & { id?: string }) {
  const payload = {
    name: form.name,
    sku: form.sku.toUpperCase(),
    size: form.size || null,
    unit_price: parseFloat(form.unit_price) || 0,
  }
  if (form.id) {
    const { error } = await supabase.from('products').update(payload).eq('id', form.id)
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

export default function ProductList() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  })

  const upsertMutation = useMutation({
    mutationFn: upsertProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setDeleteId(null)
    },
  })

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (p: Product) => {
    setEditingId(p.id)
    setForm({
      name: p.name,
      sku: p.sku,
      size: p.size ?? '',
      unit_price: p.unit_price.toString(),
    })
    setShowForm(true)
  }

  const filtered = products?.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase())
  )

  const deleteTarget = products?.find(p => p.id === deleteId)

  return (
    <div className="min-h-screen bg-gray-50">
      <AthelNav />

      <div className="px-4 md:px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Item List</h1>
            <p className="text-sm text-gray-500 mt-0.5">{products?.length ?? 0} items</p>
          </div>
          <button
            onClick={openCreate}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Add Item
          </button>
        </div>

        <input
          type="text"
          placeholder="Search by name or SKU..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full sm:w-72 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {isLoading && (
          <div className="text-gray-400 text-sm py-12 text-center">Loading...</div>
        )}

        {/* Desktop table */}
        {!isLoading && (
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">SKU</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Item Name</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Size</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Unit Price</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-400 py-12">
                      No items found.
                    </td>
                  </tr>
                )}
                {filtered?.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4 font-mono text-xs text-gray-500 uppercase">{p.sku}</td>
                    <td className="px-5 py-4 font-medium text-gray-900">{p.name}</td>
                    <td className="px-5 py-4 text-gray-600">{p.size ?? '—'}</td>
                    <td className="px-5 py-4 text-right text-gray-900 font-medium">
                      Rp {p.unit_price.toLocaleString('id-ID')}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => openEdit(p)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-4"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteId(p.id)}
                        className="text-red-400 hover:text-red-600 text-xs font-medium"
                      >
                        Delete
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
              <p className="text-center text-gray-400 py-12 text-sm">No items found.</p>
            )}
            {filtered?.map(p => (
              <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">{p.name}</p>
                    <p className="text-xs font-mono text-gray-400 uppercase mt-0.5">{p.sku}</p>
                  </div>
                  <div className="flex gap-3 shrink-0 ml-3">
                    <button
                      onClick={() => openEdit(p)}
                      className="text-blue-600 text-xs font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteId(p.id)}
                      className="text-red-400 text-xs font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mt-3 pt-3 border-t border-gray-100">
                  <div>
                    <p className="text-gray-400">Size</p>
                    <p className="text-gray-700 mt-0.5">{p.size ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Unit Price</p>
                    <p className="text-gray-900 font-semibold mt-0.5">
                      Rp {p.unit_price.toLocaleString('id-ID')}
                    </p>
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
              {editingId ? 'Edit Item' : 'New Item'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">SKU *</label>
                <input
                  type="text"
                  placeholder="e.g. SMN-001"
                  value={form.sku}
                  onChange={e => setForm(prev => ({ ...prev, sku: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Item Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Semen Portland"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Size</label>
                <input
                  type="text"
                  placeholder="e.g. 50kg, 1m², 2.4m"
                  value={form.size}
                  onChange={e => setForm(prev => ({ ...prev, size: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Unit Price (Rp) *</label>
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 85000"
                  value={form.unit_price}
                  onChange={e => setForm(prev => ({ ...prev, unit_price: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!form.sku.trim()) return alert('SKU is required.')
                  if (!form.name.trim()) return alert('Item name is required.')
                  if (!form.unit_price) return alert('Unit price is required.')
                  upsertMutation.mutate({ ...form, id: editingId ?? undefined })
                }}
                disabled={upsertMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {upsertMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
            {upsertMutation.isError && (
              <p className="text-red-500 text-xs mt-2 text-right">
                {(upsertMutation.error as Error).message.includes('unique')
                  ? 'That SKU already exists.'
                  : (upsertMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete item?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}