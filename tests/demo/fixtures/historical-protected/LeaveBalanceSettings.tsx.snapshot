import { useEffect, useRef, useState } from 'react'
import type { AnnualPeriod, Balance, DurationSelection } from '../../../lib/leave/contracts'
import type { BalanceCommand, BalanceSend, OpeningSourceLine } from '../../../lib/leave/accountContracts'
import { toBalancePayload } from '../../../lib/leave/accountRpc'
import { useSetupUnsaved } from './useSetupUnsaved'
type WriteAccount=Pick<Balance,'accountId'|'year'|'version'|'reconciled'>
type Props={authorityReady?:boolean;onDirtyChange?:(dirty:boolean)=>void;accountMetadata?:WriteAccount;actorId:string;employeeId:string;currentPeriod:AnnualPeriod|null;balance?:Balance;canConfigure:boolean;canAdjust:boolean;send:BalanceSend;onSaved?:(state:{hasUnsavedChanges:boolean})=>void}
type DraftLine={sourceId:string;startDate:string;endDate:string;mode:string;totalMinutes:string}
type AccountState={accountId:string|null;version:number;reconciled:boolean}
const readback=(balance?:WriteAccount):AccountState=>({accountId:balance?.accountId??null,version:balance?.version??0,reconciled:balance?.reconciled===true})
const emptyDraft=JSON.stringify({allowance:'',past:'',asOf:'',lines:[],complete:false,delta:'',source:'',reason:''})
/** Parent supplies independently authorized target/balances and a live-authority transport. Task11 owns routing. */
export default function LeaveBalanceSettings(props:Props){return <BalanceEditor key={`${props.actorId}:${props.employeeId}:${props.currentPeriod?.year??'blocked'}:${props.canConfigure}:${props.canAdjust}`} {...props}/>}
function BalanceEditor({actorId,employeeId,currentPeriod,balance,accountMetadata,canConfigure,canAdjust,send,onSaved,onDirtyChange,authorityReady=true}:Props){
 const [allowance,setAllowance]=useState(''),[past,setPast]=useState(''),[asOf,setAsOf]=useState(''),[lines,setLines]=useState<DraftLine[]>([]),[complete,setComplete]=useState(false)
 const [delta,setDelta]=useState(''),[source,setSource]=useState(''),[reason,setReason]=useState('')
 const incoming=readback(accountMetadata??balance),incomingKey=JSON.stringify(incoming)
 const [account,setAccount]=useState(incoming),[observed,setObserved]=useState(incomingKey)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),submitting=useRef(false)
 const draft=JSON.stringify({allowance,past,asOf,lines,complete,delta,source,reason}),[baseline,setBaseline]=useState(draft)
 const dirty=draft!==baseline
 useSetupUnsaved(dirty)
 useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)},[dirty,onDirtyChange])
 // Clean readback can advance immediately. A receipt is retained until genuinely new props arrive;
 // repeated old props must not undo our successful version or verification state.
 const older=incoming.accountId===account.accountId&&incoming.version<account.version
 if(!busy&&observed!==incomingKey&&(!dirty||older||incomingKey===JSON.stringify(account))){
  setObserved(incomingKey)
  if(!older)setAccount(incoming)
 }
 const needsReview=observed!==incomingKey&&!older
 const {version,reconciled}=account
 if(!canConfigure&&!canAdjust)return <p>Akses pengaturan saldo tidak tersedia.</p>
 if(balance&&currentPeriod&&balance.year!==currentPeriod.year)return <p role="alert">Periode saldo tidak cocok. Muat ulang saldo tahun berjalan.</p>
 const own=actorId===employeeId,blocked=busy||own||!currentPeriod||needsReview||!authorityReady
 function adoptReadback(discard:boolean){
  if(busy||own)return
  setAccount(incoming);setObserved(incomingKey);setError('');setSaved(false)
  if(discard){setAllowance('');setPast('');setAsOf('');setLines([]);setComplete(false);setDelta('');setSource('');setReason('');setBaseline(emptyDraft)}
 }
 const updateLine=(i:number,key:keyof DraftLine,value:string)=>{setLines(lines.map((line,n)=>n===i?{...line,[key]:value}:line));setSaved(false)}
 const number=(value:string)=>{if(!/^-?\d+$/.test(value))throw new Error('integer');return Number(value)}
 async function submit(operation:BalanceCommand['operation']){
  if(submitting.current||blocked||!currentPeriod||(operation==='reconcile_opening'&&(!canConfigure||!complete||reconciled))||(operation==='adjust_balance'&&(!canAdjust||!reconciled)))return
  setError('');setSaved(false)
  try{
   const base={employeeId,year:currentPeriod.year,sourceId:source,expectedVersion:version,reason}
   let command:BalanceCommand
   if(operation==='reconcile_opening'){
    const futureApproved:OpeningSourceLine[]=lines.map(line=>({sourceId:line.sourceId,startDate:line.startDate,endDate:line.endDate,duration:line.mode==='full_scheduled_day'?{mode:'full_scheduled_day'}:{mode:'fixed_minutes',minutes:number(line.mode)} as DurationSelection,totalMinutes:number(line.totalMinutes)}))
    command={...base,operation,allowanceMinutes:number(allowance),pastUsedMinutes:number(past),asOf,futureApproved}
   }else{
    // A preserved opening draft may contain incomplete hidden rows after verified readback.
    // Only fields belonging to this operation may participate in validation or transmission.
    command={...base,operation,deltaMinutes:number(delta)}
   }
   toBalancePayload(command);submitting.current=true;setBusy(true)
   const receipt=await send(command);setAccount(previous=>({accountId:receipt.id,version:receipt.version,reconciled:operation==='reconcile_opening'||previous.reconciled}))
   setBaseline(draft);setSaved(true);onSaved?.({hasUnsavedChanges:false})
  }catch{setError('Saldo belum dapat disimpan. Periksa akses, versi dan isian. Isian tetap ada; pulihkan hasil bila status belum pasti.')}
  finally{submitting.current=false;setBusy(false)}
 }
 if(!authorityReady)return <p role="status">Memeriksa akses perubahan saldo...</p>
 return <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="Pengaturan saldo">
  <h2 className="font-semibold">Saldo tahunan {currentPeriod?.year??'belum dikonfirmasi'}</h2>
  {own&&<p>Administrator lain harus mengubah saldo Anda.</p>}
  {!currentPeriod&&<p>Periode tahunan yang memenuhi syarat belum dikonfirmasi oleh server.</p>}
  {needsReview&&<div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3" role="status">
   <p>Saldo berubah sejak draf ini dimulai. Tinjau saldo terbaru sebelum melanjutkan; isian Anda tetap ada.</p>
   <p>Versi terbaru: {incoming.version}. Saldo awal: {incoming.reconciled?'sudah diverifikasi':'belum diverifikasi'}. Saldo tersedia (menit): {incoming.reconciled&&balance?.availableMinutes!==null?balance?.availableMinutes:'Belum diverifikasi'}.</p>
   <button type="button" disabled={busy||own} onClick={()=>adoptReadback(false)}>Gunakan saldo terbaru untuk draf ini</button>
   <button type="button" disabled={busy||own} onClick={()=>adoptReadback(true)}>Buang draf dan gunakan saldo terbaru</button>
  </div>}
  <label className="block">ID sumber<input aria-label="ID sumber" value={source} disabled={blocked} onChange={e=>{setSource(e.target.value);setSaved(false)}} className="block w-full rounded border p-2"/></label>
  <label className="block">Alasan<input aria-label="Alasan" value={reason} disabled={blocked} onChange={e=>{setReason(e.target.value);setSaved(false)}} className="block w-full rounded border p-2"/></label>
  {canConfigure&&!reconciled&&<fieldset disabled={blocked} className="space-y-3 border-t pt-3"><legend>Rekonsiliasi saldo awal</legend>
   <p>Verifikasi jatah tahunan 5.400 menit, pemakaian sampai tanggal pembukaan dan seluruh cuti disetujui setelah tanggal tersebut. Penyiapan tidak menambah jatah kedua.</p>
   <label className="block">Jatah tahunan diverifikasi (menit)<input aria-label="Jatah tahunan diverifikasi (menit)" inputMode="numeric" value={allowance} onChange={e=>setAllowance(e.target.value)} className="block rounded border p-2"/></label>
   <label className="block">Pemakaian sampai tanggal pembukaan (menit)<input aria-label="Pemakaian sampai tanggal pembukaan (menit)" inputMode="numeric" value={past} onChange={e=>setPast(e.target.value)} className="block rounded border p-2"/></label>
   <label className="block">Tanggal pembukaan<input aria-label="Tanggal pembukaan" type="date" value={asOf} onChange={e=>setAsOf(e.target.value)} className="block rounded border p-2"/></label>
   <p>Cantumkan setiap cuti disetujui setelah tanggal pembukaan. Server memverifikasi setiap tanggal dan total menit sebelum seluruh saldo awal disimpan.</p>
   {lines.map((line,i)=><fieldset key={i} className="space-y-2 rounded border p-3"><legend>Cuti disetujui {i+1}</legend>
    {([['sourceId','ID sumber cuti'],['startDate','Mulai cuti'],['endDate','Akhir cuti'],['totalMinutes','Total menit diverifikasi']] as const).map(([key,label])=><label className="block" key={key}>{label}<input aria-label={`${label} ${i+1}`} value={line[key]} type={key==='startDate'||key==='endDate'?'date':'text'} onChange={e=>updateLine(i,key,e.target.value)} className="block rounded border p-2"/></label>)}
    <label className="block">Durasi per tanggal<select aria-label={`Durasi per tanggal ${i+1}`} value={line.mode} onChange={e=>updateLine(i,'mode',e.target.value)}><option value="">Pilih durasi</option>{[60,120,180,225,240,300,360].map(n=><option key={n} value={n}>{n} menit</option>)}<option value="full_scheduled_day">Sehari sesuai jadwal</option></select></label>
    <button type="button" onClick={()=>setLines(lines.filter((_,n)=>n!==i))}>Hapus sumber {i+1}</button>
   </fieldset>)}
   <button type="button" disabled={lines.length>=100} onClick={()=>setLines([...lines,{sourceId:'',startDate:'',endDate:'',mode:'',totalMinutes:''}])}>Tambah cuti disetujui</button>
   <label className="block"><input type="checkbox" checked={complete} onChange={e=>setComplete(e.target.checked)}/> Daftar cuti disetujui di masa depan sudah lengkap</label>
   <button type="button" disabled={blocked||!complete||!source||!reason.trim()||!allowance||!past||!asOf} onClick={()=>void submit('reconcile_opening')}>Simpan saldo awal</button>
  </fieldset>}
  {canAdjust&&<fieldset disabled={blocked||!reconciled} className="space-y-3 border-t pt-3"><legend>Penyesuaian jatah</legend>
   {!reconciled&&<p>Rekonsiliasi saldo awal diperlukan sebelum penyesuaian.</p>}
   <label className="block">Menit penyesuaian<input aria-label="Menit penyesuaian" inputMode="numeric" value={delta} onChange={e=>{setDelta(e.target.value);setSaved(false)}} className="block rounded border p-2"/></label><p>Gunakan menit bulat bertanda. Pengurangan tidak boleh membuat saldo di bawah komitmen pemakaian dan reservasi.</p>
   <button type="button" disabled={blocked||!reconciled||!delta||!source||!reason.trim()} onClick={()=>void submit('adjust_balance')}>Simpan penyesuaian</button>
  </fieldset>}
  {error&&<p role="alert">{error}</p>}{saved&&<p role="status">Saldo tersimpan. Muat ulang untuk meninjau versi terbaru.</p>}
 </section>
}
