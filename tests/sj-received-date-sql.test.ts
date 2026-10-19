// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
const path = 'supabase/migrations/202610190001_sj_received_date.sql'
test('received-date extension is an append-only guarded migration, not a historical rewrite', () => {
 expect(existsSync(path)).toBe(true)
 const sql = readFileSync(path, 'utf8')
 for (const token of ['edit_sj_received_date', 'sj_date_received', 'clock_timestamp()', 'demo_returned_date_open', 'CATALOGUE_REBASE_REQUIRED', '0b1e19441a499ae9c864b2d21aef28ba', '36cd1c50d51128e611cbdd6807412aff', '22f2bbc6ec73fc23aeeb116a8f6cf325', 'metadata', 'BEGIN;', 'COMMIT;']) expect(sql).toContain(token)
 expect(sql).not.toMatch(/GRANT\s|DISABLE\s+TRIGGER|session_replication_role/i)
})

test('guarded replacements preserve the reviewed baseline and pin the complete resulting bodies', () => {
 const migration = readFileSync(path, 'utf8')
 const source = readFileSync('supabase/migrations/202610081101_demo_order_promotions.sql', 'utf8')
 const extract = (name: string) => {
  const start = source.indexOf(`FUNCTION ${name}(`)
  expect(start).toBeGreaterThan(0)
  const bodyStart = source.indexOf('AS $$', start) + 5
  return source.slice(bodyStart, source.indexOf('$$;', bodyStart))
 }
 const actor = 'role:=private.demo_order_actor();'
 const boundary = `${actor}\n IF role='co_admin' THEN RAISE EXCEPTION 'PO access denied' USING ERRCODE='42501'; END IF;`
 const legacyBodies: Record<string, string> = {
  'public.pilot_order_transaction(uuid,text,jsonb)': extract('public.pilot_order_transaction').replace(actor, `${boundary}\n IF p_operation IN ('approve_sales','reject_sales') AND role<>'executive' THEN RAISE EXCEPTION 'Executive legacy review required' USING ERRCODE='42501'; END IF;`),
  'public.pilot_reconcile_request(uuid,boolean)': extract('public.pilot_reconcile_request').replace('IF FOUND THEN', "IF FOUND THEN\n  IF prior.operation IN ('approve_sales','reject_sales') AND role<>'executive' THEN RAISE EXCEPTION 'Executive legacy recovery required' USING ERRCODE='42501'; END IF;").replace(actor, boundary),
  'private.demo_order_execution_fence()': extract('private.demo_order_execution_fence'),
 }
 const hash = (value: string) => createHash('md5').update(value).digest('hex')
 const catalogueBodies: Record<string, string> = {}
 for (const file of ['04-order-boundaries.sql', 'new07-lifetime-admission.sql', '02-po-reference-extraction.sql', 'new09-checked-boundaries.sql', 'new10-guarded-delete.sql']) {
  const content = readFileSync(`supabase/catalogue/v1/${file}`, 'utf8')
  for (const m of content.matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+(\S+)\([^;]+?AS (\$\w*\$)([\s\S]*?)\2;/g)) catalogueBodies[m[1]] = m[3]
 }
 catalogueBodies['public.pilot_reconcile_request'] = legacyBodies['public.pilot_reconcile_request(uuid,boolean)']
 const pins = [...migration.matchAll(/\('(legacy|catalogue)','([^']+)','([a-f0-9]{32})','([a-f0-9]{32})',(true|false),'[vis]'\)/g)]
 expect(pins.filter(x => x[1] === 'legacy')).toHaveLength(3)
 expect(pins.filter(x => x[1] === 'catalogue')).toHaveLength(10)
 const rewrites = [...migration.matchAll(/\('(legacy|catalogue)','([^']+)',\d+,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$,(\d+)\)/g)]
 for (const [, profile, signature, old, next] of pins) {
  let body = profile === 'legacy' ? legacyBodies[signature] : catalogueBodies[signature.split('(')[0]]
  expect(body, signature).toBeDefined()
  expect(hash(body), signature).toBe(old)
  for (const [, patchProfile, target, from, to, occurrences] of rewrites) {
   if (target !== signature || patchProfile !== profile) continue
   expect(body.split(from).length - 1, signature).toBe(Number(occurrences))
   body = body.replaceAll(from, () => to)
  }
  expect(hash(body), signature).toBe(next)
 }
 const rpc = legacyBodies['public.pilot_order_transaction(uuid,text,jsonb)']
 expect(rpc).toContain("expected IS DISTINCT FROM po.updated_at")
 expect(rpc).toContain("role NOT IN ('po_admin','executive')")
})

test('CI runs the actual SQL lifecycle and observed-lock races only after final CO composition', () => {
 const workflow = readFileSync('.github/workflows/pilot-safety.yml', 'utf8')
 const step = workflow.indexOf('      - name: Guarded SJ received-date migration')
 expect(step).toBeGreaterThan(workflow.indexOf('      - name: Guarded final CO composition'))
 for (const marker of ['SJ_RECEIVED_DATE_DATABASE_PASSED', 'SJ_RECEIVED_DATE_MIGRATION_LIFECYCLE_PASSED', 'SJ_RECEIVED_DATE_REAL_RACES_PASSED']) expect(workflow).toContain(marker)
 const runner = readFileSync('scripts/test-sj-received-date-ci.mjs', 'utf8')
 for (const token of ['coCiConnection', 'coBindFixtureServer', 'coVerifyFixtureIdentitySql', 'sourceIdentity()', 'SJ_RECEIVED_INSTALL_FAILURE', 'Reapplication must be a true no-op', 'stripBodies(installed)', 'Race cleanup changed original baseline']) expect(runner).toContain(token)
 expect(runner).not.toMatch(/CREATE DATABASE|DROP DATABASE|DATABASE_URL|supabase db push/)
 const races = readFileSync('scripts/sj-received-date-races.mjs', 'utf8')
 for (const token of ['pg_blocking_pids', 'transactionid', 'advisory', 'clock_timestamp()>', 'PT409', '55000', "sj_date_received='2026-10-09'"]) expect(races).toContain(token)
})

test('catalogue profile extends the complete authority and durable-reference graph without cutting over', () => {
 const sql = readFileSync(path, 'utf8')
 for (const name of ['catalog_po_legacy_transaction_v1', 'catalog_po_transaction_core_v2', 'catalog_por_extract_event_v1', 'catalog_history_extract_v1', 'catalog_history_producers_v1', 'catalog_po_assert_event_v2', 'catalog_assert_checked_graph_v2']) expect(sql).toContain(name)
 expect(sql).toContain('d46364fb5b2cf057e98e3f5c03a1a0e5')
 expect(sql).toContain('f43b664954adf3b68aff927a2f5c69d2')
 expect(sql).toContain('catalog_writer_drain_v2')
 expect(sql).not.toMatch(/UPDATE\s+private\.catalog_cutover_v1|DELETE\s+FROM\s+private\.pilot_order_requests|DROP\s+TRIGGER/i)
})

test('catalogue fixture uses pinned sources and finite adaptations, never a hosted export', async () => {
 const { buildSjCatalogueFixture, sjCatalogueSourceFiles, sjNativeAuditFixtureSql } = await import('../scripts/sj-catalogue-fixture.mjs')
 const read = (name: string) => readFileSync(name, 'utf8')
 const sql = buildSjCatalogueFixture({ read })
 expect(sjCatalogueSourceFiles).toHaveLength(17)
 expect(sql.startsWith('BEGIN;')).toBe(true)
 expect(sql.endsWith('COMMIT;\n')).toBe(true)
 expect(sql).toContain('SJ_CATALOGUE_INSTALLED_FUNCTION_PARITY_PASSED')
 expect(sql).toContain('SJ_CATALOGUE_COHERENT_SYNTHETIC_GRAPH_PASSED')
 for (const [name] of sjCatalogueSourceFiles) expect(() => buildSjCatalogueFixture({ read: (path: string) => read(path) + (path.endsWith(`/${name}`) ? '\n-- unreviewed drift' : '') })).toThrow(`Catalogue candidate changed: ${name}`)
 const native = sjNativeAuditFixtureSql({ read })
 const body = native.match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1]
 expect(createHash('md5').update(body!).digest('hex')).toBe('6384834bc48bd11189b3d4387fa76a1f')
 expect(native).toContain("'sj_updated'")
 expect(native).not.toContain('catalog_history_producers_v1')
 expect(native).not.toContain('catalog_assert_checked_graph_v2')
 const module = read('scripts/sj-catalogue-fixture.mjs')
 expect(module).not.toMatch(/hosted-preflight|hosted-catalogue-functions|fetch\(|execFile|DATABASE_URL/)
})

test('expanded CI requires every profile proof and retains inherited native refusal', () => {
 const workflow = readFileSync('.github/workflows/pilot-safety.yml', 'utf8')
 for (const marker of ['SJ_RECEIVED_DATE_DATABASE_PASSED:3', 'SJ_RECEIVED_DATE_MIGRATION_LIFECYCLE_PASSED:2', 'SJ_RECEIVED_DATE_REAL_RACES_PASSED:2', 'SJ_CATALOGUE_INSTALLED_FUNCTION_PARITY_PASSED:1', 'SJ_CATALOGUE_COHERENT_SYNTHETIC_GRAPH_PASSED:1', 'SJ_RECEIVED_DATE_COHERENT_SYNTHETIC_V2_PASSED:1', 'SJ_RECEIVED_DATE_NATIVE_LIMITS_PASSED:1', 'SJ_RECEIVED_DATE_NATIVE_CATALOGUE_PASSED:1']) expect(workflow).toContain(marker)
 const native = readFileSync('tests/database/sj-received-date-native.sql', 'utf8')
 for (const marker of ['55000', '23514', 'CATALOG_TRACKING_INCOMPLETE', 'sj_updated', 'sj_date_received', 'ROLLBACK;']) expect(native).toContain(marker)
 expect(native).not.toMatch(/DISABLE\s+TRIGGER|session_replication_role|CREATE OR REPLACE FUNCTION private\./)
})


test('native races preserve retained identities and fingerprint all affected state', () => {
 const races = readFileSync('scripts/sj-received-date-races.mjs', 'utf8')
 const runner = readFileSync('scripts/test-sj-received-date-ci.mjs', 'utf8')
 expect(races).toContain("md5('sj-catalogue-race-parent')")
 expect(races).toContain('Exact preexisting disposable race parent required')
 expect(races).not.toMatch(/DELETE FROM private\.catalog_identity|DISABLE TRIGGER|session_replication_role/)
 for (const state of ['catalog_identity_v1', 'catalog_checked_scope_v2', 'catalog_po_active_v2', 'catalog_cutover_v1', 'auth.users', 'public.customers', 'public.products', 'public.po_line_items']) expect(runner).toContain(state)
 expect(runner).toContain('Native rollback-only proofs changed baseline')
 expect(runner).toContain('run(sjReceivedCatalogueFingerprint).trim(), nativeBeforeRaces')
})


test('disposable catalogue fixture accepts the verified CI Docker address envelope', () => {
 const fixture = readFileSync('tests/database/sj-catalogue-fixture.sql', 'utf8')
 for (const subnet of ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) expect(fixture).toContain(`inet_server_addr() <<= '${subnet}'::cidr`)
 expect(fixture).toContain('inet_server_addr() IS NULL')
 expect(fixture).not.toContain("inet_server_addr() IS DISTINCT FROM '127.0.0.1'")
 expect(fixture).toContain('SELECT count(*) FROM public.pilot_fixture_marker')
})

test('outer source/run/server binding remains narrower for local than Docker CI', async () => {
 const { coBindFixtureServer } = await import('../scripts/co-fixture-target.mjs')
 const observed = (server_address: string, server_port: number) => ({ database: 'pilot_co_test', operator: 'postgres', database_owner: 'postgres', system_identifier: '123456789', server_version_num: '170011', server_address, server_port, marker: { kind: 'r', owner: 'postgres', rows: [{ purpose: 'disposable-pilot-ci' }] } })
 const profile = (kind: string) => ({ kind, database: 'pilot_co_test', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true }, runIdentity: 'synthetic-address-proof' })
 expect(() => coBindFixtureServer(profile('local'), observed('127.0.0.1', 65437))).not.toThrow()
 for (const address of ['10.1.2.3', '172.16.0.2', '172.31.255.254', '192.168.1.2']) {
  expect(() => coBindFixtureServer(profile('ci'), observed(address, 5432))).not.toThrow()
  expect(() => coBindFixtureServer(profile('local'), observed(address, 65437))).toThrow('Fixture server address refused')
 }
 for (const address of ['172.32.0.2', '8.8.8.8', '169.254.1.2', '::1', 'example.com']) expect(() => coBindFixtureServer(profile('ci'), observed(address, 5432))).toThrow('Fixture server address refused')
 expect(() => coBindFixtureServer(profile('ci'), observed('172.17.0.2', 65437))).toThrow('Fixture port changed')
 const bound = coBindFixtureServer(profile('ci'), observed('172.17.0.2', 5432))
 expect(() => coBindFixtureServer(profile('ci'), observed('172.17.0.3', 5432), bound)).toThrow('Fixture server/source/run identity drift')
})
