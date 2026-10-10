// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import { evaluateCustomerCategoryPreapply } from '../scripts/customer-category-preapply.mjs'
import { assertCategoryPreapplyEvidence, CATEGORY_GUARD_MARKERS } from '../scripts/customer-category-ci.mjs'
import { buildCustomerCategoryMigrationGuards } from './customer-category-migration-guards.mjs'

// Independent catalog-only capture from disposable fictional CI after pilot_security.
// No customer rows, hosted target, actor identity or job-log content is included.
const capturedBytes = readFileSync('tests/fixtures/customer-category-canonical-post-security-metadata.json', 'utf8')
const captured = () => JSON.parse(capturedBytes)
const migration = () => readFileSync('supabase/migrations/202610020001_customer_categories.sql', 'utf8')
const relationError = 'Unexpected customers relation contract; migration refused'
const canonicalAcl = ['authenticated=arw/postgres', 'postgres=arwdDxtm/postgres', 'service_role=arwdDxtm/postgres']

test('accepts the independently captured canonical catalog after customer DELETE revocation', () => {
  expect(createHash('sha256').update(capturedBytes).digest('hex')).toBe('b05189fb0bea2fd58ed92ecc2b6bc3a99ffd3833d0ea472f5a7705854cc621c8')
  const input = captured(), original = structuredClone(input)
  expect(input.relation.acl).toEqual(canonicalAcl)
  expect(evaluateCustomerCategoryPreapply(input)).toEqual({ accepted: true, complete: true, layout: 'canonical-fixture-v1', reason: null })
  expect(input).toEqual(original)
})

test('CI evidence parser accepts the independently captured post-security canonical catalog', () => {
  expect(assertCategoryPreapplyEvidence(JSON.stringify(captured()), 'canonical-fixture-v1')).toEqual({ accepted: true, complete: true, layout: 'canonical-fixture-v1', reason: null })
})

test('evaluator refuses reintroduced canonical customer DELETE', () => {
  const input = captured()
  input.relation.acl[0] = 'authenticated=arwd/postgres'
  expect(evaluateCustomerCategoryPreapply(input)).toEqual({ accepted: false, complete: true, layout: null, reason: relationError })
})

test('CI evidence parser refuses reintroduced canonical customer DELETE', () => {
  const input = captured()
  input.relation.acl[0] = 'authenticated=arwd/postgres'
  expect(() => assertCategoryPreapplyEvidence(JSON.stringify(input), 'canonical-fixture-v1')).toThrow('refused')
})

test('exact migration preflight pins the independently observed canonical ACL and strict relation comparison', () => {
  const source = migration()
  const contracts = JSON.parse(source.match(/jsonb_array_elements\('((?:[^']|'')*)'::jsonb\)/)![1].replaceAll("''", "'"))
  expect(contracts.find((contract: any) => contract.name === 'canonical-fixture-v1').relation.acl).toEqual(captured().relation.acl)
  expect(source).toContain("IF actual->'relation' IS DISTINCT FROM expected->'relation'")
  expect(source).toContain(`THEN RAISE EXCEPTION '${relationError}'; END IF;`)
})

test('canonical guard schedules a rollback-only DELETE regrant rejection through the exact migration preflight', () => {
  const source = migration(), packet = buildCustomerCategoryMigrationGuards(source)
  const preflight = source.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/)![0]
  const regrant = packet.indexOf('GRANT DELETE ON TABLE public.customers TO authenticated;')
  expect(regrant).toBeGreaterThan(0)
  const rejection = packet.slice(regrant, packet.indexOf('ROLLBACK;', regrant))
  expect(rejection).toContain(`EXECUTE $category_guard_source$${preflight}$category_guard_source$;`)
  expect(rejection).toContain(`IF SQLERRM<>'${relationError}' THEN RAISE; END IF;`)
  expect(rejection).toContain("RAISE NOTICE 'CUSTOMER_CATEGORY_MIGRATION_DRIFT_REJECTED_7';")
  expect(CATEGORY_GUARD_MARKERS).toContain('CUSTOMER_CATEGORY_MIGRATION_DRIFT_REJECTED_7')
  expect(packet.match(/^BEGIN;$/gm)).toHaveLength(8)
  expect(packet.match(/^ROLLBACK;$/gm)).toHaveLength(8)
  expect(packet).not.toMatch(/^COMMIT;$/m)
})

test('canonical CI preapply and guard run after the earlier pilot security customer DELETE revocation', () => {
  const security = '202609300001_pilot_security.sql', category = '202610020001_customer_categories.sql'
  const migrations = readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()
  const phaseBoundary = '202610010001_scalable_order_reads.sql'
  expect(migrations.indexOf(security)).toBeGreaterThanOrEqual(0)
  expect(migrations.indexOf(security)).toBeLessThan(migrations.indexOf(category))
  expect(security < phaseBoundary && phaseBoundary < category).toBe(true)
  expect(readFileSync('tests/database/fixture.sql', 'utf8')).toContain("EXECUTE format('GRANT ALL ON public.%I TO anon,authenticated,service_role',t);")
  expect(readFileSync(`supabase/migrations/${security}`, 'utf8')).toContain('REVOKE DELETE ON public.users,public.customers,public.outlets FROM authenticated;')
  const workflow = readFileSync('.github/workflows/pilot-safety.yml', 'utf8')
  const earlierPhase = `if [[ "$file" < supabase/migrations/${phaseBoundary} ]]; then psql -X -v ON_ERROR_STOP=1 -f "$file"; fi`
  const laterPhase = `if [[ "$file" < supabase/migrations/${phaseBoundary} ]]; then continue; fi`
  const categoryGate = `if [[ "$file" == supabase/migrations/${category} ]]`
  expect(workflow.indexOf(earlierPhase)).toBeGreaterThan(0)
  expect(workflow.indexOf(earlierPhase)).toBeLessThan(workflow.indexOf(laterPhase))
  expect(workflow.indexOf(laterPhase)).toBeLessThan(workflow.indexOf(categoryGate))
  const categoryBlock = workflow.slice(workflow.indexOf(categoryGate), workflow.indexOf('            psql -X -v ON_ERROR_STOP=1 -f "$file"', workflow.indexOf(categoryGate)))
  expect(categoryBlock.indexOf('verify-preapply-canonical')).toBeGreaterThan(0)
  expect(categoryBlock.indexOf('verify-preapply-canonical')).toBeLessThan(categoryBlock.indexOf('build-guards'))
  expect(categoryBlock.indexOf('build-guards')).toBeLessThan(categoryBlock.indexOf('verify-guards'))
  expect(captured().relation.acl).toEqual(canonicalAcl)
})
