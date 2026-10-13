import {expect,test,vi,beforeEach} from 'vitest';
import {FunctionsClient} from '@supabase/functions-js';
import {createEvidenceSender,parseEvidenceReceipt,parseEvidenceRecord,fetchEvidenceSelection,uploadEvidence} from '../../src/lib/co/evidence';
import {parseCOReceipt} from '../../src/lib/co/validation';
const mock=vi.hoisted(()=>({rpc:vi.fn(),functions:null as FunctionsClient|null}));vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mock.rpc,get functions(){return mock.functions;}}}));
const actor='00000000-0000-0000-0000-000000000001',customer='00000000-0000-0000-0000-000000000002',draft='00000000-0000-0000-0000-000000000003',evidence='00000000-0000-0000-0000-000000000004';
const receipt={id:evidence,operation:'register_evidence',version:'1',customer_id:customer,customer_version:'1'};
const payload={draft_id:draft,expected_draft_version:'1',expected_customer_version:'1',filename:'original.pdf',mime_type:'application/pdf',byte_size:12,sha256:'a'.repeat(64)};
const create=()=>createEvidenceSender({actorId:actor,role:'co_admin',customerId:customer,scope:'report',storage:()=>localStorage,authorize:async()=>{}});
beforeEach(()=>{localStorage.clear();mock.rpc.mockReset();});
test('supporting and business receipts have mutually exclusive strict decoders',()=>{expect(parseEvidenceReceipt(receipt)).toEqual(receipt);expect(()=>parseCOReceipt(receipt)).toThrow();expect(()=>parseEvidenceReceipt({...receipt,operation:'post_report'})).toThrow();expect(()=>parseEvidenceReceipt({...receipt,path:'private'})).toThrow();});
test('lost register reconciles the same actor/request and persists only identity plus minimal receipt',async()=>{
 const sender=create();mock.rpc.mockResolvedValueOnce({data:null,error:{message:'lost'}}).mockResolvedValue({data:{status:'committed',operation:'register_evidence',receipt},error:null});await expect(sender('register_evidence',payload)).rejects.toThrow('lost');const key=localStorage.key(0)!;const pending=JSON.parse(localStorage.getItem(key)!);expect(pending.binding).toEqual({operation:'register_evidence',customer_id:customer,draft_id:draft});for(const secret of ['original.pdf','application/pdf','byte_size',payload.sha256])expect(localStorage.getItem(key)).not.toContain(secret);
 expect(await sender.reconcile()).toEqual({status:'committed',operation:'register_evidence',receipt});expect(sender.hasUnresolved()).toBe(true);await sender.acknowledgeRecovered();expect(sender.hasUnresolved()).toBe(false);expect(mock.rpc.mock.calls.filter(([n])=>n==='pilot_co_evidence_transaction_v1')).toHaveLength(1);expect(mock.rpc.mock.calls.filter(([n])=>n==='pilot_reconcile_co_evidence_v1').every(([,a])=>a.p_request_id===pending.id)).toBe(true);
});
test('wrong-family recovery, changed receipt and missing authority retain unresolved identity',async()=>{
 const sender=create();mock.rpc.mockResolvedValueOnce({data:null,error:{message:'lost'}}).mockResolvedValue({data:{status:'committed',operation:'post_report',receipt:{...receipt,operation:'post_report'}},error:null});await expect(sender('register_evidence',payload)).rejects.toThrow();await expect(sender.reconcile()).rejects.toThrow();expect(sender.hasUnresolved()).toBe(true);
});
test('sidecar requires exact draft version and refuses exposed storage data',async()=>{mock.rpc.mockResolvedValue({data:{version:'1',customer_id:customer,draft_id:draft,draft_version:'2',revision_id:null,evidence:null},error:null});await expect(fetchEvidenceSelection({customerId:customer,draftId:draft,draftVersion:'1'})).rejects.toThrow();expect(()=>parseEvidenceRecord({id:evidence,path:'leak'})).toThrow();});
test('file selection refuses oversize, empty, unsupported, extension mismatch and control filenames before reads',async()=>{
 const {prepareEvidenceFile}=await import('../../src/lib/co/evidence');
 for(const [name,type,size] of [['a.pdf','application/pdf',10485761],['a.pdf','application/pdf',0],['a.svg','image/svg+xml',5],['a.png','application/pdf',5],['a\r.pdf','application/pdf',5],['../a.pdf','application/pdf',5]]){
 const file={name,type,size,arrayBuffer:vi.fn()} as unknown as File;await expect(prepareEvidenceFile(file,()=>true)).rejects.toThrow();expect(file.arrayBuffer).not.toHaveBeenCalled();
 }
});
test('late file bytes and changed recovery receipt cannot pass identity and acknowledgement guards',async()=>{
 const {prepareEvidenceFile}=await import('../../src/lib/co/evidence');let live=true;const file={name:'a.pdf',type:'application/pdf',size:3,arrayBuffer:async()=>{live=false;return new Uint8Array(3).buffer;}} as File;await expect(prepareEvidenceFile(file,()=>live)).rejects.toThrow();
 const sender=create();mock.rpc.mockResolvedValueOnce({data:null,error:{message:'lost'}}).mockResolvedValue({data:{status:'committed',operation:'register_evidence',receipt},error:null});await expect(sender('register_evidence',payload)).rejects.toThrow();await sender.reconcile();mock.rpc.mockResolvedValue({data:{status:'committed',operation:'register_evidence',receipt:{...receipt,id:actor}},error:null});await expect(sender.acknowledgeRecovered()).rejects.toThrow();expect(sender.hasUnresolved()).toBe(true);
});
test.each(['id','operation','version','customer_id','customer_version'] as const)('evidence retained %s stays pinned through same-key validation failure',async(field)=>{
 const sender=create();mock.rpc.mockResolvedValueOnce({data:null,error:{message:'lost'}}).mockResolvedValue({data:{status:'committed',operation:'register_evidence',receipt},error:null});await expect(sender('register_evidence',payload)).rejects.toThrow();await sender.reconcile();const key=localStorage.key(0)!,before=JSON.parse(localStorage.getItem(key)!);
 const changed={...receipt,[field]:field==='operation'?'finalize_evidence':field==='version'||field==='customer_version'?'99':actor};mock.rpc.mockResolvedValue({data:{status:'committed',operation:changed.operation,receipt:changed},error:null});await expect(sender('register_evidence',payload)).rejects.toThrow();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(before);await expect(sender.acknowledgeRecovered()).rejects.toThrow();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(before);mock.rpc.mockResolvedValue({data:{status:'committed',operation:'register_evidence',receipt},error:null});await sender.acknowledgeRecovered();expect(sender.hasUnresolved()).toBe(false);
});
test('a selected attachment cannot claim finalization after its pinned draft version',async()=>{
 const e={id:evidence,version:'2',customer_id:customer,customer_version:'1',draft_id:draft,draft_version:'2',report_month:'2026-09-01',filename:`evidence-${evidence}.pdf`,mime_type:'application/pdf',byte_size:12,state:'finalized',finalized_draft_version:'3'};
 mock.rpc.mockResolvedValue({data:{version:'1',customer_id:customer,draft_id:draft,draft_version:'2',revision_id:null,evidence:e},error:null});await expect(fetchEvidenceSelection({customerId:customer,draftId:draft,draftVersion:'2'})).rejects.toThrow();
});

test('installed FunctionsClient sends the exact upload bytes, including bounded subarray views',async()=>{
 const expected=new TextEncoder().encode('%PDF-1.7\n%%EOF\n');
 const backing=new Uint8Array(expected.length+4);backing.fill(99);backing.set(expected,2);
 const received:Uint8Array[]=[];
 mock.functions=new FunctionsClient('https://synthetic.invalid/functions/v1',{customFetch:async(url,options)=>{
  const request=new Request(url,options);received.push(new Uint8Array(await request.arrayBuffer()));
  expect(request.headers.get('content-type')).toBe('application/octet-stream');expect(request.headers.get('x-evidence-id')).toBe(evidence);
  return new Response(JSON.stringify({id:evidence,state:'verified'}),{headers:{'Content-Type':'application/json'}});
 }});
 await uploadEvidence(evidence,backing.subarray(2,2+expected.length),()=>true);
 expect(received).toHaveLength(1);expect(Array.from(received[0])).toEqual(Array.from(expected));
});
