import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Structural acceptance checks only. Database semantics require foundation.sql.
const path = resolve('supabase/catalogue/v1/01-foundation.sql')
const source = existsSync(path) ? readFileSync(path, 'utf8') : ''

function body(name: string) {
  const start = source.indexOf(`FUNCTION private.${name}(`)
  expect(start, `Missing foundation function private.${name}`).toBeGreaterThanOrEqual(0)
  const next = source.indexOf('CREATE ', start + 1)
  return source.slice(start, next < 0 ? undefined : next)
}

describe('catalogue foundation source contract', () => {
  it.each(['customers', 'products'])('%s receives server activation and a positive bigint version', table => {
    expect(source, 'Foundation fragment has not been implemented').toContain(`ALTER TABLE public.${table}`)
    expect(source).toMatch(/is_enabled boolean NOT NULL DEFAULT true/)
    expect(source).toMatch(/catalog_version bigint NOT NULL DEFAULT 1/)
    expect(source).toMatch(/CHECK\s*\(catalog_version > 0\)/)
  })

  it('retains private identity evidence without a cascading master foreign key', () => {
    expect(source).toContain('CREATE TABLE private.catalog_identity_v1')
    const identity = source.split('CREATE TABLE private.catalog_identity_v1')[1]?.split(');')[0] ?? ''
    expect(identity).toContain('PRIMARY KEY (kind, id)')
    expect(identity).toContain("'unknown', 'unused', 'used'")
    expect(identity).toMatch(/CHECK\s*\(last_version > 0\)/)
    expect(identity).not.toMatch(/REFERENCES|ON DELETE CASCADE/i)
  })

  it('keeps generation one and readiness hard false throughout foundation preparation', () => {
    expect(source).toContain('CREATE TABLE private.catalog_cutover_v1')
    expect(source).toContain('CHECK (execution_generation = 1)')
    expect(source).toContain('CHECK (NOT tracking_ready)')
    expect(source).toMatch(/VALUES\s*\(true, 1, false\)/)
  })

  it('seeds both pre-existing masters with typed null tombstones and conservative unknown evidence', () => {
    for (const [kind, table] of [['customer', 'customers'], ['product', 'products']]) {
      expect(source).toContain(`SELECT '${kind}', id, 'unknown', catalog_version, NULL::timestamptz FROM public.${table}`)
    }
  })

  it('does not change evidence for an insert attempt discarded by ON CONFLICT', () => {
    const before = body('catalog_master_before_v1')
    expect(before).not.toMatch(/FOR UPDATE|FOR SHARE|INSERT INTO private\.catalog_identity_v1|UPDATE private\.catalog_identity_v1/i)
    expect(source).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON public\.customers/)
    expect(source).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON public\.products/)
  })

  it('uses retained evidence to advance recreated identities without minting unused', () => {
    const before = body('catalog_master_before_v1')
    expect(before).toContain('NEW.catalog_version := prior_version + 1')
    expect(before).not.toMatch(/RAISE[^;]*tombston/i)
    const after = body('catalog_master_after_v1')
    expect(after).toContain("'unknown'")
    expect(after).toContain('prior.last_version >= NEW.catalog_version')
    expect(after).not.toMatch(/lifetime_state\s*=\s*'unused'|deleted_at\s*=\s*NULL/i)
  })

  it('refuses evidence deletion, identity reassignment, downgrade and tombstone reset', () => {
    const guard = body('catalog_identity_guard_v1')
    for (const text of ["TG_OP = 'DELETE'",'NEW.kind IS DISTINCT FROM OLD.kind','NEW.id IS DISTINCT FROM OLD.id','NEW.last_version < OLD.last_version',"OLD.lifetime_state = 'used'", "OLD.lifetime_state = 'unknown'",'OLD.deleted_at IS NOT NULL']) {
      expect(guard).toContain(text)
    }
  })

  it('increments a real update once but preserves no-op versions', () => {
    const before = body('catalog_master_before_v1')
    expect(before).toContain("(to_jsonb(NEW) - 'catalog_version') IS DISTINCT FROM (to_jsonb(OLD) - 'catalog_version')")
    expect(before).toContain('NEW.catalog_version := OLD.catalog_version + 1')
    expect(before).toContain('NEW.catalog_version := OLD.catalog_version')
  })

  it('revokes client table and function access to private foundation state', () => {
    for (const table of ['catalog_identity_v1','catalog_cutover_v1']) {
      expect(source).toContain(`ALTER TABLE private.${table} ENABLE ROW LEVEL SECURITY`)
      expect(source).toContain(`REVOKE ALL ON TABLE private.${table} FROM PUBLIC, anon, authenticated`)
    }
    for (const helper of ['catalog_master_before_v1','catalog_master_after_v1','catalog_identity_guard_v1']) {
      expect(source).toContain(`REVOKE ALL ON FUNCTION private.${helper}() FROM PUBLIC, anon, authenticated`)
      expect(body(helper)).toContain("SET search_path = ''")
    }
  })
})
