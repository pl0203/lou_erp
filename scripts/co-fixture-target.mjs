// Fixed, synthetic-only connection profiles. Never accepts an arbitrary database URL.
import assert from 'node:assert/strict'
import { isIP } from 'node:net'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
export function coSourceIdentity() {
  const git = args => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 }).trim()
  return { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), clean: git(['status', '--porcelain', '--untracked-files=normal']) === '' }
}
export function coCiConnection(env, source) {
  const ci = env.CO_CI_PROFILE !== undefined
  if (ci) {
    assert.equal(env.CO_CI_PROFILE, 'github-pilot-safety-v1', 'Unknown CO fixture profile')
    assert.ok(source?.clean === true, 'CI requires a verified clean Git source')
    assert.match(source.commit, /^[a-f0-9]{40}$/); assert.match(source.tree, /^[a-f0-9]{40}$/)
    assert.equal(env.CO_CI_SOURCE_SHA, source.commit, 'CI source must equal actual checked-out HEAD')
    for (const [key, value] of Object.entries({ CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'pl0203/lou_erp', GITHUB_WORKFLOW: 'Pilot safety checks', GITHUB_JOB: 'synthetic-safety' })) assert.equal(env[key], value, `Fixed CI context required: ${key}`)
    for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert.match(env[key] ?? '', /^[1-9][0-9]*$/, `Invalid ${key}`)
    assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/, 'Invalid GitHub event SHA')
    assert.equal(env.LD_LIBRARY_PATH, undefined, 'CI library overrides refused')
  } else {
    for (const key of ['CO_CI_SOURCE_SHA', 'GITHUB_ACTIONS']) assert.equal(env[key], undefined, 'Partial CI profile refused')
  }
  const acceptedPg = ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGCONNECT_TIMEOUT', 'PGTZ', ...(ci ? ['PGPASSWORD'] : [])]
  for (const key of Object.keys(env)) assert.ok(!key.startsWith('PG') || acceptedPg.includes(key), `Ambient libpq option refused: ${key}`)
  for (const key of ['DATABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_DB_PASSWORD']) assert.equal(env[key], undefined, `Ambient database target refused: ${key}`)
  assert.equal(env.PGHOST, '127.0.0.1', 'Fixed loopback service required')
  assert.equal(env.PGPORT, ci ? '5432' : '65437', 'Approved disposable port required')
  assert.equal(env.PGUSER, 'postgres', 'Disposable postgres fixture owner required')
  assert.equal(env.PGDATABASE, 'pilot_test', 'Fixed marker database required')
  if (ci) assert.equal(env.PGPASSWORD, 'synthetic-ci-only', 'Only the public synthetic CI password is accepted')
  return {
    PATH: env.PATH,
    ...(!ci && env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: env.LD_LIBRARY_PATH } : {}),
    PGHOST: '127.0.0.1', PGPORT: ci ? '5432' : '65437', PGUSER: 'postgres', PGDATABASE: 'pilot_test',
    ...(ci ? { PGPASSWORD: 'synthetic-ci-only' } : {}),
    PGCONNECT_TIMEOUT: '5', PGTZ: 'UTC', PGPASSFILE: '/dev/null/co-ci-no-password', PGSYSCONFDIR: '/dev/null',
  }
}
function privateIPv4(address) {
  if (isIP(address ?? '') !== 4) return false
  const [a, b] = address.split('.').map(Number)
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
export function coBindFixtureServer(profile, observed, expected) {
  assert.ok(['local', 'ci'].includes(profile.kind), 'Fixed fixture profile required')
  assert.equal(observed.database, profile.database ?? 'pilot_test', 'Fixture database changed')
  assert.equal(observed.operator, 'postgres', 'Fixture operator changed')
  assert.equal(observed.database_owner, 'postgres', 'Fixture owner changed')
  assert.match(observed.system_identifier ?? '', /^[1-9][0-9]*$/, 'PostgreSQL cluster identity required')
  assert.match(observed.server_version_num ?? '', /^17[0-9]{4}$/, 'PostgreSQL 17 exact version required')
  assert.equal(observed.server_port, profile.kind === 'ci' ? 5432 : 65437, 'Fixture port changed')
  assert.ok(profile.kind === 'ci' ? privateIPv4(observed.server_address) : observed.server_address === '127.0.0.1', 'Fixture server address refused')
  assert.deepEqual(observed.marker, { kind: 'r', owner: 'postgres', rows: [{ purpose: 'disposable-pilot-ci' }] }, 'Exact one-row ordinary postgres-owned marker required')
  const identity = { source: profile.source, runIdentity: profile.runIdentity, serverAddress: observed.server_address, serverPort: observed.server_port, serverVersion: observed.server_version_num, systemIdentifier: observed.system_identifier }
  if (expected) assert.deepEqual(identity, expected, 'Fixture server/source/run identity drift')
  return identity
}

// A separate marker preserves the historical pilot marker contract unchanged.
export const CO_FIXTURE_OBSERVATION_SQL = `-- CO_FIXTURE_OBSERVATION
SELECT jsonb_build_object('database',current_database(),'operator',current_user,
 'database_owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
 'system_identifier',(SELECT system_identifier::text FROM pg_control_system()),
 'server_version_num',current_setting('server_version_num'),
 'server_address',host(inet_server_addr()),'server_port',inet_server_port(),
 'marker',(SELECT jsonb_build_object('kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),
 'rows',(SELECT jsonb_agg(to_jsonb(m)) FROM public.pilot_fixture_marker m))
 FROM pg_class c WHERE c.oid='public.pilot_fixture_marker'::regclass));`
const quote = value => `'${String(value).replaceAll("'", "''")}'`
export function coCreateFixtureIdentitySql(identity) {
  return `-- CO_CREATE_FIXTURE_IDENTITY
CREATE TABLE public.co_fixture_identity_v1(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), purpose text NOT NULL CHECK(purpose='disposable-co-ci'), identity jsonb NOT NULL);
REVOKE ALL ON public.co_fixture_identity_v1 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.co_fixture_identity_v1 VALUES(true,'disposable-co-ci',${quote(JSON.stringify(identity))}::jsonb);`
}
export function coVerifyFixtureIdentitySql(identity) {
  return `-- CO_VERIFY_FIXTURE_IDENTITY
SELECT (SELECT relkind='r' AND relowner='postgres'::regrole FROM pg_class WHERE oid='public.co_fixture_identity_v1'::regclass)
 AND (SELECT count(*)=1 AND bool_and(singleton AND purpose='disposable-co-ci' AND identity=${quote(JSON.stringify(identity))}::jsonb) FROM public.co_fixture_identity_v1);`
}
export function coFixtureChildEnv(connection, env, identity) {
  const context = {}
  if (env.CO_CI_PROFILE) for (const key of ['CO_CI_PROFILE','CO_CI_SOURCE_SHA','CI','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_WORKFLOW','GITHUB_JOB','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA']) context[key] = env[key]
  return { ...connection, ...context, CO_FIXTURE_IDENTITY: JSON.stringify(identity) }
}
