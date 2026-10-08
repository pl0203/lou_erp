// Isolated disposable database only. Never invokes hosted PostgreSQL or reads credentials.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn,spawnSync,execFileSync } from 'node:child_process'
import { buildDemoPreflight,buildDemoRollout,reconcileDemoRollout } from '../../scripts/build-demo-rollout.mjs'
import { stripMigrationTransaction } from '../../scripts/assemble-read-rollout.mjs'
import { demoFixtureConnection,bindDemoCiServer,DEMO_CI_IDENTITY_SQL } from '../../scripts/demo-rollout-fixture-target.mjs'
import { fixtureSql,sources } from './rollout-fixture.mjs'
const connection=demoFixtureConnection(process.env,process.env.DEMO_ROLLOUT_PERMIT==='disposable-demo-rollout-ci'?execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim():undefined)
let target=connection.target
const env=connection.env
const sql=(text,database=target.database)=>{
 const r=spawnSync('psql',['-X','--no-password','-qAt','--set=ON_ERROR_STOP=1'],{env:{...env,PGDATABASE:database},input:text,encoding:'utf8',timeout:20000})
 if(r.error)throw r.error
 if(r.status!==0)throw new Error(r.stderr)
 return r.stdout.trim()
}
const oneJson=text=>JSON.parse(sql(text).split('\n').at(-1))
const capture=(columns)=>oneJson(buildDemoPreflight({target,columns}))
const hash=v=>createHash('sha256').update(v).digest('hex')
const manifestFor=s=>({version:1,status:'synthetic',upstream:'18ec064e43466dc8b567482a628b3ef91f886ce4',sources:s.map(s=>({path:s.path,sha256:hash(s.sql),commit:'1'.repeat(40)}))})
if(target.kind==='fixture-ci') {
 const observed=JSON.parse(sql(DEMO_CI_IDENTITY_SQL,'pilot_test').split('\n').at(-1))
 target=bindDemoCiServer(target,observed)
}
// Validate the separate empty database before any fixture DDL. No reset or reuse is allowed.
assert.equal(sql(`SELECT current_database()='demo_rollout_test' AND current_user='postgres' AND inet_server_addr()='${target.kind==='fixture-ci'?target.serverAddress:target.host}'::inet AND inet_server_port()=${target.kind==='fixture-ci'?target.serverPort:target.port} AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND c.relkind IN('r','p'));`),'t')
sql(fixtureSql)
if(target.kind==='fixture-ci') sql(`UPDATE public.demo_rollout_fixture_marker SET run_id='${target.ci.runId}',source_sha='${target.ci.sourceSha}';`)

const before=capture()
// Rehearse only inside a transaction rolled back by this synthetic test; never a hosted discovery apply.
const rehearsal=oneJson(`BEGIN;\n${sources.map(s=>stripMigrationTransaction(s.sql,true)).join('\n')}\n${buildDemoPreflight({target,columns:before.columns}).replace('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n','').replace('ROLLBACK;\nDROP TABLE pg_temp.demo_columns,pg_temp.demo_data,pg_temp.demo_new_data;\n','')}ROLLBACK;`)
const changes=[...new Set([...Object.keys(before.schema),...Object.keys(rehearsal.schema)])].filter(k=>before.schema[k]!==rehearsal.schema[k]).map(key=>({key,before:before.schema[key]??null,after:rehearsal.schema[key]??null,reason:'Explicit synthetic metadata delta'}))
const build=(s=sources,baseline=before,schemaChanges=changes)=>{const manifest=manifestFor(s);return buildDemoRollout({repoRoot:process.cwd(),target,baseline,sources:s,manifest,manifestSha256:hash(JSON.stringify(manifest)),schemaChanges})}

const unchanged=()=>{const after=capture(); assert.equal(after.data_md5,before.data_md5);assert.equal(after.schema_md5,before.schema_md5)}
// A matching reviewed-looking before/after hash cannot authorize an old generic column grant.
const observeInTransaction=body=>oneJson(`BEGIN;\n${body}\n${buildDemoPreflight({target,columns:before.columns}).replace('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n','').replace('ROLLBACK;\nDROP TABLE pg_temp.demo_columns,pg_temp.demo_data,pg_temp.demo_new_data;\n','')}ROLLBACK;`)
const granted=observeInTransaction('GRANT SELECT(id) ON public.purchase_orders TO PUBLIC;')
const aclKey='column:public.purchase_orders.id'
assert.notEqual(granted.schema[aclKey],before.schema[aclKey])
const columnGrant=sources.map((s,i)=>i?s:{...s,sql:s.sql.replace('COMMIT;','GRANT SELECT(id) ON public.purchase_orders TO PUBLIC;\nCOMMIT;')})
assert.throws(()=>build(columnGrant,before,[...changes,{key:aclKey,before:before.schema[aclKey],after:granted.schema[aclKey],reason:'Matching old-column grant delta'}]),/Protected existing generic column/)
unchanged();console.log('DEMO_ROLLOUT_ENUMERATED_OLD_COLUMN_ACL_REFUSED')
// The exact five additions still pass; a new-column grant fails despite matching metadata.
const addedGrant=sources.map((s,i)=>i?s:{...s,sql:s.sql.replace('COMMIT;','GRANT SELECT(product_id) ON public.po_line_items TO PUBLIC;\nCOMMIT;')})
const addedState=observeInTransaction(addedGrant.map(s=>stripMigrationTransaction(s.sql,true)).join('\n'))
const addedChanges=changes.map(c=>c.key==='column:public.po_line_items.product_id'?{...c,after:addedState.schema[c.key]}:c)
assert.throws(()=>sql(build(addedGrant,before,addedChanges).sql),/Unapproved generic additive column metadata\/ACL/)
unchanged();console.log('DEMO_ROLLOUT_ADDITIVE_COLUMN_ACL_BOUND')

const packet=build()
assert.throws(()=>sql(build(sources,{...before,data_md5:'0'.repeat(32)}).sql),/Approved baseline fingerprint drift/);unchanged()
console.log('DEMO_ROLLOUT_BASELINE_DRIFT_REFUSED')
// The later body fails only after earlier additive work has run. Every addition rolls back.
const later=sources.map((s,i)=>i!==3?s:{...s,sql:s.sql.replace('COMMIT;',()=>"DO $$ BEGIN RAISE EXCEPTION 'synthetic later failure'; END $$;\nCOMMIT;")})
assert.throws(()=>sql(build(later).sql),/synthetic later failure/);unchanged()
console.log('DEMO_ROLLOUT_LATER_FAILURE_ATOMIC_ROLLBACK')
// A legacy ledger writer holds a real ROW EXCLUSIVE lock. Zero unresolved committed rows is insufficient.
const writer=spawn('psql',['-X','--no-password','-qAt','--set=ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']})
let writerOutput=''; writer.stdout.on('data',b=>writerOutput+=b)
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Writer readiness timeout')),5000);writer.stdout.on('data',()=>{if(writerOutput.includes('writer-held')){clearTimeout(timer);resolve()}});writer.on('error',reject)})
writer.stdin.write("BEGIN; UPDATE private.pilot_order_requests SET payload=payload WHERE id='old-request'; SELECT 'writer-held';\n")
await ready
try { assert.throws(()=>sql(packet.sql),/could not obtain lock/); }
finally { writer.stdin.end('ROLLBACK;\n'); await new Promise(resolve=>writer.on('exit',resolve)) }
unchanged();console.log('DEMO_ROLLOUT_ACTIVE_OLD_WRITER_REFUSED')
// A reviewed source hash alone does not authorize a business data mutation.
const mutating=sources.map((s,i)=>i?s:{...s,sql:s.sql.replace('COMMIT;',"UPDATE private.pilot_order_requests SET result='{}' WHERE id='old-request';\nCOMMIT;")})
assert.throws(()=>sql(build(mutating).sql),/Protected old-column data changed/);unchanged()
console.log('DEMO_ROLLOUT_OLD_PAYLOAD_RECEIPTS_PRESERVED')

const stockBackfill=sources.map((s,i)=>i?s:{...s,sql:s.sql.replace('COMMIT;',"UPDATE public.promotions SET remaining_quantity=9;\nCOMMIT;")})
assert.throws(()=>sql(build(stockBackfill).sql),/Unapproved additive business values/);unchanged()
console.log('DEMO_ROLLOUT_ADDITIVE_BACKFILL_REFUSED')

const unreviewed=sources.map((s,i)=>i!==3?s:{...s,sql:s.sql.replace('COMMIT;',()=>"ALTER FUNCTION public.untouched() SECURITY DEFINER;\nCOMMIT;")})
assert.throws(()=>sql(build(unreviewed).sql),/Unreviewed schema\/function\/RLS\/ACL delta/);unchanged()
const opening=sources.map((s,i)=>i?s:{...s,sql:s.sql.replace('COMMIT;',"INSERT INTO private.pilot_promo_movements VALUES(1);\nCOMMIT;")})
assert.throws(()=>sql(build(opening).sql),/New business\/ledger table is not empty/);unchanged()
const publicBucket=sources.map((s,i)=>i!==3?s:{...s,sql:s.sql.replace("'promotion-images',false","'promotion-images',true")})
assert.throws(()=>sql(build(publicBucket).sql),/Expected private promotion-images bucket required/);unchanged()
console.log('DEMO_ROLLOUT_METADATA_NEW_LEDGER_BUCKET_GUARDS')
const receipt=oneJson(packet.sql)
assert.equal(receipt.result,'DEMO_ROLLOUT_COMMITTED');assert.equal(receipt.source_manifest_sha256,packet.sourceManifestSha256)
assert.equal(receipt.data_md5,before.data_md5)
const committed=capture(before.columns)
assert.equal(committed.data_md5,before.data_md5)
assert.equal(reconcileDemoRollout(packet,committed).status,'COMMITTED_STATE_VERIFIED')
assert.throws(()=>sql(packet.sql),/Approved baseline fingerprint drift/)
assert.equal(capture(before.columns).schema_md5,committed.schema_md5)
console.log('DEMO_ROLLOUT_COMMIT_READBACK_REAPPLY_REFUSED')


// Isolate changed-bucket rejection before any new-family business/ledger writes.
assert.ok(Object.values(committed.new_tables).every(table=>table.present && table.rows===0 && (table.unresolved_requests===null || table.unresolved_requests===0)))
assert.equal(reconcileDemoRollout(packet,committed).status,'COMMITTED_STATE_VERIFIED')
sql("UPDATE storage.buckets SET public=true WHERE id='promotion-images';")
const changedBucket=capture(before.columns)
assert.deepEqual(changedBucket.new_tables,committed.new_tables)
assert.equal(changedBucket.data_md5,committed.data_md5)
assert.equal(changedBucket.schema_md5,committed.schema_md5)
assert.equal(reconcileDemoRollout(packet,changedBucket).status,'REVIEW_REQUIRED')
sql("UPDATE storage.buckets SET public=false WHERE id='promotion-images';")
assert.equal(reconcileDemoRollout(packet,capture(before.columns)).status,'COMMITTED_STATE_VERIFIED')
console.log('DEMO_ROLLOUT_CHANGED_BUCKET_READBACK_REFUSED')

// Committed new-family tombstones/proposals can leave every old protected row unchanged.
sql('INSERT INTO private.pilot_visit_requests(id,result,abandoned) VALUES(41,NULL,true);')
const tombstone=capture(before.columns)
assert.equal(tombstone.data_md5,before.data_md5);assert.equal(tombstone.schema_md5,committed.schema_md5)
assert.deepEqual(tombstone.new_tables['private.pilot_visit_requests'],{present:true,rows:1,unresolved_requests:0})
assert.deepEqual(reconcileDemoRollout(packet,tombstone).status,'REVIEW_REQUIRED')
sql('INSERT INTO public.visit_requests(id) VALUES(42); INSERT INTO private.pilot_schedule_requests(id,result,abandoned) VALUES(42,NULL,false);')
const proposal=capture(before.columns)
assert.equal(proposal.data_md5,before.data_md5);assert.equal(proposal.schema_md5,committed.schema_md5)
assert.equal(proposal.new_tables['public.visit_requests'].rows,1)
assert.equal(proposal.new_tables['private.pilot_schedule_requests'].unresolved_requests,1)
assert.deepEqual(reconcileDemoRollout(packet,proposal).status,'REVIEW_REQUIRED')
console.log('DEMO_ROLLOUT_NEW_ONLY_WRITES_AND_UNRESOLVED_READBACK_REFUSED')
