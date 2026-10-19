// Static source checks only. SQL behavior is tested by retired-co-line-resolution.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const candidate = new URL('supabase/catalogue/v1/02-retired-co-line-resolution.sql', root);
const behavior = readFileSync(new URL('tests/database/catalogue/retired-co-line-resolution.sql', root), 'utf8');

test('retired resolver candidate exists at its fixed private boundary', () => {
  assert.ok(existsSync(candidate), 'Missing private retired CO-line resolver SQL candidate');
});
test('retired resolver is pure, immutable, private, and denies all API callers', () => {
  assert.ok(existsSync(candidate), 'Missing private retired CO-line resolver SQL candidate');
  const sql = readFileSync(candidate, 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /CREATE OR REPLACE FUNCTION private\.catalog_resolve_retired_co_line_v1\(\s*p_customer uuid,\s*p_order uuid,\s*p_line uuid,\s*p_history jsonb\s*\)/);
  const definitions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION ([\s\S]*?)\$\$;/g)];
  assert.ok(definitions.length >= 1);
  for (const [definition] of definitions) {
    assert.match(definition, /IMMUTABLE/);
    assert.match(definition, /SECURITY INVOKER/);
    assert.match(definition, /SET search_path = ''/);
  }
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|LOCK|EXECUTE|CREATE TRIGGER|SECURITY DEFINER)\b/i);
  // IS DISTINCT FROM is an expression, not a relation read.
  const relationSql = sql.replace(/\bIS(?:\s+NOT)?\s+DISTINCT\s+FROM\b/gi, 'COMPARISON');
  const relationRead = /\b(?:FROM|JOIN)\s+(?:public|private)\./i;
  assert.match('SELECT * FROM private.co_orders', relationRead);
  assert.doesNotMatch(relationSql, relationRead);
  assert.doesNotMatch(sql, /\b(?:float[48]?|real|double precision|jsonb_path_query|WITH RECURSIVE)\b/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION private\.catalog_resolve_retired_co_line_v1\(uuid,uuid,uuid,jsonb\) FROM PUBLIC, anon, authenticated, service_role/);
});
test('SQL behavior suite is fail-closed before candidate and has the eight bounded contract cases', () => {
  assert.match(behavior, /MISSING_RETIRED_CO_LINE_RESOLVER/);
  for (const name of [
    'frozen tuple resolves', 'missing history refuses', 'wrong frozen order refuses',
    'wrong audit customer refuses', 'conflicting stock keys refuse',
    'manual product null preserved', 'consistent observations deduplicate',
    'cross-customer stock key refuses',
  ]) assert.ok(behavior.includes(name), name);
  for (const text of ['ordinary post_sj', 'reviewed sources', '9007199254740993',
    'mixed roots refuse', 'missing orders membership refuses', 'product identity contradiction refuses',
    'null versus product contradiction refuses', 'nonregistered paths refuse', 'malformed UUID refuses']) {
    assert.ok(behavior.includes(text), text);
  }
  assert.doesNotMatch(behavior, /WHEN OTHERS THEN|ON_ERROR_STOP\s+(?:off|0)/i);
});
