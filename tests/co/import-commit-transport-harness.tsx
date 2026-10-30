/** Opt-in recorded/commit transport extension. No controller, ports, sender or decoder mocks.
 * Synthetic state is an expected server contract, not evidence of hosted SQL/FIFO behavior. */
import { productionImportFixture, uploadMonth } from './import-production-ports-harness';
import { customer, draftId, id, wire } from './report-ui-harness';
import { decodeImportPost } from '../../src/lib/co/import/manifest';
export const committedHead=id(90),committedRevision=id(91);
const timestamp='2026-10-29T00:00:00Z';
export async function productionCommitFixture(options:{zeroSource?:boolean}={}){
 const f=await productionImportFixture(options);f.state.incomplete=false;const base=wire.handler;
 let binding:any,manifest:any,receipt:any=null,requestId:string|null=null;
 const state={lostReply:false,unknownRecovery:false,commitCalls:[] as any[],reconcileCalls:[] as any[]};
 const conflict=(message:string)=>({data:null,error:{code:'PT409',message}});
 wire.handler=async(n:string,a:any)=>{
  if(n==='pilot_co_import_commit_v1'){
   const p=decodeImportPost(a.p_payload);state.commitCalls.push(structuredClone(a));f.writes.push({name:n,args:structuredClone(a)});
   if(requestId)throw new Error('Unexpected duplicate commit transport dispatch');
   if(!binding||p.requestId!==a.p_request_id||JSON.stringify(p.binding)!==JSON.stringify(binding)||p.previewFingerprint!=='b'.repeat(64)||p.mode!=='post'||p.acknowledgedReopenOrders?.length||f.s.cv!==binding.customerVersion||f.s.version!==binding.draftVersion)return conflict('Strict commit binding changed');
   if(manifest.input.extracted.sha256!==f.sourceFixture.sha||manifest.input.scope.customerId!==customer||manifest.input.scope.reportMonth!==uploadMonth)throw new Error('Unexpected commit source');
   requestId=a.p_request_id;f.s.cv='2';f.s.rows[0].sold_quantity=f.sourceFixture.quantity;f.s.rows[0].revision_line_id=id(92);
   f.s.effective={...f.s.header(),id:committedHead,status:'posted',draft_id:null,draft_version:null,report_head_id:committedHead,revision_id:committedRevision,report_version:'1',eligible_set_fingerprint:null,revenue:f.sourceFixture.amount,coverage_through_date:'2026-10-29',is_partial_month:true};f.s.draft=false;
   receipt={id:committedHead,operation:'post_report',version:'1',customer_id:customer,customer_version:'2'};
   return state.lostReply?{data:null,error:{code:'08006',message:'Commit reply lost'}}:{data:receipt,error:null};
  }
  if(n==='pilot_co_import_reconcile_v1'){
   state.reconcileCalls.push(structuredClone(a));
   if(a.p_request_id!==requestId||typeof a.p_abandon!=='boolean')throw new Error('Recovery must retain the original request identity');
   return {data:state.unknownRecovery?{status:'unknown'}:{status:'committed',operation:'post_report',receipt},error:null};
  }
  if(n==='pilot_co_report_import_v1'&&receipt){
   if(a.p_customer_id!==customer||a.p_month!==uploadMonth||![committedRevision,f.s.effective.revision_id].includes(a.p_revision_id))return conflict('Recorded import scope changed');
   return {data:{version:'1',as_of:timestamp,customer_id:customer,report_month:uploadMonth,revision_id:a.p_revision_id,report_head_id:committedHead,effective_revision_id:f.s.effective.revision_id,manifest,unit_declarations:{[id(1001)]:{id:id(77),version:'1',unit:'test unit'}},source_amount:f.sourceFixture.amount,currency:'IDR',source_filename:f.sourceFixture.filename,created_at:timestamp,created_by:id(1),author_name:'Synthetic CO Admin',reason:a.p_revision_id===committedRevision?null:'Concurrent synthetic correction',report_version:a.p_revision_id===committedRevision?'1':f.s.effective.report_version,previous_revision_id:a.p_revision_id===committedRevision?null:committedRevision},error:null};
  }
  if(n==='pilot_co_report_allocations_v1'&&receipt){
   if(a.p_customer_id!==customer||a.p_month!==uploadMonth||a.p_revision_id!==f.s.effective.revision_id||a.p_expected_customer_version!==f.s.cv)return conflict('Recorded allocation scope changed');
   const row={id:id(93),customer_id:customer,report_revision_id:a.p_revision_id,report_month:uploadMonth,stock_key_id:id(1001),batch_id:id(94),co_id:id(95),co_number:'TEST-CO',co_line_id:id(96),delivery_head_id:id(97),delivery_revision_id:id(98),sj_number:'TEST-SJ',sj_date:'2026-10-01',quantity:'1',unit_price:'10000',amount:'10000',sales_person_name:'Original PIC',sales_person_id_at_creation:id(99),sales_assignment_source_id:id(100),sales_attributed_at:timestamp,sales_attribution_state:'assigned'};
   return {data:{version:'1',as_of:timestamp,customer_id:customer,customer_version:f.s.cv,report_month:uploadMonth,revision_id:a.p_revision_id,generation_id:null,is_effective:true,summary:{quantity:f.sourceFixture.quantity,amount:f.sourceFixture.amount},page:a.p_page,page_size:a.p_page_size,total:options.zeroSource?'0':'1',rows:!options.zeroSource&&a.p_page===1?[row]:[]},error:null};
  }
  if(n==='pilot_co_import_read_v1'&&binding&&(a.p_import_id!==binding.importId||a.p_expected_version!==binding.importVersion))return conflict('Original immutable import binding changed');
  if(n==='pilot_co_report_rows_v1'&&receipt&&(a.p_view!=='revision'||a.p_revision_id!==f.s.effective.revision_id||a.p_expected_customer_version!==f.s.cv))return conflict('Recorded rows binding changed');
  const result=await base(n,a);
  if(n==='pilot_co_import_prepare_v1'&&!result.error){binding=structuredClone(result.data);manifest=structuredClone(a.p_payload.manifest);}
  return result;
 };
 return {...f,commitState:state,get receipt(){return receipt},get requestId(){return requestId},get originalBinding(){return binding},newerCanonical(){if(!receipt)throw new Error('Commit required');f.s.cv='3';f.s.effective={...f.s.effective,customer_version:'3',report_version:'2',revision_id:id(101)};}};
}

// Shared interaction only; exercises the supported current route and real ports.
export async function openCommitReview(options:{zeroSource?:boolean}={}){
 const {fireEvent,screen,waitFor}=await import('@testing-library/react');
 const f=await productionCommitFixture(options),mounted=f.mountRoute();await f.choose();await f.confirmDecisions();
 fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'),{target:{value:'PRIVATE COMMIT REVIEW'}});
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
 const record=await screen.findByRole('button',{name:'Catat penjualan'});
 await waitFor(()=>{if(record.matches(':disabled'))throw new Error('Bound impacts still pending')});
 return {f,record,...mounted};
}
