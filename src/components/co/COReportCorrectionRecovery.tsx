import { useRef, useState } from 'react';
import { inspectCOReportCorrection } from '../../lib/co/reportCorrectionResult';
import type { COReceipt } from '../../lib/co/contracts';
import { invalid } from '../../lib/co/validation';
import { useCOTransactionSender } from '../../lib/co/transactions';
import { Button } from '../ui/Button';
import { COFailure, CORecoveryPanel, useCOActor } from './COShared';

/** Recovery-only ordinary monthly owner. No initialization, editing, import acceptance or new command. */
export default function COReportCorrectionRecovery({customerId,month,onRecorded,onExit}:{customerId:string;month:string;onRecorded:()=>void;onExit:()=>void}){
 const actor=useCOActor(`report-correction-recovery:${customerId}:${month}`);
 const sender=useCOTransactionSender({formScope:`report:${month}`,customerId});
 const [changed,setChanged]=useState<{receipt:COReceipt;snapshot:string;originalRevisionId:string;currentRevisionId:string;reportVersion:string;customerVersion:string}|null>(null),[ack,setAck]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<unknown>(null);
 const busy=useRef(false);
 async function accept(receipt:COReceipt,confirmedSnapshot?:string){
  if(busy.current||!actor.isCurrent())return false;
  busy.current=true;setPending(true);setError(null);
  try{
   const pin=sender.getCommittedIdentity(receipt);if(pin.operation!=='correct_report'||pin.customer_id!==customerId||pin.target_id!==receipt.id)invalid('original correction receipt scope');
   const checked=await inspectCOReportCorrection(customerId,month,receipt,actor.isCurrent);if(!actor.isCurrent())return false;
   if(checked.changed&&confirmedSnapshot!==checked.snapshot){setChanged({...checked,receipt});setAck(false);return false}
   if(confirmedSnapshot&&confirmedSnapshot!==checked.snapshot){setChanged({...checked,receipt});setAck(false);return false}
   await sender.acknowledgeRecovered(actor.isCurrent);
   if(!actor.isCurrent())return false;
   onRecorded();return true;
  }catch(failure){if(actor.isCurrent()){actor.rejectAuthority(failure);setError(failure)}return false}
  finally{busy.current=false;if(actor.isCurrent())setPending(false)}
 }
 return <section aria-label="Pemulihan koreksi laporan" className="space-y-3">
  <p>Pulihkan hasil koreksi laporan asli. Pemeriksaan ini tidak menyiapkan draft atau mengirim perubahan baru.</p>
  {error&&<COFailure error={error}/>}
  <CORecoveryPanel sender={sender} pending={pending} current={actor.isCurrent} accept={receipt=>accept(receipt)}/>
  {changed&&<section><h2>Hasil koreksi asli ditemukan; keadaan terkini telah berubah</h2><p>Hasil asli: {changed.receipt.id} · versi laporan {changed.receipt.version} · revisi {changed.originalRevisionId}. Keadaan terkini: versi laporan {changed.reportVersion} · versi pelanggan {changed.customerVersion} · revisi {changed.currentRevisionId}. Hasil asli tetap tercatat; penerimaan tidak menimpa keadaan terkini.</p><label><input type="checkbox" disabled={pending} checked={ack} onChange={e=>setAck(e.target.checked)}/>Saya memahami keadaan terkini dapat berbeda dari hasil asli</label><Button disabled={!ack||pending} onClick={()=>void accept(changed.receipt,changed.snapshot)}>Terima hasil koreksi asli</Button></section>}
  <Button variant="quiet" disabled={pending} onClick={onExit}>Kembali ke laporan</Button>
 </section>;
}
