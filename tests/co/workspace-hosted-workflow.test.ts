// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
const workflow=readFileSync('.github/workflows/co-workspace-runtime.yml','utf8')

test('dedicated CO workflow is the only executable workflow in the curated tree',()=>{
 expect(readdirSync('.github/workflows').filter(name=>/\.ya?ml$/.test(name))).toEqual(['co-workspace-runtime.yml'])
 expect(workflow).toContain('name: CO workspace runtime')
 expect(workflow).toContain('  pull_request:')
 expect(workflow).not.toMatch(/pull_request_target|workflow_run|workflow_dispatch/)
 expect(workflow).toContain('branches: [main]')
 expect(workflow).toContain("github.event.pull_request.head.ref == 'test/co-workspace-runtime-20261027'")
})
test('hosted execution uses only bounded standard Ubuntu and fresh per-case PostgreSQL services',()=>{
 expect(workflow.match(/runs-on: ubuntu-24.04/g)).toHaveLength(2)
 expect(workflow.match(/timeout-minutes: 20/g)).toHaveLength(2)
 expect(workflow).toContain('case: [import-manifest, import-posting, import-races, workspace-reads]')
 expect(workflow).toContain('max-parallel: 2')
 expect(workflow).toContain('fail-fast: false')
 expect(workflow).toContain('image: postgres:17.11')
 expect(workflow).toContain('--memory=2g --cpus=2 --log-driver=none')
 expect(workflow).toContain('CREATE TABLE public.pilot_fixture_marker')
 expect(workflow).toContain('node scripts/test-co-workspace-db.mjs --case "$FIXED_CASE"')
 expect(workflow).not.toMatch(/DROP DATABASE|TRUNCATE|test-co-ci\.mjs/)
})
test('no artifact/cache upload, secrets, deploy step or persistent credential is admitted',()=>{
 expect(workflow).toContain('permissions:\n  contents: read')
 expect(workflow).not.toMatch(/secrets\.|contents: write|id-token:|upload-artifact|download-artifact|actions\/cache|cache:\s*(?:npm|true)|\bvercel\b|supabase (?:db|functions)|persist-credentials: true/)
 expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2)
 expect(workflow.match(/uses: .*@[a-f0-9]{40}/g)).toHaveLength(5)
 expect(workflow).toContain('npm ci --ignore-scripts --no-audit --no-fund')
})
test('source admission and native runtimes bind exact head without weakening local database guards',()=>{
 expect(workflow.match(/ref: \$\{\{ github.event.pull_request.head.sha \}\}/g)).toHaveLength(2)
 expect(workflow.match(/run: node scripts\/verify-co-public-ci.mjs/g)).toHaveLength(2)
 expect(workflow).toContain('CO_CI_PROFILE: github-co-workspace-v1')
 expect(workflow).toContain('CO_NATIVE_SOURCE_SHA: ${{ github.event.pull_request.head.sha }}')
 expect(workflow).toContain('deno-version: v2.9.7')
 expect(workflow).toContain('run: node tests/co-deno/preflight.mjs')
 expect(workflow).toContain('cache: false')
 expect(workflow).toContain('deno check --config deno.co-runtime.json --cached-only --no-remote')
 expect(workflow).toContain('deno test --config deno.co-runtime.json --cached-only --no-remote')
 expect(workflow).not.toMatch(/--allow-|unset CI|env -u|CI: false/)
 expect(workflow).toContain('node tests/co-browser/run.mjs')
})

test('native diagnostics run before the slow aggregate without masking failures',()=>{
 const native=workflow.slice(workflow.indexOf('  native-runtime:'))
 expect(native.indexOf('Native Deno Edge type graph')).toBeLessThan(native.indexOf('run: npm test'))
 expect(native.indexOf('Native Chrome synthetic')).toBeLessThan(native.indexOf('run: npm test'))
 expect(native).toContain("if: ${{ !cancelled() && steps.native-dependencies.outcome == 'success' }}")
 expect(native).not.toContain('continue-on-error')
})

test('native cleanup regressions must pass before hosted Chrome starts',()=>{
 const native=workflow.slice(workflow.indexOf('  native-runtime:'))
 expect(native).toContain('node --test tests/co-browser/cleanup.node.mjs\n          node tests/co-browser/run.mjs')
})


test('native Node cleanup tests stay outside Vitest automatic discovery',()=>{
 const files=readdirSync('tests/co-browser')
 expect(files).toContain('cleanup.node.mjs')
 expect(files.filter(name=>/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name))).toEqual([])
})
