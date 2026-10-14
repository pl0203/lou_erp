// Static source checks only. These do not execute PostgreSQL semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root = new URL('../../', import.meta.url);
const candidate = new URL('supabase/catalogue/v1/02-co-reference-extraction.sql', root);
test('bounded CO command extractor exists', () => {
  assert.ok(existsSync(candidate), 'Missing bounded CO command extractor');
});
test('all six producer composition stages remain pinned', () => {
  const pins = {'supabase/migrations/20261009110001_co_foundation.sql': '23e1bba8ace0458918eb3f9b892c619851aee024eb4a53f008955c11160c0e9d', 'supabase/migrations/20261009110002_co_orders_deliveries.sql': 'd26610d5ffed5325369f21ed038078ed43a5c7b0c4834a8ed677fccf0d48cbaf', 'supabase/migrations/20261009110003_co_monthly_fifo.sql': 'b1388b07992fd3b2aeb4a844c3da326920b6981a6d970cb0413695bb9d175bb1', 'supabase/migrations/20261009110004_co_returns_corrections.sql': 'fe53057104ec61eb45f77701fac1ae8200a696abecee9a4fbc7403fd11d8f639', 'supabase/migrations/20261009110007_co_access.sql': '613579bcc348c7dadf77910beedd08ed88d88cad1a08f5d24b9870578c060fa6', 'supabase/migrations/20261009110008_co_evidence.sql': '2f012c59a546c183b006f3e9055f33f0886829dda3b164891a50050e3c527bb4'};
  for (const [path, digest] of Object.entries(pins)) assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'), digest, path);
});
test('extractor is pure, private, invoker and rejects unsupported families', () => {
  assert.ok(existsSync(candidate), 'Missing bounded CO command extractor');
  const sql = readFileSync(candidate,'utf8');
  const funcs = [...sql.matchAll(/CREATE FUNCTION (private\.[a-z0-9_]+)\([\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$;/g)];
  assert.equal(funcs.length, 2);
  for (const [definition,name,body] of funcs) {
    assert.match(definition,/IMMUTABLE SECURITY INVOKER SET search_path = ''/);
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${name}(`));
    const code = body.replace(/--[^\n]*/g,'').replace(/'(?:[^']|'')*'/g,"''");
    assert.doesNotMatch(code,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|LOCK|EXECUTE|nextval|setval|gen_random_uuid|set_config)\b/i);
    assert.doesNotMatch(code,/\b(?:FROM|JOIN)\s+(?:public|private|pg_catalog)\./i);
  }
  assert.match(sql,/FOREACH side IN ARRAY ARRAY\['OLD','NEW'\]/);
  assert.match(sql,/UNKNOWN_RELATION/);
  assert.match(sql,/CATALOGUE_CO_COMMAND_ACL_DRIFT/);
  assert.doesNotMatch(sql,/CREATE (?:TRIGGER|TABLE|POLICY)|GRANT\s+EXECUTE|tracking_ready/i);
});
test('SQL contract has exact output assertions and separate missing-function RED', () => {
  const sql = readFileSync(new URL('tests/database/catalogue/co-reference-extraction.sql',root),'utf8');
  assert.match(sql,/CATALOGUE_CO_COMMAND_MISSING_FUNCTION/);
  assert.match(sql,/actual IS DISTINCT FROM expected/);
  for (const label of ['operation target map','OLD and NEW constraints retained','pending emits no inferred references','abandoned emits no inferred references','unknown operation','receipt operation mismatch','numeric version refused','bigint overflow','unsupported relation','invalid event','unknown receipt key','missing receipt key','bad fingerprint','owner-only ACL']) assert.ok(sql.includes(label),label);
});

test('primitive dependency is pinned and declares every required helper', () => {
 const dependency = readFileSync(new URL('supabase/catalogue/v1/02-promotion-owner-extraction.sql',root),'utf8');
 assert.equal(createHash('sha256').update(dependency).digest('hex'), 'd53ad17d77fbafbf8542c29fbcd04a3b3457916d296d0f2bf28df78a1389affc');
 for (const name of ['catalog_po_require_v1','catalog_po_keys_v1','catalog_po_uuid_v1','catalog_po_sorted_refs_v1']) assert.ok(dependency.includes('CREATE FUNCTION private.'+name+'('),name);
});
