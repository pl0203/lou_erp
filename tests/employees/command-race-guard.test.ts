// @vitest-environment node
import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), existsSync: vi.fn() }))
import { runEmployeeDb } from '../../scripts/test-employee-db.mjs'
import { parseConcurrencyArgs } from '../database/employees/concurrency.mjs'
import { ChildSessions, runCommandRaces } from '../database/employees/command-races.mjs'
const target = { PGHOST: '127.0.0.1', PGPORT: '65435', PGDATABASE: 'pilot_test', PGUSER: 'postgres' }
beforeEach(() => { vi.mocked(existsSync).mockReturnValue(true) })
describe('fixed command race safety boundary', () => {
 it('dispatches commands races now without requiring future reporting SQL', () => {
  const execute=vi.fn(), probe=vi.fn(()=> 't')
  runEmployeeDb({ env: target, suite: 'commands', race: true, execute, probe })
  expect(execute.mock.calls.at(-1)?.[1]).toEqual([expect.stringMatching(/\/concurrency\.mjs$/),'--suite','commands'])
  expect(vi.mocked(existsSync).mock.calls.flat().join(' ')).not.toContain('foundation-reporting')
  expect(vi.mocked(existsSync).mock.calls.flat().join(' ')).toContain('command-races.mjs')
 })
 it('requires fixed race dependency before database activity', () => {
  vi.mocked(existsSync).mockImplementation(path=>!String(path).endsWith('/command-races.mjs'))
  const probe=vi.fn(),execute=vi.fn()
  expect(()=>runEmployeeDb({env:target,suite:'commands',race:true,probe,execute})).toThrow(/missing/)
  expect(probe).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled()
 })
 it('rejects unrelated race suite and CLI routing/path injection', () => {
  expect(parseConcurrencyArgs(['--suite','commands'])).toBe('commands')
  for(const args of [[],['--suite','reads'],['--suite','commands','file.sql'],['--file','other']]) expect(()=>parseConcurrencyArgs(args)).toThrow()
  const probe=vi.fn(),execute=vi.fn()
  expect(()=>runEmployeeDb({env:target,suite:'reads',race:true,probe,execute})).toThrow(/race/i)
  expect(probe).not.toHaveBeenCalled()
 })
 it('refuses unsafe race targets and unknown options before process creation', async () => {
  const probe=vi.fn(),spawnProcess=vi.fn()
  await expect(runCommandRaces({env:{...target,PGHOST:'remote.example'},probe,spawnProcess})).rejects.toThrow(/loopback/)
  await expect(runCommandRaces({env:target,probe,spawnProcess,sql:'arbitrary'})).rejects.toThrow(/fixed/i)
  expect(probe).not.toHaveBeenCalled();expect(spawnProcess).not.toHaveBeenCalled()
 })
 it.each(['f','', 't\nf'])('refuses a failed race fixture marker %j before installation',async marker=>{
  const probe=vi.fn(()=>marker),spawnProcess=vi.fn()
  await expect(runCommandRaces({env:target,probe,spawnProcess})).rejects.toThrow(/marker/)
  expect(spawnProcess).not.toHaveBeenCalled()
 })
 it.each(['preexisting','marker'])('refuses %s objects or changed marker before installation and reaps the guard child', async kind=>{
  const writes:string[]=[]
  const spawnProcess=vi.fn(()=>{
   const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()})
   child.kill.mockImplementation(()=>{queueMicrotask(()=>child.emit('close',null,'SIGTERM'));return true})
   child.stdin.on('data',data=>{
    const sql=String(data);writes.push(sql)
    const token=sql.match(/\\echo (EMPLOYEE_QUERY_DONE_\d+)/)?.[1]
    const result=sql.includes('NOT EXISTS(SELECT 1 FROM pg_class') || (kind==='marker' && sql.includes('current_database()'))?'f':'t'
    if(token) queueMicrotask(()=>child.stdout.write(`${result}\n${token}\n`))
   })
   return child
  })
  await expect(runCommandRaces({env:target,probe:()=> 't',spawnProcess})).rejects.toThrow()
  expect(writes.join(' ')).not.toContain('CREATE TABLE')
  expect(writes.join(' ')).not.toContain('DROP TABLE')
  expect(spawnProcess.mock.results[0].value.kill).toHaveBeenCalledWith('SIGTERM')
 })
 it('reaps a child even when its active query fails',async()=>{
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),exitCode:null,signalCode:null})
  child.kill.mockImplementation(()=>{queueMicrotask(()=>child.emit('close',null,'SIGTERM'));return true})
  const pool=new ChildSessions(target,()=>child)
  const session=pool.open('fixture')
  const pending=session.query('SELECT 1;')
  child.stderr.write('synthetic process error')
  child.emit('error',Error('synthetic child failure'))
  await expect(pending).rejects.toThrow(/synthetic/)
  await pool.close()
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  expect(pool.liveCount).toBe(0)
 })
})
