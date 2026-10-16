// Source-contract tests. PostgreSQL behavior is verified only by the fictional CI harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const path=new URL('../../supabase/catalogue/v1/new09-checked-boundaries.sql',import.meta.url);
const sql=existsSync(path)?readFileSync(path,'utf8'):'';
function body(name){const start=sql.indexOf('CREATE FUNCTION '+name+'(');assert.notEqual(start,-1,'missing '+name);const a=sql.indexOf('AS $$',start),b=sql.indexOf('$$;',a+5);assert.ok(a>start&&b>a,name+' body');return sql.slice(a+5,b);}
test('actual business statements and exact rows are generation fenced without changing gen1 grants',()=>{
 const b=body('private.catalog_business_write_fence_v2');
 assert.match(b,/catalog_writer_drain_v2/);assert.match(b,/generation=1/);assert.match(b,/TG_LEVEL='STATEMENT'/);assert.match(b,/catalog_business_row_allowed_v2/);
 for(const relation of ['customer_targets','customer_manager_assignments','customer_sales_rep_assignments','purchase_orders','po_line_items','po_audit_log','girard_orders','girard_order_items','orders','order_line_items','surat_jalan','sj_line_items','promotions','sales_schedules','visit_requests','outlet_visits','visit_photos'])assert.ok(sql.includes("'public."+relation+"'"),relation);
 assert.doesNotMatch(sql,/(?:GRANT|REVOKE)[^;]*\bON (?:TABLE )?public\./);
 assert.doesNotMatch(sql,/(?:ALTER TABLE|UPDATE) private\.catalog_cutover_v1/);
});
test('business truncate is denied in gen2 before all clearing and not a maintenance interface',()=>{
 const b=body('private.catalog_business_truncate_fence_v2');assert.match(b,/catalog_writer_drain_v2/);assert.match(b,/CATALOG_GENERATION_RETIRED/);assert.match(sql,/BEFORE TRUNCATE/);
 assert.doesNotMatch(sql,/CREATE(?: OR REPLACE)? FUNCTION public\.(?:.*maintenance|.*raw|.*clear)/);
});
test('checked target replay precedes admission and mutable target reads',()=>{
 const b=body('public.pilot_customer_target_upsert_v1');const replay=b.indexOf("prior.status='committed'");assert.ok(replay>=0);assert.ok(replay<b.indexOf('catalog_writer_admit_v2'));assert.ok(replay<b.indexOf('FROM public.customer_targets'));
 assert.match(b,/FOR SHARE/);assert.match(b,/RETURNING \* INTO saved/);assert.match(b,/saved.id IS NULL/);assert.match(b,/set_by/);assert.match(b,/catalog_target_active_v1/);
 const reconcile=body('public.pilot_reconcile_customer_target_v1');assert.match(reconcile,/catalog_target_authorize_v1/);assert.doesNotMatch(reconcile,/FROM public\.(?:customers|customer_targets)|catalog_writer_admit_v2|FOR SHARE/);
});
test('target policy and effective column grants fail closed, ledger is immutable and private',()=>{
 assert.match(sql,/catalog_target_policy_reference_v1/);assert.match(sql,/has_column_privilege\('authenticated'/);assert.match(sql,/CATALOG_POLICY_PARITY_UNPROVED/);
 assert.match(sql,/catalog_target_no_pending_v1/);assert.match(sql,/catalog_target_terminal_v1/);assert.match(sql,/REVOKE ALL ON TABLE private\.catalog_target_requests_v1/);
 assert.match(sql,/FUNCTION public\.pilot_customer_target_write_access_v1\(\)/);
});
test('native product root takes final relation mode before rows, allows only bound promotion delete, and flushes sorted evidence once',()=>{
 const begin=body('private.catalog_product_delete_begin_v2');assert.match(begin,/LOCK TABLE public.products IN EXCLUSIVE MODE NOWAIT/);assert.match(begin,/catalog_product_delete_topology_v2/);
 const row=body('private.catalog_product_delete_row_v2');assert.match(row,/OLD.id/);assert.match(row,/OLD.catalog_version/);
 const end=body('private.catalog_product_delete_end_v2');assert.match(end,/ORDER BY product_id/);assert.match(end,/lifetime_state/);assert.match(end,/deleted_at/);assert.doesNotMatch(end,/FROM public\.(?:products|customers).*FOR/);
 assert.match(sql,/FUNCTION private\.catalog_product_delete_defer_v2\(p_old jsonb\)/);
 assert.doesNotMatch(sql,/CREATE(?: OR REPLACE)? FUNCTION private\.catalog_master_after_v1/);
 assert.doesNotMatch(sql,/pg_trigger_depth\(/);
});
test('only three exact intended target APIs receive source EXECUTE and complete helper ACL postflight exists',()=>{
 const grants=[...sql.matchAll(/GRANT EXECUTE ON FUNCTION ([^;]+) TO authenticated;/g)].map(x=>x[1]);assert.equal(grants.length,1);assert.match(grants[0],/pilot_customer_target_upsert_v1/);assert.match(grants[0],/pilot_reconcile_customer_target_v1/);assert.match(grants[0],/pilot_customer_target_write_access_v1/);
 assert.match(sql,/DO \$checked_boundary_acl_postflight\$/);assert.match(sql,/aclexplode/);assert.match(sql,/proconfig/);
});
test('fresh exact writer scopes wrap complete final phases and never authorize by previously used state',()=>{
 assert.match(sql,/catalog_checked_scope_v2/);assert.match(sql,/scope_id uuid NOT NULL/);assert.match(sql,/prepared boolean NOT NULL DEFAULT false/);
 const row=body('private.catalog_business_row_allowed_v2');assert.match(row,/catalog_checked_ref_allowed_v2/);assert.doesNotMatch(row,/lifetime_state/);
 const phase=body('private.catalog_po_master_phase_v2');assert.match(phase,/FROM public.girard_orders/);assert.match(phase,/FROM private.pilot_promo_slices/);assert.ok(phase.indexOf('catalog_po_master_phase_original_v2')<phase.indexOf('catalog_checked_prepare_v2'));
 const co=body('private.catalog_co_customer_phase_v2');assert.match(co,/FROM private.co_stock_keys/);assert.match(co,/jsonb_array_elements\(new_lines\)/);
 assert.match(sql,/catalog_checked_context_empty_v2/);assert.match(sql,/catalog_checked_early_event_v2/);
});
test('generation two rejects drifted finite trigger graph and pinned unchanged cores',()=>{
 const graph=body('private.catalog_assert_checked_graph_v2');assert.match(graph,/pg_catalog.pg_trigger/);assert.match(graph,/tgisinternal/);assert.match(graph,/pg_catalog.pg_proc/);assert.match(graph,/CATALOG_TRACKING_INCOMPLETE/);
 assert.match(body('private.catalog_business_write_fence_v2'),/catalog_assert_history_contract_v1/);
 assert.match(body('private.catalog_product_delete_begin_v2'),/catalog_assert_checked_graph_v2/);
});
test('native second deletion after raw UUID recreation retains original tombstone',()=>{
 const end=body('private.catalog_product_delete_end_v2');assert.doesNotMatch(end,/prior\.deleted_at IS NOT NULL/);assert.match(end,/deleted_at=coalesce\(prior\.deleted_at,statement_timestamp\(\)\)/);
});
test('final graph includes every retained literal trigger, including multiline foundation and constraint declarations',()=>{
 const graph=body('private.catalog_assert_checked_graph_v2');
 const protectedRelations=new Set([...graph.matchAll(/'(public\.[a-z_0-9]+|private\.[a-z_0-9]+)'::regclass/g)].map(m=>m[1]));
 const composed=JSON.parse(readFileSync(new URL('../../supabase/catalogue/ci/composition.json',import.meta.url),'utf8')).composition.map(entry=>entry.path);
 const retainedSources=[...composed,...['01-foundation.sql','02-customer-target-tracking.sql','04-order-boundaries.sql','new06-co-order-boundaries.sql','new07-lifetime-admission.sql','new09-checked-boundaries.sql'].map(file=>'supabase/catalogue/v1/'+file)];
 const declarations=new Map();let checked=0;
 for(const file of retainedSources){
  const source=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  // Independent declaration scan: whitespace includes newlines, and CONSTRAINT
  // does not change whether the original application trigger remains installed.
  for(const statement of source.split(';')){
   const dropped=statement.match(/\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([a-z_0-9]+)\s+ON\s+((?:public|private)\.[a-z_0-9]+)/);
   if(dropped)declarations.delete(dropped[2]+'.'+dropped[1]);
   const m=statement.match(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([a-z_0-9]+)\s+(?:BEFORE|AFTER)\b[\s\S]*?\bON\s+((?:public|private)\.[a-z_0-9]+)\b[\s\S]*?\bEXECUTE\s+FUNCTION\s+((?:public|private)\.[a-z_0-9]+)\s*\(/);
   if(!m||!protectedRelations.has(m[2]))continue;
   declarations.set(m[2]+'.'+m[1],{file,match:m});
  }
 }
 for(const {file,match:m} of declarations.values()){assert.ok(graph.includes("('"+m[2]+"','"+m[1]+"','"+m[3]+"()'"),file+' retained trigger '+m[2]+'.'+m[1]);checked++;}
 assert.ok(checked>=50,'independently enumerated retained trigger declarations across full composition');
 for(const relation of ['public.customers','public.products'])for(const name of ['catalog_master_before_v1','catalog_master_after_v1','catalog_master_no_truncate_v1'])assert.ok(graph.includes("('"+relation+"','"+name+"'"),relation+'.'+name);
});
test('graph metadata aliases quote reserved DEFERRABLE and preserve its exact JSON key',()=>{
 const graph=body('private.catalog_assert_checked_graph_v2');assert.match(graph,/e\(relation,name,function_name,event_type,enabled,"deferrable",initially_deferred,arguments,columns,qualifier\)/);assert.doesNotMatch(graph,/enabled,deferrable,/);
});
test('checked target business use accepts present recreated customer with matching evidence version',()=>{
 const save=body('public.pilot_customer_target_upsert_v1');assert.doesNotMatch(save,/i\.deleted_at IS NULL/);assert.match(save,/SELECT c\.catalog_version INTO customer_version/);assert.match(save,/i\.last_version=customer_version/);
});
test('actual service-role refusal probe never calls an ungranted temporary helper',()=>{
 const fixture=readFileSync(new URL('../../tests/database/catalogue/checked-boundaries.sql',import.meta.url),'utf8');
 const service=fixture.split('SET LOCAL ROLE service_role;')[1].split('RESET ROLE;')[0];
 assert.doesNotMatch(service,/pg_temp\./);assert.match(service,/INSERT INTO public\.customer_targets/);assert.match(service,/EXCEPTION WHEN insufficient_privilege/);assert.match(service,/PG_EXCEPTION_DETAIL/);
});
