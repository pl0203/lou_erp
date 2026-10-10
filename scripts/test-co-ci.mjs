// Fixed composition for a NEW synthetic PostgreSQL service. Never a rollout runner.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { buildEvidenceTopologyChecks } from '../tests/database/co/evidence-topology.mjs'
import { buildAccessTopologyChecks } from '../tests/database/co/access-topology.mjs'
import { dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { coCiConnection, coBindFixtureServer, coSourceIdentity, CO_FIXTURE_OBSERVATION_SQL, coCreateFixtureIdentitySql, coVerifyFixtureIdentitySql, coFixtureChildEnv } from './co-fixture-target.mjs'
export { coCiConnection, coBindFixtureServer } from './co-fixture-target.mjs'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const markerDatabase = 'pilot_test'
const testDatabase = 'pilot_co_test'
const stages = ['01', '02', '03', '04', '05', '06', '07', '08']

export function coCiThrough(args) {
  if (args.length === 0) return '08'
  assert.ok(args.length === 2 && args[0] === '--through' && stages.includes(args[1]), 'Only --through 01 through 08 is accepted')
  return args[1]
}

// Explicit baseline, including fixture topology boundaries. Never discover future SQL by glob.
const baseline = [
  'tests/database/fixture.sql',
  'supabase/migrations/202609300001_pilot_security.sql',
  'supabase/migrations/202609300002_order_transactions.sql',
  'supabase/migrations/202609300003_visit_storage_security.sql',
  'supabase/migrations/202609300004_visit_transactions.sql',
  'tests/database/hosted-read-policy-fixture.sql',
  'supabase/migrations/202610010001_scalable_order_reads.sql',
  'supabase/migrations/202610010002_scalable_report_reads.sql',
  'supabase/migrations/202610010004_scalable_order_lookup_index.sql',
  'supabase/migrations/202610010007_read_policy_plans.sql',
  'supabase/migrations/202610010008_customer_delivery_aggregation.sql',
  'supabase/migrations/202610010009_sales_page_enrichment.sql',
  'supabase/migrations/202610010010_nullable_catalog_prices.sql',
  'supabase/migrations/202610020001_customer_categories.sql',
  'supabase/migrations/202610020003_stale_po_conflicts.sql',
  'supabase/migrations/202610021001_ihr_leave_foundation.sql',
  'supabase/migrations/202610021002_ihr_leave_calendar.sql',
  'supabase/migrations/202610021003_ihr_leave_accounts.sql',
  'supabase/migrations/202610021004_ihr_leave_quote.sql',
  'supabase/migrations/202610021005_ihr_leave_requests.sql',
  'supabase/migrations/202610021006_ihr_leave_reads.sql',
  'supabase/migrations/202610021007_ihr_leave_admin.sql',
  'supabase/migrations/202610021008_ihr_leave_context.sql',
  'supabase/migrations/202610081001_ihr_po_admin_director.sql',
  'tests/database/demo/storage-fixture.sql',
  'supabase/migrations/202610081101_demo_order_promotions.sql',
  'supabase/migrations/202610081102_demo_visit_workflow.sql',
  'supabase/migrations/202610081103_demo_sales_reporting.sql',
  'supabase/migrations/202610081104_demo_sales_assignment_cardinality.sql',
  'tests/database/demo/store-owner-seed.sql',
  'supabase/migrations/20261009061801_unify_store_owner_credit.sql',
]
const coStages = {
  '01': [
    'supabase/migrations/20261009110000_co_role.sql',
    'supabase/migrations/20261009110001_co_foundation.sql',
    'tests/database/co/fixture.sql',
    'tests/database/co/foundation.sql',
  ],
  '02': [
    'supabase/migrations/20261009110002_co_orders_deliveries.sql',
    'tests/database/co/orders-deliveries.sql',
  ],
  '03': [
    'supabase/migrations/20261009110003_co_monthly_fifo.sql',
    'tests/database/co/monthly-fifo.sql',
  ],
  '04': ['supabase/migrations/20261009110004_co_returns_corrections.sql', 'tests/database/co/corrections.sql'],
  '05': ['supabase/migrations/20261009110005_co_reads.sql', 'tests/database/co/reads.sql'],
  '06': ['supabase/migrations/20261009110006_co_reporting.sql', 'tests/database/co/sales-metrics.sql'],
  '07': ['supabase/migrations/20261009110007_co_access.sql', 'tests/database/co/access.sql', 'tests/database/co/hr-preservation.sql'],
  '08': ['tests/database/co/evidence-storage-fixture.sql', 'supabase/migrations/20261009110008_co_evidence.sql', 'tests/database/co/evidence.sql'],
}

// Exact protected business tables, checked before/after the stage-02 migration and suite.
const protectedTables = [
  'public.purchase_orders', 'public.po_line_items', 'public.po_audit_log', 'public.surat_jalan', 'public.sj_line_items',
  'public.girard_orders', 'public.girard_order_items', 'public.promotions',
  'private.pilot_promo_slices', 'private.pilot_promo_movements', 'private.pilot_promotion_requests',
  'private.pilot_store_credit_corrections_v1', 'private.pilot_store_owner_audit_v1',
  // HR business state is immutable across access changes and rollback-only fixtures.
  'public.ihr_leave_members',
  'public.ihr_leave_access_grants',
  'public.ihr_leave_approvers',
  'public.ihr_leave_admin_events',
  'private.ihr_leave_commands',
  'private.ihr_leave_scope_revision',
  'public.ihr_leave_policies',
  'private.ihr_leave_calendar_registry',
  'public.ihr_leave_calendars',
  'public.ihr_leave_calendar_exceptions',
  'public.ihr_saturday_groups',
  'public.ihr_saturday_memberships',
  'public.ihr_saturday_roster',
  'public.ihr_leave_accounts',
  'public.ihr_leave_ledger',
  'public.ihr_leave_requests',
  'public.ihr_leave_request_days',
  'public.ihr_leave_request_allocations',
  'public.ihr_leave_occupancy',
  'private.ihr_leave_request_events',
  'private.ihr_leave_cancellation_attempts',
  'private.ihr_leave_cancellation_decisions',
  'private.ihr_leave_charge_reversals',
  'private.ihr_leave_policy_owners',
  'private.ihr_leave_access_manifests',
  'private.ihr_leave_governance_approvals',
  'private.ihr_leave_governance_references',
  'private.ihr_leave_request_reassignments',

]
const protectedFingerprintSql = `-- CO_PROTECTED_BASELINE_FINGERPRINT
SELECT encode(sha256(convert_to(jsonb_agg(x ORDER BY x.name)::text,'UTF8')),'hex') FROM (
${protectedTables.map(name => `SELECT '${name}' AS name,coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${name} t`).join('\nUNION ALL\n')}
) x;`

export function runCoFinalChecks({run,decode,read,protectedBefore}) {
 let evidence=''
 for(const [path,marker,decoder] of [
  ['foundation.sql','CO_FOUNDATION_AND_COMMANDS_PASSED'],
  ['monthly-fifo.sql','CO_MONTHLY_FIFO_PASSED'],
  ['corrections.sql','CO_RETURNS_CORRECTIONS_PASSED'],
  ['reads.sql','CO_OPERATIONAL_READS_PASSED','decode-reads.mjs'],
  ['sales-metrics.sql','CO_SALES_METRICS_PASSED','decode-sales-metrics.mjs'],
  ['rollout.sql','CO_FINAL_AUDIENCES_PASSED'],
 ]) {
  const output=run(read('tests/database/co/'+path))
  assert.equal(output.split('\n').filter(line=>line===marker).length,1,`Final ${marker} marker required exactly once`)
  if(decoder){
   const decoded=decode('tests/database/co/'+decoder,output)
   const expected=decoder==='decode-reads.mjs'?'CO_SQL_DECODERS_PASSED':'CO_SALES_METRICS_DECODERS_PASSED'
   assert.equal(decoded.split('\n').filter(line=>line===expected).length,1,`Final actual ${expected} marker required exactly once`)
   evidence+=decoded.replace(expected,expected.replace('CO_','CO_FINAL_'))+'\n'
  }
  assert.equal(run(protectedFingerprintSql).trim(),protectedBefore,'Final protected business/HR data changed')
 }
 return evidence
}

export function runCoCi({ env = process.env, execute = execFileSync, through = '08', sourceIdentity = coSourceIdentity } = {}) {
  const ciSource = env.CO_CI_PROFILE ? sourceIdentity() : undefined
  const connection = coCiConnection(env, ciSource)
  const source = ciSource ?? sourceIdentity()
  const profile = { kind: env.CO_CI_PROFILE ? 'ci' : 'local', source, runIdentity: env.CO_CI_PROFILE ? `${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}` : randomUUID() }
  assert.ok(stages.includes(through), 'Invalid CO stage')
  const selected = stages.filter(stage => stage <= through)
  for (const stage of selected) assert.ok(coStages[stage], `CO stage ${stage} is not implemented`)
  const run = (sql, database = testDatabase, cwd = repoRoot) => execute('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    env: { ...connection, PGDATABASE: database }, cwd, input: sql, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  })
  assert.equal(run(`SELECT current_database()='pilot_test' AND current_user='postgres'
    AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999
    AND ${profile.kind === 'local' ? "inet_server_addr()='127.0.0.1'::inet" : "(inet_server_addr()<<='127.0.0.0/8'::inet OR inet_server_addr()<<='10.0.0.0/8'::inet OR inet_server_addr()<<='172.16.0.0/12'::inet OR inet_server_addr()<<='192.168.0.0/16'::inet)"} AND inet_server_port()=${connection.PGPORT}
    AND (SELECT pg_get_userbyid(datdba)='postgres' FROM pg_database WHERE datname=current_database())
    AND (SELECT relowner='postgres'::regrole AND relkind='r' FROM pg_class WHERE oid='public.pilot_fixture_marker'::regclass)
    AND (SELECT count(*) FROM public.pilot_fixture_marker)=1
    AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci');`, markerDatabase).trim(), 't', 'PostgreSQL 17 disposable marker and owner required')
  assert.equal(run("SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='pilot_co_test');", markerDatabase).trim(), 't', 'pilot_co_test already exists; use a new disposable service')
  const identity = coBindFixtureServer(profile, JSON.parse(run(CO_FIXTURE_OBSERVATION_SQL, markerDatabase)))
  const verifyFixture = database => {
    coBindFixtureServer({ ...profile, database }, JSON.parse(run(CO_FIXTURE_OBSERVATION_SQL, database)), identity)
    assert.equal(run(coVerifyFixtureIdentitySql(identity), database).trim(), 't', 'Exact source/run/server fixture marker required')
  }
  run('CREATE DATABASE pilot_co_test OWNER postgres;', markerDatabase)
  const fixtureTargets = new Set(['tests/database/hosted-read-policy-fixture.sql', 'tests/database/demo/storage-fixture.sql', 'tests/database/demo/store-owner-seed.sql'])
  let protectedBefore
  for (const path of [...baseline, ...selected.flatMap(stage => coStages[stage])]) {
    if (path === 'supabase/migrations/20261009110000_co_role.sql') {
      coBindFixtureServer({ ...profile, database: testDatabase }, JSON.parse(run(CO_FIXTURE_OBSERVATION_SQL)), identity)
      run(coCreateFixtureIdentitySql(identity))
      verifyFixture(testDatabase)
      if (through === '08') {
        assert.equal(run("SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='pilot_co_rollout_test');", markerDatabase).trim(), 't', 'pilot_co_rollout_test already exists; no reset or reuse')
        run('CREATE DATABASE pilot_co_rollout_test WITH TEMPLATE pilot_co_test OWNER postgres;', markerDatabase)
        verifyFixture('pilot_co_rollout_test')
      }
    }
    if (path === 'supabase/migrations/20261009110002_co_orders_deliveries.sql') {
      protectedBefore = run(protectedFingerprintSql).trim()
      assert.match(protectedBefore, /^[a-f0-9]{64}$/, 'Protected baseline fingerprint required')
    }
    let sql = readFileSync(new URL(path, pathToFileURL(repoRoot)), 'utf8')
    if (fixtureTargets.has(path)) {
      assert.equal(sql.split("current_database()<>'pilot_test'").length, 2, 'Exact fixture target guard required')
      sql = sql.replace("current_database()<>'pilot_test'", "current_database()<>'pilot_co_test'")
    }
    if (path === 'supabase/migrations/20261009110007_co_access.sql') {
      const topology = run(buildAccessTopologyChecks(sql))
      assert.equal(topology.split('\n').filter(line => line === 'CO_ACCESS_TOPOLOGY_PASSED').length, 1, 'Access topology success marker required exactly once')
      assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed (including HR)')
      process.stdout.write(topology)
    }
    if (path === 'supabase/migrations/20261009110008_co_evidence.sql') {
      const topology=run(buildEvidenceTopologyChecks(sql))
      assert.equal(topology.split('\n').filter(line=>line==='CO_EVIDENCE_TOPOLOGY_PASSED').length,1,'Evidence topology success marker required exactly once')
      assert.equal(run(protectedFingerprintSql).trim(),protectedBefore,'Protected PO/promotion/owner baseline changed (evidence topology)')
      process.stdout.write(topology)
    }
    // Separate processes commit each enum/migration stage before the next SQL uses it.
    const output = run(sql, testDatabase, dirname(fileURLToPath(new URL(path, pathToFileURL(repoRoot)))))
    if (['supabase/migrations/20261009110007_co_access.sql','supabase/migrations/20261009110008_co_evidence.sql'].includes(path)) assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed (including HR)')
    if (['tests/database/co/access.sql', 'tests/database/co/hr-preservation.sql'].includes(path)) {
      const marker = path.endsWith('/access.sql') ? 'CO_ACCESS_BOUNDARIES_PASSED' : 'CO_HR_PRESERVATION_PASSED'
      assert.equal(output.split('\n').filter(line => line === marker).length, 1, `${marker} required exactly once`)
      assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed (including HR)')
      process.stdout.write(output)
    }
    if (path === 'supabase/migrations/20261009110004_co_returns_corrections.sql') {
      // Stage02 intentionally asserts its old delivery-only blocker; preserve it at its original checkpoint.
      // Foundation and the latest monthly contract can also be checked against the final schema.
      for (const [suite, marker] of [
        ['tests/database/co/foundation.sql', 'CO_FOUNDATION_AND_COMMANDS_PASSED'],
        ['tests/database/co/monthly-fifo.sql', 'CO_MONTHLY_FIFO_PASSED'],
      ]) {
        const checked = run(readFileSync(new URL(suite, pathToFileURL(repoRoot)), 'utf8'))
        assert.equal(checked.split('\n').filter(line => line === marker).length, 1, `Prior checkpoint ${marker} must still pass after stage04`)
      }
      assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed')
    }
    if (path === 'tests/database/co/sales-metrics.sql') {
      assert.equal(output.split('\n').filter(line => line === 'CO_SALES_METRICS_PASSED').length, 1, 'Sales metrics success marker required exactly once')
      const decoded = execute(process.execPath, [fileURLToPath(new URL('tests/database/co/decode-sales-metrics.mjs', pathToFileURL(repoRoot)))], {
        env: connection, input: output, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      })
      assert.equal(decoded.split('\n').filter(line => line === 'CO_SALES_METRICS_DECODERS_PASSED').length, 1, 'Actual Sales metrics decoder success marker required exactly once')
      assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed')
      process.stdout.write('CO_SALES_METRICS_PASSED\n' + decoded)
    }
    if (path === 'tests/database/co/reads.sql') {
      assert.equal(output.split('\n').filter(line => line === 'CO_OPERATIONAL_READS_PASSED').length, 1, 'Operational reads success marker required exactly once')
      const decoded = execute(process.execPath, [fileURLToPath(new URL('tests/database/co/decode-reads.mjs', pathToFileURL(repoRoot)))], {
        env: connection, input: output, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      })
      assert.equal(decoded.split('\n').filter(line => line === 'CO_SQL_DECODERS_PASSED').length, 1, 'Actual SQL decoder success marker required exactly once')
      assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed')
      process.stdout.write('CO_OPERATIONAL_READS_PASSED\n' + decoded)
    }
    if (path === 'tests/database/co/orders-deliveries.sql') {
      assert.equal(output.split('\n').filter(line => line === 'CO_ORDERS_DELIVERIES_PASSED').length, 1, 'Orders/deliveries success marker required exactly once')
      assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed')
      process.stdout.write(output)
    }
    if (path === 'tests/database/co/evidence.sql') {
      assert.equal(output.split('\n').filter(line => line === 'CO_EVIDENCE_PASSED').length, 1, 'Evidence success marker required exactly once')
      assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed')
      process.stdout.write(output)
    }
    if (path === 'tests/database/co/corrections.sql') {
      assert.equal(output.split('\n').filter(line => line === 'CO_RETURNS_CORRECTIONS_PASSED').length, 1, 'Returns/corrections success marker required exactly once')
      assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed')
      process.stdout.write(output)
    }
    if (path === 'tests/database/co/monthly-fifo.sql') {
      assert.equal(output.split('\n').filter(line => line === 'CO_MONTHLY_FIFO_PASSED').length, 1, 'Monthly FIFO success marker required exactly once')
      assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed')
      process.stdout.write(output)
    }
    if (path === 'tests/database/co/foundation.sql') {
      assert.equal(output.split('\n').filter(line => line === 'CO_FOUNDATION_AND_COMMANDS_PASSED').length, 1, 'Foundation success marker required exactly once')
      process.stdout.write(output)
    }
  }
  if(through==='08') {
   process.stdout.write(runCoFinalChecks({run,protectedBefore,
    read:path=>readFileSync(new URL(path,pathToFileURL(repoRoot)),'utf8'),
    decode:(path,input)=>execute(process.execPath,[fileURLToPath(new URL(path,pathToFileURL(repoRoot)))],{env:connection,input,encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000,shell:false,stdio:['pipe','pipe','pipe']}),
   }))
   const lifecycle=execute(process.execPath,[fileURLToPath(new URL('tests/database/co/rollout.mjs',pathToFileURL(repoRoot)))],{
    env:coFixtureChildEnv(connection,env,identity),encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000,shell:false,stdio:['pipe','pipe','pipe'],
   })
   assert.equal(lifecycle.split('\n').filter(line=>line==='CO_ATOMIC_ROLLOUT_LIFECYCLE_PASSED').length,1,'Atomic rollout lifecycle marker required exactly once')
   assert.equal(run(protectedFingerprintSql).trim(),protectedBefore,'Rollout companion changed primary protected data')
   process.stdout.write(lifecycle)
  }

  if (through >= '04') {
    assert.equal(run("SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='pilot_co_race_test');", markerDatabase).trim(), 't', 'pilot_co_race_test already exists; use a new disposable service')
    run('CREATE DATABASE pilot_co_race_test WITH TEMPLATE pilot_co_test OWNER postgres;', markerDatabase)
    verifyFixture('pilot_co_race_test')
    const races = execute(process.execPath, [fileURLToPath(new URL('tests/database/co/races.mjs', pathToFileURL(repoRoot)))], {
      env: coFixtureChildEnv(connection, env, identity), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    })
    assert.equal(races.split('\n').filter(line => line === 'CO_REAL_RACES_PASSED').length, 1, 'Real races success marker required exactly once')
    if (through === '08') assert.equal(races.split('\n').filter(line => line === 'CO_EVIDENCE_REAL_RACES_PASSED').length, 1, 'Evidence real races success marker required exactly once')
    assert.equal(run(protectedFingerprintSql).trim(), protectedBefore, 'Protected PO/promotion/owner baseline changed')
    process.stdout.write(races)
  }
  if(through==='08') process.stdout.write('CO_FINAL_COMPOSED_DATABASE_PASSED\n')

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runCoCi({ through: coCiThrough(process.argv.slice(2)) }) }
  catch (error) {
    process.stderr.write(`${error.stdout || ''}${error.stderr || error.message}\n`)
    process.exitCode = 1
  }
}
