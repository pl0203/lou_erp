// Fixed version-controlled psql wrappers, disposable local database only.
// No SQL-body parsing, caller path/SQL/script input, reset or bootstrap.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateIhrDbTarget } from './test-ihr-db.mjs'

export const EMPLOYEE_DB_SUITES = Object.freeze(['reads', 'commands', 'reporting', 'preservation', 'all'])
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dependencies = Object.freeze({ reads: ['schema'], commands: ['schema', 'commands'],
  reporting: ['schema', 'commands', 'reporting'], preservation: ['schema', 'commands', 'reporting'],
  all: ['schema', 'commands', 'reporting'] })
const acceptedOptions = new Set(['env', 'suite', 'race', 'probe', 'execute'])
export function parseEmployeeDbArgs(args) {
  let suite, race = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--suite' && suite === undefined) suite = args[++i]
    else if (args[i] === '--race' && !race) race = true
    else throw Error('Use --suite <reads|commands|reporting|preservation|all> and optional --race only')
  }
  if (!EMPLOYEE_DB_SUITES.includes(suite)) throw Error('A declared employee suite is required')
  return { suite, race }
}
const markerSql = `BEGIN READ ONLY;
SELECT current_database() = 'pilot_test' AND current_user = 'postgres'
  AND inet_server_addr() IN ('127.0.0.1'::inet, '::1'::inet)
  AND (SELECT count(*) FROM public.pilot_fixture_marker) = 1
  AND EXISTS (SELECT 1 FROM public.pilot_fixture_marker WHERE purpose = 'disposable-pilot-ci')
  AND to_regclass('public.users') IS NOT NULL
  AND to_regprocedure('public.leave_context_v1()') IS NOT NULL
  AND to_regprocedure('private.ihr_leave_calendar_timezone(uuid)') IS NOT NULL;
ROLLBACK;`

export function runEmployeeDb(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !acceptedOptions.has(key))) throw Error('Only fixed employee runner options are allowed')
  const { env = process.env, suite = 'all', race = false, probe = execFileSync, execute = execFileSync } = options
  const connection = validateIhrDbTarget(env)
  if (!EMPLOYEE_DB_SUITES.includes(suite)) throw Error('Unknown employee suite')
  if (typeof race !== 'boolean') throw Error('Race flag must be boolean')
  if (race && !['commands', 'reporting', 'all'].includes(suite)) throw Error('Only the implemented commands/reporting/all race suites are available')
  if (typeof probe !== 'function' || typeof execute !== 'function') throw Error('Process hooks must be functions')
  const suites = suite === 'all' ? EMPLOYEE_DB_SUITES.filter(name => name !== 'all') : [suite]
  const wrappers = suites.map(name => join(root, `tests/database/employees/run-${name}.sql`))
  const raceFile = join(root, 'tests/database/employees/concurrency.mjs')
  const requiredFiles = [
    ...dependencies[suite].map(name => join(root, `sql/employee-foundation-${name}.sql`)),
    join(root, 'tests/database/ihr/helpers.sql'), join(root, 'tests/database/employees/seed.sql'),
    ...suites.flatMap((name, index) => [join(root, `tests/database/employees/${name === 'reads' ? 'read-model' : name}.sql`), wrappers[index]]),
    ...(race ? [raceFile, join(root, 'tests/database/employees/command-races.mjs'),
      ...(['reporting','all'].includes(suite) ? [join(root, 'tests/database/employees/reporting-races.mjs')] : []),
      ...(['snapshot.sql'].map(name=>join(root,'tests/database/employees',name))),
      ...(suite === 'all' ? ['recovery-races.mjs','collision-owner.mjs','sql-decoder.mjs','sql-output.sql','abort-atomic.sql','install-atomic.sql','install-owner.sql'].map(name=>join(root,'tests/database/employees',name)) : [])] : []),
  ]
  for (const file of requiredFiles) if (!existsSync(file)) throw Error(`Required fixed employee dependency file is missing: ${file}`)
  const args = ['-h', connection.PGHOST, '-p', connection.PGPORT, '-U', 'postgres', '-d', 'pilot_test',
    '-X', '--no-password', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=verbose']
  let marker
  try {
    marker = probe('psql', [...args, '-qAt'], { env: { ...connection,
      PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=5000 -c search_path=pg_catalog' },
    input: markerSql, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
  } catch { throw Error('Disposable fixture marker and prerequisites could not be verified') }
  if (typeof marker !== 'string' || marker.trim() !== 't') throw Error('Disposable fixture marker, loopback server and prerequisites are required')
  const workloadEnv = { ...connection, PGOPTIONS: '-c statement_timeout=120000 -c lock_timeout=10000' }
  // Wrappers contain fixed relative includes and own BEGIN/ROLLBACK. They are test
  // artifacts, not activation bundles. No file contents are parsed or rewritten.
  for (const file of wrappers) execute('psql', [...args, `--file=${file}`], { env: workloadEnv,
    cwd: root, timeout: 180000, stdio: 'inherit', shell: false })
  // Fixed race dispatcher owns guarded synthetic installation and cleanup.
  if (race) {
    for(const fixedSuite of suite==='all'?['commands','reporting']:[suite]) execute(process.execPath, [raceFile, '--suite', fixedSuite], { env: workloadEnv, cwd: root, timeout: 300000, stdio: 'inherit', shell: false })
    if(suite==='all') for(const name of ['recovery-races.mjs','sql-decoder.mjs']) execute(process.execPath,[join(root,'tests/database/employees',name)],{env:workloadEnv,cwd:root,timeout:300000,stdio:'inherit',shell:false})
  }
  return { suites, race }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runEmployeeDb(parseEmployeeDbArgs(process.argv.slice(2))) }
  catch (error) { process.stderr.write(`Disposable employee SQL execution refused or failed: ${error.message}\n`); process.exitCode = 1 }
}
