// Existing sanitized, disposable PostgreSQL only. Never bootstrap, reset or use a hosted target.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const IHR_DB_SUITES = Object.freeze([
  'foundation', 'calendar', 'accounts', 'quote', 'requests', 'decisions',
  'reads', 'admin', 'composed',
])
const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** Pure preflight: invalid/unknown targets never reach either process hook. */
export function validateIhrDbTarget(env) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST)) throw new Error('Explicit loopback PGHOST required')
  if (env.PGDATABASE !== 'pilot_test') throw new Error('Only disposable PGDATABASE=pilot_test is allowed')
  if (env.PGUSER !== 'postgres') throw new Error('Disposable PGUSER=postgres is required')
  const port = env.PGPORT ?? '5432'
  if (typeof port !== 'string' || port.length < 1 || port.length > 5 || /\D/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Invalid local PostgreSQL port')
  }
  const connection = Object.fromEntries(Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith('PG')))
  Object.assign(connection, { PGHOST: env.PGHOST, PGPORT: port, PGDATABASE: 'pilot_test', PGUSER: 'postgres', PGCONNECT_TIMEOUT: '5' })
  if (typeof env.PGPASSWORD === 'string') connection.PGPASSWORD = env.PGPASSWORD
  return connection
}

export function parseIhrDbArgs(args) {
  let suite, race = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--suite' && suite === undefined) suite = args[++i]
    else if (args[i] === '--race' && !race) race = true
    else throw new Error('Use --suite <declared-suite|all> and optional --race only')
  }
  if (suite !== 'all' && !IHR_DB_SUITES.includes(suite)) throw new Error('A declared iHR suite is required')
  return { suite, race }
}

const markerSql = `BEGIN READ ONLY;
SELECT current_database() = 'pilot_test' AND current_user = 'postgres'
  AND (SELECT count(*) FROM public.pilot_fixture_marker) = 1
  AND EXISTS (SELECT 1 FROM public.pilot_fixture_marker WHERE purpose = 'disposable-pilot-ci');
ROLLBACK;`

/** Separate read-only marker discovery from workload execution for explicit guard tests. */
export function runIhrDb({ env = process.env, suite = 'all', race = false, repoRoot = defaultRoot,
  execute = execFileSync, probe = execFileSync } = {}) {
  const connection = validateIhrDbTarget(env)
  if (suite !== 'all' && !IHR_DB_SUITES.includes(suite)) throw new Error('Unknown iHR suite')
  if (typeof race !== 'boolean') throw new Error('Race flag must be boolean')
  const suites = suite === 'all' ? [...IHR_DB_SUITES] : [suite]
  const helpers = join(repoRoot, 'tests/database/ihr/helpers.sql')
  const suiteFiles = suites.map(name => join(repoRoot, `tests/database/ihr/${name}.sql`))
  const raceFile = join(repoRoot, 'tests/database/ihr/concurrency.mjs')
  for (const file of [helpers, ...suiteFiles, ...(race ? [raceFile] : [])]) {
    if (!existsSync(file)) throw new Error(`Required iHR suite file is missing: ${file}`)
  }
  const connectionArgs = ['-h', connection.PGHOST, '-p', connection.PGPORT, '-U', 'postgres', '-d', 'pilot_test',
    '-X', '--no-password', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=verbose']
  let marker
  try {
    marker = probe('psql', [...connectionArgs, '-qAt'], {
      env: { ...connection, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=5000 -c search_path=pg_catalog' },
      input: markerSql, encoding: 'utf8', timeout: 15000, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error('Disposable synthetic fixture marker could not be verified')
  }
  if (typeof marker !== 'string' || marker.trim() !== 't') throw new Error('Disposable synthetic fixture marker is required')
  const workloadEnv = { ...connection, PGOPTIONS: '-c statement_timeout=120000 -c lock_timeout=10000' }
  for (const file of suiteFiles) execute('psql', [...connectionArgs, `--file=${helpers}`, `--file=${file}`], {
    env: workloadEnv, cwd: repoRoot, stdio: 'inherit', timeout: 180000, shell: false,
  })
  if (race) execute(process.execPath, [raceFile], {
    env: workloadEnv, cwd: repoRoot, stdio: 'inherit', timeout: 300000, shell: false,
  })
  return { suites, race }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runIhrDb(parseIhrDbArgs(process.argv.slice(2))) }
  catch (error) {
    process.stderr.write(`Disposable iHR SQL execution refused or failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
