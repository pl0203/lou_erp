import { sendCatalogueForm } from '../../lib/catalogue/formCommands'
import type { CatalogueTransactionSender } from '../../lib/catalogue/transactions'
import { useCataloguePage } from '../../lib/catalogue/useCataloguePage'
import type { CatalogueRow, CatalogueStatus } from '../../lib/catalogue/contracts'
import { CatalogueStatusActions } from '../../components/catalogue/CatalogueStatusActions'
import { CatalogueRecovery } from '../../components/catalogue/CatalogueRecovery'
import type { CatalogueOwner } from '../../components/catalogue/CatalogueRecovery'
import { useProcurementAccess } from '../../lib/procurementAccess'
import { parseCatalogPrice, formatCatalogPrice } from '../../lib/catalogPricing'
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

type Product = CatalogueRow<'product'>

type ProductForm = {
  name: string
  sku: string
  size: string
  harga_pokok: string
  luar_kota: string
  dalam_kota: string
  depo_bangunan: string
}

const EMPTY_FORM: ProductForm = {
  name: '',
  sku: '',
  size: '',
  harga_pokok: '',
  luar_kota: '',
  dalam_kota: '',
  depo_bangunan: '',
}

const PAGE_SIZE = 10

async function saveProduct(sender: CatalogueTransactionSender, form: ProductForm, original: Product | null) {
  const payload = {
    name: form.name.trim(),
    sku: form.sku.trim().toUpperCase(),
    size: form.size.trim() || null,
    harga_pokok: parseCatalogPrice(form.harga_pokok),
    luar_kota: parseCatalogPrice(form.luar_kota),
    dalam_kota: parseCatalogPrice(form.dalam_kota),
    depo_bangunan: parseCatalogPrice(form.depo_bangunan),
  }

  return sendCatalogueForm(sender, 'product', payload, original)
}

async function deleteProduct(id: string) {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

const TIER_LABELS: Record<string, string> = {
  harga_pokok:  'Harga Pokok',
  luar_kota:    'Luar Kota',
  dalam_kota:   'Dalam Kota',
  depo_bangunan: 'Depo Bangunan',
  others: 'Others',
}

export default function ProductList() {
  const access = useProcurementAccess()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [originalProduct, setOriginalProduct] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<CatalogueStatus>('all')
  const mutationBusy = useRef(false)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const dialogCommitted = useRef(false)
  const successFocus = useRef<HTMLDivElement>(null)
  const restoreFocus = () => !dialogCommitted.current && dialogTrigger.current?.isConnected ? dialogTrigger.current : successFocus.current

  const handleSearch = (value: string) => {
    setSearch(value)
    clearTimeout((window as any)._productSearchTimer)
    ;(window as any)._productSearchTimer = setTimeout(() => setDebouncedSearch(value), 300)
  }

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, status])

  const catalogue = useCataloguePage({ kind: 'product', search: debouncedSearch, page, pageSize: PAGE_SIZE, status })
  const { data, isError, isFetching, isPlaceholderData, fetchStatus, refetch } = catalogue
  const formOwner = useRef<CatalogueOwner | null>(null)
  useEffect(() => {
    if (showForm && (formOwner.current !== catalogue.owner || !formOwner.current?.isCurrent())) {
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    }
  }, [showForm, catalogue.owner])

  const products = data?.items ?? []
  const totalItems = data?.total ?? 0


  const saveMutation = useMutation({
    mutationFn: () => {
      if (!catalogue.sender || formOwner.current !== catalogue.owner || !formOwner.current?.isCurrent() || !catalogue.commandsAvailable
        || !catalogue.authority?.[originalProduct ? 'product_edit' : 'product_create']) throw new Error('Kewenangan katalog belum terkonfirmasi.')
      return saveProduct(catalogue.sender, form, originalProduct)
    },
    onSettled: () => { mutationBusy.current = false },
    onError: () => { if (catalogue.sender?.hasUnresolved()) setShowForm(false) },
    onSuccess: () => {
      dialogCommitted.current = true
      void catalogue.refresh()
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => { access.require('product_delete'); return deleteProduct(deleteId!) },
    onSettled: () => { mutationBusy.current = false },
    onSuccess: () => {
      dialogCommitted.current = true
      void catalogue.refresh()
      setDeleteId(null)
    },
  })

  const modalOpen = showForm || !!deleteId
  const modalPending = saveMutation.isPending || deleteMutation.isPending

  const openEdit = (p: Product, trigger: HTMLElement) => {
    if (!catalogue.commandsAvailable || !catalogue.authority?.product_edit || mutationBusy.current || modalOpen || modalPending || catalogue.unresolved) return
    dialogTrigger.current = trigger
    dialogCommitted.current = false
    saveMutation.reset()
    setOriginalProduct(p)
    setEditingId(p.id)
    setForm({
      name: p.name,
      sku: p.sku,
      size: p.size ?? '',
      harga_pokok: p.harga_pokok?.toString() ?? '',
      luar_kota: p.luar_kota?.toString() ?? '',
      dalam_kota: p.dalam_kota?.toString() ?? '',
      depo_bangunan: p.depo_bangunan?.toString() ?? '',
    })
    formOwner.current = catalogue.owner
    setShowForm(true)
  }

  const handleSave = () => {
    if (!catalogue.commandsAvailable || !catalogue.authority?.[editingId ? 'product_edit' : 'product_create'] || mutationBusy.current || modalPending || isError || catalogue.unresolved) return
    if (!form.sku.trim()) return alert('SKU wajib diisi.')
    if (!form.name.trim()) return alert('Nama barang wajib diisi.')
    mutationBusy.current = true
    saveMutation.mutate()
  }

  const handleDelete = () => {
    if (mutationBusy.current || modalPending || !access.capabilities.product_delete || !deleteId) return
    mutationBusy.current = true
    deleteMutation.mutate()
  }

  const deleteTarget = products.find(p => p.id === deleteId)

  const closeForm = () => { if (!mutationBusy.current && !modalPending) { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) } }
  const openDelete = (p: Product, trigger: HTMLElement) => {
    if (!access.capabilities.product_delete || mutationBusy.current || modalOpen || modalPending || catalogue.unresolved) return
    dialogTrigger.current = trigger; dialogCommitted.current = false; deleteMutation.reset(); setDeleteId(p.id)
  }
  const rowActions = (p: Product) => <div className="flex flex-wrap justify-end gap-2">
    {catalogue.authority?.product_edit && <Button variant="quiet" size="compact" disabled={!catalogue.commandsAvailable || modalOpen || modalPending || catalogue.unresolved} onClick={event => openEdit(p, event.currentTarget)}>Ubah</Button>}
    {access.capabilities.product_delete && <Button variant="danger-quiet" size="compact" disabled={modalOpen || modalPending || catalogue.unresolved} onClick={event => openDelete(p, event.currentTarget)}>Hapus</Button>}
    {catalogue.owner && catalogue.sender ? <CatalogueStatusActions kind="product" row={p} owner={catalogue.owner} sender={catalogue.sender} authority={catalogue.authority} commandsAvailable={catalogue.commandsAvailable} disabled={modalOpen || modalPending || catalogue.unresolved} /> : <StatusBadge tone={p.is_enabled ? 'success' : 'neutral'}>{p.is_enabled ? 'Aktif' : 'Nonaktif'}</StatusBadge>}
  </div>
  const tiers = ['harga_pokok', 'luar_kota', 'dalam_kota', 'depo_bangunan'] as const
  return <div className="min-h-screen bg-brand-canvas">
    <AthelNav />
    <MainContent>
      <div inert={modalOpen} aria-hidden={modalOpen ? true : undefined}>
        <div ref={successFocus} tabIndex={-1} className="bg-white border-b border-brand-divider px-4 md:px-8 py-5">
          <PageHeader title="Daftar Barang" description={data ? `${totalItems} barang` : 'Jumlah barang belum tersedia'} actions={catalogue.authority?.product_create && <Button disabled={!catalogue.commandsAvailable || modalOpen || modalPending || isError || catalogue.unresolved} onClick={event => {
            if (!catalogue.commandsAvailable || !catalogue.authority?.product_create || mutationBusy.current || modalOpen || modalPending || catalogue.unresolved) return
            dialogTrigger.current = event.currentTarget; dialogCommitted.current = false; saveMutation.reset(); setOriginalProduct(null); setEditingId(null); setForm(EMPTY_FORM); formOwner.current = catalogue.owner; setShowForm(true)
          }}>+ Tambah Barang</Button>} />
        </div>
        <div className="px-4 md:px-8 py-4">
          <FilterBar label="Filter daftar barang"><Field id="catalog-product-search" label="Cari barang" className="w-full sm:w-80">{control => <input {...control} type="text" placeholder="Cari berdasarkan nama atau SKU..." value={search} onChange={event => handleSearch(event.target.value)} />}</Field><Field id="catalog-product-status" label="Status barang">{control => <select {...control} value={status} onChange={event => setStatus(event.target.value as CatalogueStatus)}><option value="all">Semua status</option><option value="enabled">Aktif</option><option value="disabled">Nonaktif</option></select>}</Field></FilterBar>
        </div>
        <div className="px-4 md:px-8 pb-6 space-y-4">
          {catalogue.unresolved && !catalogue.busy && catalogue.owner && catalogue.sender && <CatalogueRecovery owner={catalogue.owner} sender={catalogue.sender} available={catalogue.recoveryAvailable} acceptCanonical={catalogue.acceptCanonical} acceptAbandoned={catalogue.acceptAbandoned} onConfirmed={catalogue.onConfirmed} onAbandoned={catalogue.onAbandoned} />}

          {isError && <Notice tone="error" title="Daftar barang belum dapat dimuat." actions={<Button variant="secondary" onClick={() => { void refetch() }}>Coba lagi</Button>} />}
          {!isError && !data && <Notice tone="info" title={fetchStatus === 'paused' ? 'Memuat data barang tertunda. Menunggu koneksi…' : 'Memuat data barang...'} />}
          {!isError && data && fetchStatus === 'paused' && <Notice tone="info" title="Pembaruan data barang tertunda. Menunggu koneksi; hasil terakhir tetap ditampilkan." />}
          {!isError && data && <>
            <div role="region" aria-label="Daftar barang" tabIndex={0} className="hidden md:block bg-white rounded-[14px] border border-brand-divider overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead><tr className="bg-brand-canvas border-b border-brand-divider">
                  {['SKU', 'Nama Barang', 'Ukuran', ...tiers.map(tier => TIER_LABELS[tier]), 'Aksi'].map((label, index) => <th key={label} className={`px-5 py-3 font-medium text-brand-secondary ${index > 2 ? 'text-right' : 'text-left'}`}>{label}</th>)}
                </tr></thead>
                <tbody>
                  {products.length === 0 && <tr><td colSpan={8} className="p-4"><EmptyState title="Tidak ada barang ditemukan." /></td></tr>}
                  {products.map(p => <tr key={p.id} className="border-b border-brand-divider">
                    <td className="px-5 py-4 font-mono text-sm text-brand-secondary uppercase [overflow-wrap:anywhere]">{p.sku}</td>
                    <td className="px-5 py-4 font-medium text-brand-primary [overflow-wrap:anywhere]">{p.name}</td>
                    <td className="px-5 py-4 text-brand-secondary">{p.size ?? '—'}</td>
                    {tiers.map(tier => <td key={tier} className="px-5 py-4 text-right text-brand-primary">{formatCatalogPrice(p[tier])}</td>)}
                    <td className="px-5 py-4">{rowActions(p)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <RecordList label="Daftar barang seluler" className="md:hidden">
              {products.length === 0 && <li><EmptyState title="Tidak ada barang ditemukan." /></li>}
              {products.map(p => <li key={p.id} className="bg-white rounded-[14px] border border-brand-divider p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1"><p className="font-semibold text-brand-primary [overflow-wrap:anywhere]">{p.name}</p><p className="text-[13px] text-brand-secondary font-mono uppercase mt-1 [overflow-wrap:anywhere]">{p.sku}</p>{p.size && <p className="text-[13px] text-brand-secondary mt-1">{p.size}</p>}</div>
                  {rowActions(p)}
                </div>
                <Button variant="quiet" size="compact" aria-expanded={expandedId === p.id} aria-controls={`catalog-prices-${p.id}`} onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>{expandedId === p.id ? 'Sembunyikan harga ▲' : 'Lihat semua harga ▼'}</Button>
                {expandedId === p.id && <SummaryList id={`catalog-prices-${p.id}`} className="mt-3" items={tiers.map(tier => ({ label: TIER_LABELS[tier], value: formatCatalogPrice(p[tier]) }))} />}
              </li>)}
            </RecordList>
            <PaginationControls page={page} total={totalItems} pageSize={PAGE_SIZE} pending={isFetching || isPlaceholderData || fetchStatus === 'paused'} onPageChange={setPage} />
          </>}
        </div>
      </div>
      {showForm && <Dialog labelledBy="catalog-product-form-title" pending={modalPending} onClose={closeForm} returnFocus={null} fallbackFocus={restoreFocus} className="max-w-lg">
        <h2 id="catalog-product-form-title" className="ui-dialog__title">{editingId ? 'Ubah Barang' : 'Barang Baru'}</h2>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="catalog-product-sku" label="SKU *">{control => <input {...control} type="text" value={form.sku} disabled={modalPending} onChange={event => { if (!mutationBusy.current && !modalPending) setForm(p => ({ ...p, sku: event.target.value })) }} placeholder="mis. MPA035" className="font-mono uppercase" />}</Field>
            <Field id="catalog-product-size" label="Ukuran">{control => <input {...control} type="text" value={form.size} disabled={modalPending} onChange={event => { if (!mutationBusy.current && !modalPending) setForm(p => ({ ...p, size: event.target.value })) }} placeholder="mis. 30x60" />}</Field>
          </div>
          <Field id="catalog-product-name" label="Nama Barang *">{control => <input {...control} type="text" value={form.name} disabled={modalPending} onChange={event => { if (!mutationBusy.current && !modalPending) setForm(p => ({ ...p, name: event.target.value })) }} placeholder="mis. Granit Putih Polos 60x60" />}</Field>
          <fieldset className="border-t border-brand-divider pt-4"><legend className="font-medium text-brand-primary">Harga per Tier</legend>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">{tiers.map(tier => <Field key={tier} id={`catalog-product-${tier}`} label={`${TIER_LABELS[tier]} (Rp)`}>{control => <input {...control} type="number" min={0} step="0.01" value={form[tier]} disabled={modalPending} onChange={event => { if (!mutationBusy.current && !modalPending) setForm(p => ({ ...p, [tier]: event.target.value })) }} placeholder="Belum diisi" />}</Field>)}</div>
            <p className="mt-3 text-[13px] text-brand-secondary">Harga kosong berarti belum diisi; nol berarti gratis.</p>
          </fieldset>
          {isError && <Notice tone="error" title="Daftar barang belum dapat dimuat." actions={<Button variant="secondary" onClick={() => { void refetch() }}>Coba lagi</Button>} />}
          {saveMutation.isError && <Notice tone="error" title={(saveMutation.error as Error).message} />}
          <FormActions><Button variant="quiet" disabled={modalPending} onClick={closeForm}>Batal</Button><Button pending={saveMutation.isPending} disabled={!catalogue.commandsAvailable || !catalogue.authority?.[editingId ? 'product_edit' : 'product_create'] || modalPending || isError} onClick={handleSave}>{saveMutation.isPending ? 'Menyimpan...' : 'Simpan'}</Button></FormActions>
        </div>
      </Dialog>}
      {deleteId && <Dialog labelledBy="catalog-product-delete-title" pending={modalPending} onClose={() => { if (!mutationBusy.current && !modalPending) setDeleteId(null) }} returnFocus={null} fallbackFocus={restoreFocus}>
        <h2 id="catalog-product-delete-title" className="ui-dialog__title">Hapus barang ini?</h2>
        <p className="ui-dialog__description">Apakah Anda yakin ingin menghapus <strong>{deleteTarget?.name}</strong>? Tindakan ini tidak dapat dibatalkan.</p>
        {deleteMutation.isError && <Notice tone="error" title={(deleteMutation.error as Error).message} className="mt-4" />}
        <FormActions className="mt-5"><Button variant="quiet" disabled={modalPending} onClick={() => { if (!mutationBusy.current && !modalPending) setDeleteId(null) }}>Batal</Button><Button variant="danger" pending={deleteMutation.isPending} disabled={!access.capabilities.product_delete || modalPending} onClick={handleDelete}>{deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}</Button></FormActions>
      </Dialog>}
    </MainContent>
  </div>
}
