import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const sqlPath = path.join(root, 'supabase/catalogue/v1/new02-nonco-lineage-resolution.sql');
test('frozen visit resolver entrypoint exists', () => {
  assert.match(fs.readFileSync(sqlPath, 'utf8'), /CREATE FUNCTION private\.catalog_resolve_nonco_frozen_v1\(p_extraction jsonb,p_history jsonb\)/);
});
test('bounded immutable invoker and closed unsupported-kind refusal', () => {
 const s=fs.readFileSync(sqlPath,'utf8');
 assert.match(s,/IMMUTABLE SECURITY INVOKER SET search_path = ''/);
 assert.match(s,/UNSUPPORTED_LINEAGE_KIND/);
 assert.match(s,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.doesNotMatch(s,/\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|FOR UPDATE|pg_advisory|tracking_ready)\b/i);
});
test('all accepted visit expect bindings and scopes remain structured', () => {
 const s=fs.readFileSync(sqlPath,'utf8');
 for(const field of ['scheduleVersion','scheduledDate','requestVersion','requestKind','requestStatus','sourceScheduleId','baseVersion','approvedScheduleId','scheduleId','noteVersion','customerId','orderId']) assert.ok(s.includes("'"+field+"'"),field);
 assert.match(s,/jsonb_each\(edge->'expect'\)/);
 assert.match(s,/AMBIGUOUS_LINEAGE/);
 assert.match(s,/MISSING_LINEAGE/);
 assert.match(s,/catalog_vr_snapshot_v1/);
});
test('SQL semantic fixture is supplied, not claimed executed', () => {
 const s=fs.readFileSync(path.join(root,'tests/database/catalogue/nonco-lineage-resolution.sql'),'utf8');
 for(const name of ['OLD_ONLY','CONFLICT_SAME_VERSION','DANGLING','WRONG_SCOPE','UNKNOWN_EXPECT','VERSION_FIDELITY','UNSUPPORTED_PO','ALL_VISIT_EXPECTS']) assert.ok(s.includes(name),name);
});

test('public visit producer source pin remains exact', () => {
 assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/migrations/202610081102_demo_visit_workflow.sql'))).digest('hex'),'2bca74f51de8a6f29065ef9ab88451b0bee9eb7d1caea03cf3ce19fe739488ca');
});
test('v2 amendment source is one version/person witness without a customer equality', () => {
 const s=fs.readFileSync(sqlPath,'utf8');
 const start=s.indexOf('-- V2 amendment source tuple');
 assert.ok(start>=0);
 const block=s.slice(start,s.indexOf('-- A request',start));
 for(const key of ['source_schedule_id','base_version','requester_id','sales_person_id']) assert.ok(block.includes(key),key);
 assert.doesNotMatch(block,/outlet_id|customer_id/);
});
test('v2 every immutable visit field and schedule origin is retained', () => {
 const s=fs.readFileSync(sqlPath,'utf8');
 assert.ok(s.includes("previous->'row' - ARRAY['notes','note_version']"));
 assert.ok(s.includes("r - ARRAY['notes','note_version']"));
 assert.ok(s.includes("previous->'row'->'assigned_by'=r->'assigned_by'"));
 assert.ok(s.includes("previous->'row'->'created_at'=r->'created_at'"));
});
