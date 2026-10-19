// @vitest-environment node
import {readFileSync} from 'node:fs'
import {expect,it} from 'vitest'
let guard:any,fixture:any
try{guard=await import('../employee-browser/guards.mjs')}catch{}
try{fixture=await import('../employee-browser/server.ts')}catch{}
it('requires exact source bytes and a complete fixed manifest',()=>{
 expect(guard).toBeDefined()
 const manifest=JSON.parse(readFileSync('tests/employee-browser/source-manifest.json','utf8'))
 const bytes=new Map(manifest.files.map((x:any)=>[x.path,readFileSync(x.path)]))
 expect(()=>guard.assertBrowserManifest(manifest,bytes)).not.toThrow()
 for(const bad of [{...manifest,files:manifest.files.slice(1)},{...manifest,files:[...manifest.files,manifest.files[0]]},{...manifest,files:manifest.files.map((x:any,i:number)=>i?x:{...x,path:'.env'})}])expect(()=>guard.assertBrowserManifest(bad,bytes)).toThrow()
 const changed=new Map(bytes);changed.set(manifest.files[0].path,Buffer.from('unreviewed'))
 expect(()=>guard.assertBrowserManifest(manifest,changed)).toThrow()
})
it('permits explicit honest local preparation, never forged CI or external requests',()=>{
 expect(guard).toBeDefined()
 expect(guard.validateBrowserMode(['--prepare'],{})).toBe('local-prepare')
 expect(()=>guard.validateBrowserMode([],{})).toThrow()
 expect(()=>guard.validateBrowserMode(['--prepare'],{GITHUB_ACTIONS:'true'})).toThrow()
 for(const url of ['https://example.com','http://localhost:4179/','http://127.0.0.1:4180/','file:///tmp/test','data:text/html,x'])expect(guard.allowBrowserRequest(url,'http://127.0.0.1:4179')).toBe(false)
 expect(guard.allowBrowserRequest('http://127.0.0.1:4179/assets/a.js','http://127.0.0.1:4179')).toBe(true)
})
it('synthetic RPC uses application decoders and refuses malformed success fixtures',async()=>{
 expect(fixture?.createSyntheticServer).toBeTypeOf('function')
 const store=new Map<string,string>(),server=fixture.createSyntheticServer({getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)})
 const valid=await server.rpc('employee_page_v1',{p_query:'',p_status:null,p_page:1,p_page_size:25})
 expect(valid.data.rows.length).toBeGreaterThan(1)
 expect(()=>server.validateResponse('employee_page_v1',{...valid.data,unexpected:true})).toThrow()
 expect(()=>server.validateResponse('employee_context_v1',{actorId:'bad'})).toThrow()
 await expect(server.rpc('users.update',{role:'executive'})).rejects.toThrow(/unavailable/)
})
it('simulates durable after-commit recovery, same-ID replay and before-commit abandonment without duplicate writes',async()=>{
 const store=new Map<string,string>(),storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)},server=fixture.createSyntheticServer(storage)
 const args={p_employee_id:'97000000-0000-0000-0000-000000000003',p_expected_version:0,p_action:'create_employee',p_payload:{name:'Synthetic interrupted',employeeNumber:null,jobTitle:null,team:null,recordedStatus:'draft'},p_reason:'Synthetic proof',p_effective_date:null,p_source_reference:null}
 const preview=await server.rpc('employee_preview_v1',args),command={...args,p_operation_id:'98000000-0000-0000-0000-000000000003',p_preview_fingerprint:preview.data.previewFingerprint}
 server.configure({mode:'lost-after'});await expect(server.rpc('employee_command_v1',command)).rejects.toThrow(/after commit/)
 const reloaded=fixture.createSyntheticServer(storage),outcome=await reloaded.rpc('employee_operation_v1',{p_operation_id:command.p_operation_id,p_resolution:'read'})
 expect(outcome.data.state).toBe('completed');expect(reloaded.getState().commits).toBe(1)
 expect((await reloaded.rpc('employee_command_v1',command)).data).toEqual(outcome.data.result)
 expect(reloaded.getState().commits).toBe(1)
 expect((await reloaded.rpc('employee_command_v1',{...command,p_reason:'Changed'})).error.message).toBe('OPERATION_REUSED')
 const absent={...args,p_employee_id:'97000000-0000-0000-0000-000000000009'},absentPreview=await reloaded.rpc('employee_preview_v1',absent),abandoned={...absent,p_operation_id:'98000000-0000-0000-0000-000000000009',p_preview_fingerprint:absentPreview.data.previewFingerprint}
 reloaded.configure({mode:'lost-before'});await expect(reloaded.rpc('employee_command_v1',abandoned)).rejects.toThrow(/before commit/)
 expect((await reloaded.rpc('employee_operation_v1',{p_operation_id:abandoned.p_operation_id,p_resolution:'abandon'})).data.state).toBe('abandoned')
 expect((await reloaded.rpc('employee_command_v1',abandoned)).error.message).toBe('OPERATION_ABANDONED')
 expect(reloaded.getState().commits).toBe(1)
})

it('rejects incomplete real-component utility CSS instead of accepting a misleading visual build',()=>{
 const selectors=['.sr-only{','.h-8{','.w-8{','.min-h-screen{']
 expect(()=>guard.assertBuiltStyles(selectors.join('}'))).not.toThrow()
 for(const missing of selectors)expect(()=>guard.assertBuiltStyles(selectors.filter(x=>x!==missing).join('}'))).toThrow(/Missing actual source utility/)
})

it('keeps fixture provenance in normal footer flow and viewport routes explicitly synthetic',()=>{
 const harness=readFileSync('tests/employee-browser/harness.tsx','utf8'),css=readFileSync('tests/employee-browser/harness.css','utf8'),preview=readFileSync('tests/employee-browser/preview.js','utf8')
 expect(harness.indexOf('<Outlet/>')).toBeLessThan(harness.indexOf('className="qa-banner"'))
 expect(css.match(/\.qa-banner\{([^}]+)}/)?.[1]).not.toMatch(/position:(fixed|absolute)|z-index/)
 expect(preview.match(/frame.src=/g)).toHaveLength(3)
 expect(preview).toContain('not product navigation or draft continuity proof')
})
