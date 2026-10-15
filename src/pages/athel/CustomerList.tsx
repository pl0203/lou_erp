import { sendCatalogueForm } from '../../lib/catalogue/formCommands'
import type { CatalogueTransactionSender } from '../../lib/catalogue/transactions'
import { useCataloguePage } from '../../lib/catalogue/useCataloguePage'
import type { CatalogueRow, CatalogueStatus } from '../../lib/catalogue/contracts'
import { CatalogueStatusActions } from '../../components/catalogue/CatalogueStatusActions'
import { CatalogueRecovery } from '../../components/catalogue/CatalogueRecovery'
import type { CatalogueOwner } from '../../components/catalogue/CatalogueRecovery'
import CustomerPricingHelp from '../../components/CustomerPricingHelp'
import { useProcurementAccess } from '../../lib/procurementAccess'
import { hasInvalidCustomerCategories } from '../../lib/customerCategoryRows'
import CustomerCategorySelect from '../../components/CustomerCategorySelect'
import ReadFailure from '../../components/ReadFailure'
import { parseCustomerCategory, formatCustomerCategory, type CustomerCategory } from '../../lib/customerCategory'
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import AthelNav from '../../components/AthelNav'
import PaginationControls from '../../components/PaginationControls'
import { Button } from '../../components/ui/Button'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { Field } from '../../components/ui/Field'
import { FilterBar } from '../../components/ui/FilterBar'
import { FormActions } from '../../components/ui/FormActions'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Feedback'
import { RecordList } from '../../components/ui/RecordList'
import { SummaryList } from '../../components/ui/SummaryList'

type Customer = CatalogueRow<'customer'>

type CustomerForm = {
  name: string
  address: string
  city: string
  phone: string
  email: string
  pricing_tier: string
  customer_category: CustomerCategory | null | ''
}

const EMPTY_FORM: CustomerForm = {
  name: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  pricing_tier: 'luar_kota',
  customer_category: '',
}

const TIER_LABELS: Record<string, string> = {
  harga_pokok:   'Harga Pokok',
  luar_kota:     'Luar Kota',
  dalam_kota:    'Dalam Kota',
  depo_bangunan: 'Depo Bangunan',
  others: 'Others',
}

const PAGE_SIZE = 10

async function saveCustomer(sender: CatalogueTransactionSender, form: CustomerForm, original: Customer | null) {
  const category = parseCustomerCategory(form.customer_category, { allowUnclassified: original !== null })
  const payload: Record<string, unknown> = {}
  for (const key of ['name', 'address', 'city', 'phone', 'email'] as const) {
    if (!original || form[key] !== (original[key] ?? '')) {
      payload[key] = key === 'name' ? form[key].trim() : form[key].trim() || null
    }
  }
  if (!original || form.pricing_tier !== original.pricing_tier) payload.pricing_tier = form.pricing_tier
  if (!original || category !== original.customer_category) payload.customer_category = category
  return sendCatalogueForm(sender, 'customer', payload, original)
}

async function deleteCustomer(id: string) {
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) throw error
}

export default function CustomerList() {
  const access = useProcurementAccess()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [originalCustomer, setOriginalCustomer] = useState<Customer | null>(null)
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<CatalogueStatus>('all')
  const mutationBusy = useRef(false)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const dialogCommitted = useRef(false)
  const successFocus = useRef<HTMLDivElement>(null)
  const restoreFocus = () => !dialogCommitted.current && dialogTrigger.current?.isConnected ? dialogTrigger.current : successFocus.current

  const handleSearch = (value: string) => {
    setSearch(value)
    clearTimeout((window as any)._customerSearchTimer)
    ;(window as any)._customerSearchTimer = setTimeout(() => setDebouncedSearch(value), 300)
  }

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, status])

  const catalogue = useCataloguePage({ kind: 'customer', search: debouncedSearch, page, pageSize: PAGE_SIZE, status })
  const { data, isFetching, isPlaceholderData, fetchStatus, isError: queryReadError, refetch } = catalogue
  const formOwner = useRef<CatalogueOwner | null>(null)
  useEffect(() => {
    if (showForm && (formOwner.current !== catalogue.owner || !formOwner.current?.isCurrent())) {
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    }
  }, [showForm, catalogue.owner])

  const customers = data?.items ?? []
  const readError = queryReadError || hasInvalidCustomerCategories(customers)
  const totalItems = data?.total ?? 0


  const saveMutation = useMutation({
    mutationFn: () => {
      if (!catalogue.sender || formOwner.current !== catalogue.owner || !formOwner.current?.isCurrent() || !catalogue.commandsAvailable
        || !catalogue.authority?.[originalCustomer ? 'customer_edit' : 'customer_create']) throw new Error('Kewenangan katalog belum terkonfirmasi.')
      return saveCustomer(catalogue.sender, form, originalCustomer)
    },
    onSettled: async () => {
      try { await catalogue.refresh() }
      finally { mutationBusy.current = false }
    },
    onSuccess: () => {
      dialogCommitted.current = true
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => { access.require('customer_delete'); return deleteCustomer(deleteId!) },
    onSettled: () => { mutationBusy.current = false },
    onSuccess: () => {
      dialogCommitted.current = true
      void catalogue.refresh()
      setDeleteId(null)
    },
  })

  const modalOpen = showForm || !!deleteId
  const modalPending = saveMutation.isPending || deleteMutation.isPending
  const formFrozen = modalPending || catalogue.unresolved
  const formControls = useRef<HTMLDivElement>(null)
  const wasUnresolved = useRef(false)
  useEffect(() => {
    if (showForm && !modalPending && !catalogue.busy && formOwner.current === catalogue.owner && formOwner.current?.isCurrent()
      && (catalogue.unresolved || wasUnresolved.current)) {
      // Frozen draft fields stay visible; recovery remains in this modal's focus trap.
      formControls.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')?.focus()
    }
    wasUnresolved.current = catalogue.unresolved
  }, [showForm, modalPending, catalogue.busy, catalogue.unresolved, catalogue.recoveryAvailable, catalogue.owner])
  const confirmFormRecovery = () => {
    catalogue.onConfirmed()
    dialogCommitted.current = true
    setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); saveMutation.reset()
  }
  const abandonFormRequest = () => {
    catalogue.onAbandoned()
    // Keep the exact draft and original version. Never silently rebase or retry.
    saveMutation.reset()
  }

  const openEdit = (c: Customer, trigger: HTMLElement) => {
    if (!catalogue.commandsAvailable || !catalogue.authority?.customer_edit || mutationBusy.current || modalOpen || modalPending || catalogue.unresolved) return
    dialogTrigger.current = trigger
    dialogCommitted.current = false
    saveMutation.reset()
    setOriginalCustomer(c)
    setEditingId(c.id)
    setForm({
      name: c.name,
      address: c.address ?? '',
      city: c.city ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      pricing_tier: c.pricing_tier ?? 'others',
      customer_category: c.customer_category,
    })
    formOwner.current = catalogue.owner
    setShowForm(true)
  }

  const handleSave = () => {
    if (!catalogue.commandsAvailable || !catalogue.authority?.[originalCustomer ? 'customer_edit' : 'customer_create'] || mutationBusy.current || modalPending || readError || catalogue.unresolved) return
    if (!form.name.trim()) return alert('Nama pelanggan wajib diisi.')
    mutationBusy.current = true
    saveMutation.mutate()
  }

  const handleDelete = () => {
    if (mutationBusy.current || modalPending || !access.capabilities.customer_delete || !deleteId) return
    mutationBusy.current = true
    deleteMutation.mutate()
  }

  const deleteTarget = customers.find(c => c.id === deleteId)

  const closeForm = () => { if (!mutationBusy.current && !formFrozen) { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) } }
  const openDelete = (c: Customer, trigger: HTMLElement) => {
    if (!access.capabilities.customer_delete || mutationBusy.current || modalOpen || modalPending || catalogue.unresolved) return
    dialogTrigger.current = trigger; dialogCommitted.current = false; deleteMutation.reset(); setDeleteId(c.id)
  }
  const rowActions = (c: Customer) => <div className="flex flex-wrap justify-end gap-2">
    {catalogue.authority?.customer_edit && <Button variant="quiet" size="compact" disabled={!catalogue.commandsAvailable || modalOpen || modalPending || catalogue.unresolved} onClick={event => openEdit(c, event.currentTarget)}>Ubah</Button>}
    {access.capabilities.customer_delete && <Button variant="danger-quiet" size="compact" disabled={modalOpen || modalPending || catalogue.unresolved} onClick={event => openDelete(c, event.currentTarget)}>Hapus</Button>}
    {catalogue.owner && catalogue.sender ? <CatalogueStatusActions kind="customer" row={c} owner={catalogue.owner} sender={catalogue.sender} authority={catalogue.authority} commandsAvailable={catalogue.commandsAvailable} disabled={modalOpen || modalPending || catalogue.unresolved} /> : <StatusBadge tone={c.is_enabled ? 'success' : 'neutral'}>{c.is_enabled ? 'Aktif' : 'Nonaktif'}</StatusBadge>}
  </div>
  return <div className="min-h-screen bg-brand-canvas">
    <AthelNav />
    <MainContent>
      <div inert={modalOpen} aria-hidden={modalOpen ? true : undefined}>
        <div ref={successFocus} tabIndex={-1} className="bg-white border-b border-brand-divider px-4 md:px-8 py-5">
          <PageHeader title="Daftar Pelanggan" description={data ? `${totalItems} pelanggan` : 'Jumlah pelanggan belum tersedia'} actions={catalogue.authority?.customer_create && <Button disabled={!catalogue.commandsAvailable || readError || modalOpen || modalPending || catalogue.unresolved} onClick={event => {
            if (!catalogue.commandsAvailable || !catalogue.authority?.customer_create || mutationBusy.current || modalOpen || modalPending || catalogue.unresolved) return
            dialogTrigger.current = event.currentTarget; dialogCommitted.current = false; saveMutation.reset(); setOriginalCustomer(null); setEditingId(null); setForm(EMPTY_FORM); formOwner.current = catalogue.owner; setShowForm(true)
          }}>+ Tambah Pelanggan</Button>} />
        </div>
        <div className="px-4 md:px-8 py-4"><FilterBar label="Filter daftar pelanggan"><Field id="catalog-customer-search" label="Cari pelanggan" className="w-full sm:w-80">{control => <input {...control} type="text" placeholder="Cari pelanggan..." value={search} onChange={event => handleSearch(event.target.value)} />}</Field><Field id="catalog-customer-status" label="Status pelanggan">{control => <select {...control} value={status} onChange={event => setStatus(event.target.value as CatalogueStatus)}><option value="all">Semua status</option><option value="enabled">Aktif</option><option value="disabled">Nonaktif</option></select>}</Field></FilterBar></div>
        <div className="px-4 md:px-8 pb-6 space-y-4">
          {!showForm && catalogue.unresolved && !catalogue.busy && catalogue.owner && catalogue.sender && <CatalogueRecovery owner={catalogue.owner} sender={catalogue.sender} available={catalogue.recoveryAvailable} acceptCanonical={catalogue.acceptCanonical} acceptAbandoned={catalogue.acceptAbandoned} onConfirmed={catalogue.onConfirmed} onAbandoned={catalogue.onAbandoned} />}

          {readError && <ReadFailure onRetry={() => { void refetch() }} />}
          {!readError && !data && <Notice tone="info" title={fetchStatus === 'paused' ? 'Memuat data pelanggan tertunda. Menunggu koneksi…' : 'Memuat data pelanggan...'} />}
          {!readError && data && fetchStatus === 'paused' && <Notice tone="info" title="Pembaruan data pelanggan tertunda. Menunggu koneksi; hasil terakhir tetap ditampilkan." />}
          {!readError && data && <>
            <div role="region" aria-label="Daftar pelanggan" tabIndex={0} className="hidden md:block bg-white rounded-[14px] border border-brand-divider overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead><tr className="bg-brand-canvas border-b border-brand-divider">{['Nama Pelanggan', 'Kota', 'Telepon', 'Email', 'Tier Harga', 'Kategori Pelanggan', 'Aksi'].map((label, index) => <th key={label} className={`px-5 py-3 font-medium text-brand-secondary ${index === 6 ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
                <tbody>
                  {customers.length === 0 && <tr><td colSpan={7} className="p-4"><EmptyState title="Tidak ada pelanggan ditemukan." /></td></tr>}
                  {customers.map(c => <tr key={c.id} className="border-b border-brand-divider">
                    <td className="px-5 py-4 font-medium text-brand-primary [overflow-wrap:anywhere]">{c.name}</td>
                    <td className="px-5 py-4 text-brand-secondary">{c.city ?? '—'}</td><td className="px-5 py-4 text-brand-secondary [overflow-wrap:anywhere]">{c.phone ?? '—'}</td><td className="px-5 py-4 text-brand-secondary [overflow-wrap:anywhere]">{c.email ?? '—'}</td>
                    <td className="px-5 py-4"><StatusBadge tone="neutral">{TIER_LABELS[c.pricing_tier] ?? c.pricing_tier}</StatusBadge></td>
                    <td className="px-5 py-4">{formatCustomerCategory(c.customer_category)}</td><td className="px-5 py-4">{rowActions(c)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <RecordList label="Daftar pelanggan seluler" className="md:hidden">
              {customers.length === 0 && <li><EmptyState title="Tidak ada pelanggan ditemukan." /></li>}
              {customers.map(c => <li key={c.id} className="bg-white rounded-[14px] border border-brand-divider p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3"><div className="min-w-0 flex-1"><p className="font-semibold text-brand-primary [overflow-wrap:anywhere]">{c.name}</p>{c.city && <p className="text-[13px] text-brand-secondary mt-1">{c.city}</p>}</div><StatusBadge tone="neutral">{TIER_LABELS[c.pricing_tier] ?? c.pricing_tier}</StatusBadge></div>
                <SummaryList items={[{ label: 'Kategori Pelanggan', value: formatCustomerCategory(c.customer_category) }, { label: 'Tier Harga', value: TIER_LABELS[c.pricing_tier] ?? c.pricing_tier }, { label: 'Telepon', value: c.phone ?? '—' }, { label: 'Email', value: c.email ?? '—' }]} />
                <div className="mt-4 border-t border-brand-divider pt-3">{rowActions(c)}</div>
              </li>)}
            </RecordList>
            <PaginationControls page={page} total={totalItems} pageSize={PAGE_SIZE} pending={isFetching || isPlaceholderData || fetchStatus === 'paused'} onPageChange={setPage} />
          </>}
        </div>
      </div>
      {showForm && <Dialog labelledBy="catalog-customer-form-title" pending={formFrozen} onClose={closeForm} returnFocus={null} fallbackFocus={restoreFocus}>
        <h2 id="catalog-customer-form-title" className="ui-dialog__title">{editingId ? 'Ubah Pelanggan' : 'Pelanggan Baru'}</h2>
        <div ref={formControls} className="mt-4 space-y-4">
          <fieldset disabled={formFrozen}><CustomerCategorySelect value={form.customer_category} allowUnclassified={originalCustomer?.customer_category === null} onChange={value => { if (!mutationBusy.current && !formFrozen) setForm(p => ({ ...p, customer_category: value })) }} /></fieldset>
          <Field id="catalog-customer-name" label="Nama Pelanggan *">{control => <input {...control} type="text" value={form.name} disabled={formFrozen} onChange={event => { if (!mutationBusy.current && !formFrozen) setForm(p => ({ ...p, name: event.target.value })) }} placeholder="mis. Toko Bangunan Maju" />}</Field>
          <Field id="catalog-customer-address" label="Alamat">{control => <input {...control} type="text" value={form.address} disabled={formFrozen} onChange={event => { if (!mutationBusy.current && !formFrozen) setForm(p => ({ ...p, address: event.target.value })) }} placeholder="mis. Jl. Sudirman No. 12" />}</Field>
          <Field id="catalog-customer-city" label="Kota">{control => <input {...control} type="text" value={form.city} disabled={formFrozen} onChange={event => { if (!mutationBusy.current && !formFrozen) setForm(p => ({ ...p, city: event.target.value })) }} placeholder="mis. Jakarta" />}</Field>
          <Field id="catalog-customer-phone" label="Telepon">{control => <input {...control} type="text" value={form.phone} disabled={formFrozen} onChange={event => { if (!mutationBusy.current && !formFrozen) setForm(p => ({ ...p, phone: event.target.value })) }} placeholder="mis. 021-5551234" />}</Field>
          <Field id="catalog-customer-email" label="Email">{control => <input {...control} type="email" value={form.email} disabled={formFrozen} onChange={event => { if (!mutationBusy.current && !formFrozen) setForm(p => ({ ...p, email: event.target.value })) }} placeholder="mis. toko@example.com" />}</Field>
          <Field id="catalog-customer-tier" label="Tier Harga" hint={<CustomerPricingHelp id="customer-pricing-help" />}>{control => <select {...control} value={form.pricing_tier} disabled={formFrozen} onChange={event => { if (!mutationBusy.current && !formFrozen) setForm(p => ({ ...p, pricing_tier: event.target.value })) }}>{Object.entries(TIER_LABELS).map(([tier, label]) => <option key={tier} value={tier}>{label}</option>)}</select>}</Field>
          {readError && <ReadFailure onRetry={() => { void refetch() }} />}
          {saveMutation.isError && <Notice tone="error" title={(saveMutation.error as Error).message} />}
          {catalogue.unresolved && !modalPending && !catalogue.busy && catalogue.owner && catalogue.sender && <CatalogueRecovery owner={catalogue.owner} sender={catalogue.sender} available={catalogue.recoveryAvailable} acceptCanonical={catalogue.acceptCanonical} acceptAbandoned={catalogue.acceptAbandoned} onConfirmed={confirmFormRecovery} onAbandoned={abandonFormRequest} />}
          <FormActions><Button variant="quiet" disabled={formFrozen} onClick={closeForm}>Batal</Button><Button pending={saveMutation.isPending} disabled={!catalogue.commandsAvailable || !catalogue.authority?.[originalCustomer ? 'customer_edit' : 'customer_create'] || formFrozen || readError} onClick={handleSave}>{saveMutation.isPending ? 'Menyimpan...' : 'Simpan'}</Button></FormActions>
        </div>
      </Dialog>}
      {deleteId && <Dialog labelledBy="catalog-customer-delete-title" pending={modalPending} onClose={() => { if (!mutationBusy.current && !modalPending) setDeleteId(null) }} returnFocus={null} fallbackFocus={restoreFocus}>
        <h2 id="catalog-customer-delete-title" className="ui-dialog__title">Hapus pelanggan ini?</h2>
        <p className="ui-dialog__description">Apakah Anda yakin ingin menghapus <strong>{deleteTarget?.name}</strong>? Tindakan ini tidak dapat dibatalkan.</p>
        {deleteMutation.isError && <Notice tone="error" title={(deleteMutation.error as Error).message} className="mt-4" />}
        <FormActions className="mt-5"><Button variant="quiet" disabled={modalPending} onClick={() => { if (!mutationBusy.current && !modalPending) setDeleteId(null) }}>Batal</Button><Button variant="danger" pending={deleteMutation.isPending} disabled={!access.capabilities.customer_delete || modalPending} onClick={handleDelete}>{deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}</Button></FormActions>
      </Dialog>}
    </MainContent>
  </div>
}
