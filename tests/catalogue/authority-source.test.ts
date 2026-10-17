import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const path = resolve('supabase/catalogue/v1/01-foundation.sql')
const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
const baseline = readFileSync(resolve('supabase/migrations/20261009110007_co_access.sql'), 'utf8')

function publicBody(name: string) {
  const match = source.match(new RegExp(`(?:CREATE OR REPLACE|CREATE) FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`))
  expect(match, `Missing ${name} foundation definition`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('catalogue authority source contract', () => {
  it('replaces v1 write probes with effective column checks while preserving its keys', () => {
    const candidate = publicBody('pilot_procurement_access_v1')
    expect(candidate).toContain('has_column_privilege')
    expect(candidate).not.toMatch(/has_table_privilege\([^;]*'(INSERT|UPDATE)'/)
    const keys = (text: string) => [...text.matchAll(/'(version|as_of|actor_id|role|customer_create|customer_edit|customer_delete|product_create|product_edit|product_delete)'\s*,/g)].map(x => x[1]).sort()
    expect(keys(candidate)).toEqual(keys(baseline.split('CREATE FUNCTION public.pilot_procurement_access_v1')[1].split('END $$;')[0]))
    expect(candidate).toMatch(/'customer_delete'\s*,\s*false/)
    expect(candidate).toMatch(/IN\s*\('po_admin',\s*'executive'\)/)
  })

  it('defines v2 through current active authority with explicit delete modes', () => {
    const candidate = publicBody('pilot_procurement_access_v2')
    expect(candidate).toContain('public.current_user_role()')
    expect(candidate).toContain('auth.uid()')
    expect(candidate).toContain('has_column_privilege')
    for (const key of ['customer_set_enabled','product_set_enabled','customer_delete_mode','product_delete_mode']) expect(candidate).toContain(`'${key}'`)
    for (const mode of ['none','guarded','direct']) expect(candidate).toContain(`'${mode}'`)
  })

  it('changes only the four CO insert/update denials and preserves delete restrictions', () => {
    const drops = [...source.matchAll(/DROP POLICY\s+(\w+)/g)].map(x => x[1]).sort()
    expect(drops).toEqual(['co_customer_no_insert_v1','co_customer_no_update_v1','co_product_no_insert_v1','co_product_no_update_v1'])
    expect(source).not.toMatch(/(?:GRANT|REVOKE)[^;]*public\.(?:customer_targets|sales_targets)/i)
    expect(source).not.toMatch(/DROP POLICY\s+co_(?:customer|product)_no_delete_v1/)
    expect(source).not.toMatch(/GRANT\s+DELETE[^;]*public\.customers/i)
  })

  it('bases legacy INSERT/UPDATE grant conversion on a validated prechange effective-column contract', () => {
    expect(source).toContain('catalog_legacy_column_privileges_v1')
    expect(source).toContain('has_column_privilege')
    expect(source).toContain('CATALOG_LEGACY_COLUMN_PRIVILEGE_DRIFT')
    expect(source).not.toMatch(/GRANT\s+(?:INSERT|UPDATE)\s*\(\s*name\s*,\s*address\s*,\s*city\s*,\s*phone\s*,\s*email\s*,\s*pricing_tier\s*,\s*customer_category\s*\)/i)
  })

  it('captures every role and existing column before adding server-owned columns', () => {
    const capture = source.indexOf('CREATE TEMP TABLE catalog_legacy_column_privileges_v1')
    expect(capture).toBeGreaterThan(-1)
    const addColumns = source.search(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?is_enabled/i)
    if (addColumns >= 0) expect(capture).toBeLessThan(addColumns)
    const snapshot = source.slice(capture, source.indexOf(';', capture))
    expect(snapshot).toContain('pg_catalog.pg_roles')
    expect(snapshot).toContain('pg_temp.catalog_legacy_columns_v1')
    expect(snapshot).toContain('has_column_privilege')
    expect(snapshot).toContain('WITH GRANT OPTION')
    expect(snapshot).not.toMatch(/rolname\s+IN\s*\(/i)
    expect(source).toContain('catalog_legacy_memberships_v1')
    expect(source).toContain('catalog_legacy_write_acl_v1')
    expect(source).toContain('CATALOG_SERVER_COLUMN_PRIVILEGE_LEAK')
  })

  it('replays the complete observed legacy grant graph without flattening inherited roles', () => {
    expect(source).toContain('pg_catalog.aclexplode')
    expect(source).toContain('a.grantor')
    expect(source).toContain('a.grantee')
    expect(source).toContain('a.is_grantable')
    expect(source).toContain('GRANT %s (%s) ON TABLE %s TO %s%s')
    expect(source).toContain('REVOKE %s ON TABLE %s FROM %s RESTRICT')
    expect(source).not.toMatch(/REVOKE[^;]+CASCADE/i)
    expect(source).not.toMatch(/(?:GRANT|REVOKE)\s+\w+\s+TO\s+authenticated/i)
    expect(source).toContain('CATALOG_LEGACY_ACL_TOPOLOGY_UNSUPPORTED')
  })

  it('uses all current legacy columns including caller IDs for each capability', () => {
    for (const name of ['pilot_procurement_access_v1', 'pilot_procurement_access_v2']) {
      const candidate = publicBody(name)
      expect(candidate).toContain('pg_catalog.pg_attribute')
      expect(candidate).toContain('a.attnum > 0 AND NOT a.attisdropped')
      expect(candidate).toContain("a.attname NOT IN ('is_enabled', 'catalog_version')")
      expect(candidate).toContain('bool_and(has_column_privilege(current_user, a.attrelid, a.attnum,')
      expect(candidate).toContain("'INSERT'" )
      expect(candidate).toContain("'UPDATE'")
      expect(candidate).not.toMatch(/a\.attname\s+IN\s*\(/)
    }
  })

  it('keeps both capability functions stable invokers and public v2 execution authenticated only', () => {
    for (const name of ['pilot_procurement_access_v1', 'pilot_procurement_access_v2']) {
      expect(source).toMatch(new RegExp(`FUNCTION public\\.${name}\\(\\) RETURNS jsonb\\s+LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path\\s*=\\s*''`))
      expect(publicBody(name)).toContain("IF auth.uid() IS NULL OR r IS NULL OR r NOT IN ('po_admin', 'co_admin', 'executive')")
    }
    expect(source).toMatch(/REVOKE ALL ON FUNCTION public\.pilot_procurement_access_v2\(\) FROM PUBLIC, anon, authenticated, service_role/)
    expect(source).toContain('GRANT EXECUTE ON FUNCTION public.pilot_procurement_access_v2() TO authenticated')
    expect(source).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION private\.(?:pilot_procurement|catalog_authority)/)
  })
})
