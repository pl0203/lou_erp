import { formatMoney } from '../../lib/reads/money'
import { baselineForPerson } from '../../lib/salesTargets/calculations'
import { TARGET_DEFINITIONS, TARGET_LABELS } from '../../lib/salesTargets/definitions'
import { METRICS } from '../../lib/salesTargets/contracts'
import type { BaselinePerson } from '../../lib/salesTargets/contracts'
import { formatDisplayDate } from '../../lib/displayDate'
export function TargetHistoryDetails({ person }: { person: BaselinePerson }) {
  return <details className="mt-3 min-w-0 text-sm">
    <summary className="min-h-[var(--ui-control-size)] cursor-pointer py-2 font-medium text-brand-primary">Lihat dasar rekomendasi</summary>
    <div className="mt-3 space-y-4 rounded-xl bg-brand-canvas p-3 text-brand-primary">
      <p>Rata-rata 3 bulan kalender selesai per pelanggan, lalu dijumlahkan. Riwayat 6 bulan hanya konteks; tidak ada kenaikan otomatis.</p>
      <p>Riwayat portofolio bukan penjualan historis sales saat ini. Kredit PO/CO tetap pada pemilik aslinya. Order atau stok warisan perlu penyesuaian beralasan bila kredit aktual tetap pada sales sebelumnya.</p>
      {person.ownership === 'exclusive_manager' && <p>Portofolio pribadi manager telah diverifikasi eksklusif, terpisah dari target tim.</p>}
      {!person.customers.length && <p role="note" className="text-amber-800">Belum ada portofolio terverifikasi. Isi manual setelah peninjauan; bukan rekomendasi nol.</p>}
      {METRICS.map(metric => <section key={metric} className="min-w-0 space-y-2 border-t border-brand-divider pt-3">
        <h4 className="font-semibold">{TARGET_LABELS[metric]}: {baselineForPerson(person, metric) === null ? 'Perlu tinjauan manual' : `Rp${formatMoney(baselineForPerson(person, metric)!, 'full')}`}</h4>
        <p className="text-brand-secondary">{TARGET_DEFINITIONS[metric]}</p>
        {person.customers.map(customer => {
          const cell = customer.cells.find(value => value.metric === metric)
          return <details key={customer.customerId} className="rounded-lg border border-brand-divider bg-white p-3">
            <summary className="min-h-[var(--ui-control-size)] cursor-pointer break-words font-medium">{customer.name} · {cell?.complete && cell.baseline !== null ? `Dasar Rp${formatMoney(cell.baseline, 'full')}` : 'Riwayat belum lengkap'}</summary>
            <ul className="mt-2 space-y-2">{(cell?.contextMonths.length ? cell.contextMonths : cell?.months ?? []).map(value => <li key={value.month} className="flex flex-wrap justify-between gap-2">
              <span>{formatDisplayDate(value.month).replace(/^1 /, '')}{cell?.months.some(month => month.month === value.month) ? ' · dasar 3 bulan' : ' · konteks'}</span>
              <span>{value.quality === 'complete' && value.amount !== null ? `Rp${formatMoney(value.amount, 'full')}` : value.quality === 'not_applicable' ? 'Tidak berlaku' : 'Belum lengkap'}</span>
            </li>)}</ul>
          </details>
        })}
      </section>)}
    </div>
  </details>
}
