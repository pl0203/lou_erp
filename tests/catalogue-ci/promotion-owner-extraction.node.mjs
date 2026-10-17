// Source safety checks only. SQL behavior requires the identity-bound synthetic CI job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const candidate = new URL('supabase/catalogue/v1/02-promotion-owner-extraction.sql', root);
const sqlTests = new URL('tests/database/catalogue/promotion-owner-extraction.sql', root);
const sha = value => createHash('sha256').update(value).digest('hex');
test('the bounded promotion/owner SQL implementation exists', () => {
  assert.ok(existsSync(candidate), 'Missing promotion/owner extraction implementation');
});
test('the public producer source remains exactly pinned', () => {
  for (const [path, digest] of [
    ['supabase/migrations/202609300001_pilot_security.sql', 'f361220734a5dc9bde13beb254e4089bbb1a4166ac0b90540c6d20d8e5fb15c4'],
    ['supabase/migrations/202610081101_demo_order_promotions.sql', 'bef3867ce095f66f6a63399551478d0e4ee27895e521e183db3e728a7aca1938'],
    ['supabase/migrations/20261009061801_unify_store_owner_credit.sql', '117eba412ae0aeaef699f68ddfec9df7e1dc35d1cd0c49a462efb279dfc40057'],
    ['supabase/migrations/20261009110007_co_access.sql', '613579bcc348c7dadf77910beedd08ed88d88cad1a08f5d24b9870578c060fa6'],
  ]) assert.equal(sha(readFileSync(new URL(path, root))), digest, path);
});
test('every function is private invoker with a closed search path and no database effects', () => {
  assert.ok(existsSync(candidate), 'Missing promotion/owner extraction implementation');
  const sql = readFileSync(candidate, 'utf8');
  const definitions = [...sql.matchAll(/CREATE FUNCTION (private\.[a-z0-9_]+)\([\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$;/g)];
  assert.ok(definitions.length >= 4);
  assert.equal((sql.match(/CREATE FUNCTION /g) || []).length, definitions.length);
  for (const [definition, name, body] of definitions) {
    assert.match(definition, /SECURITY INVOKER SET search_path = ''/);
    assert.match(definition, /IMMUTABLE/);
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${name}(`), name);
    const executable = body.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|LOCK|EXECUTE|nextval|setval|gen_random_uuid|random|dblink|http|set_config)\b/i, name);
    assert.doesNotMatch(executable, /\b(?:FROM|JOIN)\s+(?:public|private|pg_catalog)\./i, name);
  }
  assert.doesNotMatch(sql, /CREATE (?:TRIGGER|TABLE|POLICY)|GRANT\s+EXECUTE|tracking_ready|catalog_identity_v1/i);
  assert.match(sql, /CATALOGUE_PROMOTION_OWNER_ACL_DRIFT/);
});
test('the same SQL contract fails specifically before installation and checks exact outputs afterward', () => {
  const sql = readFileSync(sqlTests, 'utf8');
  assert.ok(sql.indexOf('CATALOGUE_PROMOTION_OWNER_FIXTURE_READY') < sql.indexOf('CATALOGUE_PROMOTION_OWNER_MISSING_FUNCTION'));
  assert.match(sql, /ERRCODE = 'PCE01'/);
  assert.match(sql, /actual IS DISTINCT FROM expected/);
  for (const label of ['create direct and bound edge', 'OLD removed product retained', 'clear retains assignment', 'clear version must advance', 'large numeric owner version', 'expected product mismatch', 'missing frozen promotion', 'unsupported relation', 'unsupported history source', 'owner-only function ACL', 'resolved OLD and NEW provenance']) assert.ok(sql.includes(label), label);
});
