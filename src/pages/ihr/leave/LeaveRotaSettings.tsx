import { LoadingState } from '../../../components/ui/LoadingState'
import { Notice } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { useId, useEffect, useRef, useState  } from 'react'
import type { LeaveCalendarSetup, LeaveSetupCommand, LeaveSetupSend, RosterPreview, RosterPreviewInput, CalendarPreview, CalendarPreviewInput } from '../../../lib/leave/setupContracts'
import LeaveSetupImpacts from './LeaveSetupImpacts'
import { useSetupUnsaved } from './useSetupUnsaved'
type Props={authorityReady?:boolean;onDirtyChange?:(dirty:boolean)=>void;calendar:LeaveCalendarSetup;send:LeaveSetupSend;preview:(input:RosterPreviewInput)=>Promise<RosterPreview>;previewCalendar:(input:CalendarPreviewInput)=>Promise<CalendarPreview>;onSaved?:(state:{hasUnsavedChanges:boolean})=>void}
export default function LeaveRotaSettings({calendar,send,preview,previewCalendar,onSaved,onDirtyChange,authorityReady=true}:Props){
 const fieldId=useId()
 const [name,setName]=useState(calendar.name),[zone,setZone]=useState(calendar.timezone??''),[start,setStart]=useState(calendar.effectiveFrom),[end,setEnd]=useState(calendar.effectiveUntil??'')
 const [holidays,setHolidays]=useState(calendar.holidays.join('\n')),[confirmed,setConfirmed]=useState(calendar.holidaysConfirmed),[sunday,setSunday]=useState(calendar.sundayMinutes===null?'':'0'),[groups,setGroups]=useState(calendar.groups)
 const [anchor,setAnchor]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[reason,setReason]=useState(''),[version,setVersion]=useState(calendar.version)
 const [calendarResult,setCalendarResult]=useState<CalendarPreview|null>(null),[result,setResult]=useState<RosterPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
 const drafts={config:JSON.stringify({name,zone,start,end,holidays,confirmed,sunday,groups:groups.map(({id,name})=>({id,name}))}),roster:JSON.stringify({anchor,from,to,groups:groups.map(({id,onAnchor})=>({id,onAnchor}))}),reason}
 const [baselines,setBaselines]=useState(drafts),configDirty=drafts.config!==baselines.config
 const hasUnsaved=(saved=baselines)=>Object.keys(drafts).some(key=>drafts[key as keyof typeof drafts]!==saved[key as keyof typeof drafts])
 const generation=useRef(0),submitting=useRef(false),saving=useRef(false);useSetupUnsaved(hasUnsaved())
 const dirty=hasUnsaved();useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)},[dirty,onDirtyChange])
 function edit(action:()=>void){action();generation.current++;setResult(null);setCalendarResult(null);setSaved(false)}
 useEffect(()=>{if(!authorityReady&&!submitting.current){generation.current++;setResult(null);setCalendarResult(null)}},[authorityReady])
 function calendarInput():CalendarPreviewInput{return {calendarId:calendar.id,expectedVersion:version,name,effectiveFrom:start,effectiveUntil:end||null,timezone:zone||null,holidaysConfirmed:confirmed,sundayMinutes:sunday===''?null:Number(sunday) as 0,holidays:holidays.split(/\s+/).filter(Boolean),groups:groups.map(g=>({id:g.id,name:g.name}))}}
 async function showCalendarPreview(){if(submitting.current||!authorityReady)return;submitting.current=true;setBusy(true);setError('');setCalendarResult(null);setResult(null);const current=++generation.current
  try{const response=await previewCalendar(calendarInput());if(generation.current===current&&response.calendarId===calendar.id&&response.calendarVersion===version)setCalendarResult(response)}catch{if(generation.current===current)setError('Dampak kalender belum tersedia. Periksa isian lalu coba lagi.')}finally{submitting.current=false;setBusy(false)}}
 function input():RosterPreviewInput{if(!anchor||!from||!to||!groups.length||groups.some(g=>g.onAnchor===null))throw new Error();return {calendarId:calendar.id,anchor,from,to,groups:groups.map(g=>({id:g.id,onAnchor:g.onAnchor!}))}}
 async function showPreview(){if(submitting.current||configDirty||!authorityReady)return;submitting.current=true;setBusy(true);setError('');setResult(null);setCalendarResult(null);const current=++generation.current
  try{const response=await preview(input());if(generation.current===current)setResult(response)}catch{if(generation.current===current)setError('Pratinjau belum tersedia. Periksa acuan, kelompok, cakupan dan zona waktu.')}finally{submitting.current=false;setBusy(false)}}
 async function save(command:LeaveSetupCommand){if(submitting.current||!authorityReady||(command.operation==='save_calendar_version'?!calendarResult?.impacts.available:command.operation==='publish_roster'&&!result?.impacts.available))return;submitting.current=true;saving.current=true;setBusy(true);setError('');setSaved(false);generation.current++;setResult(null);setCalendarResult(null)
  try{const response=await send(command);setVersion(response.version);const next={...baselines,reason,[command.operation==='save_calendar_version'?'config':'roster']:command.operation==='save_calendar_version'?drafts.config:drafts.roster};setBaselines(next);setSaved(true);onSaved?.({hasUnsavedChanges:hasUnsaved(next)})}catch{setError('Pengaturan belum dapat disimpan. Isian tetap ada. Pulihkan hasil bila status belum pasti.')}finally{submitting.current=false;saving.current=false;setBusy(false)}}
 if(!authorityReady)return <LoadingState title="Memeriksa akses kalender dan roster..." shape="compact" className="ui-notice ui-notice--info" />
 return <section className="ui-section space-y-4" aria-label="Pengaturan kalender dan roster"><h2 className="font-semibold">Kalender dan roster Sabtu</h2>
  <p>Versi baru berlaku ke depan. Kelompok, zona waktu, hari Minggu dan hari libur tidak diasumsikan.</p>
  <LeaveSetupImpacts impacts={calendarResult?.impacts??result?.impacts??calendar.impacts??{available:false,pendingCount:null,approvedCount:null}}/>
  {calendar.confirmedTimezone&&<p>Zona waktu tetap kalender ini: {calendar.confirmedTimezone}</p>}
  <Field id={`${fieldId}-1`} label="Nama kalender">{control=><input {...control} aria-label="Nama kalender" value={name} disabled={busy} onChange={e=>edit(()=>setName(e.target.value))}/>}</Field>
  <Field id={`${fieldId}-2`} label="Versi berlaku mulai">{control=><input {...control} aria-label="Versi berlaku mulai" type="date" value={start} disabled={busy} onChange={e=>edit(()=>setStart(e.target.value))}/>}</Field>
  <Field id={`${fieldId}-3`} label="Versi berlaku sampai (eksklusif)">{control=><input {...control} aria-label="Versi berlaku sampai (eksklusif)" type="date" value={end} disabled={busy} onChange={e=>edit(()=>setEnd(e.target.value))}/>}</Field>
  <Field id={`${fieldId}-4`} label="Zona waktu">{control=><input {...control} aria-label="Zona waktu" value={zone} placeholder="Belum dikonfirmasi" disabled={busy} onChange={e=>edit(()=>setZone(e.target.value))}/>}</Field>
  <Field id={`${fieldId}-5`} label="Kapasitas Minggu">{control=><select {...control} aria-label="Kapasitas Minggu" value={sunday} disabled={busy} onChange={e=>edit(()=>setSunday(e.target.value))}><option value="">Belum ditetapkan</option><option value="0">Libur (0 menit)</option></select>}</Field>
  <Field id={`${fieldId}-6`} label="Hari libur (satu tanggal per baris)">{control=><textarea {...control} aria-label="Hari libur (satu tanggal per baris)" value={holidays} disabled={busy} onChange={e=>edit(()=>setHolidays(e.target.value))}/>}</Field>
  <label className="flex min-h-[var(--ui-control-size)] items-center gap-2 text-[length:var(--ui-text-label)] leading-[var(--ui-line-control)] font-medium"><input aria-label="Daftar hari libur dikonfirmasi" type="checkbox" checked={confirmed} disabled={busy} onChange={e=>edit(()=>setConfirmed(e.target.checked))}/> Daftar hari libur dikonfirmasi</label>
  <fieldset><legend>Kelompok Sabtu</legend>{groups.map((g,index)=><div key={g.id}>
   <Field id={`${fieldId}-7-${g.id}-${index}`} label={<>Nama kelompok {index+1}</>}>{control=><input {...control} aria-label={`Nama kelompok ${index+1}`} value={g.name} disabled={busy} onChange={e=>edit(()=>setGroups(groups.map(x=>x.id===g.id?{...x,name:e.target.value}:x)))}/>}</Field>
   <Field id={`${fieldId}-8-${g.id}-${index}`} label={<>Giliran {g.name} pada acuan</>}>{control=><select {...control} aria-label={`Giliran ${g.name} pada acuan`} disabled={saving.current} value={g.onAnchor===null?'':String(g.onAnchor)} onChange={e=>edit(()=>setGroups(groups.map(x=>x.id===g.id?{...x,onAnchor:e.target.value===''?null:e.target.value==='true'}:x)))}><option value="">Pilih secara eksplisit</option><option value="true">Bekerja</option><option value="false">Libur</option></select>}</Field>
  </div>)}<Button size="compact" type="button" disabled={busy||groups.length>=100} onClick={()=>edit(()=>setGroups([...groups,{id:crypto.randomUUID(),name:'',onAnchor:null}]))} variant="quiet">Tambah kelompok</Button></fieldset>
  <Field id={`${fieldId}-9`} label="Alasan perubahan">{control=><input {...control} aria-label="Alasan perubahan" value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setSaved(false)}}/>}</Field>
  <Button type="button" disabled={busy||!start} onClick={()=>void showCalendarPreview()} variant={calendarResult?.impacts.available?'secondary':'primary'}>Pratinjau dampak kalender</Button>
  <Button type="button" disabled={busy||!start||!reason.trim()||!calendarResult?.impacts.available} onClick={()=>calendarResult&&void save({operation:'save_calendar_version',...calendarInput(),previewFingerprint:calendarResult.fingerprint,reason})} variant="primary">Simpan versi kalender</Button>
  <fieldset className="space-y-2 border-t pt-3"><legend>Publikasi roster terpisah</legend>
   <Field id={`${fieldId}-10`} label="Sabtu acuan">{control=><input {...control} aria-label="Sabtu acuan" type="date" disabled={saving.current} value={anchor} onChange={e=>edit(()=>setAnchor(e.target.value))}/>}</Field>
   <Field id={`${fieldId}-11`} label="Publikasi mulai">{control=><input {...control} aria-label="Publikasi mulai" type="date" disabled={saving.current} value={from} onChange={e=>edit(()=>setFrom(e.target.value))}/>}</Field>
   <Field id={`${fieldId}-12`} label="Publikasi sampai (eksklusif)">{control=><input {...control} aria-label="Publikasi sampai (eksklusif)" type="date" disabled={saving.current} value={to} onChange={e=>edit(()=>setTo(e.target.value))}/>}</Field>
   {configDirty&&<p>Simpan versi kalender sebelum pratinjau roster.</p>}
   <Button type="button" disabled={busy||configDirty||!anchor||!from||!to||!groups.length||groups.some(g=>g.onAnchor===null)} onClick={()=>void showPreview()} variant={result?.impacts.available?'secondary':'primary'}>Pratinjau roster</Button>
   {result&&<ul>{result.rows.map(r=><li key={`${r.date}:${r.groupId}`}>{r.date} · {groups.find(g=>g.id===r.groupId)?.name??r.groupId} · {r.capacityMinutes} menit</li>)}</ul>}
   <Button type="button" disabled={busy||configDirty||!result?.impacts.available||!reason.trim()} onClick={()=>result&&void save({operation:'publish_roster',...input(),expectedVersion:result.calendarVersion,previewFingerprint:result.fingerprint,reason})} variant="primary">Terbitkan roster</Button>
  </fieldset><p className="text-base">Aturan pemberitahuan, pembatalan, audiens, retensi dan penerimaan kontrol memerlukan keputusan eksplisit.</p>
  {error&&<Notice tone="error" title={<> {error} </>}/>}{saved&&<p role="status" className="ui-notice ui-notice--info">Pengaturan tersimpan.</p>}
 </section>
}
