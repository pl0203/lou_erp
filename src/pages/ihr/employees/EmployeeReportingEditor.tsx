import { useLayoutEffect,useRef,useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Field } from '../../../components/ui/Field'
import { FormActions } from '../../../components/ui/FormActions'
import { Notice } from '../../../components/ui/Feedback'
import { normalizeEmployeeProposal } from '../../../lib/employees/contracts'
import type { EmployeeDetail,ReportingInterval } from '../../../lib/employees/contracts'
import { useEmployeeContext } from '../../../lib/employees/useEmployeeContext'
import { useEmployeeDetail,useEmployeePage } from '../../../lib/employees/useEmployeeReads'
import { characterCount,characterError,EmployeeName,EditorFeedback,EditorReview,EmployeeReadState,EmployeeShell,EmptyState,OperationRecovery,Pagination,TimezoneNotice,useEmployeeEditorActions } from './EmployeeUI'
type DraftInterval=Omit<ReportingInterval,'managerEmployeeId'>&{managerEmployeeId:string|null|undefined}
export default function EmployeeReportingEditor() {
 const {employeeId=''}=useParams(),read=useEmployeeDetail(employeeId),authority=useEmployeeContext()
 const [base,setBase]=useState<EmployeeDetail|null>(null),[intervals,setIntervals]=useState<DraftInterval[]>([]),[mode,setMode]=useState<'schedule'|'correction'>('schedule'),[reason,setReason]=useState(''),[source,setSource]=useState(''),[names,setNames]=useState<Record<string,string>>({}),[choosing,setChoosing]=useState<number|null>(null)
 const initialized=useRef(false),trigger=useRef<HTMLElement|null>(null),heading=useRef<HTMLHeadingElement>(null)
 const dirty=!!reason||!!source||mode!=='schedule'||JSON.stringify(intervals)!==JSON.stringify(base?.reporting??[])
 const proposal=(id:string)=>({employeeId:id,expectedVersion:base?.version??0,action:'save_reporting' as const,payload:{mode,intervals:intervals as ReportingInterval[]},reason,effectiveDate:null,sourceReference:source||null})
 const stale=!!(base&&read.data&&base.version!==read.data.version)
 const actions=useEmployeeEditorActions(employeeId,proposal,dirty,!stale,!!read.data)
 const reset=(data:EmployeeDetail|null)=>{setBase(data);setIntervals(data?.reporting??[]);setReason('');setSource('');setMode('schedule');setNames({});setChoosing(null)}
 useLayoutEffect(()=>{initialized.current=false;reset(null)},[employeeId,actions.command.draftGeneration])
 useLayoutEffect(()=>{if(read.data&&!initialized.current){initialized.current=true;reset(read.data)}},[read.data,actions.command.draftGeneration])
 const update=(index:number,patch:Partial<DraftInterval>)=>setIntervals(values=>values.map((value,i)=>i===index?{...value,...patch}:value))
 function problem(){
  if(!authority.context?.timezone)return 'Konfirmasi zona waktu perusahaan sebelum mengubah riwayat pelaporan.'
  if(!reason.trim())return 'Alasan perubahan wajib diisi.'
  if(mode==='correction'&&!source.trim())return 'Sumber koreksi wajib diisi untuk perubahan historis.'
  if(intervals.some(item=>item.managerEmployeeId===undefined))return 'Pilih atasan atau tetapkan Tanpa atasan secara eksplisit untuk setiap periode.'
  if(stale)return 'Data berubah. Muat versi terbaru sebelum meninjau.'
  try{normalizeEmployeeProposal(proposal(employeeId))}catch{return 'Periksa tanggal setiap periode. Tanggal akhir harus setelah tanggal mulai.'}
  return ''
 }
 const ready=actions.command.authorityReady&&read.authorityReady&&!!read.data,recover=!!actions.command.recoveryEmployeeId||['submitting','recovering','completed'].includes(actions.command.phase)||(actions.command.phase==='blocked'&&(!actions.command.employeeId||!!actions.command.error))
 const displayReady=authority.displayAllowed&&!!read.displayData
 return <EmployeeShell ready={ready} displayReady={displayReady} refreshing={authority.refreshing||read.refreshing} draftGeneration={actions.command.draftGeneration} title="Atasan pelaporan" description="Riwayat bertanggal, tanpa perubahan hak akses atau persetujuan.">
 {!displayReady?<EmployeeReadState state={read}/>:<><TimezoneNotice timezone={authority.displayContext?.timezone}/><Notice tone="info" title="Akses operasional tidak berubah">Atasan akses operasional saat ini: {base?.account?.operationalManagerName||'Belum dikonfirmasi'}. Riwayat pelaporan tidak memperbarui akun atau data cuti.</Notice><EditorFeedback actions={actions}/>{recover?<OperationRecovery actions={actions}/>:employeeId&&actions.command.employeeId!==employeeId?<Notice tone="warning" title="Buka ulang catatan yang ingin diubah" actions={<Button variant="secondary" onClick={actions.cancel}>Kembali ke catatan ini</Button>}>Operasi sebelumnya sudah diselesaikan untuk catatan lain. Kembali ke catatan ini sebelum memulai perubahan baru.</Notice>:<><form noValidate className="employee-panel employee-editor" onSubmit={event=>{event.preventDefault();if(ready)void actions.review(problem())}}><h2 ref={heading} tabIndex={-1}>Linimasa lengkap</h2><p>Semua periode di bawah akan ditinjau sebagai pengganti riwayat. Celah tanggal berarti belum diketahui, bukan tanpa atasan. Tanggal akhir tidak termasuk dalam periode.</p>
 {stale&&<Notice tone="warning" title="Versi data sudah berubah" actions={<Button variant="secondary" disabled={!ready} onClick={()=>{if(ready)actions.guard.confirmDiscard(()=>reset(read.data??null))}}>Muat data terbaru</Button>}>Draf dipertahankan; tinjau kembali berdasarkan versi terbaru.</Notice>}
 <Field id="reporting-mode" label="Jenis perubahan">{props=><select {...props} disabled={!ready} value={mode} onChange={event=>setMode(event.target.value as typeof mode)}><option value="schedule">Penjadwalan kini / mendatang</option><option value="correction">Koreksi historis</option></select>}</Field>
 <p className="employee-support">{mode==='schedule'?`Jadwal mempertahankan seluruh riwayat sebelum ${authority.displayContext?.today??'tanggal perusahaan yang terkonfirmasi'}.`:'Koreksi historis memerlukan alasan dan sumber bukti; bukan perubahan izin yang berlaku surut.'}</p>
 {!intervals.length&&<EmptyState title="Belum ada riwayat terkonfirmasi">Tambahkan periode hanya setelah tanggal dan atasannya dipastikan.</EmptyState>}
 {intervals.map((item,index)=><fieldset key={index} className="employee-period"><legend>Periode {index+1}</legend><div className="employee-manager-choice"><p>{item.managerEmployeeId===null?'Tanpa atasan':item.managerEmployeeId?names[item.managerEmployeeId]||<EmployeeName employeeId={item.managerEmployeeId}/>:'Atasan belum dipilih'}</p><Button disabled={!ready} variant="secondary" aria-label={`Pilih atasan periode ${index+1}`} onClick={event=>{if(!ready)return;trigger.current=event.currentTarget;setChoosing(index)}}>Pilih atasan</Button><label className="employee-check"><input disabled={!ready} type="checkbox" aria-label={`Tanpa atasan periode ${index+1}`} checked={item.managerEmployeeId===null} onChange={event=>update(index,{managerEmployeeId:event.target.checked?null:undefined})}/>Tanpa atasan (dikonfirmasi)</label></div><div className="employee-form-grid"><Field id={`reporting-from-${index}`} label={`Mulai periode ${index+1}`}>{props=><input {...props} disabled={!ready} required type="date" value={item.from} onChange={event=>update(index,{from:event.target.value})}/>}</Field><Field id={`reporting-until-${index}`} label={`Akhir periode ${index+1}`} hint="Kosong berarti berlanjut.">{props=><input {...props} disabled={!ready} type="date" value={item.until??''} onChange={event=>update(index,{until:event.target.value||null})}/>}</Field></div><Button disabled={!ready} variant="danger-quiet" aria-label={`Hapus periode ${index+1}`} onClick={()=>{if(ready)setIntervals(values=>values.filter((_,i)=>i!==index))}}>Hapus periode</Button></fieldset>)}
 <Button disabled={!ready} variant="secondary" onClick={()=>{if(ready)setIntervals(values=>[...values,{managerEmployeeId:undefined,from:'',until:null}])}}>Tambah periode</Button>
 <Field id="reporting-reason" label="Alasan perubahan" hint={characterCount(reason,500)} error={characterError(reason,500)}>{props=><textarea {...props} disabled={!ready} required rows={3} value={reason} onChange={event=>setReason(event.target.value)}/>}</Field>{mode==='correction'&&<Field id="reporting-source" label="Sumber koreksi" hint={characterCount(source,500)} error={characterError(source,500)}>{props=><input {...props} disabled={!ready} required value={source} onChange={event=>setSource(event.target.value)}/>}</Field>}
 <FormActions><Button variant="secondary" onClick={actions.cancel}>Batal</Button><Button type="submit" pending={actions.reviewing} disabled={!ready||stale}>Tinjau perubahan</Button></FormActions></form><EditorReview actions={actions} names={names}/></>}
 {choosing!==null&&!recover&&<Dialog labelledBy="reporting-manager-title" pending={false} returnFocus={trigger.current} fallbackFocus={()=>heading.current} onClose={()=>setChoosing(null)}><h2 id="reporting-manager-title">Pilih atasan pelaporan</h2><ManagerPicker disabled={!ready} employeeId={employeeId} onSelect={(id,name)=>{if(!ready)return;update(choosing,{managerEmployeeId:id});setNames(values=>({...values,[id]:name}));setChoosing(null)}}/><FormActions><Button variant="secondary" onClick={()=>setChoosing(null)}>Tutup</Button></FormActions></Dialog>}
 </>}{actions.guard.dialog}</EmployeeShell>
}
function ManagerPicker({employeeId,onSelect,disabled=false}:{employeeId:string;disabled?:boolean;onSelect:(id:string,name:string)=>void}) {
 const [query,setQuery]=useState(''),[page,setPage]=useState(1),read=useEmployeePage({query,status:null,page}),data=read.displayData,ready=!disabled&&read.authorityReady&&!!read.data
 return <><Field id="reporting-manager-search" label="Cari nama atasan" hint={characterCount(query,120)} error={characterError(query,120)}>{props=><input {...props} disabled={!ready} type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}}/>}</Field>{data?<><ul className="employee-choices">{data.rows.map(row=><li key={row.id}><span>{row.name}</span><Button variant="secondary" disabled={!ready||row.id===employeeId} aria-label={`Pilih ${row.name}`} onClick={()=>{const current=ready?read.data?.rows.find(value=>value.id===row.id):undefined;if(current&&current.id!==employeeId)onSelect(current.id,current.name)}}>{row.id===employeeId?'Diri sendiri':'Pilih'}</Button></li>)}</ul>{!data.rows.length&&<p>Tidak ada karyawan yang cocok.</p>}<Pagination page={page} total={data.total} onPage={setPage} disabled={!ready}/></>:<EmployeeReadState state={read} loading="Memuat pilihan atasan…"/>}</>
}
