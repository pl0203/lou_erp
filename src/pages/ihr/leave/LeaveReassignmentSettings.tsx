import { Field } from '../../../components/ui/Field'
import { useId } from 'react'
import type { LeaveAdminRequest } from '../../../lib/leave/adminContracts'
export default function LeaveReassignmentSettings({rows,requestId,onRequest,assignmentId,onAssignment,disabled}:{rows:LeaveAdminRequest[];requestId:string;onRequest:(v:string)=>void;assignmentId:string;onAssignment:(v:string)=>void;disabled:boolean}){
 const fieldId=useId()
 return <fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold">Penugasan ulang satu permohonan</legend>
 <p>Memerlukan izin konfigurasi dan data pribadi untuk anggota ini. Riwayat penyetuju, hari dan perhitungan asli tidak berubah. Pembatalan yang menunggu dapat dialihkan secara eksplisit untuk percobaan yang sama. Pemakaian dan tanggal tetap terpakai sampai keputusan pembatalan.</p>
 <Field id={`${fieldId}-1`} label="Permohonan yang dialihkan">{control=><select {...control} aria-label="Permohonan yang dialihkan"  value={requestId} onChange={e=>onRequest(e.target.value)}><option value="">Pilih satu permohonan</option>{rows.map(r=><option key={r.id} value={r.id}>{r.startDate}–{r.endDate} · {r.status==='cancellation_pending'?'Pembatalan menunggu':'Pengajuan menunggu'} · {r.approverName} · versi {r.version}</option>)}</select>}</Field>
 <Field id={`${fieldId}-2`} label="ID penugasan efektif baru">{control=><input {...control} aria-label="ID penugasan efektif baru"  value={assignmentId} onChange={e=>onAssignment(e.target.value)}/>}</Field>
 <p>Server memverifikasi penugasan aktif dan menolak penunjukan diri sendiri.</p>
 </fieldset>
}
