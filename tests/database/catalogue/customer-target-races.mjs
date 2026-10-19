// AUTHORED, UNRUN. No connection creation, configuration reading or auto-run.
// An independently approved synthetic harness supplies three distinct pg clients
// and precommitted fictional fixture identities/actor. Candidate installed first.
import assert from 'node:assert/strict';

async function begin(client, actor) {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='1500ms'"); // watchdog, NEVER success evidence
  await client.query('SET LOCAL ROLE authenticated');
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor]);
}
async function mark(client, customer, actor, month) {
  return client.query('INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES($1,$2,$3)', [customer,month,actor]);
}
async function distinctBackends(a,b,observer) {
  assert.notEqual(a,b); assert.notEqual(a,observer); assert.notEqual(b,observer);
  const pids=await Promise.all([a,b,observer].map(async client=>(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
  assert.ok(pids.every(pid=>Number.isSafeInteger(pid)&&pid>0));
  assert.equal(new Set(pids).size,3,'Distinct actual server backends required');
  return pids;
}
async function heldBarrier(observer, pid, customer) {
  // Match the one-bigint advisory key, database, exact typed namespace and seed.
  const {rows}=await observer.query(`WITH k AS (SELECT hashtextextended('catalog_identity_v1:customer:' || $2::uuid::text,1801427913) AS v)
 SELECT EXISTS(SELECT 1 FROM pg_locks,k WHERE pid=$1 AND locktype='advisory' AND mode='ExclusiveLock' AND granted
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objsubid=1
 AND classid=((k.v >> 32) & 4294967295)::oid AND objid=(k.v & 4294967295)::oid) AS held,
 cardinality(pg_blocking_pids($1)) AS blockers`,[pid,customer]);
  assert.equal(rows[0].held,true); assert.equal(rows[0].blockers,0);
}
export async function reversedRawTargetStatements({a,b,observer,customerA,customerB,actor}) {
  const [pidA,pidB]=await distinctBackends(a,b,observer);
  try {
    await begin(a,actor); await begin(b,actor);
    await mark(a,customerA,actor,'2098-01');
    await mark(b,customerB,actor,'2098-02');
    await heldBarrier(observer,pidA,customerA); await heldBarrier(observer,pidB,customerB);
    // Different month avoids the target unique index; only evidence is shared.
    await assert.rejects(mark(b,customerA,actor,'2098-03'), error =>
      error.code==='55P03' && error.detail==='CATALOG_IDENTITY_BUSY');
    await b.query('ROLLBACK');
    await mark(a,customerB,actor,'2098-04');
    await a.query('SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE');
    await a.query('COMMIT');
    const {rows}=await observer.query("SELECT (SELECT count(*)::int FROM public.customer_targets WHERE customer_id=ANY($1::uuid[]) AND year_month LIKE '2098-%') AS targets,(SELECT count(*)::int FROM private.catalog_identity_v1 WHERE kind='customer' AND id=ANY($1::uuid[]) AND lifetime_state='used') AS used",[[customerA,customerB]]);
    assert.deepEqual(rows[0],{targets:2,used:2});
    return {case:'reversed_raw_target_statements',status:'passed',bounded:true};
  } finally { await a.query('ROLLBACK'); await b.query('ROLLBACK'); }
}
export async function evidenceRelationContention({a,b,observer,customerA,actor}) {
  await distinctBackends(a,b,observer);
  try {
    await a.query('BEGIN');
    await a.query('LOCK TABLE private.catalog_identity_v1 IN ACCESS EXCLUSIVE MODE NOWAIT');
    const pid=(await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const {rows}=await observer.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='private.catalog_identity_v1'::regclass AND mode='AccessExclusiveLock' AND granted) AS held",[pid]);
    assert.equal(rows[0].held,true);
    await begin(b,actor);
    await assert.rejects(mark(b,customerA,actor,'2098-05'),error =>
      error.code==='55P03' && /could not obtain lock on relation/.test(error.message));
    await b.query('ROLLBACK'); await a.query('ROLLBACK');
    assert.equal((await observer.query("SELECT count(*)::int AS n FROM public.customer_targets WHERE customer_id=$1 AND year_month='2098-05'",[customerA])).rows[0].n,0);
    return {case:'evidence_relation_contention',status:'passed',bounded:true};
  } finally { await a.query('ROLLBACK'); await b.query('ROLLBACK'); }
}
