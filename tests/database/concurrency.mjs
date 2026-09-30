// Normal, disposable PostgreSQL only. No Supabase credentials or production records.
// Run after the sanitized fixture + migrations: node tests/database/concurrency.mjs
// Uses separate psql sessions and observed lock waits, never timing-only race sleeps.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

assert.equal(process.env.PGDATABASE, 'pilot_test', 'Only disposable pilot_test is allowed')
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.PGHOST), 'Only local CI PostgreSQL is allowed')
assert.equal(process.env.PGUSER, 'postgres', 'Disposable fixture owner is required')
const connectionEnv = { ...process.env }
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGPASSFILE']) delete connectionEnv[key]
const connectionArgs = ['-h', process.env.PGHOST, '-p', process.env.PGPORT || '5432', '-U', 'postgres', '-d', 'pilot_test']
const admin = randomUUID(), sales = randomUUID(), customer = randomUUID()
const prefix = `RACE-${randomUUID()}`
const sessions = new Map()
const sessionNames = new Set()
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${quote(JSON.stringify(value))}::jsonb`
let serial = 0
const name = () => `pilot-race-${process.pid}-${++serial}`
const actor = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(admin)},true);`
const transaction = body => `BEGIN; ${actor} ${body}; COMMIT;`
const rpc = (operation, payload, request = randomUUID()) =>
  `SELECT public.pilot_order_transaction(${quote(request)}::uuid,${quote(operation)},${json(payload)})`
const reconcile = request => `SELECT public.pilot_reconcile_request(${quote(request)}::uuid,true)`

function start(sql, applicationName = name(), interactive = false) {
  sessionNames.add(applicationName)
  const child = spawn('psql', [...connectionArgs, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    env: { ...connectionEnv, PGCONNECT_TIMEOUT: '5', PGAPPNAME: applicationName, PGOPTIONS: '-c statement_timeout=25000 -c lock_timeout=20000 -c idle_in_transaction_session_timeout=30000' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = '', readyResolve, readyReject
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  // Only interactive controllers use ready; prevent an unused promise rejection.
  ready.catch(() => {})
  child.stdout.on('data', chunk => {
    stdout += chunk
    if (stdout.includes('PILOT_LOCK_HELD')) readyResolve()
  })
  child.stderr.on('data', chunk => { stderr += chunk })
  const result = new Promise(resolve => {
    child.on('error', error => { readyReject(error); resolve({ code: -1, stdout, stderr: String(error) }) })
    child.on('close', code => {
      sessions.delete(child)
      if (!stdout.includes('PILOT_LOCK_HELD')) readyReject(new Error(stderr || 'Controller exited before lock gate'))
      resolve({ code, stdout, stderr })
    })
  })
  sessions.set(child, result)
  child.stdin.on('error', () => {})
  if (interactive) child.stdin.write(`${sql}\n\\echo PILOT_LOCK_HELD\n`)
  else child.stdin.end(`${sql}\n`)
  return { child, result, ready, applicationName }
}
function successful(result) {
  assert.equal(result.code, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}
async function sql(body) { return successful(await start(body).result) }
function resultJson(result) {
  successful(result)
  const line = result.stdout.split('\n').findLast(line => line.startsWith('{'))
  assert.ok(line, `Missing JSON result: ${result.stdout}`)
  return JSON.parse(line)
}
async function call(operation, payload, request) {
  return resultJson(await start(transaction(rpc(operation, payload, request))).result)
}
async function waitBlocked(applicationNames) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const count = Number(await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN (${applicationNames.map(quote).join(',')}) AND wait_event_type='Lock';`))
    if (count === applicationNames.length) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error(`Sessions never reached lock barrier: ${applicationNames.join(', ')}`)
}
async function gate(body) {
  const controller = start(`BEGIN; ${body};`, name(), true)
  await controller.ready
  return controller
}
async function release(controller) {
  controller.child.stdin.end('COMMIT;\n')
  successful(await controller.result)
}
async function race(lock, commands) {
  const controller = await gate(lock)
  const contenders = commands.map(command => start(transaction(command)))
  try { await waitBlocked(contenders.map(c => c.applicationName)) }
  finally { await release(controller) }
  return Promise.all(contenders.map(c => c.result))
}
function oneWinner(results, expectedSqlstate) {
  assert.equal(results.filter(r => r.code === 0).length, 1, JSON.stringify(results))
  const loser = results.find(r => r.code !== 0)
  assert.match(loser.stderr, new RegExp(`ERROR:\\s+${expectedSqlstate}:`), loser.stderr)
  return resultJson(results.find(r => r.code === 0))
}
const rowLock = (table, id) => `SELECT id FROM public.${table} WHERE id=${quote(id)}::uuid FOR UPDATE`
const requestLock = request => `SELECT pg_advisory_xact_lock(hashtextextended(${quote(`${admin}:${request}`)},0))`
const orderPayload = suffix => ({ customer_id: customer, po_number: `${prefix}-${suffix}`, items: [{ product_name: 'Synthetic race item', quantity: 1, unit_price: 10 }] })
async function pendingSale() {
  const id = randomUUID()
  await sql(`INSERT INTO public.girard_orders(id,customer_id,submitted_by) VALUES (${quote(id)},${quote(customer)},${quote(sales)}); INSERT INTO public.girard_order_items(order_id,product_name,quantity,unit_price) VALUES (${quote(id)},'Synthetic race item',1,10);`)
  return id
}
async function countOrders(suffix) {
  return Number(await sql(`SELECT count(*) FROM public.purchase_orders WHERE po_number LIKE ${quote(`${prefix}-${suffix}%`)};`))
}

let initialized = false
try {
  assert.equal(await sql("SELECT current_database();"), 'pilot_test')
  assert.equal(await sql("SELECT purpose FROM public.pilot_fixture_marker;"), 'disposable-pilot-ci', 'Sanitized disposable fixture marker is required')
  assert.equal(await sql("SELECT rolbypassrls FROM pg_roles WHERE rolname='authenticated';"), 'f', 'authenticated must not bypass RLS')
  assert.equal(await sql("BEGIN; SET LOCAL ROLE authenticated; SELECT row_security_active('public.users'); ROLLBACK;"), 't', 'Requires normal PostgreSQL with effective RLS')
  initialized = true
  await sql(`INSERT INTO auth.users(id) VALUES (${quote(admin)}),(${quote(sales)}); INSERT INTO public.users(id,full_name,email,role) VALUES (${quote(admin)},'Concurrency admin',${quote(`${admin}@race.invalid`)},'po_admin'),(${quote(sales)},'Concurrency sales',${quote(`${sales}@race.invalid`)},'sales_person'); INSERT INTO public.customers(id,name) VALUES (${quote(customer)},'Synthetic concurrency customer');`)

  // Different request IDs racing for the same source order must create only one PO.
  const sale = await pendingSale()
  const approved = oneWinner(await race(rowLock('girard_orders', sale), [
    rpc('approve_sales', { order_id: sale, po_number: `${prefix}-approve-a` }),
    rpc('approve_sales', { order_id: sale, po_number: `${prefix}-approve-b` }),
  ]), '55000')
  assert.equal(await countOrders('approve-'), 1)
  assert.equal(await sql(`SELECT status FROM public.girard_orders WHERE id=${quote(sale)};`), 'approved')
  assert.equal(await sql(`SELECT po_id FROM public.girard_orders WHERE id=${quote(sale)};`), approved.id)
  console.log('PASS duplicate approval serializes to one business order')

  const contested = await pendingSale()
  oneWinner(await race(rowLock('girard_orders', contested), [
    rpc('approve_sales', { order_id: contested, po_number: `${prefix}-decision` }),
    rpc('reject_sales', { order_id: contested, reason: 'Synthetic rejection' }),
  ]), '55000')
  const status = await sql(`SELECT status FROM public.girard_orders WHERE id=${quote(contested)};`)
  assert.ok(['approved', 'rejected'].includes(status))
  assert.equal(await countOrders('decision'), status === 'approved' ? 1 : 0)
  console.log('PASS approve/reject race leaves one consistent decision')

  const duplicateRequest = randomUUID(), duplicatePayload = orderPayload('replay')
  const duplicateResults = await race(requestLock(duplicateRequest), [
    rpc('create_po', duplicatePayload, duplicateRequest), rpc('create_po', duplicatePayload, duplicateRequest),
  ])
  assert.deepEqual(resultJson(duplicateResults[0]), resultJson(duplicateResults[1]))
  assert.equal(await countOrders('replay'), 1)
  console.log('PASS simultaneous same-key create returns identical result')

  const deliveryPO = await call('create_po', orderPayload('delivery'))
  const line = await sql(`SELECT id FROM public.po_line_items WHERE purchase_order_id=${quote(deliveryPO.id)};`)
  const deliveryPayload = { po_id: deliveryPO.id, expected_updated_at: deliveryPO.updated_at, sj_date: '2026-09-30', lines: [{ po_line_item_id: line, quantity_delivered: 1 }] }
  oneWinner(await race(rowLock('purchase_orders', deliveryPO.id), [
    rpc('save_delivery', { ...deliveryPayload, sj_number: 'RACE-A' }), rpc('save_delivery', { ...deliveryPayload, sj_number: 'RACE-B' }),
  ]), '40001')
  assert.equal(Number(await sql(`SELECT coalesce(sum(l.quantity_delivered),0) FROM public.sj_line_items l JOIN public.surat_jalan h ON h.id=l.surat_jalan_id WHERE h.purchase_order_id=${quote(deliveryPO.id)} AND h.voided_at IS NULL;`)), 1)
  assert.equal(await sql(`SELECT status FROM public.purchase_orders WHERE id=${quote(deliveryPO.id)};`), 'complete')
  console.log('PASS competing last-unit delivery rejects stale version without overdelivery')

  const editPO = await call('create_po', orderPayload('edit'))
  const editLine = await sql(`SELECT id FROM public.po_line_items WHERE purchase_order_id=${quote(editPO.id)};`)
  const editPayload = { po_id: editPO.id, customer_id: customer, expected_updated_at: editPO.updated_at, items: [{ id: editLine, product_name: 'Synthetic race item', quantity: 1, unit_price: 10 }] }
  oneWinner(await race(rowLock('purchase_orders', editPO.id), [rpc('edit_po', { ...editPayload, notes: 'writer A' }), rpc('edit_po', { ...editPayload, notes: 'writer B' })]), '40001')
  assert.ok(['writer A', 'writer B'].includes(await sql(`SELECT notes FROM public.purchase_orders WHERE id=${quote(editPO.id)};`)))
  assert.equal(await sql(`SELECT updated_at>${quote(editPO.updated_at)}::timestamptz FROM public.purchase_orders WHERE id=${quote(editPO.id)};`), 't')
  console.log('PASS competing edits preserve one winner and advance resource version')

  // Tombstone transaction owns the advisory lock before late original reaches the RPC.
  const abandonedRequest = randomUUID()
  const abandonController = await gate(`${actor} ${reconcile(abandonedRequest)}`)
  const late = start(transaction(rpc('create_po', orderPayload('late'), abandonedRequest)))
  try { await waitBlocked([late.applicationName]) } finally { await release(abandonController) }
  const lateResult = await late.result
  assert.notEqual(lateResult.code, 0)
  assert.match(lateResult.stderr, /ERROR:\s+55000:/)
  assert.equal(await countOrders('late'), 0)
  console.log('PASS committed reconciliation tombstone blocks delayed original request')

  // Opposite ordering: original commits first; reconciliation must report its result.
  const committedRequest = randomUUID()
  const commitController = await gate(`${actor} ${rpc('create_po', orderPayload('committed'), committedRequest)}`)
  const recovery = start(transaction(reconcile(committedRequest)))
  try { await waitBlocked([recovery.applicationName]) } finally { await release(commitController) }
  const recovered = resultJson(await recovery.result)
  assert.equal(recovered.state, 'committed')
  assert.ok(recovered.result.id)
  assert.equal(await countOrders('committed'), 1)
  assert.equal(await sql(`SELECT id FROM public.purchase_orders WHERE po_number=${quote(`${prefix}-committed`)};`), recovered.result.id)
  console.log('PASS reconciliation waits for committed original instead of abandoning it')
  console.log('PASS all seven normal-session concurrency scenarios')
} finally {
  // Disposable test database only. Kill unfinished contenders before scoped fixture removal.
  const outstanding = [...sessions.entries()]
  for (const [child] of outstanding) child.kill('SIGTERM')
  let cleanupTimer
  try {
    await Promise.race([
      Promise.all(outstanding.map(([, result]) => result)),
      new Promise((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error('Contenders did not close; refusing fixture cleanup while sessions remain')), 30000) }),
    ])
  } finally { clearTimeout(cleanupTimer) }
  if (initialized) {
    // psql exit alone is not proof its server backend has stopped. Reap only this
    // run's exact application names, then observe that every backend is gone.
    const names = [...sessionNames].map(quote).join(',')
    const ownedBackends = `datname=current_database() AND application_name IN (${names}) AND pid<>pg_backend_pid()`
    await sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE ${ownedBackends};`)
    const deadline = Date.now() + 15000
    while (Number(await sql(`SELECT count(*) FROM pg_stat_activity WHERE ${ownedBackends};`)) > 0) {
      if (Date.now() > deadline) throw new Error('Test backends remain; refusing fixture cleanup')
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    // Suppress business audit triggers only while deleting exact synthetic accounts' records.
    await sql(`BEGIN; SET LOCAL session_replication_role=replica;
      DELETE FROM private.pilot_order_requests WHERE actor_id IN (${quote(admin)},${quote(sales)});
      DELETE FROM public.sj_line_items WHERE surat_jalan_id IN (SELECT id FROM public.surat_jalan WHERE purchase_order_id IN (SELECT id FROM public.purchase_orders WHERE created_by=${quote(admin)}));
      DELETE FROM public.surat_jalan WHERE purchase_order_id IN (SELECT id FROM public.purchase_orders WHERE created_by=${quote(admin)});
      DELETE FROM public.po_audit_log WHERE purchase_order_id IN (SELECT id FROM public.purchase_orders WHERE created_by=${quote(admin)});
      DELETE FROM public.po_line_items WHERE purchase_order_id IN (SELECT id FROM public.purchase_orders WHERE created_by=${quote(admin)});
      DELETE FROM public.girard_order_items WHERE order_id IN (SELECT id FROM public.girard_orders WHERE submitted_by=${quote(sales)});
      DELETE FROM public.girard_orders WHERE submitted_by=${quote(sales)};
      DELETE FROM public.purchase_orders WHERE created_by=${quote(admin)};
      DELETE FROM public.customers WHERE id=${quote(customer)};
      DELETE FROM public.users WHERE id IN (${quote(admin)},${quote(sales)});
      DELETE FROM auth.users WHERE id IN (${quote(admin)},${quote(sales)});
      COMMIT;`)
  }
}
