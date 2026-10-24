import { useLayoutEffect,useRef,useState } from 'react'
import { useParams,useSearchParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { FormActions } from '../../../components/ui/FormActions'
import { Notice } from '../../../components/ui/Feedback'
import { useEmployeeContext } from '../../../lib/employees/useEmployeeContext'
import { useEmployeeDetail } from '../../../lib/employees/useEmployeeReads'
import { normalizeEmployeeProposal } from '../../../lib/employees/contracts'
import type { AccountCandidate,EmployeeDetail as Detail,EmployeeFields,EmployeeProposal,EpisodeInput } from '../../../lib/employees/contracts'
import EmployeeAccountLink from './EmployeeAccountLink'
import { characterCount,characterError,dateLabel,EditorFeedback,EditorReview,EmployeeReadState,EmployeeShell,OperationRecovery,TimezoneNotice,useEmployeeEditorActions } from './EmployeeUI'
const blankFields:EmployeeFields={name:'',employeeNumber:null,jobTitle:null,team:null,recordedStatus:'draft'}
const blankEpisode:EpisodeInput={startDate:null,endDate:null,sourceReference:null}
type Section='basic'|'episode'|'account'
export default function EmployeeEditor() {
 const {employeeId}=useParams()
 return employeeId?<ExistingEditor employeeId={employeeId}/>:<EditorForm/>
}
function ExistingEditor({employeeId}:{employeeId:string}) {const read=useEmployeeDetail(employeeId);return <EditorForm employeeId={employeeId} read={read}/>}
function EditorForm({employeeId,read}:{employeeId?:string;read?:ReturnType<typeof useEmployeeDetail>}) {
 const authority=useEmployeeContext(),[search]=useSearchParams()
 const requested=search.get('section'),[section,setSection]=useState<Section>(employeeId&&(requested==='episode'||requested==='account')?requested:'basic')
 const [fields,setFields]=useState<EmployeeFields>(blankFields),[episode,setEpisode]=useState<EpisodeInput>(blankEpisode),[selected,setSelected]=useState<AccountCandidate|null>(null),[quarantine,setQuarantine]=useState(false),[reason,setReason]=useState(''),[effectiveDate,setEffectiveDate]=useState('')
 const [base,setBase]=useState<Detail|null>(null),initialized=useRef(false)
 const dirty=!!reason||!!effectiveDate||!!selected||quarantine||JSON.stringify(fields)!==JSON.stringify(base?.fields??blankFields)||JSON.stringify(episode)!==JSON.stringify(base?.episode??blankEpisode)
 const stale=!!(base&&read?.data&&base.version!==read.data.version)
 const reviewEligible=!stale&&!(section==='account'&&base?.account&&(!quarantine||base.account.quarantined))
 const actions=useEmployeeEditorActions(employeeId,currentProposal,dirty,reviewEligible,!employeeId||!!read?.data)
 const reset=(data:Detail|null)=>{setBase(data);setFields(data?.fields??blankFields);setEpisode(data?.episode??blankEpisode);setSelected(null);setQuarantine(false);setReason('');setEffectiveDate('')}
 useLayoutEffect(()=>{initialized.current=false;reset(null)},[employeeId,actions.command.draftGeneration])
 useLayoutEffect(()=>{if(read?.data&&!initialized.current){initialized.current=true;reset(read.data)}},[read?.data,actions.command.draftGeneration])
 const ready=actions.command.authorityReady&&(!employeeId||!!read?.data)
 const displayReady=authority.displayAllowed&&!!authority.displayContext?.canMaintainBasic&&(!employeeId||!!read?.displayData)
 const recover=!!actions.command.recoveryEmployeeId||['submitting','recovering','completed'].includes(actions.command.phase)||(actions.command.phase==='blocked'&&(!actions.command.employeeId||!!actions.command.error))
 function currentProposal(id:string):EmployeeProposal|null {
  const common={employeeId:id,expectedVersion:base?.version??0,reason,effectiveDate:effectiveDate||null,sourceReference:section==='episode'?episode.sourceReference:null}
  if(section==='episode')return {...common,action:'save_initial_episode',payload:episode}
  if(section==='account')return base?.account?{...common,action:'quarantine_account_link',payload:{userId:base.account.userId}}:selected?{...common,action:'link_account',payload:{userId:selected.userId}}:null
  return {...common,action:employeeId?'edit_employee':'create_employee',payload:fields}
 }
 function problem() {
  if(!reason.trim())return 'Alasan perubahan wajib diisi.'
  if(stale)return 'Data berubah. Muat data terbaru lalu tinjau kembali draf Anda.'
  if(!authority.context?.timezone&&(effectiveDate||(section==='episode'&&(episode.startDate||episode.endDate||base?.episode?.startDate||base?.episode?.endDate))))return 'Konfirmasi zona waktu perusahaan sebelum menyimpan perubahan bertanggal.'
  if(section==='account'&&!base?.account&&!selected)return 'Pilih satu akun yang sudah diperiksa.'
  if(section==='account'&&base?.account&&(!quarantine||base.account.quarantined))return 'Konfirmasi karantina tautan sebelum meninjau.'
  try{const value=actions.command.employeeId&&currentProposal(actions.command.employeeId);if(!value)return 'Data belum siap. Coba lagi.';normalizeEmployeeProposal(value)}catch{return 'Periksa nama, tanggal, dan panjang isian. Nama wajib diisi; tanggal berakhir tidak boleh sebelum tanggal mulai.'}
  return ''
 }
 function switchSection(next:Section){if(ready&&next!==section)actions.guard.confirmDiscard(()=>{reset(read?.data??base);setSection(next)})}
 const readState=read??{...actions.command,error:authority.error}
 return <EmployeeShell ready={ready} displayReady={displayReady} refreshing={authority.refreshing||!!read?.refreshing} draftGeneration={actions.command.draftGeneration} title={employeeId?'Ubah data karyawan':'Tambah karyawan'} description="Tinjau dan simpan satu jenis perubahan pada satu waktu. Tidak ada pembuatan login atau undangan.">
 {!displayReady?<EmployeeReadState state={readState}/>:<>
 <TimezoneNotice timezone={authority.displayContext?.timezone}/><EditorFeedback actions={actions}/>
 {recover?<OperationRecovery actions={actions}/>:employeeId&&actions.command.employeeId!==employeeId?<Notice tone="warning" title="Buka ulang catatan yang ingin diubah" actions={<Button variant="secondary" onClick={actions.cancel}>Kembali ke catatan ini</Button>}>Operasi sebelumnya sudah diselesaikan untuk catatan lain. Kembali ke catatan ini sebelum memulai perubahan baru.</Notice>:<>
 {employeeId&&<div className="employee-sections" role="group" aria-label="Jenis data yang diubah"><Button disabled={!ready} variant={section==='basic'?'primary':'secondary'} aria-pressed={section==='basic'} onClick={()=>switchSection('basic')}>Data dasar</Button><Button disabled={!ready} variant={section==='episode'?'primary':'secondary'} aria-pressed={section==='episode'} onClick={()=>switchSection('episode')}>Periode kerja awal</Button><Button disabled={!ready} variant={section==='account'?'primary':'secondary'} aria-pressed={section==='account'} onClick={()=>switchSection('account')}>Tautan akun</Button></div>}
 {stale&&<Notice tone="warning" title="Versi data sudah berubah" actions={<Button variant="secondary" disabled={!ready} onClick={()=>{if(ready)actions.guard.confirmDiscard(()=>reset(read?.data??null))}}>Muat data terbaru</Button>}>Draf tetap ada. Muat versi terbaru secara eksplisit sebelum meninjau lagi; jangan menimpa perubahan Director lain.</Notice>}
 <form className="employee-panel employee-editor" noValidate onSubmit={event=>{event.preventDefault();if(ready)void actions.review(problem())}}>
 <h2>{section==='basic'?'Data dasar':section==='episode'?'Periode kerja awal':'Tautan akun'}</h2>
 {section==='basic'?<><div className="employee-form-grid"><Field id="employee-name" label="Nama lengkap" hint={characterCount(fields.name,160)} error={characterError(fields.name,160)}>{props=><input {...props} disabled={!ready} required autoComplete="off" value={fields.name} onChange={event=>setFields({...fields,name:event.target.value})}/>}</Field><Field id="employee-number" label="Nomor karyawan" hint={`Opsional. Nomor internal perusahaan, bukan nomor identitas pemerintah. ${characterCount(fields.employeeNumber,64)}`} error={characterError(fields.employeeNumber,64)}>{props=><input {...props} disabled={!ready} value={fields.employeeNumber??''} onChange={event=>setFields({...fields,employeeNumber:event.target.value||null})}/>}</Field><Field id="employee-title" label="Jabatan" hint={characterCount(fields.jobTitle,120)} error={characterError(fields.jobTitle,120)}>{props=><input {...props} disabled={!ready} value={fields.jobTitle??''} onChange={event=>setFields({...fields,jobTitle:event.target.value||null})}/>}</Field><Field id="employee-team" label="Tim" hint={characterCount(fields.team,120)} error={characterError(fields.team,120)}>{props=><input {...props} disabled={!ready} value={fields.team??''} onChange={event=>setFields({...fields,team:event.target.value||null})}/>}</Field><Field id="employee-recorded-status" label="Status tercatat" hint="Informasi hubungan kerja, bukan pengaturan login.">{props=><select {...props} disabled={!ready} value={fields.recordedStatus} onChange={event=>setFields({...fields,recordedStatus:event.target.value as EmployeeFields['recordedStatus']})}><option value="draft">Draf</option><option value="active">Aktif tercatat</option><option value="ended">Berakhir tercatat</option></select>}</Field></div>{fields.recordedStatus==='ended'&&<Notice tone="warning" title="Status berakhir tidak menonaktifkan login">Periksa akses akun secara terpisah. Hak akses dan data cuti tetap sama.</Notice>}</>:section==='episode'?<><p>Hanya periode kerja awal. Aktivasi kembali atau periode kerja kedua belum tersedia.</p><div className="employee-form-grid"><Field id="employee-start" label="Tanggal mulai terkonfirmasi" hint={dateLabel(episode.startDate)}>{props=><input {...props} disabled={!ready} type="date" value={episode.startDate??''} onChange={event=>setEpisode({...episode,startDate:event.target.value||null})}/>}</Field><Field id="employee-end" label="Tanggal berakhir terkonfirmasi" hint={dateLabel(episode.endDate)}>{props=><input {...props} disabled={!ready} type="date" value={episode.endDate??''} onChange={event=>setEpisode({...episode,endDate:event.target.value||null})}/>}</Field><Field id="employee-episode-source" label="Sumber periode kerja (opsional)" hint={characterCount(episode.sourceReference,500)} error={characterError(episode.sourceReference,500)}>{props=><input {...props} disabled={!ready} value={episode.sourceReference??''} onChange={event=>setEpisode({...episode,sourceReference:event.target.value||null})}/>}</Field></div><p className="employee-support">Masukkan hanya tanggal yang telah dikonfirmasi. Isian kosong tetap Belum dikonfirmasi, bukan hari ini.</p></>:<EmployeeAccountLink disabled={!ready} account={base?.account??null} selected={selected} onSelect={setSelected} quarantine={quarantine} onQuarantine={setQuarantine}/>}
 <Field id="employee-reason" label="Alasan perubahan" hint={characterCount(reason,500)} error={characterError(reason,500)}>{props=><textarea {...props} disabled={!ready} required rows={3} value={reason} onChange={event=>setReason(event.target.value)}/>}</Field>
 <details className="employee-optional"><summary className="min-h-[var(--ui-control-size)]">Tanggal berlaku (opsional)</summary><Field id="employee-effective" label="Tanggal berlaku terkonfirmasi" hint="Kosong berarti belum dikonfirmasi, bukan tanggal hari ini.">{props=><input {...props} disabled={!ready} type="date" value={effectiveDate} onChange={event=>setEffectiveDate(event.target.value)}/>}</Field></details>
 <FormActions><Button variant="secondary" onClick={actions.cancel}>Batal</Button><Button type="submit" pending={actions.reviewing} disabled={!ready||stale}>Tinjau perubahan</Button></FormActions>
 </form><EditorReview actions={actions} names={selected?{[selected.userId]:`${selected.displayName} · ${selected.email}`}:{}}/>
 </>}
 </>}{actions.guard.dialog}
 </EmployeeShell>
}
