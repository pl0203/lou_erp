import type { LeaveContext } from '../../../lib/leave/contracts'
export default function LeaveSetupStatus({ context }: { context: LeaveContext }) {
  if (context.setup.ready) return null
  return <section role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
    <h2 className="font-semibold">{context.memberKind === 'director' ? 'Akses persetujuan cuti' : 'Pengaturan cuti belum lengkap'}</h2>
    <p className="mt-1">{context.memberKind === 'director' ? 'Direktur hanya menyetujui permohonan yang ditugaskan dan tidak menerima saldo cuti.' : 'Pengajuan belum tersedia. Saldo belum dapat ditampilkan sampai pengaturan diverifikasi.'}</p>
    <ul className="mt-2 list-disc pl-5">{context.setup.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.message}</li>)}</ul>
  </section>
}
