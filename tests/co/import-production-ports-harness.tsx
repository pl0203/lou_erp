/** Transport-only fixture: production import ports, controller, senders and decoders are NOT mocked. */
import { customer, draftId, id, mount, reportImpact, store, wire } from './report-ui-harness';
import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent, screen } from '@testing-library/react';
import { extractXlsx } from '../../src/lib/co/import/xlsx';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
const worker=vi.hoisted(()=>({extract:vi.fn()}));
vi.mock('../../src/lib/co/import/workerClient',()=>({extractReport:worker.extract}));
export const uploadMonth='2026-10-01', sourceSha='30f1236ea3c9a83314154423ea4e98146a1a579d790888d4c977a97352581b6a';
const evidenceId=id(45),importId=id(88),selectionId=id(89),fp='b'.repeat(64);
export async function productionImportFixture(options:{zeroSource?:boolean}={}){
 const sourceFixture=options.zeroSource?{sha:'4102366d82624684712f82611c8762b64d9a83b048517cbae9dc25118023f803',quantity:'0',amount:'0',filename:'TEST_ONLY_MONTHLY_ZERO_20261030.xlsx'}:{sha:sourceSha,quantity:'1',amount:'10000',filename:'TEST_ONLY_MONTHLY_CO_20261029.xlsx'};
 const bytes=readFileSync(options.zeroSource?'tests/co/fixtures/synthetic-monthly-zero-20261030.xlsx':'tests/co/fixtures/accepted-monthly-20261029.xlsx');
 const extracted=await extractXlsx(new Uint8Array(bytes),sourceFixture.sha,new AbortController().signal);
 if(extracted.sourceRows.length!==1)throw new Error('Accepted fixture not parsed');
 worker.extract.mockReset().mockResolvedValue(extracted);
 const s=store(1,uploadMonth),base=s.handle;s.draft=false;s.rows[0].eligible_quantity='1';
 let evidence:any=null,evidenceReceipt:any=null,binding:any=null,manifest:any=null;
 const writes:{name:string;args:any}[]=[];
 const state={s,writes,corruptSelection:false,corruptEligible:false,corruptPreview:false,incomplete:true,prepareCount:0,previewCount:0};
 const selected=()=>({version:'1',selectionId:binding?selectionId:null,state:binding?'selected':null,importId:binding?importId:null,draftId,draftVersion:s.version,customerVersion:s.cv,reportHeadId:null,originalRevisionId:null,reportVersion:null});
 const impacts=()=>({report:[{...reportImpact(uploadMonth),after_sold_quantity:sourceFixture.quantity,after_revenue:sourceFixture.amount,coverage:'2026-10-29',is_partial_month:true,complete:!state.incomplete}],stock:[],revenue:[],credit:[],reopen:[],issue:state.incomplete?[{code:'CO_REPORT_INCOMPLETE',report_month:uploadMonth,stock_key_id:id(1001)}]:[],missing_month:[]});
 wire.handler=async(name:string,a:any)=>{
  if(name==='pilot_co_transaction_v1'){
   writes.push({name,args:structuredClone(a)});
   if(a.p_payload.expected_customer_version!==s.cv)return {data:null,error:{code:'PT409',message:'Customer version changed'}};
  }
  if(name==='pilot_co_import_selection_v1')return {data:{...selected(),...(state.corruptSelection?{draftId:id(999)}:{})},error:null};
  if(name==='pilot_co_import_eligible_v1'){
   if(a.p_draft_id!==draftId||a.p_expected_draft_version!==s.version||a.p_expected_customer_version!==s.cv||a.p_expected_selection_id!==selected().selectionId)return {data:null,error:{code:'PT409',message:'Eligible binding changed'}};
   const response=await base('pilot_co_report_rows_v1',{...a,p_view:'draft',p_page:a.p_page,p_page_size:a.p_page_size});
   return {data:{...response.data,selection_id:selected().selectionId,...(state.corruptEligible?{customer_version:'999'}:{})},error:null};
  }
  if(name==='pilot_co_stock_key_units_v1')return {data:{customerVersion:s.cv,rows:a.p_stock_key_ids.map((key:string)=>({customerId:customer,stockKeyId:key,state:'declared',declaration:{id:id(77),version:'1',unit:'test unit',declaredBy:id(1),declaredAt:'2026-10-29T00:00:00Z',reason:'Synthetic accepted fixture unit'}}))},error:null};
  if(name==='pilot_co_evidence_transaction_v1'){
   writes.push({name,args:structuredClone(a)});const p=a.p_payload;
   if(p.expected_customer_version!==s.cv||p.expected_draft_version!==s.version)return {data:null,error:{code:'PT409',message:'Evidence version changed'}};
   if(a.p_operation==='register_evidence')evidence={id:evidenceId,version:'1',customer_id:customer,customer_version:s.cv,draft_id:draftId,draft_version:s.version,report_month:uploadMonth,filename:`evidence-${evidenceId}.xlsx`,mime_type:p.mime_type,byte_size:p.byte_size,state:'pending',finalized_draft_version:null};
   else {evidence={...evidence,version:'2',state:'finalized',finalized_draft_version:String(BigInt(s.version)+1n)};s.version=evidence.finalized_draft_version;}
   evidenceReceipt={id:evidenceId,operation:a.p_operation,version:evidence.version,customer_id:customer,customer_version:s.cv};return {data:evidenceReceipt,error:null};
  }
  if(name==='pilot_reconcile_co_evidence_v1')return {data:{status:'committed',operation:evidenceReceipt.operation,receipt:evidenceReceipt},error:null};
  if(name==='pilot_co_evidence_v1')return {data:evidence,error:null};
  if(name==='pilot_co_evidence_selection_v1')return {data:{version:'1',customer_id:customer,draft_id:a.p_draft_id,draft_version:a.p_expected_draft_version,revision_id:a.p_revision_id,evidence:evidence?.state==='finalized'?evidence:null},error:null};
  if(name==='pilot_co_import_prepare_v1'){
   writes.push({name,args:structuredClone(a)});state.prepareCount++;const p=a.p_payload;
   if(p.expected_customer_version!==s.cv||p.expected_draft_version!==s.version||p.expected_evidence_version!=='2'||p.manifest.evidenceId!==evidenceId)return {data:null,error:{code:'PT409',message:'Prepare binding changed'}};
   manifest=structuredClone(p.manifest);s.version=String(BigInt(s.version)+1n);
   binding={importId,importVersion:'1',customerVersion:s.cv,draftId,draftVersion:s.version,manifestDigest:manifest.digest};return {data:binding,error:null};
  }
  if(name==='pilot_reconcile_co_import_prepare_v1')return {data:{status:'committed',operation:'prepare_import',binding},error:null};
  if(name==='pilot_co_import_read_v1')return {data:{manifest,binding},error:null};
  if(name==='pilot_co_import_preview_v1'){
   state.previewCount++;const rows=impacts(),counts=Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,String(v.length)]));
   if(a.p_import_id!==binding.importId||a.p_expected_version!==binding.importVersion)return {data:null,error:{code:'PT409',message:'Preview binding changed'}};
   return {data:{binding:state.corruptPreview?{...binding,importId:id(999)}:binding,previewFingerprint:fp,requiredReopenOrders:[],issues:state.incomplete?[{code:'CO_REPORT_INCOMPLETE',rowId:null,message:'CO_REPORT_INCOMPLETE',blocking:true}]:[],existingPreview:{version:'1',as_of:'2026-10-29T00:00:00Z',operation:'post_report',customer_id:customer,customer_version:s.cv,draft_version:s.version,preview_fingerprint:fp,source_context_fingerprint:'c'.repeat(64),can_post:!state.incomplete,before:{sold_quantity:'0',revenue:'0',remaining_quantity:'1',complete:true},after:{sold_quantity:sourceFixture.quantity,revenue:sourceFixture.amount,remaining_quantity:options.zeroSource?'1':'0',complete:!state.incomplete},counts}},error:null};
  }
  if(name==='pilot_co_import_impacts_v1'){
   if(JSON.stringify(a.p_binding)!==JSON.stringify(binding)||a.p_preview_fingerprint!==fp||a.p_acknowledged_reopen_orders.length)return {data:null,error:{code:'PT409',message:'Impact binding changed'}};
   const rows=impacts()[a.p_kind as keyof ReturnType<typeof impacts>];if(!rows)throw new Error('Unexpected impact kind');
   return {data:{version:'1',as_of:'2026-10-29T00:00:00Z',binding,preview_fingerprint:fp,acknowledged_reopen_orders:[],kind:a.p_kind,page:a.p_page,page_size:a.p_page_size,total:String(rows.length),rows:rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size)},error:null};
  }
  if(name==='pilot_co_import_commit_v1'){writes.push({name,args:a});throw new Error('Incomplete report must never commit')}
  return base(name,a);
 };
 wire.invoke.mockReset().mockImplementation(async name=>{if(name!=='co-evidence-upload')throw new Error(`Unexpected Edge operation ${name}`);evidence={...evidence,state:'verified'};return {data:{id:evidenceId,state:'verified'},error:null}});
 function mountRoute(strict=false){return mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${uploadMonth}`,strict)}
 async function choose(){const file=new File([bytes],sourceFixture.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});fireEvent.change(await screen.findByLabelText('Pilih PDF atau XLSX'),{target:{files:[file]}});}
 async function confirmDecisions(){await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');fireEvent.click(screen.getByRole('button',{name:'Pilih SKU',exact:true}));fireEvent.change(screen.getByLabelText('SKU Padiwan'),{target:{value:id(1001)}});fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'),{target:{value:sourceFixture.quantity}});fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));fireEvent.change(screen.getByLabelText('Mata uang sumber'),{target:{value:'IDR'}});fireEvent.click(screen.getByLabelText(/Semua barang dan bagian sumber sudah diperiksa/));}
 return {...state,sourceFixture,get state(){return state},mountRoute,choose,confirmDecisions};
}
