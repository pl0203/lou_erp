import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {foundationTopLevelSql} from '../../scripts/catalogue-foundation.mjs';
const sql=readFileSync(new URL('../database/catalogue/generation-two-routers.sql',import.meta.url),'utf8');
test('fictional public-router proof requires exact owner/session identity and subtransaction restoration',()=>{
 assert.match(sql,/PUBLIC_ROUTER_DISPATCH_ONLY/);
 for(const token of ["current_database()='pilot_catalogue_test'","session_user='postgres'","current_user='postgres'",'pg_temp.catalogue_foundation_session_v1',"ERRCODE='PGR02'","WHEN SQLSTATE 'PGR02'",'snapshot_after=snapshot_before','constraints_after=constraints_before',"execution_generation=1 AND NOT tracking_ready"])assert.ok(sql.includes(token),token);
 assert.equal((sql.match(/DROP CONSTRAINT catalog_foundation_generation_one/g)||[]).length,1);
 assert.equal((sql.match(/DROP CONSTRAINT catalog_foundation_not_ready/g)||[]).length,1);
 assert.ok(sql.indexOf('BEGIN\n  -- Owned fictional subtransaction')<sql.indexOf('DROP CONSTRAINT'));
 assert.ok(sql.indexOf('SET CONSTRAINTS ALL IMMEDIATE;',sql.indexOf('DROP CONSTRAINT'))<sql.indexOf("ERRCODE='PGR02'"));
 assert.doesNotThrow(()=>foundationTopLevelSql(sql));
 assert.doesNotMatch(sql,/\bCOMMIT\s*;|\bSAVEPOINT\b|^\\/m);
});
test('all eight routers execute as actual roles without a private-core or admission bypass',()=>{
 for(const name of ['pilot_order_transaction','pilot_co_transaction_v1','pilot_promotion_transaction_v1','pilot_assign_store_owner_v1','pilot_schedule_transaction_v1','pilot_finalize_visit','pilot_co_evidence_transaction_v1','pilot_co_evidence_attest_v1'])assert.ok(sql.includes('public.'+name+'('),name);
 for(const token of ['SET LOCAL ROLE authenticated','SET LOCAL ROLE service_role','row_security_active',"auth.uid()=actor","current_user='service_role'",'pg_backend_pid()=saved_pid','txid_current()=saved_xid','execution_version=2','legacy replay does not mark unknown identities','fresh public dispatch denied while fixture tracking is false'])assert.ok(sql.includes(token),token);
 assert.doesNotMatch(sql,/private\.catalog_\w*(?:core_v2|legacy_v1|enter_v2)\s*\(|p_admit|catalog_\w*_test_call|SECURITY DEFINER/);
});
test('router-only result cannot be confused with global cutover, raw compatibility or race certification',()=>{
 for(const token of ['NOT_GLOBAL_LIFETIME_CERTIFICATION','NO_RAW_COMPATIBILITY_PROOF','NO_LOADED_LEGACY_RETIREMENT_PROOF','NO_CONCURRENCY_PROOF','fixture generation one and false restored','all touched fictional rows restored','all private writer scopes empty'])assert.ok(sql.includes(token),token);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.|GRANT .* ON (?:TABLE )?(?:public|private)\./);
});
test('ledgerless owner dispatch cannot be masked by later schedule marking or legacy no-op',()=>{
 const owner=sql.indexOf('r_owner:=public.pilot_assign_store_owner_v1('),schedule=sql.indexOf('r_schedule:=public.pilot_schedule_transaction_v1(');
 const assertion=sql.indexOf('owner route marks before any schedule can mask legacy dispatch');
 assert.ok(owner>0 && assertion>owner && assertion<schedule);
 assert.ok(sql.includes('fresh ledgerless owner dispatch denied while fixture tracking is false'));
});
test('evidence family refusal uses exact receipt operation rather than an incidental mismatch',()=>{
 assert.match(sql,/format\('SELECT public\.pilot_co_transaction_v1\(%L::uuid,%L,%L::jsonb\)',md5\('router-register'\)::uuid,'register_evidence',p_register\),'22023'/);
});
test('all unused fixture identities and receipt-owner authority revocation are checked',()=>{
 const unused=sql.split("'unrelated and replay-only identities remain unknown'")[0].split("count(*)=").at(-1);
 assert.ok(unused.startsWith("5 AND bool_and(lifetime_state='unknown')"));assert.ok(unused.includes("md5('router-product-4')"));
 assert.ok(sql.includes('the original promotion receipt owner loses authority before replay'));
});
