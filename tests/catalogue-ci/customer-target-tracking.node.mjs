import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = () => readFileSync(new URL('../../supabase/catalogue/v1/02-customer-target-tracking.sql', import.meta.url), 'utf8');
test('actual row events capture OLD and NEW without attempted insert marking', () => {
 const s=source();
 assert.match(s,/AFTER INSERT OR UPDATE OR DELETE ON public.customer_targets/g);
 assert.match(s,/IF TG_OP <> 'INSERT' THEN ids := array_append\(ids, OLD.customer_id\)/);
 assert.match(s,/IF TG_OP <> 'DELETE' THEN ids := array_append\(ids, NEW.customer_id\)/);
 assert.doesNotMatch(s,/BEFORE INSERT|ON CONFLICT|pg_trigger_depth/);
});
test('same typed reservation and final mode as foundation, never repair identity', () => {
 const s=source();
 assert.match(s,/'catalog_identity_v1:customer:' \|\| identity_id::text, 1801427913/);
 assert.match(s,/pg_try_advisory_xact_lock/);
 assert.match(s,/ROW EXCLUSIVE MODE NOWAIT/);
 assert.match(s,/FOR UPDATE NOWAIT/);
 assert.match(s,/CATALOG_TRACKING_INCOMPLETE/);
 assert.doesNotMatch(s,/INSERT INTO private.catalog_identity_v1|pg_advisory_xact_lock\(/);
});
test('deferred guard is assertion only against saved event images', () => {
 const s=source(); const body=s.split('CREATE FUNCTION private.catalog_customer_targets_assert_v1()')[1].split('REVOKE ALL')[0];
 assert.match(s,/DEFERRABLE INITIALLY DEFERRED/);
 assert.match(body,/OLD.customer_id/); assert.match(body,/NEW.customer_id/);
 assert.doesNotMatch(body,/\bLOCK\b|FOR UPDATE|advisory|\bINSERT\b INTO|\bUPDATE\b private|\bDELETE\b FROM/);
});
test('does not rewrite authority, raw API, readiness, or allocate unused', () => {
 const s=source();
 assert.doesNotMatch(s,/CREATE POLICY|ALTER POLICY|GRANT |REVOKE .*ON TABLE|tracking_ready\s*=\s*true|SET lifetime_state\s*=\s*'unused'/);
 assert.match(s,/unexpected new-function grantee/);
});
