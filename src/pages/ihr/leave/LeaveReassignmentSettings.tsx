import type { LeaveAdminRequest } from '../../../lib/leave/adminContracts'
export default function LeaveReassignmentSettings({rows,requestId,onRequest,assignmentId,onAssignment,disabled}:{rows:LeaveAdminRequest[];requestId:string;onRequest:(v:string)=>void;assignmentId:string;onAssignment:(v:string)=>void;disabled:boolean}){
 return <fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold">Penugasan ulang satu permohonan</legend>
 <p>Memerlukan izin konfigurasi dan data pribadi untuk anggota ini. Riwayat penyetuju, hari dan perhitungan asli tidak berubah. Pembatalan yang menunggu dapat dialihkan secara eksplisit untuk percobaan yang sama. Pemakaian dan tanggal tetap terpakai sampai keputusan pembatalan.</p>
 <label>Permohonan yang dialihkan<select aria-label="Permohonan yang dialihkan" className="block min-h-11 w-full rounded border p-2" value={requestId} onChange={e=>onRequest(e.target.value)}><option value="">Pilih satu permohonan</option>{rows.map(r=><option key={r.id} value={r.id}>{r.startDate}–{r.endDate} · {r.status==='cancellation_pending'?'Pembatalan menunggu':'Pengajuan menunggu'} · {r.approverName} · versi {r.version}</option>)}</select></label>
 <label>ID penugasan efektif baru<input aria-label="ID penugasan efektif baru" className="block min-h-11 w-full rounded border p-2" value={assignmentId} onChange={e=>onAssignment(e.target.value)}/></label>
 <p>Server memverifikasi penugasan aktif dan menolak penunjukan diri sendiri.</p>
 </fieldset>
}
