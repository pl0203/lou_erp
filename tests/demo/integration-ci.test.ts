// @vitest-environment node
import { expect, test } from 'vitest'
import { demoCiConnection, runDemoRevisionsCi } from '../../scripts/test-demo-revisions-ci.mjs'
test('demo CI connection permits only the fixed disposable owner database and loopback', () => {
 const env = { PATH: '/usr/bin', PGHOST: '127.0.0.1', PGPORT: '65479', PGUSER: 'postgres', PGDATABASE: 'pilot_test', PGHOSTADDR: 'hosted.example', PGSERVICE: 'ignored', PGPASSWORD: 'real-secret', PGOPTIONS: '-c search_path=evil' }
 expect(demoCiConnection(env)).toEqual({ PATH: '/usr/bin', PGHOST: '127.0.0.1', PGPORT: '65479', PGUSER: 'postgres', PGDATABASE: 'pilot_test', PGCONNECT_TIMEOUT: '5', PGTZ: 'UTC' })
 for (const patch of [{ PGHOST: 'db.example.com' }, { PGHOST: 'localhost' }, { PGUSER: 'service_role' }, { PGDATABASE: 'postgres' }, { PGPORT: '0' }, { PGPORT: '65479;rm' }]) expect(() => demoCiConnection({ ...env, ...patch })).toThrow()
})
test('the only password path is the exact bounded ephemeral repository CI service', () => {
 const env = { PATH: '/usr/bin', PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'pilot_test', PGPASSWORD: 'synthetic-ci-only', CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'pl0203/lou_erp', GITHUB_RUN_ID: '123', GITHUB_JOB: 'synthetic-safety', GITHUB_WORKFLOW: 'Pilot safety checks' }
 expect(demoCiConnection(env).PGPASSWORD).toBe('synthetic-ci-only')
 expect(() => demoCiConnection({ ...env, GITHUB_REPOSITORY: 'elsewhere/repo' })).toThrow()
 expect(() => demoCiConnection({ ...env, PGPASSWORD: 'unexpected' })).toThrow()
})
test('workflow stages complete demo proofs after immutable HR and source-pins the isolated packet lifecycle', async () => {
 const { readFileSync } = await import('node:fs')
 const workflow = readFileSync('.github/workflows/pilot-safety.yml','utf8')
 expect(workflow).toContain('      PGTZ: UTC\n')
 const demo = workflow.indexOf('      - name: Complete demo revision composition and real races')
 const lifecycle = workflow.indexOf('      - name: Atomic demo rollout safety lifecycle')
 expect(demo).toBeGreaterThan(workflow.indexOf('      - name: Guarded PO Admin Director route regression'))
 expect(lifecycle).toBeGreaterThan(demo)
 expect(lifecycle).toBeLessThan(workflow.indexOf('      - name: Atomic read rollout'))
 const step = workflow.slice(lifecycle,workflow.indexOf('      - name: Atomic read rollout'))
 expect(step).toContain('DEMO_ROLLOUT_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}')
 expect(step).toContain('DEMO_ROLLOUT_PERMIT: disposable-demo-rollout-ci')
 expect(step).toContain("-c 'CREATE DATABASE demo_rollout_test;'")
 expect(step).toContain('PGDATABASE=demo_rollout_test node tests/demo/rollout-database.mjs')
 expect(step).not.toMatch(/DROP DATABASE|GITHUB_SHA|PGHOSTADDR|PGSERVICE/)
})

test('a missing fixture or already-migrated stage fails before any companion creation or file mutation', () => {
 const env = { PATH: '/usr/bin', PGHOST: '127.0.0.1', PGPORT: '65479', PGUSER: 'postgres', PGDATABASE: 'pilot_test' }
 for (const outputs of [['f'], ['t','f']]) {
  const calls: { sql: string; env: Record<string,string> }[] = []
  const execute = (_command: string, _args: string[], options: any) => { calls.push({ sql: options.input, env: options.env }); return outputs[calls.length-1] }
  expect(() => runDemoRevisionsCi({ env, execute: execute as any })).toThrow()
  expect(calls).toHaveLength(outputs.length)
  expect(calls.every(call => call.sql.startsWith('SELECT ') && !call.sql.includes('CREATE DATABASE'))).toBe(true)
  expect(calls[0].sql).toContain("inet_server_addr()='127.0.0.1'::inet")
  expect(calls[0].env).not.toHaveProperty('PGOPTIONS')
 }
})

test('actual promotion RPC contract reaches installed local Vitest without a package-manager fallback', () => {
 const env = { PATH: '/usr/bin', PGHOST: '127.0.0.1', PGPORT: '65479', PGUSER: 'postgres', PGDATABASE: 'pilot_test' }
 const calls: { command: string; args: string[]; options: any }[] = []
 const contract = '{"version":1,"as_of":"2026-10-08T12:00:00Z","items":[]}'
 const execute = (command: string, args: string[], options: any) => {
  calls.push({ command, args, options })
  if (options.input?.startsWith('SELECT current_database') || options.input?.startsWith("SELECT to_regclass('private.pilot_visit_requests')")) return 't'
  if (args[0]?.endsWith('order-promo-cutover.mjs')) return `DEMO_PROMOTION_READ_CONTRACT=${contract}\n`
  return ''
 }
 runDemoRevisionsCi({ env, execute: execute as any })
 const parser = calls.find(call => call.options.env.DEMO_PROMOTION_CONTRACT_JSON)
 expect(parser?.command).toBe(process.execPath)
 expect(parser?.args).toEqual([`${process.cwd()}/node_modules/vitest/vitest.mjs`, 'run', 'tests/demo/promotion-admin.test.tsx', '--maxWorkers=1'])
 expect(parser?.options.cwd).toBe(process.cwd())
 expect(parser?.options.env.DEMO_PROMOTION_CONTRACT_JSON).toBe(contract)
 expect(parser?.options.env.VITE_SUPABASE_URL).toBe('https://example.invalid')
 expect(calls.some(call => ['npm','npx'].includes(call.command))).toBe(false)
})
