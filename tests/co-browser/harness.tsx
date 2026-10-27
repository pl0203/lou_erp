import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import COImportReviewTable from '../../src/components/co/COImportReviewTable';
import { extractReport } from '../../src/lib/co/import/workerClient';
import type { ReviewInput, ReviewValidation } from '../../src/lib/co/import/types';
import './harness.css';
declare const __WORKBOOKS__: Record<string,number[]>;
const scope={actorId:'synthetic-actor',customerId:'synthetic-store',reportMonth:'2026-08-01',epoch:1};
const rows=Array.from({length:100},(_,i)=>({id:`r${i}`,ref:{fileSha256:'a'.repeat(64),page:1,sheet:null,row:`r${i+7}`,section:'s'},sourceSku:`SYNTHETIC-${String(i).padStart(3,'0')}`,name:'Synthetic long product name for native responsive review table',transactionDate:null,transactionReference:null,quantity:{raw:'8',decimal:'8'},returned:{raw:'2',decimal:'2'},unit:'PCS',unitPrice:{raw:'12.500',decimal:'12500'},discount:null,discountBasis:null,netUnitPrice:null,amount:{raw:'100.000',decimal:'100000'},currency:'IDR',priceBasisLabel:null,flags:[]}));
const initial:ReviewInput={scope,extracted:{sha256:'a'.repeat(64),format:'pdf',parserVersion:'synthetic',sourceRows:rows,sections:[{id:'s',label:'Synthetic section',rowIds:rows.map(r=>r.id),printedTotal:null}],periodCandidates:[],customerCandidates:[],warnings:[]},mappings:[],returns:[],includedSectionIds:['s'],completenessConfirmed:false,omittedZeroStockKeyIds:[],currency:null,reason:null};
const validation:ReviewValidation={issues:[{code:'mapping_required',rowId:'r0',message:'Map synthetic first row',blocking:true}],quantities:[],totalsByUnit:{},sourceAmount:null,canConfirm:false};
function Host(){const [input,setInput]=useState(initial);return <main><h1>Synthetic CO source review</h1><output id="intent">{JSON.stringify({complete:input.completenessConfirmed,sections:input.includedSectionIds})}</output><COImportReviewTable input={input} validation={validation} onChange={setInput}/></main>}
createRoot(document.getElementById('root')!).render(<StrictMode><Host/></StrictMode>);
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message)};
Object.assign(window,{runNativeWorkerCases:async()=>{
 const completed:string[]=[];
 for(const name of ['stored','deflated','crc']){
  const bytes=new Uint8Array(__WORKBOOKS__[name]);
  const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const result=await extractReport(new File([bytes],`synthetic-${name}.xlsx`),scope,new AbortController().signal);
  assert(result.sha256===expected,'Original-byte hash must round-trip through native worker');
  if(name==='crc'){assert(result.sourceRows.length===0&&result.warnings.some(w=>w.startsWith('manual_review:')),'Corrupt workbook must not yield sales');}
  else {assert(result.sourceRows.length===1,'Native worker must parse one synthetic row');const row=result.sourceRows[0];assert(row.quantity.decimal==='2'&&row.returned?.decimal==='1','Sales and returns remain separate');assert(row.unitPrice?.decimal==='9007199254740993.125','Exact price must survive native worker');assert(row.amount?.decimal==='18014398509481986.250','Exact source total must survive native worker');}
  completed.push(name);
 }
 const abort=new AbortController();const pending=extractReport(new File([new Uint8Array(__WORKBOOKS__.deflated)],'synthetic-cancel.xlsx'),scope,abort.signal);abort.abort();
 let cancelled=false;try{await pending}catch(error){cancelled=error instanceof DOMException&&error.name==='AbortError'}assert(cancelled,'Cancellation must reject rather than apply results');
 const next=await extractReport(new File([new Uint8Array(__WORKBOOKS__.stored)],'synthetic-next.xlsx'),{...scope,epoch:2},new AbortController().signal);assert(next.sourceRows.length===1,'New scope must work after cancellation');
 return [...completed,'cancel-and-new-scope'];
}});
