// Appended feature proof on the already identity-bound, final synthetic CO database.
// Never accepts a hosted URL, installs a baseline, resets a database or deploys.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { coCiConnection, coSourceIdentity, coBindFixtureServer, CO_FIXTURE_OBSERVATION_SQL, coVerifyFixtureIdentitySql } from './co-fixture-target.mjs'
import { runSjReceivedDateRaces } from './sj-received-date-races.mjs'
import { runSjCatalogueFixture, sjNativeAuditFixtureSql } from './sj-catalogue-fixture.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const migrationPath = 'supabase/migrations/202610190001_sj_received_date.sql'
export const sjReceivedFingerprint = `SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'private'::regnamespace,'auth'::regnamespace)),
 'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.customers c),
 'products',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.products p),
 'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public.users u),
 'auth_users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u),
 'po_lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.po_line_items l),
 'po',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.purchase_orders p),
 'sj',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.surat_jalan s),
 'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.sj_line_items l),
 'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.po_audit_log a),
 'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_id) FROM private.pilot_order_requests r));`

export const sjReceivedCatalogueFingerprint = sjReceivedFingerprint.slice(0, -2) + ',' + [
 'catalog_co_active_v2','catalog_cutover_v1','catalog_identity_v1','catalog_requests_v1',
 'catalog_po_active_v2','catalog_create_scope_v1','catalog_target_requests_v1','catalog_target_active_v1',
 'catalog_target_policy_contract_v1','catalog_product_delete_scope_v2','catalog_product_delete_rows_v2',
 'catalog_checked_scope_v2','catalog_writer_active_v2','catalog_write_policy_contract_v1',
].map(name => `'${name}',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM private.${name} r)`).join(',') + ');'

export function runSjReceivedDateChecks({ run, read, catalogue = false }) {
 const fingerprint = catalogue ? sjReceivedCatalogueFingerprint : sjReceivedFingerprint
 const migration = read(migrationPath)
 assert.equal(migration.split('\nBEGIN;\n').length, 2)
 assert.ok(migration.endsWith('COMMIT;\n'))
 const body = migration.replace('\nBEGIN;\n', '\n').slice(0, -'COMMIT;\n'.length)
 const before = run(fingerprint).trim()
 const refuse = (sql, message) => {
  assert.throws(() => run(sql), error => String(error.stderr ?? error.message).includes(message))
  assert.equal(run(fingerprint).trim(), before, 'Refusal/failure changed the original baseline')
 }
 refuse(catalogue ? `BEGIN; ALTER TABLE private.catalog_cutover_v1 RENAME TO sj_test_missing_cutover; ${body} COMMIT;` : `BEGIN; CREATE TABLE private.catalog_cutover_v1(singleton boolean); ${body} COMMIT;`, 'CATALOGUE_REBASE_REQUIRED')
 refuse(`BEGIN; DO $drift$ DECLARE def text; BEGIN SELECT pg_get_functiondef('public.pilot_reconcile_request(uuid,boolean)'::regprocedure) INTO def; EXECUTE replace(def,'Use operation-specific recovery','Unreviewed recovery drift'); END $drift$; ${body} COMMIT;`, 'Unreviewed or partial received-date entrypoint bodies')
 refuse(`BEGIN; ALTER FUNCTION public.pilot_reconcile_request(uuid,boolean) SECURITY INVOKER; ${body} COMMIT;`, 'Received-date function security topology drift')
 assert.equal(migration.split("NOTIFY pgrst,'reload schema';").length, 2)
 refuse(migration.replace("NOTIFY pgrst,'reload schema';", "DO $failure$ BEGIN RAISE EXCEPTION 'SJ_RECEIVED_INSTALL_FAILURE'; END $failure$;"), 'SJ_RECEIVED_INSTALL_FAILURE')
 run(migration)
 const after = run(fingerprint).trim()
 assert.notEqual(after, before, 'Migration did not change the exact expected function bodies')
 const original = JSON.parse(before), installed = JSON.parse(after)
 assert.equal(installed.functions.filter((f, i) => f.prosrc !== original.functions[i].prosrc).length, catalogue ? 10 : 3, 'Unexpected changed-function inventory')
 const stripBodies = value => ({ ...value, functions: value.functions.map(({ prosrc, ...metadata }) => metadata) })
 assert.deepEqual(stripBodies(installed), stripBodies(original), 'Migration changed metadata, grants or business data')
 run(migration)
 assert.equal(run(fingerprint).trim(), after, 'Reapplication must be a true no-op')
 const output = run(read('tests/database/sj-received-date.sql'))
 assert.equal(output.split('\n').filter(x => x === 'SJ_RECEIVED_DATE_DATABASE_PASSED').length, 1)
 assert.equal(run(fingerprint).trim(), after, 'Rollback-only feature suite changed baseline')
 return output + '\nSJ_RECEIVED_DATE_MIGRATION_LIFECYCLE_PASSED\n'
}

export async function runSjReceivedDateCi({ env = process.env, execute = execFileSync, sourceIdentity = coSourceIdentity } = {}) {
 const source = sourceIdentity(), connection = coCiConnection(env, env.CO_CI_PROFILE ? source : undefined)
 const run = sql => execute('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
  cwd: root, env: { ...connection, PGDATABASE: 'pilot_co_test' }, input: sql, encoding: 'utf8', timeout: 180000,
  maxBuffer: 32 * 1024 * 1024, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
 })
 const saved = JSON.parse(run('SELECT identity FROM public.co_fixture_identity_v1 WHERE singleton;').trim())
 const runIdentity = env.CO_CI_PROFILE ? `${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}` : saved.runIdentity
 const identity = coBindFixtureServer({ kind: env.CO_CI_PROFILE ? 'ci' : 'local', database: 'pilot_co_test', source, runIdentity }, JSON.parse(run(CO_FIXTURE_OBSERVATION_SQL)), saved)
 assert.equal(run(coVerifyFixtureIdentitySql(identity)).trim(), 't', 'Exact existing CO source/run/server marker required')
 await runSjReceivedDateProfiles({
  run, read: path => readFileSync(new URL(path, pathToFileURL(root)), 'utf8'),
  races: () => runSjReceivedDateRaces({ env: { ...connection, PGDATABASE: 'pilot_co_test' } }),
 })
}
// Internal fixture composition: its caller must verify the disposable identity.
// Exposed separately so local PostgreSQL proof runs this exact CI sequence.
export async function runSjReceivedDateProfiles({ run, read, races }) {
 const unpatched = run(sjReceivedFingerprint).trim()
 // Preserve the three exact synthetic definitions, not arbitrary hosted bodies.
 const restore = JSON.parse(run(`SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN ('public.pilot_order_transaction(uuid,text,jsonb)'::regprocedure,'public.pilot_reconcile_request(uuid,boolean)'::regprocedure,'private.demo_order_execution_fence()'::regprocedure);`))
 process.stdout.write(runSjReceivedDateChecks({ run, read }))
 const beforeRaces = run(sjReceivedFingerprint).trim()
 process.stdout.write(await races())
 assert.equal(run(sjReceivedFingerprint).trim(), beforeRaces, 'Race cleanup changed original baseline')
 // Only the identity-bound disposable database is restored, with zero retained
 // feature receipts or business changes. This is NOT a deployment rollback tool.
 const strip = value => ({ ...value, functions: value.functions.map(({ prosrc, ...metadata }) => metadata) })
 assert.deepEqual(strip(JSON.parse(beforeRaces)), strip(JSON.parse(unpatched)))
 run(`BEGIN; ${restore.join(';\n')}; COMMIT;`)
 assert.equal(run(sjReceivedFingerprint).trim(), unpatched, 'Exact disposable baseline restoration failed')
 process.stdout.write(runSjCatalogueFixture({ run, read }))
 const cutoverBefore = run('SELECT to_jsonb(c) FROM private.catalog_cutover_v1 c;').trim()
 process.stdout.write(runSjReceivedDateChecks({ run, read, catalogue: true }))
 assert.equal(run('SELECT to_jsonb(c) FROM private.catalog_cutover_v1 c;').trim(), cutoverBefore, 'Migration changed catalogue generation')
 const coherentBefore = run(sjReceivedCatalogueFingerprint).trim()
 process.stdout.write(run(read('tests/database/sj-received-date-catalogue.sql')))
 assert.equal(run(sjReceivedCatalogueFingerprint).trim(), coherentBefore, 'Coherent catalogue proof changed baseline')
 run(`BEGIN; ${sjNativeAuditFixtureSql({ read })} COMMIT;`)
 const nativeBeforeRaces = run(sjReceivedCatalogueFingerprint).trim()
 process.stdout.write(run(read('tests/database/sj-received-date.sql')))
 process.stdout.write(run(read('tests/database/sj-received-date-native.sql')))
 assert.equal(run(sjReceivedCatalogueFingerprint).trim(), nativeBeforeRaces, 'Native rollback-only proofs changed baseline')
 process.stdout.write(await races())
 assert.equal(run(sjReceivedCatalogueFingerprint).trim(), nativeBeforeRaces, 'Native catalogue race cleanup changed baseline')
 process.stdout.write('SJ_RECEIVED_DATE_NATIVE_CATALOGUE_PASSED\n')

}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 assert.equal(process.argv.length, 2, 'No custom runner arguments')
 await runSjReceivedDateCi()
}
