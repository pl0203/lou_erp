import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const foundation = read('supabase/catalogue/v1/01-foundation.sql');
const original = foundation.match(/CREATE FUNCTION private\.catalog_master_after_v1\(\) RETURNS trigger[\s\S]*?END \$\$;/)[0];
const assignment = "  identity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;";
const defer = "\n  IF TG_OP = 'DELETE' AND identity_kind = 'product' AND private.catalog_product_delete_defer_v2(to_jsonb(OLD)) THEN\n    RETURN OLD;\n  END IF;";
const birth = "CASE WHEN private.catalog_create_unused_allowed_v1(identity_kind, identity_id) THEN 'unused' ELSE 'unknown' END";
const expected = original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
  .replace(assignment, assignment + defer)
  .replace("VALUES (identity_kind, identity_id, 'unknown', NEW.catalog_version, NULL)", `VALUES (identity_kind, identity_id, ${birth}, NEW.catalog_version, NULL)`);
const candidate = () => read('supabase/catalogue/v1/new11-master-completion-hooks.sql');

test('composition preserves the complete foundation body except the two reviewed hooks', () => {
  const actual = candidate().match(/CREATE OR REPLACE FUNCTION private\.catalog_master_after_v1\(\) RETURNS trigger[\s\S]*?END \$\$;/)?.[0];
  assert.equal(actual, expected);
});
test('product deletion defers before any identity reservation', () => {
  const sql = candidate();
  assert.ok(sql.indexOf('catalog_product_delete_defer_v2') < sql.indexOf('pg_try_advisory_xact_lock'));
  assert.ok(sql.includes(assignment + defer));
});
test('certification is confined to an absent identity after an actual insert', () => {
  const sql = candidate();
  assert.equal(sql.split('catalog_create_unused_allowed_v1').length, 2);
  assert.ok(sql.indexOf("IF TG_OP <> 'INSERT'") < sql.indexOf('catalog_create_unused_allowed_v1'));
  assert.ok(sql.indexOf('FOR UPDATE NOWAIT') < sql.indexOf('catalog_create_unused_allowed_v1'));
});
test('replacement is private and does not activate readiness or rewrite triggers', () => {
  const sql = candidate();
  assert.match(sql, /SECURITY DEFINER SET search_path = ''/);
  assert.match(sql, /REVOKE ALL ON FUNCTION private\.catalog_master_after_v1\(\) FROM PUBLIC, anon, authenticated;/);
  assert.doesNotMatch(sql, /\b(?:GRANT|CREATE TRIGGER|ALTER TABLE)\b|SET\s+(?:tracking_ready|execution_generation)/i);
});
