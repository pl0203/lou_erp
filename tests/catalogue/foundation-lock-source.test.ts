import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Shape tests protect the fail-fast integration boundary, not runtime race proof.
const path = resolve('supabase/catalogue/v1/01-foundation.sql')
const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
const body = (name: string) => {
  const match = source.match(new RegExp(`CREATE FUNCTION private\\.${name}\\([^]*?AS \\$\\$([^]*?)\\$\\$;`))
  expect(match, `Missing ${name}`).not.toBeNull()
  return (match?.[1] ?? '').replace(/--[^\n]*/g, '')
}

describe('foundation actual-event fail-fast boundary', () => {
  it('uses one transaction-scoped nonblocking identity reservation', () => {
    const after = body('catalog_master_after_v1')
    expect(after).toContain('pg_try_advisory_xact_lock')
    expect(after).not.toContain('pg_advisory_xact_lock(')
    expect(after).toContain("ERRCODE = '55P03'")
    expect(after).toContain('hashtextextended')
    expect(after.indexOf('pg_try_advisory_xact_lock')).toBeLessThan(after.indexOf('FOR UPDATE NOWAIT'))
  })
  it('does not add a blocking table or row evidence-lock edge', () => {
    const after = body('catalog_master_after_v1')
    expect(after).toContain('LOCK TABLE private.catalog_identity_v1 IN ROW EXCLUSIVE MODE NOWAIT')
    expect(after).toContain('FOR UPDATE NOWAIT')
    expect(after).not.toMatch(/FOR UPDATE\s*;/)
    expect(body('catalog_master_before_v1')).toContain('LOCK TABLE private.catalog_identity_v1 IN ACCESS SHARE MODE NOWAIT')
  })
  it('reserves and checks for evidence only after master insertion actually occurs', () => {
    const before = body('catalog_master_before_v1')
    expect(before).not.toMatch(/advisory|FOR UPDATE|INSERT INTO private|UPDATE private/i)
    const after = body('catalog_master_after_v1')
    const lookup = after.indexOf('FOR UPDATE NOWAIT')
    const insert = after.indexOf('INSERT INTO private.catalog_identity_v1')
    expect(lookup).toBeGreaterThan(-1)
    expect(insert).toBeGreaterThan(lookup)
    expect(after).not.toContain('ON CONFLICT')
  })
  it('retains evidence against table truncation as well as row deletion', () => {
    expect(source).toContain('BEFORE TRUNCATE ON private.catalog_identity_v1')
    expect(body('catalog_identity_guard_v1')).toContain("TG_OP = 'TRUNCATE'")
    expect(source).toContain('BEFORE TRUNCATE ON public.customers')
    expect(source).toContain('BEFORE TRUNCATE ON public.products')
    expect(body('catalog_master_truncate_v1')).toContain('CATALOG_IDENTITY_CONFLICT')
  })
  it('keeps both maintenance function execution and server-state access private', () => {
    expect(source).toContain('REVOKE ALL ON FUNCTION private.catalog_master_truncate_v1() FROM PUBLIC, anon, authenticated')
    expect(source).not.toMatch(/(?:tracking_ready\s*=\s*true|execution_generation\s*=\s*2)/)
    expect(source).not.toContain('CREATE FUNCTION public.pilot_catalogue_command_v1')
  })
})

it('refuses unknown default ACL grantees on every newly created privileged object', () => {
  expect(source).toContain('CATALOG_FOUNDATION_FUNCTION_ACL_DRIFT')
  expect(source).toContain('CATALOG_FOUNDATION_TABLE_ACL_DRIFT')
  expect(source).toContain("pg_catalog.acldefault('f', p.proowner)")
  expect(source).toContain("a.grantee = 'authenticated'::regrole::oid")
  expect(source).toContain('a.grantee <> p.proowner')
  expect(source).toContain('a.grantee <> c.relowner')
})
