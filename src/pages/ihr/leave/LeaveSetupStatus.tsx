import type { LeaveContext } from '../../../lib/leave/contracts'
export default function LeaveSetupStatus({ context }: { context: LeaveContext }) {
  if (context.setup.ready) return null
  return <section role="status" className="ui-notice ui-notice--warning">
    <h2 className="ui-notice__title">{context.memberKind === 'director' ? 'Akses persetujuan cuti' : 'Pengaturan cuti belum lengkap'}</h2>
    <p className="mt-1">{context.memberKind === 'director' ? 'Direktur hanya menyetujui permohonan yang ditugaskan dan tidak menerima saldo cuti.' : 'Pengajuan belum tersedia. Saldo belum dapat ditampilkan sampai pengaturan diverifikasi.'}</p>
    <ul className="mt-2 list-disc pl-5">{context.setup.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.message}</li>)}</ul>
  </section>
}
