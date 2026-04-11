import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import IHRNav from '../../components/IHRNav'

type UserProfile = {
  id: string
  full_name: string
  email: string
  role: string
  phone: string | null
  birth_date: string | null
  is_active: boolean
  manager_id: string | null
  invited_at: string | null
}

type UserForm = {
  full_name: string
  email: string
  role: string
  phone: string
  birth_date: string
  manager_id: string
}

const EMPTY_FORM: UserForm = {
  full_name: '',
  email: '',
  role: 'sales_person',
  phone: '',
  birth_date: '',
  manager_id: '',
}

const ROLES = [
  { value: 'po_admin',      label: 'PO Admin' },
  { value: 'sales_person',  label: 'Sales Person' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'sales_head',    label: 'Sales Head' },
  { value: 'executive',     label: 'Executive' },
]

const ROLE_STYLES: Record<string, string> = {
  po_admin:      'bg-blue-100 text-blue-700',
  sales_person:  'bg-gray-100 text-gray-700',
  sales_manager: 'bg-purple-100 text-purple-700',
  sales_head:    'bg-orange-100 text-orange-700',
  executive:     'bg-green-100 text-green-700',
}

async function fetchUsers(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, phone, birth_date, is_active, manager_id, invited_at')
    .order('full_name')
  if (error) throw error
  return data
}

async function updateUser(payload: {
  id: string
  full_name: string
  role: string
  phone: string | null
  birth_date: string | null
  manager_id: string | null
  is_active: boolean
}) {
  const { error } = await supabase
    .from('users')
    .update({
      full_name: payload.full_name,
      role: payload.role,
      phone: payload.phone,
      birth_date: payload.birth_date,
      manager_id: payload.manager_id,
      is_active: payload.is_active,
    })
    .eq('id', payload.id)
  if (error) throw error
}

async function inviteUser(
  payload: UserForm,
  accessToken: string
) {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        email: payload.email,
        full_name: payload.full_name,
        role: payload.role,
        phone: payload.phone || null,
        birth_date: payload.birth_date || null,
        manager_id: payload.manager_id || null,
      }),
    }
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Failed to invite user')
  return data
}

export default function UserManagement() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null)
  const [form, setForm] = useState<UserForm>(EMPTY_FORM)
  const [deactivateId, setDeactivateId] = useState<string | null>(null)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })

  const managers = users?.filter(u =>
    (u.role === 'sales_manager' || u.role === 'sales_head' || u.role === 'executive') && u.is_active
  ) ?? []

  const updateMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setEditingUser(null)
      setForm(EMPTY_FORM)
    },
  })

  const inviteMutation = useMutation({
    mutationFn: async (payload: UserForm) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      return inviteUser(payload, session.access_token)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const user = users?.find(u => u.id === id)
      if (!user) return
      await updateUser({ ...user, is_active: false })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDeactivateId(null)
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const user = users?.find(u => u.id === id)
      if (!user) return
      await updateUser({ ...user, is_active: true })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const openCreate = () => {
    setEditingUser(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (u: UserProfile) => {
    setEditingUser(u)
    setForm({
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      phone: u.phone ?? '',
      birth_date: u.birth_date ?? '',
      manager_id: u.manager_id ?? '',
    })
    setShowForm(true)
  }

  const handleSave = () => {
    if (!form.full_name.trim()) return alert('Full name is required.')
    if (!form.email.trim()) return alert('Email is required.')

    if (editingUser) {
      updateMutation.mutate({
        id: editingUser.id,
        full_name: form.full_name,
        role: form.role,
        phone: form.phone || null,
        birth_date: form.birth_date || null,
        manager_id: form.manager_id || null,
        is_active: editingUser.is_active,
      })
    } else {
      inviteMutation.mutate(form)
    }
  }

  const filtered = users?.filter(u => {
    const matchSearch =
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    return matchSearch && matchRole
  })

  const deactivateTarget = users?.find(u => u.id === deactivateId)

  const needsManager = ['sales_person', 'sales_manager', 'sales_head'].includes(form.role)

  return (
    <div className="min-h-screen bg-gray-50">
      <IHRNav />

      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">User Management</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {users?.filter(u => u.is_active).length ?? 0} active users
            </p>
          </div>
          <button
            onClick={openCreate}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Invite User
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All roles</option>
            {ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {isLoading && (
          <div className="text-gray-400 text-sm py-12 text-center">Loading users...</div>
        )}

        {!isLoading && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Name</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Email</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Role</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Manager</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Status</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-gray-400 py-12">
                      No users found.
                    </td>
                  </tr>
                )}
                {filtered?.map(u => {
                  const manager = users?.find(m => m.id === u.manager_id)
                  return (
                    <tr
                      key={u.id}
                      className={`border-b border-gray-50 transition-colors ${
                        u.is_active ? 'hover:bg-gray-50' : 'opacity-50 bg-gray-50'
                      }`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center shrink-0">
                            {u.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{u.full_name}</p>
                            <p className="text-xs text-gray-400 md:hidden">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-600 hidden md:table-cell">{u.email}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_STYLES[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                          {ROLES.find(r => r.value === u.role)?.label ?? u.role}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-600 hidden md:table-cell">
                        {manager?.full_name ?? '—'}
                      </td>
                      <td className="px-5 py-4 hidden md:table-cell">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          u.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openEdit(u)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3"
                        >
                          Edit
                        </button>
                        {u.is_active ? (
                          <button
                            onClick={() => setDeactivateId(u.id)}
                            className="text-red-400 hover:text-red-600 text-xs font-medium"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivateMutation.mutate(u.id)}
                            className="text-green-600 hover:text-green-800 text-xs font-medium"
                          >
                            Reactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {editingUser ? 'Edit User' : 'Invite New User'}
              </h3>
              {!editingUser && (
                <p className="text-xs text-gray-400 mt-0.5">
                  An email will be sent to the user to set their password.
                </p>
              )}
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
                  placeholder="e.g. Budi Santoso"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="budi@company.com"
                  disabled={!!editingUser}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
                {editingUser && (
                  <p className="text-xs text-gray-400 mt-1">Email cannot be changed after invitation.</p>
                )}
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Role *</label>
                <select
                  value={form.role}
                  onChange={e => setForm(p => ({ ...p, role: e.target.value, manager_id: '' }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {needsManager && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Assigned To <span className="text-gray-400">(optional)</span>
                  </label>
                  <select
                    value={form.manager_id}
                    onChange={e => setForm(p => ({ ...p, manager_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">No manager assigned</option>
                    {managers.map(m => (
                      <option key={m.id} value={m.id}>{m.full_name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Phone <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="e.g. 0812-3456-7890"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Birth Date <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={form.birth_date}
                    onChange={e => setForm(p => ({ ...p, birth_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setShowForm(false); setEditingUser(null); setForm(EMPTY_FORM) }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={inviteMutation.isPending || updateMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {inviteMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingUser ? 'Save Changes' : 'Send Invite'}
              </button>
            </div>

            {(inviteMutation.isError || updateMutation.isError) && (
              <p className="text-red-500 text-xs px-6 pb-4 text-right">
                {((inviteMutation.error || updateMutation.error) as Error)?.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Deactivate confirmation */}
      {deactivateId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Deactivate user?</h3>
            <p className="text-sm text-gray-500 mb-5">
              <strong>{deactivateTarget?.full_name}</strong> will no longer be able to log in.
              You can reactivate them at any time.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeactivateId(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deactivateMutation.mutate(deactivateId)}
                disabled={deactivateMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deactivateMutation.isPending ? 'Deactivating...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}