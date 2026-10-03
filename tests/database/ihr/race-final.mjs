// Final-schema Task12 workload only; the existing coordinator lifecycle owns PostgreSQL.
// Each scenario requires its own fresh restored post-1007 snapshot. No installation or server control.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { validateIhrDbTarget } from '../../../scripts/test-ihr-db.mjs'
import { runRequestRaces } from './concurrency.mjs'
import { runDecisionRaces } from './decisions-concurrency.mjs'
import { snapshotSql, assertFinalOutcome, assertFinalRosterPreview } from './race-final-state.mjs'
const here=dirname(fileURLToPath(import.meta.url))
const literal=value=>"'"+String(value).replaceAll("'","''")+"'"
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const actor=n=>'71000000-0000-0000-0000-'+String(n).padStart(12,'0')
const key=n=>'87000000-0000-0000-0000-'+String(n).padStart(12,'0')
export const FINAL_RACE_SCENARIOS=Object.freeze([
 'core','decisions','calendar_then_submit','submit_then_calendar','roster_then_submit','submit_then_roster',
 'different_actors_same_key','different_account_independence','adjust_then_submit','submit_then_adjust',
 'decision_then_reconcile','cancellation_then_reconcile','abandon_then_submit','submit_then_abandon',
 'assignment_revoked_command_wait','assignment_revoked_assignment_wait','grant_revoked_account_wait',
 'grant_expires_command_wait','assignment_expires_command_wait','grant_expires_account_wait','assignment_expires_account_wait','reconcile_actor_revoked_command_wait',
 'replay_grant_revoked_command_wait','reconcile_grant_revoked_command_wait',
 'reconcile_abandoned_false_actor_revoked_command_wait','reconcile_abandoned_true_actor_revoked_command_wait','reconcile_committed_actor_revoked_command_wait',
])
export async function runFinalRace(environment=process.env,scenario) {
  if(!FINAL_RACE_SCENARIOS.includes(scenario)) throw new Error('Unknown final race scenario')
  validateIhrDbTarget(environment)
  if(scenario==='core') return runRequestRaces(environment,'composed')
  if(scenario==='decisions') return runDecisionRaces(environment,'composed')
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
    const child = spawn('psql', args, { cwd: here, env: { ...env, PGAPPNAME: `ihr-final-race-${name}`, PGOPTIONS: `-c statement_timeout=25000 -c lock_timeout=20000${readOnly ? ' -c default_transaction_read_only=on' : ''}` }, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
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
    s.write(readFileSync(join(here, 'composed/helpers.sql'), 'utf8'))
    s.write(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${literal(actor)},false);
SELECT pg_temp.assert_true(current_user='authenticated' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND NOT rolbypassrls),'real non-bypass authenticated role');
SELECT 'PID:'||pg_backend_pid();\n\\echo APP_READY`)
    const text = await s.wait('APP_READY'), match = text.match(/^PID:(\d+)$/m)
    if (!match) throw new Error('Application PID missing')
    return Object.assign(s, { pid: Number(match[1]) })
  }
  async function stateSnapshot() { return JSON.parse((await query(snapshotSql,'state',true)).trim()) }
  const rpc=c=>c.operation==='abandon'||c.operation==='reconcile'
    ? `public.leave_reconcile_request_v1(${literal(c.key)}::uuid,${c.abandon===false?'false':'true'})`
    : `public.leave_transaction_v1(${literal(c.key)}::uuid,${literal(c.operation)},${literal(JSON.stringify(c.payload))}::jsonb)`
  const deny=(c,state,code)=>`SELECT pg_temp.assert_controlled_denied(${literal('SELECT '+rpc(c))},${literal(state)},${literal(code)});`
  const parsed=(text,label)=>{const m=text.match(/^RECEIPT:(.+)$/m);if(!m)throw new Error(`${label} receipt missing`);return JSON.parse(m[1])}
  async function assertState(condition,label) {
    const s=await app('state-proof',actor(2));s.write(`SELECT pg_temp.assert_true(${condition?'true':'false'},${literal(label)});`);await s.finish()
  }
  async function exact(before,after,c,receipt) {
    let matches=false;try {matches=assertFinalOutcome(before,after,c,receipt)} catch(error) {process.stderr.write(`${error.message}\n`)}
    await assertState(matches,'complete exact outcome; immutable history, accounts, ledgers, audit and commands')
  }
  function lockProof(waiter,holder,lockKey,waiting=true) {
    const hashed=`hashtextextended(${literal(lockKey)},0)`
    const coordinates=`l.classid=((${hashed}>>32)&4294967295)::oid AND l.objid=(${hashed}&4294967295)::oid AND l.objsubid=1`
    return waiting ? `SELECT coalesce((SELECT wait_event_type='Lock' AND wait_event='advisory' AND ${holder}=ANY(pg_blocking_pids(pid))
AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=${waiter} AND l.locktype='advisory' AND NOT l.granted AND ${coordinates})
AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=${holder} AND l.locktype='advisory' AND l.granted AND ${coordinates}) FROM pg_stat_activity WHERE pid=${waiter}),false);`
      : `SELECT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=${holder} AND l.locktype='advisory' AND l.granted AND ${coordinates});`
  }
  async function barrier(waiter,holder,lockKey) {
    const limit=Math.min(deadline,Date.now()+15_000)
    while(Date.now()<limit) {
      if((await query(lockProof(waiter,holder,lockKey),'barrier',true)).trim()==='t') {
        process.stdout.write(`BARRIER ${scenario} waiter=${waiter} holder=${holder} key=${lockKey} exact_advisory=true blocking_pid=true\n`);return
      }
      await pause(20)
    }
    throw new Error('Exact requested advisory barrier not observed')
  }
  async function ownerHolder(lockKey) {
    const s=session('lock-holder');s.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${literal(lockKey)},0)); SELECT 'PID:'||pg_backend_pid();\n\\echo LOCK_HELD`)
    const held=await s.wait('LOCK_HELD'),pid=Number(held.match(/^PID:(\d+)$/m)?.[1]);if(!pid)throw new Error('Holder PID missing');return Object.assign(s,{pid})
  }
  async function start(c,label='winner') {
    const s=await app(label,c.actor);s.write(`BEGIN; SELECT 'RECEIPT:'||${rpc(c)}::text;\n\\echo RESULT_HELD`)
    const receipt=parsed(await s.wait('RESULT_HELD'),label);return {s,receipt}
  }
  async function commit(s) {s.write('COMMIT;');await s.finish()}
  async function run(c) {
    const before=await stateSnapshot(),{s,receipt}=await start(c);await commit(s);const after=await stateSnapshot();await exact(before,after,c,receipt);return receipt
  }
  async function replay(c,receipt) {
    const before=await stateSnapshot(),s=await app('replay',c.actor)
    s.write(`SELECT pg_temp.assert_true(${rpc(c)}=${literal(JSON.stringify(receipt))}::jsonb,'identical replay');
SELECT pg_temp.assert_true(public.leave_reconcile_request_v1(${literal(c.key)},true)=${literal(JSON.stringify(c.operation==='abandon'?{state:'abandoned'}:{state:'committed',result:receipt}))}::jsonb,'exact minimal reconciliation');`)
    await s.finish();await assertState(isDeepStrictEqual(before,await stateSnapshot()),'replay and reconciliation preserve all state')
  }
  // B remains uncommitted after waking, allowing independent exact snapshots of both winners.
  async function pair(a,b,{sqlstate,code,reconcile=false,lockKey='ihr-setup'}={}) {
    const before=await stateSnapshot(),winner=await start(a),waiter=await app('waiter',b.actor)
    waiter.write(`BEGIN; ${sqlstate?deny(b,sqlstate,code):`SELECT 'RECEIPT:'||${rpc(b)}::text;`}\n\\echo WAITER_HELD`)
    await barrier(waiter.pid,winner.s.pid,lockKey)
    await commit(winner.s);const output=await waiter.wait('WAITER_HELD'),afterWinner=await stateSnapshot()
    await exact(before,afterWinner,a,winner.receipt)
    await commit(waiter);const after=await stateSnapshot()
    if(sqlstate) await assertState(isDeepStrictEqual(afterWinner,after),'failed stale/denied waiter has zero effects')
    else if(reconcile) {
      equalReceipt(parsed(output,'reconcile'),a.operation==='abandon'?{state:'abandoned'}:{state:'committed',result:winner.receipt})
      await assertState(isDeepStrictEqual(afterWinner,after),'concurrent reconciliation has zero effects')
    } else {
      const receipt=parsed(output,'waiter');await exact(afterWinner,after,b,receipt);await replay(b,receipt)
    }
    await replay(a,winner.receipt)
  }
  function equalReceipt(actual,expected) {if(!isDeepStrictEqual(actual,expected))throw new Error('Exact receipt mismatch')}
  async function submission(name,n) {
    const raw=await query(`SELECT jsonb_build_object('actor',i.actor,'input',i.input,'quote',q.value,
'source',jsonb_build_object('quote',q.value,'member',to_jsonb(m),'policy',to_jsonb(p),'assignment',to_jsonb(a)),
'daySources',(SELECT jsonb_object_agg(d->>'date',private.ihr_leave_day_snapshot(i.actor,(d->>'date')::date)) FROM jsonb_array_elements(q.value->'days') d))::text
FROM ihr_final_race_fixture.inputs i JOIN public.ihr_leave_members m ON m.user_id=i.actor JOIN public.ihr_leave_policies p ON p.id=m.active_policy_id
CROSS JOIN LATERAL(SELECT private.ihr_leave_quote_v1(i.actor,i.input,clock_timestamp()) value) q JOIN public.ihr_leave_approvers a ON a.id=(q.value->'approver'->>'assignmentId')::uuid WHERE i.name=${literal(name)};`,'submission-input',true)
    const value=JSON.parse(raw.trim()),expectedMinutes=name==='saturday'?675:450
    if(value.quote.totalMinutes!==expectedMinutes||value.quote.days.length!==(name==='saturday'?2:1)||value.quote.allocations.length!==1||value.quote.allocations[0].chargedMinutes!==expectedMinutes)throw new Error('Exact fictional quote precondition changed')
    return {actor:value.actor,key:key(n),operation:'submit_request',payload:{input:value.input,quote_fingerprint:value.quote.fingerprint},quote:value.quote,source:value.source,daySources:value.daySources}
  }
  async function adjustment(n,delta=-4950) {
    const value=JSON.parse((await query(`SELECT jsonb_build_object('id',a.id,'version',a.version,'year',a.year,'date',(clock_timestamp() AT TIME ZONE a.timezone)::date)::text FROM public.ihr_leave_accounts a WHERE employee_id=${literal(actor(1))} AND year=(SELECT year FROM ihr_final_race_fixture.settings);`,'adjustment-input',true)).trim())
    return {actor:actor(10),key:key(n),operation:'adjust_balance',asOf:value.date,payload:{employee_id:actor(1),year:value.year,delta_minutes:delta,source_id:key(n+500),expected_version:value.version,reason:'Fictional race adjustment'}}
  }
  async function prepareDecision(cancel=false) {
    const submit=await submission('employee1',100),receipt=await run(submit)
    const c={actor:actor(3),key:key(101),operation:'approve_request',payload:{request_id:receipt.id,expected_version:1}}
    if(!cancel)return c
    await run(c)
    const request=await app('prepare-cancellation',actor(1));request.write(`SELECT public.leave_transaction_v1(${literal(key(102))},'request_cancellation',${literal(JSON.stringify({request_id:receipt.id,expected_version:2,reason:'Fictional cancellation race'}))}::jsonb);`);await request.finish()
    const attempt=(await query(`SELECT id FROM private.ihr_leave_cancellation_attempts WHERE request_id=${literal(receipt.id)};`,'attempt',true)).trim()
    return {actor:actor(3),key:key(103),operation:'approve_cancellation',payload:{request_id:receipt.id,expected_version:3,attempt_id:attempt}}
  }
  try {
    const marker=await query(`BEGIN READ ONLY;
SELECT current_database()='pilot_test' AND current_user='postgres' AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
AND (SELECT count(*) FROM public.pilot_fixture_marker)=1 AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci');
ROLLBACK;`,'marker',true)
    if(marker.trim()!=='t')throw new Error('Disposable PG17 marker required')
    await query(`\\i ${literal(join(here,'composed/race-fixture.sql'))}`,'fixture')
    const settings=JSON.parse((await query('SELECT row_to_json(s)::text FROM ihr_final_race_fixture.settings s;','settings',true)).trim())
    process.stdout.write(`FIXTURE scenario=${scenario} as_of=${settings.as_of} friday=${settings.friday} saturday=${settings.saturday} year=${settings.year}\n`)
    if(scenario.includes('calendar')||scenario.includes('roster')) {
      const roster=scenario.includes('roster'),submit=await submission(roster?'saturday':'employee1',1)
      const calendar='73000000-0000-0000-0000-000000000090',admin={actor:actor(9),key:key(2),operation:roster?'publish_roster':'save_calendar_version'}
      if(roster) {
        admin.rosterSaturday=settings.saturday // Owner fixture date, captured before the live preview.
        const groups=[{id:'79000000-0000-0000-0000-000000000021',on_anchor:false},{id:'79000000-0000-0000-0000-000000000022',on_anchor:true}]
        const end=(await query(`SELECT (${literal(settings.saturday)}::date+1)::text;`,'date',true)).trim()
        const preview=await app('roster-preview',admin.actor);preview.write(`SELECT 'RECEIPT:'||public.leave_roster_preview_v1(${literal(calendar)},${literal(settings.saturday)},${literal(JSON.stringify(groups))}::jsonb,${literal(settings.saturday)},${literal(end)})::text;`)
        admin.preview=parsed(await preview.finish(),'preview')
        assertFinalRosterPreview(admin.preview,admin.rosterSaturday) // Check before consuming its fingerprint.
        admin.calendarVersion='73000000-0000-0000-0000-000000000091'
        admin.payload={calendar_id:calendar,anchor:settings.saturday,groups,effective_from:settings.saturday,effective_until:end,preview_fingerprint:admin.preview.fingerprint,expected_version:1,reason:'Fictional roster race'}
      } else admin.payload={calendar_id:calendar,name:'Fictional revised calendar',effective_from:settings.friday,effective_until:(await query(`SELECT (${literal(settings.friday)}::date+1)::text;`,'calendar-end',true)).trim(),timezone:'Pacific/Kiritimati',holidays_confirmed:true,sunday_minutes:0,holidays:[],groups:[],expected_version:1,reason:'Fictional calendar race'}
      if(scenario.startsWith('submit')) await pair(submit,admin)
      else await pair(admin,submit,{sqlstate:'55000',code:'STALE_QUOTE'})
    } else if(scenario==='adjust_then_submit'||scenario==='submit_then_adjust') {
      await run(await adjustment(10,-4950)) // Exactly one 450-minute day remains; annual grant stays 5400.
      const submit=await submission('employee1',11),adjust=await adjustment(12,-450)
      if(scenario==='adjust_then_submit')await pair(adjust,submit,{sqlstate:'55000',code:'INSUFFICIENT_ALLOWANCE'})
      else await pair(submit,adjust,{sqlstate:'55000',code:'STALE_VERSION'})
    } else if(scenario==='different_actors_same_key'||scenario==='different_account_independence') {
      const first=await submission('employee1',20),second=await submission('employee2',scenario==='different_actors_same_key'?20:21)
      const lockKey=scenario==='different_actors_same_key'?`ihr-command:${first.actor}:${first.key}`:`ihr-account:${first.actor}:${settings.year}`
      const holder=await ownerHolder(lockKey),before=await stateSnapshot()
      let waiter
      if(scenario==='different_actors_same_key') {
        waiter=await app('first-actor-waiter',first.actor);waiter.write(`BEGIN; SELECT 'RECEIPT:'||${rpc(first)}::text;\n\\echo INDEPENDENT_HELD`);await barrier(waiter.pid,holder.pid,lockKey)
      }
      const receipt=await run(second)
      await assertState((await query(lockProof(0,holder.pid,lockKey,false),'independent-holder',true)).trim()==='t','unrelated account/actor completed while exact first lock remains held')
      await exact(before,await stateSnapshot(),second,receipt)
      if(!waiter) {
        waiter=await app('first-account-waiter',first.actor);waiter.write(`BEGIN; SELECT 'RECEIPT:'||${rpc(first)}::text;\n\\echo INDEPENDENT_HELD`)
        await barrier(waiter.pid,holder.pid,lockKey)
      }
      await commit(holder)
      if(waiter) {
        const output=await waiter.wait('INDEPENDENT_HELD'),beforeFirst=await stateSnapshot(),firstReceipt=parsed(output,'first actor');await commit(waiter);await exact(beforeFirst,await stateSnapshot(),first,firstReceipt);await replay(first,firstReceipt)
      } else await run(first)
      await replay(second,receipt)
    } else if(['decision_then_reconcile','cancellation_then_reconcile'].includes(scenario)) {
      const c=await prepareDecision(scenario==='cancellation_then_reconcile')
      await pair(c,{actor:c.actor,key:c.key,operation:'reconcile'},{reconcile:true,lockKey:`ihr-command:${c.actor}:${c.key}`})
    } else if(scenario==='abandon_then_submit'||scenario==='submit_then_abandon') {
      const submit=await submission('employee1',30),abandon={actor:submit.actor,key:submit.key,operation:'abandon'}
      if(scenario==='abandon_then_submit')await pair(abandon,submit,{sqlstate:'55000',code:'COMMAND_ABANDONED',lockKey:`ihr-command:${submit.actor}:${submit.key}`})
      else await pair(submit,abandon,{reconcile:true,lockKey:`ihr-command:${submit.actor}:${submit.key}`})
    } else {
      const assignment=scenario.startsWith('assignment'),expiry=scenario.includes('expires'),reconciliation=scenario.startsWith('reconcile'),replayed=scenario.startsWith('replay'),actorRevocation=scenario.includes('actor_revoked')
      let c=assignment?await prepareDecision():actorRevocation?{actor:actor(1),key:key(40),operation:'abandon'}:await adjustment(41,-60)
      if(scenario.includes('abandoned_')) {
        await run(c);c={actor:c.actor,key:c.key,operation:'reconcile',abandon:!scenario.includes('_false_')}
      } else if(scenario==='reconcile_committed_actor_revoked_command_wait') {
        c=await submission('employee1',40);await run(c);c={actor:c.actor,key:c.key,operation:'reconcile'}
      }
      if(replayed||scenario==='reconcile_grant_revoked_command_wait') {
        await run(c);if(reconciliation)c={actor:c.actor,key:c.key,operation:'reconcile'}
      }
      const commandKey=`ihr-command:${c.actor}:${c.key}`
      const lockKey=scenario.endsWith('_account_wait')?`ihr-account:${actor(1)}:${settings.year}`:scenario==='assignment_revoked_assignment_wait'?`ihr-approver:${actor(1)}`:commandKey
      let expiresAt
      if(expiry) {
        const target=assignment?'public.ihr_leave_approvers':'public.ihr_leave_access_grants'
        const filter=assignment?`employee_id=${literal(actor(1))} AND approver_id=${literal(actor(3))}`:`actor_id=${literal(actor(10))} AND capability='adjust' AND employee_id=${literal(actor(1))}`
        expiresAt=(await query(`UPDATE ${target} SET effective_until=clock_timestamp()+interval '4 seconds' WHERE ${filter} RETURNING effective_until::text;`,'set-deadline')).trim()
      }
      const holder=await ownerHolder(lockKey),baseline=await stateSnapshot(),waiter=await app('authority-waiter',c.actor)
      const code=assignment?'REQUEST_ACCESS_DENIED':actorRevocation?'ACTIVE_ACTOR_REQUIRED':'BALANCE_COMMAND_DENIED'
      waiter.write(`${deny(c,'42501',code)}\n\\echo AUTHORITY_DENIED`);await barrier(waiter.pid,holder.pid,lockKey)
      if(expiry) {
        await assertState((await query(`SELECT query_start<${literal(expiresAt)}::timestamptz AND clock_timestamp()<${literal(expiresAt)}::timestamptz FROM pg_stat_activity WHERE pid=${waiter.pid};`,'started-before-expiry',true)).trim()==='t','waiter started and reached exact barrier before expiry')
        const until=Math.min(deadline,Date.now()+10_000);let crossed=false
        while(Date.now()<until) {if((await query(`SELECT clock_timestamp()>=${literal(expiresAt)}::timestamptz;`,'deadline-proof',true)).trim()==='t'){crossed=true;break}await pause(20)}
        if(!crossed)throw new Error('Database deadline crossing not observed');process.stdout.write(`TIME_CROSSED ${scenario} deadline=${expiresAt}\n`)
      } else if(assignment) {
        // Trigger takes the same approver lock. In assignment-wait ordering, holder performs
        // the real row revocation before releasing; command-wait ordering uses an independent commit.
        const change=`UPDATE public.ihr_leave_approvers SET revoked_at=clock_timestamp(),revoked_by=${literal(actor(9))} WHERE employee_id=${literal(actor(1))} AND approver_id=${literal(actor(3))};`
        if(scenario==='assignment_revoked_assignment_wait'){holder.write(change+'\n\\echo REVOCATION_HELD');await holder.wait('REVOCATION_HELD')}
        else await query(change,'revoke-assignment')
      } else if(actorRevocation) {
        if((await query(`UPDATE public.users SET is_active=false WHERE id=${literal(c.actor)} RETURNING NOT is_active;`,'revoke-actor')).trim()!=='t')throw new Error('Exact actor deactivation did not commit')
      }
      else await query(`UPDATE public.ihr_leave_access_grants SET revoked_at=clock_timestamp(),revoked_by=${literal(actor(6))} WHERE actor_id=${literal(actor(10))} AND capability='adjust' AND employee_id=${literal(actor(1))};`,'revoke-grant')
      const beforeRelease=await stateSnapshot();await commit(holder);await waiter.wait('AUTHORITY_DENIED');await waiter.finish();const after=await stateSnapshot()
      // Intentional source revocation is the only allowed state change; every financial/request
      // history, audit, command and account remains byte-for-byte equal to the pre-wait baseline.
      const fields=assignment&&!expiry?['assignments']:!assignment&&!expiry&&!actorRevocation?['grants']:[]
      for(const field of fields) {
        const originals=baseline[field],rows=after[field]
        await assertState(rows.length===originals.length,'revocation preserves cardinality')
        for(const old of originals) {
          const row=rows.find(r=>r.id===old.id),target=field==='assignments'?old.employee_id===actor(1)&&old.approver_id===actor(3):old.actor_id===actor(10)&&old.capability==='adjust'&&old.employee_id===actor(1)
          if(target) {
            await assertState(row.revoked_at!==null&&row.revoked_by===(field==='assignments'?actor(9):actor(6))&&row.version===old.version+1&&Number.isFinite(Date.parse(row.updated_at))&&Date.parse(row.updated_at)>=Date.parse(old.updated_at),'exact persisted revocation')
            const stripped=({...row,revoked_at:old.revoked_at,revoked_by:old.revoked_by,version:old.version,updated_at:old.updated_at});await assertState(isDeepStrictEqual(stripped,old),'revocation preserves original identity and history')
          } else await assertState(isDeepStrictEqual(row,old),'unrelated authority source unchanged')
        }
      }
      const normalized={...after};for(const field of fields)normalized[field]=baseline[field]
      await assertState(isDeepStrictEqual(normalized,baseline),'denial preserves complete relevant state and leaves no command/tombstone')
      if(scenario!=='assignment_revoked_assignment_wait')await assertState(isDeepStrictEqual(after,beforeRelease),'revocation committed before release; waiter has zero effects')
    }
    process.stdout.write(`PASSED ${scenario}\n`)
  } finally {
    const cleanupError=await cleanup();clearTimeout(watchdog)
    process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',interrupt)
    if(cleanupError)throw cleanupError
  }
  if(stopReason)throw stopReason
  process.stdout.write(`IHR_FINAL_RACE_PASSED ${scenario}\n`)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 runFinalRace(process.env,process.argv[2]).catch(error=>{process.stderr.write(`iHR final race failed: ${error.message}\n`);process.exitCode=1})
}
