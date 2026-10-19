import { LoadingState } from '../ui/LoadingState'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { formatMoney } from '../../lib/reads/money'
import { formatDisplayDate, formatAuditTimestamp } from '../../lib/displayDate'
import { baselineForPerson, buildSuggestedLines, canonicalMoney, nextTargetMonth, requiresTransferReview, restoreTargetLines, validateLines } from '../../lib/salesTargets/calculations'
import { METRICS, validMoney, validMonth } from '../../lib/salesTargets/contracts'
import type { TargetActor, TargetBaseline, TargetLine, TargetOperation, TargetPlan, TeamChoice } from '../../lib/salesTargets/contracts'
import { PLAN_LABELS, TARGET_LABELS, canApprove, canEditPlan, canPropose } from '../../lib/salesTargets/definitions'
import { TargetCommandRecovery } from '../../lib/salesTargets/recovery'
import { TargetTransportError, unavailableTargetTransport } from '../../lib/salesTargets/transport'
import type { TargetTransport } from '../../lib/salesTargets/transport'
import { useTargetDraft } from '../../lib/salesTargets/useTargetDraft'
import { TargetHistoryDetails } from './TargetHistoryDetails'
import { TargetReview } from './TargetReview'
import { TargetAuditDetails } from './TargetAuditDetails'

type Props = {
  actor: TargetActor
  transport?: TargetTransport
  teams?: TeamChoice[]
  initialPlanId?: string
  refreshKey?: number
  now?: Date
  onDirtyChange?: (dirty: boolean) => void
  onPlanSaved?: (plan: TargetPlan) => void
}
const fieldClass = 'ui-control mt-1 block w-full min-w-0 disabled:bg-brand-canvas'
const stepLabels = ['Pilih bulan & tim', 'Periksa usulan', 'Tinjau & ajukan']
export function TargetWizard({ actor, transport = unavailableTargetTransport, teams = [], initialPlanId, refreshKey = 0, now = new Date(), onDirtyChange, onPlanSaved }: Props) {
  const identity = `${transport.scope}:${actor.id}:${actor.role}:${actor.active}`
  const { draft, session, update, remember } = useTargetDraft(identity, initialPlanId ?? 'new', { month: nextTargetMonth(now), managerId: teams[0]?.managerId ?? '', step: 1, baseline: null, lines: [], plan: null, dirty: false })
  if (!session.recovery) session.recovery = new TargetCommandRecovery(transport)
  const recovery = session.recovery
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [validated, setValidated] = useState(false), [returnReason, setReturnReason] = useState(''), [revisionReason, setRevisionReason] = useState(''), [confirmScopeChange, setConfirmScopeChange] = useState(false), [pendingRoster, setPendingRoster] = useState<TargetBaseline | null>(null)
  const [, renderRecovery] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null), focusPerson = useRef<string | null>(null), mounted = useRef(true), activeSession = useRef(session)
  activeSession.current = session
  const visibleSession = () => mounted.current && activeSession.current === session
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const available = transport.capability.available && actor.active
  const frozen = recovery.snapshot.phase !== 'idle', pending = busy || ['sending', 'checking'].includes(recovery.snapshot.phase)
  const plan = draft.plan, editable = canPropose(actor) && (!plan || canEditPlan(actor, plan))
  const errors = draft.baseline ? validateLines(draft.lines, draft.baseline.people) : []
  const needsRosterSave = !!plan && !!draft.baseline && plan.rosterHash !== draft.baseline.rosterHash
  function discardDeniedProjection(cause: unknown) {
    if (cause instanceof TargetTransportError && cause.code === '42501' && session.current()) {
      update({ plan: null, baseline: null, lines: [], dirty: false, step: 1 })
      if (visibleSession()) setPendingRoster(null)
    }
  }
  const dirty = draft.dirty || frozen
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  useEffect(() => {
    setError(''); setNotice(''); setBusy(false); setValidated(false); setReturnReason(''); setRevisionReason(''); setPendingRoster(null)
  }, [identity, session])
  useEffect(() => {
    if (!available || !initialPlanId || session.get().dirty || recovery.snapshot.phase !== 'idle') return
    let cancelled = false
    setBusy(true); setError('')
    void transport.readPlan(initialPlanId).then(value => {
      if (cancelled || !session.current() || session.get().dirty || recovery.snapshot.phase !== 'idle') return
      // The read API is authoritative; these client checks additionally fail closed for own published views.
      if (actor.role === 'sales_person' && (value.state !== 'published' || value.baselineSnapshot != null || value.auditEvents !== undefined || value.auditEventsTruncated !== undefined || value.lines.some(line => line.personId !== actor.id))) throw new Error('Hanya target Anda yang sudah diterbitkan dapat dilihat.')
      const cached = session.get().plan
      if (cached?.id === value.id && cached.version === value.version && cached.state === value.state) return
      update({ plan: value, month: value.month, managerId: value.managerId, lines: value.lines, baseline: canEditPlan(actor, value) ? null : value.baselineSnapshot ?? null, step: 3, dirty: false })
    }).catch(cause => { if (!cancelled && session.current()) { discardDeniedProjection(cause); setError(cause instanceof Error ? cause.message : 'Rencana gagal dimuat.') } }).finally(() => { if (!cancelled && session.current()) setBusy(false) })
    return () => { cancelled = true }
  }, [available, initialPlanId, refreshKey, session, transport, actor.id, actor.role, update, recovery])
  useEffect(() => {
    if (focusPerson.current) {
      document.getElementById(`target-${focusPerson.current}-${METRICS[0]}`)?.focus(); focusPerson.current = null
    } else heading.current?.focus()
  }, [draft.step])

  function changeLine(personId: string, metric: TargetLine['metric'], patch: Partial<TargetLine>) {
    if (frozen || !editable) return
    update({ lines: draft.lines.map(line => line.personId === personId && line.metric === metric ? { ...line, ...patch } : line), dirty: true })
    setNotice('')
  }
  async function loadSuggestions(discard = false) {
    if (pending || frozen || !canPropose(actor)) return
    if (!validMonth(draft.month) || !teams.some(team => team.managerId === draft.managerId)) { setError('Pilih bulan dan tim yang diizinkan.'); return }
    if (draft.baseline?.month === draft.month && draft.baseline.managerId === draft.managerId) { update({ step: 2 }); setError(''); return }
    if (!discard && draft.dirty && draft.lines.length) { setConfirmScopeChange(true); return }
    setConfirmScopeChange(false); setBusy(true); setError('')
    try {
      const baseline = await transport.readBaseline({ month: draft.month, managerId: draft.managerId })
      if (!session.current()) return
      update({ baseline, lines: buildSuggestedLines(baseline.people), step: 2, plan: null, dirty: true })
    } catch (cause) { discardDeniedProjection(cause); if (session.current() && visibleSession()) setError(cause instanceof Error ? cause.message : 'Dasar target gagal dimuat. Isian Anda tetap tersimpan sementara.') }
    finally { if (session.current() && visibleSession()) setBusy(false) }
  }
  async function restorePlan() {
    if (!plan || pending || frozen) return
    setBusy(true); setError('')
    try {
      const baseline = await transport.readBaseline({ month: plan.month, managerId: plan.managerId })
      if (!session.current()) return
      if (baseline.rosterHash !== plan.rosterHash) { if (visibleSession()) setPendingRoster(baseline); return }
      update({ baseline, lines: restoreTargetLines(plan.lines, baseline.people), step: 2, dirty: false })
    } catch (cause) { discardDeniedProjection(cause); if (session.current() && visibleSession()) setError(cause instanceof Error ? cause.message : 'Draf belum dapat dipulihkan.') }
    finally { if (session.current() && visibleSession()) setBusy(false) }
  }
  function accepted(value: TargetPlan) {
    if (!session.current()) return
    update({ plan: value, lines: value.lines, baseline: value.baselineSnapshot ?? draft.baseline, month: value.month, managerId: value.managerId, dirty: false, step: value.state === 'draft' || value.state === 'returned' ? draft.step : 3 })
    remember(value.id)
    if (!visibleSession()) return
    setError(''); setNotice(value.state === 'draft' || value.state === 'returned' ? 'Draf tersimpan. Belum diajukan atau berlaku.' : value.state === 'submitted' ? 'Target diajukan. Menunggu Sales Head atau Direktur.' : value.state === 'published' ? 'Target disetujui dan diterbitkan.' : PLAN_LABELS[value.state])
    onPlanSaved?.(value)
  }
  async function send(operation: TargetOperation) {
    if (pending || frozen || !available) return
    if (['save_draft', 'submit'].includes(operation) && !editable) return
    if (['approve_publish', 'return'].includes(operation) && (!plan || !canApprove(actor, plan))) return
    if (operation === 'propose_revision' && (!plan || actor.id !== plan.proposedBy || !canPropose(actor) || plan.state !== 'published')) return
    if (operation === 'submit' && needsRosterSave) { setError('Simpan draf setelah meninjau perubahan tim sebelum mengajukan.'); update({ step: 2 }); return }
    if (operation === 'submit' && (errors.length || !draft.lines.length)) { setValidated(true); update({ step: 2 }); setError('Lengkapi nilai dan alasan sebelum mengajukan.'); return }
    if (operation === 'return' && !returnReason.trim()) { setError('Tambahkan alasan pengembalian.'); return }
    if (operation === 'propose_revision' && !revisionReason.trim()) { setError('Tambahkan alasan revisi.'); return }
    if (['save_draft', 'submit'].includes(operation) && draft.lines.some(line => line.amount !== null && !validMoney(line.amount))) { setValidated(true); setError('Perbaiki nominal yang tidak valid sebelum menyimpan.'); return }
    setError(''); setBusy(true)
    const request = { requestId: crypto.randomUUID(), operation, payload: ['save_draft', 'submit'].includes(operation)
      ? { ...(plan ? { planId: plan.id } : {}), expectedVersion: plan?.version ?? null, month: draft.month, managerId: draft.managerId, rosterHash: draft.baseline?.rosterHash ?? '', lines: draft.lines.map(line => ({ ...line, amount: line.amount === null ? null : canonicalMoney(line.amount), reason: line.reason?.trim() || null })) }
      : { planId: plan!.id, expectedVersion: plan!.version, reason: operation === 'return' ? returnReason.trim() : operation === 'propose_revision' ? revisionReason.trim() : undefined } }
    try { accepted((await recovery.execute(request)).plan) }
    catch (cause) { discardDeniedProjection(cause); if (session.current() && visibleSession()) setError(cause instanceof Error ? cause.message : 'Hasil belum terkonfirmasi. Periksa hasil sebelum mencoba lagi.') }
    finally { if (session.current()) { update({}); if (visibleSession()) { setBusy(false); renderRecovery(value => value + 1) } } }
  }
  async function recover(retry = false) {
    if (pending) return
    setBusy(true); setError('')
    try {
      const result = await (retry ? recovery.retry() : recovery.reconcile())
      if (!session.current()) return
      if (result.status === 'committed') accepted(result.plan)
      else if (visibleSession()) setNotice('Permintaan belum diterapkan. Anda dapat mengirim ulang permintaan yang sama; isian tetap dikunci sampai hasil pasti.')
    } catch (cause) { discardDeniedProjection(cause); if (session.current() && visibleSession()) setError(cause instanceof Error ? cause.message : 'Hasil belum dapat diperiksa.') }
    finally { if (session.current()) { update({}); if (visibleSession()) { setBusy(false); renderRecovery(value => value + 1) } } }
  }
  const teamName = teams.find(team => team.managerId === draft.managerId)?.name ?? 'Tim pada rencana'
  if (!available) return <section aria-label="Ketersediaan target" className="rounded-xl border border-brand-divider bg-white p-5"><h2 className="text-xl font-semibold">Target bulanan belum diaktifkan</h2><p className="mt-2 text-brand-secondary">{transport.capability.reason ?? 'API dan izin target baru belum tersedia. Tidak ada data yang dikirim atau target yang diterbitkan.'}</p><p className="mt-3 text-sm">Target lama tetap terpisah dan tidak dikonversi otomatis.</p></section>
  return <section className="min-w-0 space-y-5 text-brand-primary" aria-label="Rencana target bulanan">
    <p className="break-words text-sm text-brand-secondary">{formatDisplayDate(draft.month).replace(/^1 /, '')} · {teamName} · {plan ? PLAN_LABELS[plan.state] : 'Draf belum diajukan'}</p>
    {editable && <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Langkah target">{stepLabels.map((label, index) => <li key={label} aria-current={draft.step === index + 1 ? 'step' : undefined} className={`rounded-xl border border-brand-divider px-4 py-3 text-sm ${draft.step === index + 1 ? 'bg-brand-tint font-semibold text-brand-primary' : 'bg-white text-brand-secondary'}`}>{index + 1}. {label}</li>)}</ol>}
    {error && <div role="alert" className="break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    {notice && <p role="status" className="break-words rounded-lg bg-brand-tint p-4 text-brand-primary">{notice}</p>}
    {plan?.returnReason && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h2 className="font-semibold text-amber-900">Catatan pengembalian</h2><p className="mt-2 break-words text-amber-900">{plan.returnReason}</p></section>}
    {frozen && <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4" role="status"><p>Permintaan belum pasti. Jangan buat pengajuan baru atau memuat ulang halaman. Isian dipertahankan dan dikunci agar tidak terkirim dua kali.</p>{recovery.snapshot.phase === 'uncertain' && <Button onClick={() => void recover()} pending={pending}>Periksa hasil</Button>}{recovery.snapshot.phase === 'retryable' && <Button onClick={() => void recover(true)} pending={pending}>Kirim ulang permintaan yang sama</Button>}</div>}
    {pending && !frozen && <LoadingState title="Memuat…" shape="compact" />}
    {pendingRoster && plan && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><h2 className="font-semibold">Tim atau portofolio berubah</h2><p>Rencana tersimpan tetap utuh. {pendingRoster.people.filter(person => !plan.lines.some(line => line.personId === person.personId)).length} anggota baru perlu diisi manual; {new Set(plan.lines.filter(line => !pendingRoster.people.some(person => person.personId === line.personId)).map(line => line.personId)).size} anggota keluar dari usulan. Nilai anggota yang tetap ada dipertahankan, bukan dipindahkan ke orang lain.</p><Button disabled={pending || frozen} onClick={() => { update({ baseline: pendingRoster, lines: restoreTargetLines(plan.lines, pendingRoster.people, true), step: 2, dirty: true }); setPendingRoster(null); setValidated(false) }}>Tinjau perubahan tim</Button></section>}
    {plan && editable && !draft.baseline ? <div className="space-y-4 rounded-xl border border-brand-divider bg-white p-5"><h2>Draf tersimpan · versi {plan.version}</h2><p>Pulihkan draf untuk melanjutkan. Angka tersimpan tidak diganti dengan rekomendasi baru.</p><Button onClick={() => void restorePlan()} pending={pending}>Pulihkan draf tersimpan</Button></div>
      : editable && draft.step === 1 ? <div className="space-y-5 rounded-xl border border-brand-divider bg-white p-4 sm:p-6">
        <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">Pilih bulan & tim</h2>
        <div className="grid gap-5 sm:grid-cols-2"><label className="block min-w-0 font-medium">Bulan target<input aria-label="Bulan target" type="month" className={fieldClass} value={draft.month.slice(0, 7)} disabled={pending || frozen} onChange={event => update({ month: event.target.value ? `${event.target.value}-01` : '', dirty: true })} /></label><label className="block min-w-0 font-medium">Tim<select aria-label="Tim" className={fieldClass} value={draft.managerId} disabled={pending || frozen} onChange={event => update({ managerId: event.target.value, dirty: true })}><option value="">Pilih tim</option>{teams.map(team => <option key={team.managerId} value={team.managerId}>{team.name}</option>)}</select></label></div>
        <p className="text-sm text-brand-secondary">Usulan memakai rata-rata 3 bulan selesai per pelanggan. Target bulan lalu tidak dibawa otomatis. Portofolio pribadi manager hanya disertakan bila kepemilikan eksklusif terverifikasi.</p>
        {confirmScopeChange && <div role="alert" className="space-y-3 rounded-lg bg-amber-50 p-4"><p>Mengganti bulan atau tim akan mengganti usulan yang belum disimpan. Kembali ke bulan/tim sebelumnya untuk menyimpannya terlebih dahulu.</p><Button variant="secondary" onClick={() => setConfirmScopeChange(false)}>Tetap mengedit</Button> <Button onClick={() => void loadSuggestions(true)}>Ganti usulan</Button></div>}
        <Button onClick={() => void loadSuggestions()} pending={pending} disabled={frozen}>Periksa usulan</Button>
      </div>
      : editable && draft.step === 2 && draft.baseline ? <div className="space-y-5">
        <div><h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">Periksa target yang disarankan</h2><p className="mt-2 text-sm text-brand-secondary">Ubah angka bila perlu. Semua nilai dalam rupiah penuh (Rp), bukan juta. Lihat dasar untuk riwayat dan alasan penyesuaian.</p></div>
        {!draft.baseline.people.length && <p className="rounded-lg bg-amber-50 p-4 text-amber-900">Tidak ada anggota atau portofolio yang dapat diverifikasi. Usulan tidak dapat diajukan.</p>}
        {draft.baseline.people.map(person => <article key={person.personId} className="min-w-0 rounded-xl border border-brand-divider bg-white p-4 sm:p-5">
          <h3 className="break-words text-lg font-semibold">{person.name}</h3>
          <div className="mt-4 grid gap-5 lg:grid-cols-3">{METRICS.map(metric => {
            const line = draft.lines.find(value => value.personId === person.personId && value.metric === metric)!, base = baselineForPerson(person, metric)
            if (!line) return null
            const id = `target-${person.personId}-${metric}`, lineError = validated ? errors.find(value => value.personId === person.personId && value.metric === metric)?.message : undefined
            const needsReason = requiresTransferReview(person, metric) || base === null || line.applicability === 'not_applicable' || (line.amount !== null && validMoney(line.amount) && canonicalMoney(line.amount) !== base)
            return <div key={metric} className="min-w-0"><label htmlFor={id} className="block text-sm font-semibold">{TARGET_LABELS[metric]} (Rp)</label><input id={id} aria-label={`${TARGET_LABELS[metric]} (Rp) · ${person.name}`} aria-invalid={!!lineError} aria-describedby={`${id}-help${lineError ? ` ${id}-error` : ''}`} inputMode="decimal" type="text" value={line.amount ?? ''} placeholder="Perlu diisi" disabled={pending || frozen || line.applicability === 'not_applicable'} className={fieldClass} onChange={event => changeLine(person.personId, metric, { amount: event.target.value === '' ? null : event.target.value })} />
              <p id={`${id}-help`} className={`mt-2 text-sm ${base === null ? 'text-amber-800' : 'text-brand-secondary'}`}>{base === null ? metric === 'co_sale_value' ? 'Laporan CO belum lengkap. Tinjau manual, bukan nol.' : 'Riwayat belum lengkap. Tinjau manual, bukan nol.' : `Dasar 3 bulan: Rp${formatMoney(base, 'full')}`}</p>
              {requiresTransferReview(person, metric) && <p className="mt-2 text-sm text-amber-800">Order atau stok warisan: kredit aktual tetap pada sales sebelumnya. Tinjau target dan jelaskan penyesuaian atau alasan tetap.</p>}
              <label className="mt-3 flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" checked={line.applicability === 'not_applicable'} disabled={pending || frozen} onChange={event => changeLine(person.personId, metric, { applicability: event.target.checked ? 'not_applicable' : 'target', amount: event.target.checked ? null : base })} aria-label={`Tidak berlaku ${TARGET_LABELS[metric]} · ${person.name}`} />Tidak berlaku</label>
              {(needsReason || line.reason) && <label className="mt-2 block text-sm">Alasan<textarea className={fieldClass} rows={2} aria-label={`Alasan ${TARGET_LABELS[metric]} · ${person.name}`} disabled={pending || frozen} value={line.reason ?? ''} onChange={event => changeLine(person.personId, metric, { reason: event.target.value })} /></label>}
              {lineError && <p id={`${id}-error`} className="mt-2 text-sm font-medium text-red-700">{lineError}</p>}
            </div>
          })}</div>
          <TargetHistoryDetails person={person} />
        </article>)}
        {errors.length > 0 && <p className="text-sm text-amber-800">{errors.length} nilai perlu ditinjau: isi nominal atau pilih “Tidak berlaku” dengan alasan.</p>}
        {needsRosterSave && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Tim atau portofolio terbaru sudah dimasukkan untuk ditinjau. Simpan draf terlebih dahulu sebelum melanjutkan pengajuan. Target lama dan kredit penjualan tidak berubah.</p>}
        <p className="text-sm text-brand-secondary">Draf tersimpan hanya setelah Anda memilih Simpan draf. Isian sementara bertahan saat berpindah halaman dalam sesi ini, bukan setelah muat ulang atau keluar akun.</p>
        <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={pending || frozen} onClick={() => update({ step: 1 })}>Kembali</Button><Button variant={needsRosterSave ? 'primary' : 'secondary'} disabled={pending || frozen} onClick={() => void send('save_draft')}>Simpan draf</Button><Button className="sm:ml-auto" disabled={pending || frozen || !draft.lines.length || needsRosterSave} onClick={() => { setValidated(true); if (errors.length) { document.getElementById(`target-${errors[0].personId}-${errors[0].metric}`)?.focus(); return } update({ step: 3 }); setError('') }}>Lanjut ke tinjauan</Button></div>
      </div>
      : draft.step === 3 && (plan || draft.baseline) ? <div className="space-y-6">
        <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">{editable ? 'Tinjau & ajukan' : plan?.state === 'submitted' ? 'Tinjau pengajuan' : 'Target bulanan'}</h2>
        <TargetReview people={draft.baseline?.people ?? []} lines={draft.lines} onEdit={editable && !frozen ? personId => { focusPerson.current = personId; update({ step: 2 }) } : undefined} />
        {(draft.baseline?.warnings.length || plan?.warnings.length) ? <p role="note" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Ada peringatan data pada rencana. Riwayat tidak lengkap harus ditinjau manual; kredit penjualan lama tidak dipindahkan.{plan?.warnings.length ? ` (${plan.warnings.join(', ')})` : ''}</p> : null}
        {editable && <><section className="space-y-2"><h3 className="text-lg font-semibold">Siapa yang menyetujui?</h3><p>Sales Head atau Direktur. Satu persetujuan sudah cukup.</p><p className="text-sm text-brand-secondary">Target berlaku setelah disetujui. Pengaju tidak dapat menyetujui usulannya sendiri.</p></section><div className="flex flex-col gap-3 sm:flex-row-reverse"><Button disabled={pending || frozen} onClick={() => void send('submit')}>Ajukan target</Button><Button variant="secondary" disabled={pending || frozen} onClick={() => void send('save_draft')}>Simpan draf</Button><Button variant="quiet" disabled={pending || frozen} onClick={() => update({ step: 2 })}>Kembali ke usulan</Button></div></>}
        {plan && canApprove(actor, plan) && <section className="space-y-4 rounded-xl border border-brand-divider bg-white p-5"><h3 className="text-lg font-semibold">Keputusan persetujuan</h3><p>Sales Head atau Direktur dapat menyetujui secara independen. Persetujuan ini menerbitkan seluruh usulan, bukan mengubah angka.</p><Button disabled={pending || frozen} onClick={() => void send('approve_publish')}>Setujui & terbitkan</Button><details><summary className="min-h-[var(--ui-control-size)] cursor-pointer py-2 text-brand-primary">Perlu perbaikan?</summary><label className="block text-sm">Alasan pengembalian<textarea aria-label="Alasan pengembalian" className={fieldClass} rows={3} value={returnReason} disabled={pending || frozen} onChange={event => setReturnReason(event.target.value)} /></label><Button className="mt-3" variant="secondary" disabled={pending || frozen} onClick={() => void send('return')}>Kembalikan untuk diperbaiki</Button></details></section>}
        {plan?.state === 'submitted' && actor.id === plan.proposedBy && <p className="rounded-lg bg-brand-tint p-4">Pengaju tidak dapat menyetujui usulannya sendiri. Menunggu Sales Head atau Direktur.</p>}
        {plan?.state === 'published' && <p className="text-sm text-brand-secondary">Diterbitkan {plan.publishedAt ? formatAuditTimestamp(plan.publishedAt) : ''}. Versi {plan.version}. Nilai ini tidak dapat diedit langsung.</p>}
        {plan?.state === 'published' && canPropose(actor) && actor.id === plan.proposedBy && <details className="rounded-xl border border-brand-divider bg-white p-4"><summary className="min-h-[var(--ui-control-size)] cursor-pointer text-brand-primary">Usulkan revisi</summary><p className="mt-2 text-sm">Target yang berlaku tetap utuh sampai revisi disetujui. Nilai dan riwayat versi lama dipertahankan.</p><label className="mt-3 block text-sm">Alasan revisi<textarea aria-label="Alasan revisi" className={fieldClass} value={revisionReason} onChange={event => setRevisionReason(event.target.value)} /></label><Button className="mt-3" disabled={pending || frozen} onClick={() => void send('propose_revision')}>Buat draf revisi</Button></details>}
      </div> : !editable && !pending && !initialPlanId ? <div className="rounded-xl border border-brand-divider bg-white p-5"><h2 className="text-xl font-semibold">{actor.role === 'sales_person' ? 'Target Anda' : 'Tinjau pengajuan target'}</h2><p className="mt-2">{actor.role === 'sales_person' ? 'Lihat target yang sudah diterbitkan pada Ringkasan Saya. Pengaturan target dilakukan oleh manager.' : 'Pilih rencana pada daftar di bawah untuk meninjau, menyetujui, atau mengembalikannya.'}</p>{actor.role === 'sales_person' && <a className="mt-3 inline-block text-brand-primary underline" href="/girard/my-sales">Ringkasan Saya</a>}</div> : null}
    {plan && <TargetAuditDetails key={`${identity}:${plan.id}`} actor={actor} plan={plan} transport={transport} onAccessDenied={discardDeniedProjection} />}
    {plan && <p className="break-words text-sm text-brand-secondary">Versi {plan.version} · <a className="text-brand-primary underline" href={`/girard/targets?plan=${encodeURIComponent(plan.id)}`}>Buka rencana tersimpan</a>{plan.previousPlanId && actor.role !== 'sales_person' && <> · <a className="text-brand-primary underline" href={`/girard/targets?plan=${encodeURIComponent(plan.previousPlanId)}`}>Versi sebelumnya</a></>}</p>}
  </section>
}
export const TargetWorkspace = TargetWizard
