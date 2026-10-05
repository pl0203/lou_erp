import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync('vercel.json', 'utf8'))

describe('isolated PO import candidate deployment config', () => {
  it('routes candidate fallback paths to its own entry', () => {
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/candidate.html' }])
  })
  it('builds deterministic assets and writes the candidate-only output', () => {
    expect(config.buildCommand).toBe('node scripts/copy-po-reader-assets.mjs && node qa/po-import/build.mjs')
    expect(config.outputDirectory).toBe('dist-po-import-qa')
  })
  it('enables only the named additional QA branch while preserving prior flags', () => {
    expect(config.git.deploymentEnabled).toEqual({
      'fix/pilot-database': true,
      'fix/pilot-scale-sql': false,
      'ci/customer-categories-postgres': false,
      'ci/ihr-leave-postgres': false,
      'qa/po-document-import-20261005': true,
    })
  })
  it('does not configure aliases, domains or environments', () => {
    expect(Object.keys(config).sort()).toEqual(['$schema', 'buildCommand', 'git', 'outputDirectory', 'rewrites'])
    expect(Object.keys(config.git)).toEqual(['deploymentEnabled'])
    expect(config.alias).toBeUndefined()
    expect(config.domains).toBeUndefined()
    expect(config.env).toBeUndefined()
  })
})
