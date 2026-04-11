import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type Customer = {
  id: string
  name: string
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  last_visit_date: string | null
  visit_frequency_days: number
}

type Manager = {
  id: string
  full_name: string
}

type Assignment = {
  customer_id: string
  manager_id: string
  managers: { id: string; full_name: string }
}

type CustomerForm = {
  name: string
  address: string
  city: string
  phone: string
  email: string
  visit_frequency_days: number
  manager_id: string
}

const EMPTY_FORM: CustomerForm = {
  name: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  visit_frequency_days: 7,
  manager_id: '',
}

const FREQUENCY_OPTIONS = [
  { label: '2x per week', days: 3 },
  { label: '1x per week', days: 7 },
  { label: '1x per 2 weeks', days: 14 },
  { label: '2x per month', days: 15 },
  { label: '1x per month', days: 30 },
]

async function fetchAllCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, address, city, phone, email, last_visit_date, visit_frequency_days')
    .order('name')
  if (error) throw error
  return data
}

async function fetchManagers(): Promise<Manager[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name')
    .in('role', ['sales_manager', 'sales_head', 'executive'])
    .eq('is_active', true)
    .order('full_name')
  if (error) throw error
  return data
}

async function fetchAssignments(): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from('customer_manager_assignments')
    .select('customer_id, manager_id, managers:users!customer_manager_assignments_manager_id_fkey(id, full_name)')
  if (error) throw error
  return data as Assignment[]
}

async function createCustomer(form: CustomerForm, assignedBy: string) {
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .insert({
      name: form.name,
      address: form.address || null,
      city: form.city || null,
      phone: form.phone || null,
      email: form.email || null,
      visit_frequency_days: form.visit_frequency_days,
    })
    .select()
    .single()
  if (customerError) throw customerError

  if (form.manager_id) {
    const { error: assignError } = await supabase
      .from('customer_manager_assignments')
      .insert({
        customer_id: customer.id,
        manager_id: form.manager_id,
        assigned_by: assignedBy,
      })
    if (assignError) throw assignError
  }
}

async function assignExistingCustomer(
  customerId: string,
  managerId: string,
  frequencyDays: number,
  assignedBy: string
) {
  // Update visit frequency
  await supabase
    .from('customers')
    .update({ visit_frequency_days: frequencyDays })
    .eq('id', customerId)

  // Upsert assignment
  const { error } = await supabase
    .from('customer_manager_assignments')
    .upsert({
      customer_id: customerId,
      manager_id: managerId,
      assigned_by: assignedBy,
      assigned_at: new Date().toISOString(),
    }, { onConflict: 'customer_id' })
  if (error) throw error
}

async function updateAssignment(
  customerId: string,
  managerId: string,
  frequencyDays: number,
  assignedBy: string
) {
  await supabase
    .from('customers')
    .update({ visit_frequency_days: frequencyDays })
    .eq('id', customerId)

  if (managerId) {
    await supabase
      .from('customer_manager_assignments')
      .upsert({
        customer_id: customerId,
        manager_id: managerId,
        assigned_by: assignedBy,
        assigned_at: new Date().toISOString(),
      }, { onConflict: 'customer_id' })
  } else {
    await supabase
      .from('customer_manager_assignments')
      .delete()
      .eq('customer_id', customerId)
  }
}

function isOverdue(lastVisit: string | null, frequencyDays: number): boolean {
  if (!lastVisit) return true
  const diff = (Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24)
  return diff > frequencyDays
}

function frequencyLabel(days: number): string {
  const match = FREQUENCY_OPTIONS.find(f => f.days === days)
  return match ? match.label : `Every ${days} days`
}

export default function GirardCustomers() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'assign-existing' | 'edit'>('create')
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM)
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null)

  // For assign-existing flow
  const [selectedExistingId, setSelectedExistingId] = useState('')
  const [existingFrequency, setExistingFrequency] = useState(7)
  const [existingManagerId, setExistingManagerId] = useState('')

  const { data: customers, isLoading } = useQuery({
    queryKey: ['all_customers'],
    queryFn: fetchAllCustomers,
  })

  const { data: managers } = useQuery({
    queryKey: ['managers_list'],
    queryFn: fetchManagers,
  })

  const { data: assignments } = useQuery({
    queryKey: ['assignments'],
    queryFn: fetchAssignments,
  })

  const assignmentMap = Object.fromEntries(
    (assignments ?? []).map(a => [a.customer_id, a])
  )

  const unassignedCustomers = customers?.filter(c => !assignmentMap[c.id]) ?? []

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await createCustomer(form, user.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_customers'] })
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      closeModal()
    },
  })

  const assignExistingMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await assignExistingCustomer(selectedExistingId, existingManagerId, existingFrequency, user.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_customers'] })
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await updateAssignment(editingCustomerId!, form.manager_id, form.visit_frequency_days, user.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_customers'] })
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      closeModal()
    },
  })

  const closeModal = () => {
    setShowModal(false)
    setForm(EMPTY_FORM)
    setEditingCustomerId(null)
    setSelectedExistingId('')
    setExistingFrequency(7)
    setExistingManagerId('')
  }

  const openEdit = (c: Customer) => {
    const assignment = assignmentMap[c.id]
    setEditingCustomerId(c.id)
    setForm({
      ...EMPTY_FORM,
      visit_frequency_days: c.visit_frequency_days,
      manager_id: assignment?.manager_id ?? '',
    })
    setModalMode('edit')
    setShowModal(true)
  }

  const filtered = customers?.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.city?.toLowerCase().includes(search.toLowerCase())
  )

  const isPending = createMutation.isPending || assignExistingMutation.isPending || updateMutation.isPending
  const isError = createMutation.isError || assignExistingMutation.isError || updateMutation.isError
  const errorMessage = ((createMutation.error || assignExistingMutation.error || updateMutation.error) as Error)?.message

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{customers?.length ?? 0} total customers</p>
        </div>
        <div className="flex gap-2">
          {unassignedCustomers.length > 0 && (
            <button
              onClick={() => { setModalMode('assign-existing'); setShowModal(true) }}
              className="border border-green-600 text-green-600 hover:bg-green-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Assign Existing
            </button>
          )}
          <button
            onClick={() => { setModalMode('create'); setShowModal(true) }}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New Customer
          </button>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6">
        <input
          type="text"
          placeholder="Search by name or city..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full sm:w-80 mb-4 focus:outline-none focus:ring-2 focus:ring-green-500"
        />

        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Loading customers...</div>
        )}

        {/* Desktop table */}
        {!isLoading && (
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Customer</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Location</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Assigned Manager</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Visit Frequency</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Last Visit</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-gray-400 py-12">No customers found.</td>
                  </tr>
                )}
                {filtered?.map(c => {
                  const assignment = assignmentMap[c.id]
                  const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days)
                  return (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <p className="font-medium text-gray-900">{c.name}</p>
                        {c.phone && <p className="text-xs text-gray-400 mt-0.5">{c.phone}</p>}
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-xs">
                        {[c.address, c.city].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-5 py-4">
                        {assignment
                          ? <span className="text-gray-900">{assignment.managers?.full_name}</span>
                          : <span className="text-xs text-gray-300">Unassigned</span>
                        }
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-xs">
                        {frequencyLabel(c.visit_frequency_days)}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-gray-600'}`}>
                          {c.last_visit_date
                            ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                            : 'Never'}
                          {overdue && ' ⚠'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openEdit(c)}
                          className="text-green-600 hover:text-green-800 text-xs font-medium"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile cards */}
        {!isLoading && (
          <div className="md:hidden space-y-3">
            {filtered?.map(c => {
              const assignment = assignmentMap[c.id]
              const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days)
              return (
                <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{c.name}</p>
                      {c.city && <p className="text-xs text-gray-400 mt-0.5">{c.city}</p>}
                    </div>
                    <button
                      onClick={() => openEdit(c)}
                      className="text-green-600 text-xs font-medium ml-3 shrink-0"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">Manager</p>
                      <p className="text-gray-700 mt-0.5">{assignment?.managers?.full_name ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Frequency</p>
                      <p className="text-gray-700 mt-0.5">{frequencyLabel(c.visit_frequency_days)}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-gray-400">Last Visit</p>
                      <p className={`mt-0.5 ${overdue ? 'text-red-500 font-medium' : 'text-gray-700'}`}>
                        {c.last_visit_date
                          ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                          : 'Never'}
                        {overdue && ' ⚠'}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {modalMode === 'create' ? 'New Customer'
                  : modalMode === 'assign-existing' ? 'Assign Existing Customer'
                  : 'Edit Customer Assignment'}
              </h3>
            </div>

            <div className="px-6 py-4 space-y-4">

              {/* CREATE NEW */}
              {modalMode === 'create' && (
                <>
                  {[
                    { label: 'Customer Name *', field: 'name', placeholder: 'e.g. Toko Bangunan Maju' },
                    { label: 'Address', field: 'address', placeholder: 'e.g. Jl. Sudirman No. 12' },
                    { label: 'City', field: 'city', placeholder: 'e.g. Jakarta' },
                    { label: 'Phone', field: 'phone', placeholder: 'e.g. 021-5551234' },
                    { label: 'Email', field: 'email', placeholder: 'e.g. toko@example.com' },
                  ].map(({ label, field, placeholder }) => (
                    <div key={field}>
                      <label className="block text-sm text-gray-600 mb-1">{label}</label>
                      <input
                        type="text"
                        placeholder={placeholder}
                        value={form[field as keyof CustomerForm] as string}
                        onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Visit Frequency *</label>
                    <select
                      value={form.visit_frequency_days}
                      onChange={e => setForm(p => ({ ...p, visit_frequency_days: parseInt(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      {FREQUENCY_OPTIONS.map(f => (
                        <option key={f.days} value={f.days}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      Assign to Manager <span className="text-gray-400">(optional)</span>
                    </label>
                    <select
                      value={form.manager_id}
                      onChange={e => setForm(p => ({ ...p, manager_id: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">No manager yet</option>
                      {managers?.map(m => (
                        <option key={m.id} value={m.id}>{m.full_name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* ASSIGN EXISTING */}
              {modalMode === 'assign-existing' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Select Customer *</label>
                    <select
                      value={selectedExistingId}
                      onChange={e => setSelectedExistingId(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">Select customer...</option>
                      {unassignedCustomers.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">
                      Only showing customers not yet assigned to a manager.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Visit Frequency *</label>
                    <select
                      value={existingFrequency}
                      onChange={e => setExistingFrequency(parseInt(e.target.value))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      {FREQUENCY_OPTIONS.map(f => (
                        <option key={f.days} value={f.days}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Assign to Manager *</label>
                    <select
                      value={existingManagerId}
                      onChange={e => setExistingManagerId(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">Select manager...</option>
                      {managers?.map(m => (
                        <option key={m.id} value={m.id}>{m.full_name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* EDIT */}
              {modalMode === 'edit' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Visit Frequency</label>
                    <select
                      value={form.visit_frequency_days}
                      onChange={e => setForm(p => ({ ...p, visit_frequency_days: parseInt(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      {FREQUENCY_OPTIONS.map(f => (
                        <option key={f.days} value={f.days}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Assigned Manager</label>
                    <select
                      value={form.manager_id}
                      onChange={e => setForm(p => ({ ...p, manager_id: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">Unassigned</option>
                      {managers?.map(m => (
                        <option key={m.id} value={m.id}>{m.full_name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (modalMode === 'create') {
                    if (!form.name.trim()) return alert('Customer name is required.')
                    createMutation.mutate()
                  } else if (modalMode === 'assign-existing') {
                    if (!selectedExistingId) return alert('Please select a customer.')
                    if (!existingManagerId) return alert('Please select a manager.')
                    assignExistingMutation.mutate()
                  } else {
                    updateMutation.mutate()
                  }
                }}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {isPending ? 'Saving...' : modalMode === 'create' ? 'Create' : modalMode === 'assign-existing' ? 'Assign' : 'Save'}
              </button>
            </div>

            {isError && (
              <p className="text-red-500 text-xs px-6 pb-4 text-right">{errorMessage}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}