import type { LeaveAdminPolicy,LeavePolicyDraft } from '../../../lib/leave/adminContracts'
const control='mt-1 block min-h-11 w-full rounded border p-2'
function Choice({label,value,onChange}:{label:string;value:boolean|null;onChange:(v:boolean|null)=>void}){return <label className="block">{label}<select className={control} aria-label={label} value={value===null?'':String(value)} onChange={e=>onChange(e.target.value===''?null:e.target.value==='true')}><option value="">Belum dikonfirmasi</option><option value="true">Ya, dikonfirmasi</option><option value="false">Tidak, dikonfirmasi</option></select></label>}
export type PolicyFieldsProps={value:LeavePolicyDraft;onChange:(value:LeavePolicyDraft)=>void;disabled:boolean}
export function LeavePolicyFields({value:p,onChange,disabled}:PolicyFieldsProps){
 const change=<K extends keyof LeavePolicyDraft>(k:K,v:LeavePolicyDraft[K])=>onChange({...p,[k]:v})
 return <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2"><legend className="font-semibold">Kebijakan tahunan dan aturan permohonan</legend>
  <p className="sm:col-span-2">Cuti tahunan saja: jatah 5.400 menit; hari kerja 450; Sabtu terjadwal dan setengah hari 225. Tidak ada carryover atau pemberian otomatis bagi pegawai baru.</p>
  <label>Berlaku mulai kebijakan<input className={control} aria-label="Berlaku mulai kebijakan" type="date" value={p.effectiveFrom} onChange={e=>change('effectiveFrom',e.target.value)}/></label>
  <label>Berlaku sampai kebijakan (eksklusif)<input className={control} aria-label="Berlaku sampai kebijakan (eksklusif)" type="date" value={p.effectiveUntil??''} onChange={e=>change('effectiveUntil',e.target.value||null)}/></label>
  {([['minimumNoticeDays','Pemberitahuan minimum (hari)'],['bookingHorizonDays','Batas pemesanan (hari)']] as const).map(([k,label])=><label key={k}>{label}<input className={control} aria-label={label} type="number" min="0" max="366" step="1" value={p[k]??''} onChange={e=>change(k,e.target.value===''?null:Number(e.target.value))}/></label>)}
  {([['reasonRequired','Alasan pengajuan wajib'],['reservePendingAccepted','Permohonan menunggu mencadangkan saldo'],['singleDateRuleAccepted','Satu permohonan aktif per tanggal'],['cancellationAllowPast','Pembatalan tanggal lampau diizinkan'],['cancellationAllowRepeatDeclined','Pengulangan setelah pembatalan ditolak diizinkan'],['cancellationReasonRequired','Alasan pembatalan wajib']] as const).map(([k,label])=><Choice key={k} label={label} value={p[k]} onChange={v=>change(k,v)}/>)}
  <label>Jenis pembatalan<select className={control} aria-label="Jenis pembatalan" value={p.cancellationMode??''} onChange={e=>change('cancellationMode',e.target.value==='whole_request'?'whole_request':null)}><option value="">Belum dikonfirmasi</option><option value="whole_request">Seluruh permohonan</option></select></label>
  <label>Lingkup kalender<select className={control} aria-label="Lingkup kalender" value={p.calendarAudience??''} onChange={e=>change('calendarAudience',e.target.value==='explicit_grants'?'explicit_grants':null)}><option value="">Belum dikonfirmasi</option><option value="explicit_grants">Penerima dengan izin eksplisit</option></select></label>
  {([['annualPolicyConfirmed','Kebijakan tahunan dikonfirmasi'],['requestRulesConfirmed','Aturan pengajuan dikonfirmasi'],['cancellationRulesConfirmed','Aturan pembatalan dikonfirmasi'],['calendarAudienceConfirmed','Lingkup kalender dikonfirmasi']] as const).map(([k,label])=><label className="flex min-h-11 items-center gap-2" key={k}><input type="checkbox" checked={p[k]} onChange={e=>change(k,e.target.checked)}/>{label}</label>)}
 </fieldset>
}
export function LeavePolicyActivation({policies,value,onChange,confirmed,onConfirmed,disabled}:{policies:LeaveAdminPolicy[];value:string;onChange:(id:string)=>void;confirmed:boolean;onConfirmed:(v:boolean)=>void;disabled:boolean}){
 return <fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold">Aktifkan kebijakan untuk anggota ini</legend>
 <label>Kebijakan yang ditinjau<select className={control} aria-label="Kebijakan yang ditinjau" value={value} onChange={e=>onChange(e.target.value)}><option value="">Pilih versi secara eksplisit</option>{policies.map(p=><option key={p.id} value={p.id}>Versi {p.version} · {p.effectiveFrom}</option>)}</select></label>
 <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmed} onChange={e=>onConfirmed(e.target.checked)}/> Kelayakan pegawai lama telah diverifikasi dari sumber resmi</label>
 <p>Persetujuan retensi, tinjauan akses dan lingkup kalender diperlukan. Saldo serta riwayat permohonan asli tetap tersimpan.</p>
 </fieldset>
}
