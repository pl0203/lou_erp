import { useEffect, useId, useRef, useState } from 'react';
import type { COReportHeader, COReportRow } from '../../lib/co/validation';
import type { COReceipt } from '../../lib/co/contracts';
import { completeCORead, fetchCOReportRows } from '../../lib/co/rpc';
import { useBeforeSignOut } from '../../lib/AuthContext';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { LoadingState } from '../ui/LoadingState';
import { Notice } from '../ui/Feedback';
import { COFailure, CORecoveryPanel, useCORead } from './COShared';
import { COReportFields, COReportCorrectionConsent, reportBinding, useCOReportWorkspace } from './COReportWorkspace';
import type { LegacySeedBaseline } from './COReportWorkspace';
import COCorrectionDialog from './COCorrectionDialog';

/** Manual ledger-only owner. Mounted only after the immutable import read returns no manifest. */
export default function COLegacyReportEdit({customerId,month,revisionId,customerVersion,onRecorded,onExit}:{
 customerId:string;month:string;revisionId:string;customerVersion:string;onRecorded:()=>void;onExit:()=>void;
}){
 const work=useCOReportWorkspace(customerId,month);
 const [prepared,setPrepared]=useState(false),[review,setReview]=useState<Record<string,unknown>|null>(null);
 const [replacement,setReplacement]=useState<LegacySeedBaseline|null>(null),[reviewDirty,setReviewDirty]=useState(false),[reviewPending,setReviewPending]=useState(false);
 const trigger=useRef<HTMLElement|null>(null), reviewTrigger=useRef<HTMLSpanElement|null>(null), title=useId();
 const effective=work.accepted?.effective as COReportHeader|null|undefined;
 const pinned=!!effective&&effective.customer_id===customerId&&effective.report_month===month&&effective.revision_id===revisionId&&work.accepted?.customer_version===customerVersion;
 const canonical=useCORead(work.actor,'legacy-effective-seed',{customerId,month,revisionId,customerVersion},async o=>{
  if(!pinned)throw new Error('Dasar Edit berubah; muat ulang laporan.');
  return await completeCORead(async page=>{
   const r=await fetchCOReportRows({p_customer_id:customerId,p_month:month,p_view:'revision',p_revision_id:revisionId,p_expected_draft_version:null,p_expected_customer_version:customerVersion,p_page:page,p_page_size:100},o);
   if(r.total!==effective.row_count||r.revision_id!==revisionId||r.draft_id!==null||r.draft_version!==null
      ||r.generation_id!==effective.generation_id||r.source_context_link!==null||r.source_context_fingerprint!==null||r.context_issue!==null
      ||r.rows.some((line:COReportRow)=>line.sold_quantity===null))throw new Error('Baris laporan tercatat tidak sesuai dasar Edit.');
   return r;
  },r=>r.stock_key_id);
 },pinned&&!work.denied);
 const retains=work.pending||work.sender.hasUnresolved()||!!work.confirmed||reviewPending;
 const unsaved=useUnsavedChanges(work.dirty||prepared||reviewDirty||retains);
 const dismissal=useRef({retains,review}),restoreReviewFocus=useRef(false);
 dismissal.current={retains,review};
 useEffect(()=>{if(!review&&restoreReviewFocus.current){restoreReviewFocus.current=false;reviewTrigger.current?.querySelector<HTMLButtonElement>('button')?.focus()}},[review]);
 async function closeReview(){
  if(retains||!work.current())return;
  const closing=review;
  if(!await unsaved.confirmDiscardDecision()||!work.current()||dismissal.current.retains||dismissal.current.review!==closing)return;
  restoreReviewFocus.current=true;
  setReview(null);setReviewDirty(false);
 }

 useBeforeSignOut(signal=>unsaved.confirmDiscardDecision({signal}),`${customerId}:${month}:${revisionId}`);
 const blocked=work.frozen||!pinned||!canonical.data||canonical.isFetching||canonical.isError;
 useEffect(()=>{if(canonical.error)work.setError(canonical.error)},[canonical.error]);
 async function seed(baseline:LegacySeedBaseline){
  setReplacement(null);
  try{const h=await work.initialize(undefined,baseline);if(h&&work.current())setPrepared(true)}catch{/* Workspace preserves the failure and original request. */}
 }
 function begin(){
  if(blocked||!work.accepted)return;
  const d=work.accepted.draft;
  const baseline:LegacySeedBaseline={revisionId,customerVersion,draftId:d?.draft_id??null,draftVersion:d?.draft_version??null};
  if(d&&!d.consumed)setReplacement(baseline);else void seed(baseline);
 }
 async function inspect(){
  try{
   const h=await work.save();if(!h||!work.current())return;
   if(!h.complete)throw new Error('Lengkapi semua baris, termasuk nol eksplisit, sebelum meninjau perubahan.');
   if(!effective||!pinned)throw new Error('Dasar Edit berubah; muat ulang laporan.');
   setReview({...reportBinding(h),report_head_id:effective.report_head_id,original_revision_id:effective.revision_id,expected_report_version:effective.report_version});
  }catch(error){work.setError(error)}
 }
 async function accept(receipt:COReceipt,recovered=false){
  if(!['save_report_draft','correct_report'].includes(receipt.operation))throw new Error('Hasil pemulihan bukan Edit laporan ini.');
  const ok=await work.acceptCanonical(receipt,recovered);
  if(ok&&work.current()){
   if(receipt.operation==='correct_report'){unsaved.runWithoutPrompt(onRecorded)}
   else if(receipt.operation==='save_report_draft')setPrepared(true);
   else throw new Error('Hasil pemulihan bukan Edit laporan ini.');
  }
  return ok;
 }
 if(work.denied)return <COFailure error={work.authorityError} retry={work.retryAuthority}/>;
 if(!work.accepted)return <LoadingState title="Memuat dasar Edit…" shape="compact"/>;
 return <section className="space-y-4" aria-label="Edit ledger historis">{unsaved.dialog}
  <Notice tone="info" title="Nilai awal dari laporan tercatat (ledger historis); sumber asli tidak tersedia"><p>Satuan, harga, dan nilai sumber asli tidak tersedia. Jumlah berasal dari ledger historis, bukan transkripsi sumber. Deklarasi satuan saat ini adalah metadata ledger saat ini, bukan bukti satuan sumber historis.</p></Notice>
  <CORecoveryPanel confirmed={!!work.confirmed} pending={work.pending} sender={work.sender} current={()=>work.current()&&!work.pending} accept={r=>accept(r,true)}/>
  {work.confirmed&&<Button disabled={work.pending} onClick={()=>void accept(work.confirmed!).catch(work.setError)}>Buka hasil Edit tersimpan</Button>}
  {!review&&<COReportCorrectionConsent work={work} onAccepted={()=>unsaved.runWithoutPrompt(onRecorded)}/>}
  {!pinned&&<COFailure error={new Error('Dasar Edit berubah; muat ulang laporan.')}/>}
  {!canonical.data&&!canonical.isError&&pinned&&<LoadingState title="Memuat semua nilai laporan tercatat…" shape="compact"/>}
  {review?<COCorrectionDialog resultAcceptance={<COReportCorrectionConsent work={work} onAccepted={()=>unsaved.runWithoutPrompt(onRecorded)}/>} operation="correct_report" finalActionLabel="Simpan perubahan" customerId={customerId} source={review} selectedMonth={month} sender={work.sender} current={work.current} blocked={blocked} onAccepted={r=>accept(r)} onRecovered={r=>accept(r,true)} onClose={()=>void closeReview()} returnFocus={trigger.current} ownUnsaved={false} onDirtyChange={setReviewDirty} onPendingChange={setReviewPending} confirmDiscard={message=>unsaved.confirmDiscardDecision({message})} onAuthorityFailure={work.setError}/>:
   prepared?<><COReportFields work={work}/><span ref={reviewTrigger}><Button disabled={blocked} onClick={e=>{trigger.current=e.currentTarget;void inspect()}}>Tinjau perubahan</Button></span></>:<Button disabled={blocked} onClick={e=>{trigger.current=e.currentTarget;begin()}}>Mulai Edit dari laporan tercatat</Button>}
  {!prepared&&work.error&&<COFailure error={work.error}/>}
  <Button variant="quiet" disabled={retains} onClick={()=>unsaved.confirmDiscard(onExit)}>Batal Edit</Button>
  {replacement&&<Dialog labelledBy={title} pending={work.pending} onClose={()=>setReplacement(null)} returnFocus={trigger.current} fallbackFocus={()=>trigger.current}><h2 id={title}>Ganti isian laporan tersimpan?</h2><p>Draft {replacement.draftId} · versi {replacement.draftVersion}. Isian dan metadata pending akan diganti dengan laporan tercatat, bukan dipakai sebagai nilai awal. Riwayat sebelum penggantian tetap tersimpan.</p><Button onClick={()=>setReplacement(null)}>Batal penggantian</Button><Button onClick={()=>void seed(replacement)}>Ganti isian tersimpan</Button></Dialog>}
 </section>;
}
