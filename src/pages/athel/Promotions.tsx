import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AthelNav from '../../components/AthelNav'
import PromotionImage from '../../components/PromotionImage'
import TransactionRecovery from '../../components/TransactionRecovery'
import { useAuth } from '../../lib/AuthContext'
import { fetchPromotions, promotionStatus } from '../../lib/promotions'
import type { ActivePromotion } from '../../lib/promotions'
import { createPromotion, editPromotion, adjustPromotionStock, setPromotionActive, usePromotionTransactionSender } from '../../lib/promotionTransactions'
import type { PromotionPrices } from '../../lib/promotionTransactions'
import { PRICE_TIERS, parseCatalogPrice, formatCatalogPrice } from '../../lib/catalogPricing'
import type { CatalogPrices, PriceTier } from '../../lib/catalogPricing'
import { fetchCompleteRows } from '../../lib/reads/detailReads'
import { isPOConflict } from '../../lib/poConflict'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'

type Product = CatalogPrices & { id: string; name: string; sku: string; size: string | null }
type Form = { id: string; product_id: string; opening_quantity: string; image: File | null; prices: Record<PriceTier, string>; discount: string }
type Job = { kind: 'save'; form: Form; current: ActivePromotion | null } | { kind: 'stock'; current: ActivePromotion; delta: string; reason: string } | { kind: 'active'; current: ActivePromotion; active: boolean }
type VersionReview = { base: ActivePromotion; status: 'needed' | 'loading' | 'ready' | 'failed'; latest?: ActivePromotion; message?: string }
const LABELS: Record<PriceTier, string> = { harga_pokok: 'Harga Pokok', luar_kota: 'Luar Kota', dalam_kota: 'Dalam Kota', depo_bangunan: 'Depo Bangunan' }
const INPUT = 'mt-1 w-full min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent'
const BUTTON = 'rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-50'
const empty = (): Form => ({ id: crypto.randomUUID(), product_id: '', opening_quantity: '0', image: null, prices: { harga_pokok: '', luar_kota: '', dalam_kota: '', depo_bangunan: '' }, discount: '' })
function parsePrices(form: Form): PromotionPrices {
  return Object.fromEntries(PRICE_TIERS.map(tier => [tier, parseCatalogPrice(form.prices[tier])])) as PromotionPrices
}
export default function Promotions() {
  const { user, profile, loading, error } = useAuth()
  const actorKey = !loading && !error && user && profile?.id === user.id && profile.is_active && ['po_admin', 'executive'].includes(profile.role) ? `${user.id}:${profile.role}` : ''
  const queryClient = useQueryClient()
  const sender = usePromotionTransactionSender()
  const [form, setForm] = useState<Form | null>(null)
  const [editing, setEditing] = useState<ActivePromotion | null>(null)
  const [stockTarget, setStockTarget] = useState<ActivePromotion | null>(null)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const busy = useRef(false)
  const [versionReview, setVersionReview] = useState<VersionReview | null>(null)
  const reviewRequired = useRef(false)
  const reviewSequence = useRef(0)
  const unsaved = useUnsavedChanges(!!form || !!stockTarget)
  const promotions = useQuery({ queryKey: ['promotions', actorKey, 'admin'], queryFn: ({ signal }) => fetchPromotions(signal, true), enabled: !!actorKey, retry: false })
  const products = useQuery({ queryKey: ['products', actorKey, 'promotion-admin'], queryFn: ({ signal }) => fetchCompleteRows<Product>('products', 'id, name, sku, size, harga_pokok, luar_kota, dalam_kota, depo_bangunan', {}, signal), enabled: !!actorKey, retry: false })
  const close = () => { reviewSequence.current++; reviewRequired.current = false; setVersionReview(null); setForm(null); setEditing(null); setStockTarget(null); setDelta(''); setReason('') }
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['promotions'] }); void queryClient.invalidateQueries({ queryKey: ['promotion-image'] }) }
  const mutation = useMutation({ retry: false, mutationFn: async (job: Job) => {
    if (!actorKey || !user) throw new Error('Izin administrasi promosi belum tersedia.')
    if (job.kind === 'active') return setPromotionActive(job.current, job.active, sender)
    if (job.kind === 'stock') { if (!/^-?\d+$/.test(job.delta.trim())) throw new Error('Perubahan stok harus bilangan bulat dan bukan nol.'); return adjustPromotionStock(job.current, Number(job.delta), job.reason, sender) }
    const prices = parsePrices(job.form)
    if (job.current) return editPromotion(job.current, prices, job.form.image, user.id, sender)
    if (!/^\d+$/.test(job.form.opening_quantity.trim())) throw new Error('Stok awal harus bilangan bulat nol atau positif.')
    return createPromotion({ id: job.form.id, product_id: job.form.product_id, opening_quantity: Number(job.form.opening_quantity), ...prices, is_active: true }, job.form.image!, user.id, sender)
  }, onSuccess: () => { refresh(); close() } })
  const run = async (job: Job) => {
    if (busy.current || reviewRequired.current) return
    busy.current = true
    try { await mutation.mutateAsync(job) } catch (error) {
      const current = job.current
      if (isPOConflict(error) && current) { reviewRequired.current = true; setVersionReview({ base: current, status: 'needed' }) }
      // Keep form, selected file, old link, and request recovery visible.
    }
    finally { busy.current = false }
  }
  const reviewCurrentPromotion = async () => {
    if (!versionReview || mutation.isPending || sender.hasUnresolved()) return
    const base = versionReview.base, sequence = ++reviewSequence.current
    setVersionReview({ base, status: 'loading' })
    try {
      const refreshed = await promotions.refetch()
      if (sequence !== reviewSequence.current) return
      const latest = refreshed.data?.find(promotion => promotion.id === base.id)
      if (refreshed.isError || !latest || !latest.stock_managed || latest.product_id !== base.product_id || latest.stock_version <= base.stock_version) throw new Error('Data promosi terbaru belum lengkap atau masih memakai versi lama. Muat ulang sebelum melanjutkan.')
      setVersionReview({ base, status: 'ready', latest })
    } catch (error) { if (sequence === reviewSequence.current) setVersionReview({ base, status: 'failed', message: (error as Error).message }) }
  }
  const latestReview = versionReview?.latest
  const reviewMatchesCurrent = !!latestReview && !promotions.isFetching && !promotions.isError && promotions.data?.some(promotion => promotion.id === latestReview.id && promotion.stock_version === latestReview.stock_version)
  const adoptReviewedPromotion = () => {
    if (!latestReview || !reviewMatchesCurrent || mutation.isPending || sender.hasUnresolved()) return
    if (editing?.id === latestReview.id) setEditing(latestReview)
    if (stockTarget?.id === latestReview.id) setStockTarget(latestReview)
    reviewRequired.current = false; setVersionReview(null); mutation.reset()
  }
  const blocked = mutation.isPending || sender.hasUnresolved() || reviewRequired.current
  const pickProduct = (productId: string) => {
    const product = products.data?.find(p => p.id === productId)
    if (form) setForm({ ...form, product_id: productId, discount: '', prices: Object.fromEntries(PRICE_TIERS.map(tier => [tier, product?.[tier]?.toString() ?? ''])) as Form['prices'] })
  }
  const discount = (value: string) => {
    if (!form) return
    const source = products.data?.find(product => product.id === form.product_id)
    const percentage = Number(value)
    const discounted = source && value.trim() && Number.isFinite(percentage) && percentage >= 0 && percentage <= 100
      ? Object.fromEntries(PRICE_TIERS.map(tier => [tier, source[tier] == null ? '' : String(Math.round(source[tier]! * (1 - percentage / 100)))])) as Form['prices'] : form.prices
    setForm({ ...form, discount: value, prices: discounted })
  }
  if (!actorKey) return <div role={loading ? 'status' : 'alert'} className="p-8 text-sm text-brand-primary">{loading ? 'Memuat identitas…' : 'Administrasi promosi hanya tersedia untuk Procurement Admin dan executive aktif.'}</div>
  return <div className="min-h-screen bg-brand-canvas">
    <AthelNav />{unsaved.dialog}
    <TransactionRecovery send={sender} onCommitted={() => { refresh(); close() }} />
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-5 md:px-8">
      <div><h1 className="text-xl font-semibold text-brand-primary">Promosi</h1><p className="mt-1 text-sm text-gray-500">Procurement · Product highlight dan stok promosi</p></div>
      <button type="button" disabled={blocked || !!form || !!stockTarget} onClick={() => { setForm(empty()); setEditing(null); mutation.reset() }} className={BUTTON}>+ Tambah Promosi</button>
    </header>
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-8">
      {promotions.isError ? <div role="alert">Promosi belum dapat dimuat. <button type="button" onClick={() => void promotions.refetch()} className="underline">Coba lagi</button></div> : promotions.isPending || promotions.isFetching ? <p role="status">Memuat promosi…</p> : <>
        {!promotions.data?.length && <p className="text-sm text-gray-500">Belum ada promosi.</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{promotions.data?.map(promo => <article key={promo.id} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
          <PromotionImage key={promo.image_path} promotion={promo} />
          <h2 className="mt-3 font-semibold text-brand-primary">{promo.product_name}</h2><p className="text-xs text-gray-500">{promo.sku}{promo.size ? ` · ${promo.size}` : ''}</p>
          <p className="mt-2 text-sm text-brand-primary">{promotionStatus(promo)}</p><p className="text-sm text-gray-600">{promo.stock_managed ? `Stok tersedia: ${promo.remaining_quantity}` : 'Legacy · stok belum ditetapkan'}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">{PRICE_TIERS.map(tier => <div key={tier}><dt className="text-gray-500">{LABELS[tier]}</dt><dd className="font-medium text-brand-primary">{formatCatalogPrice(promo[tier])}</dd></div>)}</dl>
          {promo.stock_managed ? <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <button type="button" disabled={blocked || !!form || !!stockTarget} onClick={() => { setEditing(promo); setForm({ id: promo.id, product_id: promo.product_id, opening_quantity: '', image: null, discount: '', prices: Object.fromEntries(PRICE_TIERS.map(tier => [tier, promo[tier]?.toString() ?? ''])) as Form['prices'] }); mutation.reset() }} className="text-brand-primary underline disabled:opacity-50">Ubah harga / gambar</button>
            <button type="button" disabled={blocked || !!form || !!stockTarget} onClick={() => { setStockTarget(promo); setDelta(''); setReason(''); mutation.reset() }} className="text-brand-primary underline disabled:opacity-50">Sesuaikan stok</button>
            <button type="button" disabled={blocked || !!form || !!stockTarget} onClick={() => void run({ kind: 'active', current: promo, active: !promo.is_active })} className="text-brand-primary underline disabled:opacity-50">{promo.is_active ? 'Jeda' : 'Aktifkan'}</button>
          </div> : <p className="mt-4 text-xs text-gray-500">Riwayat legacy dipertahankan. Stok dan gambar pembukaan perlu diperiksa sebelum membuat kampanye baru.</p>}
        </article>)}</div>
      </>}
      {form && <section aria-label={editing ? 'Ubah promosi' : 'Tambah promosi'} className="rounded-xl border border-brand-accent bg-white p-4 sm:p-6">
        <h2 className="font-semibold text-brand-primary">{editing ? `Ubah ${editing.product_name}` : 'Tambah Product Highlight'}</h2>
        {products.isError && <p role="alert">Daftar produk belum dapat dimuat. <button type="button" className="underline" onClick={() => void products.refetch()}>Coba lagi</button></p>}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm text-gray-700">Produk<select aria-label="Produk" disabled={!!editing || blocked || products.isFetching || products.isError} value={form.product_id} onChange={event => pickProduct(event.target.value)} className={INPUT}><option value="">Pilih produk…</option>{products.data?.map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
          {!editing && <label className="text-sm text-gray-700">Stok awal<input type="number" min={0} step={1} inputMode="numeric" value={form.opening_quantity} disabled={blocked} onChange={event => setForm({ ...form, opening_quantity: event.target.value })} className={INPUT} /></label>}
          <label className="text-sm text-gray-700 sm:col-span-2">Gambar promosi<input aria-label="Gambar promosi" type="file" accept="image/png,image/jpeg,image/webp" disabled={blocked} onChange={event => setForm({ ...form, image: event.target.files?.[0] ?? null })} className={INPUT} /><span className="mt-1 block text-xs text-gray-500">PNG, JPG, atau WebP maksimal 5 MiB. Gambar lama tetap terhubung sampai perubahan berhasil disimpan.</span></label>
          <label className="text-sm text-gray-700 sm:col-span-2">Diskon otomatis (%)<input type="number" min={0} max={100} placeholder="mis. 10" disabled={blocked || !form.product_id} value={form.discount} onChange={event => discount(event.target.value)} className={INPUT} /></label>
          {PRICE_TIERS.map(tier => <label key={tier} className="text-sm text-gray-700">{LABELS[tier]} (Rp)<input type="number" min={0} step="0.01" disabled={blocked} value={form.prices[tier]} onChange={event => setForm({ ...form, prices: { ...form.prices, [tier]: event.target.value } })} className={INPUT} /></label>)}
        </div><p className="mt-3 text-xs text-gray-500">Harga kosong berarti belum diisi; nol berarti gratis. Stok promosi tidak mengubah harga yang dimasukkan pada PO.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={mutation.isPending} onClick={() => { close(); mutation.reset() }} className="rounded-lg border px-4 py-2 text-sm">Batal</button><button type="button" disabled={blocked || products.isFetching || products.isError || !products.data} onClick={() => void run({ kind: 'save', form, current: editing })} className={BUTTON}>{mutation.isPending ? 'Menyimpan...' : 'Simpan promosi'}</button></div>
      </section>}
      {stockTarget && <section aria-label="Penyesuaian stok" className="rounded-xl border border-brand-accent bg-white p-4 sm:p-6"><h2 className="font-semibold text-brand-primary">Sesuaikan stok · {stockTarget.product_name}</h2><p className="mt-1 text-sm">Stok terakhir: {stockTarget.remaining_quantity}. Penyesuaian tidak boleh membuat stok negatif.</p>
        <div className="mt-4 space-y-3"><label className="block text-sm">Perubahan stok<input type="number" step={1} value={delta} disabled={blocked} onChange={event => setDelta(event.target.value)} className={INPUT} /></label><label className="block text-sm">Alasan penyesuaian<textarea value={reason} disabled={blocked} onChange={event => setReason(event.target.value)} rows={2} className={INPUT} /></label></div>
        <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={mutation.isPending} onClick={() => { close(); mutation.reset() }} className="rounded-lg border px-4 py-2 text-sm">Batal</button><button type="button" disabled={blocked || !reason.trim()} onClick={() => void run({ kind: 'stock', current: stockTarget, delta, reason })} className={BUTTON}>Simpan penyesuaian</button></div>
      </section>}
      {versionReview && <section aria-label="Periksa promosi terbaru" className="rounded-xl border border-brand-accent bg-brand-tint p-4">
        <h2 className="text-sm font-semibold text-brand-primary">Periksa promosi terbaru · {versionReview.base.product_name}</h2>
        <p className="mt-1 text-sm">Isian harga, file, jumlah penyesuaian, dan alasan Anda tetap tersimpan. Periksa fakta saat ini sebelum menggunakan versi baru.</p>
        {versionReview.status === 'loading' && <p role="status" className="mt-2 text-sm">Memuat promosi terbaru…</p>}
        {versionReview.message && <p role="alert" className="mt-2 text-sm text-red-600">{versionReview.message}</p>}
        {latestReview && <div className="mt-3 space-y-2 text-sm">
          <p>Versi promosi saat ini: {latestReview.stock_version}</p><p>Stok saat ini: {latestReview.remaining_quantity}</p><p>Status saat ini: {promotionStatus(latestReview)}</p>
          {PRICE_TIERS.map(tier => <p key={tier}>Harga saat ini · {LABELS[tier]}: {formatCatalogPrice(latestReview[tier])}</p>)}
          <p>Gambar saat ini: {latestReview.image_path ? latestReview.image_path.split('/').at(-1) : 'Belum tersedia'}</p>
          <PromotionImage key={latestReview.image_path} promotion={latestReview} />
          {!reviewMatchesCurrent && <p className="text-red-600">Data promosi berubah lagi atau belum lengkap. Muat ulang sebelum menggunakan versi ini.</p>}
          <button type="button" disabled={!reviewMatchesCurrent || mutation.isPending || sender.hasUnresolved()} onClick={adoptReviewedPromotion} className={BUTTON}>Gunakan versi promosi yang sudah diperiksa</button>
        </div>}
      </section>}
      {mutation.isError && <div role="alert" className="text-sm text-red-600"><p>{(mutation.error as Error).message}</p><button type="button" disabled={mutation.isPending} onClick={() => versionReview ? void reviewCurrentPromotion() : refresh()} className="mt-2 underline">Muat ulang promosi</button></div>}
    </main>
  </div>
}
