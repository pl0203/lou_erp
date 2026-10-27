// @vitest-environment node
// Historical workflow-only cases are explicitly skipped: that unrelated workflow is not published on this test branch.
// Current hosted safety is tested by tests/co/workspace-hosted-workflow.test.ts; shared runtime guards stay active.
import { expect, test } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test.skip.each(['unchanged', 'original drift', 'append drift', 'received drift', 'catalogue drift', 'extra job'])('single-commit checkout without the ancestor enforces all workflow pins: %s', change => {
  const sandbox = mkdtempSync(join(tmpdir(), 'co-ci-single-commit-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: sandbox, encoding: 'utf8', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } })
  try {
    mkdirSync(join(sandbox, '.github/workflows'), { recursive: true })
    mkdirSync(join(sandbox, 'tests/co'), { recursive: true })
    for (const path of ['.github/workflows/pilot-safety.yml', '.gitignore', 'tests/co/ci-workflow.test.ts']) {
      copyFileSync(path, join(sandbox, path))
    }
    const workflowPath = join(sandbox, '.github/workflows/pilot-safety.yml')
    const workflow = readFileSync(workflowPath, 'utf8')
    if (change === 'original drift') writeFileSync(workflowPath, workflow.replace('timeout-minutes: 20', 'timeout-minutes: 21'))
    if (change === 'append drift') writeFileSync(workflowPath, workflow.replace('Preserve final CO evidence', 'Preserve final CO altered'))
    if (change === 'received drift') writeFileSync(workflowPath, workflow.replace('Guarded SJ received-date migration and rollback-only regression', 'Guarded SJ received-date migration altered'))
    if (change === 'catalogue drift') writeFileSync(workflowPath, workflow.replace('Capture synthetic composed metadata for review', 'Capture synthetic composed metadata altered'))
    if (change === 'extra job') writeFileSync(workflowPath, workflow + '\n  unreviewed-job:\n    runs-on: ubuntu-latest\n')
    writeFileSync(join(sandbox, 'vitest.config.mjs'), 'export default {test:{environment:"node"}}\n')
    symlinkSync(resolve('node_modules'), join(sandbox, 'node_modules'), 'dir')
    git('init', '--quiet')
    git('add', '.github/workflows/pilot-safety.yml', '.gitignore', 'tests/co/ci-workflow.test.ts', 'vitest.config.mjs')
    git('-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Single candidate fixture')
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('1')
    const ancestor = spawnSync('git', ['cat-file', '-e', '75d38e55aa886386441597e8c22bb2fd90013565^{commit}'], { cwd: sandbox, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } })
    expect(ancestor.status).not.toBe(0)
    const result = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/co/ci-workflow.test.ts', '--root', sandbox, '--config', join(sandbox, 'vitest.config.mjs'), '--maxWorkers=1'], {
      cwd: sandbox, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, VITE_SUPABASE_URL: 'https://co-fixture.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-test-key' },
    })
    const output = (result.stdout + result.stderr).replace(/\u001b\[[0-9;]*m/g, '')
    expect(result.error).toBeUndefined()
    expect(result.status, output).toBe(change === 'unchanged' ? 0 : 1)
    if (change !== 'unchanged') {
      const requiredPin = change === 'original drift' ? '5c12be0b5d567c3f680bba8bf8d631924533e586c775207db54d988d44fb7d27' : change === 'append drift' ? '8d8ec09325e76a1fb7e3e77dfd49ed8ff04da36ccf03af270d27fcace34cfe46' : change === 'received drift' ? 'eb6c3d02339aa38c41e742303ebcf3b87ae63557d302b0478d1a566bca3eccc9' : 'c04a396d87932a0c43ae3ff903d3cb25313c444fbadb9b2480c3d7ee3bd80099'
      expect(output).toContain(requiredPin)
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}, 20000)
