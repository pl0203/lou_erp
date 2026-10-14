import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateBinding } from './core.mjs';

export const caseNames=Object.freeze([
 'blocking_negative_reverse_raw_targets',
 'nowait_reverse_raw_targets',
 'target_business_crossing_fails_at_evidence',
 'absent_key_creation_and_tombstone_refusal',
 'forced_hash_collision_is_conservative',
 'all_representative_evidence_entrypoints_refuse_holder',
 'missing_identity_and_evidence_relation_contention',
 'target_insert_wins_delete_race',
 'guarded_delete_wins_target_insert_race',
 'target_update_delete_keep_lifetime_evidence',
 'repeatable_read_stale_unused_snapshot_refuses',
 'actual_events_raw_authority_and_conflict_replay',
 'savepoint_and_forced_assertion_preserve_atomicity',
 'authorized_synthetic_cascade_retains_old_reference',
 'wider_master_fk_deadlock_boundary_is_not_hidden',
]);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const list=(value,limit)=>{assert.ok(Array.isArray(value)&&value.length<=limit);for(let index=0;index<value.length;index++)assert.ok(Object.hasOwn(value,index));return value;};
const integer=value=>{assert.ok(Number.isSafeInteger(value)&&value>0);return value;};
const state=value=>{assert.match(value??'',/^[A-Z0-9]{5}$/);return value;};
const elapsed=value=>{assert.ok(Number.isFinite(value)&&value>=0&&value<=120000);return Math.round(value*1000)/1000;};
const choice=(value,values)=>{assert.ok(values.includes(value));return value;};
const result=value=>({sqlstate:state(value.sqlstate),elapsedMs:elapsed(value.elapsedMs)});
function wait(value) {
 return {
  pid:integer(value.pid),blockers:list(value.blockers,100).map(integer),
  waitingForLock:value.waitingForLock===true || value.wait_event_type==='Lock',
  locks:list(value.locks,1000).map(lock=>({
   locktype:choice(lock.locktype,['relation','extend','frozenid','page','tuple','transactionid','virtualxid','spectoken','object','userlock','advisory','applytransaction']),
   mode:choice(lock.mode,['AccessShareLock','RowShareLock','RowExclusiveLock','ShareUpdateExclusiveLock','ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock','SIReadLock']),
   granted:choice(lock.granted,[true,false]),
  })),
 };
}
function observation(value) {
 const keys=Object.keys(value);assert.equal(keys.length,1);
 switch(keys[0]) {
  case 'barrier':return {barrier:wait(value.barrier)};
  case 'fkBarrier':return {fkBarrier:wait(value.fkBarrier)};
  case 'cycle':assert.equal(value.cycle.length,2);return {cycle:list(value.cycle,2).map(wait)};
  case 'results':assert.equal(value.results.length,2);return {results:list(value.results,2).map(result)};
  case 'fastRefusal':return {fastRefusal:{...result(value.fastRefusal),observed:list(value.fastRefusal.observed,1000).map(wait)}};
  default:throw new Error('SYNTHETIC_OBSERVATION_REFUSED');
 }
}
export function publicResult(report,binding) {
 validateBinding(binding);
 const status=choice(report.status,['BOUNDED_REPRESENTATIVE_CASES_PASSED','FAILED_OR_INCONCLUSIVE']);
 const cases=list(report.cases,caseNames.length).map((entry,index)=>{
  assert.equal(entry.name,caseNames[index]);
  return {name:entry.name,status:choice(entry.status,['PASSED','FAILED','RUNNING']),observations:list(entry.observations,1000).map(observation)};
 });
 if(status==='BOUNDED_REPRESENTATIVE_CASES_PASSED') {
  assert.equal(cases.length,caseNames.length);assert.ok(cases.every(entry=>entry.status==='PASSED'));
 }
 const {source,ci,runIdentity,serverAddress,serverPort,serverVersion,systemIdentifier}=binding.identity;
 for(const value of [ci.runId,ci.runAttempt])assert.match(value??'',/^[1-9][0-9]*$/);
 assert.match(ci.eventSha??'',/^[a-f0-9]{40}$/);
 const safe={format:'synthetic-failfast-report-v1',scope:'generic-synthetic-only',status,
  source:{commit:source.commit,tree:source.tree,candidate:source.candidate,clean:true},
  run:{id:ci.runId,attempt:ci.runAttempt,eventSha:ci.eventSha,fixture:runIdentity},
  identitySha256:hash(binding.identity),clusterSha256:hash({serverAddress,serverPort,serverVersion,systemIdentifier}),
  files:Object.fromEntries(Object.entries(binding.files).sort(([a],[b])=>a.localeCompare(b))),cases,
 };
 assert.ok(Buffer.byteLength(JSON.stringify(safe))<=256*1024,'SYNTHETIC_RESULT_BOUND_EXCEEDED');
 return safe;
}
