import { RecordList } from '../../../components/ui/RecordList'
import { Notice, EmptyState } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { useId, useEffect, useRef, useState  } from 'react'
import type { LeaveContext } from '../../../lib/leave/contracts'
import { parseCalendarRange } from '../../../lib/leave/readContracts'
import type { CalendarAudience, CalendarRange } from '../../../lib/leave/readContracts'
import { useLeaveCalendar, useLeaveReadAccess } from '../../../lib/leave/useLeaveReads'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
type Props={actorId:string;context:LeaveContext;readState?:'ready'|'pending'|'error'}
const audienceLabels:Record<CalendarAudience,string>={own:'Cuti saya',assigned_team:'Tim yang ditugaskan',granted:'Akses kalender yang diberikan'}
export default function TeamLeaveCalendar(props:Props){
 return <CalendarPanel key={`${props.actorId}:${props.context.scopeVersion}`} {...props}/>
}
function CalendarPanel({actorId,context,readState='ready'}:Props){
 const fieldId=useId()
 const [range,setRange]=useState<CalendarRange|null>(null),[from,setFrom]=useState(''),[to,setTo]=useState(''),[error,setError]=useState(''),[manual,setManual]=useState(false)
 const [audience,setAudience]=useState<CalendarAudience>(context.memberKind==='employee'||context.memberKind==='manager'?'own':context.memberKind==='director'?'assigned_team':'granted')
 const access=useLeaveReadAccess(actorId,context,true,audience)
 const completedAudience=useRef<{audience:CalendarAudience;allowed:boolean}|null>(null)
 if(access.data)completedAudience.current={audience,allowed:access.data.calendarAudiences.includes(audience)}
 if(access.isError)completedAudience.current=null
 const authorized=access.available&&!!access.data?.calendarAudiences.includes(audience)
 // Starting a calendar read refreshes shared authority. Preserve only the already
 // completed audience gate during that refresh; display still needs live proof.
 const readEnabled=completedAudience.current?.audience===audience&&completedAudience.current.allowed
 const calendar=useLeaveCalendar(actorId,context,range??{from:'',to:''},audience,!!readEnabled&&!!range)
 const controls=readState==='ready'&&access.available&&!!access.data?.calendarAudiences.length
 useEffect(()=>{
  if(!range&&access.data?.defaultRange){setRange(access.data.defaultRange);setFrom(access.data.defaultRange.from);setTo(access.data.defaultRange.to)}
 },[range,access.data?.defaultRange])
 function apply(event:React.FormEvent){
  event.preventDefault();if(!controls||!authorized)return
  try{setRange(parseCalendarRange({from,to}));setManual(true);setError('')}catch{setError('Pilih rentang tanggal yang valid, paling lama 93 hari termasuk kedua tanggal.')}
 }
 return <section aria-label="Kalender tim" className="ui-section space-y-4">
  <h2 className="font-semibold text-brand-primary">Kalender Tim</h2>
  <p className="text-base text-brand-secondary">Hanya cuti disetujui dan pembatalan yang masih menunggu keputusan. Sebagian jadwal menunjukkan menit cuti; waktu mulai dan selesai tidak dicatat.</p>
  <p className="text-base text-brand-secondary">Label seluruh jadwal mengacu pada kapasitas jadwal saat cuti disetujui. Kalender ini tidak memastikan cakupan petugas.</p>
  <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_auto]">
   <Field id={`${fieldId}-1`} label="Cakupan kalender">{control=><select {...control} aria-label="Cakupan kalender" value={audience} disabled={!controls} onChange={e=>{if(controls){setAudience(e.target.value as CalendarAudience);if(!manual){setRange(null);setFrom('');setTo('')}}}} >
    {controls&&!authorized&&<option value={audience} disabled>Cakupan belum tersedia</option>}
    {(access.data?.calendarAudiences??[audience]).map(value=><option key={value} value={value}>{audienceLabels[value]}</option>)}
   </select>}</Field>
   <Field id={`${fieldId}-2`} label="Dari">{control=><input {...control} aria-label="Dari tanggal" type="date" value={from} disabled={!controls||!authorized} onChange={e=>setFrom(e.target.value)} />}</Field>
   <Field id={`${fieldId}-3`} label="Sampai">{control=><input {...control} aria-label="Sampai tanggal" type="date" value={to} disabled={!controls||!authorized} onChange={e=>setTo(e.target.value)} />}</Field>
   <Button type="submit" disabled={!controls||!authorized} variant="secondary" className="self-end">Tampilkan</Button>
  </form>
  {error&&<Notice tone="error" title={<> {error} </>}/>}
  {access.available&&authorized&&access.data?.defaultRange===null&&<p role="status" className="ui-notice ui-notice--info">Zona waktu perusahaan belum dikonfirmasi atau berbeda untuk cakupan ini. Pilih rentang tanggal secara manual; tanggal ditampilkan sesuai permohonan.</p>}
  {readState==='pending'||access.isFetching?<p role="status" className="ui-notice ui-notice--info">Memeriksa akses kalender...</p>:
   readState==='error'||access.isError?<div role="alert" className="ui-notice ui-notice--error"><p>Akses kalender belum dapat dikonfirmasi.</p><Button type="button" onClick={()=>void access.refetch()} variant="secondary">Coba lagi</Button></div>:
   !access.available?<div role="status" className="ui-notice ui-notice--info"><p>Akses kalender belum tersedia.</p><Button type="button" onClick={()=>void access.refetch()} variant="secondary">Muat ulang akses kalender</Button></div>:
   !access.data?.calendarAudiences.length?<EmptyState title="Belum ada akses kalender yang diberikan."/>:
   !authorized?<p>Cakupan kalender ini belum tersedia. Pilih cakupan yang diberikan.</p>:
   !range?<p>Pilih rentang tanggal paling lama 93 hari.</p>:
   calendar.isFetching||calendar.isPending?<p role="status" className="ui-notice ui-notice--info">Memuat kalender...</p>:
   calendar.isError?<div role="alert" className="ui-notice ui-notice--error"><p>Kalender belum dapat dimuat.</p><Button type="button" onClick={()=>void calendar.refetch()} variant="secondary">Coba lagi</Button></div>:
   calendar.available&&calendar.data?<>
    {!calendar.data.length&&<EmptyState title="Tidak ada cuti disetujui pada rentang ini."/>}
    {!!calendar.data.length&&<h3 className="border-t border-brand-divider pt-4 font-semibold text-brand-primary">Agenda cuti</h3>}
    <RecordList aria-label="Agenda cuti"  label="Agenda cuti">{calendar.data.map(row=><li key={`${row.employeeId}:${row.date}`} className="flex flex-col gap-3 rounded-[14px] border border-brand-divider bg-brand-canvas p-4 sm:flex-row sm:items-center">
     <time dateTime={row.date} className="shrink-0 self-start rounded-[10px] bg-white px-3 py-2 text-[13px] font-semibold text-brand-secondary shadow-sm">{row.date}</time><div className="min-w-0 flex-1"><p className="font-medium text-brand-primary">{row.employeeName}</p><p className="mt-1 text-[13px] text-brand-secondary">{row.availabilityLabel==='full_scheduled_absence'?'Seluruh jadwal asal':'Sebagian jadwal'}</p></div><span className="font-semibold text-brand-primary">{formatLeaveMinutes(row.approvedMinutes)}</span>
    </li>)}</RecordList>
   </>:<div role="status" className="ui-notice ui-notice--info"><p>Kalender belum tersedia.</p><Button type="button" onClick={()=>void calendar.refetch()} variant="secondary">Muat ulang kalender</Button></div>}
 </section>
}
