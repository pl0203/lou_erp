import { beforeEach, expect, test, vi } from 'vitest'
import * as api from '../../../src/lib/co/import/rpc'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('../../../src/lib/supabase',()=>({supabase:{rpc}}))
const actor='11111111-1111-1111-1111-111111111111', customer='22222222-2222-2222-2222-222222222222', id='33333333-3333-3333-3333-333333333333'
const binding={importId:id,importVersion:'1',customerVersion:'4',draftId:id,draftVersion:'3',manifestDigest:'a'.repeat(64)}
const command={binding,previewFingerprint:'b'.repeat(64),mode:'post',reason:null}
const receipt={id,operation:'post_report',version:'1',customer_id:customer,customer_version:'5'}
const options=()=>({scope:{actorId:actor,customerId:customer,reportMonth:'2026-10-01',epoch:1},role:'co_admin',storage:()=>localStorage,isCurrent:()=>true,authorize:async()=>{}})
beforeEach(()=>{localStorage.clear();rpc.mockReset()})
test('same sender UUID in SQL and ImportPost; storage contains only identities, never source/reason/payload',async()=>{
 expect(api).toHaveProperty('createImportCommands')
 const client=(api as any).createImportCommands(options())
 let uuid=''
 rpc.mockImplementation(async(name:string,args:any)=>{
  if(name==='pilot_co_import_commit_v1'){uuid=args.p_request_id;expect(args.p_payload.requestId).toBe(uuid);return {data:receipt,error:null}}
  expect(name).toBe('pilot_co_import_reconcile_v1');expect(args.p_request_id).toBe(uuid);expect(args.p_abandon).toBe(false)
  return {data:{status:'committed',operation:'post_report',receipt},error:null}
 })
 expect(await client.commit(command)).toEqual(receipt)
 const stored=localStorage.getItem(localStorage.key(0)!)!
 expect(stored).not.toContain('previewFingerprint');expect(stored).not.toContain('reason');expect(stored).not.toContain('sourceRows')
 expect(JSON.parse(stored).id).toBe(uuid);expect(client.hasUnresolved()).toBe(true)
})
test('reload and epoch change recovers original commit without raw payload; every family freezes',async()=>{
 expect(api).toHaveProperty('createImportCommands')
 rpc.mockResolvedValue({data:null,error:{message:'network lost'}})
 const first=(api as any).createImportCommands(options());await expect(first.commit(command)).rejects.toThrow('network lost')
 const saved=localStorage.getItem(localStorage.key(0)!)!
 const second=(api as any).createImportCommands({...options(),scope:{...options().scope,epoch:999}})
 await expect(second.commit(command)).rejects.toThrow('Periksa hasil pencatatan')
 await expect(second.declareUnit({})).rejects.toThrow('Periksa hasil pencatatan')
 expect(localStorage.getItem(localStorage.key(0)!)).toBe(saved)
 rpc.mockResolvedValue({data:{status:'committed',operation:'post_report',receipt},error:null})
 expect(await second.recover()).toEqual({family:'commit',status:'committed',result:receipt})
})
test('wrong customer/family recovery never consumes uncertainty',async()=>{
 expect(api).toHaveProperty('createImportCommands')
 rpc.mockResolvedValue({data:null,error:{message:'lost'}})
 const client=(api as any).createImportCommands(options());await expect(client.commit(command)).rejects.toThrow()
 rpc.mockResolvedValue({data:{status:'committed',operation:'post_report',receipt:{...receipt,customer_id:actor}},error:null})
 await expect(client.recover()).rejects.toThrow();expect(client.hasUnresolved()).toBe(true)
 rpc.mockResolvedValue({data:{status:'committed',operation:'prepare_import',binding},error:null})
 await expect(client.recover()).rejects.toThrow();expect(client.hasUnresolved()).toBe(true)
})
test('scope/authority loss suppresses command before send and retains saved uncertainty',async()=>{
 expect(api).toHaveProperty('createImportCommands')
 let current=true
 const client=(api as any).createImportCommands({...options(),isCurrent:()=>current})
 rpc.mockImplementation(async()=>{current=false;return {data:receipt,error:null}})
 await expect(client.commit(command)).rejects.toThrow();expect(client.hasUnresolved()).toBe(true)
 const calls=rpc.mock.calls.length;await expect(client.recover()).rejects.toThrow();expect(rpc).toHaveBeenCalledTimes(calls)
})
test('ordinary and evidence outstanding identities freeze import commands without leaking across months',async()=>{
 expect(api).toHaveProperty('createImportCommands')
 const prefix=`co-evidence-request:${encodeURIComponent((await import('../../../src/lib/co/queryKeys')).CO_BACKEND)}:${actor}:${customer}:`
 localStorage.setItem(prefix+encodeURIComponent('report:2026-10-01'),JSON.stringify({id,key:'a'.repeat(64),uncertain:true}))
 const client=(api as any).createImportCommands(options());expect(client.hasUnresolved()).toBe(true)
 await expect(client.commit(command)).rejects.toThrow('Periksa hasil pencatatan');expect(rpc).not.toHaveBeenCalled()
 const other=(api as any).createImportCommands({...options(),scope:{...options().scope,reportMonth:'2026-11-01'}})
 expect(other.hasUnresolved()).toBe(false)
})
test('cancellation during authorization prevents request creation/transport',async()=>{
 let live=true,finish!:()=>void
 const gate=new Promise<void>(resolve=>{finish=resolve})
 const client=api.createImportCommands({...options(),isCurrent:()=>live,authorize:()=>gate})
 const run=client.commit(command as any);live=false;finish()
 await expect(run).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();expect(localStorage.length).toBe(0)
})
test('retained original receipt cannot be replaced by a newer receipt during recovery',async()=>{
 rpc.mockResolvedValue({data:{status:'committed',operation:'post_report',receipt},error:null})
 rpc.mockImplementation(async(name:string)=>({data:name==='pilot_co_import_commit_v1'?receipt:{status:'committed',operation:'post_report',receipt},error:null}))
 const client=api.createImportCommands(options());await client.commit(command as any)
 const original=localStorage.getItem(localStorage.key(0)!)
 rpc.mockResolvedValue({data:{status:'committed',operation:'post_report',receipt:{...receipt,version:'2'}},error:null})
 await expect(client.recover()).rejects.toThrow();expect(localStorage.getItem(localStorage.key(0)!)).toBe(original)
})
test.each(['ordinary','evidence'])('import uncertainty blocks a new %s command; its recovery stays available',async family=>{
 rpc.mockResolvedValue({data:null,error:{message:'lost'}})
 const imports=api.createImportCommands(options());await expect(imports.commit(command as any)).rejects.toThrow()
 const {createCOTransactionSender}=await import('../../../src/lib/co/transactions')
 const {createEvidenceSender}=await import('../../../src/lib/co/evidence')
 const o={actorId:actor,customerId:customer,scope:'report:2026-10-01',role:'co_admin',storage:()=>localStorage,isCurrent:()=>true,authorize:async()=>{}}
 const sender=family==='ordinary'?createCOTransactionSender(o):createEvidenceSender(o)
 const count=rpc.mock.calls.length
 await expect((sender as any)(family==='ordinary'?'save_report_draft':'register_evidence',{customer_id:customer,draft_id:id})).rejects.toThrow('Periksa hasil pencatatan')
 expect(rpc).toHaveBeenCalledTimes(count)
 const other=family==='ordinary'?createCOTransactionSender({...o,scope:'report:2026-11-01'}):createEvidenceSender({...o,scope:'report:2026-11-01'})
 await expect((other as any)(family==='ordinary'?'save_report_draft':'register_evidence',{customer_id:customer,draft_id:id})).rejects.toThrow('lost')
 expect(rpc.mock.calls.length).toBe(count+1)
})
test('import cache identity includes role/scope/epoch and every immutable binding version',async()=>{
 const {coKeys}=await import('../../../src/lib/co/queryKeys')
 expect(coKeys).toHaveProperty('importRead')
 const key=(coKeys as any).importRead({actorId:actor,role:'co_admin'},options().scope,'preview',binding,'b'.repeat(64))
 for(const s of [{...options().scope,epoch:2},{...options().scope,customerId:actor},{...options().scope,reportMonth:'2026-11-01'}])expect((coKeys as any).importRead({actorId:actor,role:'co_admin'},s,'preview',binding,'b'.repeat(64))).not.toEqual(key)
 expect((coKeys as any).importRead({actorId:actor,role:'executive'},options().scope,'preview',binding,'b'.repeat(64))).not.toEqual(key)
 expect((coKeys as any).importRead({actorId:actor,role:'co_admin'},options().scope,'preview',{...binding,draftVersion:'4'},'b'.repeat(64))).not.toEqual(key)
})
test('a caller mutation during authorization cannot change the hashed logical commit',async()=>{
 let finish!:()=>void;const gate=new Promise<void>(r=>{finish=r}),mutable=structuredClone(command)
 const client=api.createImportCommands({...options(),authorize:()=>gate});let sent:any
 rpc.mockImplementation(async(name:string,args:any)=>{if(name==='pilot_co_import_commit_v1'){sent=args.p_payload;return {data:receipt,error:null}}return {data:{status:'committed',operation:'post_report',receipt},error:null}})
 const run=client.commit(mutable as any);mutable.previewFingerprint='f'.repeat(64);finish();await run
 expect(sent.previewFingerprint).toBe(command.previewFingerprint)
})
test('prepare has distinct typed recovery and rejects another manifest or draft version after reload',async()=>{
 const {input}=await import('./reviewFixture');const review=input({scope:options().scope});review.mappings[0].stockKeyId=id
 rpc.mockResolvedValue({data:null,error:{message:'lost'}})
 const client=api.createImportCommands(options());await expect(client.prepare({manifest:{schemaVersion:1,evidenceId:id,input:review,digest:'a'.repeat(64)},expected_customer_version:'4',expected_draft_version:'2',expected_evidence_version:'2'},id)).rejects.toThrow('lost')
 const saved=localStorage.getItem(localStorage.key(0)!)!;expect(saved).not.toContain('sourceRows');expect(saved).not.toContain('Synthetic')
 rpc.mockResolvedValue({data:{status:'committed',operation:'prepare_import',binding:{...binding,manifestDigest:'b'.repeat(64)}},error:null})
 await expect(api.createImportCommands(options()).recover()).rejects.toThrow()
 rpc.mockResolvedValue({data:{status:'committed',operation:'prepare_import',binding},error:null})
 expect(await api.createImportCommands(options()).recover()).toEqual({family:'prepare',status:'committed',result:binding})
})
test('review lifecycle recovery rejects wrong optimistic versions without coercing a receipt',async()=>{
 const payload={draft_id:id,expected_draft_version:'3',expected_customer_version:'4',expected_selection_id:null,original_revision_id:null,expected_report_version:null,action:'open' as const,reason:'Review original file'}
 const result={version:'1',selectionId:id,state:'review_open',draftId:id,draftVersion:'99',customerVersion:'4'}
 rpc.mockImplementation(async(name:string)=>({data:name==='pilot_co_import_review_v1'?result:{status:'committed',operation:'review_import',review:result},error:null}))
 const client=api.createImportCommands(options());await expect(client.review(payload)).rejects.toThrow();expect(client.hasUnresolved()).toBe(true)
})
test('unit immutable declaration rejects wrong customer/version and stores no unit reason',async()=>{
 rpc.mockResolvedValue({data:null,error:{message:'lost'}})
 const client=api.createImportCommands(options());await expect(client.declareUnit({customer_id:customer,stock_key_id:id,expected_customer_version:'4' as any,expected_unit_version:null,unit:'PCS',reason:'Private unit confirmation',confirmed:true})).rejects.toThrow('lost')
 expect(localStorage.getItem(localStorage.key(0)!)!).not.toContain('Private unit')
 rpc.mockResolvedValue({data:{status:'committed',operation:'declare_stock_key_unit',receipt:{...receipt,operation:'declare_stock_key_unit',customer_version:'4'}},error:null})
 await expect(client.recover()).rejects.toThrow();expect(client.hasUnresolved()).toBe(true)
})
test('review command rejects missing predecessor and private extra fields before durable request',async()=>{
 const client=api.createImportCommands(options()),p={draft_id:id,expected_draft_version:'3',expected_customer_version:'4',expected_selection_id:null,original_revision_id:null,expected_report_version:null,action:'open',reason:'Review original'}
 await expect(client.review({...p,sourceRows:[]} as any)).rejects.toThrow();expect(localStorage.length).toBe(0);expect(rpc).not.toHaveBeenCalled()
 const {expected_selection_id:_,...missing}=p;await expect(client.review(missing as any)).rejects.toThrow();expect(localStorage.length).toBe(0)
})
test('existing ordinary exact-request recovery remains available when another scoped family is unresolved',async()=>{
 rpc.mockResolvedValue({data:null,error:{message:'lost'}});const imports=api.createImportCommands(options());await expect(imports.commit(command as any)).rejects.toThrow();const importKey=localStorage.key(0)!,importRaw=localStorage.getItem(importKey)!
 localStorage.clear();const {createCOTransactionSender}=await import('../../../src/lib/co/transactions')
 const ordinary=createCOTransactionSender({actorId:actor,customerId:customer,scope:'report:2026-10-01',role:'co_admin',storage:()=>localStorage,isCurrent:()=>true,authorize:async()=>{}})
 const p={customer_id:customer,draft_id:id};await expect(ordinary('save_report_draft',p)).rejects.toThrow('lost');localStorage.setItem(importKey,importRaw)
 const ownReceipt={...receipt,operation:'save_report_draft'};rpc.mockResolvedValue({data:{status:'committed',operation:'save_report_draft',receipt:ownReceipt},error:null})
 expect(await ordinary('save_report_draft',p)).toEqual(ownReceipt);expect(localStorage.getItem(importKey)).toBe(importRaw)
})
