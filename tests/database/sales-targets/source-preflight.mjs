import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
export function verifySourceGuard({sql,root}) {
 const extract=name=>readFileSync(join(root,'supabase/sales_targets/v1',name),'utf8').match(/-- BEGIN CANONICAL SOURCE GUARD[^]*?-- END CANONICAL SOURCE GUARD/)[0]
 const guard=extract('01-foundation.sql')
 assert.equal(guard,extract('04-preflight-postflight.sql'),'Installation and postflight source guards must match')
 sql(guard)
 for(const drift of [
  "ALTER TABLE public.customer_manager_assignments DISABLE TRIGGER store_owner_guard_v1;",
  "ALTER TABLE public.purchase_orders DISABLE TRIGGER demo_credit_immutable;",
  "ALTER FUNCTION private.demo_capture_credit(uuid) SECURITY DEFINER;",
  "CREATE OR REPLACE FUNCTION private.demo_capture_credit(customer uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$BEGIN RETURN '{}'::jsonb;END$$;",
  "GRANT EXECUTE ON FUNCTION private.pilot_store_owner_guard_v1() TO authenticated;",
 ]) {
  assert.throws(()=>sql('BEGIN;'+drift+guard+'ROLLBACK;'),/Canonical source (helper|trigger) drift/,'Source drift must fail before target writes')
  sql(guard) // each failed connection rolled its transaction back
 }
 console.log('CANONICAL_SOURCE_PREFLIGHT_DRIFT_PASSED')
}
