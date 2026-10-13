#!/usr/bin/env node
/**
 * Disposable PostgreSQL read measurements, never API/browser capacity evidence.
 * Default: node tests/scalability/measure-reads.mjs --rows 6000
 * Execute only after local fixture setup and explicit approval of the run:
 * PGHOST=127.0.0.1 PGDATABASE=pilot_test PGUSER=postgres node
 * tests/scalability/measure-reads.mjs --execute --permit disposable-pilot-ci
 * --rows 6000 --roles executive,managerA --cases po-first,dashboard-summary
 * --profile 'candidate; local CI CPU/RAM details' --output /tmp/read-results.json
 * Supply the synthetic local password via PGPASSWORD, never a CLI argument.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { verifyScaleConnectionTarget, verifyScaleTarget } from '../../scripts/verify-scale-target.mjs'

export const ACTORS = Object.freeze(Object.fromEntries(
  ['executive', 'managerA', 'managerB', 'salesA', 'salesB', 'po_admin', 'sales_head', 'inactive']
    .map((name, index) => [name, `84000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`]),
))
const ROLES = ['executive', 'managerA', 'managerB']
export const CASE_NAMES = Object.freeze([
  'po-first', 'po-middle', 'po-final', 'po-search-broad', 'po-search-exact',
  'po-search-none', 'dashboard-summary', 'customer-stats', 'po-lines',
  'customer-performance', 'sales-performance', 'revenue',
])
const MARKER = 'disposable-pilot-ci'
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const RPC_PARAMETERS = {
  pilot_po_page_v1: { p_status: 'text', p_search: 'text', p_page: 'integer', p_page_size: 'integer' },
  pilot_athel_summary_v1: { p_from: 'date', p_to: 'date', p_rolling_from: 'date', p_status: 'text', p_fulfillment: 'text' },
  pilot_customer_stats_v1: { p_customer_ids: 'uuid[]', p_cutoff: 'date', p_top_limit: 'integer' },
  pilot_po_lines_v1: { p_po_id: 'uuid', p_page: 'integer', p_page_size: 'integer', p_expected_updated_at: 'timestamptz' },
  pilot_customer_performance_v1: { p_manager_id: 'uuid', p_year_month: 'text', p_visit_from: 'timestamptz', p_visit_until: 'timestamptz', p_page: 'integer', p_page_size: 'integer' },
  pilot_sales_performance_v1: { p_manager_id: 'uuid', p_date_from: 'date', p_date_to: 'date', p_order_from: 'timestamptz', p_order_to: 'timestamptz', p_year_month: 'text', p_page: 'integer', p_page_size: 'integer' },
  pilot_revenue_v1: { p_from: 'timestamptz', p_to: 'timestamptz', p_page: 'integer', p_page_size: 'integer' },
}
const RLS_TABLES = ['purchase_orders', 'po_line_items', 'surat_jalan', 'sj_line_items', 'customers', 'users', 'girard_orders', 'outlet_visits', 'customer_targets', 'sales_targets', 'sales_schedules']

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`)
  return value
}
function integerArg(value, min, max, name) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new Error(`Invalid ${name}`)
  return integer(Number(value), min, max, name)
}
function selection(value, allowed, name) {
  const selected = value.split(',')
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(item => !allowed.includes(item))) throw new Error(`Invalid ${name}`)
  return selected
}
function validateOptions(options) {
  if (typeof options.execute !== 'boolean' || ![6000, 30000].includes(options.rows)) throw new Error('Invalid execution mode or fixture size')
  integer(options.pageSize, 1, 100, 'page size')
  integer(options.warmups, 10, 100, 'warmups')
  integer(options.samples, 100, 1000, 'samples')
  if (!Array.isArray(options.roles) || !Array.isArray(options.cases)) throw new Error('Explicit selections required')
  selection(options.roles.join(','), ROLES, 'roles')
  selection(options.cases.join(','), CASE_NAMES, 'cases')
  if (options.execute && (options.permit !== MARKER || typeof options.profile !== 'string' || !options.profile || typeof options.output !== 'string' || !options.output)) throw new Error('Execution requires permit, profile and output')
}

export function parseOptions(argv) {
  const options = { execute: false, rows: 6000, roles: ['executive', 'managerA'], cases: [...CASE_NAMES], pageSize: 10, warmups: 10, samples: 100, permit: undefined, profile: undefined, output: undefined }
  const seen = new Set()
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (seen.has(flag)) throw new Error('Duplicate option')
    seen.add(flag)
    if (flag === '--execute') { options.execute = true; continue }
    if (flag === '--dry-run') continue
    const value = argv[++index]
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('Missing option value')
    switch (flag) {
      case '--rows': options.rows = integerArg(value, 6000, 30000, 'rows'); break
      case '--roles': options.roles = selection(value, ROLES, 'roles'); break
      case '--cases': options.cases = selection(value, CASE_NAMES, 'cases'); break
      case '--page-size': options.pageSize = integerArg(value, 1, 100, 'page size'); break
      case '--warmups': options.warmups = integerArg(value, 10, 100, 'warmups'); break
      case '--samples': options.samples = integerArg(value, 100, 1000, 'samples'); break
      case '--permit': options.permit = value; break
      case '--profile': options.profile = value; break
      case '--output': options.output = value; break
      default: throw new Error('Unknown option')
    }
  }
  if (![6000, 30000].includes(options.rows)) throw new Error('Only 6000 or 30000 fixture rows are supported')
  if (seen.has('--execute') && seen.has('--dry-run')) throw new Error('Conflicting execution modes')
  if (options.permit !== undefined && options.permit !== MARKER) throw new Error('Explicit disposable permit required')
  if (options.profile && (options.profile.length > 512 || /[\u0000-\u001f]/.test(options.profile))) throw new Error('Invalid profile label')
  if (options.output && (options.output.length > 4096 || options.output.includes('\0'))) throw new Error('Invalid output path')
  if (options.execute && ['--permit', '--roles', '--cases', '--profile', '--output'].some(flag => !seen.has(flag))) throw new Error('Execution requires explicit permit, roles, cases, profile and output')
  validateOptions(options)
  return options
}

export function sanitizeConnectionEnv(env) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST) || env.PGDATABASE !== 'pilot_test') throw new Error('Only a loopback pilot_test connection is permitted')
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(env.PGUSER ?? '')) throw new Error('Explicit simple PostgreSQL user required')
  const port = env.PGPORT ?? '5432'
  integerArg(port, 1, 65535, 'port')
  // Construct an allowlist; never spread process.env. In particular, no service,
  // address, startup options, certificate, password-file or dynamic-loader overrides.
  const sanitized = {
    PATH: env.PATH || '/usr/bin:/bin', PGHOST: env.PGHOST, PGDATABASE: 'pilot_test',
    PGUSER: env.PGUSER, PGPORT: port, PGCONNECT_TIMEOUT: '10', PGSSLMODE: 'disable',
    PGPASSFILE: '/dev/null', PGAPPNAME: 'pilot-disposable-read-measurement', LC_ALL: 'C',
  }
  if (env.PGPASSWORD !== undefined) {
    if (typeof env.PGPASSWORD !== 'string' || env.PGPASSWORD.includes('\0')) throw new Error('Invalid synthetic password')
    sanitized.PGPASSWORD = env.PGPASSWORD
  }
  return sanitized
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid discovered UUID')
  return value
}
function textLiteral(value) {
  if (typeof value !== 'string' || value.length > 1024 || value.includes('\0')) throw new Error('Invalid SQL text value')
  return `'${value.replaceAll("'", "''")}'`
}

export function buildCases({ role, pageSize, discovery }) {
  if (!ROLES.includes(role)) throw new Error('Unsupported measurement role')
  integer(pageSize, 1, 100, 'page size')
  if (discovery?.version !== 1 || !Array.isArray(discovery.items) || !discovery.items.length) throw new Error('Authorized PO discovery returned no rows')
  integer(discovery.total, 1, Number.MAX_SAFE_INTEGER, 'visible PO count')
  const first = discovery.items[0]
  uuid(first.id); uuid(first.customer_id); textLiteral(first.po_number)
  // A visible PO can retain a foreign key to a hidden related customer. Only a
  // returned customer relation establishes a useful, authorized statistics case.
  const visibleCustomer = discovery.items.find(item => typeof item?.customers?.name === 'string')
  if (!visibleCustomer) throw new Error('Authorized discovery returned no visible customer relation')
  uuid(visibleCustomer.customer_id)
  const pages = Math.ceil(discovery.total / pageSize)
  const manager = role.startsWith('manager') ? ACTORS[role] : null
  const page = { p_page: 1, p_page_size: pageSize }
  const po = (name, p_page, p_search = '') => ({ name, rpc: 'pilot_po_page_v1', params: { p_status: 'all', p_search, p_page, p_page_size: pageSize } })
  return [
    po('po-first', 1), po('po-middle', Math.ceil(pages / 2)), po('po-final', pages),
    po('po-search-broad', 1, 'SCALE'), po('po-search-exact', 1, first.po_number),
    po('po-search-none', 1, 'SYNTHETIC_NO_MATCH_100%_,_DO_NOT_SEED'),
    { name: 'dashboard-summary', rpc: 'pilot_athel_summary_v1', params: { p_from: '2026-07-01', p_to: '2026-09-30', p_rolling_from: '2025-10-01', p_status: 'all', p_fulfillment: 'all' } },
    { name: 'customer-stats', rpc: 'pilot_customer_stats_v1', params: { p_customer_ids: [visibleCustomer.customer_id], p_cutoff: '2026-07-01', p_top_limit: 5 } },
    { name: 'po-lines', rpc: 'pilot_po_lines_v1', params: { p_po_id: first.id, ...page, p_expected_updated_at: null } },
    { name: 'customer-performance', rpc: 'pilot_customer_performance_v1', params: { p_manager_id: manager, p_year_month: '2026-09', p_visit_from: '2026-09-01T00:00:00Z', p_visit_until: '2026-10-01T00:00:00Z', ...page } },
    { name: 'sales-performance', rpc: 'pilot_sales_performance_v1', params: { p_manager_id: manager, p_date_from: '2026-09-01', p_date_to: '2026-09-30', p_order_from: '2026-09-01T00:00:00Z', p_order_to: '2026-09-30T23:59:59Z', p_year_month: '2026-09', ...page } },
    { name: 'revenue', rpc: 'pilot_revenue_v1', params: { p_from: '2025-10-01T00:00:00Z', p_to: '2026-09-30T23:59:59Z', ...page } },
  ]
}

export function buildSelect({ rpc, params }) {
  if (!Object.hasOwn(RPC_PARAMETERS, rpc)) throw new Error('Unknown RPC')
  const definition = RPC_PARAMETERS[rpc]
  if (!params || Object.keys(params).length !== Object.keys(definition).length || Object.keys(params).some(key => !Object.hasOwn(definition, key))) throw new Error('Unknown RPC or parameters')
  const values = Object.entries(definition).map(([name, type]) => {
    const value = params[name]
    if (value === null && ['p_manager_id', 'p_expected_updated_at'].includes(name)) return `${name} => NULL::${type}`
    let literal
    if (type === 'integer') literal = String(integer(value, 1, name === 'p_page_size' ? 100 : name === 'p_top_limit' ? 10 : 2147483647, name))
    else if (type === 'uuid') literal = textLiteral(uuid(value))
    else if (type === 'uuid[]') {
      if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('Invalid customer batch')
      literal = `ARRAY[${value.map(item => `${textLiteral(uuid(item))}::uuid`).join(',')}]`
    } else {
      if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date')
      if (type === 'timestamptz' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('Invalid timestamp')
      literal = textLiteral(value)
    }
    return `${name} => ${literal}::${type}`
  })
  return `SELECT public.${rpc}(${values.join(', ')});`
}

const MARKER_ASSERTION = `DO $guard$ BEGIN
  IF current_database() <> 'pilot_test' OR (SELECT count(*) FROM public.pilot_fixture_marker) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.pilot_fixture_marker WHERE purpose = '${MARKER}')
  THEN RAISE EXCEPTION 'Disposable fixture marker required'; END IF;
END $guard$;`

export function buildReadTransaction({ actor, query, explain = false }) {
  if (!ROLES.some(role => ACTORS[role] === actor)) throw new Error('Synthetic measurement actor required')
  const rpc = typeof query === 'string' && Object.keys(RPC_PARAMETERS).find(name => query.startsWith(`SELECT public.${name}(`))
  if (!rpc) throw new Error('Known read RPC required')
  const expectedRole = actor === ACTORS.executive ? 'executive' : 'sales_manager'
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL standard_conforming_strings = on;
${MARKER_ASSERTION}
SET LOCAL ROLE authenticated;
SET LOCAL row_security = on;
SET LOCAL request.jwt.claim.sub = '${actor}';
SET LOCAL request.jwt.claims = '{"sub":"${actor}","role":"authenticated"}';
DO $guard$ BEGIN
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM '${actor}'::uuid
    OR public.current_user_role()::text IS DISTINCT FROM '${expectedRole}'
    OR EXISTS (SELECT 1 FROM unnest(ARRAY[${RLS_TABLES.map(table => `'public.${table}'`).join(',')}]) AS relation(name)
      WHERE NOT row_security_active(relation.name::regclass))
  THEN RAISE EXCEPTION 'Effective authenticated RLS required'; END IF;
  IF NOT (SELECT count(*) = 1 AND bool_and(NOT p.prosecdef AND p.provolatile = 's')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '${rpc}')
  THEN RAISE EXCEPTION 'Stable security-invoker RPC required'; END IF;
END $guard$;
${explain ? 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF) ' : ''}${query}
ROLLBACK;`
}

function profileSql() {
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
${MARKER_ASSERTION}
SELECT jsonb_build_object(
  'marker', (SELECT purpose FROM public.pilot_fixture_marker),
  'database', current_database(), 'server_address', inet_server_addr()::text,
  'server_version', current_setting('server_version'),
  'settings', jsonb_build_object('shared_buffers',current_setting('shared_buffers'),'work_mem',current_setting('work_mem'),'max_parallel_workers_per_gather',current_setting('max_parallel_workers_per_gather')),
  'counts', jsonb_build_object('purchase_orders',(SELECT count(*) FROM public.purchase_orders),'po_line_items',(SELECT count(*) FROM public.po_line_items),'surat_jalan',(SELECT count(*) FROM public.surat_jalan),'sj_line_items',(SELECT count(*) FROM public.sj_line_items),'customers',(SELECT count(*) FROM public.customers))
);
ROLLBACK;`
}

export function createPsqlTransport({ env, execFileImpl = execFile }) {
  const connection = sanitizeConnectionEnv(env)
  return ({ sql }) => new Promise((resolve, reject) => {
    const started = performance.now()
    const child = execFileImpl('psql', ['-X', '--no-password', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--file=-'], {
      env: connection, encoding: 'utf8', timeout: 65000, maxBuffer: 8 * 1024 * 1024, shell: false,
    }, (error, stdout) => {
      if (error) { reject(new Error(error.killed ? 'psql_timeout' : 'psql_error')); return }
      resolve({ stdout, wallMs: performance.now() - started })
    })
    child.stdin.on?.('error', () => reject(new Error('psql_stdin_error')))
    child.stdin.end(sql)
  })
}

export function summarizeSamples(values, expected) {
  if (!Array.isArray(values) || values.length !== expected || expected < 1 || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Complete finite samples required')
  const ordered = [...values].sort((left, right) => left - right)
  return { count: values.length, p50: ordered[Math.ceil(values.length * 0.5) - 1], p95: ordered[Math.ceil(values.length * 0.95) - 1], min: ordered[0], max: ordered.at(-1) }
}

function parseJson(response) {
  if (typeof response.stdout !== 'string' || !Number.isFinite(response.wallMs) || response.wallMs < 0) throw new Error('invalid_transport_response')
  try { return JSON.parse(response.stdout.trim()) } catch { throw new Error('invalid_json_response') }
}
function parsePlan(response) {
  const plan = parseJson(response)
  if (!Array.isArray(plan) || plan.length !== 1 || !plan[0]?.Plan || !Number.isFinite(plan[0]['Execution Time']) || plan[0]['Execution Time'] < 0 || !Number.isFinite(plan[0]['Planning Time']) || plan[0]['Planning Time'] < 0) throw new Error('incomplete_explain')
  return { sql_execution_ms: plan[0]['Execution Time'], sql_planning_ms: plan[0]['Planning Time'], psql_process_wall_ms: response.wallMs, plan }
}
function safeError(error, stage) {
  // Child errors can contain passwords, process options, SQL or server strings.
  // Only emit fixed diagnostic codes, never raw exception messages or stderr.
  const approved = ['psql_timeout', 'psql_error', 'psql_stdin_error', 'invalid_transport_response', 'invalid_json_response', 'incomplete_explain']
  return { stage, code: approved.includes(error?.message) ? error.message : 'read_measurement_failed' }
}

function manifest(options) {
  return {
    format_version: 1, status: 'dry-run', task7_complete: false,
    rows: options.rows, fixture_expected_po_rows: options.rows + 7,
    fixture_window: { from: options.rows === 30000 ? '2021-10-01' : '2025-10-01', through: '2026-09-30', customers: 101 },
    roles: options.roles, cases: options.cases, page_size: options.pageSize,
    warmups: options.warmups, measured_samples: options.samples, statement_timeout_ms: 60000,
    measurement_method: 'EXPLAIN ANALYZE of read-only RPC SELECTs under authenticated RLS; one fresh psql process per request',
    timing_labels: {
      sql_execution_ms: 'PostgreSQL EXPLAIN Execution Time; excludes Planning Time',
      sql_planning_ms: 'PostgreSQL EXPLAIN Planning Time',
      psql_process_wall_ms: 'Whole local psql EXPLAIN process including connection, marker/RLS checks, plan output and rollback; not API latency',
    },
    coverage: {
      sql: { status: 'unrun', concurrent_sessions: 1 }, api: { status: 'unrun' }, browser: { status: 'unrun' },
      concurrent_transport: { status: 'unrun', users: [1, 5, 10] }, cold_cache: { status: 'unrun', reason: 'No cache reset; authorized discovery and representative reads precede warmups' },
    },
    limitations: [
      'No hosted target, capacity claim or API/browser latency acceptance decision.',
      'Outer EXPLAIN plans for PL/pgSQL RPCs may not expose nested statement plans; nested SQL/index review remains required.',
      'JSON byte counts represent one observed RPC result, not EXPLAIN bytes or API wire bytes.',
      'Baseline/candidate runs require the same fixture and declared hardware profile; correctness and authorization suites are separate gates.',
    ],
    planned_rpc_requests: options.roles.length * (1 + options.cases.length * (1 + options.warmups + options.samples)),
    results: [], errors: [], unrun_cases: options.roles.flatMap(role => options.cases.map(name => ({ role, case: name }))),
  }
}

export async function runMeasurement(options, dependencies = {}) {
  validateOptions(options)
  const report = manifest(options)
  if (!options.execute) return report
  // Verify the connection target before even launching the marker probe.
  const env = sanitizeConnectionEnv(dependencies.env ?? process.env)
  const target = { host: env.PGHOST, database: env.PGDATABASE, permit: options.permit, rows: options.rows }
  verifyScaleConnectionTarget(target)
  const transport = dependencies.transport ?? createPsqlTransport({ env })
  let stage = 'profile'
  let activeResult
  try {
    const server = parseJson(await transport({ kind: 'profile', sql: profileSql() }))
    verifyScaleTarget({ ...target, marker: server.marker })
    // inet_server_addr() reports the server-side interface, which is a Docker
    // private address for a local CI port mapping. It is evidence, not a client
    // target allowlist. PGHOST is still strictly loopback before any connection;
    // actual database, marker and fixture shape remain mandatory after connection.
    if (server.database !== 'pilot_test') throw new Error('Invalid actual database')
    const expectedCounts = { purchase_orders: options.rows + 7, po_line_items: options.rows * 10 + 7, surat_jalan: options.rows * 2 + 5, sj_line_items: options.rows * 20 + 5, customers: 101 }
    if (Object.entries(expectedCounts).some(([table, count]) => server.counts?.[table] !== count)) throw new Error('Requested fixture shape does not match actual dataset')
    report.profile = { label: options.profile, node: process.version, platform: process.platform, architecture: process.arch, transport: 'local psql', timezone: 'UTC', server }
    report.started_at = new Date().toISOString()
    for (const role of options.roles) {
      stage = 'authorized-discovery'
      const actor = ACTORS[role]
      const discoveryQuery = buildSelect({ rpc: 'pilot_po_page_v1', params: { p_status: 'all', p_search: '', p_page: 1, p_page_size: options.pageSize } })
      const discovery = parseJson(await transport({ kind: 'discovery', sql: buildReadTransaction({ actor, query: discoveryQuery }) }))
      const available = buildCases({ role, pageSize: options.pageSize, discovery })
      for (const name of options.cases) {
        const testCase = available.find(item => item.name === name)
        const query = buildSelect(testCase)
        activeResult = { role, actor, case: name, rpc: testCase.rpc, params: testCase.params, query, query_sha256: createHash('sha256').update(query).digest('hex'), status: 'in-progress', warmup_count: 0, sample_count: 0, samples: [], errors: [], timings: null }
        report.results.push(activeResult)
        report.unrun_cases = report.unrun_cases.filter(item => item.role !== role || item.case !== name)
        stage = 'representative-response'
        const response = await transport({ kind: 'response', sql: buildReadTransaction({ actor, query }) })
        const payload = parseJson(response)
        if (!payload || payload.version !== 1) throw new Error('Invalid RPC envelope')
        if (name === 'po-search-none' && (payload.total !== 0 || !Array.isArray(payload.items) || payload.items.length !== 0)) throw new Error('No-match fixture is not empty')
        if (name === 'po-search-broad' && (!Number.isSafeInteger(payload.total) || payload.total < 1)) throw new Error('Broad search has no matches')
        activeResult.representative_returned_json_bytes = Buffer.byteLength(response.stdout.trim(), 'utf8')
        activeResult.representative_psql_process_wall_ms = response.wallMs
        activeResult.representative_is_cold_cache = false
        const sql = buildReadTransaction({ actor, query, explain: true })
        stage = 'warmup'
        for (let index = 0; index < options.warmups; index++) {
          parsePlan(await transport({ kind: 'explain', sql }))
          activeResult.warmup_count++
        }
        stage = 'measured-sample'
        for (let index = 0; index < options.samples; index++) {
          activeResult.samples.push(parsePlan(await transport({ kind: 'explain', sql })))
          activeResult.sample_count++
        }
        activeResult.timings = Object.fromEntries(['sql_execution_ms', 'sql_planning_ms', 'psql_process_wall_ms'].map(metric => [metric, summarizeSamples(activeResult.samples.map(sample => sample[metric]), options.samples)]))
        activeResult.status = 'complete'
        activeResult = undefined
      }
    }
    report.status = 'complete-sql-only'
    report.coverage.sql.status = 'complete'
  } catch (error) {
    const failure = safeError(error, stage)
    report.errors.push(failure)
    if (activeResult) {
      activeResult.errors.push(failure)
      activeResult.status = 'failed-incomplete'
      activeResult.timings = null
    }
    report.status = 'failed-incomplete'
    report.coverage.sql.status = 'failed-incomplete'
  }
  report.finished_at = new Date().toISOString()
  return report
}

async function main() {
  try {
    const options = parseOptions(process.argv.slice(2))
    const report = await runMeasurement(options)
    const json = `${JSON.stringify(report, null, 2)}\n`
    // Never replace earlier evidence. Choose a new path for each baseline/candidate.
    if (options.output) await writeFile(options.output, json, { flag: 'wx', mode: 0o600 })
    process.stdout.write(options.output ? `${JSON.stringify({ status: report.status, output: options.output, task7_complete: false })}\n` : json)
    if (report.status === 'failed-incomplete') process.exitCode = 1
  } catch {
    process.stderr.write('Scale read measurement refused or failed; check explicit CLI options, local target, fixture marker and unused output path. No remote target or credential details are logged.\n')
    process.exitCode = 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
