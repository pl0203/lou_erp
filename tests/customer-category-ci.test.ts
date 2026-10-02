// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { buildCustomerCategoryMigrationGuards } from './customer-category-migration-guards.mjs'
import * as ci from '../scripts/customer-category-ci.mjs'
const workflow = readFileSync('.github/workflows/pilot-safety.yml', 'utf8')
const guards = ['CUSTOMER_CATEGORY_MIGRATION_EXISTING_ROWS_VERIFIED', ...Array.from({length:6}, (_,i)=>`CUSTOMER_CATEGORY_MIGRATION_DRIFT_REJECTED_${i+1}`)]
const invariants = ['CUSTOMER_CATEGORIES_VALUES_VERIFIED','CUSTOMER_CATEGORIES_ROLES_VERIFIED','CUSTOMER_CATEGORIES_PRICING_HISTORY_VERIFIED','CUSTOMER_CATEGORIES_VERIFIED']
test('requires exactly the seven reviewed guard markers and four invariant markers', () => {
 expect(ci.CATEGORY_GUARD_MARKERS).toEqual(guards); expect(ci.CATEGORY_INVARIANT_MARKERS).toEqual(invariants)
 expect(ci.assertCategorySqlMarkers(guards.map(m=>`psql:guard.sql:9: NOTICE:  ${m}`).join('\n'), guards)).toEqual(guards)
 expect(ci.assertCategorySqlMarkers(invariants.join('\n'), invariants)).toEqual(invariants)
})
test('requires the unchanged reviewed guard packet built from exact category migration bytes', () => {
 const packet=buildCustomerCategoryMigrationGuards(readFileSync('supabase/migrations/202610020001_customer_categories.sql','utf8'))
 expect(createHash('sha256').update(packet).digest('hex')).toBe('84ed556060b727f2f11faeb455f4455fb339e8d29d34ca0352bdd4c212e88581')
})
test.each([
 invariants.slice(1).join('\n'), [...invariants,invariants[0]].join('\n'),
 [...invariants,'ERROR: failure'].join('\n'), [...invariants,'psql:input.sql:5: ERROR:  42501: permission denied'].join('\n'),
 [...invariants,'FATAL: connection failed'].join('\n'), [...invariants,'psql: error: connection refused'].join('\n'), [...invariants,'PANIC: failed'].join('\n'),
 invariants.map(m=>`DETAIL: ${m}`).join('\n'), invariants.map(m=>`${m}_WRONG`).join('\n'),
 [...invariants,'CUSTOMER_CATEGORIES_UNKNOWN'].join('\n'),
])('refuses incomplete, duplicate, error-tainted or spoofed SQL evidence', output => {
 expect(()=>ci.assertCategorySqlMarkers(output,invariants)).toThrow()
})
test('runs exact category guard immediately before category and all four invariants with pipefail and marker checks', () => {
 const boundary=workflow.indexOf('if [[ "$file" == supabase/migrations/202610020001_customer_categories.sql ]]')
 expect(boundary).toBeGreaterThan(0)
 const block=workflow.slice(boundary,workflow.indexOf('            psql -X -v ON_ERROR_STOP=1 -f "$file"',boundary))
 expect(block).toContain('node scripts/customer-category-ci.mjs build-guards')
 expect(block).toContain('psql -X -qAt -v ON_ERROR_STOP=1 -f scale-results/customer-category-guards.sql 2>&1 | tee scale-results/customer-category-guards.log')
 expect(block).toContain('node scripts/customer-category-ci.mjs verify-guards')
 expect(workflow).toContain('psql -X -qAt -v ON_ERROR_STOP=1 -f tests/database/customer-categories.sql 2>&1 | tee scale-results/customer-category-invariants.log')
 expect(workflow).toContain('node scripts/customer-category-ci.mjs verify-invariants')
 for(const name of ['Load only synthetic test contract and candidate migrations','SQL invariants, real role permissions and Storage metadata policies']) {
  expect(workflow.slice(workflow.indexOf(`      - name: ${name}`)).match(/        run: \|\n          set -euo pipefail/)).not.toBeNull()
 }
})
