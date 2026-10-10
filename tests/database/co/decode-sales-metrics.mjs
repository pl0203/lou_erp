// Mandatory actual authenticated SQL output through the production TypeScript decoder.
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { validateSalesMetricsSqlOutput } from './sales-metrics-contract.mjs'
const source = readFileSync(new URL('../../../src/lib/reads/salesMetrics.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
const { decodeSalesMetrics, decodeSalesMetricMonths } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const evidence = validateSalesMetricsSqlOutput(readFileSync(0, 'utf8'), (name, args, data) => name === 'pilot_sales_metrics_v2' ? decodeSalesMetrics(args, data) : decodeSalesMetricMonths(args, data))
process.stdout.write(`CO_SALES_METRICS_CONTRACT fixtures=${evidence.fixtures} sha256=${evidence.sha256}\nCO_SALES_METRICS_DECODERS_PASSED\n`)
