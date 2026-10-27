import type { SetupImpacts } from '../../../lib/leave/setupContracts'
export default function LeaveSetupImpacts({impacts}:{impacts:SetupImpacts}){
 return <aside className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>{impacts.available?`${(impacts.pendingCount??0)+(impacts.approvedCount??0)} permohonan tertunda/disetujui dalam cakupan perubahan`:'Dampak permohonan belum tersedia. Tinjau dampak sebelum menggunakan pengaturan ini.'}</p><p>Snapshot permohonan tidak dihitung ulang dan saldo tidak dikembalikan otomatis.</p></aside>
}
