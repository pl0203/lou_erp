// Local-only candidate contract/security regression tests; not PostgreSQL execution.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync(new URL('../../../supabase/candidates/co-stock-return-workspace/20261027144000_co_stock_return_workspace.sql',import.meta.url),'utf8')
test('additive atomic migration and bounded ACL',()=>{
 assert.match(sql,/^BEGIN;/m);assert.match(sql,/COMMIT;\s*$/)
 assert.doesNotMatch(sql,/CREATE OR REPLACE|ALTER FUNCTION|DROP |TRUNCATE /)
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/)
 for(const name of ['customers','items','create','create_result'])assert.match(sql,new RegExp('pilot_co_return_'+name+'_v1'))
 assert.match(sql,/pilot_co_returns_page_v1/)
 assert.match(sql,/REVOKE ALL ON TABLE private.co_return_workspace_requests FROM PUBLIC,anon,authenticated,service_role/)
})
test('adapter pins units/generation and rejects sales replay changes',()=>{
 for(const marker of ['CO_RETURN_UNIT_STALE','CO_RETURN_GENERATION_STALE','CO_RETURN_SALES_CHANGE_FORBIDDEN','CO_RETURN_INSUFFICIENT_STOCK','CO_RETURN_REQUEST_CONFLICT'])assert.ok(sql.includes(marker))
 assert.match(sql,/co_allocation_signature_v1\(plan->'replay'\)/)
 assert.match(sql,/co_effective_allocation_signature_v1\(c\)/)
 assert.match(sql,/plan->'publish_reports'/)
 assert.match(sql,/pilot_co_transaction_v1\(gen_random_uuid\(\),'save_return_draft'/)
 assert.match(sql,/pilot_co_transaction_v1\(gen_random_uuid\(\),'post_return'/)
 assert.match(sql,/FOR UPDATE/)
 assert.match(sql,/LIMIT p_page_size OFFSET/)
})
test('recovery survives future cutover and items bind locked snapshot',()=>{
 const recovery=sql.split('CREATE FUNCTION public.pilot_co_return_create_result_v1')[1].split('CREATE FUNCTION public.pilot_co_return_create_v1')[0]
 assert.doesNotMatch(recovery,/co_workspace_generation_guard_v1/)
 const create=sql.split('CREATE FUNCTION public.pilot_co_return_create_v1')[1]
 assert.ok(create.indexOf('RETURN saved.result')<create.indexOf('co_workspace_generation_guard_v1'))
 assert.match(sql,/v:=private.co_read_lock_v1\(p_customer_id,p_expected_customer_version\)/)
})
test('installation checks callable dependency authority before adding surface',()=>{
 assert.match(sql,/DO \$return_dependency_guard\$/)
 assert.match(sql,/Unreviewed return dependency authority/)
 assert.match(sql,/has_function_privilege\('anon',fn,'EXECUTE'\)/)
})
test('history customer picker is separate from positive-stock create picker',()=>{
 assert.match(sql,/CREATE FUNCTION public.pilot_co_return_history_customers_v1/)
 const createPicker=sql.split('CREATE FUNCTION public.pilot_co_return_customers_v1')[1].split('CREATE FUNCTION')[0]
 assert.doesNotMatch(createPicker,/co_return_heads/)
 const historyPicker=sql.split('CREATE FUNCTION public.pilot_co_return_history_customers_v1')[1].split('CREATE FUNCTION')[0]
 assert.match(historyPicker,/co_return_heads/)
})
