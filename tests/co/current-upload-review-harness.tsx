import { customer, id, mount, reportImpact, store, wire } from './report-ui-harness';
/** Current upload UI/controller adapter. External prepare/preview/commit ports are
 * synthetic; actual COChangePreview and strict import-impact decoder remain real.
 * Not proof of production evidence uploads, transaction sender or server FIFO. */
import React, { useSyncExternalStore } from 'react';
import { beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { extractXlsx } from '../../src/lib/co/import/xlsx';
import { validateReview } from '../../src/lib/co/import/review';
import { createImportReviewController, type ImportReviewPorts } from '../../src/components/co/useCOImportReview';
import COReportUpload from '../../src/components/co/COReportUpload';
const adapter=vi.hoisted(()=>({controller:null as any}));
vi.mock('../../src/components/co/useCOImportReview',async original=>{
 const real=await original<any>();
 return {...real,useCOImportReview:(...args:any[])=>{
  if(!adapter.controller)return real.useCOImportReview(...args);
  const c=adapter.controller,state=useSyncExternalStore(c.subscribe,c.getSnapshot,c.getSnapshot);
  return {...c,state,dirty:!!state.file||!!state.input,unknown:state.phase==='unknown'};
 }};
});
beforeEach(()=>{adapter.controller=null});
afterEach(()=>{cleanup();adapter.controller?.dispose();adapter.controller=null});
export async function openCurrentUploadReview(){
 const month='2026-10-01',scope={actorId:id(1),customerId:customer,reportMonth:month,epoch:0};
 const s=store(1,month),base=s.handle,stockKey=id(1001);
 const bytes=readFileSync('tests/co/fixtures/accepted-monthly-20261029.xlsx');
 const extracted=await extractXlsx(new Uint8Array(bytes),'30f1236ea3c9a83314154423ea4e98146a1a579d790888d4c977a97352581b6a',new AbortController().signal);
 if(extracted.sourceRows.length!==1||extracted.warnings.some(w=>w.startsWith('manual_review:')))throw new Error('Accepted workbook fixture did not parse');
 const binding={importId:id(88),importVersion:'1',customerVersion:'1',draftId:id(3),draftVersion:'2',manifestDigest:'a'.repeat(64)},fingerprint='b'.repeat(64);
 const impacts={report:[{...reportImpact(month),after_sold_quantity:'1',after_revenue:'10000',coverage:'2026-10-29',is_partial_month:true}],stock:[],revenue:[],credit:[],reopen:[],issue:[],missing_month:[]};
 const counts=Object.fromEntries(Object.entries(impacts).map(([k,v])=>[k,String(v.length)]));
 const ports:ImportReviewPorts={isCurrent:()=>wire.actor,hasUnresolved:()=>false,
  extract:vi.fn(async()=>structuredClone(extracted)),
  loadContext:vi.fn(async()=>({scope,context:{customerVersion:'1'},selection:{},rows:[{...s.rows[0],eligible_quantity:'1'}],units:[{stockKeyId:stockKey,declaration:{unit:'test unit'}}]}) as any),
  prepare:vi.fn(async input=>{if(!validateReview(input,[{stockKeyId:stockKey,unit:'test unit',available:'1'}]).canConfirm)throw new Error('Source decisions incomplete');return binding}),
  preview:vi.fn(async()=>({binding,previewFingerprint:fingerprint,requiredReopenOrders:[],issues:[],existingPreview:{version:'1',as_of:'2026-10-29T00:00:00Z',operation:'post_report',customer_id:customer,customer_version:'1',draft_version:'2',preview_fingerprint:fingerprint,can_post:true,before:{sold_quantity:'0',revenue:'0',remaining_quantity:'1',complete:true},after:{sold_quantity:'1',revenue:'10000',remaining_quantity:'0',complete:true},counts}}) as any),
  commit:vi.fn(async()=>{throw new Error('This invalidation test must not commit')}),acceptReceipt:vi.fn(async()=>{}),recover:vi.fn(async()=>({status:'unknown'} as const)),declareUnit:vi.fn(async()=>{}),acknowledgeSupporting:vi.fn(async()=>{}),abandon:vi.fn(async()=>{}),
 };
 let delayed:Promise<void>|null=null;
 const delayedImpactRead=vi.fn();
 wire.handler=async(name:string,a:any)=>{
  if(name!=='pilot_co_import_impacts_v1')return base(name,a);
  if(delayed){delayedImpactRead(a);await delayed;}
  if(JSON.stringify(a.p_binding)!==JSON.stringify(binding)||a.p_preview_fingerprint!==fingerprint||a.p_acknowledged_reopen_orders.length) return {data:null,error:{code:'PT409',message:'Import impact binding changed'}};
  const rows=impacts[a.p_kind as keyof typeof impacts];if(!rows)throw new Error('Unknown impact kind');
  return {data:{version:'1',as_of:'2026-10-29T00:00:00Z',binding,preview_fingerprint:fingerprint,acknowledged_reopen_orders:[],kind:a.p_kind,page:a.p_page,page_size:a.p_page_size,total:String(rows.length),rows:rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size)},error:null};
 };
 const controller=createImportReviewController(scope,ports);adapter.controller=controller;
 const mounted=mount(<COReportUpload scope={scope} customerName="Synthetic accepted-source customer"/>);
 fireEvent.change(screen.getByLabelText('Pilih PDF atau XLSX'),{target:{files:[new File([bytes],'TEST_ONLY_MONTHLY_CO_20261029.xlsx')]}});
 await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
 fireEvent.click(screen.getByRole('button',{name:'Pilih SKU',exact:true}));
 fireEvent.change(screen.getByLabelText('SKU Padiwan'),{target:{value:stockKey}});
 fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'),{target:{value:'1'}});
 fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));
 fireEvent.change(screen.getByLabelText('Mata uang sumber'),{target:{value:'IDR'}});
 fireEvent.click(screen.getByLabelText(/Semua barang dan bagian sumber sudah diperiksa/));
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
 return {s,ports,controller,delayedImpactRead,...mounted,delayImpacts:(value:Promise<void>|null)=>{delayed=value}};
}
