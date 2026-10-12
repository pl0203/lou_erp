import { Notice } from '../../../components/ui/Feedback'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { useId, useEffect, useRef, useState  } from 'react'
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
 const fieldId=useId()
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
 if(balance&&currentPeriod&&balance.year!==currentPeriod.year)return <Notice tone="error" title={<> Periode saldo tidak cocok. Muat ulang saldo tahun berjalan. </>}/>
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
 if(!authorityReady)return <p role="status" className="ui-notice ui-notice--info">Memeriksa akses perubahan saldo...</p>
 return <section className="ui-section space-y-4" aria-label="Pengaturan saldo">
  <h2 className="font-semibold">Saldo tahunan {currentPeriod?.year??'belum dikonfirmasi'}</h2>
  {own&&<p>Administrator lain harus mengubah saldo Anda.</p>}
  {!currentPeriod&&<p>Periode tahunan yang memenuhi syarat belum dikonfirmasi oleh server.</p>}
  {needsReview&&<div className="ui-notice ui-notice--warning space-y-2" role="status">
   <p>Saldo berubah sejak draf ini dimulai. Tinjau saldo terbaru sebelum melanjutkan; isian Anda tetap ada.</p>
   <p>Versi terbaru: {incoming.version}. Saldo awal: {incoming.reconciled?'sudah diverifikasi':'belum diverifikasi'}. Saldo tersedia (menit): {incoming.reconciled&&balance?.availableMinutes!==null?balance?.availableMinutes:'Belum diverifikasi'}.</p>
   <Button type="button" disabled={busy||own} onClick={()=>adoptReadback(false)} variant="secondary">Gunakan saldo terbaru untuk draf ini</Button>
   <Button type="button" disabled={busy||own} onClick={()=>adoptReadback(true)} variant="danger">Buang draf dan gunakan saldo terbaru</Button>
  </div>}
  <Field id={`${fieldId}-1`} label="ID sumber">{control=><input {...control} aria-label="ID sumber" value={source} disabled={blocked} onChange={e=>{setSource(e.target.value);setSaved(false)}} />}</Field>
  <Field id={`${fieldId}-2`} label="Alasan">{control=><input {...control} aria-label="Alasan" value={reason} disabled={blocked} onChange={e=>{setReason(e.target.value);setSaved(false)}} />}</Field>
  {canConfigure&&!reconciled&&<fieldset disabled={blocked} className="space-y-3 border-t pt-3"><legend>Rekonsiliasi saldo awal</legend>
   <p>Verifikasi jatah tahunan 5.400 menit, pemakaian sampai tanggal pembukaan dan seluruh cuti disetujui setelah tanggal tersebut. Penyiapan tidak menambah jatah kedua.</p>
   <Field id={`${fieldId}-3`} label="Jatah tahunan diverifikasi (menit)">{control=><input {...control} aria-label="Jatah tahunan diverifikasi (menit)" inputMode="numeric" value={allowance} onChange={e=>setAllowance(e.target.value)} />}</Field>
   <Field id={`${fieldId}-4`} label="Pemakaian sampai tanggal pembukaan (menit)">{control=><input {...control} aria-label="Pemakaian sampai tanggal pembukaan (menit)" inputMode="numeric" value={past} onChange={e=>setPast(e.target.value)} />}</Field>
   <Field id={`${fieldId}-5`} label="Tanggal pembukaan">{control=><input {...control} aria-label="Tanggal pembukaan" type="date" value={asOf} onChange={e=>setAsOf(e.target.value)} />}</Field>
   <p>Cantumkan setiap cuti disetujui setelah tanggal pembukaan. Server memverifikasi setiap tanggal dan total menit sebelum seluruh saldo awal disimpan.</p>
   {lines.map((line,i)=><fieldset key={i} className="space-y-2 rounded border p-3"><legend>Cuti disetujui {i+1}</legend>
    {([['sourceId','ID sumber cuti'],['startDate','Mulai cuti'],['endDate','Akhir cuti'],['totalMinutes','Total menit diverifikasi']] as const).map(([key,label])=><Field id={`${fieldId}-6-${key}-${i}`} label={<>{label}</>} key={key}>{control=><input {...control} aria-label={`${label} ${i+1}`} value={line[key]} type={key==='startDate'||key==='endDate'?'date':'text'} onChange={e=>updateLine(i,key,e.target.value)} />}</Field>)}
    <Field id={`${fieldId}-7-${i}`} label="Durasi per tanggal">{control=><select {...control} aria-label={`Durasi per tanggal ${i+1}`} value={line.mode} onChange={e=>updateLine(i,'mode',e.target.value)}><option value="">Pilih durasi</option>{[60,120,180,225,240,300,360].map(n=><option key={n} value={n}>{n} menit</option>)}<option value="full_scheduled_day">Sehari sesuai jadwal</option></select>}</Field>
    <Button type="button" onClick={()=>setLines(lines.filter((_,n)=>n!==i))} variant="danger">Hapus sumber {i+1}</Button>
   </fieldset>)}
   <Button type="button" disabled={lines.length>=100} onClick={()=>setLines([...lines,{sourceId:'',startDate:'',endDate:'',mode:'',totalMinutes:''}])} variant="secondary">Tambah cuti disetujui</Button>
   <label className="flex min-h-11 items-center gap-2 text-base"><input type="checkbox" checked={complete} onChange={e=>setComplete(e.target.checked)}/> Daftar cuti disetujui di masa depan sudah lengkap</label>
   <Button type="button" disabled={blocked||!complete||!source||!reason.trim()||!allowance||!past||!asOf} onClick={()=>void submit('reconcile_opening')} variant="primary">Simpan saldo awal</Button>
  </fieldset>}
  {canAdjust&&<fieldset disabled={blocked||!reconciled} className="space-y-3 border-t pt-3"><legend>Penyesuaian jatah</legend>
   {!reconciled&&<p>Rekonsiliasi saldo awal diperlukan sebelum penyesuaian.</p>}
   <Field id={`${fieldId}-8`} label="Menit penyesuaian">{control=><input {...control} aria-label="Menit penyesuaian" inputMode="numeric" value={delta} onChange={e=>{setDelta(e.target.value);setSaved(false)}} />}</Field><p>Gunakan menit bulat bertanda. Pengurangan tidak boleh membuat saldo di bawah komitmen pemakaian dan reservasi.</p>
   <Button type="button" disabled={blocked||!reconciled||!delta||!source||!reason.trim()} onClick={()=>void submit('adjust_balance')} variant="primary">Simpan penyesuaian</Button>
  </fieldset>}
  {error&&<Notice tone="error" title={<> {error} </>}/>}{saved&&<p role="status" className="ui-notice ui-notice--info">Saldo tersimpan. Muat ulang untuk meninjau versi terbaru.</p>}
 </section>
}
