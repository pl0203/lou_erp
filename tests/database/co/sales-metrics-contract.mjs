// Shared verifier used by the mandatory actual-SQL bridge and TS guard tests.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const required = ['manager-self','team-inactive-credit','retained-zero-own-hidden','retained-zero-leadership','po-september','po-august','po-october','po-november','po-distinct-range','po-void','po-cancel','po-draft-evidence','months-po','boundary-UTC','boundary-Pacific/Kiritimati','boundary-America/Los_Angeles','co-mixed-customer','co-mixed-person','co-own-a','co-team','co-peer-hidden','co-narrowed-own','co-range-distinct','co-corrected','co-closed','co-inactive-credit','po-inactive-credit','months-historical','co-new-owner-hidden','zero-own','zero-person','zero-other','months-zero','free-sale','unassigned','unassigned-filtered','months-empty','exhausted-hidden','returned-zero','partial-cutoff','months-partial-hidden','draft-no-sales','months-draft-hidden','huge','page-first','page-last','page-empty','head-audience']
export function validateSalesMetricsSqlOutput(input, decode) {
  assert.equal(input.split('\n').filter(x => x === 'CO_SALES_METRICS_PASSED').length, 1, 'Exactly one real SQL success marker required')
  const lines = input.split('\n').filter(x => x.startsWith('CO_SALES_METRICS_CONTRACT|'))
  assert.ok(lines.length >= required.length, 'Complete actual SQL contract evidence required')
  const seen = new Set()
  for (const line of lines) {
    const { label, name, args, data, expected } = JSON.parse(line.slice('CO_SALES_METRICS_CONTRACT|'.length))
    assert.ok(typeof label === 'string' && !seen.has(label), 'Unique SQL scenario labels required'); seen.add(label)
    assert.ok(['pilot_sales_metrics_v2', 'pilot_sales_metric_months_v2'].includes(name))
    assert.ok(args && data && expected)
    assert.deepEqual(decode(name, args, data), data, `${label}: production decoder`)
    for (const [path, value] of Object.entries(expected)) assert.deepEqual(path.split('.').reduce((o,k) => o[k], data), value, `${label}:${path}`)
    const reject = changed => assert.throws(() => decode(name, args, changed), `${label}: malformed SQL response accepted`)
    reject({ ...data, version: 1 }); reject({ ...data, co_id: 'forbidden' })
    if (name === 'pilot_sales_metrics_v2') {
      reject({ ...data, summary: { ...data.summary, report_revision_id: 'forbidden' } })
      if (data.items.length) {
        reject({ ...data, items: data.items.slice(1) })
        reject({ ...data, items: [{ ...data.items[0], batch_id: 'forbidden' }, ...data.items.slice(1)] })
      }
      if (data.page === 1 && data.total === String(data.items.length)) {
        const [whole, minor] = data.summary.po_order_value.split('.')
        const cents = BigInt(whole + minor) + 1n
        reject({ ...data, summary: { ...data.summary, po_order_value: `${cents / 100n}.${String(cents % 100n).padStart(2,'0')}` } })
      }
    }
  }
  for (const label of required) assert.ok(seen.has(label), `Missing actual SQL scenario: ${label}`)
  return { fixtures: lines.length, sha256: createHash('sha256').update(lines.join('\n')).digest('hex') }
}
