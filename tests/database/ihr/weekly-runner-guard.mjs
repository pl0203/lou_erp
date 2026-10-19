import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
const moduleUrl = new URL('../../../scripts/test-ihr-weekly-db.mjs', import.meta.url)
test('weekly runner exists before execution and rejects unsafe targets without process calls', async () => {
 assert.ok(existsSync(moduleUrl), 'guarded weekly runner must exist')
 const { runWeeklyDb } = await import(moduleUrl)
 for (const env of [
  { PGHOST:'db.example.invalid',PGDATABASE:'weekly_leave_test',PGUSER:'postgres' },
  { PGHOST:'127.0.0.1',PGDATABASE:'production',PGUSER:'postgres' },
  { PGHOST:'127.0.0.1',PGDATABASE:'weekly_leave_test',PGUSER:'app_user' },
  { PGHOST:'127.0.0.1',PGDATABASE:'weekly_leave_test',PGUSER:'postgres',PGPORT:'5432 --command' },
 ]) {
  let calls=0; assert.throws(()=>runWeeklyDb({env,probe:()=>{calls++},execute:()=>{calls++}}));assert.equal(calls,0)
 }
})
test('missing or uncertain fixture marker never reaches candidate execution', async () => {
 const { runWeeklyDb } = await import(moduleUrl)
 for(const value of ['f','',undefined]) {
  let executed=0
  assert.throws(()=>runWeeklyDb({env:{PGHOST:'127.0.0.1',PGDATABASE:'weekly_leave_test',PGUSER:'postgres'},probe:()=>value,execute:()=>{executed++}}))
  assert.equal(executed,0)
 }
})
test('runner pins the database, clears inherited connection overrides and rolls source/tests back', async () => {
 const { runWeeklyDb } = await import(moduleUrl)
 const calls=[]
 runWeeklyDb({env:{PGHOST:'127.0.0.1',PGDATABASE:'weekly_leave_test',PGUSER:'postgres',PGSERVICE:'hosted',PGOPTIONS:'-c role=postgres'},probe:()=> 't\n',execute:(cmd,args,options)=>calls.push({cmd,args,options})})
 assert.equal(calls.length,1)
 assert.equal(calls[0].cmd,'psql');assert.ok(calls[0].args.includes('weekly_leave_test'))
 assert.equal(calls[0].options.env.PGSERVICE,undefined)
 assert.match(calls[0].options.input,/^BEGIN;/)
 assert.doesNotMatch(calls[0].options.input,/^COMMIT;/m)
 assert.match(calls[0].options.input,/IHR_WEEKLY_CALENDAR_PASSED/)
 assert.equal((calls[0].options.input.match(/^BEGIN;/gm)||[]).length,1)
 assert.equal((calls[0].options.input.match(/^ROLLBACK;/gm)||[]).length,1)
})
