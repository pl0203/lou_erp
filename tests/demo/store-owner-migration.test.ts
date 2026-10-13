// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
const source=readFileSync('supabase/migrations/20261009061801_unify_store_owner_credit.sql','utf8')
test('one-time owner correction is atomic, bounded, audited and restores immutable snapshots',()=>{
 expect(source.match(/^BEGIN;$/gm)).toHaveLength(1);expect(source.match(/^COMMIT;$/gm)).toHaveLength(1)
 expect(source).toContain("SET LOCAL lock_timeout='5s'");expect(source).toContain("SET LOCAL statement_timeout='60s'")
 expect(source).toContain('LOCK TABLE public.purchase_orders,public.girard_orders IN ACCESS EXCLUSIVE MODE')
 expect(source).toContain('INSERT INTO private.pilot_store_credit_corrections_v1')
 expect(source.match(/DISABLE TRIGGER/g)).toHaveLength(1)
 expect(source).toContain('ENABLE TRIGGER demo_credit_immutable')
 expect(source).toContain('PO business data changed; all changes rolled back')
 expect(source).toContain('Existing function authority metadata drift')
 expect(source).not.toContain('session_replication_role')
 expect(source).not.toMatch(/UPDATE public\.users|DELETE FROM public\.purchase_orders|UPDATE public\.customer_sales_rep_assignments/)
})
test('one canonical assignment uses compare-and-swap and current hierarchy, never secondary credit mapping',()=>{
 const capture=source.slice(source.indexOf('CREATE OR REPLACE FUNCTION private.demo_capture_credit'),source.indexOf('-- One-time correction'))
 expect(capture).toContain('customer_manager_assignments')
 expect(capture).not.toContain('customer_sales_rep_assignments')
 expect(capture).toContain("'sales_person','sales_manager','sales_head','executive'")
 expect(source).toContain("previous.id IS DISTINCT FROM p_expected_assignment_id OR previous.version IS DISTINCT FROM p_expected_version")
 expect(source).toContain("u.role='sales_person' AND u.manager_id=manager")
 expect(source).toContain('REVOKE INSERT,UPDATE,DELETE ON public.customer_manager_assignments FROM authenticated')
})
test('credit-aware reporting preserves legacy metrics and avoids double counting converted POs',()=>{
 expect(source).toContain('WHERE o.po_id IS NULL AND o.created_at BETWEEN p_from AND p_to')
 expect(source).toContain('CASE WHEN g.id IS NULL THEN p.total_value ELSE g.total_value END')
 expect(source).toContain('CREATE UNIQUE INDEX store_owner_one_legacy_po_v1')
 expect(source).toContain('coalesce(g.created_at,p.created_at)')
})
test('CI includes marker-guarded synthetic cutover and real concurrent sessions',()=>{
 expect(readFileSync('.github/workflows/pilot-safety.yml','utf8')).toContain('run: node scripts/test-store-owner-ci.mjs')
 const ci=readFileSync('scripts/test-store-owner-ci.mjs','utf8')
 expect(ci).toContain('demoCiConnection(env)');expect(ci).toContain("purpose='disposable-pilot-ci'")
 expect(ci).toContain('store-owner-seed.sql');expect(ci).toContain('store-owner-races.mjs')
})
