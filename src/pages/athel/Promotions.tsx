import { LoadingState } from '../../components/ui/LoadingState'
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AthelNav from '../../components/AthelNav'
import { Button } from '../../components/ui/Button'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { Field } from '../../components/ui/Field'
import { FormActions } from '../../components/ui/FormActions'
import { Section } from '../../components/ui/Section'
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Feedback'
import PromotionImage from '../../components/PromotionImage'
import TransactionRecovery from '../../components/TransactionRecovery'
import { useAuth } from '../../lib/AuthContext'
import { fetchPromotions, promotionStatus } from '../../lib/promotions'
import type { ActivePromotion } from '../../lib/promotions'
import { createPromotion, editPromotion, adjustPromotionStock, setPromotionActive, usePromotionTransactionSender } from '../../lib/promotionTransactions'
import type { PromotionPrices } from '../../lib/promotionTransactions'
import { fetchCompleteRows } from '../../lib/reads/detailReads'
import { isPOConflict } from '../../lib/poConflict'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'

type Product = { id: string; name: string; sku: string; size: string | null }
type Form = { id: string; product_id: string; opening_quantity: string; image: File | null }
type Job = { kind: 'save'; form: Form; current: ActivePromotion | null } | { kind: 'stock'; current: ActivePromotion; delta: string; reason: string } | { kind: 'active'; current: ActivePromotion; active: boolean }
type VersionReview = { base: ActivePromotion; status: 'needed' | 'loading' | 'ready' | 'failed'; latest?: ActivePromotion; message?: string }
const empty = (): Form => ({ id: crypto.randomUUID(), product_id: '', opening_quantity: '0', image: null })
function preservedPromotionPrices(current: ActivePromotion | null): PromotionPrices {
  return { harga_pokok: current?.harga_pokok ?? null, luar_kota: current?.luar_kota ?? null,
    dalam_kota: current?.dalam_kota ?? null, depo_bangunan: current?.depo_bangunan ?? null }
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
  const products = useQuery({ queryKey: ['products', actorKey, 'promotion-admin'], queryFn: ({ signal }) => fetchCompleteRows<Product>('products', 'id, name, sku, size', {}, signal), enabled: !!actorKey, retry: false })
  const close = () => { reviewSequence.current++; reviewRequired.current = false; setVersionReview(null); setForm(null); setEditing(null); setStockTarget(null); setDelta(''); setReason('') }
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['promotions'] }); void queryClient.invalidateQueries({ queryKey: ['promotion-image'] }) }
  const mutation = useMutation({ retry: false, mutationFn: async (job: Job) => {
    if (!actorKey || !user) throw new Error('Izin administrasi promosi belum tersedia.')
    if (job.kind === 'active') return setPromotionActive(job.current, job.active, sender)
    if (job.kind === 'stock') { if (!/^-?\d+$/.test(job.delta.trim())) throw new Error('Perubahan stok harus bilangan bulat dan bukan nol.'); return adjustPromotionStock(job.current, Number(job.delta), job.reason, sender) }
    const prices = preservedPromotionPrices(job.current)
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
    if (form) setForm({ ...form, product_id: productId })
  }
  if (!actorKey) return <MainContent>{loading ? <LoadingState title="Memuat identitas…" className="m-8" /> : <Notice tone="error" title="Administrasi promosi hanya tersedia untuk Procurement Admin dan executive aktif." className="m-8" />}</MainContent>
  return <div className="min-h-screen bg-brand-canvas">
    <AthelNav />
    <MainContent>
      {unsaved.dialog}
      <TransactionRecovery send={sender} onCommitted={() => { refresh(); close() }} />
      <PageHeader className="border-b border-brand-divider bg-white px-4 py-5 md:px-8" title="Promosi" description="Pengadaan · Promosi produk dan stok tersedia" actions={<Button disabled={blocked || !!form || !!stockTarget} onClick={() => { setForm(empty()); setEditing(null); mutation.reset() }}>+ Tambah Promosi</Button>} />
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-8">
        {promotions.isError && <Notice tone="error" title="Promosi belum dapat dimuat." actions={<Button variant="secondary" onClick={() => { void promotions.refetch() }}>Coba lagi</Button>} />}
        {!promotions.isError && !promotions.data && <LoadingState title={promotions.fetchStatus === 'paused' ? 'Memuat promosi tertunda. Menunggu koneksi…' : 'Memuat promosi…'} shape="list" />}
        {!promotions.isError && promotions.data && (promotions.isFetching || promotions.fetchStatus === 'paused') && <Notice tone="info" title={promotions.fetchStatus === 'paused' ? 'Pembaruan promosi tertunda. Menunggu koneksi; hasil terakhir tetap ditampilkan.' : 'Memperbarui promosi… Menampilkan hasil terakhir sampai selesai.'} />}
        {!promotions.isError && promotions.data && <>
          {!promotions.data.length && <EmptyState title="Belum ada promosi." />}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{promotions.data.map(promo => <article key={promo.id} className="min-w-0 rounded-[14px] border border-brand-divider bg-white p-4">
            <PromotionImage key={promo.image_path} promotion={promo} />
            <h2 className="mt-3 font-semibold text-brand-primary [overflow-wrap:anywhere]">{promo.product_name}</h2><p className="text-[13px] text-brand-secondary [overflow-wrap:anywhere]">{promo.sku}{promo.size ? ` · ${promo.size}` : ''}</p>
            <div className="mt-2"><StatusBadge tone={!promo.is_active || !promo.stock_managed ? 'neutral' : promo.remaining_quantity === 0 ? 'warning' : 'success'}>{promotionStatus(promo)}</StatusBadge></div>
            <p className="mt-2 text-base text-brand-secondary">{promo.stock_managed ? `Stok tersedia: ${promo.remaining_quantity}` : 'Legacy · stok belum ditetapkan'}</p>
            {promo.stock_managed ? <FormActions className="mt-4 justify-start">
              <Button variant="quiet" size="compact" disabled={blocked || !!form || !!stockTarget} onClick={() => { setEditing(promo); setForm({ id: promo.id, product_id: promo.product_id, opening_quantity: '', image: null }); mutation.reset() }}>Ubah gambar</Button>
              <Button variant="quiet" size="compact" disabled={blocked || !!form || !!stockTarget} onClick={() => { setStockTarget(promo); setDelta(''); setReason(''); mutation.reset() }}>Sesuaikan stok</Button>
              <Button variant="quiet" size="compact" disabled={blocked || !!form || !!stockTarget} onClick={() => { void run({ kind: 'active', current: promo, active: !promo.is_active }) }}>{promo.is_active ? 'Jeda' : 'Aktifkan'}</Button>
            </FormActions> : <p className="mt-4 text-[13px] text-brand-secondary">Riwayat legacy dipertahankan. Stok dan gambar pembukaan perlu diperiksa sebelum membuat kampanye baru.</p>}
          </article>)}</div>
        </>}
        {form && <Section aria-label={editing ? 'Ubah promosi' : 'Tambah promosi'} title={editing ? `Ubah ${editing.product_name}` : 'Tambah Promosi Produk'} className="border-brand-accent">
          {products.isError && <Notice tone="error" title="Daftar produk belum dapat dimuat." actions={<Button variant="secondary" onClick={() => { void products.refetch() }}>Coba lagi</Button>} />}
          {!products.isError && !products.data && <LoadingState title={products.fetchStatus === 'paused' ? 'Daftar produk tertunda. Menunggu koneksi…' : 'Memuat daftar produk…'} shape="compact" />}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="promotion-product" label="Produk">{control => <select {...control} disabled={!!editing || blocked || products.isFetching || products.isError || !products.data} value={form.product_id} onChange={event => pickProduct(event.target.value)}><option value="">Pilih produk…</option>{products.data?.map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select>}</Field>
            {!editing && <Field id="promotion-opening-stock" label="Stok awal">{control => <input {...control} type="number" min={0} step={1} inputMode="numeric" value={form.opening_quantity} disabled={blocked} onChange={event => setForm({ ...form, opening_quantity: event.target.value })} />}</Field>}
            <Field id="promotion-image" label="Gambar promosi" className="sm:col-span-2" hint="PNG, JPG, atau WebP maksimal 5 MiB. Gambar lama tetap terhubung sampai perubahan berhasil disimpan.">{control => <input {...control} type="file" accept="image/png,image/jpeg,image/webp" disabled={blocked} onChange={event => setForm({ ...form, image: event.target.files?.[0] ?? null })} />}</Field>
          </div>
          <p className="mt-3 text-[13px] text-brand-secondary">Harga satuan dimasukkan dan diperiksa oleh Admin PO pada pesanan. Stok promosi tidak mengubah harga PO.</p>
          <FormActions className="mt-5"><Button variant="quiet" disabled={mutation.isPending} onClick={() => { close(); mutation.reset() }}>Batal</Button><Button pending={mutation.isPending} disabled={blocked || products.isFetching || products.isError || !products.data} onClick={() => { void run({ kind: 'save', form, current: editing }) }}>{mutation.isPending ? 'Menyimpan...' : 'Simpan promosi'}</Button></FormActions>
        </Section>}
        {stockTarget && <Section aria-label="Penyesuaian stok" title={`Sesuaikan stok · ${stockTarget.product_name}`} className="border-brand-accent">
          <p className="text-base">Stok terakhir: {stockTarget.remaining_quantity}. Penyesuaian tidak boleh membuat stok negatif.</p>
          <div className="mt-4 space-y-3"><Field id="promotion-stock-delta" label="Perubahan stok">{control => <input {...control} type="number" step={1} value={delta} disabled={blocked} onChange={event => setDelta(event.target.value)} />}</Field><Field id="promotion-stock-reason" label="Alasan penyesuaian">{control => <textarea {...control} value={reason} disabled={blocked} onChange={event => setReason(event.target.value)} rows={2} />}</Field></div>
          <FormActions className="mt-5"><Button variant="quiet" disabled={mutation.isPending} onClick={() => { close(); mutation.reset() }}>Batal</Button><Button pending={mutation.isPending} disabled={blocked || !reason.trim()} onClick={() => { void run({ kind: 'stock', current: stockTarget, delta, reason }) }}>Simpan penyesuaian</Button></FormActions>
        </Section>}
        {versionReview && <Section aria-label="Periksa promosi terbaru" title={`Periksa promosi terbaru · ${versionReview.base.product_name}`} className="border-brand-accent bg-brand-tint">
          <p className="text-base">File, jumlah penyesuaian, dan alasan Anda tetap tersimpan. Periksa fakta saat ini sebelum menggunakan versi baru.</p>
          {versionReview.status === 'loading' && <LoadingState title="Memuat promosi terbaru…" className="mt-2" shape="compact" />}
          {versionReview.message && <Notice tone="error" title={versionReview.message} className="mt-2" />}
          {latestReview && <div className="mt-3 space-y-2 text-base">
            <p>Versi promosi saat ini: {latestReview.stock_version}</p><p>Stok saat ini: {latestReview.remaining_quantity}</p><p>Status saat ini: {promotionStatus(latestReview)}</p>
            <p>Gambar saat ini: {latestReview.image_path ? latestReview.image_path.split('/').at(-1) : 'Belum tersedia'}</p>
            <PromotionImage key={latestReview.image_path} promotion={latestReview} />
            {!reviewMatchesCurrent && <p className="text-red-700">Data promosi berubah lagi atau belum lengkap. Muat ulang sebelum menggunakan versi ini.</p>}
            <Button variant="secondary" disabled={!reviewMatchesCurrent || mutation.isPending || sender.hasUnresolved()} onClick={adoptReviewedPromotion}>Gunakan versi promosi yang sudah diperiksa</Button>
          </div>}
        </Section>}
        {mutation.isError && <Notice tone="error" title={(mutation.error as Error).message} actions={<Button variant="secondary" disabled={mutation.isPending} onClick={() => versionReview ? void reviewCurrentPromotion() : refresh()}>Muat ulang promosi</Button>} />}
      </div>
    </MainContent>
  </div>
}
