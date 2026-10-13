import { EmptyState } from '../../../components/ui/Feedback'
import { Field } from '../../../components/ui/Field'
import { useId } from 'react'
import type { LeaveAdminAccessData } from '../../../lib/leave/adminContracts'
export default function LeaveAccessSettings({actorId,data,manifestId,onManifest,grantId,onGrant,disabled}:{actorId:string;data:LeaveAdminAccessData;manifestId:string;onManifest:(v:string)=>void;grantId:string;onGrant:(v:string)=>void;disabled:boolean}){
 const fieldId=useId()
 const manifest=data.manifests.find(m=>m.id===manifestId)
 return <fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold">Izin dengan lingkup eksplisit</legend>
 <p>Konfigurasi, penyesuaian saldo, data pribadi, kalender dan pengelolaan izin adalah kemampuan terpisah. Manifest harus disetujui di luar aplikasi.</p>
 <Field id={`${fieldId}-1`} label="Manifest izin yang disetujui">{control=><select {...control} aria-label="Manifest izin yang disetujui"  value={manifestId} onChange={e=>onManifest(e.target.value)}><option value="">Pilih manifest</option>{data.manifests.filter(m=>m.actorId!==actorId).map(m=><option key={m.id} value={m.id}>{m.actorId} · {m.capability} · {m.effectiveFrom}</option>)}</select>}</Field>
 {manifest&&<p className="break-words [overflow-wrap:anywhere] text-base">Penerima {manifest.actorId}; anggota {manifest.employeeId}; kemampuan {manifest.capability}; berlaku {manifest.effectiveFrom} sampai {manifest.effectiveUntil??'tanpa batas akhir yang ditetapkan'}; disetujui {manifest.approvedBy} pada {manifest.approvedAt}; sumber {manifest.approvalReference}</p>}
 {!data.manifests.length&&<EmptyState title="Belum ada manifest izin baru yang dapat digunakan."/>}
 <Field id={`${fieldId}-2`} label="Izin yang akan dicabut">{control=><select {...control} aria-label="Izin yang akan dicabut"  value={grantId} onChange={e=>onGrant(e.target.value)}><option value="">Pilih izin eksplisit</option>{data.grants.filter(g=>!g.revoked&&g.actorId!==actorId).map(g=><option key={g.id} value={g.id}>{g.actorId} · {g.capability} · versi {g.version}</option>)}</select>}</Field>
 </fieldset>
}
