import { formatMoney } from '../../lib/reads/money'
import { addMoney, baselineForPerson, moneyDifference } from '../../lib/salesTargets/calculations'
import { METRICS } from '../../lib/salesTargets/contracts'
import type { BaselinePerson, TargetLine } from '../../lib/salesTargets/contracts'
import { TARGET_LABELS } from '../../lib/salesTargets/definitions'
import { Button } from '../ui/Button'
import { TargetHistoryDetails } from './TargetHistoryDetails'
export function TargetReview({ people, lines, onEdit }: { people: BaselinePerson[]; lines: TargetLine[]; onEdit?: (personId: string) => void }) {
  const persons = people.length ? people : Array.from(new Set(lines.map(line => line.personId))).map(personId => ({ personId, name: `Sales ${personId.slice(0, 8)}`, ownership: 'direct_report' as const, customers: [] }))
  return <div className="min-w-0 space-y-6">
    <section aria-label="Total usulan per metrik" className="rounded-xl border border-brand-divider bg-brand-tint p-4 sm:p-5">
      <h3 className="mb-4 text-lg font-semibold">Total usulan</h3>
      <dl className="grid gap-4 md:grid-cols-3">{METRICS.map(metric => {
        const selected = lines.filter(line => line.metric === metric && line.applicability === 'target'), missing = selected.some(line => line.amount === null)
        return <div key={metric} className="min-w-0"><dt className="text-sm text-brand-secondary">{TARGET_LABELS[metric]}</dt><dd className="mt-1 break-words text-xl font-bold">{missing ? 'Belum lengkap' : selected.length ? `Rp${formatMoney(addMoney(selected.map(line => line.amount!)), 'full')}` : 'Tidak berlaku'}</dd></div>
      })}</dl>
    </section>
    <p className="text-sm text-brand-secondary">Ketiga nilai terpisah, tidak dijumlahkan. Nilai nol tidak menghasilkan persentase pencapaian.</p>
    <h3 className="text-lg font-semibold">Periksa per sales</h3>
    <div className="space-y-3">{persons.map(person => <article key={person.personId} className="min-w-0 rounded-xl border border-brand-divider bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="break-words font-semibold">{person.name}</h4>{onEdit && <Button variant="quiet" onClick={() => onEdit(person.personId)} aria-label={`Ubah target ${person.name}`}>Ubah</Button>}</div>
      <dl className="mt-2 grid gap-3 md:grid-cols-3">{METRICS.map(metric => {
        const line = lines.find(value => value.personId === person.personId && value.metric === metric), base = baselineForPerson(person, metric)
        return <div key={metric} className="min-w-0"><dt className="text-sm text-brand-secondary">{TARGET_LABELS[metric]}</dt><dd className="break-words font-medium">{line?.applicability === 'not_applicable' ? 'Tidak berlaku' : line?.amount != null ? `Rp${formatMoney(line.amount, 'full')}` : 'Belum diisi'}</dd>
          {base !== null && line?.amount != null && <dd className="mt-1 text-sm text-brand-secondary">Dasar Rp{formatMoney(base, 'full')} · Selisih Rp{formatMoney(moneyDifference(line.amount, base), 'full')}</dd>}
          {line?.reason && <dd className="mt-2 break-words rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Alasan: {line.reason}{base === null && people.length > 0 ? ' · Riwayat belum lengkap; penetapan manual.' : ''}</dd>}
        </div>
      })}</dl>
      {people.length > 0 && <TargetHistoryDetails person={person} />}
    </article>)}</div>
  </div>
}
