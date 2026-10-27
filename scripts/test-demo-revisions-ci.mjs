// Fixed disposable PostgreSQL composition. Never a hosted migration runner.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
export function demoCiConnection(env) {
 assert.equal(env.PGHOST, '127.0.0.1', 'Fixed loopback service required')
 assert.equal(env.PGUSER, 'postgres', 'Disposable fixture owner required')
 assert.equal(env.PGDATABASE, 'pilot_test', 'Fixed disposable database required')
 assert.match(env.PGPORT ?? '', /^\d{1,5}$/, 'Explicit numeric PostgreSQL port required')
 assert.ok(Number(env.PGPORT) > 0 && Number(env.PGPORT) <= 65535)
 const result = { PATH: env.PATH, ...(env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: env.LD_LIBRARY_PATH } : {}), PGHOST: '127.0.0.1', PGPORT: env.PGPORT, PGUSER: 'postgres', PGDATABASE: 'pilot_test', PGCONNECT_TIMEOUT: '5', PGTZ: 'UTC' }
 // The password is a fictional constant, only for the exact known ephemeral CI service.
 if (env.PGPORT === '5432' && env.PGPASSWORD === 'synthetic-ci-only' && env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === 'pl0203/lou_erp' && /^\d+$/.test(env.GITHUB_RUN_ID ?? '') && env.GITHUB_JOB === 'synthetic-safety' && env.GITHUB_WORKFLOW === 'Pilot safety checks') result.PGPASSWORD = 'synthetic-ci-only'
 if (!result.PGPASSWORD) assert.ok(Number(env.PGPORT) >= 1024 && env.PGPORT !== '5432', 'Nondefault local fixture port or exact bounded CI service required')
 return result
}
export function runDemoRevisionsCi({ env = process.env, execute = execFileSync, repoRoot = process.cwd() } = {}) {
 const connection = demoCiConnection(env)
 const run = (sql, database = 'pilot_test') => execute('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { env: { ...connection, PGDATABASE: database }, input: sql, encoding: 'utf8', timeout: 180000, shell: false, stdio: ['pipe','pipe','pipe'] })
 const file = path => readFileSync(`${repoRoot}/${path}`, 'utf8')
 const suite = path => { console.log(`DEMO_SQL_SUITE ${path}`); const output = execute('psql', ['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','--file',`${repoRoot}/${path}`], { cwd: repoRoot, env: connection, encoding: 'utf8', timeout: 180000, shell: false, stdio: ['pipe','pipe','pipe'] }); process.stdout.write(output); }
 const node = (path, database = 'pilot_test', capture = false) => execute(process.execPath, [path], { cwd: repoRoot, env: { ...connection, PGDATABASE: database }, encoding: 'utf8', timeout: 180000, shell: false, stdio: capture ? ['pipe','pipe','pipe'] : 'inherit' })
 assert.equal(run(`SELECT current_database()='pilot_test' AND current_user='postgres' AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND ${connection.PGPASSWORD ? 'true' : "inet_server_addr()='127.0.0.1'::inet"} AND (SELECT count(*) FROM public.pilot_fixture_marker)=1 AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci');`).trim(), 't', 'PostgreSQL 17 disposable fixture required')
 assert.equal(run("SELECT to_regclass('private.pilot_visit_requests') IS NULL AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='po_line_items' AND column_name='product_id');").trim(), 't', 'Exact pre-demo stage required; never reapply/reset')
 const cutoverDb = 'pilot_demo_cutover_test'
 run(`CREATE DATABASE ${cutoverDb};`, 'postgres')
 run(file('tests/database/fixture.sql'), cutoverDb)
 const migrations = readdirSync(`${repoRoot}/supabase/migrations`).filter(f => f.endsWith('.sql')).sort()
 for (const name of migrations.filter(f => f < '202610010001_scalable_order_reads.sql')) run(file(`supabase/migrations/${name}`), cutoverDb)
 const topology = file('tests/database/hosted-read-policy-fixture.sql')
 assert.equal(topology.split("current_database()<>'pilot_test'").length, 2)
 run(topology.replace("current_database()<>'pilot_test'", `current_database()<>'${cutoverDb}'`), cutoverDb)
 for (const name of migrations.filter(f => f >= '202610010001_scalable_order_reads.sql' && f < '202610081101_demo_order_promotions.sql')) run(file(`supabase/migrations/${name}`), cutoverDb)
 const storage = file('tests/database/demo/storage-fixture.sql')
 assert.equal(storage.split("current_database()<>'pilot_test'").length, 2)
 run(storage.replace("current_database()<>'pilot_test'", `current_database()<>'${cutoverDb}'`), cutoverDb)
 const cutoverOutput = node('tests/database/demo/order-promo-cutover.mjs', cutoverDb, true)
 process.stdout.write(cutoverOutput)
 const contracts = cutoverOutput.split('\n').filter(line => line.startsWith('DEMO_PROMOTION_READ_CONTRACT='))
 assert.equal(contracts.length, 1, 'One actual migrated promotion read contract required')
 execute(process.execPath, [`${repoRoot}/node_modules/vitest/vitest.mjs`,'run','tests/demo/promotion-admin.test.tsx','--maxWorkers=1'], { cwd: repoRoot, env: { ...connection, VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-test-key', DEMO_PROMOTION_CONTRACT_JSON: contracts[0].slice('DEMO_PROMOTION_READ_CONTRACT='.length) }, timeout: 180000, shell: false, stdio: 'inherit' })
 console.log('DEMO_ACTUAL_PROMOTION_SQL_CLIENT_PAGE_CONTRACT_PASSED')
 suite('tests/database/demo/storage-fixture.sql')
 // The actual old finalize RPC creates its own committed legacy receipt before cutover.
 suite('tests/database/demo/visit-legacy-recovery-seed.sql')
 for (const name of ['202610081101_demo_order_promotions.sql','202610081102_demo_visit_workflow.sql','202610081103_demo_sales_reporting.sql','202610081104_demo_sales_assignment_cardinality.sql']) suite(`supabase/migrations/${name}`)
 for (const name of ['order-transactions.sql','visit-transactions.sql','demo/order-promotions.sql','demo/order-promotion-review.sql','demo/order-line-identity-unit.sql','demo/visit-workflow.sql','demo/visit-recovery-families.sql','demo/sales-reporting.sql','demo/sales-assignment-cardinality.sql']) suite(`tests/database/${name}`)
 // All three run after the complete migration composition with explicit UTC sessions.
 for (const path of ['tests/database/concurrency.mjs','tests/database/demo/order-promo-concurrency.mjs','tests/database/demo/visit-races.mjs']) node(path)
 console.log('DEMO_REVISIONS_COMPOSED_DATABASE_PASSED')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 assert.equal(process.argv.length, 2, 'No custom runner arguments')
 runDemoRevisionsCi()
}
