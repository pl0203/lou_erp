import type { SetupImpacts } from '../../../lib/leave/setupContracts'
export default function LeaveSetupImpacts({impacts}:{impacts:SetupImpacts}){
 return <aside className="ui-notice ui-notice--warning"><p>{impacts.available?`${(impacts.pendingCount??0)+(impacts.approvedCount??0)} permohonan tertunda/disetujui dalam cakupan perubahan`:'Dampak permohonan belum tersedia. Tinjau dampak sebelum menggunakan pengaturan ini.'}</p><p>Snapshot permohonan tidak dihitung ulang dan saldo tidak dikembalikan otomatis.</p></aside>
}
