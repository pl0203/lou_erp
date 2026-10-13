// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { unlinkSync, writeFileSync } from 'node:fs'
// The runner owns the boundary to psql; no database is contacted by these guard tests.
import { coCiConnection, coCiThrough, runCoCi as runGuardedCoCi } from '../../scripts/test-co-ci.mjs'

const clean = { PATH: '/usr/bin', PGHOST: '127.0.0.1', PGPORT: '65437', PGUSER: 'postgres', PGDATABASE: 'pilot_test' }

// Preserve the stage-specific stubs below while answering the independently tested
// Task13 identity protocol (fixture-target/lifecycle cover its fail-closed branches).
function runCoCi(options: any) {
  return runGuardedCoCi({ ...options,
    sourceIdentity: () => ({ commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true }),
    execute: (command: string, args: string[], call: any) => {
      if (command !== 'psql' && args[0].endsWith('/co/rollout.mjs')) return 'CO_ATOMIC_ROLLOUT_LIFECYCLE_PASSED\n'
      if (call.input?.includes("SELECT 'CO_FINAL_AUDIENCES_PASSED'")) return 'CO_FINAL_AUDIENCES_PASSED\n'
      if (call.input?.includes('CO_FIXTURE_OBSERVATION')) return JSON.stringify({
        database: call.env.PGDATABASE, operator: 'postgres', database_owner: 'postgres',
        system_identifier: '1234567890', server_version_num: '170011', server_address: '127.0.0.1', server_port: 65437,
        marker: { kind: 'r', owner: 'postgres', rows: [{ purpose: 'disposable-pilot-ci' }] },
      })
      if (call.input?.includes('CO_CREATE_FIXTURE_IDENTITY')) return ''
      if (call.input?.includes('CO_VERIFY_FIXTURE_IDENTITY')) return 't'
      if (call.input?.includes("datname='pilot_co_rollout_test'")) return 't'
      if (call.input === 'CREATE DATABASE pilot_co_rollout_test WITH TEMPLATE pilot_co_test OWNER postgres;') return ''
      return options.execute(command, args, call)
    },
  })
}

describe('CO disposable runner target guards', () => {
  test('accepts only the fixed local fixture and strips unrelated environment', () => {
    expect(coCiConnection({ ...clean, SECRET: 'must-not-reach-child', HOME: '/unsafe', NODE_OPTIONS: '--inspect', LD_PRELOAD: '/unsafe.so', PGTZ: 'America/New_York', PGCONNECT_TIMEOUT: '999' })).toEqual({ ...clean, PGCONNECT_TIMEOUT: '5', PGTZ: 'UTC', PGPASSFILE: '/dev/null/co-ci-no-password', PGSYSCONFDIR: '/dev/null' })
  })
  test.each([
    ['PGHOST', 'db.example.com'], ['PGHOST', 'localhost'], ['PGHOST', '/tmp'],
    ['PGPORT', '5432'], ['PGPORT', '65438'], ['PGPORT', '65437,5432'],
    ['PGUSER', 'app'], ['PGDATABASE', 'postgres'], ['PGDATABASE', 'pilot_co_test'], ['PGDATABASE', 'pilot_co_race_test'],
    ['PGHOSTADDR', '203.0.113.9'], ['PGSERVICE', 'production'], ['PGSERVICEFILE', '/tmp/pg_service.conf'],
    ['PGOPTIONS', '-c search_path=public'], ['PGPASSWORD', 'secret'], ['PGPASSFILE', '/tmp/pass'],
    ['PGSSLMODE', 'require'], ['DATABASE_URL', 'postgresql://prod/db'], ['SUPABASE_DB_URL', 'postgresql://prod/db'],
  ])('rejects ambient or unapproved target %s', (key, value) => {
    expect(() => coCiConnection({ ...clean, [key]: value })).toThrow()
  })
  test('only accepts the bounded through flag', () => {
    expect(coCiThrough([])).toBe('08')
    for (const stage of ['01', '02', '03', '04', '05', '06', '07', '08']) expect(coCiThrough(['--through', stage])).toBe(stage)
    for (const args of [['--through', '00'], ['--through', '09'], ['--file', 'evil.sql'], ['--database', 'prod'], ['--through', '01', '--url', 'bad']]) expect(() => coCiThrough(args)).toThrow()
  })
  test('rejects hosted target before starting any subprocess', () => {
    let calls = 0
    expect(() => runCoCi({ env: { ...clean, PGHOST: 'remote.invalid' }, through: '01', execute: () => { calls++; throw new Error('should not run') } })).toThrow()
    expect(calls).toBe(0)
  })
  test('a false aggregate preflight refuses database creation; SQL covers marker, owner, version and loopback predicates', () => {
    const calls: string[] = []
    expect(() => runCoCi({ env: clean, through: '01', execute: (_command: string, _args: string[], options: { input: string }) => { calls.push(options.input); return 'f\n' } })).toThrow(/PostgreSQL 17.*marker.*owner/)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("current_database()='pilot_test'")
    expect(calls[0]).toContain("current_user='postgres'")
    expect(calls[0]).toContain('170000')
    expect(calls[0]).toContain("inet_server_addr()='127.0.0.1'::inet")
    expect(calls[0]).toContain("purpose='disposable-pilot-ci'")
  })
  test('refuses an existing disposable database without dropping or loading it', () => {
    const calls: string[] = []
    expect(() => runCoCi({ env: clean, through: '01', execute: (_command: string, _args: string[], options: { input: string }) => { calls.push(options.input); return calls.length === 1 ? 't\n' : 'f\n' } })).toThrow(/already exists/)
    expect(calls).toHaveLength(2)
    expect(calls.join('\n')).not.toMatch(/CREATE DATABASE|DROP DATABASE/)
  })
  test('commits the enum stage before foundation, loads owner cutover once and ignores unlisted SQL', () => {
    const calls: { sql: string; database: string; env: Record<string, string> }[] = []
    const unlisted = 'supabase/migrations/99999999999999_co_runner_unlisted_test.sql'
    writeFileSync(unlisted, "SELECT 'CO_UNLISTED_SQL_MUST_NOT_EXECUTE';", { flag: 'wx' })
    try { runCoCi({ env: clean, through: '01', execute: (_command: string, _args: string[], options: { input: string; env: Record<string, string> }) => {
      calls.push({ sql: options.input, database: options.env.PGDATABASE, env: options.env })
      if (calls.length <= 2) return 't\n'
      return options.input.includes("'CO_FOUNDATION_AND_COMMANDS_PASSED'") ? 'CO_FOUNDATION_AND_COMMANDS_PASSED\n' : ''
    } }) } finally { unlinkSync(unlisted) }
    const role = calls.findIndex(call => call.sql.includes("ALTER TYPE public.user_role ADD VALUE"))
    const foundation = calls.findIndex(call => call.sql.includes('CREATE TABLE private.co_stock_keys'))
    expect(role).toBeGreaterThan(2)
    expect(foundation).toBe(role + 1)
    expect(calls[role].sql.trim()).toMatch(/COMMIT;$/)
    expect(calls.filter(call => call.sql.includes('CREATE TABLE private.pilot_store_credit_corrections_v1'))).toHaveLength(1)
    expect(calls.filter(call => call.sql.includes('CREATE DATABASE'))).toHaveLength(1)
    expect(calls.slice(3).every(call => call.database === 'pilot_co_test')).toBe(true)
    expect(calls.every(call => call.env.PGPASSFILE === '/dev/null/co-ci-no-password')).toBe(true)
    expect(calls.map(call => call.sql).join('\n')).not.toContain('DROP DATABASE')
    expect(calls.map(call => call.sql).join('\n')).not.toContain('CO_UNLISTED_SQL_MUST_NOT_EXECUTE')
  })
})

function stage02(marker: string) {
  const statements: string[] = []
  runCoCi({ env: clean, through: '02', execute: (_command: string, _args: string[], options: { input: string }) => {
    statements.push(options.input)
    if (statements.length <= 2) return 't\n'
    if (options.input.includes('CO_PROTECTED_BASELINE_FINGERPRINT')) return 'a'.repeat(64) + '\n'
    if (options.input.includes("SELECT 'CO_FOUNDATION_AND_COMMANDS_PASSED'")) return 'CO_FOUNDATION_AND_COMMANDS_PASSED\n'
    if (options.input.includes("SELECT 'CO_ORDERS_DELIVERIES_PASSED'")) return marker
    return ''
  } })
  return statements
}
test('stage 02 executes its real SQL suite after the foundation', () => {
  const statements = stage02('CO_ORDERS_DELIVERIES_PASSED\n')
  const foundation = statements.findIndex(sql => sql.includes("SELECT 'CO_FOUNDATION_AND_COMMANDS_PASSED'"))
  const delivery = statements.findIndex(sql => sql.includes("SELECT 'CO_ORDERS_DELIVERIES_PASSED'"))
  expect(delivery).toBeGreaterThan(foundation)
})
test.each(['', 'CO_ORDERS_DELIVERIES_PASSED\nCO_ORDERS_DELIVERIES_PASSED\n'])('stage 02 refuses absent or duplicate success evidence', marker => {
  expect(() => stage02(marker)).toThrow(/Orders\/deliveries success marker/)
})

test('stage 02 refuses any change to protected PO, promotion or owner evidence', () => {
  let call = 0
  let snapshots = 0
  expect(() => runCoCi({ env: clean, through: '02', execute: (_command: string, _args: string[], options: { input: string }) => {
    call++
    if (call <= 2) return 't\n'
    if (options.input.includes('CO_PROTECTED_BASELINE_FINGERPRINT')) return (++snapshots === 1 ? 'a' : 'b').repeat(64) + '\n'
    if (options.input.includes("SELECT 'CO_FOUNDATION_AND_COMMANDS_PASSED'")) return 'CO_FOUNDATION_AND_COMMANDS_PASSED\n'
    if (options.input.includes("SELECT 'CO_ORDERS_DELIVERIES_PASSED'")) return 'CO_ORDERS_DELIVERIES_PASSED\n'
    return ''
  } })).toThrow(/Protected PO\/promotion\/owner baseline changed/)
})

function stage03(marker = 'CO_MONTHLY_FIFO_PASSED\n', changed = false) {
  const statements: string[] = []; let snapshots = 0
  runCoCi({ env: clean, through: '03', execute: (_command: string, _args: string[], options: { input: string }) => {
    statements.push(options.input)
    if (statements.length <= 2) return 't\n'
    if (options.input.includes('CO_PROTECTED_BASELINE_FINGERPRINT')) return (++snapshots >= 3 && changed ? 'b' : 'a').repeat(64) + '\n'
    if (options.input.includes("SELECT 'CO_FOUNDATION_AND_COMMANDS_PASSED'")) return 'CO_FOUNDATION_AND_COMMANDS_PASSED\n'
    if (options.input.includes("SELECT 'CO_ORDERS_DELIVERIES_PASSED'")) return 'CO_ORDERS_DELIVERIES_PASSED\n'
    if (options.input.includes("SELECT 'CO_MONTHLY_FIFO_PASSED'")) return marker
    return ''
  } })
  return statements
}
test('stage 03 executes real monthly behavior after committed delivery sources', () => {
  const statements = stage03()
  expect(statements.findIndex(s => s.includes("SELECT 'CO_MONTHLY_FIFO_PASSED'"))).toBeGreaterThan(statements.findIndex(s => s.includes("SELECT 'CO_ORDERS_DELIVERIES_PASSED'")))
})
test.each(['', 'CO_MONTHLY_FIFO_PASSED\nCO_MONTHLY_FIFO_PASSED\n'])('stage 03 requires exactly one monthly success marker', marker => {
  expect(() => stage03(marker)).toThrow(/Monthly FIFO success marker/)
})
test('stage 03 preserves protected baseline fingerprints', () => {
  expect(() => stage03(undefined, true)).toThrow(/Protected PO\/promotion\/owner baseline changed/)
})

function stage04(marker = 'CO_RETURNS_CORRECTIONS_PASSED\n', raceMarker = 'CO_REAL_RACES_PASSED\n', raceExists = false) {
 const calls: string[] = []
 runCoCi({ env: clean, through: '04', execute: (command: string, args: string[], options: { input?: string }) => {
  calls.push(options.input ?? args.join(' '))
  if (command !== 'psql') return raceMarker
  if (calls.length <= 2) return 't\n'
  if (options.input?.includes("datname='pilot_co_race_test'")) return raceExists ? 'f\n' : 't\n'
  if (options.input?.includes('CO_PROTECTED_BASELINE_FINGERPRINT')) return 'a'.repeat(64)+'\n'
  for (const m of ['CO_FOUNDATION_AND_COMMANDS_PASSED','CO_ORDERS_DELIVERIES_PASSED','CO_MONTHLY_FIFO_PASSED']) if (options.input?.includes(`SELECT '${m}'`)) return m+'\n'
  if (options.input?.includes("SELECT 'CO_RETURNS_CORRECTIONS_PASSED'")) return marker
  return ''
 } })
 return calls
}
test('stage04 runs audited corrections and real race entry after prior checkpoints', () => {
 const calls = stage04()
 expect(calls.some(c => c.includes("SELECT 'CO_RETURNS_CORRECTIONS_PASSED'"))).toBe(true)
 expect(calls.some(c => c.includes('tests/database/co/races.mjs'))).toBe(true)
})
test.each(['','CO_RETURNS_CORRECTIONS_PASSED\nCO_RETURNS_CORRECTIONS_PASSED\n'])('stage04 demands one correction marker', m => expect(() => stage04(m)).toThrow(/Returns\/corrections success marker/))
test.each(['','CO_REAL_RACES_PASSED\nCO_REAL_RACES_PASSED\n'])('stage04 demands one real-race marker', m => expect(() => stage04(undefined,m)).toThrow(/Real races success marker/))

test('stage04 clones only the fixed fresh race database after staged SQL and refuses reuse', () => {
 const calls=stage04()
 const clone=calls.indexOf('CREATE DATABASE pilot_co_race_test WITH TEMPLATE pilot_co_test OWNER postgres;')
 expect(clone).toBeGreaterThan(calls.findIndex(c=>c.includes("SELECT 'CO_RETURNS_CORRECTIONS_PASSED'")))
 expect(calls.findIndex(c=>c.includes('tests/database/co/races.mjs'))).toBeGreaterThan(clone)
 expect(calls.filter(c=>c.startsWith('CREATE DATABASE'))).toHaveLength(2)
 expect(calls.join('\n')).not.toContain('DROP DATABASE')
 expect(()=>stage04(undefined,undefined,true)).toThrow(/pilot_co_race_test already exists/)
})

function stage05(readMarker='CO_OPERATIONAL_READS_PASSED\n',decoderMarker='CO_SQL_DECODERS_PASSED\n'){
 const calls:{command:string;args:string[];input?:string}[]=[]
 runCoCi({env:clean,through:'05',execute:(command:string,args:string[],options:{input?:string})=>{
  calls.push({command,args,input:options.input});if(command!=='psql')return args[0].endsWith('decode-reads.mjs')?decoderMarker:'CO_REAL_RACES_PASSED\n'
  if(calls.length<=2||options.input?.includes("datname='pilot_co_race_test'"))return 't\n'
  if(options.input?.includes('CO_PROTECTED_BASELINE_FINGERPRINT'))return 'a'.repeat(64)+'\n'
  for(const m of ['CO_FOUNDATION_AND_COMMANDS_PASSED','CO_ORDERS_DELIVERIES_PASSED','CO_MONTHLY_FIFO_PASSED','CO_RETURNS_CORRECTIONS_PASSED'])if(options.input?.includes(`SELECT '${m}'`))return m+'\n'
  if(options.input?.includes("SELECT 'CO_OPERATIONAL_READS_PASSED'"))return readMarker
  return ''
 }})
 return calls
}
test('stage05 always sends actual SQL stdout to the fixed production decoder bridge',()=>{const calls=stage05('actual-output\nCO_OPERATIONAL_READS_PASSED\n');const bridge=calls.find(c=>c.args[0]?.endsWith('decode-reads.mjs'));expect(bridge?.input).toBe('actual-output\nCO_OPERATIONAL_READS_PASSED\n');expect(calls.filter(c=>c.args[0]?.endsWith('decode-reads.mjs'))).toHaveLength(1)})
test.each(['','CO_OPERATIONAL_READS_PASSED\nCO_OPERATIONAL_READS_PASSED\n'])('stage05 requires exact operational SQL evidence',m=>expect(()=>stage05(m)).toThrow(/Operational reads/))
test.each(['','CO_SQL_DECODERS_PASSED\nCO_SQL_DECODERS_PASSED\n'])('stage05 cannot skip or duplicate actual decoder evidence',m=>expect(()=>stage05(undefined,m)).toThrow(/Actual SQL decoder/))

function stage06(marker = 'CO_SALES_METRICS_PASSED\n', decoderMarker = 'CO_SALES_METRICS_DECODERS_PASSED\n', changed = false) {
  const calls: { command: string; args: string[]; input?: string }[] = []
  let salesRan = false
  runCoCi({ env: clean, through: '06', execute: (command: string, args: string[], options: { input?: string }) => {
    calls.push({ command, args, input: options.input })
    if (command !== 'psql') {
      if (args[0].endsWith('decode-sales-metrics.mjs')) return decoderMarker
      return args[0].endsWith('decode-reads.mjs') ? 'CO_SQL_DECODERS_PASSED\n' : 'CO_REAL_RACES_PASSED\n'
    }
    if (calls.length <= 2 || options.input?.includes("datname='pilot_co_race_test'")) return 't\n'
    if (options.input?.includes('CO_PROTECTED_BASELINE_FINGERPRINT')) return (salesRan && changed ? 'b' : 'a').repeat(64) + '\n'
    for (const m of ['CO_FOUNDATION_AND_COMMANDS_PASSED', 'CO_ORDERS_DELIVERIES_PASSED', 'CO_MONTHLY_FIFO_PASSED', 'CO_RETURNS_CORRECTIONS_PASSED', 'CO_OPERATIONAL_READS_PASSED']) if (options.input?.includes(`SELECT '${m}'`)) return m + '\n'
    if (options.input?.includes("SELECT 'CO_SALES_METRICS_PASSED'")) { salesRan = true; return marker }
    return ''
  } })
  return calls
}
test('stage06 sends exact actual stdout to its mandatory production decoder before real races', () => {
  const output = 'CO_SALES_METRICS_CONTRACT|actual-authenticated-output\nCO_SALES_METRICS_PASSED\n'
  const calls = stage06(output)
  const bridges = calls.filter(c => c.args[0]?.endsWith('decode-sales-metrics.mjs'))
  expect(bridges).toHaveLength(1); expect(bridges[0].input).toBe(output)
  expect(calls.indexOf(bridges[0])).toBeLessThan(calls.findIndex(c => c.args[0]?.endsWith('races.mjs')))
})
test.each(['', 'CO_SALES_METRICS_PASSED\nCO_SALES_METRICS_PASSED\n'])('stage06 refuses absent or duplicated SQL evidence', m => expect(() => stage06(m)).toThrow(/Sales metrics success marker/))
test.each(['', 'CO_SALES_METRICS_DECODERS_PASSED\nCO_SALES_METRICS_DECODERS_PASSED\n'])('stage06 refuses absent or duplicated decoder evidence', m => expect(() => stage06(undefined, m)).toThrow(/Actual Sales metrics decoder/))
test('stage06 protects earlier PO, promotion and owner fingerprints', () => expect(() => stage06(undefined, undefined, true)).toThrow(/Protected PO\/promotion\/owner baseline changed/))

function stage07({badMarker, changedAt,through='07',evidenceRaceMarker='CO_EVIDENCE_REAL_RACES_PASSED\n'}: {badMarker?:string;evidenceRaceMarker?:string;changedAt?:'topology'|'migration'|'access'|'hr'|'evidence-topology'|'evidence-migration'|'evidence';through?:string}={}) {
 const calls:{input?:string;cwd?:string;args:string[]}[]=[];let phase='before'
 runCoCi({env:clean,through,execute:(command:string,args:string[],options:{input?:string;cwd?:string})=>{
  calls.push({input:options.input,cwd:options.cwd,args})
  if(command!=='psql')return args[0].endsWith('decode-sales-metrics.mjs')?'CO_SALES_METRICS_DECODERS_PASSED\n':args[0].endsWith('decode-reads.mjs')?'CO_SQL_DECODERS_PASSED\n':'CO_REAL_RACES_PASSED\n'+(through==='08'?evidenceRaceMarker:'')
  if(calls.length<=2||options.input?.includes("datname='pilot_co_race_test'"))return 't\n'
  if(options.input?.includes('CO_PROTECTED_BASELINE_FINGERPRINT'))return (phase===changedAt?'b':'a').repeat(64)+'\n'
  if(options.input?.includes("SELECT 'CO_EVIDENCE_TOPOLOGY_PASSED'")){phase='evidence-topology';return badMarker==='CO_EVIDENCE_TOPOLOGY_PASSED'?'':'CO_EVIDENCE_TOPOLOGY_PASSED\n'}
  if(options.input?.includes('CREATE TABLE private.co_evidence ('))phase='evidence-migration'
  if(options.input?.includes("SELECT 'CO_EVIDENCE_PASSED'")){phase='evidence';return badMarker==='CO_EVIDENCE_PASSED'?'':'CO_EVIDENCE_PASSED\n'}
  if(options.input?.includes("SELECT 'CO_ACCESS_TOPOLOGY_PASSED'")){phase='topology';return badMarker==='CO_ACCESS_TOPOLOGY_PASSED'?'':'CO_ACCESS_TOPOLOGY_PASSED\n'}
  if(options.input?.includes('CREATE FUNCTION public.pilot_procurement_access_v1'))phase='migration'
  for(const marker of ['CO_FOUNDATION_AND_COMMANDS_PASSED','CO_ORDERS_DELIVERIES_PASSED','CO_MONTHLY_FIFO_PASSED','CO_RETURNS_CORRECTIONS_PASSED','CO_OPERATIONAL_READS_PASSED','CO_SALES_METRICS_PASSED','CO_ACCESS_BOUNDARIES_PASSED','CO_HR_PRESERVATION_PASSED'])if(options.input?.includes(`SELECT '${marker}'`)){
   if(marker==='CO_ACCESS_BOUNDARIES_PASSED')phase='access'
   if(marker==='CO_HR_PRESERVATION_PASSED')phase='hr'
   return badMarker===marker?'':marker+'\n'
  }
  return ''
 }})
 return calls
}
test('stage07 resolves rollback HR includes from the exact suite directory and preserves both decoder bridges/races',()=>{const calls=stage07();for(const marker of ['CO_ACCESS_BOUNDARIES_PASSED','CO_HR_PRESERVATION_PASSED'])expect(calls.find(c=>c.input?.includes(`SELECT '${marker}'`))?.cwd).toMatch(/tests\/database\/co$/);for(const file of ['decode-reads.mjs','decode-sales-metrics.mjs','races.mjs'])expect(calls.filter(c=>c.args[0]?.endsWith(file))).toHaveLength(1)})
test.each(['CO_ACCESS_TOPOLOGY_PASSED','CO_ACCESS_BOUNDARIES_PASSED','CO_HR_PRESERVATION_PASSED'])('stage07 rejects missing %s',badMarker=>expect(()=>stage07({badMarker})).toThrow(/required exactly once/))
test.each(['topology','migration','access','hr'] as const)('stage07 compares %s against the original fingerprint, never a refreshed baseline',changedAt=>expect(()=>stage07({changedAt})).toThrow(/baseline changed/))

test('stage08 models only reviewed storage fields before exact migration and rollback lifecycle tests',()=>{const calls=stage07({through:'08'});const fixture=calls.findIndex(c=>c.input?.includes('ALTER TABLE storage.objects ADD COLUMN version text'));const drift=calls.findIndex(c=>c.input?.includes("SELECT 'CO_EVIDENCE_TOPOLOGY_PASSED'"));const migration=calls.findIndex((c,i)=>i>drift&&c.input?.includes('CREATE TABLE private.co_evidence ('));const evidence=calls.findIndex(c=>c.input?.includes("SELECT 'CO_EVIDENCE_PASSED'"));expect(fixture).toBeLessThan(drift);expect(drift).toBeLessThan(migration);expect(migration).toBeLessThan(evidence);expect(calls.findIndex(c=>c.args[0]?.endsWith('races.mjs'))).toBeGreaterThan(evidence);});
test.each(['CO_EVIDENCE_TOPOLOGY_PASSED','CO_EVIDENCE_PASSED'])('stage08 requires %s',badMarker=>expect(()=>stage07({through:'08',badMarker})).toThrow(/required exactly once/));
test.each(['evidence-topology','evidence-migration','evidence'] as const)('stage08 preserves original protected fingerprint after %s',changedAt=>expect(()=>stage07({through:'08',changedAt})).toThrow(/baseline changed/));

test.each(['','CO_EVIDENCE_REAL_RACES_PASSED\nCO_EVIDENCE_REAL_RACES_PASSED\n'])('stage08 requires exactly one supporting real-race marker',evidenceRaceMarker=>expect(()=>stage07({through:'08',evidenceRaceMarker})).toThrow(/Evidence real races/));
