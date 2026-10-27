// @vitest-environment node
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractReport, IMPORT_HELP } from '../../../src/lib/co/import/workerClient'
import type { ImportScope } from '../../../src/lib/co/import/types'
class MockWorker {
 static all:MockWorker[]=[]
 onmessage:((e:MessageEvent)=>void)|null=null
 onerror:((e:Event)=>void)|null=null
 terminate=vi.fn();postMessage=vi.fn()
 constructor(){MockWorker.all.push(this)}
 reply(data:unknown){this.onmessage?.({data} as MessageEvent)}
}
const scope:ImportScope={actorId:'actor',customerId:'customer',reportMonth:'2026-08-01',epoch:1}
const file=()=>new File([new Uint8Array([0x50,0x4b,3,4])],'report.xlsx')
const result={sha256:'a'.repeat(64),format:'xlsx',parserVersion:'test',sourceRows:[],sections:[],periodCandidates:[],customerCandidates:[],warnings:[]}
const tick=()=>new Promise(r=>setImmediate(r))
const ready=async(index=0)=>{await vi.waitFor(()=>expect(MockWorker.all[index]?.postMessage).toHaveBeenCalledOnce());return MockWorker.all[index]}
beforeEach(()=>{MockWorker.all=[];vi.stubGlobal('Worker',MockWorker)})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
it('terminates on cancellation and ignores late responses',async()=>{
 const a=new AbortController(), p=extractReport(file(),scope,a.signal);const rejected=expect(p).rejects.toMatchObject({name:'AbortError'});const w=await ready();a.abort();await rejected;expect(w.terminate).toHaveBeenCalledOnce();w.reply({...w.postMessage.mock.calls[0][0],result})
})
it('supersedes scope A and ignores stale full-scope/request mismatches',async()=>{
 const p=extractReport(file(),scope,new AbortController().signal);const old=expect(p).rejects.toMatchObject({name:'AbortError'});const a=await ready()
 const bScope={...scope,customerId:'next',epoch:2};const q=extractReport(file(),bScope,new AbortController().signal);await old;const b=await ready(1), msg=b.postMessage.mock.calls[0][0];let settled=false;void q.then(()=>{settled=true})
 b.reply({...msg,scope,result});await tick();expect(settled).toBe(false);b.reply({...msg,requestId:'wrong',result});await tick();expect(settled).toBe(false)
 a.reply({...a.postMessage.mock.calls[0][0],result});b.reply({...msg,result});expect(await q).toEqual(result);expect(a.terminate).toHaveBeenCalledOnce();expect(b.terminate).toHaveBeenCalledOnce()
})
it('terminates at a 30 second processing deadline with manual fallback',async()=>{
 vi.useFakeTimers();const q=extractReport(file(),scope,new AbortController().signal);const w=await ready();await vi.advanceTimersByTimeAsync(30000);expect((await q).warnings).toContain('manual_review:processing_timeout');expect(w.terminate).toHaveBeenCalledOnce()
})
it('checks extension, signature and size before worker dispatch',async()=>{
 for(const f of [new File(['no'],'report.xlsx'),new File([new Uint8Array([0x50,0x4b,3,4])],'report.xlsm')]) expect((await extractReport(f,scope,new AbortController().signal)).warnings.some(x=>x.startsWith('manual_review:'))).toBe(true)
 const f=file();Object.defineProperty(f,'size',{value:10*1024*1024+1});const spy=vi.spyOn(f,'arrayBuffer');expect((await extractReport(f,scope,new AbortController().signal)).warnings).toContain('manual_review:byte_limit');expect(spy).not.toHaveBeenCalled();expect(MockWorker.all).toHaveLength(0)
})
it('does not allocate file object URLs, cache bytes, or invoke account APIs',async()=>{
 const url=vi.spyOn(URL,'createObjectURL');const p=extractReport(file(),scope,new AbortController().signal);const w=await ready(),msg=w.postMessage.mock.calls[0][0];expect(msg.scope).toEqual(scope);expect(msg.requestId).toBeTypeOf('string');expect(w.postMessage.mock.calls[0][1]).toHaveLength(1);w.reply({...msg,result});await p;expect(url).not.toHaveBeenCalled()
 const source=readFileSync('src/lib/co/import/import.worker.ts','utf8');expect(source).not.toMatch(/localStorage|indexedDB|supabase|fetch\(|XMLHttpRequest/)
 expect(IMPORT_HELP).toContain('50 MiB');expect(IMPORT_HELP).toContain('100:1');expect(IMPORT_HELP).toContain('30 detik')
})
it('hashes original bytes and terminates when worker fails',async()=>{
 const p=extractReport(file(),scope,new AbortController().signal);const w=await ready();const msg=w.postMessage.mock.calls[0][0];expect(msg.sha256).toMatch(/^[a-f0-9]{64}$/);w.onerror?.(new Event('error'));expect((await p).warnings).toContain('manual_review:worker_error');expect(w.terminate).toHaveBeenCalledOnce()
})
it('rejects an oversized result before worker postMessage clones it',async()=>{
 const parser=await import('../../../src/lib/co/import/xlsx')
 const extract=vi.spyOn(parser,'extractXlsx').mockResolvedValue({...result,format:'xlsx',warnings:['x'.repeat(1024*1024)]})
 const workerSelf={onmessage:null as null|((event:MessageEvent)=>Promise<void>),postMessage:vi.fn()}
 vi.stubGlobal('self',workerSelf)
 try{
  await import('../../../src/lib/co/import/import.worker')
  await workerSelf.onmessage!({data:{requestId:'budget',scope,format:'xlsx',sha256:'a'.repeat(64),bytes:new Uint8Array()}} as MessageEvent)
  expect(workerSelf.postMessage).toHaveBeenCalledOnce()
  const payload=workerSelf.postMessage.mock.calls[0][0]
  expect(payload.result).toBeUndefined()
  expect(payload.error).toBe('result_budget')
  expect(payload.scope).toEqual(scope)
 }finally{extract.mockRestore()}
})
