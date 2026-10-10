// Normal, disposable PostgreSQL only. No Supabase credentials or production records.
// Run after the sanitized fixture + migrations: node tests/database/concurrency.mjs
// Uses separate psql sessions and observed lock waits, never timing-only race sleeps.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

assert.equal(process.env.PGDATABASE, 'pilot_demo_cutover_test', 'Only the fixed disposable cutover companion is allowed')
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.PGHOST), 'Only local CI PostgreSQL is allowed')
assert.equal(process.env.PGUSER, 'postgres', 'Disposable fixture owner is required')
const connectionEnv = { ...process.env }
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGPASSFILE']) delete connectionEnv[key]
const connectionArgs = ['-h', process.env.PGHOST, '-p', process.env.PGPORT || '5432', '-U', 'postgres', '-d', 'pilot_demo_cutover_test']
const admin = randomUUID(), sales = randomUUID(), customer = randomUUID()
const legacyProduct = randomUUID(), managedProduct = randomUUID(), legacyCampaign = randomUUID(), managedCampaign = randomUUID(), image = randomUUID()
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
// Run against the exact baseline BEFORE the demo migration, not against the candidate.
const migration = readFileSync('supabase/migrations/202610081101_demo_order_promotions.sql', 'utf8')
const visit = randomUUID(), schedule = randomUUID(), committedRequest = randomUUID(), heldRequest = randomUUID(), lateRequest = randomUUID(), lateCreate = randomUUID(), lateEdit = randomUUID()
const salesPayload = { customer_id: customer, visit_id: visit, items: [{ product_name: 'Synthetic pre-cutover submission', quantity: 1, unit_price: 0 }] }
try {
  assert.equal(await sql('SELECT purpose FROM public.pilot_fixture_marker'), 'disposable-pilot-ci')
  assert.equal(await sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pilot_order_transaction(uuid,text,jsonb)'::regprocedure"), '2fa378a5be5bfbed7dfdabfe8c6c420c', 'Requires exact legacy RPC baseline')
  await sql(`INSERT INTO auth.users VALUES(${quote(admin)}),(${quote(sales)}); INSERT INTO public.users(id,full_name,email,role) VALUES(${quote(admin)},'Cutover admin',${quote(`${admin}@synthetic.invalid`)},'po_admin'),(${quote(sales)},'Cutover salesperson',${quote(`${sales}@synthetic.invalid`)},'sales_person');
   INSERT INTO public.customers(id,name) VALUES(${quote(customer)},'Cutover customer');
   INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date) VALUES(${quote(schedule)},${quote(customer)},${quote(sales)},${quote(admin)},current_date);
   INSERT INTO public.outlet_visits(id,outlet_id,sales_person_id,schedule_id) VALUES(${quote(visit)},${quote(customer)},${quote(sales)},${quote(schedule)});`)
  // A genuine pre-migration promotion receives the migration's additive defaults.
  await sql(`INSERT INTO public.products(id,name,sku) VALUES(${quote(legacyProduct)},'Legacy history product',${quote(`${prefix}-legacy`)}),(${quote(managedProduct)},'Managed campaign product',${quote(`${prefix}-managed`)});
   INSERT INTO public.promotions(id,product_id,start_date,end_date,created_by) VALUES(${quote(legacyCampaign)},${quote(legacyProduct)},'2020-01-01','2020-01-02',${quote(admin)});`)
  const legacyBefore = JSON.parse(await sql(`SELECT to_jsonb(p) FROM public.promotions p WHERE id=${quote(legacyCampaign)}`))
  const committed = resultJson(await start(transaction(rpc('submit_sales',salesPayload,committedRequest),sales)).result)
  // Exact old RPC has already inserted its ledger/business rows but has not committed.
  const inFlight = await gate(`${actorFor(sales)} ${rpc('submit_sales',salesPayload,heldRequest)}`)
  try {
    const refusedApply = await start(migration).result
    assert.notEqual(refusedApply.code, 0, 'Cutover must refuse while an old ledger-writing transaction is active')
    assert.match(refusedApply.stderr, /ERROR:\s+55P03:/)
    assert.equal(await sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='po_line_items' AND column_name='product_id'"),'0','Failed cutover must roll back all additions')
  } finally { await release(inFlight) }
  const heldResult = resultJson(await inFlight.result)
  console.log('PASS active legacy ledger writer makes cutover NOWAIT-refuse atomically; legitimate old commit remains')

  // This invocation already entered the exact old function but is waiting before its INSERT.
  const oldPO = resultJson(await start(transaction(rpc('create_po',{customer_id:customer,po_number:`${prefix}-old-po`,items:[{product_name:'Pre-cutover line',quantity:3,unit_price:17}]}))).result)
  const oldLine = await sql(`SELECT id FROM public.po_line_items WHERE purchase_order_id=${quote(oldPO.id)}`)
  const beforeInsert = await gate(`${requestLock(lateRequest,sales)}; ${requestLock(lateCreate,admin)}; ${requestLock(lateEdit,admin)}`)
  const delayedOld = start(transaction(rpc('submit_sales',salesPayload,lateRequest),sales))
  const delayedCreate = start(transaction(rpc('create_po',{customer_id:customer,po_number:`${prefix}-late-create`,items:[{product_name:'Late line',quantity:1,unit_price:17}]},lateCreate)))
  const delayedEdit = start(transaction(rpc('edit_po',{execution_version:1,po_id:oldPO.id,customer_id:customer,expected_updated_at:oldPO.updated_at,items:[{id:oldLine,product_name:'Pre-cutover line',quantity:5,unit_price:17}]},lateEdit)))
  try {
    await waitBlocked([delayedOld.applicationName,delayedCreate.applicationName,delayedEdit.applicationName])
    successful(await start(migration).result)
  } finally { await release(beforeInsert) }
  const late = await delayedOld.result
  assert.notEqual(late.code,0,'Old function body may not insert a retired request after cutover')
  assert.match(late.stderr,/ERROR:\s+42501:/)
  assert.equal(await sql(`SELECT count(*) FROM private.pilot_order_requests WHERE actor_id=${quote(sales)} AND request_id=${quote(lateRequest)}`),'0')
  assert.equal(await sql(`SELECT count(*) FROM public.girard_orders WHERE submitted_by=${quote(sales)}`),'2')
  console.log('PASS already-running old function resumes after cutover and is fenced before creating a new submission')
  for (const [kind,pending] of [['edit_po',delayedEdit],['create_po',delayedCreate]]) {
    const stale = await pending.result
    assert.notEqual(stale.code,0,`Old ${kind} body cannot bypass post-cutover accounting`)
    assert.match(stale.stderr,/ERROR:\s+42501:/)
  }
  assert.equal(await sql(`SELECT count(*) FROM public.purchase_orders WHERE po_number=${quote(`${prefix}-late-create`)}`),'0')
  assert.equal(await sql(`SELECT quantity FROM public.po_line_items WHERE id=${quote(oldLine)}`),'3')
  console.log('PASS already-entered old create/edit bodies cannot bypass new stock and attribution accounting')

  assert.deepEqual(resultJson(await start(transaction(rpc('submit_sales',salesPayload,committedRequest),sales)).result),committed)
  assert.deepEqual(resultJson(await start(transaction(reconcile(heldRequest),sales)).result).result,heldResult)
  console.log('PASS cutover preserves legitimate old committed replay and recovery')
  assert.deepEqual(JSON.parse(await sql(`SELECT to_jsonb(p)-ARRAY['stock_managed','remaining_quantity','stock_version','image_path'] FROM public.promotions p WHERE id=${quote(legacyCampaign)}`)),legacyBefore,'Legacy promotion data must not be rewritten')
  assert.deepEqual(JSON.parse(await sql(`SELECT jsonb_build_object('stock_managed',stock_managed,'remaining_quantity',remaining_quantity,'stock_version',stock_version,'image_path',image_path) FROM public.promotions WHERE id=${quote(legacyCampaign)}`)),{stock_managed:false,remaining_quantity:0,stock_version:1,image_path:null},'Actual migrated legacy defaults remain unchanged')
  const imagePath = `promotions/${admin}/${managedCampaign}/${image}.webp`
  await sql(`INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('promotion-images',${quote(imagePath)},${quote(admin)},'{"size":128,"mimetype":"image/webp"}');`)
  resultJson(await start(transaction(`SELECT public.pilot_promotion_transaction_v1(${quote(randomUUID())},'create_promotion',${json({id:managedCampaign,product_id:managedProduct,opening_quantity:3,image_path:imagePath,harga_pokok:null,luar_kota:0,dalam_kota:71,depo_bangunan:null,is_active:true})})`)).result)
  const promotionRead = resultJson(await start(transaction('SELECT public.pilot_promotions_v1(true)')).result)
  const legacy = promotionRead.items.find(row => row.id === legacyCampaign), managed = promotionRead.items.find(row => row.id === managedCampaign)
  assert.equal(legacy.stock_managed,false)
  assert.equal(legacy.remaining_quantity,null,'Nonmanaged wire balance is unknown, never the database zero default')
  assert.equal(managed.stock_managed,true); assert.equal(managed.remaining_quantity,3); assert.equal(managed.stock_version,1)
  assert.equal(await sql(`SELECT count(*) FROM private.pilot_promo_movements WHERE promotion_id=${quote(legacyCampaign)}`),'0','No legacy stock is invented')
  console.log(`DEMO_PROMOTION_READ_CONTRACT=${JSON.stringify(promotionRead)}`)
  console.log('DEMO_LEGACY_PROMOTION_READ_CONTRACT_PASSED')
  console.log('DEMO_ORDER_PROMOTION_CUTOVER_PASSED')
} finally {
  const pending = [...sessions.entries()]
  for (const [child] of pending) child.kill('SIGTERM')
  await Promise.all(pending.map(([,result]) => result))
}
