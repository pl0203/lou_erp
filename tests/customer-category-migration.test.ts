// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync('supabase/migrations/202610020001_customer_categories.sql', 'utf8')
const runtime = () => readFileSync('tests/database/customer-categories.sql', 'utf8')
const values = ['supermarket_besar', 'supermarket_sedang', 'supermarket_kecil', 'tradisional_market', 'perorangan']
const statements = (sql: string) => sql.replace(/^\s*--.*$/gm, '')

describe('forward-only additive customer category migration', () => {
  it('adds exactly nullable text/default null and a validated named five-value CHECK', () => {
    const sql = migration()
    expect(sql).toContain('ADD COLUMN customer_category text DEFAULT NULL')
    expect(sql).toContain('ADD CONSTRAINT customers_customer_category_check CHECK')
    const check = sql.match(/ADD CONSTRAINT customers_customer_category_check CHECK\s*\(([\s\S]*?)\);/)![1]
    expect(check.match(/'[a-z_]+'/g)?.map(x => x.slice(1, -1))).toEqual(values)
    expect(check).toContain('customer_category IS NULL')
    expect(sql).not.toMatch(/\bNOT VALID\b|customer_category text NOT NULL/i)
  })
  it('bounds the transaction, refuses filtered snapshots, and locks before all preflight/snapshots/DDL', () => {
    const sql = migration()
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1)
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1)
    expect(sql).toContain("SET LOCAL lock_timeout='5s'")
    expect(sql).toContain("SET LOCAL statement_timeout='60s'")
    expect(sql).toContain("SET LOCAL idle_in_transaction_session_timeout='60s'")
    expect(sql).toContain('SET LOCAL row_security=off')
    const lock = sql.indexOf('LOCK TABLE public.customers IN ACCESS EXCLUSIVE MODE')
    expect(lock).toBeGreaterThan(0)
    expect(lock).toBeLessThan(sql.indexOf('DO $preflight$'))
    expect(lock).toBeLessThan(sql.indexOf('CREATE TEMP TABLE customer_categories_rows_before'))
    expect(sql.indexOf('CREATE TEMP TABLE customer_categories_rows_before')).toBeLessThan(sql.indexOf('ADD COLUMN'))
  })
  it('refuses a preexisting column, named constraint, or unexpected relation/column contract', () => {
    const sql = migration()
    expect(sql).toContain("attname='customer_category'")
    expect(sql).toContain("conname='customers_customer_category_check'")
    expect(sql).toContain("relkind='r'")
    expect(sql).toContain('relispartition')
    expect(sql).toContain('pg_inherits')
    expect(sql).toContain('Unexpected customer category schema; migration refused')
    expect(sql).toContain('Unexpected customers relation contract; migration refused')
    expect(sql).toContain('Unexpected customers column contract; migration refused')
    for (const field of ['id', 'name', 'address', 'city', 'phone', 'email', 'pricing_tier', 'visit_frequency_days', 'last_visit_date', 'created_at']) expect(sql).toContain(`"name":"${field}"`)
    expect(statements(sql)).not.toMatch(/\b(?:ADD COLUMN|ADD CONSTRAINT|CREATE TABLE)\s+IF NOT EXISTS\b/i)
  })
  it('compares exact old row/column/default/owner/ACL/RLS/policy metadata and new column ACL', () => {
    const sql = migration()
    for (const term of ['to_jsonb(c)', "-'customer_category'", 'EXCEPT', 'customer_categories_rows_before',
      'customer_categories_relation_before', 'customer_categories_columns_before', 'customer_categories_policies_before',
      'customer_categories_constraints_before', 'relowner', 'relacl', 'relrowsecurity', 'relforcerowsecurity', 'attacl',
      'pg_attrdef', 'pg_get_expr', 'pg_policy', 'convalidated', 'Customer rows changed',
      'Customer access metadata changed', 'Customer column metadata changed', 'Customer policies changed',
      'Customer constraints changed', 'attacl IS NULL', 'customer_category IS NOT NULL']) expect(sql).toContain(term)
  })
  it('does not rewrite customers, price tiers, grants, roles, policies, products or history', () => {
    const sql = statements(migration())
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|GRANT|REVOKE|ALTER TYPE|ALTER POLICY|CREATE POLICY|ALTER ROLE)\b/i)
    expect(sql).not.toMatch(/DROP\s+(?:COLUMN|CONSTRAINT|TABLE|TYPE)/i)
    expect(sql.match(/ALTER TABLE public\.customers/g)).toHaveLength(1)
    expect(sql).not.toMatch(/ALTER TABLE public\.(?!customers)/i)
  })
})

describe('guarded synthetic category SQL contract', () => {
  it('has one disposable-only rollback transaction and exact four distinct proof markers', () => {
    const sql = runtime()
    expect(sql).toContain("current_database()<>'pilot_test'")
    expect(sql).toContain("purpose='disposable-pilot-ci'")
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1)
    expect(sql.match(/^ROLLBACK;$/gm)).toHaveLength(1)
    expect(sql).not.toMatch(/^COMMIT;$/m)
    expect(sql.match(/CUSTOMER_CATEGORIES_[A-Z_]+/g)).toEqual([
      'CUSTOMER_CATEGORIES_VALUES_VERIFIED', 'CUSTOMER_CATEGORIES_ROLES_VERIFIED',
      'CUSTOMER_CATEGORIES_PRICING_HISTORY_VERIFIED', 'CUSTOMER_CATEGORIES_VERIFIED',
    ])
  })
  it('checks exact schema and accepts null/omission/all keys but rejects malformed values through the named CHECK', () => {
    const sql = runtime()
    for (const term of ['pg_attribute', 'pg_get_constraintdef', 'pg_get_expr', 'attnotnull', 'convalidated',
      "format_type(a.atttypid,a.atttypmod)='text'", 'GET STACKED DIAGNOSTICS', 'CONSTRAINT_NAME',
      "rejected_constraint<>'customers_customer_category_check'", 'old-client omission', 'check_violation',
      "'supermarket_besar '", "' supermarket_besar'", "'SUPERMARKET_BESAR'", "''"]) expect(sql).toContain(term)
    for (const value of values) expect(sql).toContain(`'${value}'`)
  })
  it('uses real authenticated editor roles and proves unassigned/anonymous/filtered read denial', () => {
    const sql = runtime()
    for (const term of ['SET LOCAL ROLE authenticated', 'SET LOCAL ROLE anon', 'row_security_active',
      "'po_admin'", "'sales_person'", "'sales_manager'", "'sales_head'", "'executive'",
      'unassigned manager', 'anonymous', 'SET LOCAL row_security=off', 'insufficient_privilege',
      'GET DIAGNOSTICS changed=ROW_COUNT']) expect(sql).toContain(term)
    expect(sql).not.toMatch(/session_replication_role|DISABLE ROW LEVEL SECURITY|ALTER ROLE[^;]*BYPASSRLS|ALTER POLICY|GRANT /i)
  })
  it('compares full original customer fields, pricing, catalog, promotions, historical lines, deliveries, request state and access metadata', () => {
    const sql = runtime()
    for (const table of ['customers', 'products', 'promotions', 'purchase_orders', 'po_line_items', 'surat_jalan',
      'sj_line_items', 'po_audit_log', 'users', 'customer_manager_assignments', 'customer_sales_rep_assignments',
      'pilot_order_requests']) expect(sql).toContain(`.${table}`)
    for (const term of ["-'customer_category'", 'pg_roles', 'pg_policy', 'attacl', 'relacl', 'relowner',
      'pricing_tier', 'harga_pokok', 'luar_kota', 'dalam_kota', 'depo_bangunan', 'unit_price',
      'po_line_item_id', 'quantity_delivered', 'total_value', 'IS DISTINCT FROM baseline']) expect(sql).toContain(term)
  })
})

describe('exact migration disposable guard packet', () => {
  it('wraps the actual migration and preflight in guarded rollbacks without executing a connection', async () => {
    const { buildCustomerCategoryMigrationGuards } = await import('./customer-category-migration-guards.mjs')
    const source = migration()
    const packet = buildCustomerCategoryMigrationGuards(source)
    expect(packet.match(/^BEGIN;$/gm)).toHaveLength(7)
    expect(packet.match(/^ROLLBACK;$/gm)).toHaveLength(7)
    expect(packet).not.toMatch(/^COMMIT;$/m)
    expect(packet.match(/CUSTOMER_CATEGORY_MIGRATION_DRIFT_REJECTED_\d/g)).toHaveLength(6)
    const preflight = source.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/)![0]
    expect(packet.split(preflight)).toHaveLength(8)
    expect(packet).toContain(source.replace(/^BEGIN;\n/m, '').replace(/\nCOMMIT;\s*$/, ''))
    expect(packet.indexOf('Synthetic pre-migration category customer')).toBeLessThan(packet.indexOf('ADD COLUMN customer_category text DEFAULT NULL,'))
    expect(packet).toContain('CUSTOMER_CATEGORY_MIGRATION_EXISTING_ROWS_VERIFIED')
    expect(packet).toContain("current_database()<>'pilot_test'")
    expect(() => buildCustomerCategoryMigrationGuards(source + '\nCOMMIT;')).toThrow()
    expect(() => buildCustomerCategoryMigrationGuards(source.replace('END $preflight$;', 'END $changed$;'))).toThrow()
  })
})

describe('rollback-only migration input boundary', () => {
  it.each([
    ' COMMIT;', 'commit;', 'COMMIT ;', '\tCoMmIt\n;', 'COMMIT /* inline */ ;',
    'END;', 'end work;', 'ABORT;', 'abort transaction;', 'ROLLBACK;', 'ROLLBACK AND CHAIN;',
    "PREPARE TRANSACTION 'synthetic';", "COMMIT PREPARED 'synthetic';", "ROLLBACK PREPARED 'synthetic';",
    'START TRANSACTION;', 'start /* comment */ transaction;', 'BEGIN WORK;', 'BEGIN TRANSACTION;',
    'SAVEPOINT synthetic;', 'RELEASE SAVEPOINT synthetic;', 'ROLLBACK TO SAVEPOINT synthetic;',
    'SET TRANSACTION READ WRITE;', "SELECT 'COMMIT;';", 'DO $$ BEGIN COMMIT; END $$;',
    '-- comment ending in carriage return\rcommit ;',
  ])('rejects an extra top-level transaction/control or unsupported statement: %s', async command => {
    const { buildCustomerCategoryMigrationGuards } = await import('./customer-category-migration-guards.mjs')
    expect(() => buildCustomerCategoryMigrationGuards(migration().replace('ALTER TABLE public.customers', `${command}\nALTER TABLE public.customers`))).toThrow()
  })
  it.each(['COMMIT;', 'commit ;', 'END;', 'ABORT;', 'START TRANSACTION;'])('rejects same-line escapes after the outer BEGIN: %s', async command => {
    const { buildCustomerCategoryMigrationGuards } = await import('./customer-category-migration-guards.mjs')
    expect(() => buildCustomerCategoryMigrationGuards(migration().replace('BEGIN;\n', `BEGIN; ${command}\n`))).toThrow()
  })
  it.each(['\\gexec', '\\i synthetic.sql', '\\include synthetic.sql', '\\! echo unsafe', '\\copy customers TO stdout', '\\connect other', '\\quit'])('rejects psql execution paths: %s', async command => {
    const { buildCustomerCategoryMigrationGuards } = await import('./customer-category-migration-guards.mjs')
    expect(() => buildCustomerCategoryMigrationGuards(migration().replace('ALTER TABLE public.customers', `${command}\nALTER TABLE public.customers`))).toThrow()
  })
  it.each(["'unterminated", '"unterminated', '/* unterminated', '$unsupported$COMMIT;$unsupported$;', '-- quoted\nSELECT 1;'])('refuses unsupported or ambiguous lexical input: %s', async text => {
    const { buildCustomerCategoryMigrationGuards } = await import('./customer-category-migration-guards.mjs')
    expect(() => buildCustomerCategoryMigrationGuards(migration().replace('ALTER TABLE public.customers', `${text}\nALTER TABLE public.customers`))).toThrow()
  })
  it.each([':synthetic', ":'synthetic'", ':"synthetic"'])('rejects psql variable interpolation in a supported statement: %s', async variable => {
    const { buildCustomerCategoryMigrationGuards } = await import('./customer-category-migration-guards.mjs')
    expect(() => buildCustomerCategoryMigrationGuards(migration().replace("SET LOCAL search_path='';", `SET LOCAL search_path=${variable};`))).toThrow()
  })
  it('ignores transaction words in supported comments and preserves the exact quoted/dollar-block source', async () => {
    const { buildCustomerCategoryMigrationGuards } = await import('./customer-category-migration-guards.mjs')
    const comment = "-- COMMIT; 'END;' $unknown$\n/* START TRANSACTION; /* nested COMMIT; */ END; */\n"
    const source = migration().replace('ALTER TABLE public.customers', `${comment}ALTER TABLE public.customers`)
    const packet = buildCustomerCategoryMigrationGuards(source)
    expect(packet).toContain(comment)
    expect(packet).toContain(source.replace(/^BEGIN;\n/m, '').replace(/\nCOMMIT;\s*$/, ''))
    expect(packet.match(/^BEGIN;$/gm)).toHaveLength(7)
    expect(packet.match(/^ROLLBACK;$/gm)).toHaveLength(7)
    expect(packet.match(/CUSTOMER_CATEGORY_MIGRATION_DRIFT_REJECTED_\d/g)).toHaveLength(6)
    expect(packet).toContain("'Customer rows changed; migration refused'")
    expect(packet).toContain('DO $preflight$')
    expect(packet).toContain('DO $postflight$')
  })
})
