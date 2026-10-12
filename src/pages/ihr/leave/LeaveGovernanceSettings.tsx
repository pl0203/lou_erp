import { Field } from '../../../components/ui/Field'
import { useId } from 'react'
import type { GovernanceEvidence,GovernanceKind } from '../../../lib/leave/adminContracts'
export default function LeaveGovernanceSettings({kind,evidence,value,onChange,disabled}:{kind:GovernanceKind;evidence:GovernanceEvidence[];value:string;onChange:(v:string)=>void;disabled:boolean}){
 const fieldId=useId()
 const title=kind==='retention'?'Retensi':'Tinjauan akses',selected=evidence.find(a=>a.id===value)
 return <fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold">{title}</legend>
 <p>Pilih bukti persetujuan eksternal yang sudah tercatat. Pemilik, jadwal atau persetujuan tidak dapat dibuat dari formulir ini.</p>
 <Field id={`${fieldId}-1`} label={<>Bukti {title.toLowerCase()}</>}>{control=><select {...control} aria-label={`Bukti ${title.toLowerCase()}`}  value={value} onChange={e=>onChange(e.target.value)}><option value="">Belum dipilih</option>{evidence.filter(a=>a.kind===kind).map(a=><option key={a.id} value={a.id}>{a.ruleId??'Aturan belum lengkap'} · versi {a.ruleVersion??'belum ada'}{a.selected?' · digunakan':''}</option>)}</select>}</Field>
 {selected&&<dl className="grid grid-cols-[auto_1fr] gap-2 break-words text-base"><dt>Persetujuan</dt><dd>{selected.confirmed?'Dikonfirmasi':'Belum dikonfirmasi'}</dd><dt>Penyetuju</dt><dd>{selected.approvedBy??'Belum ada'}</dd><dt>Tanggal</dt><dd>{selected.approvedAt??'Belum ada'}</dd><dt>Pemilik</dt><dd>{selected.accountableOwner??'Belum ada'}</dd>{kind==='access_review'&&<><dt>Jadwal</dt><dd>{selected.cadence??'Belum disetujui'}</dd></>}<dt>Kemampuan</dt><dd>{selected.capabilities?.join(', ')||'Belum disetujui'}</dd><dt>Izin tercakup</dt><dd>{selected.grantIds?.join(', ')||'Belum ada'}</dd><dt>Audiens data</dt><dd>{selected.audienceIds?.join(', ')||'Belum disetujui'}</dd></dl>}
 </fieldset>
}
