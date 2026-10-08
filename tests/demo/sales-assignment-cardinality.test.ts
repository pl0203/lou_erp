// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const path = 'supabase/migrations/202610081104_demo_sales_assignment_cardinality.sql'
const source = () => {
  expect(existsSync(path), 'approved assignment-cardinality migration is present').toBe(true)
  return readFileSync(path, 'utf8')
}

test('drops only the verified salesperson uniqueness constraint under bounded locks', () => {
  const sql = source()
  expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1)
  expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1)
  expect(sql).toContain("SET LOCAL lock_timeout='5s'")
  expect(sql).toContain("SET LOCAL statement_timeout='60s'")
  expect(sql).toContain('LOCK TABLE public.customer_sales_rep_assignments IN ACCESS EXCLUSIVE MODE')
  expect(sql.match(/ALTER TABLE public\.customer_sales_rep_assignments\s+DROP CONSTRAINT customer_sales_rep_assignments_sales_rep_id_key/g)).toHaveLength(1)
  expect(sql).not.toMatch(/\bCASCADE\s*;/i)
  expect(sql).not.toMatch(/\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|GRANT|REVOKE|CREATE POLICY|DROP POLICY|ALTER POLICY|CREATE FUNCTION|CREATE INDEX)\b/i)
  expect(sql).not.toContain('ALTER TABLE public.purchase_orders')
})

test('pins plain unique indexes and validates dependency and preservation contracts', () => {
  const sql = source()
  for (const text of [
    'customer_sales_rep_assignments_customer_id_key',
    'customer_sales_rep_assignments_pkey',
    'UNIQUE (sales_rep_id)', 'UNIQUE (customer_id)', 'PRIMARY KEY (id)',
    'pg_catalog.pg_depend', 'pg_catalog.pg_index', 'indpred', 'indexprs',
    'convalidated', 'condeferrable', 'confrelid',
    'sales_assignment_rows_before', 'sales_assignment_relation_before',
    'sales_assignment_columns_before', 'sales_assignment_policies_before',
    'sales_assignment_constraints_before', 'sales_assignment_indexes_before',
    'sales_assignment_triggers_before', 'sales_assignment_dependencies_before',
    'Assignment rows changed; migration refused',
    'Assignment metadata changed; migration refused',
    'Unexpected assignment dependencies; migration refused',
    'Unexpected assignment uniqueness; migration refused',
  ]) expect(sql).toContain(text)
  expect(sql).toContain('SET LOCAL row_security=off')
  expect(sql).toContain('EXCEPT')
})
