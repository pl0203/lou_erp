import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {installReturnCurrentFunctions,buildReturnCurrentFunctions} from '../../../scripts/co-return-current-functions.mjs'
const read=p=>readFileSync(new URL('../../../'+p,import.meta.url),'utf8')
test('current baseline uses original pinned SJ source and only two private director helpers',()=>{
 const built=buildReturnCurrentFunctions({read})
 assert.equal(built.sj,read('supabase/migrations/202610190001_sj_received_date.sql'))
 assert.equal(createHash('sha256').update(built.sj).digest('hex'),'df12f5038996fc57f5df7cf7562c46ec35ac8c0be8991a05e4fe4663599d0826')
 assert.equal((built.helpers.match(/CREATE FUNCTION private\./g)||[]).length,2)
 assert.doesNotMatch(built.helpers,/CREATE FUNCTION public\.|CREATE OR REPLACE|INSERT INTO|UPDATE public|DELETE FROM|CREATE POLICY|ALTER TABLE/)
 assert.match(built.helpers,/REVOKE ALL ON FUNCTION private\.ihr_leave_require_director\(\),private\.ihr_leave_director_target\(uuid\) FROM PUBLIC,anon,authenticated,service_role;/)
 assert.match(built.guard,/current_database\(\)<>'pilot_co_test'/)
 assert.match(built.guard,/execution_generation=1 AND NOT tracking_ready/)
 assert.match(built.helpers,/Director helper postimage drift/)
})
test('all fixed sources validate before any SQL and source drift is rejected',()=>{
 for(const target of ['supabase/migrations/202610190001_sj_received_date.sql','sql/director-oversight-review.sql']){
  let executed=false
  assert.throws(()=>installReturnCurrentFunctions({read:p=>read(p)+(p===target?'-- drift':''),run:()=>{executed=true},verify:()=>{executed=true}}),/source changed/)
  assert.equal(executed,false)
 }
})
test('guard then unchanged migration then exact helpers are separated by caller identity verification',()=>{
 const events=[];const built=buildReturnCurrentFunctions({read})
 installReturnCurrentFunctions({read,verify:()=>events.push('verify'),run:sql=>events.push(sql)})
 assert.deepEqual(events,['verify',built.guard,'verify',built.sj,'verify',built.helpers,'verify'])
 let calls=0
 assert.throws(()=>installReturnCurrentFunctions({read,verify:()=>{},run:()=>{calls++;throw Error('profile guard')}}),/profile guard/)
 assert.equal(calls,1)
})
