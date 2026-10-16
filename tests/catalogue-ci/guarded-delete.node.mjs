import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL(name,root),'utf8');
const candidate = 'supabase/catalogue/v1/new10-guarded-delete.sql';
test('guarded delete exists and uses the existing request ledger without widening raw rights',()=>{
 assert.ok(existsSync(new URL(candidate,root)),'missing guarded-delete implementation');
 const sql=read(candidate);
 for(const token of ['catalog_delete_unused_v1','catalog_assert_no_links_v1','catalog_create_scope_enter_v1','catalog_create_scope_leave_v1','catalog_create_unused_allowed_v1','catalog_identity_guard_v1','CATALOG_DELETE_BLOCKED','CATALOG_TRACKING_INCOMPLETE','CATALOG_VERSION_CONFLICT','catalog_requests_v1','catalog_writer_admit_v2']) assert.ok(sql.includes(token),token);
 assert.doesNotMatch(sql,/GRANT\s+DELETE|SET\s+tracking_ready\s*=\s*true|UPDATE[^;]+lifetime_state\s*=\s*'unused'/i);
 assert.doesNotMatch(sql,/CREATE(?: OR REPLACE)? FUNCTION private\.catalog_master_after_v1/);
});
test('product guarded-delete takes the final relation mode before identity evidence',()=>{
 const sql=read(candidate); const body=sql.slice(sql.indexOf('CREATE FUNCTION private.catalog_delete_unused_v1'));
 const final=body.indexOf('LOCK TABLE public.products IN EXCLUSIVE MODE NOWAIT');
 assert.ok(final>=0,'product final relation mode missing');
 assert.ok(final<body.indexOf('FROM private.catalog_identity_v1'),'identity evidence cannot precede final product mode');
 assert.ok(final<body.indexOf('catalog_assert_no_links_v1'),'complete links checked under final mode');
 assert.match(body,/FOR UPDATE NOWAIT/);
 assert.match(body,/'before',[\s\S]+catalog_version[\s\S]+'after',NULL/);
});
test('all public dispatch routes reauthorize trusted stored action before status dispatch or parsing',()=>{
 const sql=read('supabase/catalogue/v1/new08-catalogue-create-edit.sql');
 const command=sql.slice(sql.indexOf('CREATE FUNCTION public.pilot_catalog_transaction_v1'));
 const reauthorize=command.indexOf('catalog_reauthorize_request_v1(p_request_id)');
 assert.ok(reauthorize>=0 && reauthorize<command.indexOf("IF p_operation='set_enabled'"));
 assert.match(command,/p_operation='delete_unused'[\s\S]+catalog_delete_unused_v1\(p_request_id,p_payload\)/);
 assert.match(sql,/prior\.binding IS NOT NULL THEN[\s\S]{0,200}catalog_authorize_bound_v1\(prior\.binding,prior\.write_columns\)/);
 assert.match(sql,/catalog_create_scope_enter_v1\(p_request_id,target_kind,target_id\)/);
 assert.match(sql,/catalog_create_scope_leave_v1\(\)/);
});
test('safe birth uses exact private owner scope and never caller hints',()=>{
 const sql=read(candidate);
 for(const token of ['backend_pid','transaction_id','scope_id','actor_id','request_id','birth_verified','DEFERRABLE INITIALLY DEFERRED','catalog_create_scope_empty_v1']) assert.ok(sql.includes(token),token);
 assert.doesNotMatch(sql,/current_setting\([^)]*(?:scope|birth)|pg_trigger_depth\(/i);
 assert.match(sql,/OLD\.lifetime_state = 'unknown' AND NEW\.lifetime_state NOT IN \('unknown', 'used'\)/);
 assert.match(sql,/NEW\.lifetime_state = 'unused'[\s\S]+catalog_create_birth_verified_v1/);
});

test('behavioral proof covers real births, role-loss probes, rollback, conflicts, and bigint receipts',()=>{
 const sql=read('tests/database/catalogue/guarded-delete.sql');
 for(const token of ['guarded_delete_fixture','9007199254740993','lost-response exact delete replay','stored CO-only delete reauthorized before every dispatch','failure after actual birth rolls back','ON CONFLICT(sku) DO NOTHING','missing evidence blocks deletion','unknown never promoted to unused','unbound abandonment stays unbound']) assert.ok(sql.includes(token),token);
});
test('additive readiness read preserves legacy capability semantics and exposes only actor booleans',()=>{
 const sql=read(candidate);
 assert.match(sql,/CREATE FUNCTION public\.pilot_catalog_delete_access_v1\(\) RETURNS jsonb/);
 assert.match(sql,/'version',1,'actor_id',actor,'customer_delete',customer_allowed,'product_delete',product_allowed/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.pilot_procurement_access_v2/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.pilot_catalog_delete_access_v1\(\) TO authenticated/);
});
