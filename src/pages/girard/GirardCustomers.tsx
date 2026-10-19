import { LoadingState } from '../../components/ui/LoadingState'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FilterBar } from '../../components/ui/FilterBar'
import { FormActions } from '../../components/ui/FormActions'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, StatusBadge } from '../../components/ui/Feedback'
import { RecordList } from '../../components/ui/RecordList'
import { SummaryList } from '../../components/ui/SummaryList'
import { MainContent } from '../../components/ui/MainContent'
import CustomerPricingHelp from '../../components/CustomerPricingHelp'
import { hasInvalidCustomerCategories } from '../../lib/customerCategoryRows'
import CustomerCategorySelect from '../../components/CustomerCategorySelect'
import { parseCustomerCategory, formatCustomerCategory, type CustomerCategory } from '../../lib/customerCategory'
import { confirmCustomerWrite, refreshCustomerCaches } from '../../lib/customerWrites'
import ReadFailure from '../../components/ReadFailure'
import { readCompleteQuery } from '../../lib/reads/completeQuery'
import { singleRelation } from '../../lib/relations'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
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
  pricing_tier: string
  customer_category: CustomerCategory | null
}

type Manager = {
  id: string
  full_name: string
}

type Assignment = {
  id: string
  version: number
  customer_id: string
  manager_id: string | null
  managers: { id: string; full_name: string } | null
}

type CustomerForm = {
  name: string
  address: string
  city: string
  phone: string
  email: string
  visit_frequency_days: number
  manager_id: string
  pricing_tier: string
  customer_category: CustomerCategory | null | ''
}

const EMPTY_FORM: CustomerForm = {
  name: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  visit_frequency_days: 7,
  manager_id: '',
  pricing_tier: 'luar_kota',
  customer_category: '',
}

const FREQUENCY_OPTIONS = [
  { label: '2x per minggu', days: 3 },
  { label: '1x per minggu', days: 7 },
  { label: '1x per 2 minggu', days: 14 },
  { label: '2x per bulan', days: 15 },
  { label: '1x per bulan', days: 30 },
]

const TIER_LABELS: Record<string, string> = {
  harga_pokok:   'Harga Pokok',
  luar_kota:     'Luar Kota',
  dalam_kota:    'Dalam Kota',
  depo_bangunan: 'Depo Bangunan',
  others: 'Others',
}

function frequencyLabel(days: number): string {
  const match = FREQUENCY_OPTIONS.find(f => f.days === days)
  return match ? match.label : `Setiap ${days} hari`
}

function isOverdue(lastVisit: string | null, frequencyDays: number): boolean {
  if (!lastVisit) return true
  const diff = (Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24)
  return diff > frequencyDays
}

async function fetchAllCustomers(signal?: AbortSignal): Promise<Customer[]> {
  const data = await readCompleteQuery((offset, limit) => supabase
    .from('customers')
    .select('id, name, address, city, phone, email, last_visit_date, visit_frequency_days, pricing_tier, customer_category', { count: 'exact' })
    .order('id')
    .range(offset, offset + limit - 1), row => row.id, signal)
  return data.map(row => ({ ...row, customer_category: parseCustomerCategory(row.customer_category, { allowUnclassified: true }) })).sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchManagers(signal?: AbortSignal): Promise<Manager[]> {
  const data = await readCompleteQuery((offset, limit) => supabase
    .from('users')
    .select('id, full_name', { count: 'exact' })
    .in('role', ['sales_person', 'sales_manager', 'sales_head', 'executive'])
    .eq('is_active', true)
    .order('id')
    .range(offset, offset + limit - 1), row => row.id, signal)
  return data.sort((a, b) => a.full_name.localeCompare(b.full_name))
}

async function fetchAssignments(signal?: AbortSignal): Promise<Assignment[]> {
  const data = await readCompleteQuery((offset, limit) => supabase.from('customer_manager_assignments')
    .select('id, version, customer_id, manager_id, managers:users!customer_manager_assignments_manager_id_fkey(id, full_name)', { count: 'exact' })
    .order('id').range(offset, offset + limit - 1), row => row.id, signal)
  return data.map(row => ({ ...row, managers: singleRelation(row.managers) }))
}

async function saveAssignment(customerId: string, managerId: string, original: Assignment | null) {
  if (managerId === (original?.manager_id ?? '')) return
  await confirmCustomerWrite(async () => {
    if (original && (!original.id || !Number.isSafeInteger(original.version) || original.version < 1)) {
      throw new Error('Versi penugasan tidak tersedia. Tutup formulir dan muat ulang data.')
    }
    const { data, error } = await supabase.rpc('pilot_assign_store_owner_v1', {
      p_customer_id: customerId,
      p_owner_id: managerId || null,
      p_expected_assignment_id: original?.id ?? null,
      p_expected_version: original?.version ?? null,
    })
    if (error?.code === '40001') throw new Error('Penanggung Jawab Toko telah berubah. Tutup formulir dan muat ulang sebelum mencoba lagi.')
    if (error) throw error
    const validAssignment = typeof data?.id === 'string' && data.id.length > 0 && Number.isSafeInteger(data.version) &&
      data.version === (original?.version ?? 0) + 1 && (!original || data.id === original.id)
    if (!validAssignment || data?.manager_id !== (managerId || null)) throw new Error('Respons tidak mengonfirmasi penugasan yang dituju.')
    return { data: [data], error: null }
  }, { customer_id: customerId }, 'Penugasan Penanggung Jawab Toko')
}

async function saveCustomerAndAssignment(
  customerId: string, payload: Record<string, unknown>, create: boolean,
  managerId: string, originalAssignment: Assignment | null,
) {
  const customerChanged = create || Object.keys(payload).length > 0
  if (customerChanged) {
    await confirmCustomerWrite(() => create
      ? supabase.from('customers').insert({ id: customerId, ...payload }).select('id')
      : supabase.from('customers').update(payload).eq('id', customerId).select('id'), { id: customerId })
  }
  try {
    await saveAssignment(customerId, managerId, originalAssignment)
  } catch (error) {
    if (!customerChanged) throw error
    throw new Error(`Data pelanggan tersimpan (ID: ${customerId}). ${error instanceof Error ? error.message : 'Penugasan belum terkonfirmasi.'}`)
  }
}

function customerChanges(form: CustomerForm, original: Customer) {
  const category = parseCustomerCategory(form.customer_category, { allowUnclassified: true })
  const payload: Record<string, unknown> = {}
  if (category !== original.customer_category) payload.customer_category = category
  if (form.visit_frequency_days !== original.visit_frequency_days) payload.visit_frequency_days = form.visit_frequency_days
  if (form.pricing_tier !== original.pricing_tier) payload.pricing_tier = form.pricing_tier
  return payload
}

export default function GirardCustomers() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'assign-existing' | 'edit'>('create')
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM)
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null)
  const [originalCustomer, setOriginalCustomer] = useState<Customer | null>(null)
  const [originalAssignment, setOriginalAssignment] = useState<Assignment | null>(null)
  const dialogOpener = useRef<HTMLElement | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const writeBusy = useRef(false)
  const ownerChanged = useRef(false)
  const createCustomerId = useRef<string | null>(null)
  const [createNeedsReview, setCreateNeedsReview] = useState(false)

  const [selectedExistingId, setSelectedExistingId] = useState('')
  const [existingFrequency, setExistingFrequency] = useState(7)
  const [existingManagerId, setExistingManagerId] = useState('')
  const [existingPricingTier, setExistingPricingTier] = useState('luar_kota')

  const { data: customers, isError: customerReadError, refetch: retryCustomers } = useQuery({
    queryKey: ['all_customers'],
    queryFn: ({ signal }) => fetchAllCustomers(signal),
  })

  const { data: managers, isError: managerReadError, refetch: retryManagers } = useQuery({
    queryKey: ['managers_list'],
    queryFn: ({ signal }) => fetchManagers(signal),
  })

  const { data: assignments, isError: assignmentReadError, refetch: retryAssignments } = useQuery({
    queryKey: ['assignments'],
    queryFn: ({ signal }) => fetchAssignments(signal),
  })

  const assignmentMap = Object.fromEntries(
    (assignments ?? []).map(a => [a.customer_id, a])
  )

  const unassignedCustomers = customers?.filter(c => !assignmentMap[c.id]?.manager_id) ?? []

  const settleWrite = async () => {
    try {
      await Promise.all([
        refreshCustomerCaches(queryClient, true),
        ...(ownerChanged.current ? ['manager_schedules', 'customer_performance', 'revenue', 'performance']
          .map(prefix => queryClient.invalidateQueries({ queryKey: [prefix] })) : []),
      ])
    } finally {
      writeBusy.current = false
      ownerChanged.current = false
    }
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Tidak terautentikasi')
      const category = parseCustomerCategory(form.customer_category)
      createCustomerId.current ??= crypto.randomUUID()
      try {
        await saveCustomerAndAssignment(createCustomerId.current, {
          name: form.name, address: form.address || null, city: form.city || null,
          phone: form.phone || null, email: form.email || null, visit_frequency_days: form.visit_frequency_days,
          pricing_tier: form.pricing_tier, customer_category: category,
        }, true, form.manager_id, null)
      } catch (error) {
        // Never create another identity or guess whether either write committed.
        setCreateNeedsReview(true)
        throw error
      }
    },
    onSettled: settleWrite,
    onSuccess: () => {
      // Refreshed authorization or concurrent edits can remove the old row.
      dialogOpener.current = null
      closeModal()
    },
  })

  const assignExistingMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Tidak terautentikasi')
      const original = customers?.find(c => c.id === selectedExistingId)
      if (!original) throw new Error('Pelanggan tidak tersedia. Muat ulang sebelum melanjutkan.')
      const payload: Record<string, unknown> = {}
      if (existingFrequency !== original.visit_frequency_days) payload.visit_frequency_days = existingFrequency
      if (existingPricingTier !== original.pricing_tier) payload.pricing_tier = existingPricingTier
      await saveCustomerAndAssignment(selectedExistingId, payload, false, existingManagerId, originalAssignment)
    },
    onSettled: settleWrite,
    onSuccess: () => {
      // Refreshed authorization or concurrent edits can remove the old row.
      dialogOpener.current = null
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Tidak terautentikasi')
      if (!originalCustomer) throw new Error('Pelanggan tidak tersedia. Muat ulang sebelum melanjutkan.')
      await saveCustomerAndAssignment(editingCustomerId!, customerChanges(form, originalCustomer), false,
        form.manager_id, originalAssignment)
    },
    onSettled: settleWrite,
    onSuccess: () => {
      // Refreshed authorization or concurrent edits can remove the old row.
      dialogOpener.current = null
      closeModal()
    },
  })

  const closeModal = () => {
    setShowModal(false)
    createMutation.reset(); assignExistingMutation.reset(); updateMutation.reset()
    setOriginalCustomer(null)
    setOriginalAssignment(null)
    createCustomerId.current = null
    setCreateNeedsReview(false)
    setForm(EMPTY_FORM)
    setEditingCustomerId(null)
    setSelectedExistingId('')
    setExistingFrequency(7)
    setExistingManagerId('')
    setExistingPricingTier('luar_kota')
  }

  const openEdit = (c: Customer, opener: HTMLElement) => {
    if (writeBusy.current) return
    dialogOpener.current = opener
    const assignment = assignmentMap[c.id]
    createMutation.reset(); assignExistingMutation.reset(); updateMutation.reset()
    setOriginalCustomer(c)
    setOriginalAssignment(assignment ? { ...assignment } : null)
    setEditingCustomerId(c.id)
    setForm({
      ...EMPTY_FORM,
      visit_frequency_days: c.visit_frequency_days,
      manager_id: assignment?.manager_id ?? '',
      pricing_tier: c.pricing_tier ?? 'others',
      customer_category: c.customer_category,
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

  const tierSelect = (value: string, onChange: (v: string) => void) => (
    <Field id="sales-customer-pricing-tier" label="Tier Harga" hint={<CustomerPricingHelp id="sales-customer-pricing-help" />}>
      {control => <select {...control} value={value} onChange={e => onChange(e.target.value)}>
        <option value="harga_pokok">Harga Pokok</option>
        <option value="luar_kota">Luar Kota</option>
        <option value="dalam_kota">Dalam Kota</option>
        <option value="depo_bangunan">Depo Bangunan</option>
        <option value="others">Others</option>
      </select>}
    </Field>
  )

  const readError = customerReadError || managerReadError || assignmentReadError || hasInvalidCustomerCategories(customers ?? [])
  const isLoading = customers === undefined && !customerReadError

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      <MainContent>
      {readError && <ReadFailure onRetry={() => { void retryCustomers(); void retryManagers(); void retryAssignments() }} />}

      <PageHeader title="Pelanggan" description={readError ? 'Jumlah pelanggan belum tersedia' : isLoading ? 'Memuat jumlah pelanggan…' : `${customers?.length ?? 0} total pelanggan`}
        className="bg-white border-b border-brand-divider px-4 md:px-8 py-5" actions={<>
          {!readError && unassignedCustomers.length > 0 && <Button variant="secondary"
            onClick={event => { if (writeBusy.current) return; dialogOpener.current = event.currentTarget; closeModal(); setModalMode('assign-existing'); setShowModal(true) }}
            disabled={isPending}>Tugaskan yang Ada</Button>}
          <Button onClick={event => { if (writeBusy.current) return; dialogOpener.current = event.currentTarget; closeModal(); setModalMode('create'); setShowModal(true) }}
            disabled={readError || isPending}>+ Pelanggan Baru</Button>
        </>} />

      <div className="px-4 md:px-8 py-6">
        <FilterBar label="Filter pelanggan" className="mb-4">
          <Field id="sales-customer-search" label="Cari pelanggan">
            {control => <input {...control} ref={searchInput} type="search" placeholder="Cari berdasarkan nama atau kota..."
              value={search} onChange={e => setSearch(e.target.value)} />}
          </Field>
        </FilterBar>

        {isLoading && (
          <LoadingState title="Memuat data pelanggan..." shape="list" />
        )}

        {!isLoading && !readError && filtered?.length === 0 && <EmptyState title="Tidak ada pelanggan ditemukan." />}

        {/* Desktop table */}
        {!isLoading && !readError && !!filtered?.length && (
          <div role="region" aria-label="Tabel pelanggan" tabIndex={0} className="hidden md:block bg-white rounded-[14px] border border-brand-divider overflow-x-auto">
            <p className="px-4 py-2 text-[13px] text-brand-secondary">Geser tabel untuk melihat semua kolom.</p>
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-brand-divider">
                  <th className="text-left px-5 py-3 font-medium text-brand-secondary">Pelanggan</th>
                  <th className="text-left px-5 py-3 font-medium text-brand-secondary">Lokasi</th>
                  <th className="text-left px-5 py-3 font-medium text-brand-secondary">Penanggung Jawab Toko</th>
                  <th className="text-left px-5 py-3 font-medium text-brand-secondary">Tier Harga</th>
                  <th className="text-left px-5 py-3 font-medium text-brand-secondary">Kategori Pelanggan</th>
                  <th className="text-left px-5 py-3 font-medium text-brand-secondary">Frekuensi Kunjungan</th>
                  <th className="text-left px-5 py-3 font-medium text-brand-secondary">Kunjungan Terakhir</th>
                  <th className="text-right px-5 py-3 font-medium text-brand-secondary">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered?.map(c => {
                  const assignment = assignmentMap[c.id]
                  const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days)
                  return (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <Link to={`/girard/customer/${c.id}`} className="inline-flex min-h-[var(--ui-control-size-compact)] items-center font-medium text-brand-primary underline decoration-brand-accent underline-offset-2 hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary [overflow-wrap:anywhere]">{c.name}</Link>
                        {c.phone && <p className="text-[13px] text-brand-secondary mt-0.5">{c.phone}</p>}
                      </td>
                      <td className="px-5 py-4 text-brand-secondary">
                        {[c.address, c.city].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-5 py-4">
                        {assignment?.manager_id
                          ? <span className="text-brand-primary">{assignment.managers?.full_name}</span>
                          : <span className="text-[13px] text-brand-secondary">Belum ditugaskan</span>
                        }
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge tone="neutral">{TIER_LABELS[c.pricing_tier] ?? c.pricing_tier}</StatusBadge>
                      </td>
                      <td className="px-5 py-4">{formatCustomerCategory(c.customer_category)}</td>
                      <td className="px-5 py-4 text-brand-secondary">
                        {frequencyLabel(c.visit_frequency_days)}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-[13px] ${overdue ? 'text-red-700 font-medium' : 'text-brand-secondary'}`}>
                          {c.last_visit_date
                            ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                            : 'Belum pernah'}
                          {overdue && ' ⚠'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Button size="compact" variant="quiet" onClick={event => openEdit(c, event.currentTarget)}>Ubah</Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile cards */}
        {!isLoading && !readError && !!filtered?.length && (
          <RecordList label="Pelanggan" className="md:hidden">
            {filtered?.map(c => {
              const assignment = assignmentMap[c.id]
              const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days)
              return (
                <li key={c.id} className="bg-white rounded-[14px] border border-brand-divider p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <Link to={`/girard/customer/${c.id}`} className="inline-flex min-h-[var(--ui-control-size-compact)] items-center font-semibold text-brand-primary text-base underline decoration-brand-accent underline-offset-2 hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary break-words [overflow-wrap:anywhere]">{c.name}</Link>
                      {c.city && <p className="text-[13px] text-brand-secondary mt-0.5">{c.city}</p>}
                    </div>
                    <Button size="compact" variant="quiet" onClick={event => openEdit(c, event.currentTarget)}>Ubah</Button>
                  </div>
                  <SummaryList items={[
                    { label: 'Kategori Pelanggan', value: formatCustomerCategory(c.customer_category) },
                    { label: 'Penanggung Jawab Toko', value: assignment?.managers?.full_name ?? '—' },
                    { label: 'Tier Harga', value: <StatusBadge tone="neutral">{TIER_LABELS[c.pricing_tier] ?? c.pricing_tier}</StatusBadge> },
                    { label: 'Frekuensi', value: frequencyLabel(c.visit_frequency_days) },
                    { label: 'Kunjungan Terakhir', value: <span className={overdue ? 'font-medium text-red-700' : undefined}>{c.last_visit_date ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : 'Belum pernah'}{overdue && ' ⚠'}</span> },
                  ]} />
                </li>
              )
            })}
          </RecordList>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <Dialog labelledBy="sales-customer-dialog-title" pending={isPending} onClose={() => { if (!writeBusy.current) closeModal() }}
          returnFocus={null} fallbackFocus={() => dialogOpener.current?.isConnected ? dialogOpener.current : searchInput.current}>
            <div className="pb-4 border-b border-brand-divider">
              <h2 id="sales-customer-dialog-title" className="ui-dialog__title">
                {modalMode === 'create' ? 'Pelanggan Baru'
                  : modalMode === 'assign-existing' ? 'Tugaskan Pelanggan yang Ada'
                  : 'Ubah Penugasan Pelanggan'}
              </h2>
            </div>

            <fieldset disabled={isPending} className="py-4 space-y-4 [&_select]:border-brand-control-border [&_p]:text-[13px]">
              {modalMode !== 'assign-existing' && <CustomerCategorySelect value={form.customer_category}
                allowUnclassified={modalMode === 'edit' && originalCustomer?.customer_category === null}
                onChange={value => setForm(p => ({ ...p, customer_category: value }))} />}

              {/* CREATE */}
              {modalMode === 'create' && (
                <>
                  {[
                    { label: 'Nama Pelanggan *', field: 'name', placeholder: 'mis. Toko Bangunan Maju' },
                    { label: 'Alamat', field: 'address', placeholder: 'mis. Jl. Sudirman No. 12' },
                    { label: 'Kota', field: 'city', placeholder: 'mis. Jakarta' },
                    { label: 'Telepon', field: 'phone', placeholder: 'mis. 021-5551234' },
                    { label: 'Email', field: 'email', placeholder: 'mis. toko@example.com' },
                  ].map(({ label, field, placeholder }) => (
                    <Field key={field} id={`sales-customer-${field}`} label={label}>
                      {control => <input {...control} type="text" placeholder={placeholder}
                        value={form[field as keyof CustomerForm] as string}
                        onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))} />}
                    </Field>
                  ))}
                  <Field id="sales-customer-frequency" label="Frekuensi Kunjungan">{control => <select {...control} value={form.visit_frequency_days} onChange={e => setForm(p => ({ ...p, visit_frequency_days: parseInt(e.target.value) }))}>
                    {FREQUENCY_OPTIONS.map(f => <option key={f.days} value={f.days}>{f.label}</option>)}
                  </select>}</Field>
                  {tierSelect(form.pricing_tier, v => setForm(p => ({ ...p, pricing_tier: v })))}
                  <Field id="sales-customer-owner" label="Penanggung Jawab Toko" hint="Opsional untuk pelanggan baru.">
                    {control => <select {...control} value={form.manager_id} onChange={e => setForm(p => ({ ...p, manager_id: e.target.value }))}>
                      <option value="">Belum ditugaskan</option>
                      {managers?.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>}
                  </Field>
                </>
              )}

              {/* ASSIGN EXISTING */}
              {modalMode === 'assign-existing' && (
                <>
                  <Field id="sales-customer-existing" label="Pilih Pelanggan" hint="Hanya menampilkan pelanggan yang belum ditugaskan ke penanggung jawab toko.">
                    {control => <select {...control}
                      value={selectedExistingId}
                      onChange={e => {
                        setSelectedExistingId(e.target.value)
                        const assignment = assignmentMap[e.target.value]
                        setOriginalAssignment(assignment ? { ...assignment } : null)
                        const customer = customers?.find(c => c.id === e.target.value)
                        if (customer) { setExistingFrequency(customer.visit_frequency_days); setExistingPricingTier(customer.pricing_tier) }
                      }}
                    >
                      <option value="">Pilih pelanggan...</option>
                      {(customers ?? []).filter(c => !assignmentMap[c.id]?.manager_id || c.id === selectedExistingId).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>}
                  </Field>
                  <Field id="sales-customer-frequency" label="Frekuensi Kunjungan">{control => <select {...control} value={existingFrequency} onChange={e => setExistingFrequency(parseInt(e.target.value))}>
                    {FREQUENCY_OPTIONS.map(f => <option key={f.days} value={f.days}>{f.label}</option>)}
                  </select>}</Field>
                  {tierSelect(existingPricingTier, setExistingPricingTier)}
                  <Field id="sales-customer-owner" label="Penanggung Jawab Toko" hint="Pilih penanggung jawab toko sesuai penugasan.">
                    {control => <select {...control} value={existingManagerId} onChange={e => setExistingManagerId(e.target.value)}>
                      <option value="">Pilih penanggung jawab toko...</option>
                      {managers?.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>}
                  </Field>
                </>
              )}

              {/* EDIT */}
              {modalMode === 'edit' && (
                <>
                  <Field id="sales-customer-frequency" label="Frekuensi Kunjungan">{control => <select {...control} value={form.visit_frequency_days} onChange={e => setForm(p => ({ ...p, visit_frequency_days: parseInt(e.target.value) }))}>
                    {FREQUENCY_OPTIONS.map(f => <option key={f.days} value={f.days}>{f.label}</option>)}
                  </select>}</Field>
                  {tierSelect(form.pricing_tier, v => setForm(p => ({ ...p, pricing_tier: v })))}
                  <Field id="sales-customer-owner" label="Penanggung Jawab Toko" hint="Pilih penanggung jawab toko sesuai penugasan.">
                    {control => <select {...control} value={form.manager_id} onChange={e => setForm(p => ({ ...p, manager_id: e.target.value }))}>
                      <option value="">Belum ditugaskan</option>
                      {managers?.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>}
                  </Field>
                </>
              )}
            </fieldset>

            <FormActions className="pt-4 border-t border-brand-divider">
              <Button variant="quiet" onClick={() => { if (!writeBusy.current) closeModal() }} disabled={isPending}>Batal</Button>
              <Button pending={isPending}
                onClick={() => {
                  if (writeBusy.current || (modalMode === 'create' && createNeedsReview)) return
                  if (modalMode === 'create') {
                    if (!form.name.trim()) return alert('Nama pelanggan wajib diisi.')
                    ownerChanged.current = !!form.manager_id
                    writeBusy.current = true
                    createMutation.mutate()
                  } else if (modalMode === 'assign-existing') {
                    if (!selectedExistingId) return alert('Pilih pelanggan terlebih dahulu.')
                    if (!existingManagerId) return alert('Pilih penanggung jawab toko terlebih dahulu.')
                    ownerChanged.current = true
                    writeBusy.current = true
                    assignExistingMutation.mutate()
                  } else {
                    ownerChanged.current = form.manager_id !== (originalAssignment?.manager_id ?? '')
                    writeBusy.current = true
                    updateMutation.mutate()
                  }
                }}
                disabled={isPending || readError || (modalMode === 'create' && createNeedsReview)}
              >
                {isPending ? 'Menyimpan...'
                  : modalMode === 'create' ? 'Buat'
                  : modalMode === 'assign-existing' ? 'Tugaskan'
                  : 'Simpan'}
              </Button>
            </FormActions>

            {createNeedsReview && (
              <p className="text-amber-800 text-[13px] pt-4">Periksa daftar pelanggan sebelum mencoba lagi. Tutup formulir dan muat ulang data sebelum membuka formulir baru; data isian tetap ditampilkan di sini untuk diperiksa.</p>
            )}
            {isError && (
              <p role="alert" className="text-red-700 text-[13px] pt-4 text-right">{errorMessage}</p>
            )}
        </Dialog>
      )}
      </MainContent>
    </div>
  )
}
