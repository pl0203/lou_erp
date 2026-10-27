// Mandatory actual-SQL-output bridge. No database access, substitution or skip switch.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const source = readFileSync(new URL('../../../src/lib/co/validation.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText
const { decodeCORead } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const input = readFileSync(0, 'utf8')
const lines = input.split('\n').filter(line => line.startsWith('CO_READ_FIXTURE|'))
assert.ok(lines.length >= 30, 'Actual SQL decoder fixtures required; no skipping')
const names = new Set()
let nonemptyReturnLines = false
for (const [index, line] of lines.entries()) {
  const fixture = JSON.parse(line.slice('CO_READ_FIXTURE|'.length))
  const { name, args, data, expected } = fixture
  assert.ok(name && args && data && expected)
  names.add(name)
  try {
    assert.deepEqual(decodeCORead(name, args, data), data)
  } catch (error) {
    throw new Error(`Actual SQL ${name} fixture ${index + 1}: ${error.message}`)
  }
  for (const [path, value] of Object.entries(expected)) {
    assert.deepEqual(path.split('.').reduce((v, key) => v[key], data), value, `${name}:${path}`)
  }
  const rejects = changed => assert.throws(() => decodeCORead(name, args, changed), `${name} rejected malformed binding`)
  rejects({ ...data, version: 1 })
  if (data.rows?.length) rejects({ ...data, rows: data.rows.slice(1) })
  if (name === 'pilot_co_detail_section_v1' && data.section === 'sj_draft_lines') {
    rejects({ ...data, draft_version: undefined })
    rejects({ ...data, draft_id: undefined })
  }
  if (name === 'pilot_co_preview_v1') {
    rejects({ ...data, customer_version: String(BigInt(data.customer_version) + 1n) })
    if (args.p_payload.expected_draft_version) rejects({ ...data, draft_version: null })
  }
  if (name === 'pilot_co_customer_stock_v1' && data.total === String(data.rows.length)) {
    rejects({ ...data, summary: { ...data.summary,
      opening_quantity: String(BigInt(data.summary.opening_quantity) + 1n),
      recorded_quantity: String(BigInt(data.summary.recorded_quantity) + 1n),
    } })
  }
  if (name === 'pilot_co_detail_section_v1' && data.section === 'return_lines' && data.rows.length) {
    nonemptyReturnLines = true
  }
}
for (const name of [
  'pilot_co_page_v1', 'pilot_co_detail_v1', 'pilot_co_detail_section_v1',
  'pilot_co_reports_page_v1', 'pilot_co_report_months_v1', 'pilot_co_report_v1',
  'pilot_co_report_rows_v1', 'pilot_co_report_allocations_v1', 'pilot_co_customer_stock_v1',
  'pilot_co_stock_movements_v1', 'pilot_co_customer_batches_v1', 'pilot_co_preview_v1',
  'pilot_co_preview_impacts_v1', 'pilot_co_preview_allocations_v1', 'pilot_co_return_v1',
]) assert.ok(names.has(name), `Missing actual ${name}`)
assert.ok(nonemptyReturnLines, 'Nonempty CO-scoped return_lines fixture required')
process.stdout.write(`CO_SQL_DECODER_EVIDENCE fixtures=${lines.length} surfaces=${names.size} sha256=${createHash('sha256').update(lines.join('\n')).digest('hex')}\nCO_SQL_DECODERS_PASSED\n`)
