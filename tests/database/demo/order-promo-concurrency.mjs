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
const admin = randomUUID(), adminB = randomUUID(), sales = randomUUID(), other = randomUUID(), customer = randomUUID(), unassignedCustomer = randomUUID(), product = randomUUID(), campaign = randomUUID()
const prefix = `RACE-${randomUUID()}`
const sessions = new Map()
const sessionNames = new Set()
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${quote(JSON.stringify(value))}::jsonb`
let serial = 0
const name = () => `demo-promo-race-${process.pid}-${++serial}`
const actorFor = id => `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(id)},true);`
const actor = actorFor(admin)
const transaction = (body, actorId = admin) => `BEGIN; ${actorFor(actorId)} ${body}; COMMIT;`
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
async function race(lock, commands, actorId = admin) {
  const controller = await gate(lock)
  const contenders = commands.map(command => start(transaction(command, actorId)))
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
const requestLock = (request, actorId = admin) => `SELECT pg_advisory_xact_lock(hashtextextended(${quote(`${actorId}:${request}`)},0))`
const payload = (suffix, quantity = 1, customerId = customer) => ({ customer_id: customerId, po_number: `${prefix}-${suffix}`, items: [{ product_id: product, product_name: 'Synthetic race product', sku: prefix, quantity, unit_price: 17 }] })
const promo = (operation, body, request = randomUUID()) => `SELECT public.pilot_promotion_transaction_v1(${quote(request)},${quote(operation)},${json(body)})`
const stock = async () => Number(await sql(`SELECT remaining_quantity FROM public.promotions WHERE id=${quote(campaign)}`))
const version = async () => Number(await sql(`SELECT stock_version FROM public.promotions WHERE id=${quote(campaign)}`))
const adjust = async quantity => successful(await start(transaction(promo('adjust_stock', { promotion_id: campaign, expected_stock_version: await version(), quantity_delta: quantity, reason: 'Synthetic replenishment' }))).result)
const shortage = (result, expectedCode = 'PROMO_STOCK_WARNING') => {
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /ERROR:\s+PT409:/)
  const match = result.stderr.match(/DETAIL:\s+(\{[^\n]+\})/)
  assert.ok(match, result.stderr)
  const parsed = JSON.parse(match[1]); assert.equal(parsed.code, expectedCode); return parsed
}
try {
  assert.equal(await sql('SELECT current_database()'), 'pilot_test')
  assert.equal(await sql('SELECT purpose FROM public.pilot_fixture_marker'), 'disposable-pilot-ci')
  assert.equal(await sql("SELECT rolbypassrls FROM pg_roles WHERE rolname='authenticated'"), 'f')
  assert.equal(await sql("BEGIN; SET LOCAL ROLE authenticated; SELECT row_security_active('public.users'); ROLLBACK"), 't')
  await sql(`INSERT INTO auth.users VALUES ${[admin, adminB, sales, other].map(id => `(${quote(id)})`).join(',')};
    INSERT INTO public.users(id,full_name,email,role) VALUES ${[[admin,'po_admin'],[adminB,'po_admin'],[sales,'sales_person'],[other,'sales_person']].map(([id,role]) => `(${quote(id)},'Synthetic race',${quote(`${id}@synthetic.invalid`)},${quote(role)})`).join(',')};
    INSERT INTO public.customers(id,name) VALUES(${quote(customer)},'Assigned race'),(${quote(unassignedCustomer)},'Unassigned race');
    INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES(${quote(customer)},${quote(sales)});
    INSERT INTO public.products(id,name,sku) VALUES(${quote(product)},'Synthetic race product',${quote(prefix)});
    INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('promotion-images',${quote(`promotions/${admin}/${campaign}/${randomUUID()}.webp`)},${quote(admin)},'{"size":128,"mimetype":"image/webp"}');`)
  const image = await sql(`SELECT name FROM storage.objects WHERE bucket_id='promotion-images' AND owner_id=${quote(admin)}`)
  successful(await start(transaction(promo('create_promotion', { id: campaign, product_id: product, opening_quantity: 5, image_path: image, harga_pokok: 0, luar_kota: 20, dalam_kota: null, depo_bangunan: 18, is_active: true }))).result)
  const controller = await gate(rowLock('products', product))
  const lastUnits = [start(transaction(rpc('create_po', payload('last-a', 5)),admin)), start(transaction(rpc('create_po', payload('last-b', 5)),adminB))]
  try { await waitBlocked(lastUnits.map(c => c.applicationName)) } finally { await release(controller) }
  const results = await Promise.all(lastUnits.map(c => c.result))
  oneWinner(results, 'PT409'); shortage(results.find(r => r.code !== 0))
  assert.equal(await stock(), 0)
  assert.equal(await sql(`SELECT sum(quantity) FROM private.pilot_promo_slices WHERE promotion_id=${quote(campaign)}`), '5')
  console.log('PASS two actual admins contend for last stock; one commit, one rollback, zero floor')

  await adjust(5)
  const draft = payload('stale-warning', 10)
  const originalQuote = shortage(await start(transaction(rpc('create_po', draft))).result)
  assert.equal(originalQuote.shortages[0].remaining_quantity, 5)
  await call('create_po', payload('intervening', 3))
  const freshQuote = shortage(await start(transaction(rpc('create_po', {...draft, promo_stock_ack: originalQuote.ack}))).result, 'PROMO_STOCK_CHANGED')
  assert.equal(freshQuote.shortages[0].remaining_quantity, 2)
  assert.notDeepEqual(freshQuote.ack, originalQuote.ack)
  await call('create_po', {...draft, promo_stock_ack: freshQuote.ack})
  assert.equal(await stock(), 0)
  assert.equal(await sql(`SELECT count(*) FROM public.purchase_orders WHERE po_number=${quote(draft.po_number)}`), '1')
  console.log('PASS stale Continue obtains fresh campaign facts and commits only after a new acknowledgment')

  await adjust(10)
  const sameRequest = randomUUID(), samePayload = payload('same-key', 2)
  const duplicate = await race(requestLock(sameRequest), [rpc('create_po', samePayload, sameRequest), rpc('create_po', samePayload, sameRequest)])
  assert.deepEqual(resultJson(duplicate[0]), resultJson(duplicate[1]))
  assert.equal(await stock(), 8)
  assert.equal(await sql(`SELECT count(*) FROM private.pilot_promo_movements WHERE request_id=${quote(sameRequest)} AND event_kind='allocation'`), '1')
  console.log('PASS concurrent same-key replay allocates only once')

  const creationFirst = await gate(`${actor} ${rpc('create_po', payload('assignment-first'))}`)
  const reassignment = start(`BEGIN; UPDATE public.customer_sales_rep_assignments SET sales_rep_id=${quote(other)} WHERE customer_id=${quote(customer)}; COMMIT;`)
  try { await waitBlocked([reassignment.applicationName]) } finally { await release(creationFirst) }
  successful(await reassignment.result)
  const created = resultJson(await creationFirst.result)
  assert.equal(await sql(`SELECT sales_person_id_at_creation FROM public.purchase_orders WHERE id=${quote(created.id)}`), sales)
  const later = await call('create_po', payload('assignment-later'))
  assert.equal(await sql(`SELECT sales_person_id_at_creation FROM public.purchase_orders WHERE id=${quote(later.id)}`), other)
  console.log('PASS PO-first assignment ordering freezes original credit across later reassignment')

  const assignmentFirst = await gate(`UPDATE public.customer_sales_rep_assignments SET sales_rep_id=${quote(sales)} WHERE customer_id=${quote(customer)}`)
  const newOrder = start(transaction(rpc('create_po', payload('assignment-writer-first'))))
  try { await waitBlocked([newOrder.applicationName]) } finally { await release(assignmentFirst) }
  const reassigned = resultJson(await newOrder.result)
  assert.equal(await sql(`SELECT sales_person_id_at_creation FROM public.purchase_orders WHERE id=${quote(reassigned.id)}`), sales)
  console.log('PASS assignment-first ordering captures committed replacement rather than stale snapshot')

  const absentFirst = await gate(`${actor} ${rpc('create_po', payload('unassigned-first',1,unassignedCustomer))}`)
  const insertion = start(`BEGIN; INSERT INTO public.customer_sales_rep_assignments(customer_id,sales_rep_id) VALUES(${quote(unassignedCustomer)},${quote(other)}); COMMIT;`)
  try { await waitBlocked([insertion.applicationName]) } finally { await release(absentFirst) }
  successful(await insertion.result)
  assert.equal(await sql(`SELECT sales_attribution_state FROM public.purchase_orders WHERE id=${quote(resultJson(await absentFirst.result).id)}`), 'unassigned')
  console.log('PASS absent assignment serializes with concurrent insert and stays Unassigned')

  // Revoke current authority before receipt recovery acquires its authority row lock.
  const revocation = await gate(`UPDATE public.users SET is_active=false WHERE id=${quote(admin)}`)
  const recovery = start(transaction(reconcile(sameRequest)))
  try { await waitBlocked([recovery.applicationName]) } finally { await release(revocation) }
  const denied = await recovery.result
  assert.notEqual(denied.code, 0); assert.match(denied.stderr, /ERROR:\s+42501:/)
  assert.equal(await sql(`SELECT count(*) FROM private.pilot_order_requests WHERE actor_id=${quote(admin)} AND request_id=${quote(sameRequest)} AND result IS NOT NULL AND NOT abandoned`), '1')
  console.log('PASS authority revocation wins before recovery, preserving committed receipt without disclosure')
  await sql(`UPDATE public.users SET is_active=true WHERE id=${quote(admin)}`)

  const promoRequest = randomUUID()
  const tombstone = await gate(`${actor} SELECT public.pilot_reconcile_promotion_v1(${quote(promoRequest)},true)`)
  const delayed = start(transaction(promo('adjust_stock', { promotion_id: campaign, expected_stock_version: await version(), quantity_delta: 1, reason: 'Late synthetic adjustment' },promoRequest)))
  try { await waitBlocked([delayed.applicationName]) } finally { await release(tombstone) }
  const refused = await delayed.result
  assert.notEqual(refused.code, 0); assert.match(refused.stderr, /ERROR:\s+55000:/)
  // Unknown wrong-family recovery never tombstones a promotion request.
  const familyRequest = randomUUID(), before = await stock()
  successful(await start(transaction(reconcile(familyRequest))).result)
  successful(await start(transaction(promo('adjust_stock', { promotion_id: campaign, expected_stock_version: await version(), quantity_delta: 1, reason: 'Independent family' },familyRequest))).result)
  assert.equal(await stock(), before+1)
  console.log('PASS promotion tombstone fences delayed mutation; unknown order recovery cannot abandon promotion')

  assert.equal(await sql(`SELECT p.remaining_quantity=(SELECT sum(m.quantity_delta) FROM private.pilot_promo_movements m WHERE m.promotion_id=p.id) FROM public.promotions p WHERE p.id=${quote(campaign)}`), 't')
  console.log('DEMO_ORDER_PROMOTION_CONCURRENCY_PASSED (7 lock-barrier races plus 1 intervening-change scenario)')
} finally {
  const outstanding = [...sessions.entries()]
  for (const [child] of outstanding) child.kill('SIGTERM')
  await Promise.all(outstanding.map(([,result]) => result))
  // Immutable synthetic ledger evidence is intentionally retained in this disposable DB.
  // The suite never deletes business history or modifies another run's rows.
}
