import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildReturnCurrentFixture} from '../../../scripts/co-return-current-schema.mjs';
const base=()=>readFileSync(new URL('../fixture.sql',import.meta.url),'utf8');
test('fixed current fixture preserves five native column contracts before any migrations',()=>{
 const sql=buildReturnCurrentFixture(base());
 assert.match(sql,/CREATE SCHEMA extensions/);assert.match(sql,/CREATE EXTENSION.*"uuid-ossp" WITH SCHEMA extensions/);assert.match(sql,/CREATE EXTENSION.*pgcrypto WITH SCHEMA extensions/);
 const table=name=>sql.match(new RegExp('CREATE TABLE public\\.'+name+'\\([^\\n]+'))[0];
 assert.ok(table('users').indexOf('created_at')<table('users').indexOf('manager_id'));
 assert.ok(table('customers').indexOf('phone')<table('customers').indexOf('created_at'));assert.ok(table('customers').indexOf('created_at')<table('customers').indexOf('address'));assert.match(table('customers'),/CONSTRAINT suppliers_pkey PRIMARY KEY/);
 assert.ok(table('products').indexOf('created_at')<table('products').indexOf('harga_pokok'));
 assert.match(table('customer_sales_rep_assignments'),/assigned_at timestamptz DEFAULT now\(\)/);
 for(const n of ['users','customer_manager_assignments','customer_sales_rep_assignments'])assert.match(table(n),/ON DELETE CASCADE/);
 assert.ok(sql.includes('FICTIONAL, MINIMAL TEST CONTRACT'));
});
test('fixed fixture rejects changed base bytes and never writes real records',()=>{
 assert.throws(()=>buildReturnCurrentFixture(base()+'\n'),/source changed/);
 const sql=buildReturnCurrentFixture(base());
 assert.equal((sql.match(/CREATE TABLE public\.(?:users|customers|products|customer_manager_assignments|customer_sales_rep_assignments)\(/g)||[]).length,5);
});
test('current schema profile is opt-in and fixed to the dedicated return job',()=>{
 const core=readFileSync(new URL('../../../scripts/test-co-ci.mjs',import.meta.url),'utf8');
 assert.ok(core.includes("fixtureProfile = 'minimal'"));
 assert.ok(core.includes("fixtureProfile === 'return-current'"));
 assert.ok(core.includes("'github-co-return-workspace-v1'"));
 const runner=readFileSync(new URL('../../../scripts/test-co-return-workspace-db.mjs',import.meta.url),'utf8');
 assert.ok(runner.includes("fixtureProfile:baselineName==='current'?'return-current':'minimal'"));
 assert.ok(runner.indexOf('installReturnCurrentFunctions({read,run,verify})')<runner.indexOf('const before='));
});
test('finite current ACL/policy reconstruction keeps restrictive guards and candidate boundary',()=>{
 const sql=readFileSync(new URL('./return-current-schema-finalize.sql',import.meta.url),'utf8');
 assert.equal((sql.match(/^GRANT EXECUTE ON FUNCTION /gm)||[]).length,34);
 assert.equal((sql.match(/ TO service_role;/g)||[]).length,27);
 assert.equal((sql.match(/ TO authenticated;/g)||[]).length,7);
 assert.doesNotMatch(sql,/DROP POLICY (?:pilot_|co_procurement)|ALTER DEFAULT PRIVILEGES|GRANT .*ALL FUNCTIONS|CREATE OR REPLACE/);
 assert.match(sql,/to_regclass\('private.co_return_workspace_requests'\) IS NOT NULL/);
 for(const policy of ['users_read_all','users_update_own','executive_manage_users','cma_read','csra_read','csra_write'])assert.ok(sql.includes('CREATE POLICY '+policy));
});
test('unknown or non-dedicated current profiles reject before connection or source access',async()=>{
 const {runCoCi}=await import('../../../scripts/test-co-ci.mjs');
 let touched=0;const options={env:{},execute:()=>{touched++;throw Error('must not execute')},sourceIdentity:()=>{touched++;throw Error('must not inspect source')}};
 assert.throws(()=>runCoCi({...options,fixtureProfile:'unapproved'}),/Unknown fixed fixture profile/);
 assert.throws(()=>runCoCi({...options,fixtureProfile:'return-current'}),/dedicated CI profile/);
 assert.equal(touched,0);
});
