import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
const sql=(n:string)=>readFileSync(`supabase/migrations/20261002100${n}.sql`,'utf8')
const calendar=sql('2_ihr_leave_calendar'),requests=sql('5_ihr_leave_requests'),admin=sql('7_ihr_leave_admin')
test('cancellation decisions resolve append-only attempt-bound routes and require explicit recovery',()=>{
 expect(requests).toContain('private.ihr_leave_cancellation_assignment(ca)')
 expect(admin).toContain("assignment_source->>'cancellation_attempt_id'=ca.id::text")
 expect(admin).toContain("p->>'attempt_id' IS DISTINCT FROM ca.id::text")
 expect(admin).toContain("r.status NOT IN('submitted','cancellation_pending')")
})
test('owner event history uses the same bounded immutable projection with personal authorization',()=>{
 expect(admin).toContain('CREATE FUNCTION public.leave_own_request_history_v1(')
 expect(admin).toContain('private.ihr_leave_request_history_page(r,p_before_at,p_before_id,p_limit)')
 expect(admin).toContain('DECLARE actor uuid:=private.ihr_leave_require_personal_actor()')
})
test('calendar and roster writes require proposed input and live impact source binding',()=>{
 expect(calendar).toContain('CREATE FUNCTION public.leave_calendar_preview_v1(')
 expect(calendar).toContain("v_preview->>'fingerprint' IS DISTINCT FROM p->>'preview_fingerprint'")
 expect(requests).toContain('CREATE OR REPLACE FUNCTION private.ihr_leave_calendar_impacts(')
 expect(calendar).toContain("v_impacts->>'sourceFingerprint'")
 expect(admin).not.toContain("'impacts',jsonb_build_object('available',false,'pendingCount',NULL,'approvedCount',NULL)")
})
test('assigned detail supplies request-allocation-only fresh balance context',()=>{
 expect(requests).toContain("'balanceContext',jsonb_build_object('asOf',statement_timestamp(),'basis','current','periods',balances)")
 expect(requests).toContain('JOIN public.ihr_leave_accounts account ON account.id=a.account_id')
})
test('all seven candidate migrations pin trusted install and routine paths',()=>{
 for(const name of ['1_ihr_leave_foundation','2_ihr_leave_calendar','3_ihr_leave_accounts','4_ihr_leave_quote','5_ihr_leave_requests','6_ihr_leave_reads','7_ihr_leave_admin']){
  const text=sql(name);expect(text).toContain('SET LOCAL search_path = pg_catalog, pg_temp;')
  expect(text).not.toMatch(/SET search_path\s*=\s*''/)
  expect(text).toContain('SET search_path = pg_catalog, pg_temp')
 }
})
