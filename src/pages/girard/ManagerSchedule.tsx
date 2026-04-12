import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import GirardNav from '../../components/GirardNav'

type Customer = {
  id: string
  name: string
  city: string | null
  address: string | null
  last_visit_date: string | null
  visit_frequency_days: number
}

type SalesPerson = {
  id: string
  full_name: string
}

type Schedule = {
  id: string
  outlet_id: string
  sales_person_id: string
  scheduled_date: string
  status: string
  notes: string | null
  customers: { id: string; name: string; city: string | null }
  users: { id: string; full_name: string }
}

type ScheduleForm = {
  outlet_id: string
  sales_person_id: string
  scheduled_date: string
  notes: string
}

const EMPTY_FORM: ScheduleForm = {
  outlet_id: '',
  sales_person_id: '',
  scheduled_date: new Date().toISOString().split('T')[0],
  notes: '',
}

function getDateOptions(): { value: string; label: string }[] {
    const options = []
    const today = new Date()
    for (let i = 0; i <= 30; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const value = d.toISOString().split('T')[0]
      const label = d.toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long'
      })
      options.push({ value, label })
    }
    return options
  }

function isEditable(scheduledDate: string): boolean {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const schedDate = new Date(scheduledDate)
    schedDate.setHours(0, 0, 0, 0)
    // Can only edit schedules that are more than 1 day from now (i.e. from day after tomorrow onwards)
    return schedDate > new Date(today.getTime() + 24 * 60 * 60 * 1000)
  }

  async function fetchMyCustomers(managerId: string, role: string): Promise<Customer[]> {
    // Sales head and executive can see all customers
    if (role === 'sales_head' || role === 'executive') {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, city, address, last_visit_date, visit_frequency_days')
        .order('name')
      if (error) throw error
      return data
    }
  
    // Sales manager only sees their assigned customers
    const { data, error } = await supabase
      .from('customer_manager_assignments')
      .select('customers(id, name, city, address, last_visit_date, visit_frequency_days)')
      .eq('manager_id', managerId)
    if (error) throw error
    return (data ?? []).map((d: any) => d.customers).filter(Boolean)
  }

async function fetchMyTeam(managerId: string, role: string): Promise<SalesPerson[]> {
  // Executive can assign anyone except other executives
  if (role === 'executive') {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name')
      .in('role', ['sales_head', 'sales_manager', 'sales_person', 'executive'])
      .eq('is_active', true)
      .order('full_name')
    if (error) throw error
    return data
  }

  // Sales head can assign sales managers and sales persons (not executives)
  if (role === 'sales_head') {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name')
      .in('role', ['sales_manager', 'sales_person', 'sales_head'])
      .eq('is_active', true)
      .order('full_name')
    if (error) throw error
    return data
  }

  // Sales manager — their own team + themselves
  const { data: teamMembers, error: teamError } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('manager_id', managerId)
    .eq('is_active', true)
    .order('full_name')
  if (teamError) throw teamError

  const { data: self, error: selfError } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('id', managerId)
    .single()
  if (selfError) throw selfError

  const others = (teamMembers ?? []).filter(m => m.id !== managerId)
  return [self, ...others]
}

async function fetchSchedules(managerId: string, role: string, dates: string[]): Promise<Schedule[]> {
  let customerIds: string[] = []

  if (role === 'sales_head' || role === 'executive') {
    // See all schedules
    const { data, error } = await supabase
      .from('sales_schedules')
      .select(`
        id, outlet_id, sales_person_id, scheduled_date, status, notes,
        customers!sales_schedules_outlet_id_fkey(id, name, city),
        users!sales_schedules_sales_person_id_fkey(id, full_name)
      `)
      .in('scheduled_date', dates)
      .order('scheduled_date')
      .order('created_at')
    if (error) throw error
    return data as Schedule[]
  }

  // Sales manager — only their assigned customers
  const { data: assignments } = await supabase
    .from('customer_manager_assignments')
    .select('customer_id')
    .eq('manager_id', managerId)
  customerIds = (assignments ?? []).map((a: any) => a.customer_id)
  if (customerIds.length === 0) return []

  const { data, error } = await supabase
    .from('sales_schedules')
    .select(`
      id, outlet_id, sales_person_id, scheduled_date, status, notes,
      customers!sales_schedules_outlet_id_fkey(id, name, city),
      users!sales_schedules_sales_person_id_fkey(id, full_name)
    `)
    .in('outlet_id', customerIds)
    .in('scheduled_date', dates)
    .order('scheduled_date')
    .order('created_at')
  if (error) throw error
  return data as Schedule[]
}

async function updateSchedule(id: string, form: Partial<ScheduleForm>) {
  const { error } = await supabase
    .from('sales_schedules')
    .update({
      sales_person_id: form.sales_person_id,
      notes: form.notes || null,
    })
    .eq('id', id)
  if (error) throw error
}

async function deleteSchedule(id: string) {
  const { error } = await supabase
    .from('sales_schedules')
    .delete()
    .eq('id', id)
  if (error) throw error
}

function getNext30Days(): string[] {
  return Array.from({ length: 31 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

export default function ManagerSchedule() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const dateOptions = getDateOptions()
  const dates = getNext30Days()

  const [selectedDate, setSelectedDate] = useState(dates[0])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: customers } = useQuery({
    queryKey: ['manager_customers', profile?.id, profile?.role],
    queryFn: () => fetchMyCustomers(profile!.id, profile!.role),
    enabled: !!profile?.id,
  })

  const { data: team } = useQuery({
    queryKey: ['manager_team', profile?.id, profile?.role],
    queryFn: () => fetchMyTeam(profile!.id, profile!.role),
    enabled: !!profile?.id,
  })

  const { data: allSchedules, isLoading } = useQuery({
    queryKey: ['manager_schedules', profile?.id, profile?.role, dates],
    queryFn: () => fetchSchedules(profile!.id, profile!.role, dates),
    enabled: !!profile?.id,
  })

  const schedules = allSchedules?.filter(s => s.scheduled_date === selectedDate) ?? []

  const navigate = useNavigate()

  const createMutation = useMutation({
    mutationFn: () => createSchedule(form, profile!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager_schedules'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
      if (form.sales_person_id === profile?.id) {
        navigate('/girard/my-visits')
      }
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => updateSchedule(editingId!, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager_schedules'] })
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSchedule(deleteId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager_schedules'] })
      setDeleteId(null)
    },
  })

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, scheduled_date: selectedDate })
    setShowForm(true)
  }

  const openEdit = (s: Schedule) => {
    setEditingId(s.id)
    setForm({
      outlet_id: s.outlet_id,
      sales_person_id: s.sales_person_id,
      scheduled_date: s.scheduled_date,
      notes: s.notes ?? '',
    })
    setShowForm(true)
  }

  const handleSave = () => {
    if (!form.outlet_id) return alert('Please select a customer.')
    if (!form.sales_person_id) return alert('Please select a sales person.')
    if (!form.scheduled_date) return alert('Please select a date.')
    if (editingId) {
      updateMutation.mutate()
    } else {
      createMutation.mutate()
    }
  }

  const deleteTarget = allSchedules?.find(s => s.id === deleteId)

  // Group dates by week for the date picker tabs
  const weekDates = dates.slice(0, 7)

  return (
    <div className="min-h-screen bg-gray-50">
      <GirardNav />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Jadwal</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Tugaskan kunjungan untuk tim anda
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Kunjungan
        </button>
      </div>

      {/* Date tabs — next 7 days */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1 overflow-x-auto">
          {weekDates.map((date, i) => {
            const daySchedules = allSchedules?.filter(s => s.scheduled_date === date) ?? []
            const isSelected = selectedDate === date
            const d = new Date(date)
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`flex flex-col items-center px-4 py-3 border-b-2 transition-colors whitespace-nowrap min-w-[70px] ${
                  isSelected
                    ? 'border-green-600 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="text-xs font-medium">
                  {i === 0 ? 'Hari Ini' : i === 1 ? 'Besok' : d.toLocaleDateString('id-ID', { weekday: 'short' })}
                </span>
                <span className="text-lg font-semibold mt-0.5">{d.getDate()}</span>
                <span className={`text-xs mt-0.5 ${isSelected ? 'text-green-500' : 'text-gray-400'}`}>
                  {daySchedules.length} visit{daySchedules.length !== 1 ? 's' : ''}
                </span>
              </button>
            )
          })}
          {/* More dates dropdown */}
          <div className="flex items-center ml-2">
            <select
              value={weekDates.includes(selectedDate) ? '' : selectedDate}
              onChange={e => e.target.value && setSelectedDate(e.target.value)}
              className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">Tanggal lainnya...</option>
              {dates.slice(7).map(date => (
                <option key={date} value={date}>
                  {new Date(date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6">
        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat jadwal...</div>
        )}

    {!isLoading && schedules.length === 0 && (
    <div className="text-center py-24">
        <p className="text-gray-400 text-sm">Tidak ada kunjungan yang dijadwalkan untuk hari ini.</p>
        <button
        onClick={openCreate}
        className="mt-3 text-green-600 text-sm font-medium hover:text-green-800"
        >
        Tambahkan jadwal kunjungan baru +
        </button>
    </div>
    )}

        {!isLoading && schedules.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Pelanggan</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Lokasi</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Sales Person</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Status</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => {
                  const editable = isEditable(s.scheduled_date)
                  return (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-medium text-gray-900">{s.customers?.name ?? '—'}</p>
                        {s.notes && (
                          <p className="text-xs text-gray-400 mt-0.5">{s.notes}</p>
                        )}
                      </td>
                      <td className="px-5 py-4 text-gray-500 hidden md:table-cell text-xs">
                        {s.customers?.city ?? '—'}
                      </td>
                      <td className="px-5 py-4 text-gray-700">{s.users?.full_name ?? '—'}</td>
                      <td className="px-5 py-4 hidden md:table-cell">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                          s.status === 'completed' ? 'bg-green-100 text-green-700'
                          : s.status === 'missed' ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {editable ? (
                          <>
                            <button
                              onClick={() => openEdit(s)}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3"
                            >
                              Ubah
                            </button>
                            <button
                              onClick={() => setDeleteId(s.id)}
                              className="text-red-400 hover:text-red-600 text-xs font-medium"
                            >
                              Hapus
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-gray-300">Locked</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile cards */}
        {!isLoading && schedules.length > 0 && (
          <div className="md:hidden space-y-3 mt-4">
            {schedules.map(s => {
              const editable = isEditable(s.scheduled_date)
              return (
                <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{s.customers?.name ?? '—'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{s.users?.full_name ?? '—'}</p>
                    </div>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium capitalize ${
                      s.status === 'completed' ? 'bg-green-100 text-green-700'
                      : s.status === 'missed' ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {s.status}
                    </span>
                  </div>
                  {s.notes && (
                    <p className="text-xs text-gray-400 mb-2">{s.notes}</p>
                  )}
                  {editable && (
                    <div className="flex gap-2 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => openEdit(s)}
                        className="flex-1 text-center text-blue-600 text-xs font-medium py-2 rounded-lg bg-blue-50"
                      >
                        Ubah
                      </button>
                      <button
                        onClick={() => setDeleteId(s.id)}
                        className="flex-1 text-center text-red-500 text-xs font-medium py-2 rounded-lg bg-red-50"
                      >
                        Hapus
                      </button>
                    </div>
                  )}
                  {!editable && (
                    <p className="text-xs text-gray-300 mt-2 pt-2 border-t border-gray-100">
                      Terkunci — tidak bisa diubah karena sudah dekat dengan tanggal kunjungan.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {editingId ? 'Edit Schedule' : 'Assign Visit'}
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Pelanggan *</label>
                <select
                  value={form.outlet_id}
                  onChange={e => setForm(p => ({ ...p, outlet_id: e.target.value }))}
                  disabled={!!editingId}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">Pilih Pelanggan...</option>
                  {customers?.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {!customers?.length && (
                  <p className="text-xs text-orange-500 mt-1">
                    Belum ada toko/customer yang ditugaskan kepada Anda. Hubungi Head of Sales.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Sales Person *</label>
                <select
                  value={form.sales_person_id}
                  onChange={e => setForm(p => ({ ...p, sales_person_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Pilih anggota team sales anda...</option>
                  {team?.map(sp => (
                    <option key={sp.id} value={sp.id}>{sp.full_name}</option>
                  ))}
                </select>
                {!team?.length && (
                  <p className="text-xs text-orange-500 mt-1">
                    Belum ada anggota tim sales yang ditugaskan kepada Anda. Hubungi Head of Sales.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Date *</label>
                <select
                  value={form.scheduled_date}
                  onChange={e => setForm(p => ({ ...p, scheduled_date: e.target.value }))}
                  disabled={!!editingId}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-400"
                >
                {dateOptions.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
                ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                    Penjadwalan untuk hari ini dan besok tidak bisa diubah setelah berhasil dibuat.
                </p>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Notes <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  placeholder="contoh: Fokus pada pengenalan produk precut untuk visit kali ini guna menaikkan penjualan. Jangan lupa follow up soal PO bulan lalu yang belum keluar2."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingId ? 'Save Changes' : 'Assign'}
              </button>
            </div>
            {(createMutation.isError || updateMutation.isError) && (
              <p className="text-red-500 text-xs px-6 pb-4 text-right">
                {((createMutation.error || updateMutation.error) as Error)?.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Hapus jadwal kunjungan?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Hapus <strong>{deleteTarget?.customers?.name}</strong> dari{' '} jadwal
              <strong>{deleteTarget?.users?.full_name}</strong> pada tanggal{' '}
              <strong>{deleteTarget?.scheduled_date}</strong>?
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
                {deleteMutation.isPending ? 'Sedang menghapus...' : 'Telah dihapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}