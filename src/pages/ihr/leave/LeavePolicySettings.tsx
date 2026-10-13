import { Field } from '../../../components/ui/Field'
import { useId } from 'react'
import type { LeaveAdminPolicy,LeavePolicyDraft } from '../../../lib/leave/adminContracts'
function Choice({label,value,onChange}:{label:string;value:boolean|null;onChange:(v:boolean|null)=>void}){
 const fieldId=useId()
 return <Field id={`${fieldId}-1`} label={<>{label}</>}>{control=><select {...control}  aria-label={label} value={value===null?'':String(value)} onChange={e=>onChange(e.target.value===''?null:e.target.value==='true')}><option value="">Belum dikonfirmasi</option><option value="true">Ya, dikonfirmasi</option><option value="false">Tidak, dikonfirmasi</option></select>}</Field>}
export type PolicyFieldsProps={value:LeavePolicyDraft;onChange:(value:LeavePolicyDraft)=>void;disabled:boolean}
export function LeavePolicyFields({value:p,onChange,disabled}:PolicyFieldsProps){
 const fieldId=useId()
 const change=<K extends keyof LeavePolicyDraft>(k:K,v:LeavePolicyDraft[K])=>onChange({...p,[k]:v})
 return <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2"><legend className="font-semibold">Kebijakan tahunan dan aturan permohonan</legend>
  <p className="sm:col-span-2">Cuti tahunan saja: jatah 5.400 menit; hari kerja 450; Sabtu terjadwal dan setengah hari 225. Tidak ada carryover atau pemberian otomatis bagi pegawai baru.</p>
  <Field id={`${fieldId}-2`} label="Berlaku mulai kebijakan">{control=><input {...control}  aria-label="Berlaku mulai kebijakan" type="date" value={p.effectiveFrom} onChange={e=>change('effectiveFrom',e.target.value)}/>}</Field>
  <Field id={`${fieldId}-3`} label="Berlaku sampai kebijakan (eksklusif)">{control=><input {...control}  aria-label="Berlaku sampai kebijakan (eksklusif)" type="date" value={p.effectiveUntil??''} onChange={e=>change('effectiveUntil',e.target.value||null)}/>}</Field>
  {([['minimumNoticeDays','Pemberitahuan minimum (hari)'],['bookingHorizonDays','Batas pemesanan (hari)']] as const).map(([k,label])=><Field id={`${fieldId}-4-${k}`} label={<>{label}</>} key={k}>{control=><input {...control}  aria-label={label} type="number" min="0" max="366" step="1" value={p[k]??''} onChange={e=>change(k,e.target.value===''?null:Number(e.target.value))}/>}</Field>)}
  {([['reasonRequired','Alasan pengajuan wajib'],['reservePendingAccepted','Permohonan menunggu mencadangkan saldo'],['singleDateRuleAccepted','Satu permohonan aktif per tanggal'],['cancellationAllowPast','Pembatalan tanggal lampau diizinkan'],['cancellationAllowRepeatDeclined','Pengulangan setelah pembatalan ditolak diizinkan'],['cancellationReasonRequired','Alasan pembatalan wajib']] as const).map(([k,label])=><Choice key={k} label={label} value={p[k]} onChange={v=>change(k,v)}/>)}
  <Field id={`${fieldId}-5`} label="Jenis pembatalan">{control=><select {...control}  aria-label="Jenis pembatalan" value={p.cancellationMode??''} onChange={e=>change('cancellationMode',e.target.value==='whole_request'?'whole_request':null)}><option value="">Belum dikonfirmasi</option><option value="whole_request">Seluruh permohonan</option></select>}</Field>
  <Field id={`${fieldId}-6`} label="Lingkup kalender">{control=><select {...control}  aria-label="Lingkup kalender" value={p.calendarAudience??''} onChange={e=>change('calendarAudience',e.target.value==='explicit_grants'?'explicit_grants':null)}><option value="">Belum dikonfirmasi</option><option value="explicit_grants">Penerima dengan izin eksplisit</option></select>}</Field>
  {([['annualPolicyConfirmed','Kebijakan tahunan dikonfirmasi'],['requestRulesConfirmed','Aturan pengajuan dikonfirmasi'],['cancellationRulesConfirmed','Aturan pembatalan dikonfirmasi'],['calendarAudienceConfirmed','Lingkup kalender dikonfirmasi']] as const).map(([k,label])=><label className="flex min-h-[var(--ui-control-size)] items-center gap-2 text-[length:var(--ui-text-label)] leading-[var(--ui-line-control)] font-medium" key={k}><input type="checkbox" checked={p[k]} onChange={e=>change(k,e.target.checked)}/>{label}</label>)}
 </fieldset>
}
export function LeavePolicyActivation({policies,value,onChange,confirmed,onConfirmed,disabled}:{policies:LeaveAdminPolicy[];value:string;onChange:(id:string)=>void;confirmed:boolean;onConfirmed:(v:boolean)=>void;disabled:boolean}){
 const fieldId=useId()
 return <fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold">Aktifkan kebijakan untuk anggota ini</legend>
 <Field id={`${fieldId}-7`} label="Kebijakan yang ditinjau">{control=><select {...control}  aria-label="Kebijakan yang ditinjau" value={value} onChange={e=>onChange(e.target.value)}><option value="">Pilih versi secara eksplisit</option>{policies.map(p=><option key={p.id} value={p.id}>Versi {p.version} · {p.effectiveFrom}</option>)}</select>}</Field>
 <label className="flex min-h-[var(--ui-control-size)] items-center gap-2 text-[length:var(--ui-text-label)] leading-[var(--ui-line-control)] font-medium"><input type="checkbox" checked={confirmed} onChange={e=>onConfirmed(e.target.checked)}/> Kelayakan pegawai lama telah diverifikasi dari sumber resmi</label>
 <p>Persetujuan retensi, tinjauan akses dan lingkup kalender diperlukan. Saldo serta riwayat permohonan asli tetap tersimpan.</p>
 </fieldset>
}
