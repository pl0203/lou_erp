import VisitCustomerSelect from '../../components/VisitCustomerSelect'
import { isVisitDate, visitDateLabel, visitAssigneeLabel, isVisitScheduleConflict, visitSaveError } from '../../lib/visitUsability'
import TransactionRecovery from '../../components/TransactionRecovery'
import { useVisitPlanningSender } from '../../lib/visitTransactions'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import ReadFailure from '../../components/ReadFailure'
import { readCompleteQuery } from '../../lib/reads/completeQuery'
import { chunkIds } from '../../lib/reads/completeReads'
import { calendarDateKey, parseCalendarDate, calendarDayOptions } from '../../lib/calendarDate'
import { singleRelation } from '../../lib/relations'
import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useSearchParams } from 'react-router-dom'
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
  role?: string
  manager_id?: string | null
}

type Schedule = {
  version: number
  id: string
  outlet_id: string
  sales_person_id: string
  scheduled_date: string
  status: string
  notes: string | null
  customers: { id: string; name: string; city: string | null }
  users: { id: string; full_name: string }
  outlet_visits?: { id: string }[]
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
  scheduled_date: calendarDateKey(),
  notes: '',
}

export function isEditable(_scheduledDate: string, status = 'pending'): boolean {
  return status !== 'completed'
}

async function fetchMyCustomers(_managerId: string, role: string, signal?: AbortSignal): Promise<Customer[]> {
  if (role === 'sales_head' || role === 'executive') {
    const data = await readCompleteQuery((offset, limit) => supabase.from('customers')
      .select('id, name, city, address, last_visit_date, visit_frequency_days', { count: 'exact' })
      .order('id').range(offset, offset + limit - 1), row => row.id, signal)
    return data.sort((a, b) => a.name.localeCompare(b.name))
  }
  const data = await readCompleteQuery((offset, limit) => supabase.from('customer_manager_assignments')
    .select('id, customers(id, name, city, address, last_visit_date, visit_frequency_days)', { count: 'exact' })
    .order('id').range(offset, offset + limit - 1), row => row.id, signal)
  return data.map(row => singleRelation(row.customers)).filter((row): row is Customer => row !== null).sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchMyTeam(managerId: string, role: string, signal?: AbortSignal): Promise<SalesPerson[]> {
  if (role === 'executive' || role === 'sales_head') {
    const roles = role === 'executive' ? ['sales_head', 'sales_manager', 'sales_person', 'executive'] : ['sales_manager', 'sales_person', 'sales_head']
    const data = await readCompleteQuery((offset, limit) => supabase.from('users').select('id, full_name, role, manager_id', { count: 'exact' })
      .in('role', roles).eq('is_active', true).order('id').range(offset, offset + limit - 1), row => row.id, signal)
    return data.sort((a, b) => a.full_name.localeCompare(b.full_name))
  }
  const team = await readCompleteQuery((offset, limit) => supabase.from('users').select('id, full_name, role, manager_id', { count: 'exact' })
    .eq('manager_id', managerId).eq('is_active', true).order('id').range(offset, offset + limit - 1), row => row.id, signal)
  let selfQuery = supabase.from('users').select('id, full_name, role, manager_id').eq('id', managerId)
  if (signal) selfQuery = selfQuery.abortSignal(signal)
  const { data: self, error } = await selfQuery.single()
  if (error) throw error
  return [self, ...team.filter(row => row.id !== managerId).sort((a, b) => a.full_name.localeCompare(b.full_name))]
}

async function fetchSchedules(_managerId: string, role: string, dates: string[], signal?: AbortSignal): Promise<Schedule[]> {
  const read = (ids?: string[]) => readCompleteQuery((offset, limit) => {
    let query = supabase.from('sales_schedules')
      .select('id, version, outlet_id, sales_person_id, scheduled_date, status, notes, created_at, outlet_visits(id), customers!sales_schedules_outlet_id_fkey(id, name, city), users!sales_schedules_sales_person_id_fkey(id, full_name)', { count: 'exact' })
      .in('scheduled_date', dates).order('scheduled_date').order('created_at').order('id').range(offset, offset + limit - 1)
    if (ids) query = query.in('outlet_id', ids)
    return query
  }, row => row.id, signal)
  let rows: Awaited<ReturnType<typeof read>> = []
  if (role === 'sales_head' || role === 'executive') rows = await read()
  else {
    const assignments = await readCompleteQuery((offset, limit) => supabase.from('customer_manager_assignments')
      .select('id, customer_id', { count: 'exact' }).order('id').range(offset, offset + limit - 1), row => row.id, signal)
    for (const ids of chunkIds(assignments.map(row => row.customer_id))) rows.push(...await read(ids))
    rows.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id))
  }
  return rows.map(row => ({ ...row, customers: singleRelation(row.customers), users: singleRelation(row.users) }))
}

export function getNext30Days(): string[] {
  return calendarDayOptions(31)
}

export default function ManagerSchedule() {
  const { profile } = useAuth()
  return <ManagerScheduleContent key={`${profile?.id}:${profile?.role}`} />
}
function ManagerScheduleContent() {
  const { profile } = useAuth()
  const send = useVisitPlanningSender('manager-schedule')
  const writeBusy = useRef(false)
  const write = async (operation: string, payload: unknown) => {
    if (writeBusy.current) throw new Error('Permintaan masih diproses.')
    writeBusy.current = true
    try { return await send(operation, payload) } finally { writeBusy.current = false }
  }
  const queryClient = useQueryClient()
  const dateRange = getNext30Days()

  const [params] = useSearchParams()
  const [selectedDate, setSelectedDate] = useState(() => isVisitDate(params.get('date') ?? '') ? params.get('date')! : dateRange[0])
  const [personFilter, setPersonFilter] = useState(params.get('person') ?? '')
  const [managerFilter, setManagerFilter] = useState(params.get('manager') ?? '')
  const [statusFilter, setStatusFilter] = useState(params.get('status') === 'visited' ? 'visited' : '')
  const [saved, setSaved] = useState<{ id: string; date: string; customer: string } | null>(null)
  const [validation, setValidation] = useState('')
  const dates = dateRange.includes(selectedDate) ? dateRange : [...dateRange, selectedDate]
  const [showForm, setShowForm] = useState(false)
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [initialForm, setInitialForm] = useState<ScheduleForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM)
  const [deleteVersion, setDeleteVersion] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const unsaved = useUnsavedChanges(showForm && JSON.stringify(form) !== JSON.stringify(initialForm))

  const { data: customers, isError: customerReadError, refetch: retryCustomers } = useQuery({
    queryKey: ['manager_customers', profile?.id, profile?.role],
    queryFn: ({ signal }) => fetchMyCustomers(profile!.id, profile!.role, signal),
    enabled: !!profile?.id,
  })

  const { data: team, isError: teamReadError, refetch: retryTeam } = useQuery({
    queryKey: ['manager_team', profile?.id, profile?.role],
    queryFn: ({ signal }) => fetchMyTeam(profile!.id, profile!.role, signal),
    enabled: !!profile?.id,
  })

  const { data: allSchedules, isLoading, isError: scheduleReadError, refetch: retrySchedules } = useQuery({
    queryKey: ['manager_schedules', profile?.id, profile?.role, dates],
    queryFn: ({ signal }) => fetchSchedules(profile!.id, profile!.role, dates, signal),
    enabled: !!profile?.id,
  })

  const scopedSchedules = allSchedules?.filter(s => (!personFilter || s.sales_person_id === personFilter) && (!managerFilter || s.sales_person_id === managerFilter || team?.find(person => person.id === s.sales_person_id)?.manager_id === managerFilter) && (!statusFilter || !!s.outlet_visits?.length)) ?? []
  const schedules = scopedSchedules.filter(schedule => schedule.scheduled_date === selectedDate)
  const saveConfirmed = (result: { id: string }) => {
    setSaved({ id: result.id, date: form.scheduled_date, customer: customers?.find(customer => customer.id === form.outlet_id)?.name ?? 'Pelanggan' })
    setSelectedDate(form.scheduled_date)
    queryClient.invalidateQueries()
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const createMutation = useMutation({
    mutationFn: () => write('create_schedule', { customer_id: form.outlet_id, sales_person_id: form.sales_person_id, scheduled_date: form.scheduled_date, notes: form.notes }),
    onSuccess: saveConfirmed,
  })

  const updateMutation = useMutation({
    mutationFn: () => write('edit_schedule', { schedule_id: editingId, expected_version: editingVersion, customer_id: form.outlet_id, sales_person_id: form.sales_person_id, scheduled_date: form.scheduled_date, notes: form.notes }),
    onSuccess: saveConfirmed,
  })

  const deleteMutation = useMutation({
    mutationFn: () => write('delete_schedule', { schedule_id: deleteId, expected_version: deleteVersion }),
    onSuccess: () => {
      queryClient.invalidateQueries()
      setDeleteId(null)
    },
  })

  const resetErrors = () => { createMutation.reset(); updateMutation.reset(); setValidation('') }
  const openCreate = () => {
    resetErrors()
    setEditingId(null)
    setInitialForm({ ...EMPTY_FORM, scheduled_date: selectedDate })
    setForm({ ...EMPTY_FORM, scheduled_date: selectedDate })
    setShowForm(true)
  }

  const openEdit = (s: Schedule) => {
    resetErrors()
    setEditingId(s.id)
    setEditingVersion(s.version)
    setInitialForm({ outlet_id: s.outlet_id, sales_person_id: s.sales_person_id, scheduled_date: s.scheduled_date, notes: s.notes ?? '' })
    setForm({
      outlet_id: s.outlet_id,
      sales_person_id: s.sales_person_id,
      scheduled_date: s.scheduled_date,
      notes: s.notes ?? '',
    })
    setShowForm(true)
  }

  const handleSave = () => {
    if (createMutation.isPending || updateMutation.isPending || send.hasUnresolved()) return
    if (!form.outlet_id) return setValidation('Pilih pelanggan terlebih dahulu.')
    if (!form.sales_person_id) return setValidation('Pilih petugas kunjungan terlebih dahulu.')
    if (!isVisitDate(form.scheduled_date)) return setValidation('Pilih tanggal kunjungan yang valid.')
    setValidation('')
    if (editingId) {
      updateMutation.mutate()
    } else {
      createMutation.mutate()
    }
  }

  const saveError = createMutation.error || updateMutation.error
  const conflict = isVisitScheduleConflict(saveError)
  const conflictSchedule = conflict ? allSchedules?.find(schedule => schedule.outlet_id === form.outlet_id && schedule.scheduled_date === form.scheduled_date && schedule.id !== editingId) : undefined
  const deleteTarget = allSchedules?.find(s => s.id === deleteId)

  // Group dates by week for the date picker tabs
  const weekDates = dates.slice(0, 7)

  if (customerReadError || teamReadError || scheduleReadError) return <div className="min-h-screen bg-brand-canvas"><GirardNav /><ReadFailure onRetry={() => { void retryCustomers(); void retryTeam(); void retrySchedules() }} /></div>

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      {unsaved.dialog}
      <TransactionRecovery send={send} onCommitted={() => { queryClient.invalidateQueries(); setShowForm(false); setDeleteId(null) }} />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Jadwal</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Tugaskan kunjungan untuk tim Anda. Hanya jadwal sesuai akses Anda yang ditampilkan.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-brand-primary hover:bg-brand-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Kunjungan
        </button>
      </div>

      <label className="block px-4 pt-4">Lihat tanggal <input type="date" value={selectedDate} onChange={e => { if (isVisitDate(e.target.value)) setSelectedDate(e.target.value) }} /></label>
      <div className="px-4 md:px-8 py-3 space-y-2">
        <p className="text-sm text-gray-700">Jadwal tim · {visitDateLabel(selectedDate)} · {personFilter ? team?.find(person => person.id === personFilter)?.full_name ?? 'Petugas dipilih (detail belum tersedia)' : managerFilter ? `Tim ${team?.find(person => person.id === managerFilter)?.full_name ?? 'manajer dipilih'}` : 'Semua petugas yang dapat Anda akses'} · {statusFilter ? 'Sudah dikunjungi' : 'Semua status'}</p>
        <label className="text-sm text-gray-700">Filter petugas <select aria-label="Filter petugas" value={personFilter} onChange={event => setPersonFilter(event.target.value)} className="rounded border p-2"><option value="">Semua petugas</option>{team?.map(person => <option key={person.id} value={person.id}>{visitAssigneeLabel(person, team)}</option>)}</select></label>
        {(managerFilter || statusFilter || personFilter) && <button className="ml-3 text-sm underline" onClick={() => { setPersonFilter(''); setManagerFilter(''); setStatusFilter('') }}>Hapus filter tim/petugas/status</button>}
        {saved && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm"><p>Kunjungan tersimpan: {saved.customer} · {visitDateLabel(saved.date)}.</p><a className="underline" href={`/girard/visit/${saved.id}`}>Lihat kunjungan tersimpan</a></div>}
      </div>
      {/* Date tabs — next 7 days */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-8">
        <div className="flex gap-1 overflow-x-auto">
          {weekDates.map((date, i) => {
            const daySchedules = scopedSchedules.filter(schedule => schedule.scheduled_date === date)
            const isSelected = selectedDate === date
            const d = parseCalendarDate(date)
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`flex flex-col items-center px-4 py-3 border-b-2 transition-colors whitespace-nowrap min-w-[70px] ${
                  isSelected
                    ? 'border-brand-accent text-brand-primary underline decoration-brand-primary underline-offset-4'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="text-xs font-medium">
                  {i === 0 ? 'Hari Ini' : i === 1 ? 'Besok' : d.toLocaleDateString('id-ID', { weekday: 'short' })}
                </span>
                <span className="text-lg font-semibold mt-0.5">{d.getDate()}</span>
                <span className={`text-xs mt-0.5 ${isSelected ? 'text-green-500' : 'text-gray-400'}`}>
                  {daySchedules.length} kunjungan
                </span>
              </button>
            )
          })}
          {/* More dates dropdown */}
          <div className="flex items-center ml-2">
            <select
              value={weekDates.includes(selectedDate) ? '' : selectedDate}
              onChange={e => e.target.value && setSelectedDate(e.target.value)}
              className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-primary"
            >
              <option value="">Tanggal lainnya...</option>
              {dates.slice(7).map(date => (
                <option key={date} value={date}>
                  {parseCalendarDate(date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
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
        <p className="text-gray-400 text-sm">Tidak ada kunjungan yang dijadwalkan untuk {visitDateLabel(selectedDate)} pada filter ini.</p>
        <button
        onClick={openCreate}
        className="mt-4 min-h-11 cursor-pointer rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-brand-primary transition-colors hover:bg-brand-tint"
        >
        Tambahkan jadwal kunjungan baru +
        </button>
    </div>
    )}

        {!isLoading && schedules.length > 0 && (
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Pelanggan</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Lokasi</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Petugas kunjungan</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Status</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => {
                  const editable = isEditable(s.scheduled_date, s.status)
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
                          {s.status === 'completed' ? 'Selesai' : s.status === 'missed' ? 'Terlewat' : 'Menunggu kunjungan'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <a className="mr-2 inline-block py-2 text-xs font-semibold text-brand-primary underline" href={`/girard/visit/${s.id}`}>Lihat rincian kunjungan</a>
                        {editable ? (
                          <>
                            <button
                              onClick={() => openEdit(s)}
                              className="min-h-10 cursor-pointer rounded-lg border border-gray-300 px-3 py-2 text-brand-primary hover:bg-brand-tint text-xs font-semibold mr-2"
                            >
                              Ubah
                            </button>
                            <button
                              onClick={() => { setDeleteId(s.id); setDeleteVersion(s.version) }}
                              className="min-h-10 cursor-pointer rounded-lg border border-red-200 px-3 py-2 text-red-700 hover:bg-red-50 text-xs font-semibold"
                            >
                              Hapus
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-gray-300">Terkunci</span>
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
              const editable = isEditable(s.scheduled_date, s.status)
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
                      {s.status === 'completed' ? 'Selesai' : s.status === 'missed' ? 'Terlewat' : 'Menunggu kunjungan'}
                    </span>
                  </div>
                  <a className="mb-2 inline-block text-sm font-semibold text-brand-primary underline" href={`/girard/visit/${s.id}`}>Lihat rincian kunjungan</a>
                  {s.notes && (
                    <p className="text-xs text-gray-400 mb-2">{s.notes}</p>
                  )}
                  {editable && (
                    <div className="flex gap-2 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => openEdit(s)}
                        className="flex-1 text-center text-brand-primary text-xs font-medium py-2 rounded-lg bg-blue-50"
                      >
                        Ubah
                      </button>
                      <button
                        onClick={() => { setDeleteId(s.id); setDeleteVersion(s.version) }}
                        className="flex-1 text-center text-red-500 text-xs font-medium py-2 rounded-lg bg-red-50"
                      >
                        Hapus
                      </button>
                    </div>
                  )}
                  {!editable && (
                    <p className="text-xs text-gray-300 mt-2 pt-2 border-t border-gray-100">
                      Terkunci karena bukti kunjungan sudah tersimpan.
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
                {editingId ? 'Ubah jadwal kunjungan' : 'Tugaskan kunjungan'}
              </h3>
            </div>
            <fieldset disabled={createMutation.isPending || updateMutation.isPending || send.hasUnresolved()} className="px-6 py-4 space-y-4">
              <div>
                <VisitCustomerSelect customers={customers ?? []} value={form.outlet_id} onChange={outlet_id => { resetErrors(); setForm(previous => ({ ...previous, outlet_id })) }} disabled={createMutation.isPending || updateMutation.isPending || send.hasUnresolved()} />
                {!customers?.length && (
                  <p className="text-xs text-orange-500 mt-1">
                    Belum ada toko/customer yang ditugaskan kepada Anda. Hubungi Head of Sales.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Petugas kunjungan *</label>
                <select aria-label="Petugas kunjungan"
                  value={form.sales_person_id}
                  onChange={e => setForm(p => ({ ...p, sales_person_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                >
                  <option value="">Pilih anggota team sales anda...</option>
                  {team?.map(sp => (
                    <option key={sp.id} value={sp.id}>{visitAssigneeLabel(sp, team ?? [])}</option>
                  ))}
                </select>
                {!team?.length && (
                  <p className="text-xs text-orange-500 mt-1">
                    Belum ada anggota tim sales yang ditugaskan kepada Anda. Hubungi Head of Sales.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Tanggal *</label>
                <input type="date" aria-label="Tanggal jadwal"
                  value={form.scheduled_date}
                  onChange={e => { resetErrors(); setForm(p => ({ ...p, scheduled_date: e.target.value })) }}
                  disabled={createMutation.isPending || updateMutation.isPending || send.hasUnresolved()}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Catatan <span className="text-gray-600">(opsional)</span>
                </label>
                <textarea aria-label="Catatan jadwal"
                  maxLength={2000}
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  placeholder="contoh: Fokus pada pengenalan produk precut untuk visit kali ini guna menaikkan penjualan. Jangan lupa follow up soal PO bulan lalu yang belum keluar2."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary resize-none"
                />
              </div>
            </fieldset>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                disabled={createMutation.isPending || updateMutation.isPending}
                onClick={() => unsaved.confirmDiscard(() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) })}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending || send.hasUnresolved()}
                className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-hover disabled:opacity-50"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Menyimpan...'
                  : editingId ? 'Simpan perubahan' : 'Tugaskan'}
              </button>
            </div>
            {(validation || saveError) && <div role="alert" className="px-6 pb-4 text-sm text-red-700">
              <p>{validation || visitSaveError(saveError)}</p>
              {conflict && <><p className="mt-1">Detail jadwal hanya ditampilkan sesuai akses Anda. Jika tidak terlihat, hubungi manajer atau pilih tanggal lain.</p>{conflictSchedule && <a className="mt-2 inline-block underline" href={`/girard/visit/${conflictSchedule.id}`}>Lihat jadwal yang sudah ada: {conflictSchedule.users?.full_name ?? 'Petugas kunjungan'} · {visitDateLabel(conflictSchedule.scheduled_date)}</a>}</>}
            </div>}
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
                disabled={deleteMutation.isPending || send.hasUnresolved()}
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
