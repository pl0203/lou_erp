import { LoadingState } from '../ui/LoadingState'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { formatAuditTimestamp } from '../../lib/displayDate'
import { formatMoney } from '../../lib/reads/money'
import { canonicalMoney } from '../../lib/salesTargets/calculations'
import { PLAN_LABELS, TARGET_LABELS } from '../../lib/salesTargets/definitions'
import type { TargetActor, TargetAuditEvent, TargetLine, TargetPlan } from '../../lib/salesTargets/contracts'
import { TargetTransportError } from '../../lib/salesTargets/transport'
import type { TargetTransport } from '../../lib/salesTargets/transport'
const operationLabels: Record<TargetAuditEvent['operation'], string> = { save_draft: 'Simpan draf', submit: 'Ajukan target', return: 'Kembalikan usulan', approve_publish: 'Setujui & terbitkan', propose_revision: 'Buat revisi', supersede: 'Digantikan revisi baru' }
function lineValue(line: TargetLine | undefined, before: boolean) {
  if (!line) return before ? 'Belum ada target' : 'Dihapus dari usulan'
  if (line.applicability === 'not_applicable') return 'Tidak berlaku'
  return line.amount === null ? 'Belum diisi' : `Rp${formatMoney(line.amount, 'full')}`
}
function lineIdentity(line: TargetLine) { return `${line.personId}:${line.metric}` }
function equalLines(before: TargetLine | undefined, after: TargetLine | undefined) {
  return !!before && !!after && before.applicability === after.applicability && before.reason === after.reason && (before.amount === null || after.amount === null ? before.amount === after.amount : canonicalMoney(before.amount) === canonicalMoney(after.amount))
}
export function TargetAuditDetails({ actor, plan, transport, onAccessDenied }: { actor: TargetActor; plan: TargetPlan; transport: TargetTransport; onAccessDenied?: (error: TargetTransportError) => void }) {
  const allowed = actor.active && ['sales_manager', 'sales_head', 'executive'].includes(actor.role) && transport.capability.available
  const [open, setOpen] = useState(false), [events, setEvents] = useState<TargetAuditEvent[] | null>(null), [truncated, setTruncated] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const denied = useRef(onAccessDenied); denied.current = onAccessDenied
  useEffect(() => {
    setEvents(null); setError(''); setTruncated(false)
    if (!allowed || !open) return
    let cancelled = false
    setLoading(true)
    void transport.readPlan(plan.id).then(value => {
      if (cancelled) return
      if (value.auditEvents === undefined) { setError('Riwayat belum tersedia dari API. Tidak ada fakta audit yang diasumsikan.'); return }
      setEvents(value.auditEvents); setTruncated(value.auditEventsTruncated === true)
    }).catch(cause => {
      if (cancelled) return
      setEvents(null); setError(cause instanceof Error ? cause.message : 'Riwayat gagal dimuat.')
      if (cause instanceof TargetTransportError && cause.code === '42501') denied.current?.(cause)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [allowed, open, plan.id, plan.version, actor.id, actor.role, transport, retry])
  if (!allowed) return null
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="min-w-0 rounded-xl border border-brand-divider bg-white p-4 sm:p-5">
    <summary className="min-h-[var(--ui-control-size)] cursor-pointer py-2 font-semibold text-brand-primary">Riwayat perubahan & persetujuan</summary>
    <div className="mt-3 min-w-0 space-y-4">
      <p className="text-sm text-brand-secondary">Catatan tersimpan untuk rencana ini. Nilai rupiah, alasan, pelaku, dan waktu berasal dari audit server. Perubahan yang belum disimpan tidak masuk riwayat.</p>
      {loading && <LoadingState title="Memuat riwayat…" shape="list" />}
      {error && <div role="alert" className="space-y-2"><p className="break-words text-red-700">{error}</p><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>Coba muat riwayat lagi</Button></div>}
      {truncated && <p role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Menampilkan 100 catatan terbaru untuk rencana ini. Ada catatan lebih lama yang tidak ditampilkan di sini.</p>}
      {events?.length === 0 && <p>Belum ada catatan audit tersimpan.</p>}
      {events?.map(event => {
        const before = new Map((event.before?.lines ?? []).map(line => [lineIdentity(line), line])), after = new Map(event.after.lines.map(line => [lineIdentity(line), line]))
        const keys = [...new Set([...before.keys(), ...after.keys()])]
        const changes = keys.filter(key => event.operation === 'propose_revision' || !equalLines(before.get(key), after.get(key)))
        return <article key={event.id} aria-label={`${operationLabels[event.operation]} · versi ${event.after.version}`} className="min-w-0 space-y-3 rounded-lg border border-brand-divider p-3 sm:p-4">
          <header className="space-y-1"><h3 className="font-semibold">{operationLabels[event.operation]} · versi {event.after.version}</h3><p className="break-words text-sm">{event.actorName} · {formatAuditTimestamp(event.occurredAt)}</p><p className="text-sm text-brand-secondary">{event.before ? `${PLAN_LABELS[event.before.state]} (versi ${event.before.version}) → ` : ''}{PLAN_LABELS[event.after.state]}</p></header>
          {event.reason && <p className="break-words rounded-lg bg-brand-tint p-3 text-sm">{event.reason}</p>}
          {event.operation === 'propose_revision' && <p className="text-sm text-brand-secondary">Perbandingan nilai yang berlaku sebelumnya dan nilai awal draf revisi.</p>}
          {changes.length ? <ul className="space-y-3">{changes.map(key => {
            const oldLine = before.get(key), newLine = after.get(key), line = newLine ?? oldLine!
            const person = event.after.people.find(value => value.personId === line.personId) ?? event.before?.people.find(value => value.personId === line.personId)
            return <li key={key} className="min-w-0 rounded-lg bg-brand-canvas p-3"><p className="break-words font-medium">{person?.name ?? line.personId}</p><p className="text-sm text-brand-secondary">{TARGET_LABELS[line.metric]}</p><div className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><p className="break-words">Sebelum: {lineValue(oldLine, true)}</p><p className="break-words">Sesudah: {lineValue(newLine, false)}</p></div>{oldLine?.reason && <p className="mt-2 break-words text-sm">Alasan sebelumnya: {oldLine.reason}</p>}{newLine?.reason && <p className="mt-2 break-words text-sm">Alasan baru: {newLine.reason}</p>}</li>
          })}</ul> : <p className="text-sm text-brand-secondary">Tidak ada perubahan nilai atau alasan per sales pada langkah ini.</p>}
          <details className="text-sm text-brand-secondary"><summary className="min-h-[var(--ui-control-size)] cursor-pointer py-2">Identitas catatan</summary><p className="break-all">Catatan {event.id} · Pelaku {event.actorId}</p></details>
        </article>
      })}
      {plan.previousPlanId && <a href={`/girard/targets?plan=${encodeURIComponent(plan.previousPlanId)}`} className="inline-block py-2 text-sm text-brand-primary underline">Buka rencana sebelumnya dan riwayatnya</a>}
    </div>
  </details>
}
