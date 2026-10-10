// No process or database is launched. These unit tests drive owned ChildProcess events.
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
const mocks=vi.hoisted(()=>({spawn:vi.fn()}))
vi.mock('node:child_process',()=>{const api={spawn:mocks.spawn,execFileSync:vi.fn(()=>{throw new Error('No real process allowed in unit test')})};return {...api,default:api}})
import { runRequestRaces } from '../database/ihr/concurrency.mjs'
const target={PGHOST:'127.0.0.1',PGDATABASE:'pilot_test',PGUSER:'postgres'}
function fakeChild(closeDelay?:number){
 const child=Object.assign(new EventEmitter(),{pid:12345,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),unref:vi.fn(),kill:vi.fn<(signal:string)=>boolean>()})
 child.kill.mockImplementation(()=>{if(closeDelay!==undefined)setTimeout(()=>child.emit('close',1),closeDelay);return true})
 mocks.spawn.mockReturnValue(child);return child
}
beforeEach(()=>{vi.useFakeTimers();mocks.spawn.mockReset()})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
test.each(['SIGTERM','SIGINT'] as const)('external %s prevents new children, waits for close and restores listeners',async signal=>{
 const previous=process.listenerCount(signal),child=fakeChild(50);let outcome:string|undefined
 const run=runRequestRaces(target).then(()=>outcome='success',error=>outcome=error.message)
 process.emit(signal)
 await vi.advanceTimersByTimeAsync(20);expect(outcome).toBeUndefined();expect(child.kill).toHaveBeenCalledWith('SIGTERM')
 await vi.advanceTimersByTimeAsync(60);await run
 expect(outcome).toBe(`Interrupted by ${signal}`);expect(mocks.spawn).toHaveBeenCalledTimes(1);expect(process.listenerCount(signal)).toBe(previous)
})
test('process error is not terminal closure and cannot finish cleanup before close',async()=>{
 const child=fakeChild();let outcome:string|undefined
 const run=runRequestRaces(target).then(()=>outcome='success',error=>outcome=error.message)
 child.emit('error',new Error('synthetic process error'))
 await vi.advanceTimersByTimeAsync(100);expect(outcome).toBeUndefined()
 child.emit('close',1);await vi.advanceTimersByTimeAsync(0);await run
 expect(outcome).toBe('Session marker process error');expect(mocks.spawn).toHaveBeenCalledTimes(1)
})
test('unclosed owned child reaches hard cleanup failure after TERM/KILL without a success claim',async()=>{
 const before=process.listenerCount('SIGTERM'),child=fakeChild();let outcome:string|undefined
 const run=runRequestRaces(target).then(()=>outcome='success',error=>outcome=error.message)
 process.emit('SIGTERM');await vi.advanceTimersByTimeAsync(1_600);await run
 expect(child.kill.mock.calls.map(call=>call[0])).toEqual(['SIGTERM','SIGKILL'])
 expect(outcome).toBe('Terminal cleanup unverified for owned children: marker (pid 12345)')
 expect(child.unref).toHaveBeenCalledOnce();expect(process.listenerCount('SIGTERM')).toBe(before)
})
test('absolute watchdog routes through the same close-aware cleanup',async()=>{
 const child=fakeChild(10);let outcome:string|undefined
 const run=runRequestRaces(target).then(()=>outcome='success',error=>outcome=error.message)
 await vi.advanceTimersByTimeAsync(150_100);await run
 expect(outcome).toBe('Race deadline exceeded');expect(child.kill).toHaveBeenCalledWith('SIGTERM');expect(mocks.spawn).toHaveBeenCalledTimes(1)
})
