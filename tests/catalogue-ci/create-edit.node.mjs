import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = path => readFileSync(new URL('../../'+path, import.meta.url), 'utf8');
test('create/edit is an additive receipt-backed vertical with explicit current scope', () => {
 const sql=read('supabase/catalogue/v1/new08-catalogue-create-edit.sql');
 for(const token of ['catalog_request_no_pending_v1','DEFERRABLE INITIALLY DEFERRED','catalog_assert_write_policy_v1','catalog_authorize_fields_v1','catalog_assert_write_row_v1','sha256','p_operation = \'create\'','p_operation = \'edit\'','FOR UPDATE NOWAIT','CATALOG_VERSION_CONFLICT','CATALOG_REQUEST_CONFLICT']) assert.ok(sql.includes(token),token);
 assert.match(sql,/catalog_assert_write_row_v1\(target_kind, old_row\)/);
 assert.match(sql,/catalog_assert_write_row_v1\(target_kind, proposed_row\)/);
 assert.match(sql,/unit_price[^\n]+NULL/i);
 assert.doesNotMatch(sql,/SET\s+tracking_ready\s*=\s*true/i);
 assert.doesNotMatch(sql,/DELETE FROM public\.(customers|products)/i);
});
test('create/edit form path uses one durable sender and no direct insert/update fallback',()=>{
 for(const name of ['CustomerList','ProductList']) {
  const code=read('src/pages/athel/'+name+'.tsx');
  assert.ok(code.includes('sendCatalogueForm'));
  assert.doesNotMatch(code,/\.from\('(customers|products)'\)\.(insert|update)/);
 }
 const hook=read('src/lib/catalogue/useCataloguePage.ts');
 assert.ok(hook.includes("'create', 'edit', 'set_enabled'"));
});
