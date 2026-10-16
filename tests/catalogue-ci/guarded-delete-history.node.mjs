// Static containment/source proof only. Runtime SQL must be composed into the fictional owner harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const fragment=()=>fs.readFileSync(path.join(root,'evidence/checked-write-plan/guarded-delete-history.fragment.sql'),'utf8');
test('trusted no-links checker has an owner-private target-only interface',()=>{
 const s=fragment();
 assert.match(s,/CREATE(?: OR REPLACE)? FUNCTION private\.catalog_assert_no_links_v1\(p_kind text,p_id uuid\) RETURNS void/);
 assert.match(s,/SECURITY DEFINER SET search_path = ''/);
 assert.match(s,/REVOKE ALL ON FUNCTION private\.catalog_assert_no_links_v1\(text,uuid\) FROM PUBLIC,anon,authenticated,service_role/);
 assert.doesNotMatch(s,/GRANT EXECUTE|UPDATE\s+private\.catalog_cutover_v1|ALTER TABLE\s+private\.catalog_cutover_v1|CREATE.*FUNCTION public\./i);
});
test('history collections include both audit sides and reviewed bounded extractors',()=>{
 const s=fragment();
 for(const n of ['catalog_por_extract_event_v1','catalog_extract_promotion_owner_event_v1','catalog_resolve_promotion_edges_v1','catalog_extract_visit_reference_event_v1','catalog_resolve_nonco_frozen_v1','catalog_extract_co_command_event_v1','catalog_extract_co_draft_event_v1','catalog_resolve_retired_co_line_v1'])assert.ok(s.includes(n),n);
 for(const n of ['po_items_revised','old_value','new_value','pilot_order_requests','pilot_store_owner_audit_v1','pilot_promotion_requests','pilot_visit_workflow_audit','co_audit_events','co_report_evidence','co_stock_keys','source_context','sources_snapshot'])assert.ok(s.includes(n),n);
});
test('unknown grammar topology and producer drift are stable private refusals',()=>{
 const s=fragment();
 for(const n of ['CATALOG_DELETE_BLOCKED','CATALOG_TRACKING_INCOMPLETE','pg_constraint','pg_attribute','pg_proc','execution_version','prosrc','md5'])assert.ok(s.includes(n),n);
 assert.match(s,/execution_version[^\n]*IN\s*\([^)]*1[^)]*2/);
 assert.match(s,/EXCEPTION WHEN OTHERS/);
 assert.doesNotMatch(s,/RAISE EXCEPTION[^;]*(?:SQLERRM|PG_EXCEPTION_DETAIL)/i);
});
test('semantic history fixture is supplied without claiming execution',()=>{
 const s=fs.readFileSync(path.join(root,'tests/database/catalogue/guarded-delete-history.sql'),'utf8');
 for(const n of ['OLD_ONLY_PO_ITEMS','MALFORMED_KNOWN_TEXT','UNKNOWN_EXECUTION_VERSION','UNKNOWN_TOPOLOGY','REMOVED_VISIT_PARENT','RETIRED_CO_LINE','UNRELATED_IDENTITY','OWNER_PRIVATE'])assert.ok(s.includes(n),n);
});

test('finite native schema and nullable history contracts include all business families',()=>{
 const s=fragment();
 const relations=JSON.parse(s.match(/\$manifest\$([\s\S]*?)\$manifest\$/)[1]);
 const required=JSON.parse(s.match(/\$required\$([\s\S]*?)\$required\$/)[1]);
 assert.equal(Object.keys(relations).length,51);
 assert.deepEqual(Object.keys(required).sort(),Object.keys(relations).sort());
 assert.ok(required['private.co_stock_keys'].includes('customer_id'));
 assert.ok(!required['private.co_stock_keys'].includes('product_id'),'historical/manual null product is not invented');
 assert.ok(required['private.catalog_target_requests_v1'].includes('fingerprint'));
 assert.equal(relations['public.orders'].outlet_id,'uuid');
 for(const word of ['relkind','relispartition','relpersistence','pg_inherits','attnotnull',"c.contype='p'"])assert.ok(s.includes(word),word);
});

test('exact typed FK graph covers direct masters and all retained composite CO edges',()=>{
 const s=fragment();const edges=JSON.parse(s.match(/\$fk\$([\s\S]*?)\$fk\$/)[1]);
 assert.equal(edges.length,110);assert.equal(new Set(edges.map(JSON.stringify)).size,110);
 assert.equal(edges.filter(e=>['public.customers','public.products'].includes(e[2])).length,13);
 assert.ok(edges.some(e=>e[0]==='private.co_stock_batches'&&e[2]==='private.co_delivery_revision_lines'&&e[7]&&e[8]));
 assert.ok(edges.some(e=>e[0]==='private.co_delivery_revision_lines'&&e[2]==='private.co_stock_batches'&&e[1].length===6));
 assert.match(s,/actual=expected/);
 assert.match(s,/catalogue_fictional_promotion_product_cascade_v2/);
});

test('every producer body pin also fixes security relevant execution metadata',()=>{
 const s=fragment();const pins=[...s.matchAll(/\('([^']+)','([a-f0-9]{32})','(\[[^']*\])'::jsonb\)/g)];
 assert.equal(pins.length,60);
 for(const pin of pins){const m=JSON.parse(pin[3]);assert.equal(m.length,8);assert.ok(['plpgsql','sql'].includes(m[0]));assert.equal(m[4],false);assert.equal(m[5],'u');}
 for(const token of ['proowner','prosecdef','provolatile','proisstrict','proleakproof','proparallel','pg_get_function_result','proconfig'])assert.ok(s.includes(token),token);
});

test('checker and typed collectors perform no business mutation, row/advisory/master lock, or authority grant',()=>{
 const executable=fragment().replace(/--[^\n]*/g,'');
 assert.doesNotMatch(executable,/\b(?:INSERT INTO|DELETE FROM|UPDATE public\.|UPDATE private\.|FOR UPDATE|FOR SHARE|pg_advisory|pg_try_advisory|LOCK TABLE|GRANT)\b/i);
 assert.match(executable,/CREATE FUNCTION private\.catalog_assert_history_contract_v1\(\) RETURNS void/);
 assert.match(executable,/catalog_product_delete_topology_v2\(\)/);
});

test('JSON extraction is grouped before subtracting schema adapter fields',()=>{
 const sql=fragment();const tokens=[...sql.matchAll(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|->>|->|#>>|#>|[A-Za-z_][A-Za-z0-9_]*|[()[\];-]/g)].filter(t=>!t[0].startsWith('--')&&!t[0].startsWith('/*'));
 const hazards=[];
 for(let i=0;i<tokens.length-2;i++)if(['->','->>','#>','#>>'].includes(tokens[i][0])&&tokens[i+1][0].startsWith("'")&&tokens[i+2][0]==='-')hazards.push(sql.slice(0,tokens[i].index).split('\n').length);
 assert.deepEqual(hazards,[]);
});

test('required columns include identity-implied NOT NULL but not generated-expression nullability',()=>{
 const source=fs.readFileSync(path.join(root,'supabase/migrations/20261009110001_co_foundation.sql'),'utf8');
 const required=JSON.parse(fragment().match(/\$required\$([\s\S]*?)\$required\$/)[1]);
 const identities=[];
 for(const table of source.matchAll(/CREATE TABLE\s+(private\.\w+)\s*\(([\s\S]*?)\n\);/g)){
  for(const column of table[2].matchAll(/\b(\w+)\s+\w+\s+GENERATED\s+(?:ALWAYS|BY DEFAULT)\s+AS IDENTITY\b/gi)){
   identities.push(`${table[1]}.${column[1]}`);
   assert.ok(required[table[1]].includes(column[1]),`${table[1]}.${column[1]} is implicitly NOT NULL`);
  }
 }
 assert.deepEqual(identities,['private.co_delivery_heads.original_creation_order']);
 assert.ok(!required['private.co_stock_keys'].includes('normalized_sku'),'generated expression does not imply NOT NULL');
 assert.ok(!required['private.co_sale_allocations'].includes('amount'),'generated expression does not imply NOT NULL');
});

test('lineage FK actions follow the final reviewed fixture overrides, not the minimal starting fixture',()=>{
 const source=fs.readFileSync(path.join(root,'tests/database/hosted-read-policy-fixture.sql'),'utf8');
 const edges=JSON.parse(fragment().match(/\$fk\$([\s\S]*?)\$fk\$/)[1]);
 const overrides=[...source.matchAll(/ALTER TABLE\s+(public\.\w+)\s+DROP CONSTRAINT\s+(\w+),\s*ADD CONSTRAINT\s+\2\s+FOREIGN KEY\((\w+)\) REFERENCES\s+(public\.\w+)\((\w+)\) ON DELETE CASCADE;/g)];
 assert.equal(overrides.length,2,'both final reviewed cascade overrides must be audited');
 for(const [,child,,column,parent,key] of overrides){
  const matches=edges.filter(e=>e[0]===child&&e[1].join(',')===column&&e[2]===parent&&e[3].join(',')===key);
  assert.deepEqual(matches,[[child,[column],parent,[key],'c','a','s',false,false,true]],`${child}.${column} exact final FK`);
 }
});

test('installed new10 carries the exact separately reviewed history fragment',()=>{
 const installed=fs.readFileSync(path.join(root,'supabase/catalogue/v1/new10-guarded-delete.sql'),'utf8');
 assert.ok(installed.includes(fragment()),'embedded history must match the reviewed artifact byte for byte');
});
