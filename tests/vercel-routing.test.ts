// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
const config = JSON.parse(readFileSync('vercel.json', 'utf8'))

test('Vercel serves the SPA entry point for fresh client-side deep links', () => {
  expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
  for (const path of ['/login', '/athel/po', '/athel/po/dummy-order', '/ihr/leave']) {
    expect(new RegExp(`^${config.rewrites[0].source}$`).test(path)).toBe(true)
    expect(config.rewrites[0].destination).toBe('/index.html')
  }
})

test('SPA routing preserves database preview deployment and backend guard configuration', () => {
  expect(config.git).toEqual({ deploymentEnabled: { 'fix/pilot-database': true, 'fix/po-admin-director': false, 'fix/pilot-scale-sql': false, 'ci/customer-categories-postgres': false, 'ci/ihr-leave-postgres': false } })
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(pkg.scripts.build).toBe('node scripts/verify-preview-backend.mjs && vite build')
})

test('known checkpoint branches have exact disabled flags without an overlapping enabled rule', () => {
  const flags = config.git.deploymentEnabled
  expect(flags['ci/customer-categories-postgres']).toBe(false)
  expect(flags['ci/ihr-leave-postgres']).toBe(false)
  expect(Object.entries(flags).filter(([, enabled]) => enabled)).toEqual([['fix/pilot-database', true]])
  expect(Object.keys(flags).some(rule => /[*?\[\]{}]/.test(rule))).toBe(false)
})
