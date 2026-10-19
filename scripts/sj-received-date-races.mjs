// Real PostgreSQL sessions; caller supplies its already verified disposable connection.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const quote = value => `'${String(value).replaceAll("'", "''")}'`
export async function runSjReceivedDateRaces({ env }) {
 assert.equal(env.PGHOST, '127.0.0.1')
 assert.equal(env.PGDATABASE, 'pilot_co_test')
 assert.equal(env.PGUSER, 'postgres')
 const actor = randomUUID(), sessions = new Map()
 let customer = randomUUID(), catalogue = false
 const auth = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(actor)},true);`
 let setup = false, state
 function start(sql, gate = false) {
  const child = spawn('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', pid, resolveReady, rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject }); ready.catch(() => {})
  child.stdout.on('data', chunk => { stdout += chunk; const match = stdout.match(/SJ_PID:(\d+)/); if (match) pid = Number(match[1]); if (stdout.includes('SJ_GATE_READY')) resolveReady() })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.stdin.on('error', () => {})
  const result = new Promise(resolve => {
   child.on('error', error => { rejectReady(error); resolve({ code: -1, stdout, stderr: String(error) }) })
   child.on('close', code => { sessions.delete(child); if (!stdout.includes('SJ_GATE_READY')) rejectReady(new Error(stderr)); resolve({ code, stdout, stderr }) })
  })
  sessions.set(child, result)
  const preamble = "SET statement_timeout='25s'; SET lock_timeout='20s'; SET idle_in_transaction_session_timeout='30s'; SELECT 'SJ_PID:'||pg_backend_pid();\n"
  if (gate) child.stdin.write(preamble + sql + '\n\\echo SJ_GATE_READY\n')
  else child.stdin.end(preamble + sql)
  return { child, result, ready, get pid() { return pid }, get stdout() { return stdout } }
 }
 const checked = result => { assert.equal(result.code, 0, result.stderr); return result.stdout.split('\n').filter(line => line && !line.startsWith('SJ_PID:') && line !== 'SJ_GATE_READY').join('\n') }
 const sql = async statement => checked(await start(statement).result)
 const lastJson = output => JSON.parse(output.split('\n').findLast(line => line.startsWith('{')))
 const rpc = (payload, request = randomUUID()) => `SELECT public.pilot_order_transaction(${quote(request)},'edit_sj_received_date',${quote(JSON.stringify(payload))}::jsonb);`
 const tx = statement => `BEGIN; ${auth} ${statement} COMMIT;`
 const release = async gate => { gate.child.stdin.end('COMMIT;\n'); return checked(await gate.result) }
 const ready = async gate => { await Promise.race([gate.ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('SJ gate timeout')), 15000); timer.unref() })]); return gate }
 async function blocked(holder, contender, type) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
   if (contender.pid && await sql(`SELECT ${holder.pid}=ANY(pg_blocking_pids(${contender.pid})) AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=${contender.pid} AND NOT granted AND locktype=${quote(type)});`) === 't') return
   await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`No observed ${type} lock barrier for received-date race`)
 }
 try {
  assert.equal(await sql("SELECT current_database()='pilot_co_test' AND current_user='postgres' AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND (SELECT count(*)=1 AND bool_and(purpose='disposable-pilot-ci') FROM public.pilot_fixture_marker);"), 't')
  catalogue = await sql("SELECT to_regclass('private.catalog_cutover_v1') IS NOT NULL;") === 't'
  if (catalogue) {
   customer = await sql("SELECT id FROM public.customers WHERE id=md5('sj-catalogue-race-parent')::uuid AND name='SJ catalogue reserved race parent';")
   assert.match(customer, /^[a-f0-9-]{36}$/, 'Exact preexisting disposable race parent required')
  }
  state = lastJson(await sql(`BEGIN;
   INSERT INTO auth.users VALUES(${quote(actor)});
   INSERT INTO public.users(id,full_name,email,role) VALUES(${quote(actor)},'SJ race synthetic',${quote(actor + '@example.invalid')},'po_admin');
   ${catalogue ? '' : `INSERT INTO public.customers(id,name) VALUES(${quote(customer)},'SJ race synthetic');`}
   ${auth}
   CREATE TEMP TABLE sj_race_state(value jsonb);
   DO $setup$ DECLARE r jsonb; po uuid; line uuid; BEGIN
    r:=public.pilot_order_transaction(gen_random_uuid(),'create_po',jsonb_build_object('customer_id',${quote(customer)},'po_number',${quote('SJ-RACE-' + actor)},'items',jsonb_build_array(jsonb_build_object('product_name','Synthetic race line','quantity',1,'unit_price',1))));
    po:=(r->>'id')::uuid; SELECT id INTO line FROM public.po_line_items WHERE purchase_order_id=po;
    r:=public.pilot_order_transaction(gen_random_uuid(),'save_delivery',jsonb_build_object('po_id',po,'expected_updated_at',r->>'updated_at','sj_number','SJ-RACE','sj_date','2026-10-01','lines',jsonb_build_array(jsonb_build_object('po_line_item_id',line,'quantity_delivered',1))));
    INSERT INTO sj_race_state VALUES(r);
   END $setup$;
   SELECT value FROM sj_race_state;
   COMMIT;`)); setup = true
  const payload = { sj_id: state.id, expected_updated_at: state.updated_at, sj_date_received: '2026-10-07' }
  const firstRequest = randomUUID()
  const winner = await ready(start(`BEGIN; ${auth} ${rpc(payload, firstRequest)}`, true))
  const contender = start(tx(rpc({ ...payload, sj_date_received: '2026-10-08' })))
  await blocked(winner, contender, 'transactionid')
  state = lastJson(await release(winner))
  const stale = await contender.result
  assert.notEqual(stale.code, 0); assert.match(stale.stderr, /ERROR:\s+PT409:/)
  assert.equal(await sql(`SELECT count(*)=1 FROM public.po_audit_log WHERE purchase_order_id=${quote(state.po_id)} AND field_changed='sj_date_received';`), 't')
  const secondRequest = randomUUID(), retryPayload = { ...payload, expected_updated_at: state.updated_at, sj_date_received: '2026-10-09' }
  const saving = await ready(start(`BEGIN; ${auth} ${rpc(retryPayload, secondRequest)}`, true))
  const retry = start(tx(rpc(retryPayload, secondRequest)))
  await blocked(saving, retry, 'advisory')
  state = lastJson(await release(saving))
  assert.deepEqual(lastJson(checked(await retry.result)), state)
  assert.equal(await sql(`SELECT count(*)=2 FROM public.po_audit_log WHERE purchase_order_id=${quote(state.po_id)} AND field_changed='sj_date_received';`), 't')
  const lock = await ready(start(`BEGIN; SELECT set_config('request.jwt.claim.sub',${quote(actor)},true); UPDATE public.purchase_orders SET completed_at=clock_timestamp()-interval '14 days'+interval '2 seconds' WHERE id=${quote(state.po_id)}; SELECT json_build_object('version',updated_at,'deadline',completed_at+interval '14 days') FROM public.purchase_orders WHERE id=${quote(state.po_id)};`, true))
  const timing = lastJson(lock.stdout)
  const late = start(tx(rpc({ ...payload, expected_updated_at: timing.version, sj_date_received: '2026-10-10' })))
  await blocked(lock, late, 'transactionid')
  while (await sql(`SELECT clock_timestamp()>${quote(timing.deadline)}::timestamptz;`) !== 't') await new Promise(resolve => setTimeout(resolve, 25))
  await release(lock)
  const expired = await late.result
  assert.notEqual(expired.code, 0); assert.match(expired.stderr, /ERROR:\s+55000:/)
  assert.equal(await sql(`SELECT sj_date_received='2026-10-09' AND (SELECT count(*)=2 FROM public.po_audit_log WHERE purchase_order_id=${quote(state.po_id)} AND field_changed='sj_date_received') FROM public.surat_jalan WHERE id=${quote(state.id)};`), 't')
  return 'SJ_RECEIVED_DATE_REAL_RACES_PASSED\n'
 } finally {
  const pending = [...sessions.entries()]
  for (const [child] of pending) child.kill('SIGTERM')
  await Promise.all(pending.map(([, result]) => result))
  if (setup) await sql(`BEGIN; SELECT set_config('request.jwt.claim.sub',${quote(actor)},true);
   DELETE FROM public.sj_line_items WHERE surat_jalan_id=${quote(state.id)};
   DELETE FROM public.surat_jalan WHERE id=${quote(state.id)};
   DELETE FROM public.po_line_items WHERE purchase_order_id=${quote(state.po_id)};
   DELETE FROM public.po_audit_log WHERE purchase_order_id=${quote(state.po_id)};
   DELETE FROM public.purchase_orders WHERE id=${quote(state.po_id)};
   DELETE FROM private.pilot_order_requests WHERE actor_id=${quote(actor)};
   ${catalogue ? '' : `DELETE FROM public.customers WHERE id=${quote(customer)};`}
   DELETE FROM public.users WHERE id=${quote(actor)};
   DELETE FROM auth.users WHERE id=${quote(actor)};
   SET CONSTRAINTS ALL IMMEDIATE; COMMIT;`)
 }
}
