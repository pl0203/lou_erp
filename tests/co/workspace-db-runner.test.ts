// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { workspaceCase, runCoWorkspaceDb } from '../../scripts/test-co-workspace-db.mjs';
it('accepts only a fixed case, never target URLs/options', () => { expect(workspaceCase(['--case', 'import-manifest'])).toBe('import-manifest'); for (const args of [[], ['--url', 'postgres://host/db'], ['--case', 'other'], ['--case', 'import-manifest', '--unsafe']])
    expect(() => workspaceCase(args)).toThrow(); });
it('refuses ambient credentials and target overrides before any executable SQL', () => { for (const change of [{ PGHOST: 'remote' }, { DATABASE_URL: 'postgres://host/db' }, { PGPASSWORD: 'secret' }, { PGPORT: '5432' }]) {
    const execute = vi.fn();
    expect(() => runCoWorkspaceDb({ env: { PGHOST: '127.0.0.1', PGPORT: '65437', PGUSER: 'postgres', PGDATABASE: 'pilot_test', ...change }, execute, sourceIdentity: () => ({ clean: true, commit: 'a'.repeat(40), tree: 'b'.repeat(40) }) })).toThrow();
    expect(execute).not.toHaveBeenCalled();
} });
it('refuses dirty source before any SQL execution', () => { const execute = vi.fn(); expect(() => runCoWorkspaceDb({ env: {}, execute, sourceIdentity: () => ({ clean: false }) })).toThrow(); expect(execute).not.toHaveBeenCalled(); });
it('refuses a complete CI profile before executing any process', () => {
    const source = { clean: true, commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const env = { CO_CI_PROFILE: 'github-pilot-safety-v1', CO_CI_SOURCE_SHA: source.commit, CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'pl0203/lou_erp', GITHUB_WORKFLOW: 'Pilot safety checks', GITHUB_JOB: 'synthetic-safety', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: source.commit, PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'pilot_test', PGPASSWORD: 'synthetic-ci-only' };
    const execute = vi.fn();
    expect(() => runCoWorkspaceDb({ env, execute, sourceIdentity: () => source })).toThrow();
    expect(execute).not.toHaveBeenCalled();
});
it.each(['CI', 'CO_CI_SOURCE_SHA', 'GITHUB_ACTIONS', 'GITHUB_JOB'])('refuses partial CI context %s before processes', key => {
    const execute = vi.fn();
    expect(() => runCoWorkspaceDb({ env: { [key]: 'present', PGHOST: '127.0.0.1', PGPORT: '65437', PGUSER: 'postgres', PGDATABASE: 'pilot_test' }, execute, sourceIdentity: () => ({ clean: true, commit: 'a'.repeat(40), tree: 'b'.repeat(40) }) })).toThrow();
    expect(execute).not.toHaveBeenCalled();
});
it('accepts fixed import-posting and import-races cases without opening target selection', () => {
    expect(workspaceCase(['--case','import-posting'])).toBe('import-posting');
    expect(workspaceCase(['--case','import-races'])).toBe('import-races');
    expect(() => workspaceCase(['--case','import-races','--url','postgres://host/db'])).toThrow();
});
it('accepts only the fixed workspace read fixture case',()=>{expect(workspaceCase(['--case','workspace-reads'])).toBe('workspace-reads');expect(()=>workspaceCase(['--case','workspace-reads','--url','postgres://host/db'])).toThrow()});
it('composes workspace assertions before the exact disposable rollback, never after it',async()=>{const {composeWorkspaceReadFixture}=await import('../../scripts/test-co-workspace-db.mjs');const posting="BEGIN;\nSELECT 1;\nROLLBACK;\nSELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';\n";const result=composeWorkspaceReadFixture(posting,'SELECT 2;');expect(result.indexOf('SELECT 2;')).toBeLessThan(result.indexOf('ROLLBACK;'));expect(result.endsWith("SELECT 'CO_WORKSPACE_READS_PASSED';\n")).toBe(true);expect(()=>composeWorkspaceReadFixture(posting,'COMMIT;')).toThrow();expect(()=>composeWorkspaceReadFixture(posting.replace('ROLLBACK;','COMMIT;'),'SELECT 2;')).toThrow()});
