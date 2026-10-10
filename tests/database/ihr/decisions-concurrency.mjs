// Tasks7–8 barrier adapter. Existing runner/lifecycle owns installation, startup and teardown.
// Every child is direct, bounded and reaped. Never use a remote target or relax the marker gate.
import { spawn } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateIhrDbTarget } from '../../../scripts/test-ihr-db.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
// Exact owner-observed state comparison; never print private fixture content on a mismatch.
// Each added row is checked in full apart from generated IDs/timestamps/sequences.
export function decisionOutcomeMatches(before, after, c, receipt) {
  try {
    const require = condition => { if (!condition) throw new Error('Outcome mismatch') }
    const same = (a, b) => require(isDeepStrictEqual(a, b))
    const without = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)))
    const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
    const rows = (field, key, count) => {
      const old = new Map(before[field].map(row => [key(row), row]))
      const current = new Map(after[field].map(row => [key(row), row]))
      require(old.size === before[field].length && current.size === after[field].length && current.size === old.size + count)
      for (const [id, row] of old) same(current.get(id), row)
      return after[field].filter(row => !old.has(key(row)))
    }
    const request = before.requests.find(row => row.id === c.request_id)
    require(request && request.version === c.payload_a.expected_version)
    same(receipt, { id: c.request_id, version: request.version + 1, operation: c.operation_a })
    const cancel = c.operation_a === 'approve_cancellation'
    const approved = c.operation_a === 'approve_request'
    const rejected = c.operation_a === 'reject_request'
    require(cancel || approved || rejected || c.operation_a === 'withdraw_request')
    const status = cancel ? 'cancelled' : approved ? 'approved' : rejected ? 'rejected' : 'withdrawn'
    same(c.expected_status, status)
    same(after.requests, before.requests.map(row => row.id === request.id ? { ...row, status, version: row.version + 1 } : row))
    for (const field of ['days', 'allocations', 'attempts']) same(after[field], before[field])
    same(after.occupancy, approved ? before.occupancy : before.occupancy.filter(row => row.request_id !== request.id))
    const allocations = before.allocations.filter(row => row.request_id === request.id)
    require(allocations.length > 0 && new Set(allocations.map(a => a.account_id)).size === allocations.length)
    const changes = new Map(allocations.map(a => [a.account_id, { reserved: cancel ? 0 : -a.charged_minutes, used: cancel ? -a.charged_minutes : approved ? a.charged_minutes : 0 }]))
    require([...changes.keys()].every(id => before.accounts.some(a => a.id === id)))
    same(after.accounts, before.accounts.map(row => changes.has(row.id) ? { ...row, reserved_minutes: row.reserved_minutes + changes.get(row.id).reserved, used_minutes: row.used_minutes + changes.get(row.id).used, version: row.version + 1 } : row))
    const addedLedger = rows('ledger', row => row.id, allocations.length)
    const addedEvents = rows('events', row => row.id, 1)
    const [event] = addedEvents
    require(time(event.at_time))
    const eventName = cancel ? 'cancellation_accepted' : status
    const eventData = cancel ? { attemptId: c.payload_a.attempt_id } : rejected ? { reason: c.payload_a.reason } : {}
    same(without(event, ['id', 'at_time']), { request_id: request.id, actor_id: c.actor_a, event: eventName, data: eventData })
    for (const a of allocations) {
      const matching = addedLedger.filter(row => row.account_id === a.account_id)
      require(matching.length === 1)
      const entry = matching[0]
      require(time(entry.created_at) && Date.parse(entry.created_at) >= Date.parse(event.at_time) && Number.isSafeInteger(entry.sequence) && entry.sequence > Math.max(0, ...before.ledger.map(row => row.sequence)))
      same(without(entry, ['id', 'sequence', 'created_at']), { account_id: a.account_id, effective_date: a.period_start > request.start_date ? a.period_start : request.start_date,
        kind: cancel ? 'cancellation' : approved ? 'approval' : rejected ? 'rejection' : 'withdrawal', allowance_delta: 0,
        reserved_delta: changes.get(a.account_id).reserved, used_delta: changes.get(a.account_id).used,
        source_kind: 'request', source_id: request.id, source_event: status, actor_id: c.actor_a, reason: null })
    }
    const [command] = rows('commands', row => row.actor_id + ':' + row.request_id, 1)
    require(time(command.created_at) && Date.parse(command.created_at) <= Date.parse(event.at_time))
    same(without(command, ['created_at']), { actor_id: c.actor_a, request_id: c.command_a, operation: c.operation_a, payload: c.payload_a, result: receipt, abandoned: false })
    const decisions = rows('decisions', row => row.attempt_id, cancel ? 1 : 0)
    const reversals = rows('reversals', row => row.request_id + ':' + row.account_id, cancel ? allocations.length : 0)
    if (cancel) {
      const attempt = before.attempts.find(row => row.id === c.payload_a.attempt_id && row.request_id === request.id)
      require(attempt && !before.decisions.some(row => row.attempt_id === attempt.id))
      same(decisions[0], { attempt_id: attempt.id, decision: 'accepted', actor_id: c.actor_a, decided_at: event.at_time, reason: null })
      for (const a of allocations) {
        const original = before.ledger.filter(row => row.account_id === a.account_id && row.source_kind === 'request' && row.source_id === request.id && row.kind === 'approval' && row.source_event === 'approved' && row.used_delta === a.charged_minutes)
        require(original.length === 1)
        const matching = reversals.filter(row => row.request_id === request.id && row.account_id === a.account_id)
        require(matching.length === 1)
        same(matching[0], { request_id: request.id, account_id: a.account_id, attempt_id: attempt.id, original_ledger_id: original[0].id, reversal_ledger_id: addedLedger.find(row => row.account_id === a.account_id).id, charged_minutes: a.charged_minutes })
      }
    }
    return true
  } catch { return false }
}

export async function runDecisionRaces(environment = process.env, fixtureMode = 'historical') {
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
    const child = spawn('psql', args, { cwd: here, env: { ...env, PGAPPNAME: `ihr-decision-race-${name}`, PGOPTIONS: `-c statement_timeout=25000 -c lock_timeout=20000${readOnly ? ' -c default_transaction_read_only=on' : ''}` }, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
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
  async function stateSnapshot() {
    const raw = await query(`SELECT jsonb_build_object(
'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ihr_leave_requests r),
'days',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.request_id,d.day),'[]') FROM public.ihr_leave_request_days d),
'allocations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.request_id,a.account_id),'[]') FROM public.ihr_leave_request_allocations a),
'occupancy',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.employee_id,o.day),'[]') FROM public.ihr_leave_occupancy o),
'accounts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.ihr_leave_accounts a),
'ledger',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM public.ihr_leave_ledger l),
'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM private.ihr_leave_request_events e),
'commands',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.actor_id,c.request_id),'[]') FROM private.ihr_leave_commands c),
'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM private.ihr_leave_cancellation_attempts a),
'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.attempt_id),'[]') FROM private.ihr_leave_cancellation_decisions d),
'reversals',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.request_id,r.account_id),'[]') FROM private.ihr_leave_charge_reversals r))::text;`, 'state-snapshot', true)
    return JSON.parse(raw.trim())
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

    await query(`\\i ${literal(join(here, fixtureMode === 'composed' ? 'composed/decisions-race-fixture.sql' : 'decisions-race-fixture.sql'))}`, 'fixture')
    const rows = await query('SELECT row_to_json(c)::text FROM ihr_decision_race_fixture.cases c ORDER BY scenario;', 'cases', true)
    const cases = rows.trim().split('\n').map(row => JSON.parse(row))
    if (cases.length !== 6) throw new Error('Exactly six decision fixtures required')
    const call = (key,operation,payload) => `public.leave_transaction_v1(${literal(key)}::uuid,${literal(operation)},${literal(JSON.stringify(payload))}::jsonb)`
    for (const c of cases.filter(c=>c.scenario!=='authority_after_account_wait')) {
      const baseline = await stateSnapshot()
      const a=await app(`${c.scenario}-a`,c.actor_a), b=await app(`${c.scenario}-b`,c.actor_b)
      a.write(`BEGIN; SELECT 'RECEIPT:'||${call(c.command_a,c.operation_a,c.payload_a)}::text;\n\\echo A_HELD`)
      const held=await a.wait('A_HELD'),match=held.match(/^RECEIPT:(.+)$/m)
      if(!match)throw new Error('Decision holder receipt missing')
      const receipt=JSON.parse(match[1]),sameKey=c.scenario==='cancel_same_key'
      const assertion=sameKey?`SELECT pg_temp.assert_true(${call(c.command_b,c.operation_b,c.payload_b)}=${literal(JSON.stringify(receipt))}::jsonb,'same cancellation key replays one receipt');`
        :`SELECT pg_temp.assert_denied(${literal(`SELECT ${call(c.command_b,c.operation_b,c.payload_b)}`)},'55000');`
      b.write(`BEGIN; ${assertion}\n\\echo B_FINISHED`)
      await barrier(b.pid,a.pid,c.scenario,sameKey ? `ihr-command:${c.actor_a}:${c.command_a}` : 'ihr-setup')
      a.write('COMMIT;');await a.finish();await b.wait('B_FINISHED');b.write('COMMIT;');await b.finish()
      const after = await stateSnapshot()
      const exactWinner = decisionOutcomeMatches(baseline, after, c, receipt)
      const verify=await app(`${c.scenario}-verify`,c.actor_a)
      verify.write(`SELECT pg_temp.assert_true(${exactWinner?'true':'false'},'exact winning ledger/event/command/account delta; immutable snapshots and all losing effects absent');
SELECT pg_temp.assert_true(${call(c.command_a,c.operation_a,c.payload_a)}=${literal(JSON.stringify(receipt))}::jsonb,'post-commit transition replay');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1(${literal(c.command_a)},true)->'result'=${literal(JSON.stringify(receipt))}::jsonb,'post-commit minimal reconciliation');`)
      await verify.finish()
      const afterReplay = await stateSnapshot()
      const replayVerify = await app(`${c.scenario}-replay-state`, c.actor_a)
      replayVerify.write(`SELECT pg_temp.assert_true(${isDeepStrictEqual(afterReplay, after) ? 'true' : 'false'},'replay and reconciliation preserve complete state');`)
      await replayVerify.finish();process.stdout.write(`PASSED ${c.scenario}\n`)
    }
    const c=cases.find(c=>c.scenario==='authority_after_account_wait')
    const account=JSON.parse((await query(`SELECT jsonb_build_object('employee',r.employee_id,'year',a.year)::text FROM public.ihr_leave_requests r JOIN public.ihr_leave_request_allocations a ON a.request_id=r.id WHERE r.id=${literal(c.request_id)}::uuid;`,'authority-account',true)).trim())
    const authorityBaseline = await stateSnapshot()
    const holder=session('authority-holder')
    holder.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${literal(`ihr-account:${account.employee}:${account.year}`)},0)); SELECT 'PID:'||pg_backend_pid();\n\\echo ACCOUNT_HELD`)
    const held=await holder.wait('ACCOUNT_HELD'),holderPid=Number(held.match(/^PID:(\d+)$/m)?.[1])
    if(!holderPid)throw new Error('Authority holder PID missing')
    const waiter=await app('authority-waiter',c.actor_a)
    waiter.write(`SELECT pg_temp.assert_denied(${literal(`SELECT ${call(c.command_a,c.operation_a,c.payload_a)}`)},'42501');\n\\echo AUTHORITY_DENIED`)
    await barrier(waiter.pid,holderPid,'decision-authority-after-account-wait',`ihr-account:${account.employee}:${account.year}`)
    await query(`UPDATE public.users SET is_active=false WHERE id=${literal(c.actor_a)}::uuid;`,'revoke')
    holder.write('COMMIT;');await holder.finish();await waiter.wait('AUTHORITY_DENIED');await waiter.finish()
    const authorityAfter = await stateSnapshot()
    const verify=await app('authority-final-observer',account.employee)
    verify.write(`SELECT pg_temp.assert_true(${isDeepStrictEqual(authorityAfter, authorityBaseline)?'true':'false'},'denied revocation preserves full requests/days/allocations/occupancy/accounts/ledger/events/commands/attempts/decisions/reversals');`)
    await verify.finish()
    process.stdout.write('PASSED decision-authority-after-account-wait\n')
  } finally {
    const cleanupError = await cleanup()
    clearTimeout(watchdog)
    process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', interrupt)
    if (cleanupError) throw cleanupError
  }
  if (stopReason) throw stopReason
  process.stdout.write('IHR_DECISIONS_CONCURRENCY_PASSED\n')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDecisionRaces().catch(error => { process.stderr.write(`iHR decision races failed: ${error.message}\n`); process.exitCode = 1 })
}
