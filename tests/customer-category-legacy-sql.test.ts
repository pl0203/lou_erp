// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = () => readFileSync('supabase/migrations/202610020001_customer_categories.sql', 'utf8')
const fixturePath = 'tests/database/customer-category-legacy-fixture.sql'
const builderPath = 'tests/customer-category-legacy-guards.mjs'
const values = ['supermarket_besar', 'supermarket_sedang', 'supermarket_kecil', 'tradisional_market', 'perorangan']
const markers = [
  'CUSTOMER_CATEGORY_LEGACY_OLD_PREFLIGHT_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_EXISTING_ROWS_VERIFIED',
  'CUSTOMER_CATEGORY_LEGACY_OLD_CLIENT_VERIFIED',
  'CUSTOMER_CATEGORY_LEGACY_VALID_VALUES_VERIFIED',
  'CUSTOMER_CATEGORY_LEGACY_INVALID_VALUES_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_ORDER_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_TYPE_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_NULLABILITY_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_DEFAULT_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_IDENTITY_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_COLUMN_ACL_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_TABLE_ACL_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_PK_NAME_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_PK_COLUMNS_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_PK_MISSING_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_RLS_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_FORCE_RLS_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_OWNER_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_INHERITANCE_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_DRIFT_DROPPED_COLUMN_REJECTED',
  'CUSTOMER_CATEGORY_LEGACY_ROLLBACK_VERIFIED',
]
const load = () => import('./customer-category-legacy-guards.mjs')

describe('separate fictional legacy customer fixture', () => {
  it('provides a dedicated fixture instead of changing the original pilot fixture', () => {
    expect(existsSync(fixturePath)).toBe(true)
    expect(existsSync(builderPath)).toBe(true)
  })
  it('guards the separate database and postgres owner before any fixture mutation', () => {
    const sql = readFileSync(fixturePath, 'utf8')
    expect(sql).toContain("current_database()<>'pilot_category_legacy_test'")
    expect(sql).toContain("current_user<>'postgres'")
    expect(sql).toContain("purpose='disposable-pilot-ci'")
    expect(sql.indexOf('END $legacy_seed_guard$;')).toBeLessThan(sql.indexOf('CREATE SCHEMA'))
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1)
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1)
    for (const setting of ["lock_timeout='5s'", "statement_timeout='60s'", "idle_in_transaction_session_timeout='60s'", "search_path=''", 'row_security=off']) expect(sql).toContain(`SET LOCAL ${setting};`)
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|SCHEMA|COLUMN)|CREATE TABLE\s+IF NOT EXISTS/i)
  })
  it('uses actual physical order, defaults, PK, extension placement, null column ACL and unchanged five price tiers', () => {
    const sql = readFileSync(fixturePath, 'utf8')
    const table = sql.match(/CREATE TABLE public\.customers\s*\(([\s\S]*?)\n\);/)![1]
    expect(table.match(/^\s*([a-z_]+)\s+(?:uuid|text|timestamptz|integer|date|public\.pricing_tier)/gm)?.map(line => line.trim().split(/\s+/)[0])).toEqual([
      'id', 'name', 'phone', 'email', 'created_at', 'address', 'visit_frequency_days', 'last_visit_date', 'city', 'pricing_tier',
    ])
    expect(table).toContain('id uuid NOT NULL DEFAULT extensions.uuid_generate_v4()')
    expect(table).toContain('created_at timestamptz NOT NULL DEFAULT now()')
    expect(table).toContain('visit_frequency_days integer NOT NULL DEFAULT 7')
    expect(table).toContain("pricing_tier public.pricing_tier NOT NULL DEFAULT 'luar_kota'")
    expect(table).toContain('CONSTRAINT suppliers_pkey PRIMARY KEY (id)')
    expect(sql).toContain('CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions')
    expect(sql).toContain('ALTER TABLE public.customers OWNER TO postgres')
    expect(sql).toContain('ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.customers TO authenticated')
    expect(sql).toContain('GRANT ALL PRIVILEGES ON TABLE public.customers TO postgres, service_role')
    expect(sql).not.toMatch(/GRANT[^;]*\([^;]*\)\s+ON\s+(?:TABLE\s+)?public\.customers/i)
    const tiers = sql.match(/CREATE TYPE public\.pricing_tier AS ENUM\s*\(([\s\S]*?)\);/)![1]
    expect(tiers.match(/'[a-z_]+'/g)?.map(value => value.slice(1, -1))).toEqual(['harga_pokok', 'luar_kota', 'dalam_kota', 'depo_bangunan', 'others'])
    expect(sql).not.toContain('customer_category')
  })
})

describe('legacy preflight regression packet', () => {
  it('preserves the exact frozen old preflight bytes that rejected the legacy physical contract', async () => {
    const { FROZEN_CUSTOMER_CATEGORY_OLD_PREFLIGHT } = await import('./fixtures/customer-category-legacy-old-preflight.mjs')
    expect(createHash('sha256').update(FROZEN_CUSTOMER_CATEGORY_OLD_PREFLIGHT).digest('hex')).toBe('db48edb9d44c21ff526df98902c25707911b675065e160ed89ab73fa5b09d74e')
    expect(FROZEN_CUSTOMER_CATEGORY_OLD_PREFLIGHT).toContain("(3,'address','text',false)")
    expect(FROZEN_CUSTOMER_CATEGORY_OLD_PREFLIGHT).toContain("(10,'created_at','timestamp with time zone',false)")
    const packet = (await load()).buildCustomerCategoryLegacyGuards(source())
    expect(packet).toContain(FROZEN_CUSTOMER_CATEGORY_OLD_PREFLIGHT)
    expect(packet).toContain("SQLERRM<>'Unexpected customers column contract; migration refused'")
  })
  it('uses exact candidate bytes and actual preflight in every independent negative rollback', async () => {
    const migration = source()
    const { buildCustomerCategoryLegacyGuards, LEGACY_CATEGORY_MARKERS } = await load()
    const packet = buildCustomerCategoryLegacyGuards(migration)
    expect(LEGACY_CATEGORY_MARKERS).toEqual(markers)
    expect(Object.isFrozen(LEGACY_CATEGORY_MARKERS)).toBe(true)
    expect(packet.match(/CUSTOMER_CATEGORY_LEGACY_[A-Z_]+/g)).toEqual(markers)
    expect(packet).toContain(migration.replace(/^BEGIN;\n/m, '').replace(/\nCOMMIT;\s*$/, ''))
    const preflight = migration.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/)![0]
    expect(packet.split(preflight)).toHaveLength(17)
    expect(packet.match(/^BEGIN;$/gm)).toHaveLength(17)
    expect(packet.match(/^ROLLBACK;$/gm)).toHaveLength(17)
    expect(packet).not.toMatch(/^COMMIT;$/m)
  })
  it('guards database, marker, owner and locks before all test mutations with bounded timeouts', async () => {
    const packet = (await load()).buildCustomerCategoryLegacyGuards(source())
    const transactions = packet.match(/^BEGIN;\n[\s\S]*?^ROLLBACK;$/gm)!
    expect(transactions).toHaveLength(17)
    for (const sql of transactions) {
      expect(sql).toContain("current_database()<>'pilot_category_legacy_test'")
      expect(sql).toContain("purpose='disposable-pilot-ci'")
      expect(sql).toContain("current_user<>'postgres'")
      for (const setting of ["lock_timeout='5s'", "statement_timeout='60s'", "idle_in_transaction_session_timeout='60s'", "search_path=''", 'row_security=off']) expect(sql).toContain(`SET LOCAL ${setting};`)
      const guardEnd = sql.indexOf('END $legacy_disposable$;')
      const lock = sql.indexOf('LOCK TABLE public.customers IN ACCESS EXCLUSIVE MODE;')
      expect(guardEnd).toBeGreaterThan(0)
      expect(lock).toBeGreaterThan(guardEnd)
      const mutation = sql.search(/^\s*(?:INSERT INTO|ALTER TABLE|GRANT|REVOKE|CREATE (?:TEMP )?TABLE)\b/m)
      if (mutation >= 0) expect(mutation).toBeGreaterThan(lock)
    }
  })
  it('takes fictional rows through the complete postflight and preserves exact original data and metadata', async () => {
    const packet = (await load()).buildCustomerCategoryLegacyGuards(source())
    expect(packet.indexOf('Synthetic legacy category baseline')).toBeLessThan(packet.indexOf('ADD COLUMN customer_category text DEFAULT NULL'))
    for (const term of ['category_legacy_original_rows', 'category_legacy_original_relation', 'category_legacy_original_columns', 'category_legacy_original_constraints', 'category_legacy_original_policies', "-'customer_category'", 'EXCEPT', 'to_jsonb(c)', 'relacl', 'attacl', 'pg_get_expr', 'pg_policy', 'pg_constraint', 'customer_category IS NOT NULL']) expect(packet).toContain(term)
    expect(packet).toContain('Legacy fixture changed after rollback')
    expect(packet).toContain("attname='customer_category'")
    expect(packet).toContain('public.customers WHERE id=')
  })
  it('recomputes the identical seed snapshot after all rollback transactions', async () => {
    const fixture = readFileSync(fixturePath, 'utf8')
    const expected = fixture.match(/SELECT true,(jsonb_build_object\([\s\S]*?)\n\);/)![1]
    const packet = (await load()).buildCustomerCategoryLegacyGuards(source())
    const actual = packet.match(/DO \$legacy_rollback\$[\s\S]*?SELECT (jsonb_build_object\([\s\S]*?)\n\) INTO actual;/)![1]
    expect(actual).toBe(expected)
    expect(packet).toContain('actual IS DISTINCT FROM (SELECT state FROM public.category_legacy_fixture_baseline WHERE singleton)')
    expect(packet).toContain("pg_catalog.to_regclass('public.category_legacy_original_customers') IS NOT NULL")
    expect(packet).toContain("pg_catalog.to_regclass('public.synthetic_category_legacy_child') IS NOT NULL")
  })
  it('proves legacy omission, all accepted category keys and exact invalid-value check rejection', async () => {
    const packet = (await load()).buildCustomerCategoryLegacyGuards(source())
    expect(packet).toContain('Synthetic legacy old-client omission')
    expect(packet).toContain('GET STACKED DIAGNOSTICS rejected_constraint=CONSTRAINT_NAME')
    expect(packet).toContain("rejected_constraint<>'customers_customer_category_check'")
    expect(packet).toContain('EXCEPTION WHEN check_violation')
    expect(packet).toContain('Old-client omission changed defaults or category')
    for (const value of values) expect(packet).toContain(`'${value}'`)
    for (const malformed of ["''", "'SUPERMARKET_BESAR'", "'supermarket_besar '", "' supermarket_besar'", "'unknown'"]) expect(packet).toContain(malformed)
  })
  it('rejects unexpected order/type/nullability/default/identity/ACL/PK/relation states through exact candidate preflight errors', async () => {
    const packet = (await load()).buildCustomerCategoryLegacyGuards(source())
    for (const mutation of [
      'RENAME TO category_legacy_original_customers',
      'ALTER COLUMN email TYPE varchar(80)',
      'ALTER COLUMN name DROP NOT NULL',
      'ALTER COLUMN visit_frequency_days SET DEFAULT 8',
      'ALTER COLUMN visit_frequency_days ADD GENERATED ALWAYS AS IDENTITY',
      'GRANT SELECT (name) ON public.customers TO authenticated',
      'GRANT DELETE ON TABLE public.customers TO authenticated',
      'RENAME CONSTRAINT suppliers_pkey TO synthetic_unexpected_pkey',
      'PRIMARY KEY (id,name)',
      'DROP CONSTRAINT suppliers_pkey',
      'DISABLE ROW LEVEL SECURITY',
      'FORCE ROW LEVEL SECURITY',
      'OWNER TO authenticated',
      'INHERITS (public.customers)',
      'DROP COLUMN synthetic_removed_field',
    ]) expect(packet).toContain(mutation)
    expect(packet).toContain("SQLERRM<>'Unexpected customers column contract; migration refused'")
    expect(packet).toContain("SQLERRM<>'Unexpected customers relation contract; migration refused'")
    expect(packet.match(/Legacy preflight accepted unexpected state/g)).toHaveLength(15)
  })
  it('shares the fail-closed migration source boundary and has no execution capability', async () => {
    const { buildCustomerCategoryLegacyGuards } = await load()
    for (const command of ['COMMIT;', 'END;', 'ROLLBACK;', 'START TRANSACTION;', 'SAVEPOINT synthetic;', '\\gexec', ':synthetic', 'DO $$ BEGIN COMMIT; END $$;']) {
      expect(() => buildCustomerCategoryLegacyGuards(source().replace('ALTER TABLE public.customers', `${command}\nALTER TABLE public.customers`))).toThrow()
    }
    const implementation = readFileSync(builderPath, 'utf8')
    expect(implementation).toContain('assertSupportedCustomerCategoryMigrationSource(source)')
    expect(implementation).not.toMatch(/node:(?:fs|child_process|net|tls)|process\.env|execSync|spawnSync|createClient|fetch\s*\(/)
    expect(() => buildCustomerCategoryLegacyGuards(source() + '\nCOMMIT;')).toThrow()
    expect(() => buildCustomerCategoryLegacyGuards(source().replace('END $preflight$;', 'END $changed$;'))).toThrow()
  })
})
