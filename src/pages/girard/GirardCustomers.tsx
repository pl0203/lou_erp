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
  const writeBusy = useRef(false)
  const ownerChanged = useRef(false)
  const createCustomerId = useRef<string | null>(null)
  const [createNeedsReview, setCreateNeedsReview] = useState(false)

  const [selectedExistingId, setSelectedExistingId] = useState('')
  const [existingFrequency, setExistingFrequency] = useState(7)
  const [existingManagerId, setExistingManagerId] = useState('')
  const [existingPricingTier, setExistingPricingTier] = useState('luar_kota')

  const { data: customers, isLoading, isError: customerReadError, refetch: retryCustomers } = useQuery({
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

  const openEdit = (c: Customer) => {
    if (writeBusy.current) return
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
    <select
      aria-label="Tier Harga"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
    >
      <option value="harga_pokok">Harga Pokok</option>
      <option value="luar_kota">Luar Kota</option>
      <option value="dalam_kota">Dalam Kota</option>
      <option value="depo_bangunan">Depo Bangunan</option>
      <option value="others">Others</option>
    </select>
  )

  const readError = customerReadError || managerReadError || assignmentReadError || hasInvalidCustomerCategories(customers ?? [])

  return (
    <div className="min-h-screen bg-brand-canvas">
      <GirardNav />
      {readError && <ReadFailure onRetry={() => { void retryCustomers(); void retryManagers(); void retryAssignments() }} />}

      <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pelanggan</h1>
          <p className="text-sm text-gray-500 mt-0.5">{customers?.length ?? 0} total pelanggan</p>
        </div>
        <div className="flex gap-2">
          {!readError && unassignedCustomers.length > 0 && (
            <button
              onClick={() => { if (writeBusy.current) return; closeModal(); setModalMode('assign-existing'); setShowModal(true) }}
              disabled={isPending}
              className="border border-brand-primary text-brand-primary hover:bg-brand-tint text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Tugaskan yang Ada
            </button>
          )}
          <button
            onClick={() => { if (writeBusy.current) return; closeModal(); setModalMode('create'); setShowModal(true) }}
            disabled={readError || isPending}
            className="bg-brand-primary hover:bg-brand-hover text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Pelanggan Baru
          </button>
        </div>
      </div>

      <div className="px-4 md:px-8 py-6">
        <input
          type="text"
          placeholder="Cari berdasarkan nama atau kota..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full sm:w-80 mb-4 focus:outline-none focus:ring-2 focus:ring-brand-primary"
        />

        {isLoading && (
          <div className="text-center text-gray-400 text-sm py-24">Memuat data pelanggan...</div>
        )}

        {/* Desktop table */}
        {!isLoading && !readError && (
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Pelanggan</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Lokasi</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Penanggung Jawab Toko</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Tier Harga</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Kategori Pelanggan</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Frekuensi Kunjungan</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Kunjungan Terakhir</th>
                  <th className="text-right px-5 py-3 font-medium text-gray-500">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered?.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-gray-400 py-12">
                      Tidak ada pelanggan ditemukan.
                    </td>
                  </tr>
                )}
                {filtered?.map(c => {
                  const assignment = assignmentMap[c.id]
                  const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days)
                  return (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <Link to={`/girard/customer/${c.id}`} className="font-medium text-brand-primary underline decoration-brand-accent underline-offset-2 hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">{c.name}</Link>
                        {c.phone && <p className="text-xs text-gray-400 mt-0.5">{c.phone}</p>}
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-xs">
                        {[c.address, c.city].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-5 py-4">
                        {assignment?.manager_id
                          ? <span className="text-gray-900">{assignment.managers?.full_name}</span>
                          : <span className="text-xs text-gray-300">Belum ditugaskan</span>
                        }
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-medium">
                          {TIER_LABELS[c.pricing_tier] ?? c.pricing_tier}
                        </span>
                      </td>
                      <td className="px-5 py-4">{formatCustomerCategory(c.customer_category)}</td>
                      <td className="px-5 py-4 text-gray-600 text-xs">
                        {frequencyLabel(c.visit_frequency_days)}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-gray-600'}`}>
                          {c.last_visit_date
                            ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                            : 'Belum pernah'}
                          {overdue && ' ⚠'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openEdit(c)}
                          className="text-brand-primary hover:text-brand-hover text-xs font-medium"
                        >
                          Ubah
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
        {!isLoading && !readError && (
          <div className="md:hidden space-y-3">
            {filtered?.map(c => {
              const assignment = assignmentMap[c.id]
              const overdue = isOverdue(c.last_visit_date, c.visit_frequency_days)
              return (
                <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <Link to={`/girard/customer/${c.id}`} className="font-semibold text-brand-primary text-sm underline decoration-brand-accent underline-offset-2 hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary break-words [overflow-wrap:anywhere]">{c.name}</Link>
                      {c.city && <p className="text-xs text-gray-400 mt-0.5">{c.city}</p>}
                    </div>
                    <button
                      onClick={() => openEdit(c)}
                      className="text-brand-primary text-xs font-medium ml-3 shrink-0"
                    >
                      Ubah
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="text-gray-400">Kategori Pelanggan</p><p className="text-gray-700 mt-0.5">{formatCustomerCategory(c.customer_category)}</p></div>
                    <div>
                      <p className="text-gray-400">Penanggung Jawab Toko</p>
                      <p className="text-gray-700 mt-0.5">{assignment?.managers?.full_name ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Tier Harga</p>
                      <p className="text-blue-700 font-medium mt-0.5">
                        {TIER_LABELS[c.pricing_tier] ?? c.pricing_tier}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Frekuensi</p>
                      <p className="text-gray-700 mt-0.5">{frequencyLabel(c.visit_frequency_days)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Kunjungan Terakhir</p>
                      <p className={`mt-0.5 ${overdue ? 'text-red-500 font-medium' : 'text-gray-700'}`}>
                        {c.last_visit_date
                          ? new Date(c.last_visit_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                          : 'Belum pernah'}
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
                {modalMode === 'create' ? 'Pelanggan Baru'
                  : modalMode === 'assign-existing' ? 'Tugaskan Pelanggan yang Ada'
                  : 'Ubah Penugasan Pelanggan'}
              </h3>
            </div>

            <fieldset disabled={isPending} className="px-6 py-4 space-y-4">
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
                    <div key={field}>
                      <label className="block text-sm text-gray-600 mb-1">{label}</label>
                      <input
                        type="text"
                        placeholder={placeholder}
                        value={form[field as keyof CustomerForm] as string}
                        onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Frekuensi Kunjungan *</label>
                    <select
                      aria-label="Frekuensi Kunjungan"
                      value={form.visit_frequency_days}
                      onChange={e => setForm(p => ({ ...p, visit_frequency_days: parseInt(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    >
                      {FREQUENCY_OPTIONS.map(f => (
                        <option key={f.days} value={f.days}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Tier Harga *</label>
                    {tierSelect(form.pricing_tier, v => setForm(p => ({ ...p, pricing_tier: v })))}
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      Tugaskan ke Penanggung Jawab Toko <span className="text-gray-400">(opsional)</span>
                    </label>
                    <select
                      aria-label="Penanggung Jawab Toko"
                      value={form.manager_id}
                      onChange={e => setForm(p => ({ ...p, manager_id: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    >
                      <option value="">Belum ditugaskan</option>
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
                    <label className="block text-sm text-gray-600 mb-1">Pilih Pelanggan *</label>
                    <select
                      aria-label="Pilih Pelanggan"
                      value={selectedExistingId}
                      onChange={e => {
                        setSelectedExistingId(e.target.value)
                        const assignment = assignmentMap[e.target.value]
                        setOriginalAssignment(assignment ? { ...assignment } : null)
                        const customer = customers?.find(c => c.id === e.target.value)
                        if (customer) { setExistingFrequency(customer.visit_frequency_days); setExistingPricingTier(customer.pricing_tier) }
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    >
                      <option value="">Pilih pelanggan...</option>
                      {(customers ?? []).filter(c => !assignmentMap[c.id]?.manager_id || c.id === selectedExistingId).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">
                      Hanya menampilkan pelanggan yang belum ditugaskan ke penanggung jawab toko.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Frekuensi Kunjungan *</label>
                    <select
                      aria-label="Frekuensi Kunjungan"
                      value={existingFrequency}
                      onChange={e => setExistingFrequency(parseInt(e.target.value))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    >
                      {FREQUENCY_OPTIONS.map(f => (
                        <option key={f.days} value={f.days}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Tier Harga *</label>
                    {tierSelect(existingPricingTier, setExistingPricingTier)}
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Tugaskan ke Penanggung Jawab Toko *</label>
                    <select
                      aria-label="Penanggung Jawab Toko"
                      value={existingManagerId}
                      onChange={e => setExistingManagerId(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    >
                      <option value="">Pilih penanggung jawab toko...</option>
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
                    <label className="block text-sm text-gray-600 mb-1">Frekuensi Kunjungan</label>
                    <select
                      aria-label="Frekuensi Kunjungan"
                      value={form.visit_frequency_days}
                      onChange={e => setForm(p => ({ ...p, visit_frequency_days: parseInt(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    >
                      {FREQUENCY_OPTIONS.map(f => (
                        <option key={f.days} value={f.days}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Tier Harga</label>
                    {tierSelect(form.pricing_tier, v => setForm(p => ({ ...p, pricing_tier: v })))}
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Penanggung Jawab Toko</label>
                    <select
                      aria-label="Penanggung Jawab Toko"
                      value={form.manager_id}
                      onChange={e => setForm(p => ({ ...p, manager_id: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                    >
                      <option value="">Belum ditugaskan</option>
                      {managers?.map(m => (
                        <option key={m.id} value={m.id}>{m.full_name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </fieldset>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { if (!writeBusy.current) closeModal() }}
                disabled={isPending}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
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
                className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-hover disabled:opacity-50"
              >
                {isPending ? 'Menyimpan...'
                  : modalMode === 'create' ? 'Buat'
                  : modalMode === 'assign-existing' ? 'Tugaskan'
                  : 'Simpan'}
              </button>
            </div>

            {createNeedsReview && (
              <p className="text-amber-800 text-xs px-6 pb-4">Periksa daftar pelanggan sebelum mencoba lagi. Tutup formulir dan muat ulang data sebelum membuka formulir baru; data isian tetap ditampilkan di sini untuk diperiksa.</p>
            )}
            {isError && (
              <p role="alert" className="text-red-500 text-xs px-6 pb-4 text-right">{errorMessage}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
