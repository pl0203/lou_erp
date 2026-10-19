// @vitest-environment node
import { existsSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), existsSync: vi.fn() }))
import { runEmployeeDb } from '../../scripts/test-employee-db.mjs'
import { expectRaceRejection, runReportingRaces } from '../database/employees/command-races.mjs'
import { parseConcurrencyArgs } from '../database/employees/concurrency.mjs'
const target = { PGHOST: '127.0.0.1', PGPORT: '65435', PGDATABASE: 'pilot_test', PGUSER: 'postgres' }
beforeEach(() => { vi.mocked(existsSync).mockReturnValue(true) })
describe('fixed reporting race dispatch', () => {
 it('dispatches the implemented reporting suite only through fixed files', () => {
  const execute=vi.fn(),probe=vi.fn(()=> 't')
  expect(runEmployeeDb({env:target,suite:'reporting',race:true,execute,probe})).toEqual({suites:['reporting'],race:true})
  expect(execute.mock.calls.at(-1)?.[1]).toEqual([expect.stringMatching(/\/concurrency\.mjs$/),'--suite','reporting'])
  const files=vi.mocked(existsSync).mock.calls.flat().map(String)
  expect(files.some(p=>p.endsWith('/reporting-races.mjs'))).toBe(true)
  expect(files.some(p=>p.endsWith('/command-races.mjs'))).toBe(true)
  expect(files.some(p=>p.endsWith('/employee-foundation-reporting.sql'))).toBe(true)
 })
 it('accepts only the two implemented fixed race names', () => {
  expect(parseConcurrencyArgs(['--suite','reporting'])).toBe('reporting')
  for(const name of ['reads','preservation','all','../reporting']) expect(()=>parseConcurrencyArgs(['--suite',name])).toThrow()
  expect(()=>parseConcurrencyArgs(['--suite','reporting','--file','anything.sql'])).toThrow()
 })
 it.each(['reporting-races.mjs','command-races.mjs','employee-foundation-reporting.sql'])('requires %s before probing', suffix => {
  vi.mocked(existsSync).mockImplementation(path=>!String(path).endsWith('/'+suffix))
  const probe=vi.fn(),execute=vi.fn()
  expect(()=>runEmployeeDb({env:target,suite:'reporting',race:true,probe,execute})).toThrow(/missing/)
  expect(probe).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled()
 })
 it('does not make commands-only runs depend on reporting files', () => {
  vi.mocked(existsSync).mockImplementation(path=>!String(path).includes('reporting'))
  expect(()=>runEmployeeDb({env:target,suite:'commands',race:true,probe:()=> 't',execute:vi.fn()})).not.toThrow()
 })
})

it('keeps an early unexpected race success observed until the lock barrier is checked', async () => {
 const outcome=expectRaceRejection(Promise.resolve('unexpected commit'),'22023','REPORTING_CYCLE')
 await new Promise(resolve=>setTimeout(resolve,20))
 await expect(outcome).rejects.toThrow('Expected REPORTING_CYCLE')
})
it('keeps an early wrong race error observed while retaining its failure', async () => {
 const outcome=expectRaceRejection(Promise.reject(Error('wrong error')),'22023','REPORTING_CYCLE')
 await new Promise(resolve=>setTimeout(resolve,20))
 await expect(outcome).rejects.toThrow()
})
it.each(['sql','path','script','suite'])('reporting lifecycle refuses caller %s overrides', async key => {
 const probe=vi.fn(),spawnProcess=vi.fn()
 await expect(runReportingRaces({env:target,probe,spawnProcess,[key]:'caller value'})).rejects.toThrow(/fixed/)
 expect(probe).not.toHaveBeenCalled();expect(spawnProcess).not.toHaveBeenCalled()
})
it('reporting lifecycle refuses unsafe hosts and mismatching actual markers',async()=>{
 const probe=vi.fn(()=> 'f'),spawnProcess=vi.fn()
 await expect(runReportingRaces({env:{...target,PGHOST:'remote.example'},probe,spawnProcess})).rejects.toThrow(/loopback/)
 expect(probe).not.toHaveBeenCalled()
 await expect(runReportingRaces({env:target,probe,spawnProcess})).rejects.toThrow(/marker/)
 expect(spawnProcess).not.toHaveBeenCalled()
})
