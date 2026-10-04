import { useEffect, useRef, useState } from 'react'
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
 return <section aria-label="Kalender tim" className="space-y-4 rounded-xl border bg-white p-4">
  <h2 className="font-semibold text-gray-900">Kalender Tim</h2>
  <p className="text-sm text-gray-600">Hanya cuti disetujui dan pembatalan yang masih menunggu keputusan. Sebagian jadwal menunjukkan menit cuti; waktu mulai dan selesai tidak dicatat.</p>
  <p className="text-sm text-gray-600">Label seluruh jadwal mengacu pada kapasitas jadwal saat cuti disetujui. Kalender ini tidak memastikan cakupan petugas.</p>
  <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
   <label>Cakupan kalender<select aria-label="Cakupan kalender" value={audience} disabled={!controls} onChange={e=>{if(controls){setAudience(e.target.value as CalendarAudience);if(!manual){setRange(null);setFrom('');setTo('')}}}} className="ml-2 rounded border p-2">
    {controls&&!authorized&&<option value={audience} disabled>Cakupan belum tersedia</option>}
    {(access.data?.calendarAudiences??[audience]).map(value=><option key={value} value={value}>{audienceLabels[value]}</option>)}
   </select></label>
   <label>Dari<input aria-label="Dari tanggal" type="date" value={from} disabled={!controls||!authorized} onChange={e=>setFrom(e.target.value)} className="ml-2 rounded border p-2"/></label>
   <label>Sampai<input aria-label="Sampai tanggal" type="date" value={to} disabled={!controls||!authorized} onChange={e=>setTo(e.target.value)} className="ml-2 rounded border p-2"/></label>
   <button type="submit" disabled={!controls||!authorized} className="rounded border px-3 py-2 disabled:opacity-50">Tampilkan</button>
  </form>
  {error&&<p role="alert">{error}</p>}
  {access.available&&authorized&&access.data?.defaultRange===null&&<p role="status">Zona waktu perusahaan belum dikonfirmasi atau berbeda untuk cakupan ini. Pilih rentang tanggal secara manual; tanggal ditampilkan sesuai permohonan.</p>}
  {readState==='pending'||access.isFetching?<p role="status">Memeriksa akses kalender...</p>:
   readState==='error'||access.isError?<div role="alert"><p>Akses kalender belum dapat dikonfirmasi.</p><button type="button" onClick={()=>void access.refetch()}>Coba lagi</button></div>:
   !access.available?<div role="status"><p>Akses kalender belum tersedia.</p><button type="button" onClick={()=>void access.refetch()}>Muat ulang akses kalender</button></div>:
   !access.data?.calendarAudiences.length?<p>Belum ada akses kalender yang diberikan.</p>:
   !authorized?<p>Cakupan kalender ini belum tersedia. Pilih cakupan yang diberikan.</p>:
   !range?<p>Pilih rentang tanggal paling lama 93 hari.</p>:
   calendar.isFetching||calendar.isPending?<p role="status">Memuat kalender...</p>:
   calendar.isError?<div role="alert"><p>Kalender belum dapat dimuat.</p><button type="button" onClick={()=>void calendar.refetch()}>Coba lagi</button></div>:
   calendar.available&&calendar.data?<>
    {!calendar.data.length&&<p>Tidak ada cuti disetujui pada rentang ini.</p>}
    <ul className="space-y-3">{calendar.data.map(row=><li key={`${row.employeeId}:${row.date}`} className="flex flex-wrap gap-x-4 gap-y-1 border-b pb-2">
     <time dateTime={row.date}>{row.date}</time><span className="font-medium">{row.employeeName}</span><span>{formatLeaveMinutes(row.approvedMinutes)}</span>
     <span className="text-gray-600">{row.availabilityLabel==='full_scheduled_absence'?'Seluruh jadwal asal':'Sebagian jadwal'}</span>
    </li>)}</ul>
   </>:<div role="status"><p>Kalender belum tersedia.</p><button type="button" onClick={()=>void calendar.refetch()}>Muat ulang kalender</button></div>}
 </section>
}
