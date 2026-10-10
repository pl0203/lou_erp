// Task6-only barrier adapter. Existing runner/lifecycle owns installation, startup and teardown.
// Every child is direct, bounded and reaped. Never use a remote target or relax the marker gate.
import { isDeepStrictEqual } from 'node:util'
import { snapshotSqlFor, submissionExpectationSql, assertFinalOutcome } from './race-final-state.mjs'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateIhrDbTarget } from '../../../scripts/test-ihr-db.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function runRequestRaces(environment = process.env, fixtureMode = 'historical') {
  if (!['historical', 'composed'].includes(fixtureMode)) throw new Error('Unknown race fixture mode')
  const env = validateIhrDbTarget(environment) // Pure guard precedes every subprocess.
  const children = new Map(), deadline = Date.now() + 150_000
  let stopping = false, stopReason, cleanupPromise, resolveStopped
  const stopped = new Promise(resolve => { resolveStopped = resolve })
  // One idempotent path owns normal errors, watchdog expiry and external interruption.
  function cleanup() {
    stopping = true; resolveStopped()
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = Promise.resolve().then(async () => {
      const cleanupDeadline = Date.now() + 1_500
      const owned = [...children.entries()]
      for (const [child, state] of owned) if (!state.closed) {
        try { child.kill('SIGTERM') } catch (error) { state.errors.push(String(error)) }
      }
      // Error and exit notifications are not reaping evidence. Only close resolves terminalClose.
      const terminalClose = Promise.all(owned.map(([, state]) => state.terminalClose))
      let graceTimer, hardTimer
      try {
        await Promise.race([terminalClose, new Promise(resolve => { graceTimer = setTimeout(resolve, 200) })])
        for (const [child, state] of owned) if (!state.closed) {
          try { child.kill('SIGKILL') } catch (error) { state.errors.push(String(error)) }
        }
        await Promise.race([terminalClose, new Promise(resolve => { hardTimer = setTimeout(resolve, Math.max(0, cleanupDeadline - Date.now())) })])
        const unclosed = owned.filter(([, state]) => !state.closed)
        if (unclosed.length) {
          // Release our handles after the bounded failure decision; never claim these were reaped.
          for (const [child] of unclosed) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref() }
          return new Error('Terminal cleanup unverified for owned children: ' + unclosed.map(([child, state]) => `${state.name} (pid ${child.pid ?? 'not spawned'})`).join(', '))
        }
        return null
      } finally { clearTimeout(graceTimer); clearTimeout(hardTimer) }
    })
    return cleanupPromise
  }
  function stop(message) {
    if (!stopReason) stopReason = new Error(message)
    void cleanup()
  }
  const terminate = () => stop('Interrupted by SIGTERM'), interrupt = () => stop('Interrupted by SIGINT')
  process.on('SIGTERM', terminate); process.on('SIGINT', interrupt)
  const watchdog = setTimeout(() => stop('Race deadline exceeded'), 150_000)
  const args = ['-h', env.PGHOST, '-p', env.PGPORT, '-U', 'postgres', '-d', 'pilot_test', '-X', '--no-password', '-qAt', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=verbose']
  function session(name, readOnly = false) {
    if (stopping || Date.now() >= deadline) throw stopReason ?? new Error('Race deadline exceeded')
    const child = spawn('psql', args, { cwd: here, env: { ...env, PGAPPNAME: `ihr-request-race-${name}`, PGOPTIONS: `-c statement_timeout=25000 -c lock_timeout=20000${readOnly ? ' -c default_transaction_read_only=on' : ''}` }, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    const state = { name, closed: false, status: undefined, out: '', err: '', errors: [], terminalClose: undefined }
    state.terminalClose = new Promise(resolve => {
      child.once('error', error => { state.errors.push(error.message); stop(`Session ${name} process error`) })
      child.once('close', code => { state.closed = true; state.status = code; children.delete(child); resolve() })
    })
    children.set(child, state)
    child.stdout.on('data', data => { state.out += data.toString(); if (state.out.length > 1_000_000) stop(`Session ${name} output limit exceeded`) })
    child.stderr.on('data', data => { state.err += data.toString(); if (state.err.length > 1_000_000) stop(`Session ${name} error output limit exceeded`) })
    child.stdin.on('error', error => { state.errors.push(error.message); stop(`Session ${name} input error`) })
    return {
      child,
      write(sql) { if (state.closed || stopping) throw stopReason ?? new Error(`Session ${name} is unavailable`); child.stdin.write(sql + '\n') },
      async wait(token) {
        const limit = Math.min(deadline, Date.now() + 30_000)
        while (!state.out.split(/\r?\n/).includes(token)) {
          if (state.closed || stopping || Date.now() >= limit) throw stopReason ?? new Error(`Session ${name} failed before ${token}: ${state.err || 'deadline/exit'}`)
          await pause(15)
        }
        return state.out
      },
      async finish() {
        child.stdin.end(); await Promise.race([state.terminalClose, stopped])
        if (!state.closed || state.status !== 0 || state.errors.length || stopReason) throw stopReason ?? new Error(`Session ${name} failed: ${state.err || state.errors.join('; ') || 'deadline/exit'}`)
        return state.out
      },
    }
  }
  async function query(sql, name = 'owner', readOnly = false) {
    const s = session(name, readOnly); s.write(sql); return s.finish()
  }
  async function app(name, actor) {
    const s = session(name)
    s.write(readFileSync(join(here, 'helpers.sql'), 'utf8'))
    s.write(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${literal(actor)},false);
SELECT pg_temp.assert_true(current_user='authenticated' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND NOT rolbypassrls),'real non-bypass authenticated role');
SELECT 'PID:'||pg_backend_pid();\n\\echo APP_READY`)
    const text = await s.wait('APP_READY'), match = text.match(/^PID:(\d+)$/m)
    if (!match) throw new Error('Application PID missing')
    return Object.assign(s, { pid: Number(match[1]) })
  }
  async function barrier(waiter, holder, label, lockKey) {
    const hashed = `hashtextextended(${literal(lockKey)},0)`
    const coordinates = `l.classid=((${hashed}>>32)&4294967295)::oid AND l.objid=(${hashed}&4294967295)::oid AND l.objsubid=1`
    const limit = Math.min(deadline, Date.now() + 15_000)
    while (Date.now() < limit) {
      const observed = await query(`SELECT coalesce((SELECT wait_event_type='Lock' AND wait_event='advisory' AND ${holder}=ANY(pg_blocking_pids(pid))
AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=${waiter} AND l.locktype='advisory' AND NOT l.granted AND ${coordinates})
AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=${holder} AND l.locktype='advisory' AND l.granted AND ${coordinates})
FROM pg_stat_activity WHERE pid=${waiter}),false);`, 'barrier', true)
      if (observed.trim() === 't') {
        process.stdout.write(`BARRIER ${label} waiter=${waiter} holder=${holder} advisory=true blocking_pid=true key=${lockKey} exact_advisory=true\n`)
        return
      }
      await pause(20)
    }
    throw new Error(`Actual blocking barrier not observed: ${label}`)
  }
  try {
    const marker = await query(`BEGIN READ ONLY;
SELECT current_database()='pilot_test' AND current_user='postgres' AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
AND (SELECT count(*) FROM public.pilot_fixture_marker)=1
AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci');
ROLLBACK;`, 'marker', true)
    if (marker.trim() !== 't') throw new Error('Disposable PG17 marker required')
    // psql resolves this fixture's existing \ir includes relative to its pinned file path.
    await query(`\\i ${literal(join(here, fixtureMode === 'composed' ? 'composed/race-core-fixture.sql' : 'requests-race-fixture.sql'))}`, 'fixture')
    const rows = await query('SELECT row_to_json(c)::text FROM ihr_request_race_fixture.cases c ORDER BY scenario;', 'cases', true)
    const cases = rows.trim().split('\n').map(row => JSON.parse(row))
    if (cases.length !== 3) throw new Error('Exactly three race fixtures required')
    for (const scenario of ['last_allowance', 'same_date', 'same_key']) {
      const c = cases.find(value => value.scenario === scenario)
      if (!c) throw new Error('Missing scenario fixture')
      const fullBefore = fixtureMode === 'composed' ? JSON.parse((await query(snapshotSqlFor(), 'full-before', true)).trim()) : null
      const expected = fixtureMode === 'composed' ? JSON.parse((await query(submissionExpectationSql(`${literal(c.actor_id)}::uuid`, `${literal(JSON.stringify(c.payload_a.input))}::jsonb`), 'full-expectation', true)).trim()) : null
      const a = await app(`${scenario}-a`, c.actor_id), b = await app(`${scenario}-b`, c.actor_id)
      const call = (key, payload) => `public.leave_transaction_v1(${literal(key)}::uuid,'submit_request',${literal(JSON.stringify(payload))}::jsonb)`
      a.write(`BEGIN; SELECT 'RECEIPT:'||${call(c.command_a, c.payload_a)}::text;\n\\echo A_HELD`)
      const held = await a.wait('A_HELD'), match = held.match(/^RECEIPT:(.+)$/m)
      if (!match) throw new Error('Holder receipt missing')
      const receipt = JSON.parse(match[1])
      const assertion = scenario === 'same_key'
        ? `SELECT pg_temp.assert_true(${call(c.command_b, c.payload_b)}=${literal(JSON.stringify(receipt))}::jsonb,'same key has one result');`
        : `SELECT pg_temp.assert_denied(${literal(`SELECT ${call(c.command_b, c.payload_b)}`)},'55000');`
      b.write(`BEGIN; ${assertion}\n\\echo B_FINISHED`)
      await barrier(b.pid, a.pid, scenario, scenario === 'same_key' ? `ihr-command:${c.actor_id}:${c.command_a}` : 'ihr-setup')
      a.write('COMMIT;'); await a.finish()
      await b.wait('B_FINISHED'); b.write('COMMIT;'); await b.finish()
      const actor = literal(c.actor_id), available = scenario === 'last_allowance' ? 0 : 4950
      const state = await query(`SELECT
(SELECT count(*)=1 FROM public.ihr_leave_requests WHERE employee_id=${actor}::uuid) AND
(SELECT count(*)=1 FROM public.ihr_leave_occupancy WHERE employee_id=${actor}::uuid) AND
(SELECT count(*)=1 AND sum(l.reserved_delta)=450 FROM public.ihr_leave_ledger l JOIN public.ihr_leave_accounts ac ON ac.id=l.account_id WHERE ac.employee_id=${actor}::uuid AND l.kind='reservation') AND
(SELECT count(*)=1 FROM private.ihr_leave_request_events e JOIN public.ihr_leave_requests r ON r.id=e.request_id WHERE r.employee_id=${actor}::uuid) AND
(SELECT count(*)=1 FROM private.ihr_leave_commands WHERE actor_id=${actor}::uuid) AND
(SELECT ac.reserved_minutes=450 AND ac.allowance_minutes-ac.used_minutes-ac.reserved_minutes=${available} FROM public.ihr_leave_accounts ac WHERE ac.employee_id=${actor}::uuid AND ac.year=extract(year FROM clock_timestamp() AT TIME ZONE ac.timezone)::integer);`, 'final-state', true)
      const fullAfter = fixtureMode === 'composed' ? JSON.parse((await query(snapshotSqlFor(), 'full-after', true)).trim()) : null
      const exactFinal = fixtureMode !== 'composed' || assertFinalOutcome(fullBefore, fullAfter, { actor:c.actor_id, key:c.command_a, operation:'submit_request', payload:c.payload_a, ...expected }, receipt)
      const verify = await app(`${scenario}-verify`, c.actor_id)
      verify.write(`SELECT pg_temp.assert_true(${exactFinal ? 'true' : 'false'},'complete final-schema submission state and immutable source history');`)
      verify.write(`SELECT pg_temp.assert_true(${state.trim() === 't' ? 'true' : 'false'},'one request, occupancy, reservation, audit and command; exact balance');
SELECT pg_temp.assert_true(${call(c.command_a, c.payload_a)}=${literal(JSON.stringify(receipt))}::jsonb,'post-commit replay after balance change');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1(${literal(c.command_a)},true)->'result'=${literal(JSON.stringify(receipt))}::jsonb,'committed reconciliation');
SELECT pg_temp.assert_denied(${literal(`SELECT ${call(c.command_a, { ...c.payload_a, input: { ...c.payload_a.input, reason: 'Changed fictional reason' } })}`)},'55000');`)
      await verify.finish()
      if (fixtureMode === 'composed') {
        const afterReplay = JSON.parse((await query(snapshotSqlFor(), 'full-after-replay', true)).trim())
        const proof = await app(`${scenario}-full-replay`, c.actor_id)
        proof.write(`SELECT pg_temp.assert_true(${isDeepStrictEqual(afterReplay,fullAfter) ? 'true' : 'false'},'replay/reconcile/conflict preserve every relevant final-schema row');`); await proof.finish()
      }
      process.stdout.write(`PASSED ${scenario}\n`)
    }
    // Refresh active authority after a real account-lock wait; no user row lock may block revocation.
    const actor = '71000000-0000-0000-0000-000000000008'
    const authorityFixture = JSON.parse((await query(`SELECT jsonb_build_object('year',ac.year,'input',c.payload_a->'input','fingerprint',private.ihr_leave_quote_v1(ac.employee_id,c.payload_a->'input',clock_timestamp())->>'fingerprint')::text
FROM ihr_request_race_fixture.cases c JOIN public.ihr_leave_accounts ac ON ac.employee_id=c.actor_id AND ac.year=extract(year FROM clock_timestamp() AT TIME ZONE ac.timezone)::integer WHERE c.scenario='same_key';`, 'authority-fixture', true)).trim())
    // Compare exact actor state, allowing only intentional public.users deactivation.
    const authorityState = () => query(`SELECT jsonb_build_object(
'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'reason' ORDER BY r.id),'[]') FROM public.ihr_leave_requests r WHERE r.employee_id=${literal(actor)}::uuid),
'days',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.request_id,d.day),'[]') FROM public.ihr_leave_request_days d JOIN public.ihr_leave_requests r ON r.id=d.request_id WHERE r.employee_id=${literal(actor)}::uuid),
'allocations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.request_id,a.account_id),'[]') FROM public.ihr_leave_request_allocations a JOIN public.ihr_leave_requests r ON r.id=a.request_id WHERE r.employee_id=${literal(actor)}::uuid),
'occupancy',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.day),'[]') FROM public.ihr_leave_occupancy o WHERE o.employee_id=${literal(actor)}::uuid),
'ledger',(SELECT coalesce(jsonb_agg(to_jsonb(l)-'reason' ORDER BY l.id),'[]') FROM public.ihr_leave_ledger l JOIN public.ihr_leave_accounts a ON a.id=l.account_id WHERE a.employee_id=${literal(actor)}::uuid),
'audit',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM private.ihr_leave_request_events e JOIN public.ihr_leave_requests r ON r.id=e.request_id WHERE r.employee_id=${literal(actor)}::uuid),
'commands',(SELECT coalesce(jsonb_agg(to_jsonb(c)-'payload' ORDER BY c.request_id),'[]') FROM private.ihr_leave_commands c WHERE c.actor_id=${literal(actor)}::uuid),
'accounts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.ihr_leave_accounts a WHERE a.employee_id=${literal(actor)}::uuid))::text;`, 'authority-state', true).then(value => value.trim())
    for (const ordering of ['request_first', 'deactivation_first']) {
      // Reset only the deliberate prior deactivation before taking a new complete baseline.
      if (ordering === 'deactivation_first') await query(`UPDATE public.users SET is_active=true WHERE id=${literal(actor)}::uuid;`, 'restore-fixture-actor')
      const authorityBaseline = await authorityState()
      const fullAuthorityBaseline = fixtureMode === 'composed' ? (await query(snapshotSqlFor(), 'full-authority-before', true)).trim() : null
      const attemptedKey = ordering === 'request_first' ? '80000000-0000-0000-0000-000000000531' : '80000000-0000-0000-0000-000000000532'
      const holder = session(`authority-${ordering}-holder`)
      holder.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${literal(`ihr-account:${actor}:${authorityFixture.year}`)},0)); SELECT 'PID:'||pg_backend_pid();\n\\echo ACCOUNT_HELD`)
      const holderText = await holder.wait('ACCOUNT_HELD'), holderPid = Number(holderText.match(/^PID:(\d+)$/m)?.[1])
      if (!holderPid) throw new Error('Authority holder PID missing')
      let deactivation
      async function startDeactivation() {
        deactivation = session(`authority-${ordering}-deactivation`)
        // Readiness is emitted only after the is_active trigger has updated the scope row.
        deactivation.write(`BEGIN; UPDATE public.users SET is_active=false WHERE id=${literal(actor)}::uuid; SELECT 'PID:'||pg_backend_pid();\n\\echo DEACTIVATION_HELD`)
        const held = await deactivation.wait('DEACTIVATION_HELD'), deactivationPid = Number(held.match(/^PID:(\d+)$/m)?.[1])
        if (!deactivationPid) throw new Error('Deactivation PID missing')
        process.stdout.write(`DEACTIVATION_HELD ordering=${ordering} pid=${deactivationPid}\n`)
      }
      // Reverse ordering holds users + scope writes before the request starts. A scope latch
      // would block this waiter before it could reach the required account-holder barrier.
      if (ordering === 'deactivation_first') await startDeactivation()
      const waiter = await app(`authority-${ordering}-waiter`, actor)
      const payload = { input: authorityFixture.input, quote_fingerprint: authorityFixture.fingerprint }
      waiter.write(`SELECT pg_temp.assert_denied(${literal(`SELECT public.leave_transaction_v1(${literal(attemptedKey)},'submit_request',${literal(JSON.stringify(payload))}::jsonb)`)},'42501');\n\\echo AUTHORITY_DENIED`)
      await barrier(waiter.pid, holderPid, `authority-${ordering}`, `ihr-account:${actor}:${authorityFixture.year}`)
      if (ordering === 'request_first') await startDeactivation()
      deactivation.write('COMMIT;\n\\echo DEACTIVATION_COMMITTED')
      await deactivation.wait('DEACTIVATION_COMMITTED'); await deactivation.finish()
      process.stdout.write(`DEACTIVATION_COMMITTED ordering=${ordering}\n`)
      holder.write('COMMIT;'); await holder.finish()
      process.stdout.write(`ACCOUNT_RELEASED ordering=${ordering}\n`)
      await waiter.wait('AUTHORITY_DENIED'); await waiter.finish()
      const authorityAfter = await authorityState()
      const fullAuthorityAfter = fixtureMode === 'composed' ? (await query(snapshotSqlFor(), 'full-authority-after', true)).trim() : null
      const attemptedAbsent = await query(`SELECT NOT EXISTS(SELECT 1 FROM private.ihr_leave_commands WHERE request_id=${literal(attemptedKey)}::uuid);`, 'authority-command', true)
      const verifyAuthority = await app(`authority-${ordering}-verify`, '71000000-0000-0000-0000-000000000001')
      verifyAuthority.write(`SELECT pg_temp.assert_true(${authorityAfter === authorityBaseline && fullAuthorityAfter === fullAuthorityBaseline && attemptedAbsent.trim() === 't' ? 'true' : 'false'},'authority denial preserves requests/days/allocations/occupancy/ledger/audit/commands/accounts');`)
      await verifyAuthority.finish()
      process.stdout.write(`PASSED authority-${ordering}\n`)
    }
  } finally {
    const cleanupError = await cleanup()
    clearTimeout(watchdog)
    process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', interrupt)
    if (cleanupError) throw cleanupError
  }
  if (stopReason) throw stopReason
  process.stdout.write('IHR_REQUESTS_CONCURRENCY_PASSED\n')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRequestRaces().catch(error => { process.stderr.write(`iHR request races failed: ${error.message}\n`); process.exitCode = 1 })
}
