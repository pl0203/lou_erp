// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { coCiConnection, coFixtureChildEnv } from '../../scripts/co-fixture-target.mjs'
import { runCoWorkspaceDb } from '../../scripts/test-co-workspace-db.mjs'
const source = { clean: true, commit: 'a'.repeat(40), tree: 'b'.repeat(40) }
const env = { PATH: '/usr/bin', CO_CI_PROFILE: 'github-co-workspace-v1', CO_CI_SOURCE_SHA: source.commit,
 CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'pl0203/lou_erp', GITHUB_WORKFLOW: 'CO workspace runtime',
 GITHUB_JOB: 'workspace-sql', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'c'.repeat(40),
 PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'pilot_test', PGPASSWORD: 'synthetic-ci-only' }
it('accepts only the explicit workspace profile and keeps context for independently guarded children', () => {
 const connection = coCiConnection(env, source)
 expect(connection.PGPORT).toBe('5432')
 const child = coFixtureChildEnv(connection, env, { source, runIdentity: '123:1' })
 expect(child).toMatchObject({ CO_CI_PROFILE: env.CO_CI_PROFILE, CO_CI_SOURCE_SHA: source.commit, GITHUB_WORKFLOW: env.GITHUB_WORKFLOW, GITHUB_JOB: env.GITHUB_JOB })
 expect(JSON.parse(child.CO_FIXTURE_IDENTITY)).toEqual({source,runIdentity:'123:1'})
})
it.each(['import-manifest','import-posting','import-races','workspace-reads'])('reaches read-only disposable preflight for %s, never skips it', caseName => {
 const execute = vi.fn(() => 'f\n')
 expect(() => runCoWorkspaceDb({ env, caseName, sourceIdentity: () => source, execute })).toThrow(/PostgreSQL 17 disposable marker and owner required/)
 expect(execute).toHaveBeenCalledTimes(1)
 const [command,,options] = execute.mock.calls[0] as any
 expect(command).toBe('psql'); expect(options.input).toContain('pilot_fixture_marker'); expect(options.input).not.toContain('CREATE DATABASE')
})
it.each([
 ['CO_CI_PROFILE','github-pilot-safety-v1'], ['CO_CI_SOURCE_SHA','d'.repeat(40)], ['GITHUB_WORKFLOW','Pilot safety checks'],
 ['GITHUB_JOB','synthetic-safety'], ['GITHUB_REPOSITORY','other/repo'], ['GITHUB_RUN_ID',''], ['GITHUB_RUN_ATTEMPT','0'],
 ['CI','false'], ['GITHUB_ACTIONS','false'], ['GITHUB_SHA','bad'], ['PGHOST','example.invalid'], ['PGPORT','65437'],
 ['PGPASSWORD','secret'], ['PGOPTIONS','-c role=postgres'], ['SUPABASE_DB_URL','postgres://hosted'], ['LD_LIBRARY_PATH','/unsafe'],
])('rejects workspace drift in %s before any process', (key,value) => {
 const execute = vi.fn()
 expect(() => runCoWorkspaceDb({ env: {...env,[key]:value}, sourceIdentity: () => source, execute })).toThrow()
 expect(execute).not.toHaveBeenCalled()
})
it('requires a clean actual source before CI processes', () => {
 const execute = vi.fn()
 expect(() => runCoWorkspaceDb({ env, sourceIdentity: () => ({...source,clean:false}), execute })).toThrow()
 expect(execute).not.toHaveBeenCalled()
})
it('keeps the race child on the same workspace guard and immutable CI server binding', async () => {
 const { coWorkspaceConnection, coBindFixtureServer } = await import('../../scripts/co-fixture-target.mjs')
 const { readFileSync } = await import('node:fs')
 const race = readFileSync(new URL('../database/co/import-races.mjs', import.meta.url),'utf8')
 expect(race).toContain('const guarded = coWorkspaceConnection(input, source)')
 expect(coWorkspaceConnection(env,source).PGPORT).toBe('5432')
 expect(() => coWorkspaceConnection({...env,CO_CI_PROFILE:'github-pilot-safety-v1'},source)).toThrow()
 const profile = {kind:'ci',database:'pilot_co_test',source,runIdentity:'123:1'}
 const observation = {database:'pilot_co_test',operator:'postgres',database_owner:'postgres',system_identifier:'123456',server_version_num:'170011',server_address:'172.18.0.2',server_port:5432,marker:{kind:'r',owner:'postgres',rows:[{purpose:'disposable-pilot-ci'}]}}
 const identity = coBindFixtureServer(profile,observation)
 expect(() => coBindFixtureServer(profile,{...observation,system_identifier:'123457'},identity)).toThrow()
 expect(() => coBindFixtureServer({...profile,runIdentity:'123:2'},observation,identity)).toThrow()
 expect(() => coBindFixtureServer({...profile,source:{...source,tree:'d'.repeat(40)}},observation,identity)).toThrow()
})
