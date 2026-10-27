import test from 'node:test'
import assert from 'node:assert/strict'
import {returnWorkspaceOptions,composeReturnFixture,runReturnWorkspace} from '../../../scripts/test-co-return-workspace-db.mjs'
test('fixed return runner rejects arbitrary cases/targets',()=>{
 assert.deepEqual(returnWorkspaceOptions(['--case','returns','--baseline','current']),{baselineName:'current'})
 for(const args of [[],['--case','https://host','--baseline','legacy'],['--case','returns','--baseline','production'],['--case','returns','--baseline','legacy','--url','host']])assert.throws(()=>returnWorkspaceOptions(args))
 let executed=false
 assert.throws(()=>runReturnWorkspace({env:{DATABASE_URL:'https://host'},sourceIdentity:()=>({clean:false}),execute:()=>{executed=true}}))
 assert.equal(executed,false,'guard rejects before any process or SQL')
})
test('composition requires fixed rollback fixture',()=>{
 const posting="BEGIN;\nSELECT 1;\nROLLBACK;\nSELECT 'CO_IMPORT_ATOMIC_POST_EDIT_PASSED';\n"
 assert.match(composeReturnFixture(posting,'SELECT 2;'),/SELECT 2;\nROLLBACK;/)
 assert.throws(()=>composeReturnFixture(posting,'COMMIT;'))
 assert.throws(()=>composeReturnFixture('SELECT 1;','SELECT 2;'))
})
test('runner proves installation parity and exact additive endpoint ACLs',async()=>{
 const {readFileSync}=await import('node:fs');const runner=readFileSync(new URL('../../../scripts/test-co-return-workspace-db.mjs',import.meta.url),'utf8');
 assert.match(runner,/return-workspace-parity\.sql/);assert.match(runner,/return-workspace-acl\.sql/);
 assert.match(runner,/Failed candidate leaves exact existing schema/);assert.match(runner,/Additive install preserves exact existing schema/);
 assert.match(runner,/CO_RETURN_WORKSPACE_INSTALL_PARITY_PASSED/);
});
test('new CI identity is exact and cannot impersonate old job/profile',async()=>{
 const {coWorkspaceConnection}=await import('../../../scripts/co-fixture-target.mjs');
 const source={clean:true,commit:'a'.repeat(40),tree:'b'.repeat(40)};
 // Pure validator input, not process.env and never passed to an SQL process.
 const env={PATH:'/usr/bin',CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'CO workspace runtime',GITHUB_JOB:'stock-return-sql',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'c'.repeat(40),CO_CI_SOURCE_SHA:source.commit,CO_CI_PROFILE:'github-co-return-workspace-v1',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'pilot_test',PGPASSWORD:'synthetic-ci-only'};
 assert.equal(coWorkspaceConnection(env,source).PGHOST,'127.0.0.1');
 for(const patch of [{GITHUB_JOB:'workspace-sql'},{GITHUB_JOB:'native-runtime'},{CO_CI_PROFILE:'github-co-workspace-v1'},{GITHUB_REPOSITORY:'other/repo'},{PGHOST:'hosted.example'},{DATABASE_URL:'postgres://hosted'},{CO_CI_SOURCE_SHA:'d'.repeat(40)}])assert.throws(()=>coWorkspaceConnection({...env,...patch},source));
 assert.equal(coWorkspaceConnection({...env,GITHUB_JOB:'workspace-sql',CO_CI_PROFILE:'github-co-workspace-v1'},source).PGPORT,'5432','existing exact SQL profile remains valid');
});
test('cross-server preflight is read-only normalized and source-bound',async()=>{
 const {readFileSync}=await import('node:fs');const file=new URL('./return-workspace-preflight.sql',import.meta.url);const sql=readFileSync(file,'utf8');
 assert.match(sql,/BEGIN READ ONLY;/);assert.match(sql,/source_sha256/);assert.match(sql,/attestation_sha256/);
 assert.doesNotMatch(sql,/FOR SHARE|FOR UPDATE|INSERT INTO|UPDATE private|DELETE FROM|ALTER TABLE|CREATE TABLE/);
 assert.match(sql,/Partial or already installed return workspace candidate/);
 const runner=readFileSync(new URL('../../../scripts/test-co-return-workspace-db.mjs',import.meta.url),'utf8');assert.match(runner,/CO_RETURN_WORKSPACE_PREFLIGHT/);
});
test('cross-server preflight includes transitive employee authority and schema',async()=>{
 const {readFileSync}=await import('node:fs');const sql=readFileSync(new URL('./return-workspace-preflight.sql',import.meta.url),'utf8');
 for(const name of ['employee_account_allowed(uuid)','employee_restricted(uuid)','employee_end_elapsed(date,timestamp with time zone)','private.employee_account_links','private.employee_records','private.employee_episodes'])assert.ok(sql.includes(name),name);
 assert.match(sql,/p\.proname LIKE 'employee/);assert.match(sql,/c\.relname LIKE 'employee/);
 assert.doesNotMatch(sql,/proargdefaults::text/,'no raw internal expression OIDs in cross-server hash');
});
test('preflight never sends zero-dimensional empty ACLs to aclexplode',async()=>{
 const {readFileSync}=await import('node:fs');const sql=readFileSync(new URL('./return-workspace-preflight.sql',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/aclexplode\(coalesce\(/,'unprotected empty ACL crashes PostgreSQL17');
 assert.match(sql,/aclexplode\(NULLIF\(a\.attacl,'\{\}'::aclitem\[\]\)\)/,'column NULL/empty means no explicit grants, not table/function defaults');
 assert.match(sql,/aclexplode\(NULLIF\(coalesce\(p\.proacl,acldefault\('f',p\.proowner\)\),'\{\}'::aclitem\[\]\)\)/);
 assert.match(sql,/aclexplode\(NULLIF\(coalesce\(r\.relacl,acldefault/);
});

test('ACL normalization regression executes before the preflight and candidate',async()=>{
 const {readFileSync}=await import('node:fs');const runner=readFileSync(new URL('../../../scripts/test-co-return-workspace-db.mjs',import.meta.url),'utf8');
 assert.ok(runner.indexOf("read('tests/database/co/return-workspace-acl-normalization.sql')")<runner.indexOf("read('tests/database/co/return-workspace-preflight.sql')"));
 assert.match(runner,/CO_RETURN_ACL_NORMALIZATION_PASSED/);
 const sql=readFileSync(new URL('./return-workspace-acl-normalization.sql',import.meta.url),'utf8');
 assert.match(sql,/BEGIN READ ONLY;/);assert.match(sql,/Explicit column grant or grant option lost/);assert.match(sql,/Empty object ACL incorrectly inherited defaults/);
});

test('both return profiles install the pinned workspace-read dependency before attestation',async()=>{
 const {readFileSync}=await import('node:fs');
 const {installReturnReadDependency}=await import('../../../scripts/test-co-return-workspace-db.mjs');
 const path='supabase/candidates/co-workspace-redesign/20261026101000_co_workspace_reads.sql';
 const sql=readFileSync(new URL('../../../'+path,import.meta.url),'utf8');
 for(const baseline of ['legacy','current']){
  const events=[];
  installReturnReadDependency({read:p=>{assert.equal(p,path);events.push('read');return sql},run:s=>{assert.equal(s,sql);events.push('install')},verify:()=>events.push('verify')});
  assert.deepEqual(events,['read','install','verify'],baseline);
 }
 let executed=false;
 assert.throws(()=>installReturnReadDependency({read:()=>sql+'-- drift',run:()=>{executed=true},verify:()=>{executed=true}}),/Workspace-read dependency changed/);
 assert.equal(executed,false);
 const runner=readFileSync(new URL('../../../scripts/test-co-return-workspace-db.mjs',import.meta.url),'utf8');
 assert.match(runner,/run\(read\('supabase\/candidates\/co-workspace-redesign\/20261026100000_co_import_manifest\.sql'\)\);verify\(\)\s+installReturnReadDependency\(\{read,run,verify\}\)\s+const normalization/,'dependency install is unconditional for both profiles, after import and before preflight');
 assert.match(sql,/CREATE FUNCTION public\.pilot_co_report_import_v1/);
});

test('late-install fault composition preserves PostgreSQL dollar quoting literally',async()=>{
 const {composeReturnInstallFailure}=await import('../../../scripts/test-co-return-workspace-db.mjs');
 const source="BEGIN;\nDO $$ BEGIN PERFORM 1; END $$;\nCOMMIT;\n";
 const actual=composeReturnInstallFailure(source);
 assert.equal(actual,"BEGIN;\nDO $$ BEGIN PERFORM 1; END $$;\nDO $$ BEGIN RAISE EXCEPTION 'Synthetic return install fault' USING ERRCODE='PZ702';END $$;\nCOMMIT;");
 assert.doesNotMatch(actual,/DO \$ BEGIN/);
 assert.throws(()=>composeReturnInstallFailure('BEGIN; SELECT 1;'),/Terminal candidate COMMIT required/);
});
