// Synthetic PostgreSQL 17 only. Creates its own temporary loopback-only cluster.
// Deliberately accepts no database URL, host, credentials or existing cluster.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const fallback = resolve(root, '../po-admin-pg-runtime/root/usr/lib/postgresql/17/bin')
const bin = process.env.SALES_TARGETS_PG_BIN ?? fallback
assert.ok(existsSync(join(bin, 'postgres')), 'PostgreSQL 17 binaries required via SALES_TARGETS_PG_BIN')
if (process.argv.includes('--full-source')) {
  const { runFullComposition } = await import('../tests/database/sales-targets/full-composition.mjs')
  await runFullComposition({bin,root})
}
const temp = mkdtempSync(join(tmpdir(), 'sales-targets-synthetic-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && !/DATABASE_URL|SUPABASE/.test(key)))
env.LD_LIBRARY_PATH = resolve(bin, '../../../../lib/x86_64-linux-gnu')
env.PGHOST = '127.0.0.1'; env.PGPORT = '55439'; env.PGUSER = 'synthetic_owner'; env.PGDATABASE = 'postgres'
const run = (program, args, options = {}) => execFileSync(join(bin, program), args, { env, encoding: 'utf8', stdio:['pipe','pipe','pipe'], timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...options })
const sql = input => run('psql', ['-X', '-qAt', '--no-password', '-v', 'ON_ERROR_STOP=1'], { input })
const file = name => sql(readFileSync(join(root, name), 'utf8'))
let started = false
try {
  run('initdb', ['-D', join(temp, 'data'), '-U', env.PGUSER, '--auth=trust', '--no-locale', '--encoding=UTF8'])
  run('pg_ctl', ['-D', join(temp, 'data'), '-l', join(temp, 'server.log'), '-o', `-h 127.0.0.1 -c unix_socket_directories='' -p ${env.PGPORT} -c jit=off -c timezone=UTC`, '-w', 'start'])
  started = true
  assert.equal(sql("select current_setting('server_version_num')::int between 170000 and 179999 and inet_server_addr()='127.0.0.1'::inet").trim(), 't')
  file('tests/database/sales-targets/fixture.sql')
  file('tests/database/sales-targets/source-contract-fixture.sql')
  const protectedTables = ['public.users','public.customers','public.customer_manager_assignments','public.purchase_orders','public.po_line_items','public.surat_jalan','public.sj_line_items','public.sales_schedules','public.outlet_visits','public.visit_requests','public.sales_targets','private.co_orders','private.co_customer_state','private.co_delivery_heads','private.co_delivery_revisions','private.co_delivery_revision_lines','private.co_report_heads','private.co_report_revisions','private.co_stock_batches','private.co_sale_allocations','private.co_stock_movements']
  const fingerprint = () => sql(protectedTables.map(table => `SELECT '${table}',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text) FROM ${table} t`).join(';'))
  const protectedBefore = fingerprint()

  if (!process.argv.includes('--red')) {
    for (const f of ['01-foundation.sql', '02-scoped-reads.sql', '03-commands.sql', '04-preflight-postflight.sql']) file('supabase/sales_targets/v1/' + f)
    const { verifySourceGuard } = await import('../tests/database/sales-targets/source-preflight.mjs')
    verifySourceGuard({sql,root})
    file('tests/database/sales-targets/grants.sql')
  }
  for (const f of ['reads.sql', 'roles.sql', 'portfolio.sql', 'reporting.sql', 'commands.sql', 'edge-cases.sql', 'activity.sql', 'co-quality.sql', 'filters.sql', 'scalability.sql']) {
    const began = performance.now()
    const output = file('tests/database/sales-targets/' + f)
    const logDir = join(tmpdir(), 'sales-targets-sql-logs'); mkdirSync(logDir, {recursive:true}); writeFileSync(join(logDir, f + '.log'), output)
    const markers = output.trim().split('\n').filter(line => /PASSED$/.test(line))
    assert.equal(markers.length,1,'Each suite must report exactly one success marker')
    process.stdout.write(f + ': ' + markers[0] + ' (' + Math.round(performance.now()-began) + ' ms)\n')
  }
  if (!process.argv.includes('--red')) {
    const { runRaces } = await import('../tests/database/sales-targets/races.mjs')
    await runRaces({ sql, spawnSql: input => new Promise(resolve => {
      const proc = spawn(join(bin, 'psql'), ['-X', '-qAt', '--no-password', '-v', 'ON_ERROR_STOP=1'], { env })
      let output = ''; let error = ''
      proc.stdout.on('data', data => { output += data }); proc.stderr.on('data', data => { error += data })
      proc.on('close', code => resolve({ code, output, error })); proc.stdin.end(input)
    }) })
  }
  if (!process.argv.includes('--red')) {
    const { decodeBaseline, decodePlan, decodeReceipt, decodePlansPage } = await import('../src/lib/salesTargets/contracts.ts')
    const { decodeDashboard } = await import('../src/lib/salesDashboard/contracts.ts')
    const sampleDir = join(tmpdir(), 'sales-targets-contract-samples')
    mkdirSync(sampleDir, { recursive: true })
    const sample = (name, query) => {
      const data = JSON.parse(sql(query).trim().split('\n').at(-1))
      writeFileSync(join(sampleDir, name + '.json'), JSON.stringify(data, null, 2))
      return data
    }
    const identity = id => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false);`
    const manager = '10000000-0000-4000-8000-000000000003'
    const baseline = sample('baseline', identity(manager) + `SELECT public.pilot_sales_target_baseline_v1('2026-10-01','${manager}');`)
    decodeBaseline({month:'2026-10-01',managerId:manager},baseline)
    for (const [scope, id] of [['own','10000000-0000-4000-8000-000000000004'],['team',manager],['leadership','10000000-0000-4000-8000-000000000002']]) {
      const data = sample('dashboard-' + scope, identity(id) + `SELECT public.pilot_sales_dashboard_v3('2027-01-01','${scope}',NULL,1,20,'');`)
      decodeDashboard({p_month:'2027-01-01',p_scope:scope,p_manager_id:null,p_page:1,p_page_size:20,p_search:''},data)
    }
    const page = sample('plans',identity(manager) + `SELECT public.pilot_sales_target_plans_v1('2027-01-01',1,20);`)
    decodePlansPage({month:'2027-01-01',page:1,pageSize:20},page)
    const plan = sample('plan',identity(manager) + `SELECT public.pilot_sales_target_plan_v1('${page.items[0].id}');`)
    decodePlan(plan)
    const published = page.items.find(item => item.state === 'published')
    const auditRevision = sample('audit-revision-plan',identity(manager) + `BEGIN;
      DO $audit$ DECLARE revision jsonb; BEGIN
        revision:=public.pilot_sales_target_command_v1(gen_random_uuid(),'propose_revision',jsonb_build_object('planId','${published.id}','expectedVersion',${published.version},'reason','Synthetic audit revision rationale'));
        PERFORM set_config('test.audit_sample',revision#>>'{plan,id}',true);
        PERFORM public.pilot_sales_target_command_v1(gen_random_uuid(),'save_draft',public.test_payload('2027-01-01')||jsonb_build_object('planId',revision#>>'{plan,id}','expectedVersion',1,'lines',(SELECT jsonb_agg(line||'{"amount":"130.00","reason":"Synthetic revised target"}'::jsonb) FROM jsonb_array_elements(public.test_lines())line)));
      END $audit$;
      SELECT public.pilot_sales_target_plan_v1(current_setting('test.audit_sample')::uuid); ROLLBACK;`)
    decodePlan(auditRevision);assert.equal(auditRevision.auditEvents[0].before.lines[0].amount,'120.00');assert.equal(auditRevision.auditEvents[1].after.lines[0].amount,'130.00')
    const receipt = sample('receipt',identity(manager) + `SELECT public.pilot_sales_target_reconcile_v1('40000000-0000-4000-8000-000000000001');`)
    decodeReceipt('40000000-0000-4000-8000-000000000001',receipt)
    const ownPlan = sample('own-plan',identity('10000000-0000-4000-8000-000000000004') + `SELECT public.pilot_sales_target_plan_v1('${page.items.find(x=>x.state==='published').id}');`)
    decodePlan(ownPlan);assert.equal(ownPlan.baselineSnapshot,null);assert.equal(ownPlan.lines.length,3)
    const capability = sample('capability',identity(manager) + 'SELECT public.pilot_sales_targets_capability_v1();')
    assert.deepEqual(capability,{schemaVersion:1,available:true})
    const returnedPage = JSON.parse(sql(identity(manager) + "SELECT public.pilot_sales_target_plans_v1('2027-04-01',1,20);").trim().split('\n').at(-1))
    const returned = sample('returned-plan',identity(manager) + `SELECT public.pilot_sales_target_plan_v1('${returnedPage.items[0].id}');`)
    decodePlan(returned);assert.equal(returned.state,'returned');assert.ok(returned.returnReason)
    sql('UPDATE private.sales_target_schema SET enabled=false')
    const disabled = sample('capability-disabled',identity(manager) + 'SELECT public.pilot_sales_targets_capability_v1();')
    assert.deepEqual(disabled,{schemaVersion:1,available:false})
    const recovered = sample('reconcile-disabled',identity(manager) + "SELECT public.pilot_sales_target_reconcile_v1('40000000-0000-4000-8000-000000000001');")
    decodeReceipt('40000000-0000-4000-8000-000000000001',recovered);assert.equal(recovered.status,'committed')
    sql('UPDATE private.sales_target_schema SET enabled=true')

    console.log('ACTUAL_SQL_TYPED_DECODERS_PASSED ' + sampleDir)
  }
  assert.equal(fingerprint(),protectedBefore,'Source counts/credit/source data and legacy targets must remain unchanged')
  console.log('SOURCE_AND_LEGACY_FINGERPRINTS_UNCHANGED')
  console.log('SALES_TARGETS_SYNTHETIC_PASSED')
} catch (error) {
  if (existsSync(join(temp, 'server.log'))) console.error(readFileSync(join(temp, 'server.log'), 'utf8'))
  throw error
} finally {
  if (started) run('pg_ctl', ['-D', join(temp, 'data'), '-m', 'immediate', '-w', 'stop'])
  rmSync(temp, { recursive: true, force: true })
}
