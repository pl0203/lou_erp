// Source containment and exact-body parity only; not a PostgreSQL pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {foundationTopLevelSql} from '../../scripts/catalogue-foundation.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const candidate=read('supabase/catalogue/v1/new07-lifetime-admission.sql');
const behavior=read('tests/database/catalogue/lifetime-admission.sql');
const manifest=JSON.parse(read('tests/catalogue-ci/fixtures/lifetime-writer-sources.json'));
function body(text,name){const m=[...text.matchAll(new RegExp('^CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('.','\\.')+'\\(','gm'))].at(-1);assert.ok(m,name);const a=text.indexOf('AS $$',m.index)+5,b=text.indexOf('END $$;',a)+4;return text.slice(a,b);}
const sha=x=>createHash('sha256').update(x).digest('hex');
test('remaining candidate and actual behavior are rollback harness fragments, never activation',()=>{
 assert.doesNotThrow(()=>foundationTopLevelSql(candidate));assert.doesNotThrow(()=>foundationTopLevelSql(behavior));
 assert.doesNotMatch(candidate,/(?:ALTER TABLE|UPDATE) private\.catalog_cutover_v1/);
 assert.match(candidate,/catalog_foundation_generation_one/);assert.match(candidate,/catalog_foundation_not_ready/);
 assert.match(body(candidate,'private.catalog_writer_admit_v2'),/generation<>2 OR NOT \(SELECT tracking_ready/);
 assert.doesNotMatch(candidate,/CREATE(?: OR REPLACE)? FUNCTION private\.co_(?:command|evidence)_begin_v1/);
});
test('all six legacy clones exactly preserve their final public composed source',()=>{
 for(const [family,m] of Object.entries(manifest)){
  let original=body(read(m.source),m.function);
  if(family==='promotion')original=original.replace('BEGIN\n role:=',"BEGIN\n -- co_access_boundary_v1: checked before any data read/replay.\n IF public.current_user_role() IS DISTINCT FROM 'executive'::public.user_role THEN RAISE EXCEPTION 'Module access denied' USING ERRCODE='42501'; END IF;\n role:=");
  assert.equal(sha(original),m.body_sha256,family+' source identity');
  assert.equal(body(candidate,'private.catalog_'+family+'_legacy_v1'),original,family+' exact legacy');
  const router=body(candidate,m.function);assert.match(router,/generation=1 THEN RETURN private\.catalog_/);assert.match(router,/,true\);/);
 }
});
test('restored reference extractors are byte-exact pinned public blobs, not rewritten grammar',()=>{
 const m=JSON.parse(read('tests/catalogue-ci/fixtures/lifetime-reference-sources.json'));
 for(const file of m.files.filter(f=>!f.path.includes('co-draft'))){
  const bytes=Buffer.from(read(file.path));assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex'),file.sha);
 }
 const assertions=body(candidate,'private.catalog_writer_assert_event_v2');
 assert.match(assertions,/catalog_extract_promotion_owner_event_v1/);assert.match(assertions,/catalog_extract_visit_reference_event_v1/);
 assert.match(assertions,/old_row-'execution_version',new_row-'execution_version'/);
});
test('PO fresh legacy admission holds common transaction drain but exact replay precedes it',()=>{
 const b=body(candidate,'private.demo_order_execution_fence');
 assert.ok(b.indexOf('AND r.result IS NOT NULL AND NOT r.abandoned) THEN RETURN NEW')<b.indexOf('catalog_writer_drain_v2()'));
 assert.match(b,/NEW.execution_version=0/);assert.match(b,/NEW.execution_version=1 AND generation<>1/);
 assert.match(body(candidate,'private.catalog_writer_drain_v2'),/WHERE singleton FOR SHARE/);
 assert.doesNotMatch(candidate,/ALTER COLUMN execution_version SET DEFAULT/);
});
test('evidence v2 is a separate command family and original shared legacy default stays one',()=>{
 const replay=body(candidate,'private.catalog_evidence_replay_v2');
 assert.match(replay,/NOT IN\('register_evidence','finalize_evidence'\)/);
 assert.ok(replay.indexOf('private.co_actor_v1()')<replay.indexOf('FROM private.co_commands'));
 assert.doesNotMatch(replay,/INSERT INTO|catalog_writer_enter|catalog_writer_admit|co_drafts|co_evidence WHERE/);
 const begin=body(candidate,'private.catalog_evidence_begin_v2');assert.match(begin,/status,execution_version/);assert.match(begin,/'pending',2/);assert.match(begin,/family='evidence'/);
 assert.doesNotMatch(candidate,/CREATE(?: OR REPLACE)? FUNCTION private\.catalog_co_replay_v2/);
 const fence=body(candidate,'private.catalog_co_execution_fence_v2');assert.match(fence,/family='evidence'/);assert.match(fence,/IS NOT TRUE/);
});
test('fresh cores enter after authorized committed replay and use complete final master seams',()=>{
 for(const family of ['promotion','schedule','visit','evidence','attest']){
  const b=body(candidate,'private.catalog_'+family+'_core_v2');
  const replay=family==='evidence'?'IF r IS NOT NULL THEN RETURN r;':family==='attest'?"RETURN jsonb_build_object('id',e.id,'state',CASE":'IF prior.result IS NOT NULL THEN RETURN prior.result;';
  assert.ok(b.indexOf(replay)>=0,family);assert.ok(b.indexOf(replay)<b.indexOf('catalog_writer_enter_v2'),family);
  assert.match(b,/catalog_writer_leave_v2\(\)/);
 }
 const visit=body(candidate,'private.catalog_visit_core_v2');assert.match(visit,/catalog_writer_master_phase_v2\(ARRAY\[s.outlet_id\],'\{\}'::uuid\[\],true\)/);
 assert.ok(visit.indexOf('catalog_writer_master_phase_v2')<visit.indexOf('INSERT INTO public.outlet_visits'));
 const phase=body(candidate,'private.catalog_writer_master_phase_v2');assert.ok(phase.indexOf('FOR NO KEY UPDATE')<phase.indexOf('LOCK TABLE private.catalog_identity_v1'));
 const evidence=body(candidate,'private.catalog_evidence_core_v2');assert.ok(evidence.indexOf('catalog_co_customer_phase_v2')<evidence.indexOf('FROM private.co_evidence WHERE id=e.id FOR UPDATE'));
 const attest=body(candidate,'private.catalog_attest_core_v2');assert.ok(attest.indexOf('catalog_evidence_master_phase_v2')<attest.indexOf('FROM private.co_evidence WHERE id=p_evidence_id FOR UPDATE'));
});
test('actual OLD NEW event assertions never lock or repair and retired source history is included',()=>{
 const b=body(candidate,'private.catalog_writer_assert_event_v2');assert.match(b,/to_jsonb\(OLD\)/);assert.match(b,/to_jsonb\(NEW\)/);
 assert.doesNotMatch(b,/FOR UPDATE|FOR SHARE|advisory|INSERT INTO|UPDATE private|DELETE FROM|catalog_writer_active_v2\(/);
 const collector=body(candidate,'private.catalog_schedule_source_customers_v2');assert.match(collector,/a.old_value->'schedule'/);assert.match(collector,/a.new_value->'schedule'/);assert.match(collector,/catalog_vr_snapshot_v1/);assert.match(collector,/Retained source schedule lineage required/);
 assert.match(body(candidate,'private.catalog_schedule_core_v2'),/ARRAY\[customer,s.outlet_id,r.customer_id,v.outlet_id\]\|\|private.catalog_schedule_source_customers_v2/);
});
test('raw admission is drain-only and direct product deletion retains original authorization and FKs',()=>{
 const raw=body(candidate,'private.catalog_raw_drain_v2');assert.match(raw,/catalog_writer_drain_v2/);assert.doesNotMatch(raw,/RAISE|execution_version|generation<>|catalog_writer_admit/);
 assert.doesNotMatch(candidate,/DROP POLICY|CREATE POLICY|ON DELETE CASCADE|DROP CONSTRAINT|CREATE(?: OR REPLACE)? FUNCTION private\.catalog_master_after_v1/);
 assert.match(candidate,/'public.customers','public.products','public.customer_targets'/);
});
test('authored actual-role suite calls each integrated real path and asserts authority plus rollback failures',()=>{
 for(const s of ['stage07 PO promotion authority remains denied before replay','schedule replacement preserves actual OLD and NEW customer evidence','actual photo completes the held schedule','deleted amendment source resolves retained workflow customers without breaking rejection','fresh evidence has explicit generation two not legacy shared default','real evidence finalization binds verified object to report draft','actual OLD-only removed customer cannot escape missing lifetime mark','unknown actual workflow snapshot fails closed','PO direct product deletion retains identity tombstone without CO unused rule'])assert.ok(behavior.includes(s),s);
 assert.match(behavior,/SET LOCAL ROLE service_role/);assert.match(behavior,/SET CONSTRAINTS ALL IMMEDIATE/);
});
test('fresh promotion binding checks do not reject the absent request row and ACL postflight is exhaustive',()=>{
 assert.match(body(candidate,'private.catalog_promotion_core_v2'),/prior.request_id IS NOT NULL AND \(prior.operation IS DISTINCT FROM p_operation/);
 assert.match(candidate,/DO \$complete_acl_postflight\$/);assert.match(candidate,/a.grantee<>f.proowner AND NOT/);assert.match(candidate,/a.grantee<>c.relowner/);
 assert.match(candidate,/f.proname='catalog_writer_active_v2' AND a.grantee=0/);
});

test('orphan lineage regression starts unknown through untouched legacy writers and marks both customers',()=>{
 const block=behavior.split('-- Seed an orphan amendment')[1].split('-- Evidence uses')[0];
 for(const name of ['pilot_assign_store_owner_v1','pilot_schedule_transaction_v1'])assert.ok(block.includes('public.'+name));
 assert.ok(block.includes("bool_and(lifetime_state='unknown')"));assert.ok(block.includes("bool_and(lifetime_state='used')"));
 for(const id of ['lifetime-customer-7','lifetime-customer-8'])assert.ok(block.includes(id));
 assert.equal((block.match(/pg_temp.catalog_writer_test_call/g)||[]).length,1);
});
