import { useEffect, useState } from 'react'
import type { TargetActor, TargetPlansPage } from '../../lib/salesTargets/contracts'
import type { TargetTransport } from '../../lib/salesTargets/transport'
import { currentTargetMonth, nextTargetMonth } from '../../lib/salesTargets/calculations'
import { PLAN_LABELS } from '../../lib/salesTargets/definitions'
import { Button } from '../ui/Button'
export function TargetPlanInbox({ actor, transport, onOpen, refreshKey = 0, now = new Date() }: { actor: TargetActor; transport: TargetTransport; onOpen: (planId: string) => void; refreshKey?: number; now?: Date }) {
  const [month, setMonth] = useState(actor.role === 'sales_person' ? currentTargetMonth(now) : nextTargetMonth(now)), [page, setPage] = useState(1), [result, setResult] = useState<TargetPlansPage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!transport.capability.available || !actor.active || !month) return
    let cancelled = false
    setResult(null); setError(''); setLoading(true)
    void transport.readPlans({ month, page, pageSize: 10 }).then(value => { if (!cancelled) setResult(value) }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Daftar rencana gagal dimuat.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [transport, actor.id, actor.role, actor.active, month, page, retry, refreshKey])
  if (!transport.capability.available || !actor.active) return null
  return <section aria-label="Daftar rencana target" className="min-w-0 space-y-4 rounded-xl border border-brand-divider bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><h2 className="text-xl font-semibold">{actor.role === 'sales_person' ? 'Target Anda yang diterbitkan' : actor.role === 'sales_manager' ? 'Draf & riwayat target tim' : 'Pengajuan & riwayat target'}</h2><label className="text-sm font-medium">Bulan rencana<input className="ui-control mt-1 block max-w-full" aria-label="Bulan daftar rencana" type="month" value={month.slice(0, 7)} onChange={event => { setMonth(event.target.value ? `${event.target.value}-01` : ''); setPage(1) }} /></label></div>
    {loading && <p role="status">Memuat rencana…</p>}
    {error && <div role="alert"><p className="text-red-700">{error}</p><Button className="mt-2" variant="secondary" onClick={() => setRetry(value => value + 1)}>Coba muat lagi</Button></div>}
    {result && <><p className="text-sm text-brand-secondary">{result.total} rencana dalam cakupan akses Anda.</p>{!result.items.length ? <p>Belum ada rencana untuk bulan ini. Target bulan sebelumnya tidak dibawa otomatis.</p> : <ul className="space-y-3">{result.items.map(plan => <li key={plan.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-divider p-4"><div className="min-w-0"><h3 className="break-words font-semibold">{plan.managerName}</h3><p className="mt-1 text-sm text-brand-secondary">{PLAN_LABELS[plan.state]} · versi {plan.version}</p></div><Button variant="secondary" onClick={() => onOpen(plan.id)}>{plan.state === 'submitted' && ['sales_head', 'executive'].includes(actor.role) ? 'Tinjau pengajuan' : plan.state === 'draft' || plan.state === 'returned' ? 'Buka draf' : 'Lihat target'}</Button></li>)}</ul>}{result.total > result.pageSize && <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Sebelumnya</Button><p className="text-sm">Halaman {page} dari {Math.ceil(result.total / result.pageSize)}</p><Button variant="secondary" disabled={page * result.pageSize >= result.total || loading} onClick={() => setPage(value => value + 1)}>Berikutnya</Button></div>}</>}
  </section>
}
