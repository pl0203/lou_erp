import { expect,test,vi } from 'vitest'
import { act,renderHook } from '@testing-library/react'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
const auth=vi.hoisted(()=>({value:null as any}))
const worker=vi.hoisted(()=>({extract:vi.fn()}))
vi.mock('../../../src/lib/AuthContext',()=>({useAuth:()=>auth.value}))
vi.mock('../../../src/lib/co/import/workerClient',()=>({extractReport:worker.extract}))
import * as module from '../../../src/components/co/useCOImportReview'
vi.mock('../../../src/lib/supabase',()=>({supabase:{rpc:vi.fn()}}))
const scope={actorId:'11111111-1111-1111-1111-111111111111',customerId:'22222222-2222-2222-2222-222222222222',reportMonth:'2026-10-01',epoch:1}
const extracted={sha256:'a'.repeat(64),format:'pdf',parserVersion:'test',sourceRows:[],sections:[],periodCandidates:[],customerCandidates:[],warnings:[]}
const file=new File(['%PDF-'],'report.pdf',{type:'application/pdf'})
const binding={importId:scope.actorId,importVersion:'1',customerVersion:'4',draftId:scope.actorId,draftVersion:'3',manifestDigest:'b'.repeat(64)}
const preview={binding,previewFingerprint:'c'.repeat(64),issues:[],existingPreview:{can_post:true,operation:'post_report'}}
function deferred(){let resolve!:(x:any)=>void;return {promise:new Promise<any>(r=>resolve=r),resolve}}
function setup(overrides:any={}){
 expect(module).toHaveProperty('createImportReviewController')
 let unresolved=false,current=true
 const ports={isCurrent:()=>current,hasUnresolved:()=>unresolved,extract:vi.fn(async()=>extracted),prepare:vi.fn(async()=>binding),preview:vi.fn(async()=>preview),commit:vi.fn(async()=>({id:scope.actorId})),acceptReceipt:vi.fn(async()=>{}),recover:vi.fn(async()=>({status:'abandoned'})),declareUnit:vi.fn(async()=>{}),abandon:vi.fn(async()=>{}),...overrides}
 const controller=(module as any).createImportReviewController(scope,ports)
 return {controller,ports,setUnresolved:(v:boolean)=>{unresolved=v},revoke:()=>{current=false;controller.invalidate()}}
}
test('cancel during extraction aborts worker and never prepares; late extraction discarded',async()=>{
 const gate=deferred(),{controller:c,ports:p}=setup({extract:vi.fn(()=>gate.promise)})
 const run=c.loadFile(file);expect(c.getSnapshot().phase).toBe('processing');c.cancel()
 expect(p.extract.mock.calls[0][2].aborted).toBe(true);gate.resolve(extracted);await run
 expect(c.getSnapshot().phase).toBe('select');expect(p.prepare).not.toHaveBeenCalled()
})
test('preview is invalidated by typed edits; confirm double click sends only once',async()=>{
 const gate=deferred(),{controller:c,ports:p}=setup({commit:vi.fn(()=>gate.promise)})
 await c.loadFile(file);c.updateReview({currency:'IDR',completenessConfirmed:true});await c.review()
 expect(c.getSnapshot().phase).toBe('preview');c.updateReview({reason:'edit'})
 expect(c.getSnapshot().phase).toBe('review');await c.confirm();expect(p.commit).not.toHaveBeenCalled()
 await c.review();const run=c.confirm();await c.confirm();expect(p.commit).toHaveBeenCalledTimes(1)
 gate.resolve({id:scope.actorId});await run;expect(c.getSnapshot().phase).toBe('recorded')
})
test.each(['extract','prepare','preview','commit'])('scope/role loss during %s clears private contents and discards late responses',async stage=>{
 const gate=deferred(),{controller:c,revoke}=setup({[stage]:vi.fn(()=>gate.promise)})
 let run:Promise<any>
 if(stage==='extract')run=c.loadFile(file)
 else {await c.loadFile(file);if(stage==='prepare'||stage==='preview')run=c.review();else {await c.review();run=c.confirm()}}
 await Promise.resolve();revoke();gate.resolve(stage==='extract'?extracted:stage==='prepare'?binding:stage==='preview'?preview:{id:scope.actorId});await run!
 expect(c.getSnapshot().input).toBeNull();expect(c.getSnapshot().file).toBeNull();expect(c.getSnapshot().preview).toBeNull();expect(c.getSnapshot().phase).not.toBe('recorded')
})
test('uncertain command freezes edit/new file/confirm; recovery label is exact',async()=>{
 const {controller:c,ports:p,setUnresolved}=setup({commit:vi.fn(async()=>{setUnresolved(true);throw new Error('lost')})})
 await c.loadFile(file);await c.review();await c.confirm()
 expect(c.getSnapshot().phase).toBe('unknown');expect(c.getSnapshot().recoveryLabel).toBe('Periksa hasil pencatatan')
 const original=c.getSnapshot().input;await c.loadFile(file);c.updateReview({reason:'new'});await c.review();await c.confirm()
 expect(c.getSnapshot().input).toEqual(original);expect(p.commit).toHaveBeenCalledTimes(1)
})
test('cancel in-flight prepare keeps uncertainty rather than unlocking retry-as-new',async()=>{
 const gate=deferred(),{controller:c,setUnresolved}=setup({prepare:vi.fn(()=>{setUnresolved(true);return gate.promise})})
 await c.loadFile(file);const run=c.review();c.cancel();expect(c.getSnapshot().phase).toBe('unknown')
 gate.resolve(binding);await run;expect(c.getSnapshot().phase).toBe('unknown')
})
test('stale preview refusal preserves edits but removes confirmation',async()=>{
 const {controller:c}=setup({commit:vi.fn(async()=>{throw Object.assign(new Error('stale'),{code:'PT409'})})})
 await c.loadFile(file);await c.review();await c.confirm();expect(c.getSnapshot().phase).toBe('error');expect(c.getSnapshot().preview).toBeNull();expect(c.getSnapshot().input).not.toBeNull()
})

test('recovered prepare can preview without bytes, but edits require selecting the source file again',async()=>{
 const input={scope,extracted,mappings:[],returns:[],includedSectionIds:[],completenessConfirmed:true,omittedZeroStockKeyIds:[],currency:'IDR',reason:null}
 const {controller:c,ports:p}=setup({recover:vi.fn(async()=>({status:'committed',input,binding}))})
 await c.recover();expect(c.getSnapshot().file).toBeNull();await c.review();expect(c.getSnapshot().phase).toBe('preview')
 expect(p.prepare).not.toHaveBeenCalled();c.updateReview({reason:'change'});await c.review();expect(p.prepare).not.toHaveBeenCalled();expect(c.getSnapshot().phase).toBe('review')
})
test('manual-review extraction is never passed off as an accounting-ready source',async()=>{
 const {controller:c,ports:p}=setup({extract:vi.fn(async()=>({...extracted,warnings:['manual_review:unsupported_extension']}))})
 await c.loadFile(file);expect(c.getSnapshot().manualReviewRequired).toBe(true);await c.review();await c.confirm();expect(p.prepare).not.toHaveBeenCalled();expect(p.commit).not.toHaveBeenCalled()
})

test.each(['scope','role'])('mounted hook clears private source and aborts worker on %s change',async change=>{
 localStorage.clear()
 auth.value={user:{id:scope.actorId},profile:{id:scope.actorId,role:'co_admin',is_active:true},loading:false,error:null}
 const gate=deferred();worker.extract.mockImplementation(()=>gate.promise)
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
 const wrapper=({children}:any)=>createElement(QueryClientProvider,{client},children)
 const {result,rerender,unmount}=renderHook(({value})=>module.useCOImportReview(value),{wrapper,initialProps:{value:scope}})
 let pending!:Promise<void>;act(()=>{pending=result.current.loadFile(file)})
 expect(result.current.state.file).toBe(file)
 if(change==='role')auth.value={...auth.value,profile:{...auth.value.profile,role:'sales'}}
 rerender({value:change==='scope'?{...scope,epoch:2}:scope})
 expect(worker.extract.mock.calls.at(-1)![2].aborted).toBe(true)
 await act(async()=>{gate.resolve(extracted);await pending})
 expect(result.current.state.file).toBeNull();expect(result.current.state.input).toBeNull();expect(localStorage.length).toBe(0)
 unmount()
})
test('React root StrictMode effect replay does not permanently dispose the mounted owner',async()=>{
 localStorage.clear();auth.value={user:{id:scope.actorId},profile:{id:scope.actorId,role:'co_admin',is_active:true},loading:false,error:null};worker.extract.mockResolvedValue(extracted)
 const client=new QueryClient()
 const wrapper=({children}:any)=>createElement(QueryClientProvider,{client},children)
 const {result,unmount}=renderHook(()=>module.useCOImportReview(scope),{wrapper,reactStrictMode:true})
 await act(async()=>{await result.current.loadFile(file)})
 expect(result.current.state.phase).toBe('review');unmount()
})
test('newer canonical head preserves original receipt and requires explicit acceptance, never relabels receipt',async()=>{
 const original={id:scope.actorId,version:'1'},accept=vi.fn(async(_r:any,_o:any,acceptChanged=false)=>{if(!acceptChanged)throw Object.assign(new Error('current changed'),{code:'CO_IMPORT_CURRENT_CHANGED'})})
 const {controller:c}=setup({commit:vi.fn(async()=>original),acceptReceipt:accept})
 await c.loadFile(file);await c.review();await c.confirm();expect(c.getSnapshot().receipt).toEqual(original)
 expect(c).toHaveProperty('acceptRecovered');await c.acceptRecovered();expect(c.getSnapshot().phase).toBe('recorded');expect(c.getSnapshot().receipt).toEqual(original);expect(accept.mock.calls.at(-1)![2]).toBe(true)
})
test('server authority revocation clears private source even before profile refresh',async()=>{
 const {controller:c}=setup({prepare:vi.fn(async()=>{throw Object.assign(new Error('revoked'),{code:'42501'})})})
 await c.loadFile(file);await c.review();expect(c.getSnapshot().input).toBeNull();expect(c.getSnapshot().file).toBeNull();expect(c.getSnapshot().preview).toBeNull()
})
test('late old prepare cannot repopulate a new owner prepared binding',async()=>{
 const gate=deferred(),prepare=vi.fn().mockImplementationOnce(()=>gate.promise).mockResolvedValue(binding),{controller:c}=setup({prepare})
 await c.loadFile(file);const old=c.review();c.cancel();await c.loadFile(file);gate.resolve({...binding,importId:scope.customerId});await old
 await c.review();expect(prepare).toHaveBeenCalledTimes(2)
})
test('explicit completed review abandonment unlocks a new file',async()=>{
 const {controller:c,ports:p}=setup();await c.loadFile(file);await c.abandonReview('Discard this review');await c.loadFile(file)
 expect(p.extract).toHaveBeenCalledTimes(2);expect(c.getSnapshot().phase).toBe('review')
})
test('external scoped uncertainty interrupts extraction and disables mounted confirmation',async()=>{
 const gate=deferred(),{controller:c,ports:p,setUnresolved}=setup({extract:vi.fn(()=>gate.promise)})
 const run=c.loadFile(file);setUnresolved(true);expect(c).toHaveProperty('refreshRecoveryState');c.refreshRecoveryState();expect(c.getSnapshot().phase).toBe('unknown');expect(p.extract.mock.calls[0][2].aborted).toBe(true)
 gate.resolve(extracted);await run;expect(c.getSnapshot().phase).toBe('unknown');setUnresolved(false);c.refreshRecoveryState();expect(c.getSnapshot().phase).toBe('select')
})
test('unit declaration invalidates the mounted preview before its asynchronous command returns',async()=>{
 const gate=deferred(),{controller:c}=setup({declareUnit:vi.fn(()=>gate.promise)})
 await c.loadFile(file);await c.review();const pending=c.declareUnit({});expect(c.getSnapshot().preview).toBeNull();gate.resolve(undefined);await pending
})
test.each(['prepare','review','unit','evidence'])('explicit acknowledgment releases only a visible proven terminal %s result',async family=>{
 expect(module).toHaveProperty('ImportSupportingResultChanged')
 const terminal={family,result:family==='prepare'?binding:{id:scope.actorId},identity:{customerId:scope.customerId}},ack=vi.fn(async()=>{})
 const {controller:c}=setup({recover:vi.fn(async()=>{throw new (module as any).ImportSupportingResultChanged(terminal)}),acknowledgeSupporting:ack})
 await c.recover();expect(c.getSnapshot().phase).toBe('unknown');expect(c.getSnapshot().supportingResult).toEqual(terminal);expect(ack).not.toHaveBeenCalled()
 await c.acknowledgeSupporting();expect(ack.mock.calls[0][0]).toEqual(terminal);expect(c.getSnapshot().supportingResult).toBeNull();expect(c.getSnapshot().phase).toBe('select');expect(c.getSnapshot().file).toBeNull()
})
test('unknown/corrupt supporting recovery has no acknowledgment action to clear its ownership',async()=>{
 const ack=vi.fn(async()=>{}),{controller:c}=setup({recover:vi.fn(async()=>{throw new Error('invalid family')}),acknowledgeSupporting:ack})
 await c.recover();expect(c).toHaveProperty('acknowledgeSupporting');await c.acknowledgeSupporting();expect(ack).not.toHaveBeenCalled();expect(c.getSnapshot().supportingResult).toBeNull()
})
test('mapping context is mounted, immutable, scope/version-bound and cleared by owner changes',async()=>{
 const snapshot={scope,context:{draftId:binding.draftId,draftVersion:'1',customerId:scope.customerId,customerVersion:'4',reportMonth:scope.reportMonth,selectionId:null},selection:{state:null},rows:[],units:[]}
 const {controller:c,revoke}=setup({loadContext:vi.fn(async()=>snapshot)})
 expect(c).toHaveProperty('loadContext');await c.loadFile(file);await c.loadContext()
 expect(c.getSnapshot().context.scope).toEqual(scope);expect(Object.isFrozen(c.getSnapshot().context)).toBe(true)
 c.updateReview({currency:'IDR',completenessConfirmed:true});expect(c.getSnapshot().validation).not.toBeNull()
 revoke();expect(c.getSnapshot().context).toBeNull();expect(c.getSnapshot().validation).toBeNull()
})

test('effect setup after disposal starts a clean generation and cannot restore an old in-flight extraction',async()=>{
 const gate=deferred(),newSource={...extracted,parserVersion:'new generation'}
 const {controller:c,ports:p}=setup({extract:vi.fn().mockImplementationOnce(()=>gate.promise).mockResolvedValue(newSource)})
 const old=c.loadFile(file);c.dispose()
 expect(c.getSnapshot().file).toBeNull();expect(c.getSnapshot().input).toBeNull();expect(p.extract.mock.calls[0][2].aborted).toBe(true)
 expect(c).toHaveProperty('activate');c.activate();await c.loadFile(file);expect(c.getSnapshot().input.extracted.parserVersion).toBe('new generation')
 gate.resolve(extracted);await old;expect(c.getSnapshot().input.extracted.parserVersion).toBe('new generation');expect(p.prepare).not.toHaveBeenCalled()
})
test('real root StrictMode unmount aborts extraction and leaves retained handlers disabled',async()=>{
 localStorage.clear();auth.value={user:{id:scope.actorId},profile:{id:scope.actorId,role:'co_admin',is_active:true},loading:false,error:null}
 const gate=deferred();worker.extract.mockReset().mockImplementation(()=>gate.promise);const client=new QueryClient()
 const wrapper=({children}:any)=>createElement(QueryClientProvider,{client},children)
 const {result,unmount}=renderHook(()=>module.useCOImportReview(scope),{wrapper,reactStrictMode:true})
 const load=result.current.loadFile;let pending!:Promise<void>;act(()=>{pending=load(file)})
 expect(worker.extract).toHaveBeenCalledTimes(1);const signal=worker.extract.mock.calls[0][2]
 unmount();expect(signal.aborted).toBe(true);gate.resolve(extracted);await pending;await load(file);expect(worker.extract).toHaveBeenCalledTimes(1)
})
test('root StrictMode cleanup retains uncertainty and replayed setup can recover the original request',async()=>{
 localStorage.clear();auth.value={user:{id:scope.actorId},profile:{id:scope.actorId,role:'co_admin',is_active:true},loading:false,error:null}
 const {CO_BACKEND}=await import('../../../src/lib/co/queryKeys'),{supabase}=await import('../../../src/lib/supabase')
 const key=`co-import-request:${encodeURIComponent(CO_BACKEND)}:${scope.actorId}:${scope.customerId}:${encodeURIComponent(`report:${scope.reportMonth}:commit`)}`
 const original=JSON.stringify({id:scope.actorId,key:'a'.repeat(64),uncertain:true,binding:{family:'commit',customerId:scope.customerId,month:scope.reportMonth,operation:'post_report',binding}})
 localStorage.setItem(key,original)
 vi.mocked(supabase.rpc).mockImplementation(async(name:string)=>({data:name==='pilot_my_profile'?[auth.value.profile]:{status:'abandoned'},error:null}) as any)
 const client=new QueryClient(),wrapper=({children}:any)=>createElement(QueryClientProvider,{client},children)
 const {result,unmount}=renderHook(()=>module.useCOImportReview(scope),{wrapper,reactStrictMode:true})
 expect(result.current.state.phase).toBe('unknown');expect(localStorage.getItem(key)).toBe(original)
 await act(async()=>{await result.current.recover()})
 expect(result.current.state.phase).toBe('select');expect(localStorage.getItem(key)).toBeNull()
 expect(supabase.rpc).toHaveBeenCalledWith('pilot_co_import_reconcile_v1',{p_request_id:scope.actorId,p_abandon:true});unmount()
})

test('human transcription is a separate owned action and resets review decisions while retaining original failure',async()=>{
 const original={...extracted,parserVersion:'co-searchable-pdf-3',warnings:['manual_review:unsupported_layout_or_image_only']};const {controller:c}=setup({extract:vi.fn(async()=>original)});await c.loadFile(file);c.updateReview({currency:'IDR',completenessConfirmed:true});const row=(await import('./reviewFixture')).row();c.transcribeSource({sourceRows:[row],sections:[{id:'s1',label:'Physical source',rowIds:['r1'],printedTotal:null}],periodCandidates:[],customerCandidates:[],reason:'Read physical source',confirmed:true});expect(c.getSnapshot().manualReviewRequired).toBe(false);expect(c.getSnapshot().input.extracted.warnings).toEqual(original.warnings);expect(c.getSnapshot().input.completenessConfirmed).toBe(false);expect(c.getSnapshot().input.includedSectionIds).toEqual([]);expect(c.getSnapshot().file).toBe(file);c.cancel();c.transcribeSource({});expect(c.getSnapshot().input).toBeNull();
});
test('fresh Edit file keeps explicit reason before loading server context, never copies old evidence',async()=>{const {controller:c,ports:p}=setup({loadContext:vi.fn(async(reason)=>{throw new Error(reason)})});await c.loadFile(file,'Correct source quantity');expect(c.getSnapshot().input.reason).toBe('Correct source quantity');await c.loadContext();expect(p.loadContext.mock.calls[0][0]).toBe('Correct source quantity');expect(c.getSnapshot().file).toBe(file)});
test('Edit seeds editable effective decisions without evidence authority; matching fresh source preserves edits, incompatible source resets',async()=>{const {input}=await import('./reviewFixture');const historical=input({scope});historical.mappings[0].stockKeyId=scope.actorId;historical.extracted.periodCandidates=[scope.reportMonth];const {controller:c,ports:p}=setup({extract:vi.fn(async()=>historical.extracted)});const seed={revisionId:scope.customerId,manifestDigest:'d'.repeat(64),sourceSha256:historical.extracted.sha256,input:historical};expect(typeof c.seedEdit).toBe('function');c.seedEdit(seed);expect(c.getSnapshot().input.mappings[0].quantity).toBe('2');expect(c.getSnapshot().input.mappings[0].confirmed).toBe(false);expect(c.getSnapshot().input.completenessConfirmed).toBe(false);expect(c.getSnapshot().file).toBeNull();expect(p.prepare).not.toHaveBeenCalled();c.updateReview({reason:'Correct mapping',mappings:[{...c.getSnapshot().input.mappings[0],quantity:'3'}]});await c.loadFile(file);expect(c.getSnapshot().input.mappings[0].quantity).toBe('3');expect(c.getSnapshot().input.reason).toBe('Correct mapping');expect(c.getSnapshot().file).toBe(file);expect(c.getSnapshot().editSeed.revisionId).toBe(scope.customerId);expect(Object.keys(c.getSnapshot().editSeed).sort()).toEqual(['manifestDigest','revisionId','sourceSha256']);p.extract.mockResolvedValue({...historical.extracted,sha256:'e'.repeat(64)});await c.loadFile(new File(['new'],'new.pdf'));expect(c.getSnapshot().input.mappings).toEqual([]);expect(c.getSnapshot().editSeed).toBeNull();expect(c.getSnapshot().sourceReset).toBe(true)});
test('transient canonical read suspension retains source/decisions and blocks retained writes until explicit resume',async()=>{const {controller:c,ports:p}=setup();await c.loadFile(file);c.updateReview({reason:'Keep exact raw review'});await c.review();expect(typeof c.setReadBlocked).toBe('function');c.setReadBlocked(true);const retained=c.getSnapshot().input;expect(c.getSnapshot().file).toBe(file);expect(c.getSnapshot().preview).toBeNull();c.updateReview({reason:'must not apply'});await c.loadFile(new File(['replacement'],'replacement.pdf'));await c.review();await c.confirm();expect(c.getSnapshot().input).toBe(retained);expect(p.commit).not.toHaveBeenCalled();expect(p.extract).toHaveBeenCalledTimes(1);c.setReadBlocked(false);expect(c.getSnapshot().input.reason).toBe('Keep exact raw review');expect(c.getSnapshot().needsFreshReview).toBe(true)});
test('seed provenance clears immediately on authoritative rejection and terminal/discard resets',async()=>{const {input}=await import('./reviewFixture');const historical=input({scope});const {controller:c}=setup({loadContext:vi.fn(async()=>{throw Object.assign(new Error('Denied'),{code:'42501'})})});c.seedEdit({revisionId:scope.customerId,manifestDigest:'d'.repeat(64),sourceSha256:historical.extracted.sha256,input:historical});await c.loadContext();expect(c.getSnapshot().input).toBeNull();expect(c.getSnapshot().editSeed).toBeNull()});
test('failed fresh attachment preserves editable seed intent but grants no File or prepare authority',async()=>{const {input}=await import('./reviewFixture');const historical=input({scope});const {controller:c,ports:p}=setup({extract:vi.fn(async()=>{throw new Error('Malformed source')})});c.seedEdit({revisionId:scope.customerId,manifestDigest:'d'.repeat(64),sourceSha256:historical.extracted.sha256,input:historical});c.updateReview({reason:'Keep intent',mappings:[{...c.getSnapshot().input.mappings[0],quantity:'3'}]});await c.loadFile(file);expect(c.getSnapshot().input.mappings[0].quantity).toBe('3');expect(c.getSnapshot().file).toBeNull();expect(c.getSnapshot().error.message).toBe('Malformed source');await c.review();expect(p.prepare).not.toHaveBeenCalled()});
test('editable seeded review remains a strict manifest-wire value when optional historical source confirmations are absent',async()=>{const {input}=await import('./reviewFixture');const {decodeImportManifest}=await import('../../../src/lib/co/import/manifest');const historical=input({scope});historical.mappings[0].stockKeyId=scope.actorId;const {controller:c}=setup();c.seedEdit({revisionId:scope.customerId,manifestDigest:'d'.repeat(64),sourceSha256:historical.extracted.sha256,input:historical});expect(()=>decodeImportManifest({schemaVersion:1,evidenceId:scope.actorId,digest:'d'.repeat(64),input:c.getSnapshot().input})).not.toThrow();expect(c.getSnapshot().input.sourceConfirmations).toEqual([])});
test.each(['suspend','discard','identity','authority'])('pending seed attachment retains edited intent only for safe suspension, not %s restoration',async action=>{const {input}=await import('./reviewFixture');const historical=input({scope});const gate=deferred();let reject!:(x:unknown)=>void;const promise=action==='authority'?new Promise((_,r)=>reject=r):gate.promise;const {controller:c,revoke}=setup({extract:vi.fn(()=>promise)});const seed={revisionId:scope.customerId,manifestDigest:'d'.repeat(64),sourceSha256:historical.extracted.sha256,input:historical};c.seedEdit(seed);c.updateReview({reason:'Edited seed',mappings:[{...historical.mappings[0],quantity:'3',confirmed:false}]});const pending=c.loadFile(file);if(action==='suspend'){c.setReadBlocked(true);expect(c.getSnapshot().input).not.toBeNull();expect(c.getSnapshot().input.mappings[0].quantity).toBe('3');expect(c.getSnapshot().file).toBeNull();c.setReadBlocked(false)}else if(action==='discard')c.cancel();else if(action==='identity')revoke();else reject(Object.assign(new Error('Denied'),{code:'42501'}));if(action!=='authority')gate.resolve(historical.extracted);await pending;if(action==='suspend'){expect(c.getSnapshot().input.mappings[0].quantity).toBe('3');expect(c.getSnapshot().file).toBeNull()}else{c.seedEdit(seed);expect(c.getSnapshot().input).toBeNull();expect(c.getSnapshot().editSeed).toBeNull()}});
test('source-bound recovery mode blocks retained primary actions while permitting only original-result reconciliation',async()=>{const {controller:c,ports:p}=setup();await c.loadFile(file);await c.review();const prepares=p.prepare.mock.calls.length;c.setPrimaryBlocked(true);await c.loadContext();c.updateReview({reason:'blocked primary edit'});await c.review();await c.confirm();await c.declareUnit({});expect(p.prepare).toHaveBeenCalledTimes(prepares);expect(p.loadContext).toBeUndefined();expect(p.commit).not.toHaveBeenCalled();expect(p.declareUnit).not.toHaveBeenCalled();await c.recover();expect(p.recover).toHaveBeenCalledTimes(1)});
test.each([{issues:[]},{issues:[{code:'return_unresolved_prior_coverage_proven',rowId:'other',message:'Proven',blocking:false}]}])('unresolved human decision cannot confirm a preview missing its exact server finding (%j)',async ({issues})=>{
 const {controller:c,ports:p}=setup({preview:vi.fn(async()=>({...preview,issues}))});await c.loadFile(file);
 c.updateReview({returns:[{rowId:'r1',state:'unresolved',stockImpact:'uncertain',links:[],note:'Await server check'}]});await c.review();await c.confirm();
 expect(p.commit).not.toHaveBeenCalled();expect(c.getSnapshot().phase).not.toBe('recorded');
});
test('proof preview cannot be reused after source choice changes or stale return refusal',async()=>{
 const result={...preview,issues:[{code:'return_unresolved_prior_coverage_proven',rowId:'r1',message:'Proven',blocking:false}]};const {controller:c,ports:p}=setup({preview:vi.fn(async()=>result)});await c.loadFile(file);c.updateReview({returns:[{rowId:'r1',state:'unresolved',stockImpact:'uncertain',links:[],note:'Await server check'}]});await c.review();
 c.updateReview({reason:'New review'});await c.confirm();expect(p.commit).not.toHaveBeenCalled();
 p.preview.mockRejectedValueOnce(Object.assign(new Error('Return changed'),{code:'PT409'}));await c.review();await c.confirm();expect(p.commit).not.toHaveBeenCalled();expect(c.getSnapshot().preview).toBeNull();
});
