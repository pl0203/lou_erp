import { expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { store, wire, customer, month, draftId, id } from './report-ui-harness';

export const evidenceId=id(45);
export function fixture(){
 const s=store(),base=s.handle;let e:any=null,receipt:any=null;const commands:any[]=[];let selectionFail=false, lost:string|null=null;
 wire.handler=async(n:string,a:any)=>{
  if(n==='pilot_co_evidence_transaction_v1'){
   commands.push(a);if(a.p_operation==='register_evidence')e={id:evidenceId,version:'1',customer_id:customer,customer_version:s.cv,draft_id:draftId,draft_version:s.version,report_month:month,filename:`evidence-${evidenceId}.pdf`,mime_type:'application/pdf',byte_size:a.p_payload.byte_size,state:'pending',finalized_draft_version:null};
   else {e={...e,version:'2',state:'finalized',finalized_draft_version:String(BigInt(s.version)+1n)};s.version=e.finalized_draft_version;}
   receipt={id:e.id,operation:a.p_operation,version:e.version,customer_id:customer,customer_version:s.cv};
   if(lost===a.p_operation)return {data:null,error:{message:'Lost evidence response'}};
   return {data:receipt,error:null};
  }
  if(n==='pilot_reconcile_co_evidence_v1')return {data:{status:'committed',operation:receipt.operation,receipt},error:null};
  if(n==='pilot_co_evidence_v1')return {data:e,error:null};
  if(n==='pilot_co_evidence_selection_v1'){
   if(selectionFail&&e?.state==='finalized')return {data:null,error:{message:'Sidecar unavailable',code:'08006'}};
   return {data:{version:'1',customer_id:customer,draft_id:a.p_draft_id,draft_version:a.p_expected_draft_version,revision_id:a.p_revision_id,evidence:e?.state==='finalized'?e:null},error:null};
  }
  return base(n,a);
 };
 wire.invoke.mockImplementation(async(n)=>{if(n==='co-evidence-upload'){e={...e,state:'verified'};return {data:{id:e.id,state:'verified'},error:null};}return {data:new Blob(['%PDF-1.7\n%%EOF\n']),error:null};});
 return {s,commands,get e(){return e},finalizeElsewhere(){ e={...e,version:'2',state:'finalized',finalized_draft_version:String(BigInt(s.version)+1n)};s.version=e.finalized_draft_version; },set selectionFail(v:boolean){selectionFail=v},set lost(v:string|null){lost=v}};
}
export async function choose(){const bytes=new TextEncoder().encode('%PDF-1.7\n%%EOF\n');const f=new File([bytes],'synthetic.pdf',{type:'application/pdf'});Object.defineProperty(f,'arrayBuffer',{value:async()=>bytes.buffer});const picker=await screen.findByLabelText('Pilih lampiran');await waitFor(()=>expect((picker as HTMLInputElement).disabled).toBe(false));fireEvent.change(picker,{target:{files:[f]}});await screen.findByText('synthetic.pdf · belum terpasang');}
