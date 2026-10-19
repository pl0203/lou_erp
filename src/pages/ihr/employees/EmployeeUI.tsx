import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import IHRNav from '../../../components/IHRNav'
import { MainContent } from '../../../components/ui/MainContent'
import { PageHeader } from '../../../components/ui/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { FormActions } from '../../../components/ui/FormActions'
import { EmptyState, Notice, StatusBadge } from '../../../components/ui/Feedback'
import { LoadingState } from '../../../components/ui/LoadingState'
import { useEmployeeDetail } from '../../../lib/employees/useEmployeeReads'
import { useEmployeeCommand } from '../../../lib/employees/useEmployeeCommand'
import { useEmployeeNavigationGuard } from '../../../lib/employees/useEmployeeNavigationGuard'
import type { EmployeeError, EmployeeProposal, EmployeeSnapshot, EmployeeStatus, ReportingInterval } from '../../../lib/employees/contracts'
import './employee.css'

export const statusLabels: Record<EmployeeStatus,string> = { draft:'Draf', active:'Aktif tercatat', ended:'Berakhir tercatat' }
export const roleLabels: Record<string,string> = {executive:'Director',po_admin:'PO Admin',co_admin:'CO Admin',sales_person:'Sales Person',sales_manager:'Sales Manager',sales_head:'Sales Head'}
export const characterCount = (value:string|null,limit:number) => `${Array.from((value??'').trim()).length} / ${limit} karakter`
export const characterError = (value:string|null,limit:number) => Array.from((value??'').trim()).length>limit?`Maksimal ${limit} karakter. Isian Anda tidak dipotong.`:undefined
export const dateLabel = (value?:string|null) => value || 'Belum dikonfirmasi'
export function EmployeeShell({title,description,actions,children,ready=true,draftGeneration=0}:{title:ReactNode;description?:ReactNode;actions?:ReactNode;children:ReactNode;ready?:boolean;draftGeneration?:number}) {
 // Protected controls leave the DOM during suspension. Keep only a focus locator,
 // not their node/value, and restore it after a completed read (never after revocation).
 const focus=useRef<{id:string;label:string;tag:string}|null>(null),suspended=useRef(false)
 useLayoutEffect(()=>{focus.current=null},[draftGeneration])
 useLayoutEffect(()=>{
  if(!ready){suspended.current=true;return}
  if(!suspended.current)return
  suspended.current=false
  if(!focus.current||document.activeElement!==document.body)return
  const locator=focus.current
  const target=locator.id?document.getElementById(locator.id):Array.from(document.querySelectorAll<HTMLElement>('#main-content button, #main-content a')).find(node=>node.tagName===locator.tag&&(node.getAttribute('aria-label')||node.textContent)===locator.label)
  target?.focus({preventScroll:true})
 },[ready])
 return <div className="min-h-screen bg-gray-50"><IHRNav/><MainContent className="employee-page" onFocusCapture={event=>{if(ready&&event.target instanceof HTMLElement)focus.current={id:event.target.id,label:event.target.getAttribute('aria-label')||event.target.textContent||'',tag:event.target.tagName}}}><PageHeader title={title} description={description} actions={actions}/>{children}</MainContent></div>
}
export function RecordedStatus({status}:{status:EmployeeStatus}) {return <StatusBadge tone={status==='active'?'success':status==='ended'?'warning':'neutral'}>{statusLabels[status]}</StatusBadge>}
type ReadState = {authorityReady:boolean;authorityDenied:boolean;error:EmployeeError|null;refresh:()=>Promise<unknown>}
export function EmployeeReadState({state,loading='Memuat data karyawan…'}:{state:ReadState;loading?:string}) {
 const retry = () => {void state.refresh().catch(()=>{})}
 if(state.authorityDenied)return <Notice tone="warning" title="Akses Data Karyawan dibatasi" actions={<Button variant="secondary" onClick={retry}>Periksa akses lagi</Button>}>Hanya Director aktif dengan izin server saat ini dapat membuka data ini.</Notice>
 if(!state.authorityReady)return <LoadingState shape="form" title="Akses belum dapat dikonfirmasi" actions={<Button variant="secondary" onClick={retry}>Coba lagi</Button>}>Data dilindungi sampai pemeriksaan akses selesai. Draf tetap disimpan sementara di halaman ini jika akses belum dicabut.</LoadingState>
 if(state.error)return <Notice tone="error" title="Data belum dapat ditampilkan" actions={<Button variant="secondary" onClick={retry}>Coba lagi</Button>}>{state.error.message}</Notice>
 return <LoadingState shape="detail" title={loading}/>
}
export function TimezoneNotice({timezone}:{timezone:string|null|undefined}) {
 return timezone ? <p className="employee-support">Tanggal menggunakan zona waktu perusahaan: {timezone}.</p> : <Notice tone="info" title="Zona waktu perusahaan belum dikonfirmasi">Data dasar tanpa tanggal tetap dapat disimpan. Minta pemilik sistem mengonfirmasi zona waktu sebelum mencatat perubahan bertanggal.</Notice>
}
export function Pagination({page,total,pageSize=25,onPage,audit=false}:{page:number;total:number;pageSize?:number;onPage:(page:number)=>void;audit?:boolean}) {
 const pages=Math.max(1,Math.ceil(total/pageSize)),prefix=audit?'Halaman audit':'Halaman'
 return <nav className="employee-pagination" aria-label={audit?'Halaman riwayat perubahan':'Halaman hasil'}><Button variant="secondary" disabled={page<=1} onClick={()=>onPage(page-1)} aria-label={`${prefix} sebelumnya`}>Sebelumnya</Button><span aria-live="polite">{page} dari {pages} · {total} hasil</span><Button variant="secondary" disabled={page>=pages} onClick={()=>onPage(page+1)} aria-label={`${prefix} berikutnya`}>Berikutnya</Button></nav>
}
export function TechnicalDetails({children}:{children:ReactNode}) {return <details className="employee-technical"><summary className="min-h-[var(--ui-control-size)]">Detail teknis</summary>{children}</details>}
export function ReportingTimeline({intervals,names={}}:{intervals:Partial<ReportingInterval>[];names?:Record<string,string>}) {
 if(!intervals.length)return <p>Belum ada riwayat terkonfirmasi. Ini berbeda dari penetapan tanpa atasan.</p>
 return <ol className="employee-timeline">{intervals.map((item,index)=><li key={`${item.from}-${index}`}><strong>{item.managerEmployeeId===null?'Tanpa atasan':item.managerEmployeeId?names[item.managerEmployeeId]||<EmployeeName employeeId={item.managerEmployeeId}/>:'Belum dikonfirmasi'}</strong><p>{dateLabel(item.from)} sampai {item.until?`${item.until} (tidak termasuk)`:'seterusnya'}</p></li>)}</ol>
}
/** Read only the employees referenced by a visible timeline, never prefetch the directory. */
export function EmployeeName({employeeId}:{employeeId:string}) {
 const read=useEmployeeDetail(employeeId)
 return <Link className="employee-text-link" to={`/ihr/employees/${employeeId}`}>{read.authorityReady&&read.data?read.data.fields.name:'Nama atasan belum dapat dikonfirmasi'}</Link>
}
export function Snapshot({value,names={}}:{value:EmployeeSnapshot;names?:Record<string,string>}) {
 const labels={name:'Nama lengkap',employeeNumber:'Nomor karyawan',jobTitle:'Jabatan',team:'Tim',recordedStatus:'Status tercatat'}
 if(!Object.keys(value).length)return <p>Belum tercatat</p>
 return <div className="employee-snapshot">{value.fields&&<dl className="employee-summary">{Object.entries(value.fields).map(([key,val])=><div key={key}><dt>{labels[key as keyof typeof labels]}</dt><dd>{key==='recordedStatus'?statusLabels[val as EmployeeStatus]:val??'Belum diisi'}</dd></div>)}</dl>}{value.episode&&<dl className="employee-summary">{Object.entries(value.episode).map(([key,val])=><div key={key}><dt>{key==='startDate'?'Tanggal mulai':key==='endDate'?'Tanggal berakhir':'Sumber periode kerja'}</dt><dd>{key==='sourceReference'?val||'Tidak dicantumkan':dateLabel(val)}</dd></div>)}</dl>}{value.account&&<p>{value.account.userId?names[value.account.userId]||'Akun aplikasi tertaut':'Belum ada tautan akun'}</p>}{value.reporting&&<ReportingTimeline intervals={value.reporting} names={names}/>}</div>
}
export function ChangeReview({before,after,names}:{before:EmployeeSnapshot;after:EmployeeSnapshot;names?:Record<string,string>}) {return <div className="employee-comparison"><section><h3>Sebelum</h3><Snapshot value={before} names={names}/></section><section><h3>Sesudah</h3><Snapshot value={after} names={names}/></section></div>}

/** One command and one navigation guard per mounted editor. Form state belongs to its screen. */
export function useEmployeeEditorActions(id:string|undefined, proposalFor:(employeeId:string)=>EmployeeProposal|null, dirty:boolean, reviewEligible:boolean) {
 const command=useEmployeeCommand(id),navigate=useNavigate()
 const proposal=command.employeeId?proposalFor(command.employeeId):null
 const [validation,setValidation]=useState(''),[reviewing,setReviewing]=useState(false),[reviewed,setReviewed]=useState<{key:string;revision:number}|null>(null)
 const inFlight=useRef(false),mounted=useRef(true),errorRef=useRef<HTMLDivElement>(null),reviewRef=useRef<HTMLHeadingElement>(null)
 const key=JSON.stringify(proposal),reviewRevision=useRef(0)
 const pending=['submitting','recovering','uncertain'].includes(command.phase)
 const guard=useEmployeeNavigationGuard({dirty,pending},command.draftGeneration)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useLayoutEffect(()=>{setValidation('')},[command.draftGeneration,id])
 // Eligibility includes UI-only acknowledgment and observed version drift, neither
 // of which is necessarily represented by the serialized RPC proposal. Every
 // transition retires approval, including false -> true and edit -> revert.
 useLayoutEffect(()=>{reviewRevision.current++;setReviewed(null)},[key,reviewEligible,command.draftGeneration,id])
 useLayoutEffect(()=>{if(validation||command.error)errorRef.current?.focus()},[validation,command.error,command.authorityReady])
 const visiblePreview=reviewEligible&&reviewed?.key===key&&reviewed.revision===reviewRevision.current?command.previewResult:null
 const latest=useRef({key,proposal,reviewEligible,reviewed,visiblePreview})
 latest.current={key,proposal,reviewEligible,reviewed,visiblePreview}
 useLayoutEffect(()=>{if(visiblePreview)reviewRef.current?.focus()},[visiblePreview])
 useEffect(()=>{
  if(command.receipt)guard.runWithoutPrompt(()=>navigate(`/ihr/employees/${command.receipt!.employeeId}`,{replace:true,state:{employeeSaved:true}}))
 },[command.receipt,navigate])
 async function review(problem:string) {
  if(inFlight.current)return
  setValidation(problem);setReviewed(null)
  if(problem||!proposal||!reviewEligible||!latest.current.reviewEligible||latest.current.key!==key)return
  inFlight.current=true;setReviewing(true);const captured={key,revision:reviewRevision.current}
  try{const result=await command.preview(proposal);if(mounted.current&&result&&latest.current.reviewEligible&&latest.current.key===captured.key&&reviewRevision.current===captured.revision)setReviewed(captured)}finally{inFlight.current=false;if(mounted.current)setReviewing(false)}
 }
 return {command,guard,validation,errorRef,reviewRef,reviewing,visiblePreview,reviewProposal:visiblePreview?proposal:null,review,submit:()=>{
  const current=latest.current
  // Retained callbacks cannot reuse a retired approval or submit a later review.
  if(!mounted.current||!current.reviewEligible||!current.proposal||!current.visiblePreview||!reviewed||current.reviewed!==reviewed||current.key!==key||reviewed.revision!==reviewRevision.current)return
  void command.submit(current.proposal)
 },cancel:()=>guard.confirmDiscard(()=>navigate(id?`/ihr/employees/${id}`:'/ihr/employees'))}
}
export type EditorActions=ReturnType<typeof useEmployeeEditorActions>
export function EditorFeedback({actions}:{actions:EditorActions}) {
 const message=actions.validation||actions.command.error?.message
 return message?<div ref={actions.errorRef} tabIndex={-1} role="alert" className="ui-notice ui-notice--error"><p className="ui-notice__title">Periksa perubahan</p><p>{message}</p>{actions.command.error?.kind==='conflict'&&<Button variant="secondary" onClick={()=>void actions.command.refresh().catch(()=>{})}>Periksa data terbaru</Button>}</div>:null
}
export function EditorReview({actions,names}:{actions:EditorActions;names?:Record<string,string>}) {
 const preview=actions.visiblePreview
 if(!preview)return null
 return <section className="employee-panel employee-review"><h2 ref={actions.reviewRef} tabIndex={-1}>Tinjau sebelum menyimpan</h2>{preview.action==='quarantine_account_link'&&<Notice tone="warning" title="Karantina tautan akun">Tautan seumur hidup tetap disimpan dan tidak dapat dialihkan. Login tidak berubah.</Notice>}<ChangeReview before={preview.before} after={preview.after} names={names}/><dl className="employee-summary"><div><dt>Alasan perubahan</dt><dd>{actions.reviewProposal?.reason}</dd></div><div><dt>Tanggal berlaku</dt><dd>{dateLabel(actions.reviewProposal?.effectiveDate)}</dd></div>{actions.reviewProposal?.sourceReference&&<div><dt>Sumber perubahan</dt><dd>{actions.reviewProposal.sourceReference}</dd></div>}</dl><p className="employee-support">Hanya perubahan yang ditampilkan ini yang disimpan. Login, akses operasional, dan data cuti tidak berubah.</p><FormActions><Button onClick={actions.submit} pending={actions.command.phase==='submitting'}>Simpan perubahan</Button></FormActions></section>
}
export function OperationRecovery({actions}:{actions:EditorActions}) {
 const {command}=actions,[confirm,setConfirm]=useState(false),trigger=useRef<HTMLElement|null>(null),fallback=useRef<HTMLHeadingElement>(null)
 const pending=command.phase==='submitting'||command.phase==='recovering'
 if(command.phase==='completed')return <Notice tone="success" title="Perubahan sudah tersimpan">Membuka hasil yang sudah dikonfirmasi. Jangan membuat penyimpanan baru.</Notice>
 if(!command.recoveryEmployeeId&&!pending&&command.phase!=='blocked')return null
 if(command.phase==='blocked')return <Notice tone="warning" title="Penyimpanan belum tersedia">Periksa akses atau penyimpanan pemulihan pada browser. Jangan menghapus operasi lama untuk mengirim pengganti.</Notice>
 return <section className="employee-panel"><h2 ref={fallback} tabIndex={-1}>{pending?'Memastikan hasil penyimpanan…':'Hasil penyimpanan belum pasti'}</h2><p>Jangan buat perubahan pengganti. Periksa operasi yang sama, atau batalkan secara terkonfirmasi jika belum tersimpan. Keluar dari halaman tidak membatalkan permintaan.</p><FormActions><Button pending={pending} onClick={()=>void command.checkOutcome()}>Periksa hasil</Button>{command.canRetryUnknown&&<Button variant="secondary" disabled={pending} onClick={()=>void command.retryUnknown()}>Kirim ulang operasi yang sama</Button>}<Button variant="danger-quiet" disabled={pending} onClick={event=>{trigger.current=event.currentTarget;setConfirm(true)}}>Batalkan operasi lama</Button></FormActions>{confirm&&<Dialog labelledBy="employee-abandon-title" pending={pending} returnFocus={trigger.current} fallbackFocus={()=>fallback.current} onClose={()=>setConfirm(false)}><h2 id="employee-abandon-title">Batalkan operasi lama?</h2><p>Server hanya membatalkan operasi yang belum tersimpan. Jika ternyata sudah tersimpan, hasil asli akan dibuka. Data karyawan yang sudah tersimpan tidak dihapus.</p><FormActions><Button variant="secondary" onClick={()=>setConfirm(false)}>Kembali</Button><Button variant="danger" pending={pending} onClick={async()=>{await command.abandonUnknown();setConfirm(false)}}>Konfirmasi pembatalan</Button></FormActions></Dialog>}</section>
}
export { EmptyState }
