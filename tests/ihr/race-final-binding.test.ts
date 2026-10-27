// Controlled ChildProcess objects only; this suite never creates a process or database.
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
const mocks=vi.hoisted(()=>({spawn:vi.fn()}))
vi.mock('node:child_process',()=>{const api={spawn:mocks.spawn,execFileSync:vi.fn(()=>{throw new Error('No process allowed')})};return {...api,default:api}})
import {runFinalRace} from '../database/ihr/race-final.mjs'
import {runRequestRaces} from '../database/ihr/concurrency.mjs'
import {runDecisionRaces} from '../database/ihr/decisions-concurrency.mjs'
const target={PGHOST:'127.0.0.1',PGUSER:'postgres',PGDATABASE:'pilot_test'}
beforeEach(()=>mocks.spawn.mockReset())
afterEach(()=>vi.restoreAllMocks())
function scripted(marker:string){
 const scripts:string[]=[],calls:any[]=[]
 mocks.spawn.mockImplementation((command,args,options)=>{
  const index=calls.length;calls.push({command,args,options})
  const child=Object.assign(new EventEmitter(),{pid:12345+index,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),unref:vi.fn(),kill:vi.fn()})
  scripts[index]='';child.stdin.on('data',data=>{
   scripts[index]+=String(data)
   if(index===1&&scripts[index].includes('\\i '))queueMicrotask(()=>process.emit('SIGTERM'))
  })
  child.stdin.on('finish',()=>{if(index===0)queueMicrotask(()=>{child.stdout.write(marker+'\n');child.emit('close',0)})})
  child.kill.mockImplementation(()=>{queueMicrotask(()=>child.emit('close',1));return true})
  return child
 })
 return {scripts,calls}
}
test.each([['core','composed/race-core-fixture.sql'],['decisions','composed/decisions-race-fixture.sql'],['calendar_then_submit','composed/race-fixture.sql']])('binds %s only after the read-only PG17 marker succeeds',async(scenario,path)=>{
 const proof=scripted('t');await expect(runFinalRace(target,scenario)).rejects.toThrow('Interrupted by SIGTERM')
 expect(proof.calls).toHaveLength(2)
 expect(proof.calls[0].command).toBe('psql');expect(proof.calls[0].options.shell).toBe(false)
 expect(proof.calls[0].options.env.PGOPTIONS).toContain('default_transaction_read_only=on')
 expect(proof.scripts[0]).toContain('BEGIN READ ONLY');expect(proof.scripts[0]).toContain("purpose='disposable-pilot-ci'")
 expect(proof.scripts[1]).toContain('/tests/database/ihr/'+path)
})
test.each(['core','decisions','calendar_then_submit'])('refuses an invalid marker for %s before loading a fixture',async scenario=>{
 const proof=scripted('f');await expect(runFinalRace(target,scenario)).rejects.toThrow('Disposable PG17 marker required');expect(proof.calls).toHaveLength(1)
})
test.each([runRequestRaces,runDecisionRaces])('fixture mode cannot inject an arbitrary SQL path',async run=>{
 await expect(run(target,'../external.sql')).rejects.toThrow('Unknown race fixture mode');expect(mocks.spawn).not.toHaveBeenCalled()
})
