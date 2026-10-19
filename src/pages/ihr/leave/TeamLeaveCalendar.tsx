import { useEffect,useId,useRef,useState } from 'react'
import { LoadingState } from '../../../components/ui/LoadingState'
import { Notice,EmptyState } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import type { LeaveContext } from '../../../lib/leave/contracts'
import { hasVisiblePending,shiftPeriod,periodDates,periodForDate } from '../../../lib/leave/teamCalendarContracts'
import type { CalendarView,TeamCalendarAudience,TeamCalendarPage,TeamDay } from '../../../lib/leave/teamCalendarContracts'
import { useTeamCalendar,useTeamCalendarAccess } from '../../../lib/leave/useTeamCalendar'
import { formatLeaveMinutes } from '../../../lib/leave/formatMinutes'
import './team-leave-calendar.css'

type Props={actorId:string;context:LeaveContext;readState?:'ready'|'pending'|'error'}
const audienceLabels:Record<TeamCalendarAudience,string>={own:'Cuti saya',assigned_team:'Tim yang ditugaskan',granted:'Akses kalender yang diberikan',director_all:'Seluruh karyawan',sales_all:'Seluruh tim sales',sales_team:'Tim sales saya',admin_team:'Tim PO dan CO Admin'}
const statusLabels={submitted:'Menunggu persetujuan',approved:'Disetujui',cancellation_pending:'Pembatalan menunggu'}
function dateLabel(date:string,weekday=false){return new Intl.DateTimeFormat('id-ID',{timeZone:'UTC',day:'numeric',month:'short',...(weekday?{weekday:'short' as const}:{year:'numeric' as const})}).format(new Date(`${date}T00:00:00Z`))}
export default function TeamLeaveCalendar(props:Props){return <CalendarPanel key={`${props.actorId}:${props.context.scopeVersion}`} {...props}/>}
function CalendarPanel({actorId,context,readState='ready'}:Props){
 const fieldId=useId()
 const [audience,setAudience]=useState<TeamCalendarAudience|undefined>(),[period,setPeriod]=useState<string|null>(null),[view,setView]=useState<CalendarView>('week')
 const [anchor,setAnchor]=useState<string|null>(null),[date,setDate]=useState(''),[manual,setManual]=useState(false),[page,setPage]=useState(1),[error,setError]=useState('')
 const access=useTeamCalendarAccess(actorId,context,true,audience)
 const defaultAudience=useRef<TeamCalendarAudience|undefined>(undefined)
 if(access.data)defaultAudience.current=access.data.calendarAudiences[0]
 const selectedAudience=audience??defaultAudience.current
 const completedAudience=useRef<{audience:TeamCalendarAudience;allowed:boolean}|null>(null)
 if(access.data&&selectedAudience)completedAudience.current={audience:selectedAudience,allowed:access.data.calendarAudiences.includes(selectedAudience)}
 if(access.isError)completedAudience.current=null
 const authorized=!!selectedAudience&&access.available&&!!access.data?.calendarAudiences.includes(selectedAudience)
 // Keep only the completed gate while the data read refreshes shared authority.
 // The shared hook still requires a fresh scope proof before exposing any rows.
 const readEnabled=!!selectedAudience&&completedAudience.current?.audience===selectedAudience&&completedAudience.current.allowed&&!!period
 const calendar=useTeamCalendar(actorId,context,period??'',view,selectedAudience??'own',page,readEnabled)
 const controls=readState==='ready'&&access.available&&!!access.data?.calendarAudiences.length
 useEffect(()=>{
  if(!period&&authorized&&access.data?.defaultDate){const start=periodForDate(access.data.defaultDate,view).from;setPeriod(start);setAnchor(access.data.defaultDate);setDate(access.data.defaultDate)}
 },[authorized,period,view,access.data])
 function selectAudience(value:TeamCalendarAudience){
  if(!controls)return
  setAudience(value);setPage(1);setError('')
  if(!manual){setPeriod(null);setAnchor(null);setDate('')}
 }
 function apply(event:React.FormEvent){
  event.preventDefault();if(!controls||!authorized)return
  try{const chosen=periodForDate(date,view).from;setPeriod(chosen);setAnchor(date);setManual(true);setPage(1);setError('')}
  catch{setError('Pilih tanggal yang valid untuk menampilkan periode kalender.')}
 }
 function navigate(direction:-1|1){
  if(!controls||!authorized||!period)return
  try{const next=shiftPeriod(period,view,direction);setPeriod(next);setAnchor(next);setDate(next);setManual(true);setPage(1);setError('')}
  catch{setError('Periode di luar rentang tanggal yang didukung.')}
 }
 function changeView(next:CalendarView){
  if(!controls||!authorized||next===view)return
  setView(next);setPage(1);setError('')
  if(period){const chosen=anchor??period;setPeriod(periodForDate(chosen,next).from);setDate(chosen)}
 }
 return <section aria-label="Kalender tim" className="ui-section space-y-4">
  <h2 className="font-semibold text-brand-primary">Kalender Tim</h2>
  <p>Permohonan menunggu ditampilkan hanya sesuai akses Anda. Tanpa catatan cuti tidak berarti karyawan pasti tersedia.</p>
  <div role="group" aria-label="Tampilan kalender" className="weekly-calendar-view">
   <Button type="button" variant={view==='week'?'primary':'secondary'} aria-pressed={view==='week'} disabled={!controls||!authorized} onClick={()=>changeView('week')}>Mingguan</Button>
   <Button type="button" variant={view==='month'?'primary':'secondary'} aria-pressed={view==='month'} disabled={!controls||!authorized} onClick={()=>changeView('month')}>Bulanan</Button>
  </div>
  <form onSubmit={apply} className="weekly-calendar-controls">
   <Field id={`${fieldId}-audience`} label="Cakupan kalender">{control=><select {...control} aria-label="Cakupan kalender" value={selectedAudience??''} disabled={!controls} onChange={event=>selectAudience(event.target.value as TeamCalendarAudience)}>
    {(!selectedAudience||!authorized)&&<option value={selectedAudience??''} disabled>Cakupan belum tersedia</option>}
    {(access.data?.calendarAudiences??(selectedAudience?[selectedAudience]:[])).map(value=><option key={value} value={value}>{audienceLabels[value]}</option>)}
   </select>}</Field>
   <Field id={`${fieldId}-date`} label="Tanggal dalam periode">{control=><input {...control} type="date" value={date} disabled={!controls||!authorized} onChange={event=>setDate(event.target.value)}/>}</Field>
   <Button type="submit" variant="secondary" disabled={!controls||!authorized}>Tampilkan periode</Button>
  </form>
  <div className="weekly-calendar-navigation">
   <Button type="button" variant="secondary" aria-label={view==='week'?'Minggu sebelumnya':'Bulan sebelumnya'} disabled={!controls||!authorized||!period} onClick={()=>navigate(-1)}>← Sebelumnya</Button>
   <p aria-live="polite" className="font-semibold">{period?`${dateLabel(period)} – ${dateLabel(periodDates(period,view).at(-1)!)}`:'Pilih periode'}</p>
   <Button type="button" variant="secondary" aria-label={view==='week'?'Minggu berikutnya':'Bulan berikutnya'} disabled={!controls||!authorized||!period} onClick={()=>navigate(1)}>Berikutnya →</Button>
  </div>
  {error&&<Notice tone="error" title={error}/>}
  {authorized&&access.data?.defaultDate===null&&<p role="status" className="ui-notice ui-notice--info">Zona waktu perusahaan belum dikonfirmasi atau berbeda untuk cakupan ini. Pilih tanggal secara manual; pilihan mingguan ditampilkan Senin–Minggu.</p>}
  {readState==='pending'||access.isFetching?<LoadingState title="Memeriksa akses kalender..." shape="compact"/>:
   readState==='error'||access.isError?<div role="alert" className="ui-notice ui-notice--error"><p>Akses kalender belum dapat dikonfirmasi.</p><Button type="button" variant="secondary" onClick={()=>void access.refetch()}>Coba lagi</Button></div>:
   !access.available?<div role="status" className="ui-notice ui-notice--info"><p>Akses kalender belum tersedia.</p><Button type="button" variant="secondary" onClick={()=>void access.refetch()}>Muat ulang akses kalender</Button></div>:
   !access.data?.calendarAudiences.length?<EmptyState title="Belum ada akses kalender yang diberikan."/>:
   !authorized?<p>Cakupan kalender ini belum tersedia. Pilih cakupan yang diberikan.</p>:
   !period?<p>Pilih tanggal untuk menampilkan kalender.</p>:
   calendar.isFetching||calendar.isPending?<LoadingState title="Memuat kalender..." shape="list"/>:
   calendar.isError?<div role="alert" className="ui-notice ui-notice--error"><p>Kalender belum dapat dimuat.</p><Button type="button" variant="secondary" onClick={()=>void calendar.refetch()}>Coba lagi</Button></div>:
   calendar.available&&calendar.data?<>
    <TeamCalendarGrid data={calendar.data}/>
    {(calendar.data.total>calendar.data.pageSize||page>1)&&<nav aria-label="Halaman karyawan kalender" className="weekly-calendar-navigation">
     <Button type="button" variant="secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Karyawan sebelumnya</Button>
     <p>Halaman {page} · {calendar.data.total} karyawan</p>
     <Button type="button" variant="secondary" disabled={page*calendar.data.pageSize>=calendar.data.total} onClick={()=>setPage(page+1)}>Karyawan berikutnya</Button>
    </nav>}
   </>:<div role="status" className="ui-notice ui-notice--info"><p>Kalender belum tersedia.</p><Button type="button" variant="secondary" onClick={()=>void calendar.refetch()}>Muat ulang kalender</Button></div>}
 </section>
}
function TeamCalendarGrid({data}:{data:TeamCalendarPage}){
 const dates=periodDates(data.periodStart,data.view)
 return <>
  <ul className="weekly-calendar-legend" aria-label="Keterangan kalender">
   <li><span className="weekly-calendar-swatch is-submitted"/>Menunggu persetujuan</li>
   <li><span className="weekly-calendar-swatch is-approved"/>Disetujui</li>
   <li><span className="weekly-calendar-swatch is-cancellation_pending"/>Pembatalan menunggu</li>
  </ul>
  {!data.rows.length?<EmptyState title="Tidak ada karyawan pada halaman ini."/>:<div className="weekly-calendar-scroll" role="region" aria-label="Tabel kalender, geser untuk melihat semua tanggal" tabIndex={0}>
   <table className={`weekly-calendar-table is-${data.view}`} style={data.view==='month'?{minWidth:`${160+dates.length*48}px`}:undefined}>
    <caption className="sr-only">Kalender cuti {data.view==='week'?'mingguan':'bulanan'} {dateLabel(data.periodStart)} sampai {dateLabel(data.periodEnd)}</caption>
    <thead><tr><th scope="col">Karyawan</th>{dates.map(date=><th key={date} scope="col"><time dateTime={date} aria-label={dateLabel(date)}>{data.view==='month'?<><span>{new Intl.DateTimeFormat('id-ID',{timeZone:'UTC',weekday:'short'}).format(new Date(`${date}T00:00:00Z`))}</span><strong>{Number(date.slice(-2))}</strong></>:dateLabel(date,true)}</time></th>)}</tr></thead>
    <tbody>{data.rows.map(row=><tr key={row.employeeId} className={hasVisiblePending(row)?'is-pending':''}>
     <th scope="row"><span>{row.employeeName}</span>{hasVisiblePending(row)&&<span className="weekly-calendar-pending-label">Menunggu keputusan</span>}</th>
     {row.days.map(day=><td key={day.date} className={`weekly-calendar-day is-${day.schedule}`}><CalendarDay day={day} compact={data.view==='month'}/></td>)}
    </tr>)}</tbody>
   </table>
  </div>}
  <p className="weekly-calendar-explanation">Libur kalender dan jadwal kerja mengikuti konfigurasi per karyawan. Potongan cuti tersimpan tidak dihitung ulang dari kalender ini. Seluruh/sebagian jadwal mengacu pada jadwal asal permohonan; waktu mulai dan selesai tidak dicatat.</p>
 </>
}
function CalendarDay({day,compact}:{day:TeamDay;compact:boolean}){
 const label=day.schedule==='holiday'?'Libur kalender':day.schedule==='off_duty'?'Tidak bertugas':day.schedule==='unconfigured'?'Jadwal belum dikonfigurasi':day.scheduledMinutes===225?`Jadwal ${formatLeaveMinutes(225)}`:null
 const short=day.schedule==='holiday'?'Libur':day.schedule==='off_duty'?'Off':day.schedule==='unconfigured'?'?':'½'
 return <>
  {label&&<p className="weekly-calendar-day-label" title={label}><span className={compact?'sr-only':undefined}>{label}</span>{compact&&<span aria-hidden="true">{short}</span>}</p>}

  {day.absence?<div className={`weekly-calendar-block is-${day.absence.status}`} title={`${statusLabels[day.absence.status]} · ${formatLeaveMinutes(day.absence.minutes)}`}>
   <span className={compact?'sr-only':undefined}>{statusLabels[day.absence.status]}</span>{compact&&<span className="weekly-calendar-short-status" aria-hidden="true">{day.absence.status==='approved'?'Setuju':day.absence.status==='submitted'?'Tunggu':'Batal?'}</span>}<strong>{formatLeaveMinutes(day.absence.minutes)}</strong>
   <span className={compact?'sr-only':undefined}>{day.absence.availabilityLabel==='full_scheduled_absence'?'Seluruh jadwal asal':'Sebagian jadwal asal'}</span>
  </div>:day.schedule==='working'?<span className="weekly-calendar-no-leave"><span aria-hidden="true">—</span><span className="sr-only">Tidak ada cuti tercatat</span></span>:null}
 </>
}
