import { expect,test } from 'vitest'
import { fixture } from '../evidence-ui-harness'
import { wire,id,customer,month,draftId } from '../report-ui-harness'
import { input } from './reviewFixture'
import { createImportReviewPorts } from '../../../src/components/co/useCOImportReview'
import type { ImportBinding,ImportManifest } from '../../../src/lib/co/import/types'
const scope={actorId:id(1),customerId:customer,reportMonth:month,epoch:1}
async function source(){const bytes=new TextEncoder().encode('%PDF-1.7\n%%EOF\n'),file=new File([bytes],'synthetic.pdf',{type:'application/pdf'});Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer});const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');const review=input({scope});review.extracted.sha256=sha;review.extracted.sourceRows[0].ref.fileSha256=sha;review.extracted.periodCandidates=[month];review.mappings[0].stockKeyId=id(1001);return {file,review}}
function setup(){const f=fixture(),base=wire.handler;let binding:ImportBinding|null=null,manifest:ImportManifest|null=null,reviewResult:any=null,preparations=0;const requests:any[]=[]
 wire.handler=async(n:string,a:any)=>{
  requests.push({n,a})
  if(n==='pilot_co_import_selection_v1')return {data:{version:'1',selectionId:reviewResult?.selectionId??binding?.importId??null,state:reviewResult?.state??(binding?'selected':null),importId:reviewResult?null:binding?.importId??null,draftId,draftVersion:f.s.version,customerVersion:f.s.cv,reportHeadId:null,originalRevisionId:null,reportVersion:null},error:null}
  if(n==='pilot_co_import_eligible_v1'){const r=await base('pilot_co_report_rows_v1',{p_page:a.p_page,p_page_size:a.p_page_size,p_view:'draft'});return {...r,data:{...r.data,selection_id:reviewResult?.selectionId??binding?.importId??null}}}
  if(n==='pilot_co_stock_key_units_v1')return {data:{customerVersion:f.s.cv,rows:[{customerId:customer,stockKeyId:id(1001),state:'declared',declaration:{id:id(70),version:'1',unit:'PCS',declaredBy:id(1),declaredAt:'2026-10-26T00:00:00Z',reason:'Confirmed warehouse unit'}}]},error:null}
  if(n==='pilot_co_import_review_v1'){f.s.version=String(BigInt(f.s.version)+1n);f.s.metadata.context_issue=null;reviewResult={version:'1',selectionId:id(90),state:'review_open',draftId,draftVersion:f.s.version,customerVersion:f.s.cv};return {data:reviewResult,error:null}}
  if(n==='pilot_co_import_review_reconcile_v1')return {data:{status:'committed',operation:'review_import',review:reviewResult},error:null}
  if(n==='pilot_co_import_prepare_v1'){preparations++;reviewResult=null;manifest=a.p_payload.manifest;f.s.version=String(BigInt(f.s.version)+1n);binding={importId:id(79+preparations),importVersion:'1' as any,customerVersion:f.s.cv,draftId,draftVersion:f.s.version,manifestDigest:manifest!.digest};return {data:binding,error:null}}
  if(n==='pilot_reconcile_co_import_prepare_v1')return {data:{status:'committed',operation:'prepare_import',binding},error:null}
  if(n==='pilot_co_import_read_v1')return {data:{manifest,binding},error:null}
  return base(n,a)
 }
 return {f,requests,ports:createImportReviewPorts(scope,'co_admin',()=>true,()=>{})}
}
test('production ports register original, upload, finalize, then prepare at exact D+1 and adopt D+2',async()=>{
 const {ports,requests,f}=setup(),{file,review}=await source()
 const b=await ports.prepare(review,file,{isCurrent:()=>true})
 expect(f.commands.map((v:any)=>v.p_operation)).toEqual(['register_evidence','finalize_evidence'])
 expect(f.commands[0].p_payload.expected_draft_version).toBe('1');expect(f.commands[1].p_payload.expected_draft_version).toBe('1')
 const p=requests.find(r=>r.n==='pilot_co_import_prepare_v1')!.a.p_payload
 expect(p.expected_draft_version).toBe('2');expect(b.draftVersion).toBe('3');expect(p.manifest.evidenceId).toBe(f.e.id)
 expect(wire.invoke).toHaveBeenCalledWith('co-evidence-upload',expect.objectContaining({headers:expect.objectContaining({'x-evidence-id':f.e.id})}))
 expect(ports.hasUnresolved()).toBe(false);expect(localStorage.length).toBe(0)
})
test('scope cancellation while upload is pending prevents finalize and prepare; no byte persistence',async()=>{
 const {ports,requests,f}=setup(),{file,review}=await source();let finish!:()=>void,live=true
 const gate=new Promise<void>(r=>{finish=r}),base=wire.invoke.getMockImplementation()!
 wire.invoke.mockImplementation(async(...args:any[])=>{await gate;return base(...args)})
 const run=ports.prepare(review,file,{isCurrent:()=>live})
 while(!wire.invoke.mock.calls.length)await new Promise(r=>setTimeout(r,1))
 live=false;finish();await expect(run).rejects.toThrow()
 expect(f.commands.map((v:any)=>v.p_operation)).toEqual(['register_evidence']);expect(requests.some(r=>r.n==='pilot_co_import_prepare_v1')).toBe(false);expect(localStorage.length).toBe(0)
})
test('stale unselected private draft is refreshed internally without discarding mounted review',async()=>{
 const {ports,requests,f}=setup(),{file,review}=await source();f.s.metadata.context_issue='CO_ELIGIBLE_SET_STALE'
 const base=wire.handler;wire.handler=async(n:string,a:any)=>{const r=await base(n,a);if(n==='pilot_co_transaction_v1'&&a.p_payload.action==='initialize')f.s.metadata.context_issue=null;return r}
 const b=await ports.prepare(review,file,{isCurrent:()=>true})
 expect(requests.filter(r=>r.n==='pilot_co_transaction_v1').map(r=>r.a.p_payload.action)).toEqual(['initialize'])
 expect(b.draftVersion).toBe('4');expect(review.mappings[0].quantity).toBe('2')
})

test('same-file re-review uses open plus fresh registration/upload/finalize at the new draft version',async()=>{
 const {ports,requests,f}=setup(),{file,review}=await source()
 const first=await ports.prepare(review,file,{isCurrent:()=>true});review.reason='Correct original quantity'
 const second=await ports.prepare(review,file,{isCurrent:()=>true})
 expect(first.importId).not.toBe(second.importId);expect(second.draftVersion).toBe('6')
 expect(f.commands.map((v:any)=>[v.p_operation,v.p_payload.expected_draft_version])).toEqual([['register_evidence','1'],['finalize_evidence','1'],['register_evidence','4'],['finalize_evidence','4']])
 expect(wire.invoke.mock.calls.filter(c=>c[0]==='co-evidence-upload')).toHaveLength(2)
 const prepares=requests.filter(r=>r.n==='pilot_co_import_prepare_v1');expect(prepares[1].a.p_payload.expected_selection_id).toBe(id(90))
})
test('unit/customer changes in an already open review require a fresh versioned open before evidence',async()=>{
 const {ports,requests,f}=setup(),{file,review}=await source();await ports.prepare(review,file,{isCurrent:()=>true})
 await wire.handler('pilot_co_import_review_v1',{});f.s.metadata.context_issue='CO_ELIGIBLE_SET_STALE';review.reason='Recheck changed stock'
 await ports.prepare(review,file,{isCurrent:()=>true})
 const opens=requests.filter(r=>r.n==='pilot_co_import_review_v1');expect(opens).toHaveLength(2);expect(opens[1].a.p_payload.expected_selection_id).toBe(id(90))
})
async function uncertainSupporting(family:'prepare'|'review'|'unit'|'evidence'){
 const set=setup(),{file,review}=await source(),base=wire.handler
 const {createImportCommands}=await import('../../../src/lib/co/import/rpc')
 const commands=createImportCommands({scope,role:'co_admin',storage:()=>localStorage,isCurrent:()=>true})
 let unitReceipt:any=null
 const server=async(n:string,a:any)=>{
  if(n==='pilot_co_declare_stock_key_unit_v1'){set.f.s.cv='2';unitReceipt={id:id(70),operation:'declare_stock_key_unit',version:'1',customer_id:customer,customer_version:'2'};return {data:unitReceipt,error:null}}
  if(n==='pilot_reconcile_co_unit_v1')return {data:{status:'committed',operation:'declare_stock_key_unit',receipt:unitReceipt},error:null}
  return base(n,a)
 }
 const name=family==='prepare'?'pilot_co_import_prepare_v1':family==='review'?'pilot_co_import_review_v1':family==='unit'?'pilot_co_declare_stock_key_unit_v1':'pilot_co_evidence_transaction_v1'
 wire.handler=async(n:string,a:any)=>{const r=await server(n,a);return n===name?{data:null,error:{message:'lost supporting response'}}:r}
 if(family==='prepare'||family==='evidence')await expect(set.ports.prepare(review,file,{isCurrent:()=>true})).rejects.toThrow('lost supporting response')
 if(family==='review')await expect(commands.review({draft_id:draftId,expected_draft_version:'1',expected_customer_version:'1',expected_selection_id:null,original_revision_id:null,expected_report_version:null,action:'open',reason:'Recheck source'})).rejects.toThrow('lost supporting response')
 if(family==='unit')await expect(commands.declareUnit({customer_id:customer,stock_key_id:id(1001),expected_customer_version:'1' as any,expected_unit_version:null,unit:'PCS',reason:'Checked unit',confirmed:true})).rejects.toThrow('lost supporting response')
 wire.handler=server
 if(family==='unit')set.f.s.cv='3';else set.f.s.version=String(BigInt(set.f.s.version)+1n)
 return {...set,server}
}
test.each(['prepare','review','unit','evidence'] as const)('advanced %s terminal result stays original until explicit acknowledgment and fresh context read',async family=>{
 const {ports,requests}=await uncertainSupporting(family),{ImportSupportingResultChanged}=await import('../../../src/components/co/useCOImportReview')
 let conflict:any;try{await ports.recover({isCurrent:()=>true})}catch(e){conflict=e}
 expect(conflict).toBeInstanceOf(ImportSupportingResultChanged);expect(conflict.terminal.family).toBe(family);expect(ports.hasUnresolved()).toBe(true)
 const writes=()=>requests.filter(r=>['pilot_co_import_prepare_v1','pilot_co_import_review_v1','pilot_co_evidence_transaction_v1','pilot_co_declare_stock_key_unit_v1'].includes(r.n)).length
 const before=writes();await ports.acknowledgeSupporting(conflict.terminal,{isCurrent:()=>true})
 expect(ports.hasUnresolved()).toBe(false);expect(writes()).toBe(before);expect(requests.at(-1)!.n).toBe('pilot_co_report_v1')
})
test.each(['prepare','review','unit','evidence'] as const)('unknown %s result cannot be acknowledged or discarded as terminal',async family=>{
 const {ports,server}=await uncertainSupporting(family),{ImportSupportingResultChanged}=await import('../../../src/components/co/useCOImportReview')
 wire.handler=async(n:string,a:any)=>n.includes('reconcile')?{data:{status:'unknown'},error:null}:server(n,a)
 let failure:any;try{await ports.recover({isCurrent:()=>true})}catch(e){failure=e}
 expect(failure).not.toBeInstanceOf(ImportSupportingResultChanged);expect(ports.hasUnresolved()).toBe(true)
 await expect(ports.acknowledgeSupporting({family,result:{},identity:{}} as any,{isCurrent:()=>true})).rejects.toThrow();expect(ports.hasUnresolved()).toBe(true)
})
test('table receives one authoritative versioned eligibility/unit snapshot before review without evidence upload',async()=>{
 const {ports,f}=setup();expect(ports).toHaveProperty('loadContext')
 const snapshot=await (ports as any).loadContext(null,{isCurrent:()=>true})
 expect(snapshot.scope).toEqual(scope);expect(snapshot.context.draftVersion).toBe('1');expect(snapshot.rows[0].stock_key_id).toBe(id(1001));expect(snapshot.units[0].declaration.unit).toBe('PCS')
 expect(f.commands).toHaveLength(0);expect(wire.invoke).not.toHaveBeenCalled()
})
test.each(['prepare','review','unit','evidence'] as const)('corrupt %s recovery never exposes a terminal acknowledgment capability',async family=>{
 const {ports,server}=await uncertainSupporting(family),{ImportSupportingResultChanged}=await import('../../../src/components/co/useCOImportReview')
 wire.handler=async(n:string,a:any)=>{const r=await server(n,a);if(n.includes('reconcile')){const broken=structuredClone(r);if(family==='prepare')broken.data.binding.manifestDigest='f'.repeat(64);else if(family==='review')broken.data.review.draftId=id(999);else broken.data.receipt.customer_id=id(999);return broken}return r}
 let failure:any;try{await ports.recover({isCurrent:()=>true})}catch(e){failure=e}
 expect(failure).not.toBeInstanceOf(ImportSupportingResultChanged);expect(failure).toBeTruthy();expect(ports.hasUnresolved()).toBe(true)
 await expect(ports.acknowledgeSupporting({family,result:{},identity:{}} as any,{isCurrent:()=>true})).rejects.toThrow();expect(ports.hasUnresolved()).toBe(true)
})
test('unknown unit remains visible in the table snapshot and is never silently declared',async()=>{
 const {ports,requests}=setup(),base=wire.handler
 wire.handler=async(n:string,a:any)=>n==='pilot_co_stock_key_units_v1'?{data:{customerVersion:'1',rows:[{customerId:customer,stockKeyId:id(1001),state:'unknown',declaration:null}]},error:null}:base(n,a)
 const snapshot=await ports.loadContext(null,{isCurrent:()=>true});expect(snapshot.units[0]).toMatchObject({state:'unknown',declaration:null});expect(Object.isFrozen(snapshot.rows)).toBe(true)
 expect(requests.some(r=>r.n==='pilot_co_declare_stock_key_unit_v1')).toBe(false)
})
test('reading a current selected mapping snapshot does not silently open a replacement review',async()=>{
 const {ports,requests}=setup(),{file,review}=await source();await ports.prepare(review,file,{isCurrent:()=>true})
 const snapshot=await ports.loadContext(null,{isCurrent:()=>true});expect(snapshot.selection.state).toBe('selected');expect(requests.filter(r=>r.n==='pilot_co_import_review_v1')).toHaveLength(0)
})

async function manualWorkbookSource(){
 const {zip,parts,row,str,num}=await import('./fixtures/xlsx-layout');const {extractXlsx}=await import('../../../src/lib/co/import/xlsx');const {buildManualTranscription}=await import('../../../src/lib/co/import/manual');
 const bytes=zip(parts(row(4,str('A4','Other layout')+num('B4','2'))+row(10,num('B10','64700')),''));
 const file=new File([bytes],'synthetic.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer});
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const original=await extractXlsx(bytes,sha,new AbortController().signal),review=input({scope});const r=review.extracted.sourceRows[0];r.ref={fileSha256:sha,page:null,sheet:'Sheet',row:'r4',section:'s1'};r.quantity={raw:'2',decimal:'2',convention:'decimal_dot'};r.unitPrice={raw:'32350',decimal:'32350',convention:'decimal_dot'};r.discount=null;r.discountBasis=null;r.amount={raw:'64700',decimal:'64700',convention:'decimal_dot'};
 review.extracted=buildManualTranscription(original,{sourceRows:[r],sections:review.extracted.sections,periodCandidates:[month],customerCandidates:[],reason:'Human checked all sheets',confirmed:true,manualPrintedControls:{version:2,confirmed:true,reviewedSheets:['Sheet'],controls:[{ref:{...r.ref,row:'r10'},rowIds:[r.id],count:null,quantity:null,returned:null,amount:r.amount}]}});review.mappings[0].stockKeyId=id(1001);return {file,review};
}
test('manual XLSX retries byte receipt before finalize even when base object verification already succeeded',async()=>{
 const {ports,requests,f}=setup(),{file,review}=await manualWorkbookSource(),base=wire.handler,invoke=wire.invoke.getMockImplementation()!;let uploadFailed=false;
 wire.handler=async(n:string,a:any)=>{const result=await base(n,a);if(n==='pilot_co_evidence_transaction_v1'&&a.p_operation==='register_evidence'){f.e.mime_type=file.type;f.e.filename=`evidence-${f.e.id}.xlsx`;if(uploadFailed)f.e.state='verified'}return result};
 wire.invoke.mockImplementation(async(...args:any[])=>{const r=await invoke(...args);if(!uploadFailed){uploadFailed=true;return {data:null,error:{message:'Manual receipt temporarily unavailable'}}}return r});
 await expect(ports.prepare(review,file,{isCurrent:()=>true})).rejects.toThrow();expect(requests.some(r=>r.n==='pilot_co_import_prepare_v1')).toBe(false);expect(f.commands.map((v:any)=>v.p_operation)).toEqual(['register_evidence']);
 const b=await ports.prepare(review,file,{isCurrent:()=>true});expect(wire.invoke.mock.calls.filter(c=>c[0]==='co-evidence-upload')).toHaveLength(2);
 const manifest=requests.find(r=>r.n==='pilot_co_import_prepare_v1')!.a.p_payload.manifest;expect(manifest.input.extracted.manualTranscription.version).toBe(2);expect(manifest.input.extracted.manualPrintedControls.controls[0].count).toBeNull();expect(b.draftVersion).toBe('3');
 const server=wire.handler;wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_preview_v1'){const normal=await server('pilot_co_preview_v1',{p_operation:'post_report',p_payload:{expected_draft_version:b.draftVersion}});return {data:{binding:b,previewFingerprint:'c'.repeat(64),issues:[],existingPreview:normal.data},error:null}}return server(n,a)};
 expect((await ports.preview(b,{isCurrent:()=>true},[])).binding).toEqual(b);
});
