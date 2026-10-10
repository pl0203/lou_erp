// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { validateSalesMetricsSqlOutput } from '../database/co/sales-metrics-contract.mjs'
import { decodeSalesMetrics, decodeSalesMetricMonths } from '../../src/lib/reads/salesMetrics'

// The guarded runner feeds actual authenticated SQL stdout to this same verifier.
// No environment-bound test or skip path can stand in for its mandatory execution.
test('SQL bridge refuses missing, canned-incomplete or duplicated evidence', () => {
  const decode = (name: string, args: any, data: any) => name === 'pilot_sales_metrics_v2' ? decodeSalesMetrics(args, data) : decodeSalesMetricMonths(args, data)
  expect(() => validateSalesMetricsSqlOutput('', decode)).toThrow()
  expect(() => validateSalesMetricsSqlOutput('CO_SALES_METRICS_PASSED\n', decode)).toThrow()
  expect(() => validateSalesMetricsSqlOutput('CO_SALES_METRICS_CONTRACT|{}\nCO_SALES_METRICS_PASSED\n', decode)).toThrow()
})
test('stage06 mandates exact SQL output through the production TS decoder', () => {
  const runner = readFileSync('scripts/test-co-ci.mjs', 'utf8')
  expect(runner).toContain("'06': ['supabase/migrations/20261009110006_co_reporting.sql', 'tests/database/co/sales-metrics.sql']")
  expect(runner).toContain('tests/database/co/decode-sales-metrics.mjs')
  expect(runner).toContain('CO_SALES_METRICS_DECODERS_PASSED')
  const bridge = readFileSync('tests/database/co/decode-sales-metrics.mjs', 'utf8')
  expect(bridge).toContain('src/lib/reads/salesMetrics.ts')
  expect(bridge).toContain("readFileSync(0, 'utf8')")
  expect(bridge).not.toMatch(/skip|process\.env/)
})
