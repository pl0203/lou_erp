// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect,test,vi } from 'vitest'
import { helperRaceConnection,runHelperRaceAcceptance } from '../../scripts/test-helper-races-ci.mjs'
import { buildHelperRaceLifecycle } from './can-read-po-experiment.mjs'
const env={PATH:'/usr/bin:/bin',PGHOST:'127.0.0.1',PGDATABASE:'pilot_test',PGUSER:'postgres',PGPASSWORD:'synthetic-only',SCALE_ROWS:'6000',SCALE_PERMIT:'disposable-pilot-ci',CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_RUN_ID:'123',PGHOSTADDR:'outside.invalid',PGSERVICE:'outside',PGOPTIONS:'-c role=service_role'}
test('candidate races refuse non-CI or non-loopback targets before execution',()=>{
 for(const patch of [{CI:'false'},{GITHUB_REPOSITORY:'other/repo'},{PGHOST:'remote.invalid'},{PGDATABASE:'postgres'},{SCALE_ROWS:'30000'}])expect(()=>helperRaceConnection({...env,...patch})).toThrow()
 const connection=helperRaceConnection(env);expect(connection.PGHOSTADDR).toBeUndefined();expect(connection.PGSERVICE).toBeUndefined();expect(connection.PGOPTIONS).toBeUndefined()
})
function runner(raceFailure=false,missingRaceMarker=false,mode='normal'){
 const lifecycle=buildHelperRaceLifecycle('a'.repeat(32));let candidate=false;const events:string[]=[]
 let dirty=false,unknown=false
 const execute=vi.fn((binary:string,args:string[],options:any)=>{
  if(binary==='psql'){
   const s=String(options.input??'')
   if(args.some(a=>a.startsWith('--file='))){if(mode==='suite-failure')throw new Error('Suite failed');return args.find(a=>a.includes('HELPER_COMPAT_SUITE_PASSED '))!.match(/SELECT '(HELPER_COMPAT_SUITE_PASSED [^']+)';/)![1]+'\n'}
   if(s.includes("'HELPER_RACE_STATE'"))return JSON.stringify({marker:'HELPER_RACE_STATE',catalog_md5:(candidate?'b':'a').repeat(32),normalized_catalog_md5:(dirty?'d':'a').repeat(32),helper_source_md5:unknown?'e'.repeat(32):candidate?lifecycle.candidateHash:lifecycle.originalHash,buckets_md5:'c'.repeat(32)})
   if(s.includes('HELPER_RACE_CANDIDATE_COMMITTED')){events.push('install');candidate=true;if(mode==='lost-install-response')throw new Error('Lost commit response');return 'HELPER_RACE_CANDIDATE_COMMITTED\n'}
   if(s.includes("SELECT 'HELPER_RACE_RESTORED'")){events.push('restore');if(mode==='restore-failure')throw new Error('Restore failure');candidate=false;return 'HELPER_RACE_RESTORED\n'}
   if(s.includes('HELPER_RACE_EMPTY_VERIFIED'))return 'HELPER_RACE_EMPTY_VERIFIED\n'
  }
  events.push('races');if(mode==='drift-after-races')dirty=true;if(mode==='unknown-body-after-races')unknown=true;if(mode==='nonzero-with-marker')throw Object.assign(new Error('Nonzero race exit'),{stdout:'PASS all twelve normal-session concurrency scenarios\n'});if(raceFailure)throw new Error('Synthetic race failure');return missingRaceMarker?'incomplete':'PASS all twelve normal-session concurrency scenarios\n'
 })
 return {execute,events,evidenceDir:mkdtempSync(join(tmpdir(),'helper-race-test-'))}
}
test('candidate is committed before cross-session races and exactly restored afterward',()=>{
 const r=runner();expect(runHelperRaceAcceptance({env,...r})).toMatchObject({restored:true,racesPassed:true});expect(r.events).toEqual(['install','races','restore'])
})
test.each([[true,false],[false,true]])('race failure or missing success marker still restores and fails the gate', (failed,missing)=>{
 const r=runner(failed,missing);expect(()=>runHelperRaceAcceptance({env,...r})).toThrow();expect(r.events).toEqual(['install','races','restore'])
})
test('lost install response reconciles known committed candidate and restores without running races',()=>{
 const r=runner(false,false,'lost-install-response');expect(()=>runHelperRaceAcceptance({env,...r})).toThrow('Lost commit response');expect(r.events).toEqual(['install','restore'])
})
test('successful races cannot mask restoration failure or unexpected metadata drift',()=>{
 const r=runner(false,false,'restore-failure');expect(()=>runHelperRaceAcceptance({env,...r})).toThrow('Restore failure');expect(r.events).toEqual(['install','races','restore'])
 const drift=runner(false,false,'drift-after-races');expect(()=>runHelperRaceAcceptance({env,...drift})).toThrow('restoration refused');expect(drift.events).toEqual(['install','races'])
})
test('all fifteen unchanged SQL compatibility suites run under the committed candidate before races',()=>{
 const r=runner();runHelperRaceAcceptance({env,...r})
 const suites=r.execute.mock.calls.filter(call=>call[1].some(a=>a.startsWith('--file=')))
 expect(suites).toHaveLength(15)
 for(const [,args,options] of suites){expect(args).toContain("--command=SET statement_timeout='60s'; SET lock_timeout='5s'; SET TIME ZONE 'UTC';");expect(options.timeout).toBe(120000)}
 expect(suites.some(call=>call[1].includes('--file=tests/database/scalable-index.sql'))).toBe(true)
})
test('suite failure or nonzero race exit cannot be hidden by success text',()=>{
 const suite=runner(false,false,'suite-failure');expect(()=>runHelperRaceAcceptance({env,...suite})).toThrow('Suite failed');expect(suite.events).toEqual(['install','restore'])
 const exit=runner(false,false,'nonzero-with-marker');expect(()=>runHelperRaceAcceptance({env,...exit})).toThrow('Nonzero race exit');expect(exit.events).toEqual(['install','races','restore'])
})
test('unknown helper body during cleanup is never overwritten',()=>{
 const r=runner(false,false,'unknown-body-after-races');expect(()=>runHelperRaceAcceptance({env,...r})).toThrow('Unknown helper body');expect(r.events).toEqual(['install','races'])
})
