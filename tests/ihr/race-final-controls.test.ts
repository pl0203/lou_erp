import { readFileSync, existsSync } from 'node:fs'
import { expect, test } from 'vitest'
const adapter = existsSync('tests/database/ihr/race-final.mjs') ? readFileSync('tests/database/ihr/race-final.mjs','utf8') : ''
test('final race entry admits only literal fixtures and scenario names before spawning',()=>{
 for (const text of ['FINAL_RACE_SCENARIOS','validateIhrDbTarget','composed/race-fixture.sql','Unknown final race scenario','runRequestRaces','runDecisionRaces']) expect(adapter).toContain(text)
})
test('every final barrier proves the exact requested advisory key and its identified holder',()=>{
 for (const text of ['classid','objid','objsubid=1','hashtextextended','pg_blocking_pids','wait_event_type','query_start','TIME_CROSSED']) expect(adapter).toContain(text)
})
test('state proof covers source history and exact tombstones as well as transaction effects',()=>{
 const state=existsSync('tests/database/ihr/race-final-state.mjs')?readFileSync('tests/database/ihr/race-final-state.mjs','utf8'):''
 for(const text of ['requests','days','allocations','occupancy','accounts','ledger','events','commands','attempts','decisions','reversals','admin_events','policy_owners','governance_approvals','governance_references','reassignments','assertFinalOutcome']) expect(state).toContain(text)
})
test('unknown scenario and invalid target reject without a process',async()=>{
 const {runFinalRace}=await import('../database/ihr/race-final.mjs')
 await expect(runFinalRace({PGHOST:'127.0.0.1',PGUSER:'postgres',PGDATABASE:'pilot_test'},'anything')).rejects.toThrow('Unknown final race scenario')
 await expect(runFinalRace({PGHOST:'hosted.example.invalid',PGUSER:'postgres',PGDATABASE:'pilot_test'},'calendar_then_submit')).rejects.toThrow('Explicit loopback')
})
test('final binding preserves the original negative seed and uses a dedicated employee8 positive race fixture',()=>{
 const seed=readFileSync('tests/database/ihr/composed/quote-seed.sql','utf8'),positive=readFileSync('tests/database/ihr/composed/race-core-fixture.sql','utf8')
 expect(seed).toContain('Employee 8 deliberately retains missing coverage')
 expect(positive).toContain('Positive race-only coverage for employee8')
 expect(positive.indexOf('Positive race-only')).toBeLessThan(positive.indexOf('private.ihr_leave_quote_v1'))
})
test('all required scenario selectors are literal and unique, including domain-wait clock expiry',async()=>{
 const {FINAL_RACE_SCENARIOS}=await import('../database/ihr/race-final.mjs')
 expect(FINAL_RACE_SCENARIOS).toHaveLength(27);expect(new Set(FINAL_RACE_SCENARIOS).size).toBe(27)
 for(const scenario of ['core','decisions','calendar_then_submit','submit_then_calendar','roster_then_submit','submit_then_roster','different_actors_same_key','different_account_independence','adjust_then_submit','submit_then_adjust','decision_then_reconcile','cancellation_then_reconcile','abandon_then_submit','submit_then_abandon','assignment_revoked_command_wait','assignment_revoked_assignment_wait','grant_revoked_account_wait','grant_expires_command_wait','assignment_expires_command_wait','grant_expires_account_wait','assignment_expires_account_wait','reconcile_actor_revoked_command_wait','replay_grant_revoked_command_wait','reconcile_grant_revoked_command_wait','reconcile_abandoned_false_actor_revoked_command_wait','reconcile_abandoned_true_actor_revoked_command_wait','reconcile_committed_actor_revoked_command_wait'])expect(FINAL_RACE_SCENARIOS).toContain(scenario)
})
test('independence proves the first actual waiter reaches its specific blocked account or actor/key',()=>{
 expect(adapter).toContain("await barrier(waiter.pid,holder.pid,lockKey)")
 expect(adapter).toContain("'first-account-waiter'")
 expect(adapter).toContain("lockProof(0,holder.pid,lockKey,false)")
 expect(adapter).toContain("scenario==='different_actors_same_key'?20:21")
})
test('global fixture governance explicitly names the full fictional audience without rewriting earlier approvals',()=>{
 const source=readFileSync('tests/database/ihr/composed/race-governance-seed.sql','utf8')
 for(const n of [1,2,3,7,8,18])expect(source).toContain('71000000-0000-0000-0000-'+String(n).padStart(12,'0'))
 expect(source).toContain('INSERT INTO private.ihr_leave_governance_approvals')
 expect(source).toContain('max(version),0)+1');expect(source).not.toMatch(/UPDATE\s+private\.ihr_leave_governance/)
})
test('both roster orderings capture the owner fixture date and verify independent preview rows before using its fingerprint',()=>{
 const roster=adapter.slice(adapter.indexOf('      if(roster) {'),adapter.indexOf("    } else if(scenario==='adjust_then_submit'"))
 expect(roster.indexOf('admin.rosterSaturday=settings.saturday')).toBeLessThan(roster.indexOf("await app('roster-preview'"))
 expect(roster.indexOf('assertFinalRosterPreview(admin.preview,admin.rosterSaturday)')).toBeGreaterThan(roster.indexOf("admin.preview=parsed(await preview.finish(),'preview')"))
 expect(roster.indexOf('assertFinalRosterPreview(admin.preview,admin.rosterSaturday)')).toBeLessThan(roster.indexOf('preview_fingerprint:admin.preview.fingerprint'))
 expect(roster).toContain("if(scenario.startsWith('submit')) await pair(submit,admin)")
 expect(roster).toContain("else await pair(admin,submit,{sqlstate:'55000',code:'STALE_QUOTE'})")
 const state=readFileSync('tests/database/ihr/race-final-state.mjs','utf8')
 expect(state).toContain("const added=additions(before,after,'roster',2)")
 expect(state).not.toContain("additions(before,after,'roster',c.preview.rows.length)")
 expect(state).not.toContain('for(const d of c.preview.rows)')
})
