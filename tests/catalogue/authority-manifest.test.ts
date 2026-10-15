import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const manifestPath = resolve('tests/catalogue/fixtures/authority-observed-grants.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
const sqlPath = resolve('supabase/catalogue/v1/01-foundation.sql')
const sql = existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : ''

describe('catalogue public-source synthetic authority manifest', () => {
  it('contains only named public-source synthetic observations', () => {
    expect(manifest, 'Missing checked authority metadata manifest').not.toBeNull()
    expect(manifest?.format).toBe('catalogue-synthetic-authority-v1')
    expect(Object.keys(manifest?.sources ?? {})).toEqual(['synthetic'])
    expect(Object.keys(manifest?.profiles ?? {})).toEqual(['synthetic'])
    expect(manifest?.sources.synthetic.runId).toBe('38504255853')
    expect(manifest?.sources.synthetic.scope).toBe('synthetic-composed-source-only')
    expect(manifest?.sources.synthetic.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest?.runtimeRequirement).toContain('all PostgreSQL roles')
    expect(manifest?.runtimeRequirement).toContain('before adding columns')
  })

  it('records both synthetic master ACLs and every synthetic legacy column', () => {
    expect(manifest).not.toBeNull()
    const profiles = manifest?.profiles ?? {}
    const customers = ['id', 'name', 'address', 'city', 'phone', 'email', 'pricing_tier', 'visit_frequency_days', 'last_visit_date', 'created_at', 'customer_category'].sort()
    const products = ['id', 'name', 'sku', 'size', 'unit_price', 'harga_pokok', 'luar_kota', 'dalam_kota', 'depo_bangunan'].sort()
    for (const name of ['synthetic']) {
      expect(profiles[name]?.customers.columns.map((c: { name: string }) => c.name).sort()).toEqual(customers)
      expect(profiles[name]?.customers.tableAcl).toBe('{postgres=arwdDxtm/postgres,authenticated=arw/postgres,service_role=arwdDxtm/postgres}')
      expect(profiles[name]?.products.tableAcl).toBe('{postgres=arwdDxtm/postgres,authenticated=arwd/postgres,service_role=arwdDxtm/postgres}')
    }
    expect(profiles.synthetic?.products.columns.map((c: { name: string }) => c.name).sort()).toEqual(products)
  })

  it('derives the legacy effective INSERT/UPDATE rights without treating the manifest as a form allowlist', () => {
    expect(manifest).not.toBeNull()
    for (const profile of Object.values(manifest?.profiles ?? {}) as any[]) {
      for (const table of Object.values(profile) as any[]) {
        expect(table.owner).toBe('postgres')
        expect(table.columns.length).toBeGreaterThanOrEqual(9)
        for (const column of table.columns) {
          expect(column.acl).toBeNull()
          expect(column.effectiveWrite).toEqual({ anon: { INSERT: false, UPDATE: false }, authenticated: { INSERT: true, UPDATE: true }, service_role: { INSERT: true, UPDATE: true } })
        }
      }
    }
    expect(sql).toContain('CREATE TEMP TABLE catalog_legacy_columns_v1')
    expect(sql).toContain('pg_catalog.has_column_privilege(r.oid, c.relation_oid, c.attnum, p.privilege)')
    expect(sql).toContain("string_agg(pg_catalog.quote_ident(column_name), ', ' ORDER BY attnum)")
    expect(sql).toContain('FROM pg_temp.catalog_legacy_write_acl_v1')
  })

  it('covers every public-source synthetic column with the candidate capability predicate', () => {
    expect(manifest).not.toBeNull()
    const declarations = [...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION ((?:public|private)\.[a-z0-9_]+)\([\s\S]*? AS \$\$([\s\S]*?)\$\$;/g)]
    const predicates = [
      { name: 'public.pilot_procurement_access_v1', count: 2 },
      { name: 'public.pilot_procurement_access_v2', count: 2 },
      { name: 'private.catalog_authorize_v1', count: 1 },
    ].flatMap(({ name, count }) => {
      const bodies = declarations.filter(declaration => declaration[1] === name)
      expect(bodies, `Expected one exact ${name} function`).toHaveLength(1)
      const scoped = [...(bodies[0]?.[2] ?? '').matchAll(/a\.attname NOT IN \(([^)]+)\)/g)]
      expect(scoped, `Legacy-column predicates in ${name}`).toHaveLength(count)
      return scoped
    })
    expect([...sql.matchAll(/a\.attname NOT IN \(([^)]+)\)/g)]).toHaveLength(predicates.length)
    for (const predicate of predicates) {
      expect([...predicate[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort()).toEqual(['catalog_version', 'is_enabled'])
      for (const profile of Object.values(manifest?.profiles ?? {}) as any[]) {
        for (const table of Object.values(profile) as any[]) {
          const excluded = new Set(['is_enabled', 'catalog_version'])
          expect(table.columns.filter((c: { name: string }) => !excluded.has(c.name))).toEqual(table.columns)
        }
      }
    }
  })
})
