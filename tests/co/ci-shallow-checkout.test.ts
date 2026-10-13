// @vitest-environment node
import { expect, test } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test.each(['unchanged', 'original drift', 'append drift'])('single-commit checkout without the ancestor enforces both workflow pins: %s', change => {
  const sandbox = mkdtempSync(join(tmpdir(), 'co-ci-single-commit-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: sandbox, encoding: 'utf8' })
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
    writeFileSync(join(sandbox, 'vitest.config.mjs'), 'export default {test:{environment:"node"}}\n')
    symlinkSync(resolve('node_modules'), join(sandbox, 'node_modules'), 'dir')
    git('init', '--quiet')
    git('add', '.github/workflows/pilot-safety.yml', '.gitignore', 'tests/co/ci-workflow.test.ts', 'vitest.config.mjs')
    git('-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Single candidate fixture')
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('1')
    const ancestor = spawnSync('git', ['cat-file', '-e', '75d38e55aa886386441597e8c22bb2fd90013565^{commit}'], { cwd: sandbox })
    expect(ancestor.status).not.toBe(0)
    const result = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/co/ci-workflow.test.ts', '--root', sandbox, '--config', join(sandbox, 'vitest.config.mjs'), '--maxWorkers=1'], {
      cwd: sandbox, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, VITE_SUPABASE_URL: 'https://co-fixture.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-test-key' },
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).toBe(change === 'unchanged' ? 0 : 1)
    if (change !== 'unchanged') {
      const requiredPin = change === 'original drift' ? '5c12be0b5d567c3f680bba8bf8d631924533e586c775207db54d988d44fb7d27' : '8d8ec09325e76a1fb7e3e77dfd49ed8ff04da36ccf03af270d27fcace34cfe46'
      expect(result.stdout + result.stderr).toContain(requiredPin)
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}, 20000)
