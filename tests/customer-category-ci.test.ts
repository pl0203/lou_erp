// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { buildCustomerCategoryMigrationGuards } from './customer-category-migration-guards.mjs'
import * as ci from '../scripts/customer-category-ci.mjs'
import { CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS } from '../scripts/customer-category-preapply.mjs'
const workflow = readFileSync('.github/workflows/pilot-safety.yml', 'utf8')
const guards = ['CUSTOMER_CATEGORY_MIGRATION_EXISTING_ROWS_VERIFIED', ...Array.from({length:7}, (_,i)=>`CUSTOMER_CATEGORY_MIGRATION_DRIFT_REJECTED_${i+1}`)]
const invariants = ['CUSTOMER_CATEGORIES_VALUES_VERIFIED','CUSTOMER_CATEGORIES_ROLES_VERIFIED','CUSTOMER_CATEGORIES_PRICING_HISTORY_VERIFIED','CUSTOMER_CATEGORIES_VERIFIED']
const preapply = (index=1) => {
 const {name,...contract}=structuredClone(CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS[index])
 return {current_user:'postgres',category_attribute_present:false,category_constraint_present:false,has_dropped_attributes:false,...contract}
}
test('requires exactly the eight reviewed guard markers and four invariant markers', () => {
 expect(ci.CATEGORY_GUARD_MARKERS).toEqual(guards); expect(ci.CATEGORY_INVARIANT_MARKERS).toEqual(invariants)
 expect(ci.assertCategorySqlMarkers(guards.map(m=>`psql:guard.sql:9: NOTICE:  ${m}`).join('\n'), guards)).toEqual(guards)
 expect(()=>ci.assertCategorySqlMarkers(guards.slice(0,-1).join('\n'),guards)).toThrow('Exact')
 expect(ci.assertCategorySqlMarkers(invariants.join('\n'), invariants)).toEqual(invariants)
})
test('requires the reviewed guard packet built from the exact corrected category migration bytes', () => {
 const packet=buildCustomerCategoryMigrationGuards(readFileSync('supabase/migrations/202610020001_customer_categories.sql','utf8'))
 expect(createHash('sha256').update(packet).digest('hex')).toBe('37536ea21daea93dfb81aebfb1aa939c50f5fd7bfc60b1961288d41c0ba3c288')
})
test('requires complete single metadata JSON and its explicitly selected known layout', () => {
 const evidence=JSON.stringify(preapply())
 expect(ci.assertCategoryPreapplyEvidence(evidence,'known-legacy-v1').accepted).toBe(true)
 expect(()=>ci.assertCategoryPreapplyEvidence(evidence,'canonical-fixture-v1')).toThrow('refused')
 expect(()=>ci.assertCategoryPreapplyEvidence(evidence,'anything')).toThrow('Explicit')
 for(const output of ['',evidence.slice(0,-1),`${evidence}\n${evidence}`,`ERROR: failed\n${evidence}`,`NOTICE: spoofed\n${evidence}`,'null'])expect(()=>ci.assertCategoryPreapplyEvidence(output,'known-legacy-v1')).toThrow()
 const missing=preapply() as any;delete missing.relation.partition
 expect(()=>ci.assertCategoryPreapplyEvidence(JSON.stringify(missing),'known-legacy-v1')).toThrow('refused')
})
test.each([0,1].flatMap(index=>['default','acl'].flatMap(field=>['1e400','-1e400'].map(number=>({index,field,number})))))
('CLI evidence parser refuses JSON numeric overflow in required-null $field for layout $index ($number)', ({index,field,number}) => {
 const raw=JSON.stringify(preapply(index)).replace(`"${field}":null`,`"${field}":${number}`)
 expect(JSON.parse(raw).columns[field==='default'?1:0][field]).toBe(number==='1e400'?Infinity:-Infinity)
 expect(()=>ci.assertCategoryPreapplyEvidence(raw,CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS[index].name)).toThrow('refused')
})
test('requires every reviewed legacy marker exactly once and refuses spoofing or SQL errors', () => {
 expect(ci.LEGACY_CATEGORY_MARKERS).toHaveLength(21)
 expect(ci.assertCategorySqlMarkers(ci.LEGACY_CATEGORY_MARKERS.map(m=>`psql:legacy.sql:9: NOTICE:  ${m}`).join('\n'),ci.LEGACY_CATEGORY_MARKERS)).toEqual(ci.LEGACY_CATEGORY_MARKERS)
 for(const output of [
  ci.LEGACY_CATEGORY_MARKERS.slice(1).join('\n'),
  [...ci.LEGACY_CATEGORY_MARKERS,ci.LEGACY_CATEGORY_MARKERS[0]].join('\n'),
  [...ci.LEGACY_CATEGORY_MARKERS,'CUSTOMER_CATEGORY_LEGACY_UNKNOWN'].join('\n'),
  [...ci.LEGACY_CATEGORY_MARKERS,'psql:legacy.sql:9: ERROR: refused'].join('\n'),
  ci.LEGACY_CATEGORY_MARKERS.map(m=>`DETAIL: ${m}`).join('\n'),
 ])expect(()=>ci.assertCategorySqlMarkers(output,ci.LEGACY_CATEGORY_MARKERS)).toThrow()
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
 const order=[
  'node scripts/customer-category-ci.mjs build-preapply',
  'node scripts/customer-category-ci.mjs verify-preapply-canonical',
  "CREATE DATABASE pilot_category_legacy_test;",
  '-d pilot_category_legacy_test -f tests/database/customer-category-legacy-fixture.sql',
  'node scripts/customer-category-ci.mjs verify-preapply-legacy',
  'node scripts/customer-category-ci.mjs build-legacy-guards',
  '-d pilot_category_legacy_test -f scale-results/customer-category-legacy-guards.sql',
  'node scripts/customer-category-ci.mjs verify-legacy-guards',
  'node scripts/customer-category-ci.mjs build-guards',
  'node scripts/customer-category-ci.mjs verify-guards',
 ]
 expect(order.map(text=>block.indexOf(text))).toEqual([...order.map(text=>block.indexOf(text))].sort((a,b)=>a-b))
 for(const text of order)expect(block.indexOf(text)).toBeGreaterThanOrEqual(0)
 expect(block).toContain('psql -X -qAt -v ON_ERROR_STOP=1 -f scale-results/customer-category-preapply.sql 2>&1 | tee scale-results/customer-category-preapply-canonical.log')
 expect(block).toContain('psql -X -qAt -v ON_ERROR_STOP=1 -d pilot_category_legacy_test -f scale-results/customer-category-preapply.sql 2>&1 | tee scale-results/customer-category-preapply-legacy.log')
 expect(block).toContain('psql -X -qAt -v ON_ERROR_STOP=1 -d pilot_category_legacy_test -f scale-results/customer-category-legacy-guards.sql 2>&1 | tee scale-results/customer-category-legacy-guards.log')
 expect(workflow).toContain('psql -X -qAt -v ON_ERROR_STOP=1 -f tests/database/customer-categories.sql 2>&1 | tee scale-results/customer-category-invariants.log')
 expect(workflow).toContain('node scripts/customer-category-ci.mjs verify-invariants')
 for(const name of ['Load only synthetic test contract and candidate migrations','SQL invariants, real role permissions and Storage metadata policies']) {
  expect(workflow.slice(workflow.indexOf(`      - name: ${name}`)).match(/        run: \|\n          set -euo pipefail/)).not.toBeNull()
 }
})
