// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APPROVED_READ_MIGRATIONS, assembleReadRollout, assertAssembledReadRollout,
  loadApprovedReadSources, stripMigrationTransaction,
} from '../../scripts/assemble-read-rollout.mjs'

const beforeSql = `SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path='';
CREATE TEMP TABLE rollout_snapshot ON COMMIT DROP AS SELECT 1 AS sentinel;
DO $guard$ BEGIN
 IF current_database() <> 'pilot_test' THEN RAISE EXCEPTION 'Guard rejected: no COMMIT'; END IF;
END $guard$;`
const afterSql = `DO $verify$ BEGIN
 IF (SELECT count(*) FROM pg_temp.rollout_snapshot) <> 1 THEN RAISE EXCEPTION 'ROLLBACK is a diagnostic word'; END IF;
END $verify$;`
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const load = () => loadApprovedReadSources(resolve('.'))

describe('approved read rollout source assembly', () => {
  it('pins exactly the approved ordered six paths and current SHA256 values', async () => {
    expect(Array.isArray(loadApprovedReadSources(resolve('.')))).toBe(true)
    const sources = await load()
    expect(APPROVED_READ_MIGRATIONS.map((entry: { path: string }) => entry.path.match(/20261001000\d/)?.[0]))
      .toEqual(['202610010001', '202610010002', '202610010004', '202610010007', '202610010008', '202610010009'])
    expect(sources).toHaveLength(6)
    for (const [i, source] of sources.entries()) {
      expect(source.path).toBe(APPROVED_READ_MIGRATIONS[i].path)
      expect(digest(source.sql)).toBe(APPROVED_READ_MIGRATIONS[i].sha256)
      expect(source.sql).toBe(await readFile(source.path, 'utf8'))
    }
    expect(Object.isFrozen(APPROVED_READ_MIGRATIONS)).toBe(true)
    expect(APPROVED_READ_MIGRATIONS.every(Object.isFrozen)).toBe(true)
  })

  it('preserves every migration body byte and 007 local search_path inside one outer transaction', async () => {
    const sources = await load()
    const packet = assembleReadRollout({ sources, beforeSql, afterSql })
    expect(packet.sql.startsWith('BEGIN;\n')).toBe(true)
    expect(packet.sql.endsWith('\nCOMMIT;\n')).toBe(true)
    expect(packet.checks.outerTransactions).toEqual({ begin: 1, commit: 1 })
    expect(packet.checks.sourceCount).toBe(6)
    expect(packet.checks.sourceBodiesPreserved).toBe(true)
    expect(packet.checks.assembledSha256).toBe(digest(packet.sql))
    for (const [i, source] of sources.entries()) {
      const expected = i === 2 ? source.sql : source.sql.replace(/^BEGIN;\r?\n/m, '').replace(/^COMMIT;\r?\n?$/m, '')
      const fragment = packet.fragments[i]
      expect(Buffer.from(packet.sql).subarray(fragment.startByte, fragment.endByte).toString()).toBe(expected)
      expect(fragment.bodySha256).toBe(digest(expected))
      expect(fragment.path).toBe(source.path)
    }
    expect(packet.sql).toContain('SET LOCAL search_path=public,pg_catalog;')
    expect(packet.manifest).toEqual(APPROVED_READ_MIGRATIONS.map(({ path, sha256 }: { path: string; sha256: string }) => ({ path, sha256 })))
    expect(assertAssembledReadRollout({ sql: packet.sql, sources, beforeSql, afterSql })).toEqual(packet.checks)
    expect(() => assertAssembledReadRollout({ sql: packet.sql.replace('SET LOCAL search_path=public,pg_catalog;', ''), sources, beforeSql, afterSql })).toThrow()
  })

  it('orders a supplied source set deterministically without trusting input order', async () => {
    const sources = await load()
    expect(assembleReadRollout({ sources: [...sources].reverse(), beforeSql, afterSql }).sql)
      .toBe(assembleReadRollout({ sources, beforeSql, afterSql }).sql)
  })

  it('fails closed on source drift, missing sources, duplicates and extra/rejected migration files', async () => {
    const sources = await load()
    const variants = [
      sources.slice(1), [...sources, sources[0]],
      sources.map((source: { path: string; sql: string }, i: number) => i === 0 ? { ...source, sql: `${source.sql}\n-- drift` } : source),
      ...['005_scalable_child_lookup_indexes', '006_scoped_summary_plan', '003_unapproved'].map(suffix => [
        ...sources.slice(0, 5), { path: `supabase/migrations/202610010${suffix}.sql`, sql: 'SELECT 1;' },
      ]),
      sources.map((source: { path: string; sql: string }, i: number) => i === 0 ? { ...source, path: `./${source.path}` } : source),
    ]
    for (const invalid of variants) expect(() => assembleReadRollout({ sources: invalid, beforeSql, afterSql })).toThrow()
  })

  it('does not accept caller-supplied replacement hashes', async () => {
    const sources = await load()
    const sql = sources[0].sql.replace('BEGIN;', 'BEGIN;\nCOMMIT;\nBEGIN;')
    const invalid = [{ ...sources[0], sql, sha256: digest(sql) }, ...sources.slice(1)]
    expect(() => assembleReadRollout({ sources: invalid, beforeSql, afterSql })).toThrow(/hash|drift/i)
  })

  it('rejects a missing repository source rather than falling back elsewhere', () => {
    expect(() => loadApprovedReadSources('/tmp/no-such-read-rollout-repository')).toThrow()
  })
})

describe('transaction structure checks', () => {
  it('strips only whole outer transaction lines while preserving comments, quoted SQL and procedural blocks', () => {
    const source = `-- boundary comment\r\nBEGIN;\r\nDO $body$ BEGIN RAISE NOTICE 'BEGIN; COMMIT;'; END $body$;\r\nCOMMIT;\r\n-- trailing comment\r\n`
    expect(stripMigrationTransaction(source, true)).toBe(`-- boundary comment\r\nDO $body$ BEGIN RAISE NOTICE 'BEGIN; COMMIT;'; END $body$;\r\n-- trailing comment\r\n`)
    expect(stripMigrationTransaction('DO $$ BEGIN NULL; END $$;\n', false)).toBe('DO $$ BEGIN NULL; END $$;\n')
  })

  it.each([
    'BEGIN;\nBEGIN;\nSELECT 1;\nCOMMIT;\nCOMMIT;\n',
    'BEGIN;\nSELECT 1;\nCOMMIT;\nCOMMIT;\n',
    'BEGIN WORK;\nSELECT 1;\nCOMMIT;\n',
    'BEGIN;\nSELECT 1;\nCOMMIT AND CHAIN;\n',
    'BEGIN; SELECT 1;\nCOMMIT;\n',
    'BEGIN;\nSELECT 1;\nROLLBACK;\n',
    'SELECT 1;\n',
  ])('refuses unexpected source transaction structure', source => {
    expect(() => stripMigrationTransaction(source, true)).toThrow()
  })

  it('requires 004-style unwrapped sources to remain unwrapped', () => {
    expect(() => stripMigrationTransaction('BEGIN;\nSELECT 1;\nCOMMIT;\n', false)).toThrow()
  })

  it.each([
    'COMMIT;', 'ROLLBACK;', 'END;', 'ABORT;', 'BEGIN;', 'START TRANSACTION;',
    'SAVEPOINT escape;', 'RELEASE SAVEPOINT escape;', "PREPARE TRANSACTION 'escape';",
    'SET TRANSACTION READ WRITE;', 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE;',
    'DISCARD ALL;', 'COPY test FROM STDIN;', '\\i unreviewed.sql', '\\gexec',
    'DO $$ BEGIN COMMIT; END $$;', 'DO $guard$ BEGIN ROLLBACK; END $guard$;',
    "DO 'BEGIN COMMIT; END';", 'SELECT 1; /* unfinished', "SELECT 'unfinished;", 'DO $$ BEGIN NULL; END;',
    'SELECT 1', '',
  ])('rejects transaction escapes or incomplete caller guards', async unsafe => {
    const sources = await load()
    expect(() => assembleReadRollout({ sources, beforeSql: unsafe, afterSql })).toThrow()
    expect(() => assembleReadRollout({ sources, beforeSql, afterSql: unsafe })).toThrow()
  })

  it('allows semicolons and transaction words only as inert quoted/comment text', async () => {
    const sources = await load()
    const before = `-- COMMIT;\n/* ROLLBACK; /* nested comment */ */\nSELECT 'COMMIT; ''ROLLBACK'';' AS "END";\nDO $$ BEGIN RAISE NOTICE 'ROLLBACK'; END $$;`
    expect(assembleReadRollout({ sources, beforeSql: before, afterSql }).checks.sourceBodiesPreserved).toBe(true)
  })
})
