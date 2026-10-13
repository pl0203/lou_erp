import { Notice } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { useId, useEffect, useRef, useState  } from 'react'
import type { LeaveApproverOption, LeaveMemberSetup, LeaveSetupCommand, LeaveSetupSend, SetupImpacts } from '../../../lib/leave/setupContracts'
import LeaveSetupImpacts from './LeaveSetupImpacts'
import { useSetupUnsaved } from './useSetupUnsaved'
type Props={authorityReady?:boolean;onDirtyChange?:(dirty:boolean)=>void;actorId:string;member:LeaveMemberSetup;approvers:LeaveApproverOption[];calendars:{id:string;name:string}[];groups?:{id:string;name:string}[];impacts:SetupImpacts;send:LeaveSetupSend;onSaved?:(state:{hasUnsavedChanges:boolean})=>void}
/** Parent keys by identity/scope/selection; preserve this editor when onSaved reports remaining drafts. */
export default function LeavePeopleSettings({actorId,member,approvers,calendars,groups=[],impacts,send,onSaved,onDirtyChange,authorityReady=true}:Props){
 const fieldId=useId()
 const [kind,setKind]=useState<NonNullable<LeaveMemberSetup['memberKind']>|''>(member.memberKind??''),[active,setActive]=useState(member.active)
 const [start,setStart]=useState(member.employmentStart??''),[eligible,setEligible]=useState(member.eligibilityDate??''),[calendar,setCalendar]=useState(member.calendarId??'')
 const [approver,setApprover]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[replacement,setReplacement]=useState('')
 const [group,setGroup]=useState(''),[membershipReplacement,setMembershipReplacement]=useState(''),[reason,setReason]=useState(''),[version,setVersion]=useState(member.version)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),submitting=useRef(false)
 // Shared dates/reason are consumed only by commands that actually send them.
 const drafts={member:JSON.stringify({kind,active,start,eligible,calendar}),approver:JSON.stringify({approver,replacement,from:approver||replacement?from:'',to:approver||replacement?to:''}),group:JSON.stringify({group,membershipReplacement,from:group||membershipReplacement?from:'',to:group||membershipReplacement?to:''}),dates:JSON.stringify({from,to}),reason}
 const [baselines,setBaselines]=useState(drafts)
 const hasUnsaved=(saved=baselines)=>Object.keys(drafts).some(key=>drafts[key as keyof typeof drafts]!==saved[key as keyof typeof drafts])
 useSetupUnsaved(hasUnsaved())
 const dirty=hasUnsaved();useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)},[dirty,onDirtyChange])
 const own=actorId===member.id, base={employeeId:member.id,expectedVersion:version,reason}
 const allowedApproverKinds=member.allowedApproverKinds??(member.memberKind==='manager'?['director']:member.memberKind==='employee'?['manager']:[])
 const edit=(action:()=>void)=>{action();setSaved(false)}
 async function save(command:LeaveSetupCommand){if(submitting.current||own||!authorityReady)return;submitting.current=true;setBusy(true);setError('');setSaved(false)
  try{const result=await send(command);setVersion(result.version)
   const next={...baselines,reason}
   if(command.operation==='set_member')next.member=drafts.member
   if(command.operation==='set_group_membership'){next.group=drafts.group;next.dates=drafts.dates}
   if(command.operation==='set_approver'){
    if(command.approverId===null)next.approver=JSON.stringify({...JSON.parse(baselines.approver),replacement})
    else{next.approver=drafts.approver;next.dates=drafts.dates}
   }
   setBaselines(next);setSaved(true);onSaved?.({hasUnsavedChanges:hasUnsaved(next)})}catch{setError('Pengaturan belum dapat disimpan. Isian tetap ada. Pulihkan hasil bila status pengiriman belum pasti.')}finally{submitting.current=false;setBusy(false)}}
 if(!authorityReady)return <p role="status" className="ui-notice ui-notice--info">Memeriksa akses pengaturan anggota...</p>
 return <section className="ui-section space-y-4" aria-label="Pengaturan anggota">
  <h2 className="font-semibold">{member.name}</h2><LeaveSetupImpacts impacts={impacts}/>
  {own&&<p>Administrator lain harus mengatur keanggotaan dan penugasan Anda.</p>}
  {member.memberKind==='director'&&<p>Direktur tidak memperoleh jatah dan tidak dapat diubah menjadi karyawan untuk memperoleh cuti.</p>}
  <Field id={`${fieldId}-1`} label="Jenis anggota">{control=><select {...control} aria-label="Jenis anggota" value={kind} disabled={busy||own||member.memberKind==='director'} onChange={e=>edit(()=>setKind(e.target.value as typeof kind))}><option value="">Belum ditetapkan</option><option value="employee">Karyawan</option><option value="manager">Manajer</option><option value="director">Direktur</option></select>}</Field>
  <label className="flex min-h-[var(--ui-control-size)] items-center gap-2 text-[length:var(--ui-text-label)] leading-[var(--ui-line-control)] font-medium"><input type="checkbox" checked={active} disabled={busy||own} onChange={e=>edit(()=>setActive(e.target.checked))}/> Anggota aktif</label>
  <Field id={`${fieldId}-2`} label="Mulai bekerja">{control=><input {...control} aria-label="Mulai bekerja" type="date" value={start} disabled={busy||own} onChange={e=>edit(()=>setStart(e.target.value))}/>}</Field>
  <Field id={`${fieldId}-3`} label="Tanggal kelayakan">{control=><input {...control} aria-label="Tanggal kelayakan" type="date" value={eligible} disabled={busy||own} onChange={e=>edit(()=>setEligible(e.target.value))}/>}</Field>
  <Field id={`${fieldId}-4`} label="Kalender">{control=><select {...control} aria-label="Kalender" value={calendar} disabled={busy||own||kind==='director'} onChange={e=>edit(()=>setCalendar(e.target.value))}><option value="">Belum ditetapkan</option>{calendars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
  <Field id={`${fieldId}-5`} label="Alasan perubahan">{control=><input {...control} aria-label="Alasan perubahan" value={reason} disabled={busy||own} onChange={e=>edit(()=>setReason(e.target.value))}/>}</Field>
  <Button type="button" disabled={busy||own||!kind||!reason.trim()} onClick={()=>kind&&void save({...base,operation:'set_member',memberKind:kind,active,employmentStart:start||null,eligibilityDate:eligible||null,calendarId:kind==='director'?null:calendar||null})} variant="primary">Simpan anggota</Button>
  <fieldset className="space-y-2 border-t pt-3" disabled={busy||own}>
   <legend>Penyetuju dan kelompok efektif</legend><p className="text-base">Batas tanggal menggunakan zona waktu kalender yang dikonfirmasi. Batas akhir tidak termasuk.</p>
   <Field id={`${fieldId}-6`} label="Penyetuju">{control=><select {...control} aria-label="Penyetuju" value={approver} onChange={e=>edit(()=>setApprover(e.target.value))}><option value="">Pilih secara eksplisit</option>{approvers.filter(a=>a.active&&a.id!==actorId&&a.id!==member.id&&allowedApproverKinds.includes(a.memberKind)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>}</Field>
   <Field id={`${fieldId}-7`} label="Berlaku mulai">{control=><input {...control} aria-label="Berlaku mulai" type="date" value={from} onChange={e=>edit(()=>setFrom(e.target.value))}/>}</Field>
   <Field id={`${fieldId}-8`} label="Berlaku sampai (eksklusif)">{control=><input {...control} aria-label="Berlaku sampai (eksklusif)" type="date" value={to} onChange={e=>edit(()=>setTo(e.target.value))}/>}</Field>
   <Field id={`${fieldId}-9`} label="Penugasan yang diubah">{control=><select {...control} aria-label="Penugasan yang diubah" value={replacement} onChange={e=>edit(()=>setReplacement(e.target.value))}><option value="">Tidak mengganti interval</option>{member.assignments?.filter(a=>a.approverId!==actorId).map(a=><option key={a.id} value={a.id}>{approvers.find(p=>p.id===a.approverId)?.name??a.approverId} · {a.effectiveFrom}</option>)}</select>}</Field>
   <Button type="button" disabled={!approver||!from||!reason.trim()||member.memberKind==='director'} onClick={()=>void save({...base,operation:'set_approver',approverId:approver,effectiveFrom:from,effectiveUntil:to||null,replaceAssignmentId:replacement||null})} variant="primary">Simpan penyetuju</Button>
   <Button type="button" disabled={!replacement||!reason.trim()} onClick={()=>void save({...base,operation:'set_approver',approverId:null,effectiveFrom:null,effectiveUntil:null,replaceAssignmentId:replacement})} variant="danger">Cabut penyetuju</Button>
   <Field id={`${fieldId}-10`} label="Kelompok Sabtu">{control=><select {...control} aria-label="Kelompok Sabtu" value={group} onChange={e=>edit(()=>setGroup(e.target.value))}><option value="">Belum ditetapkan</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}</Field>
   <Field id={`${fieldId}-11`} label="Keanggotaan yang diakhiri">{control=><select {...control} aria-label="Keanggotaan yang diakhiri" value={membershipReplacement} onChange={e=>edit(()=>setMembershipReplacement(e.target.value))}><option value="">Tidak mengganti interval</option>{member.memberships?.map(m=><option key={m.id} value={m.id}>{groups.find(g=>g.id===m.groupId)?.name??m.groupId} · {m.effectiveFrom}</option>)}</select>}</Field>
   <Button type="button" disabled={!group||!from||!reason.trim()||member.memberKind==='director'} onClick={()=>void save({...base,operation:'set_group_membership',groupId:group,effectiveFrom:from,effectiveUntil:to||null,replaceMembershipId:membershipReplacement||null})} variant="primary">Simpan kelompok</Button>
  </fieldset>
  <p className="text-base">Kebijakan, saldo awal, pemberian pertama, aturan pemberitahuan/pembatalan, audiens dan penerimaan kontrol memerlukan pengaturan terpisah.</p>
  {error&&<Notice tone="error" title={<> {error} </>}/>}{saved&&<p role="status" className="ui-notice ui-notice--info">Pengaturan tersimpan. Muat ulang konteks sebelum tindakan berikutnya.</p>}
 </section>
}
