import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const file = 'supabase/catalogue/v1/02-po-reference-extraction.sql';
const read = p => readFileSync(new URL(p, root), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const pins = [
  {
    "path": "tests/database/fixture.sql",
    "sha256": "4e16437026c9afff1c25578bc6f9dcf47db945b27ecd578afefbf5df553922b5"
  },
  {
    "path": "supabase/migrations/202609300002_order_transactions.sql",
    "sha256": "a0e422d69bd9bd7d85051ff50fc9266b3b6303945056bb0eac05310328d24eaf"
  },
  {
    "path": "supabase/migrations/202609300004_visit_transactions.sql",
    "sha256": "3a1fab79c36cb5d59854ac6fa75020563bc858f91a19877ed603e4424806f30a"
  },
  {
    "path": "supabase/migrations/202610081101_demo_order_promotions.sql",
    "sha256": "bef3867ce095f66f6a63399551478d0e4ee27895e521e183db3e728a7aca1938"
  },
  {
    "path": "supabase/migrations/202610081102_demo_visit_workflow.sql",
    "sha256": "2bca74f51de8a6f29065ef9ab88451b0bee9eb7d1caea03cf3ce19fe739488ca"
  },
  {
    "path": "supabase/migrations/20261009110007_co_access.sql",
    "sha256": "613579bcc348c7dadf77910beedd08ed88d88cad1a08f5d24b9870578c060fa6"
  },
  {
    "path": "supabase/migrations/202610020003_stale_po_conflicts.sql",
    "sha256": "e29991fdf76795e025b97dc8f9b9194da5be48229396ea10cf37387c3257e86d"
  },
  {
    "path": "supabase/migrations/20261009061801_unify_store_owner_credit.sql",
    "sha256": "117eba412ae0aeaef699f68ddfec9df7e1dc35d1cd0c49a462efb279dfc40057"
  }
];
const profile = {"sourceCommit":"c38b14fd122fc5dd08080f9a48adce254e4c3e52","schemaProfile":"public-po-source-20261014","producerPinsSha256":"8085f8784fb1071ef91f994bb962af9731ea8c9a2aa61023fcf88b7b8be20cb1"};
const need = () => { assert.ok(existsSync(new URL(file, root)), 'Missing bounded PO reference extraction helper'); return read(file); };
// Source checks prove containment and fixture coverage only. SQL semantics are
// unrun until a separately authorized identity-bound PostgreSQL session executes
// tests/database/catalogue/po-reference-extraction.sql with the candidate.
test('public producer bytes and source-only profile are pinned independently', () => {
  for (const pin of pins) assert.equal(sha(read(pin.path)),pin.sha256,pin.path);
  assert.equal(sha(JSON.stringify(pins)),profile.producerPinsSha256);
  assert.ok(need().includes(JSON.stringify(profile)));
});
test('bounded private entrypoint retains actual OLD and NEW dispatch and complete envelopes',()=>{
  const sql=need();
  assert.match(sql,/CREATE FUNCTION private.catalog_por_extract_event_v1\(p_relation regclass,p_op text,p_old jsonb,p_new jsonb,p_profile jsonb\)/);
  for(const token of ["ARRAY['OLD','NEW']","'INVALID_EVENT'","'UNKNOWN_RELATION'","'UNVERIFIED_SCHEMA'","'historicalNulls'","'origins'","'edges'","'refs'","'ok',false"]) assert.ok(sql.includes(token),token);
  assert.match(sql,/EXCEPTION WHEN SQLSTATE 'PCE03'/);
});
test('all functions have fixed paths, private owner-only ACLs and immutable pure bodies',()=>{
  const sql=need(); const defs=[...sql.matchAll(/CREATE FUNCTION private\.(catalog_por_\w+)\([^]*?AS \$fn\$[^]*?\$fn\$;/g)];
  assert.ok(defs.length>=8);
  for(const m of defs){assert.match(m[0],/IMMUTABLE SECURITY INVOKER SET search_path = ''/);assert.ok(sql.includes(`REVOKE ALL ON FUNCTION private.${m[1]??m[2]}(`));}
  const executable=sql.replace(/--[^\n]*/g,'');
  assert.doesNotMatch(executable,/\b(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM|CREATE TRIGGER|CREATE TABLE|GRANT|pg_advisory|FOR UPDATE|FOR SHARE|tracking_ready|current_setting|EXECUTE)\b/i);
  assert.doesNotMatch(executable,/\b(?:FROM|JOIN)\s+(?:public|private)\./i);
  assert.equal((sql.match(/FROM PUBLIC,anon,authenticated,service_role;/g)||[]).length,defs.length);
});
test('request versions, historical producer profiles and closed payload grammars are explicit',()=>{
 const sql=need();for(const text of ['pilot_order_transaction@202609300002','pilot_finalize_visit@202609300004','pilot_validate_order_lines@202609300002',"'execution_version'","'UNKNOWN_VERSION'","'UNSUPPORTED_LEGACY_PROFILE'", "'recovery_abandoned'","'abandoned'", "'result'", "'promo_stock_ack'", "'shortages'", "'allocations'"])assert.ok(sql.includes(text),text);
 assert.match(sql,/catalog_por_keys_v1/);assert.match(sql,/catalog_por_allowed_v1/);
 assert.doesNotMatch(sql,/jsonb_path_query|jsonb_each\(/);
});
test('public audit discriminators parse both nested sides, retain tuple constraints and reject malformed text JSON',()=>{
 const sql=need();for(const x of ["ARRAY['old_value','new_value']","'po_items_revised'","'sj_lines_revised'","'customer'","'INVALID_TEXT_JSON'","'productId'","'customerId'","'orderId'","'origin'"])assert.ok(sql.includes(x),x);
 assert.doesNotMatch(sql,/'line_item_added'|'sj_deleted'|'line_item_removed'/);
 assert.match(sql,/numeric/);assert.doesNotMatch(sql,/double precision|real\b/i);
});
test('SQL suite has exact missing-helper RED and real bounded behavior oracles',()=>{
 need();const sql=read('tests/database/catalogue/po-reference-extraction.sql');
 assert.match(sql,/WHEN SQLSTATE '42883'/);assert.match(sql,/CATALOGUE_PO_REFERENCE_EXPECTED_RED_42883/);
 assert.match(sql,/CATALOGUE_PO_REFERENCE_BEHAVIOR_PASSED/);
 for(const label of ['OLD removal retained','nested both sides retained','SQL null accepted','text JSON null refused','abandoned payload retained','wrong PO refused','unknown raw key refused','receipt mismatch refused','source profile refused','numeric fidelity','inherited field refused','legacy submit named grammar','legacy visit named grammar','promotion expected product','pending payload retained','ACL and fixed path'])assert.ok(sql.includes(label),label);
 assert.doesNotMatch(sql,/^\s*(?:BEGIN|COMMIT|ROLLBACK);/m);
});
test('RED classification binds the exact missing entrypoint, not any undefined dependency',()=>{
 const sql=read('tests/database/catalogue/po-reference-extraction.sql');
 assert.ok(sql.includes("failure_message IS DISTINCT FROM 'function private.catalog_por_extract_event_v1(regclass, text, jsonb, jsonb, jsonb) does not exist' THEN RAISE;"));
 assert.match(sql,/aclexplode/);
});
test('nested text JSON Unicode conversion errors produce the structured refusal envelope',()=>{
 const sql=need();assert.match(sql,/WHEN invalid_text_representation OR numeric_value_out_of_range OR untranslatable_character THEN/);
 assert.ok(read('tests/database/catalogue/po-reference-extraction.sql').includes('escaped NUL text JSON refused'));
});
test('source-known request and receipt cross-resource bindings survive as structured data',()=>{
 const sql=need(); for(const key of ["'visitId'","'scheduleId'","'poId'"])assert.ok(sql.includes(key),`Missing structured ${key} binding`);
 const suite=read('tests/database/catalogue/po-reference-extraction.sql');
 for(const label of ['legacy visit schedule binding','legacy sales visit binding','approval source PO binding','save delivery receipt binding','void delivery receipt binding','returned date receipt binding','cancel PO receipt binding','reject sales receipt binding'])assert.ok(suite.includes(label),label);
});
