// Plain measurement adapter only. The coordinator supplies guarded owned-local sessions and restoration.
// No spawning, installation, connection discovery, database create/drop, triggers, or lifecycle controls.
import { performance } from 'node:perf_hooks'
import { validateIhrDbTarget } from '../../../scripts/test-ihr-db.mjs'
import { AS_OF, buildCapacityFixture, sha256, validateCapacityFixture } from './capacity-fixture.mjs'
import { buildCapacityPlans, buildCapacityWorkloads, assertCapacityResult } from './capacity-workloads.mjs'
import { literal } from './capacity-sql.mjs'
import { assertPlanGate, assertCapacityPlanInventory, captureCapacityPlan } from './capacity-plans.mjs'
import { assertBaselineMatches, assertCapacityIdentity, assertSealedBaseline, assertRestorationProof } from './capacity-baseline.mjs'
export const WARMUPS = 5
export const SAMPLES = 30
export function summarizeSamples(rawMs) {
  if (rawMs.length < SAMPLES || rawMs.some(x => !Number.isFinite(x) || x < 0)) throw new Error('At least 30 finite nonnegative raw samples are required')
  const sorted = [...rawMs].sort((a, b) => a - b)
  return { n: sorted.length, min: sorted[0], p50: sorted[Math.ceil(sorted.length * .50) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), rawMs: [...rawMs] }
}
export { assertPlanGate } from './capacity-plans.mjs'
export const CAPTURE_HELPER_SQL = `CREATE FUNCTION pg_temp.capacity_capture(command text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;state text;detail text;code text;
BEGIN
 BEGIN EXECUTE command INTO result; RETURN jsonb_build_object('ok',true,'value',result);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,detail=PG_EXCEPTION_DETAIL;
  BEGIN code:=detail::jsonb->>'code'; EXCEPTION WHEN OTHERS THEN code:=NULL; END;
  RETURN jsonb_build_object('ok',false,'sqlstate',state,'code',code); END;
END $$;
DO $$ DECLARE ns text; BEGIN SELECT nspname INTO ns FROM pg_namespace WHERE oid=pg_my_temp_schema();
EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated',ns);
EXECUTE format('REVOKE ALL ON FUNCTION %I.capacity_capture(text) FROM PUBLIC',ns);
EXECUTE format('GRANT EXECUTE ON FUNCTION %I.capacity_capture(text) TO authenticated',ns); END $$;`
const markerSql = `SELECT jsonb_build_object('allowed',current_database()='pilot_test' AND current_user='postgres'
AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999
AND (SELECT count(*) FROM public.pilot_fixture_marker)=1 AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci'),
'currentDate',to_char(statement_timestamp() AT TIME ZONE 'Etc/UTC','YYYY-MM-DD'),'version',version(),
'settings',(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN('server_version_num','jit','shared_buffers','work_mem','effective_cache_size','max_parallel_workers_per_gather','track_io_timing','random_page_cost','seq_page_cost','synchronous_commit','fsync','full_page_writes','timezone')))`
const roleProofSql = `SELECT jsonb_build_object('role',current_user,'nonBypass',NOT rolsuper AND NOT rolbypassrls,
'nonOwner',oid<>(SELECT relowner FROM pg_class WHERE oid='public.ihr_leave_requests'::regclass)) FROM pg_roles WHERE rolname=current_user`
export function mutationStateSql(workload, requestId = workload.postcondition.requestId) {
  const p = workload.postcondition, account = p.accountId ?? p.allocationAccountId, request = requestId ? `${literal(requestId)}::uuid` : 'NULL::uuid'
  return `SELECT jsonb_build_object('capacityMutationState',true,'account',(SELECT to_jsonb(a) FROM public.ihr_leave_accounts a WHERE a.id=${literal(account)}::uuid),
'request',(SELECT to_jsonb(r) FROM public.ihr_leave_requests r WHERE r.id=${request}),
'daysHash',(SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.day),'[]')::text) FROM public.ihr_leave_request_days d WHERE d.request_id=${request}),
'allocationsHash',(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.account_id),'[]')::text) FROM public.ihr_leave_request_allocations a WHERE a.request_id=${request}),
'adminEvents',(SELECT count(*) FROM public.ihr_leave_admin_events WHERE operation='adjust_balance' AND actor_id=${literal(workload.actor)}::uuid),
'events',(SELECT count(*) FROM private.ihr_leave_request_events WHERE request_id=${request}),
'ledgerRows',(SELECT count(*) FROM public.ihr_leave_ledger WHERE account_id=${literal(account)}::uuid),
'reversals',(SELECT count(*) FROM private.ihr_leave_charge_reversals WHERE request_id=${request}),
'occupancy',(SELECT count(*) FROM public.ihr_leave_occupancy WHERE request_id=${request}))`
}
export function assertMutationState(workload, before, after, receipt) {
  const fail = why => { throw new Error(`${workload.name}: committed ${why} mismatch`) }
  const p = workload.postcondition, b = before.account, a = after.account
  if (!a || !b || a.id !== b.id || a.version !== b.version + 1 || (p.accountId && a.version !== receipt.version)) fail('account identity/version')
  if (after.ledgerRows !== before.ledgerRows + 1) fail('ledger event count')
  const operation = receipt.operation, total = p.totalMinutes ?? 0
  const reservedDelta = operation === 'submit_request' ? total : ['approve_request', 'reject_request', 'withdraw_request'].includes(operation) ? -total : 0
  const usedDelta = operation === 'approve_request' ? total : operation === 'approve_cancellation' ? -total : 0
  if (a.reserved_minutes !== b.reserved_minutes + reservedDelta || a.used_minutes !== b.used_minutes + usedDelta
    || a.allowance_minutes !== b.allowance_minutes + (operation === 'adjust_balance' ? -60 : 0)) fail('accounting delta')
  if (p.accountId) { if (a.allowance_minutes !== p.allowanceMinutes) fail('adjustment allowance'); if (after.adminEvents !== before.adminEvents + 1) fail('adjustment admin audit'); return }
  if (after.request?.status !== p.status || after.request.version !== receipt.version || after.request.id !== receipt.id || after.request.total_minutes !== total) fail('request state')
  if (after.events !== before.events + 1) fail('request history')
  if (operation === 'submit_request') {
    if (after.request.employee_id !== p.employeeId || after.occupancy !== 1 || after.reversals !== 0) fail('submission occupancy/owner')
  } else {
    if (after.daysHash !== before.daysHash || after.allocationsHash !== before.allocationsHash || JSON.stringify(after.request.source_snapshot) !== JSON.stringify(before.request.source_snapshot)) fail('immutable snapshots')
    if (after.occupancy !== (operation === 'approve_request' ? before.occupancy : 0)) fail('occupancy')
    if (after.reversals !== before.reversals + (operation === 'approve_cancellation' ? 1 : 0)) fail('unique refund')
  }
}
export async function runCapacityMeasurement({ environment, openSession, restoreBaseline, sealedBaseline, evidence, emit, now = () => performance.now(), workloads = buildCapacityWorkloads(), plans = buildCapacityPlans() }) {
  const connection = validateIhrDbTarget(environment)
  if (typeof openSession !== 'function' || typeof restoreBaseline !== 'function' || typeof emit !== 'function') throw new Error('Coordinator session, baseline restoration and evidence sink are required')
  for (const key of ['cpu', 'ramBytes', 'storage', 'os', 'sourceCommit', 'sourceTree', 'migrationHashes', 'fixtureGeneratorHash']) if (!evidence?.[key]) throw new Error(`Missing measured-environment evidence: ${key}`)
  if (!/^[a-f0-9]{40}$/.test(evidence.sourceCommit) || !/^[a-f0-9]{40}$/.test(evidence.sourceTree)) throw new Error('Exact source commit/tree required')
  assertCapacityPlanInventory(plans)
  const f = buildCapacityFixture(), generated = validateCapacityFixture(f)
  assertSealedBaseline(sealedBaseline, evidence, generated)
  sealedBaseline = structuredClone(sealedBaseline)
  const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) } }
  freeze(sealedBaseline)
  let initialSettings
  const baselineHash = sealedBaseline.fingerprint.sha256
  const receipt = { status: 'RUNNING', seed: f.seed, asOf: AS_OF, generated, sealedBaseline, baselineHash, environment: evidence,
    restorations: [], workloads: [], plans: [], gateFailures: [], currentObservation: null,
    limits: ['local synthetic development gate only', 'hosted Auth/PostgREST/browser/release validation NOT_RUN', 'races belong to independently observed contention suites', 'owner historical maximum quote is calculation evidence only'] }
  async function owner() {
    const session = await openSession(connection)
    try {
      await session.query('SET jit=off; SET synchronous_commit=on;')
      const marker = await session.query(markerSql)
      if (marker.allowed !== true || marker.currentDate !== AS_OF || marker.settings.jit !== 'off' || marker.settings.fsync !== 'on' || marker.settings.full_page_writes !== 'on') throw new Error('Owned PG17 marker, fixed as-of date and durable/JIT-off settings required')
      initialSettings ??= marker
      return session
    } catch (error) { await session.close(); throw error }
  }
  async function restore(workload, phase, index) {
    // No session owned by this sampler is live here. The coordinator verifies terminal closure globally.
    const proof = await restoreBaseline({ sealedArtifact: { ...sealedBaseline.artifact }, expectedFingerprint: structuredClone(sealedBaseline.fingerprint),
      expectedHash: baselineHash, sourceCommit: sealedBaseline.sourceCommit, targetDatabase: 'pilot_test', workload, phase, index })
    assertRestorationProof(proof, sealedBaseline)
    const record = { workload, phase, index, proof }; receipt.restorations.push(record); await emit('restoration', record)
  }
  async function verifyBaseline(session, full = false) {
    const identity = await session.query("SELECT jsonb_build_object('count',count(*),'rows',coalesce(jsonb_agg(to_jsonb(i)),'[]')) FROM ihr_capacity_fixture.identity i")
    assertCapacityIdentity(identity, generated, AS_OF)
    const counts = await session.query(full ? 'SELECT ihr_capacity_fixture.validate()' : `SELECT jsonb_build_object('requests',(SELECT count(*) FROM public.ihr_leave_requests),'days',(SELECT count(*) FROM public.ihr_leave_request_days),'accounts',(SELECT count(*) FROM public.ihr_leave_accounts),'activePeople',(SELECT count(*) FROM public.ihr_leave_members WHERE active),'maxCommittedMinutes',(SELECT max(used_minutes+reserved_minutes) FROM public.ihr_leave_accounts))`)
    if (counts.requests !== 10000 || counts.days !== 60000 || counts.accounts !== 1500 || counts.activePeople !== 500 || counts.maxCommittedMinutes > 5400) throw new Error('Materialized fixture invariants failed')
    const fingerprint = await session.query('SELECT ihr_capacity_fixture.fingerprint()')
    assertBaselineMatches(sealedBaseline.fingerprint, fingerprint)
    return counts
  }
  try {
    // A verified restoration trial is mandatory before the first timed sample.
    await restore('initial-verification', 'preflight', 0)
    const initial = await owner()
    try { receipt.counts = await verifyBaseline(initial, true) } finally { await initial.close() }
    receipt.postgres = initialSettings
    await emit('metadata', receipt)
    for (const workload of workloads) {
      const current = { ...workload, rawMs: [], warmupsMs: [], outputs: [], status: 'RUNNING' }
      receipt.workloads.push(current)
      for (let index = 0; index < WARMUPS + SAMPLES; index++) {
        const phase = index < WARMUPS ? 'warmup' : 'measured'
        receipt.currentObservation = { name: workload.name, phase, index, elapsedMs: null, result: null, error: null, asserted: false, role: workload.role }
        if (workload.kind === 'mutation') await restore(workload.name, phase, index)
        const session = await owner()
        let timerStart = null, observationRecorded = false
        try {
          if (workload.kind === 'mutation') await verifyBaseline(session)
          let sql = workload.sql, expected = workload.expected
          const mutationBefore = workload.kind === 'mutation' ? await session.query(mutationStateSql(workload)) : null
          if (workload.prepareOwnerSql) {
            const account = await session.query(workload.prepareOwnerSql)
            if (!Number.isSafeInteger(account.version)) throw new Error('Expected account version unavailable')
            sql = sql.replace(':CAPACITY_ACCOUNT_VERSION', String(account.version))
            expected = { ...expected, version: account.version + 1 }
          }
          if (workload.prepareExpectedSql) {
            const binding = await session.query(workload.prepareExpectedSql)
            if (!/^\d+:[0-9a-f]{32}$/.test(binding?.scopeVersion ?? '') || !/^[a-f0-9]{64}$/.test(binding?.authorityKey ?? '')) throw new Error('Exact HR target authority binding unavailable')
            expected = { ...expected, scopeVersion: binding.scopeVersion, authorityKey: binding.authorityKey }
            receipt.currentObservation.authorityBinding = { scopeVersion: binding.scopeVersion, authorityKey: binding.authorityKey }
          }
          await session.query(CAPTURE_HELPER_SQL)
          if (workload.role === 'authenticated') {
            await session.query(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${literal(workload.actor)},false);`)
            const proof = await session.query(roleProofSql)
            if (proof.role !== 'authenticated' || proof.nonBypass !== true || proof.nonOwner !== true) throw new Error('Actual authenticated nonowner/non-bypass role required')
          } else if (workload.scope !== 'OWNER-CALCULATION-ONLY-NO-AUTHORITY-PROOF') throw new Error('Owner workload cannot claim permission proof')
          if (workload.prepareSql) {
            const prepared = await session.query(workload.prepareSql)
            if (!/^[a-f0-9]{64}$/.test(prepared.fingerprint)) throw new Error('Fresh public quote fingerprint required')
            sql = sql.replace(':CAPACITY_QUOTE_FINGERPRINT', literal(prepared.fingerprint))
          }
          if (sql.includes(':CAPACITY_')) throw new Error('Unresolved mutation precondition')
          receipt.currentObservation.sql = sql
          timerStart = now()
          await session.query(workload.kind === 'mutation' ? 'BEGIN' : 'BEGIN READ ONLY')
          const result = await session.query(`SELECT pg_temp.capacity_capture(${literal(sql)})`)
          receipt.currentObservation.result = result
          await session.query('COMMIT')
          const elapsedMs = now() - timerStart
          receipt.currentObservation.elapsedMs = elapsedMs
          receipt.currentObservation.outputHash = sha256(result)
          // Preserve the exact current observation BEFORE assertions or postconditions can fail.
          current.outputs.push(receipt.currentObservation); observationRecorded = true
          await emit('observation', { ...receipt.currentObservation })
          assertCapacityResult({ ...workload, expected }, result)
          if (workload.kind === 'mutation') {
            await session.query("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);")
            const mutationAfter = await session.query(mutationStateSql(workload, result.value.id))
            receipt.currentObservation.committedState = mutationAfter
            assertMutationState(workload, mutationBefore, mutationAfter, result.value)
          }
          receipt.currentObservation.asserted = true
          ;(phase === 'warmup' ? current.warmupsMs : current.rawMs).push(elapsedMs)
          await emit('sample', { ...receipt.currentObservation })
        } catch (error) {
          if (receipt.currentObservation.elapsedMs === null && timerStart !== null) receipt.currentObservation.elapsedMs = now() - timerStart
          receipt.currentObservation.error = { message: error.message, code: error.code ?? null }
          if (!observationRecorded) current.outputs.push(receipt.currentObservation)
          current.status = 'FAILED'
          await emit('failed-observation', { ...receipt.currentObservation })
          throw error
        } finally { await session.close() }
      }
      current.stats = summarizeSamples(current.rawMs)
      current.passed = current.stats.p95 <= workload.thresholdMs
      current.status = current.passed ? 'PASSED' : 'FAILED_TIMING'
      await emit('workload', current)
      if (!current.passed) receipt.gateFailures.push(`${workload.name}: nearest-rank p95 ${current.stats.p95}ms exceeds ${workload.thresholdMs}ms`)
    }
    await restore('plans', 'plan', 0)
    const session = await owner()
    let planTransaction = false
    try {
      await verifyBaseline(session)
      await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      planTransaction = true
      for (const plan of plans) {
        const record = await captureCapacityPlan(session, plan, emit); receipt.plans.push(record); await emit('plan', record)
        try { assertPlanGate(plan, record.explain); record.passed = true } catch (error) { record.passed = false; record.failure = error.message; receipt.gateFailures.push(error.message) }
      }
      if (receipt.plans.length !== plans.length || receipt.plans.some(p => p.passed !== true)) receipt.gateFailures.push('Required complete analyzed plan evidence did not pass')
      receipt.indexes = await session.query("SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY schemaname,tablename,indexname),'[]') FROM pg_indexes i WHERE (schemaname='public' OR schemaname='private') AND tablename LIKE 'ihr_%'")
      if (!Array.isArray(receipt.indexes) || !receipt.indexes.some(i => i.indexname === 'ihr_leave_hr_history_page' && i.schemaname === 'private' && i.tablename === 'ihr_leave_request_events' && /request_id, at_time DESC, id DESC/.test(i.indexdef ?? ''))) receipt.gateFailures.push('Required private-history request/time/UUID index evidence missing')
      // Read-only EXPLAIN must leave the exact sealed state intact, including commands and sequences.
      await verifyBaseline(session)
      await session.query('COMMIT')
      planTransaction = false
    } finally {
      try { if (planTransaction) await session.query('ROLLBACK') } finally { await session.close() }
    }
    if (receipt.gateFailures.length) throw new Error(receipt.gateFailures.join('; '))
    const completeWorkloads = sha256(workloads) === sha256(buildCapacityWorkloads())
    receipt.capacityAccepted = completeWorkloads
    receipt.status = completeWorkloads ? 'PASSED' : 'PARTIAL'
    await emit('complete', receipt); return receipt
  } catch (error) {
    receipt.status = 'FAILED'; receipt.capacityAccepted = false; receipt.failure = error.message; await emit('failure', receipt); throw error
  }
}
