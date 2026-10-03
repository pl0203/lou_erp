import { useEffect, useRef, useState } from 'react'
import type { LeaveCalendarSetup, LeaveSetupCommand, LeaveSetupSend, RosterPreview, RosterPreviewInput, CalendarPreview, CalendarPreviewInput } from '../../../lib/leave/setupContracts'
import LeaveSetupImpacts from './LeaveSetupImpacts'
import { useSetupUnsaved } from './useSetupUnsaved'
type Props={authorityReady?:boolean;onDirtyChange?:(dirty:boolean)=>void;calendar:LeaveCalendarSetup;send:LeaveSetupSend;preview:(input:RosterPreviewInput)=>Promise<RosterPreview>;previewCalendar:(input:CalendarPreviewInput)=>Promise<CalendarPreview>;onSaved?:(state:{hasUnsavedChanges:boolean})=>void}
export default function LeaveRotaSettings({calendar,send,preview,previewCalendar,onSaved,onDirtyChange,authorityReady=true}:Props){
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
 if(!authorityReady)return <p role="status">Memeriksa akses kalender dan roster...</p>
 return <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="Pengaturan kalender dan roster"><h2 className="font-semibold">Kalender dan roster Sabtu</h2>
  <p>Versi baru berlaku ke depan. Kelompok, zona waktu, hari Minggu dan hari libur tidak diasumsikan.</p>
  <LeaveSetupImpacts impacts={calendarResult?.impacts??result?.impacts??calendar.impacts??{available:false,pendingCount:null,approvedCount:null}}/>
  {calendar.confirmedTimezone&&<p>Zona waktu tetap kalender ini: {calendar.confirmedTimezone}</p>}
  <label className="block">Nama kalender<input aria-label="Nama kalender" value={name} disabled={busy} onChange={e=>edit(()=>setName(e.target.value))}/></label>
  <label className="block">Versi berlaku mulai<input aria-label="Versi berlaku mulai" type="date" value={start} disabled={busy} onChange={e=>edit(()=>setStart(e.target.value))}/></label>
  <label className="block">Versi berlaku sampai (eksklusif)<input aria-label="Versi berlaku sampai (eksklusif)" type="date" value={end} disabled={busy} onChange={e=>edit(()=>setEnd(e.target.value))}/></label>
  <label className="block">Zona waktu<input aria-label="Zona waktu" value={zone} placeholder="Belum dikonfirmasi" disabled={busy} onChange={e=>edit(()=>setZone(e.target.value))}/></label>
  <label className="block">Kapasitas Minggu<select aria-label="Kapasitas Minggu" value={sunday} disabled={busy} onChange={e=>edit(()=>setSunday(e.target.value))}><option value="">Belum ditetapkan</option><option value="0">Libur (0 menit)</option></select></label>
  <label className="block">Hari libur (satu tanggal per baris)<textarea aria-label="Hari libur (satu tanggal per baris)" value={holidays} disabled={busy} onChange={e=>edit(()=>setHolidays(e.target.value))}/></label>
  <label className="block"><input aria-label="Daftar hari libur dikonfirmasi" type="checkbox" checked={confirmed} disabled={busy} onChange={e=>edit(()=>setConfirmed(e.target.checked))}/> Daftar hari libur dikonfirmasi</label>
  <fieldset><legend>Kelompok Sabtu</legend>{groups.map((g,index)=><div key={g.id}>
   <label>Nama kelompok {index+1}<input aria-label={`Nama kelompok ${index+1}`} value={g.name} disabled={busy} onChange={e=>edit(()=>setGroups(groups.map(x=>x.id===g.id?{...x,name:e.target.value}:x)))}/></label>
   <label>Giliran {g.name} pada acuan<select aria-label={`Giliran ${g.name} pada acuan`} disabled={saving.current} value={g.onAnchor===null?'':String(g.onAnchor)} onChange={e=>edit(()=>setGroups(groups.map(x=>x.id===g.id?{...x,onAnchor:e.target.value===''?null:e.target.value==='true'}:x)))}><option value="">Pilih secara eksplisit</option><option value="true">Bekerja</option><option value="false">Libur</option></select></label>
  </div>)}<button type="button" disabled={busy||groups.length>=100} onClick={()=>edit(()=>setGroups([...groups,{id:crypto.randomUUID(),name:'',onAnchor:null}]))}>Tambah kelompok</button></fieldset>
  <label className="block">Alasan perubahan<input aria-label="Alasan perubahan" value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setSaved(false)}}/></label>
  <button type="button" disabled={busy||!start} onClick={()=>void showCalendarPreview()}>Pratinjau dampak kalender</button>
  <button type="button" disabled={busy||!start||!reason.trim()||!calendarResult?.impacts.available} onClick={()=>calendarResult&&void save({operation:'save_calendar_version',...calendarInput(),previewFingerprint:calendarResult.fingerprint,reason})}>Simpan versi kalender</button>
  <fieldset className="space-y-2 border-t pt-3"><legend>Publikasi roster terpisah</legend>
   <label className="block">Sabtu acuan<input aria-label="Sabtu acuan" type="date" disabled={saving.current} value={anchor} onChange={e=>edit(()=>setAnchor(e.target.value))}/></label>
   <label className="block">Publikasi mulai<input aria-label="Publikasi mulai" type="date" disabled={saving.current} value={from} onChange={e=>edit(()=>setFrom(e.target.value))}/></label>
   <label className="block">Publikasi sampai (eksklusif)<input aria-label="Publikasi sampai (eksklusif)" type="date" disabled={saving.current} value={to} onChange={e=>edit(()=>setTo(e.target.value))}/></label>
   {configDirty&&<p>Simpan versi kalender sebelum pratinjau roster.</p>}
   <button type="button" disabled={busy||configDirty||!anchor||!from||!to||!groups.length||groups.some(g=>g.onAnchor===null)} onClick={()=>void showPreview()}>Pratinjau roster</button>
   {result&&<ul>{result.rows.map(r=><li key={`${r.date}:${r.groupId}`}>{r.date} · {groups.find(g=>g.id===r.groupId)?.name??r.groupId} · {r.capacityMinutes} menit</li>)}</ul>}
   <button type="button" disabled={busy||configDirty||!result?.impacts.available||!reason.trim()} onClick={()=>result&&void save({operation:'publish_roster',...input(),expectedVersion:result.calendarVersion,previewFingerprint:result.fingerprint,reason})}>Terbitkan roster</button>
  </fieldset><p className="text-sm">Aturan pemberitahuan, pembatalan, audiens, retensi dan penerimaan kontrol memerlukan keputusan eksplisit.</p>
  {error&&<p role="alert">{error}</p>}{saved&&<p role="status">Pengaturan tersimpan.</p>}
 </section>
}
