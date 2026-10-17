import assert from 'node:assert/strict';
const A="'10000000-0000-0000-0000-000000000001'";
export const id=n=>`'00000000-0000-0000-0000-${String(n).padStart(12,'0')}'`;
const ins=(s,n,p,value=1,extra='')=>`INSERT INTO ${s}.target(master_id,period,target_value,set_by) VALUES(${id(n)},'${p}',${value},${A}) ${extra};`;
const ok=async(s,q)=>{const r=await s.query(q);assert.equal(r.sqlstate,'00000',JSON.stringify(r));return r;};
const state=async(s,q,code)=>{const r=await s.query(q);assert.equal(r.sqlstate,code,JSON.stringify(r));return r;};
export async function runScenarios(c) {
 const {test,session,begin,rollback,commit,scalar,observe,blocked,fast,cycle,record}=c;
 await test('blocking_negative_reverse_raw_targets',async()=>{
  const s='ff_blocking',a=await session('neg_a'),b=await session('neg_b');
  await begin(a);await begin(b);await ok(a,ins(s,1,'first'));await ok(b,ins(s,2,'first'));
  const ar=a.query(ins(s,2,'second'));await blocked(a,b);const br=b.query(ins(s,1,'second'));
  await cycle(a,b);const results=await Promise.all([ar,br]);assert.deepEqual(results.map(x=>x.sqlstate).sort(),['00000','40P01']);record({results});
  await rollback(a);await rollback(b);
  assert.equal(await scalar(`SELECT count(*) FROM ${s}.target`),'0');assert.equal(await scalar(`SELECT count(*) FROM ${s}.identity_evidence WHERE lifetime_used`),'0');
 });
 await test('nowait_reverse_raw_targets',async()=>{
  const s='ff_nowait',a=await session('rev_a'),b=await session('rev_b');await begin(a);await begin(b);await ok(a,ins(s,1,'first'));await ok(b,ins(s,2,'first'));
  await fast(a,ins(s,2,'second'),'55P03');await rollback(a);await ok(b,ins(s,1,'second'));await commit(b);
  assert.equal(await scalar(`SELECT count(*) FROM ${s}.target`),'2');assert.equal(await scalar(`SELECT count(*) FROM ${s}.identity_evidence WHERE id IN (${id(1)},${id(2)}) AND lifetime_used AND version=1`),'2');
 });
 await test('target_business_crossing_fails_at_evidence',async()=>{
  const s='ff_nowait',a=await session('cross_a'),b=await session('cross_b');await begin(a);await begin(b);await ok(a,ins(s,16,'cross'));await ok(b,`UPDATE ${s}.business SET value=value+1 WHERE id=1;`);
  const ar=a.query(`UPDATE ${s}.business SET value=value+1 WHERE id=1;`);await blocked(a,b);await fast(b,ins(s,16,'cross_other'),'55P03');assert.equal((await ar).sqlstate,'00000');await rollback(a);await rollback(b);
  assert.equal(await scalar(`SELECT value FROM ${s}.business WHERE id=1`),'0');assert.equal(await scalar(`SELECT lifetime_used::int FROM ${s}.identity_evidence WHERE id=${id(16)}`),'0');
 });
 await test('absent_key_creation_and_tombstone_refusal',async()=>{
  const s='ff_nowait',a=await session('create_a'),b=await session('create_b');await begin(a);await begin(b);await ok(a,`INSERT INTO ${s}.master VALUES(${id(101)},'supplied synthetic key');`);await fast(b,`INSERT INTO ${s}.master VALUES(${id(101)},'contender');`,'55P03');await rollback(b);await commit(a);
  assert.equal(await scalar(`SELECT provenance||':'||lifetime_used FROM ${s}.identity_evidence WHERE id=${id(101)}`),'unknown:false');
  await begin(a);await ok(a,`SELECT ${s}.delete_unused(${id(3)});`);await commit(a);await begin(b);await state(b,`INSERT INTO ${s}.master VALUES(${id(3)},'reuse');`,'P1002');await rollback(b);
  assert.equal(await scalar(`SELECT tombstone::int FROM ${s}.identity_evidence WHERE id=${id(3)}`),'1');assert.equal(await scalar(`SELECT count(*) FROM ${s}.master WHERE id=${id(3)}`),'0');
 });
 await test('forced_hash_collision_is_conservative',async()=>{
  const s='ff_collision',a=await session('collision_a'),b=await session('collision_b');await begin(a);await begin(b);await ok(a,`INSERT INTO ${s}.master VALUES(${id(103)},'key a');`);await fast(b,`INSERT INTO ${s}.master VALUES(${id(104)},'distinct key b');`,'55P03');await rollback(b);await commit(a);
  assert.equal(await scalar(`SELECT count(*) FROM ${s}.identity_evidence WHERE id=${id(104)}`),'0');await begin(b);await ok(b,`INSERT INTO ${s}.master VALUES(${id(104)},'retry after owner finishes');`);await commit(b);assert.equal(await scalar(`SELECT count(*) FROM ${s}.identity_evidence WHERE id IN (${id(103)},${id(104)}) AND provenance='unknown'`),'2');
 });
 await test('all_representative_evidence_entrypoints_refuse_holder',async()=>{
  const s='ff_nowait',a=await session('entry_a'),b=await session('entry_b');await begin(a);await ok(a,`SELECT ${s}.evidence_lock(1::smallint,${id(21)});`);
  for(const q of [ins(s,21,'entry'),`UPDATE ${s}.master SET label='must roll back' WHERE id=${id(21)};`,`SELECT ${s}.delete_unused(${id(21)});`,`INSERT INTO ${s}.master VALUES(${id(21)},'must not reuse');`]){await begin(b);await fast(b,q,'55P03');await rollback(b);}
  await rollback(a);assert.equal(await scalar(`SELECT version FROM ${s}.identity_evidence WHERE id=${id(21)}`),'0');assert.equal(await scalar(`SELECT label FROM ${s}.master WHERE id=${id(21)}`),'synthetic-21');assert.equal(await scalar(`SELECT count(*) FROM ${s}.target WHERE master_id=${id(21)}`),'0');
  await begin(a);await ok(a,`SELECT ${s}.evidence_lock(1::smallint,${id(1)});`);
  for(const q of [`UPDATE ${s}.target SET target_value=8 WHERE master_id=${id(1)};`,`DELETE FROM ${s}.target WHERE master_id=${id(1)};`]){await begin(b,'READ COMMITTED',true);await fast(b,q,'55P03');await rollback(b);}
  await rollback(a);assert.equal(await scalar(`SELECT count(*) FROM ${s}.target WHERE master_id=${id(1)} AND target_value=1`),'1');assert.equal(await scalar(`SELECT version FROM ${s}.identity_evidence WHERE id=${id(1)}`),'1');
 });
 await test('missing_identity_and_evidence_relation_contention',async()=>{
  const s='ff_nowait',a=await session('rel_a'),b=await session('rel_b');await begin(a);await state(a,ins(s,30,'missing'),'P1001');await rollback(a);assert.equal(await scalar(`SELECT count(*) FROM ${s}.identity_evidence WHERE id=${id(30)}`),'0');
  await begin(a);await ok(a,`LOCK TABLE ${s}.identity_evidence IN SHARE MODE;`);await begin(b);await fast(b,ins(s,4,'relation'),'55P03');await rollback(b);await rollback(a);
  assert.equal(await scalar(`SELECT count(*) FROM ${s}.target WHERE master_id IN (${id(4)},${id(30)})`),'0');assert.equal(await scalar(`SELECT version FROM ${s}.identity_evidence WHERE id=${id(4)}`),'0');
 });
 await test('target_insert_wins_delete_race',async()=>{
  const s='ff_nowait',a=await session('ref_a'),b=await session('ref_b');await begin(a);await begin(b);await ok(a,ins(s,5,'reference_wins'));const br=b.query(`SELECT ${s}.delete_unused(${id(5)});`);await blocked(b,a);await commit(a);assert.equal((await br).sqlstate,'P1003');await rollback(b);
  assert.equal(await scalar(`SELECT count(*) FROM ${s}.target WHERE master_id=${id(5)}`),'1');assert.equal(await scalar(`SELECT lifetime_used::int FROM ${s}.identity_evidence WHERE id=${id(5)}`),'1');
 });
 await test('guarded_delete_wins_target_insert_race',async()=>{
  const s='ff_nowait',a=await session('del_a'),b=await session('del_b');await begin(a);await begin(b);await ok(a,`SELECT ${s}.delete_unused(${id(6)});`);let result;const br=b.query(ins(s,6,'delete_wins')).then(r=>(result=r));
  const deadline=Date.now()+1800;let edge;
  while(!result&&Date.now()<deadline){const o=await observe(b);if(o.blockers.includes(a.pid)){edge=o;break;}await c.pause(10);}
  assert.ok(result||edge,'Neither explicit refusal nor a real FK barrier was observed');if(edge)record({fkBarrier:edge});await commit(a);await br;assert.ok(['23503','55P03'].includes(result.sqlstate));await rollback(b);
  assert.equal(await scalar(`SELECT count(*) FROM ${s}.target WHERE master_id=${id(6)}`),'0');assert.equal(await scalar(`SELECT tombstone::int FROM ${s}.identity_evidence WHERE id=${id(6)}`),'1');
 });
 await test('target_update_delete_keep_lifetime_evidence',async()=>{
  const s='ff_nowait',a=await session('mutation_a'),b=await session('mutation_b');await begin(a);await ok(a,ins(s,7,'mutate'));await commit(a);
  for(const q of [`UPDATE ${s}.target SET target_value=target_value WHERE master_id=${id(7)};`,`DELETE FROM ${s}.target WHERE master_id=${id(7)};`]){await begin(a);await begin(b);await ok(a,q);await fast(b,`SELECT ${s}.delete_unused(${id(7)});`,'55P03');await rollback(b);await commit(a);}
  await begin(b);await state(b,`SELECT ${s}.delete_unused(${id(7)});`,'P1004');await rollback(b);assert.equal(await scalar(`SELECT count(*) FROM ${s}.target WHERE master_id=${id(7)}`),'0');assert.equal(await scalar(`SELECT lifetime_used::int FROM ${s}.identity_evidence WHERE id=${id(7)}`),'1');
 });
 await test('repeatable_read_stale_unused_snapshot_refuses',async()=>{
  const s='ff_nowait',a=await session('rr_a'),b=await session('rr_b');await begin(a,'REPEATABLE READ');assert.equal((await ok(a,`SELECT lifetime_used::int FROM ${s}.identity_evidence WHERE id=${id(8)};`)).stdout.trim(),'0');await begin(b);await ok(b,ins(s,8,'rr'));await ok(b,`DELETE FROM ${s}.target WHERE master_id=${id(8)};`);await commit(b);
  await state(a,`SELECT ${s}.delete_unused(${id(8)});`,'40001');await rollback(a);assert.equal(await scalar(`SELECT lifetime_used::int FROM ${s}.identity_evidence WHERE id=${id(8)}`),'1');assert.equal(await scalar(`SELECT count(*) FROM ${s}.master WHERE id=${id(8)}`),'1');
 });
 await test('actual_events_raw_authority_and_conflict_replay',async()=>{
  const s='ff_nowait',a=await session('actual_a');const version=()=>scalar(`SELECT version FROM ${s}.identity_evidence WHERE id=${id(9)}`);
  await begin(a, 'READ COMMITTED', true);await ok(a,`INSERT INTO ${s}.target(id,master_id,period,target_value,set_by) VALUES(${id(1009)},${id(9)},'actual',1,${A});`);await commit(a);assert.equal(await version(),'1');
  await begin(a,'READ COMMITTED',true);await ok(a,`INSERT INTO ${s}.target(id,master_id,period,target_value,set_by) VALUES(${id(1009)},${id(10)},'discarded',1,${A}) ON CONFLICT DO NOTHING;`);await commit(a);assert.equal(await scalar(`SELECT version FROM ${s}.identity_evidence WHERE id=${id(10)}`),'0');assert.equal(await version(),'1');
  await begin(a,'READ COMMITTED',true);await ok(a,ins(s,9,'actual',1,'ON CONFLICT(master_id,period) DO UPDATE SET target_value=EXCLUDED.target_value'));await commit(a);assert.equal(await version(),'2');
  await begin(a,'READ COMMITTED',true);await state(a,`INSERT INTO ${s}.target(master_id,period,target_value,set_by) VALUES(${id(9)},'actual',2,${A}),(${id(9)},'actual',3,${A}) ON CONFLICT(master_id,period) DO UPDATE SET target_value=EXCLUDED.target_value;`,'21000');await rollback(a);assert.equal(await version(),'2');
  await begin(a,'READ COMMITTED',true);await state(a,`UPDATE ${s}.target SET master_id=${id(10)} WHERE master_id=${id(9)};`,'42501');await rollback(a);assert.equal(await version(),'2');
  await begin(a,'READ COMMITTED',true);await state(a,ins(s,10,'not_null','NULL'),'23502');await rollback(a);assert.equal(await scalar(`SELECT version FROM ${s}.identity_evidence WHERE id=${id(10)}`),'0');
  await begin(a,'READ COMMITTED',true);await ok(a,`UPDATE ${s}.target SET target_value=target_value WHERE master_id=${id(9)};`);await ok(a,`DELETE FROM ${s}.target WHERE master_id=${id(9)};`);await commit(a);assert.equal(await version(),'4');assert.equal(await scalar(`SELECT lifetime_used::int FROM ${s}.identity_evidence WHERE id=${id(9)}`),'1');
  assert.equal(await scalar(`SELECT has_table_privilege('authenticated','${s}.target','SELECT') AND has_table_privilege('authenticated','${s}.target','INSERT') AND has_table_privilege('authenticated','${s}.target','UPDATE') AND has_table_privilege('authenticated','${s}.target','DELETE')`),'t');
 });
 await test('savepoint_and_forced_assertion_preserve_atomicity',async()=>{
  const s='ff_nowait',a=await session('save_a');await begin(a);await ok(a,ins(s,11,'keep'));await ok(a,'SAVEPOINT local_work;');await ok(a,ins(s,12,'undo'));await ok(a,'ROLLBACK TO SAVEPOINT local_work;');await ok(a,'SET CONSTRAINTS ALL IMMEDIATE;');await commit(a);
  assert.equal(await scalar(`SELECT lifetime_used::int||':'||version FROM ${s}.identity_evidence WHERE id=${id(11)}`),'1:1');assert.equal(await scalar(`SELECT lifetime_used::int||':'||version FROM ${s}.identity_evidence WHERE id=${id(12)}`),'0:0');assert.equal(await scalar(`SELECT count(*) FROM ${s}.target WHERE master_id=${id(12)}`),'0');
  await begin(a);await ok(a,`ALTER TABLE ${s}.target DISABLE TRIGGER zz_target_actual_event;`);await ok(a,ins(s,20,'assert_missing'));await state(a,'SET CONSTRAINTS ALL IMMEDIATE;','P1005');await rollback(a);
  assert.equal(await scalar(`SELECT version FROM ${s}.identity_evidence WHERE id=${id(20)}`),'0');assert.equal(await scalar(`SELECT count(*) FROM ${s}.target WHERE master_id=${id(20)}`),'0');assert.equal(await scalar(`SELECT tgenabled FROM pg_trigger WHERE tgrelid='${s}.target'::regclass AND tgname='zz_target_actual_event'`),'O');
 });
 await test('authorized_synthetic_cascade_retains_old_reference',async()=>{
  const s='ff_nowait',a=await session('cascade_a');await begin(a);await ok(a,ins(s,13,'cascade'));await commit(a);await begin(a);await ok(a,`DELETE FROM ${s}.master WHERE id=${id(13)};`);await commit(a);
  assert.equal(await scalar(`SELECT lifetime_used::int||':'||tombstone::int||':'||version FROM ${s}.identity_evidence WHERE id=${id(13)}`),'1:1:3');assert.equal(await scalar(`SELECT count(*) FROM ${s}.target WHERE master_id=${id(13)}`),'0');
 });
 await test('wider_master_fk_deadlock_boundary_is_not_hidden',async()=>{
  const s='ff_nowait',a=await session('wide_a'),b=await session('wide_b');await begin(a);await begin(b);await ok(a,ins(s,14,'wide'));await ok(b,`SELECT ${s}.delete_unused(${id(15)});`);const br=b.query(`SELECT ${s}.delete_unused(${id(14)});`);await blocked(b,a);const ar=a.query(`UPDATE ${s}.master SET label='wide attempt' WHERE id=${id(15)};`);await cycle(a,b);
  const results=await Promise.all([ar,br]);assert.deepEqual(results.map(r=>r.sqlstate).sort(),['00000','40P01']);record({results});await rollback(a);await rollback(b);
  assert.equal(await scalar(`SELECT count(*) FROM ${s}.master WHERE id IN (${id(14)},${id(15)})`),'2');assert.equal(await scalar(`SELECT count(*) FROM ${s}.identity_evidence WHERE id IN (${id(14)},${id(15)}) AND NOT lifetime_used AND NOT tombstone`),'2');
 });
}
