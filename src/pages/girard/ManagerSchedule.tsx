import { Button } from '../../components/ui/Button'
import { ActionLink } from '../../components/ui/ActionLink'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { Field } from '../../components/ui/Field'
import { FilterBar } from '../../components/ui/FilterBar'
import { FormActions } from '../../components/ui/FormActions'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Feedback'
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
  const [recoveredReceipt, setRecoveredReceipt] = useState<string | null>(null)
  const [validation, setValidation] = useState('')
  const dates = dateRange.includes(selectedDate) ? dateRange : [...dateRange, selectedDate]
  const [showForm, setShowForm] = useState(false)
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [initialForm, setInitialForm] = useState<ScheduleForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM)
  const [deleteVersion, setDeleteVersion] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [, refreshRecovery] = useState(0)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const deleteCommitted = useRef(false)
  const fallbackFocus = useRef<HTMLDivElement>(null)
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
      deleteCommitted.current = true
      queryClient.invalidateQueries()
      setDeleteId(null)
    },
  })

  const resetErrors = () => { createMutation.reset(); updateMutation.reset(); setValidation('') }
  const openCreate = (trigger: HTMLElement) => {
    if (createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || send.hasUnresolved()) return
    unsaved.confirmDiscard(() => {
      dialogTrigger.current = trigger
      setDeleteId(null)
      resetErrors()
      setEditingId(null)
      setInitialForm({ ...EMPTY_FORM, scheduled_date: selectedDate })
      setForm({ ...EMPTY_FORM, scheduled_date: selectedDate })
      setShowForm(true)
    })
  }

  const openEdit = (s: Schedule, trigger: HTMLElement) => {
    if (createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || send.hasUnresolved()) return
    unsaved.confirmDiscard(() => {
      dialogTrigger.current = trigger
      setDeleteId(null)
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
    })
  }

  const closeForm = () => {
    if (createMutation.isPending || updateMutation.isPending || send.hasUnresolved()) return
    unsaved.confirmDiscard(() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) })
  }
  const openDelete = (schedule: Schedule, trigger: HTMLElement) => {
    if (createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || send.hasUnresolved()) return
    unsaved.confirmDiscard(() => { dialogTrigger.current = trigger; deleteCommitted.current = false; setShowForm(false); setDeleteId(schedule.id); setDeleteVersion(schedule.version) })
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

  const saving = createMutation.isPending || updateMutation.isPending
  const locked = saving || send.hasUnresolved()
  const recovery = <TransactionRecovery send={send} onAbandoned={() => refreshRecovery(value => value + 1)} onCommitted={result => { if (deleteId) deleteCommitted.current = true; queryClient.invalidateQueries(); setShowForm(false); setDeleteId(null); setRecoveredReceipt(result.id) }} />
  const statusTone = (status: string) => status === 'completed' ? 'success' as const : status === 'missed' ? 'error' as const : 'warning' as const
  const statusLabel = (status: string) => status === 'completed' ? 'Selesai' : status === 'missed' ? 'Terlewat' : 'Menunggu kunjungan'

  if (customerReadError || teamReadError || scheduleReadError) return <div className="min-h-screen bg-brand-canvas"><GirardNav /><MainContent><ReadFailure onRetry={() => { void retryCustomers(); void retryTeam(); void retrySchedules() }} /></MainContent></div>

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      {unsaved.dialog}
      <MainContent>
        {!showForm && !deleteId && recovery}
        {recoveredReceipt && <Notice tone="success" className="m-4" title={`Operasi sebelumnya sudah tersimpan. Periksa hasil tersimpan (referensi ${recoveredReceipt}).`} actions={<Button size="compact" variant="quiet" onClick={() => setRecoveredReceipt(null)}>Tutup</Button>} />}
        <div ref={fallbackFocus} tabIndex={-1} className="bg-white border-b border-gray-200 px-4 md:px-8 py-5">
          <PageHeader title="Jadwal" description="Tugaskan kunjungan untuk tim Anda. Hanya jadwal sesuai akses Anda yang ditampilkan."
            actions={<Button disabled={locked || deleteMutation.isPending} onClick={event => openCreate(event.currentTarget)}>+ Kunjungan</Button>} />
        </div>
        <FilterBar label="Filter jadwal tim" className="mx-4 md:mx-8 my-4" summary={<p>Jadwal tim · {visitDateLabel(selectedDate)} · {personFilter ? team?.find(person => person.id === personFilter)?.full_name ?? 'Petugas dipilih (detail belum tersedia)' : managerFilter ? `Tim ${team?.find(person => person.id === managerFilter)?.full_name ?? 'manajer dipilih'}` : 'Semua petugas yang dapat Anda akses'} · {statusFilter ? 'Sudah dikunjungi' : 'Semua status'}</p>}>
          <Field id="manager-selected-date" label="Lihat tanggal">{control => <input {...control} type="date" value={selectedDate} onChange={e => { if (isVisitDate(e.target.value)) setSelectedDate(e.target.value) }} />}</Field>
          <Field id="manager-person-filter" label="Filter petugas">{control => <select {...control} value={personFilter} onChange={event => setPersonFilter(event.target.value)}><option value="">Semua petugas</option>{team?.map(person => <option key={person.id} value={person.id}>{visitAssigneeLabel(person, team)}</option>)}</select>}</Field>
          {(managerFilter || statusFilter || personFilter) && <Button size="compact" variant="quiet" onClick={() => { setPersonFilter(''); setManagerFilter(''); setStatusFilter('') }}>Hapus filter tim/petugas/status</Button>}
        </FilterBar>
        {saved && <Notice tone="success" className="mx-4 md:mx-8 mb-4" title={`Kunjungan tersimpan: ${saved.customer} · ${visitDateLabel(saved.date)}.`} actions={<ActionLink size="compact" variant="quiet" to={`/girard/visit/${saved.id}`}>Lihat kunjungan tersimpan</ActionLink>} />}
        <div className="bg-white border-b border-gray-100 px-4 md:px-8">
          <div className="flex items-start gap-1 overflow-x-auto">
            {weekDates.map((date, i) => {
              const daySchedules = scopedSchedules.filter(schedule => schedule.scheduled_date === date)
              const isSelected = selectedDate === date, d = parseCalendarDate(date)
              return <Button key={date} variant="quiet" aria-pressed={isSelected} onClick={() => setSelectedDate(date)}
                className={`flex-none w-max max-w-none flex-col whitespace-nowrap min-w-[100px] ${isSelected ? 'border-brand-primary text-brand-primary underline decoration-brand-primary underline-offset-4' : ''}`}>
                <span className="text-[13px] font-medium">{i === 0 ? 'Hari Ini' : i === 1 ? 'Besok' : d.toLocaleDateString('id-ID', { weekday: 'short' })}</span>
                <span className="text-lg font-semibold">{d.getDate()}</span>
                <span className="text-[13px] text-brand-secondary">{isLoading ? 'Memuat…' : `${daySchedules.length} kunjungan`}</span>
              </Button>
            })}
          </div>
          <Field id="manager-more-dates" label="Tanggal lainnya" className="w-full sm:w-56 py-3">{control => <select {...control} value={weekDates.includes(selectedDate) ? '' : selectedDate} onChange={e => e.target.value && setSelectedDate(e.target.value)}>
            <option value="">Tanggal lainnya...</option>{dates.slice(7).map(date => <option key={date} value={date}>{parseCalendarDate(date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}</option>)}
          </select>}</Field>
        </div>
        <div className="px-4 md:px-8 py-6">
          {isLoading && <Notice tone="info" title="Memuat jadwal..." />}
          {!isLoading && schedules.length === 0 && <EmptyState title={`Tidak ada kunjungan yang dijadwalkan untuk ${visitDateLabel(selectedDate)} pada filter ini.`} actions={<Button variant="secondary" disabled={locked || deleteMutation.isPending} onClick={event => openCreate(event.currentTarget)}>Tambahkan jadwal kunjungan baru +</Button>} />}
          {!isLoading && schedules.length > 0 && <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm" aria-label="Jadwal kunjungan tim">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-brand-secondary">Pelanggan</th><th className="text-left px-5 py-3 font-medium text-brand-secondary hidden md:table-cell">Lokasi</th><th className="text-left px-5 py-3 font-medium text-brand-secondary">Petugas kunjungan</th><th className="text-left px-5 py-3 font-medium text-brand-secondary hidden md:table-cell">Status</th><th className="text-right px-5 py-3 font-medium text-brand-secondary">Tindakan</th>
              </tr></thead>
              <tbody>{schedules.map(schedule => <tr key={schedule.id} className="border-b border-gray-100">
                <td className="px-5 py-4"><p className="font-medium text-gray-900">{schedule.customers?.name ?? '—'}</p>{schedule.notes && <p className="text-[13px] text-brand-secondary mt-1">{schedule.notes}</p>}</td>
                <td className="px-5 py-4 text-brand-secondary hidden md:table-cell">{schedule.customers?.city ?? '—'}</td><td className="px-5 py-4 text-gray-700">{schedule.users?.full_name ?? '—'}</td>
                <td className="px-5 py-4 hidden md:table-cell"><StatusBadge tone={statusTone(schedule.status)} className="[overflow-wrap:normal]">{statusLabel(schedule.status)}</StatusBadge></td>
                <td className="px-5 py-4"><FormActions><ActionLink size="compact" variant="quiet" to={`/girard/visit/${schedule.id}`}>Lihat rincian kunjungan</ActionLink>
                  {isEditable(schedule.scheduled_date, schedule.status) ? <><Button size="compact" variant="quiet" disabled={locked || deleteMutation.isPending} onClick={event => openEdit(schedule, event.currentTarget)}>Ubah</Button><Button size="compact" variant="danger-quiet" disabled={locked || deleteMutation.isPending} onClick={event => openDelete(schedule, event.currentTarget)}>Hapus</Button></> : <span className="text-[13px] text-brand-secondary">Terkunci</span>}
                </FormActions></td>
              </tr>)}</tbody>
            </table>
          </div>}
          {!isLoading && schedules.length > 0 && <div className="md:hidden space-y-3 mt-4">
            {schedules.map(schedule => <article key={schedule.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3"><div><h2 className="font-semibold text-gray-900">{schedule.customers?.name ?? '—'}</h2><p className="text-[13px] text-brand-secondary mt-1">{schedule.users?.full_name ?? '—'}</p></div><StatusBadge tone={statusTone(schedule.status)}>{statusLabel(schedule.status)}</StatusBadge></div>
              {schedule.notes && <p className="text-[13px] text-brand-secondary mb-3">{schedule.notes}</p>}
              <FormActions><ActionLink size="compact" variant="quiet" to={`/girard/visit/${schedule.id}`}>Lihat rincian kunjungan</ActionLink>{isEditable(schedule.scheduled_date, schedule.status) && <><Button size="compact" variant="quiet" disabled={locked || deleteMutation.isPending} onClick={event => openEdit(schedule, event.currentTarget)}>Ubah</Button><Button size="compact" variant="danger-quiet" disabled={locked || deleteMutation.isPending} onClick={event => openDelete(schedule, event.currentTarget)}>Hapus</Button></>}</FormActions>
              {!isEditable(schedule.scheduled_date, schedule.status) && <p className="text-[13px] text-brand-secondary mt-3">Terkunci karena bukti kunjungan sudah tersimpan.</p>}
            </article>)}
          </div>}
        </div>
        {/* The owner retains the draft while its shell yields to the discard dialog. */}
        {showForm && !unsaved.dialog && <Dialog labelledBy="manager-schedule-form-title" pending={locked} onClose={closeForm} returnFocus={dialogTrigger.current} fallbackFocus={() => fallbackFocus.current}>
          <h2 id="manager-schedule-form-title" className="ui-dialog__title">{editingId ? 'Ubah jadwal kunjungan' : 'Tugaskan kunjungan'}</h2>
          {recovery}
          <fieldset disabled={locked} className="py-4 space-y-4">
            <VisitCustomerSelect customers={customers ?? []} value={form.outlet_id} onChange={outlet_id => { resetErrors(); setForm(previous => ({ ...previous, outlet_id })) }} disabled={locked} />
            {!customers?.length && <p className="text-[13px] text-brand-secondary">Belum ada toko/customer yang ditugaskan kepada Anda. Hubungi Head of Sales.</p>}
            <Field id="manager-schedule-assignee" label="Petugas kunjungan *">{control => <select {...control} aria-label="Petugas kunjungan" value={form.sales_person_id} onChange={e => setForm(p => ({ ...p, sales_person_id: e.target.value }))}><option value="">Pilih anggota team sales anda...</option>{team?.map(person => <option key={person.id} value={person.id}>{visitAssigneeLabel(person, team ?? [])}</option>)}</select>}</Field>
            {!team?.length && <p className="text-[13px] text-brand-secondary">Belum ada anggota tim sales yang ditugaskan kepada Anda. Hubungi Head of Sales.</p>}
            <Field id="manager-schedule-date" label="Tanggal *">{control => <input {...control} aria-label="Tanggal jadwal" type="date" value={form.scheduled_date} onChange={e => { resetErrors(); setForm(p => ({ ...p, scheduled_date: e.target.value })) }} disabled={locked} />}</Field>
            <Field id="manager-schedule-notes" label="Catatan (opsional)">{control => <textarea {...control} aria-label="Catatan jadwal" maxLength={2000} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="contoh: Fokus pada pengenalan produk precut untuk visit kali ini guna menaikkan penjualan. Jangan lupa follow up soal PO bulan lalu yang belum keluar2." />}</Field>
          </fieldset>
          <FormActions><Button variant="quiet" disabled={locked} onClick={closeForm}>Batal</Button><Button pending={saving} disabled={locked} onClick={handleSave}>{saving ? 'Menyimpan...' : editingId ? 'Simpan perubahan' : 'Tugaskan'}</Button></FormActions>
          {(validation || saveError) && <Notice tone="error" className="mt-4" title={validation || visitSaveError(saveError)}>{conflict && <><p>Detail jadwal hanya ditampilkan sesuai akses Anda. Jika tidak terlihat, hubungi manajer atau pilih tanggal lain.</p>{conflictSchedule && <ActionLink size="compact" variant="quiet" className="mt-3" to={`/girard/visit/${conflictSchedule.id}`}>Lihat jadwal yang sudah ada: {conflictSchedule.users?.full_name ?? 'Petugas kunjungan'} · {visitDateLabel(conflictSchedule.scheduled_date)}</ActionLink>}</>}</Notice>}
        </Dialog>}
        {deleteId && !unsaved.dialog && <Dialog labelledBy="manager-delete-schedule-title" pending={deleteMutation.isPending || send.hasUnresolved()} onClose={() => setDeleteId(null)} returnFocus={null} fallbackFocus={() => !deleteCommitted.current && dialogTrigger.current?.isConnected ? dialogTrigger.current : fallbackFocus.current}>
          <h2 id="manager-delete-schedule-title" className="ui-dialog__title">Hapus jadwal kunjungan?</h2>
          {recovery}
          <p className="ui-dialog__description">Hapus <strong>{deleteTarget?.customers?.name}</strong> dari jadwal <strong>{deleteTarget?.users?.full_name}</strong> pada tanggal <strong>{deleteTarget?.scheduled_date}</strong>?</p>
          <FormActions className="mt-5"><Button variant="quiet" disabled={deleteMutation.isPending || send.hasUnresolved()} onClick={() => setDeleteId(null)}>Batal</Button><Button variant="danger" pending={deleteMutation.isPending} disabled={send.hasUnresolved()} onClick={() => deleteMutation.mutate()}>{deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}</Button></FormActions>
          {deleteMutation.error && <Notice tone="error" className="mt-4" title={visitSaveError(deleteMutation.error)} />}
        </Dialog>}
      </MainContent>
    </div>
  )
}

