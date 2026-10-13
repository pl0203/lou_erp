/** Packet generation only: no connections, execution, retry, publication or rollback. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stripMigrationTransaction } from './assemble-read-rollout.mjs'
import { verifyDemoFixtureTarget,fixtureServerGuard } from './demo-rollout-fixture-target.mjs'
export { verifyDemoFixtureTarget } from './demo-rollout-fixture-target.mjs'

export const DEMO_PROJECT = 'mqfpupsuthghubkeiuey'
export const DEMO_MIGRATIONS = Object.freeze([
 '202610081101_demo_order_promotions.sql','202610081102_demo_visit_workflow.sql',
 '202610081103_demo_sales_reporting.sql','202610081104_demo_sales_assignment_cardinality.sql',
].map(name => `supabase/migrations/${name}`))
export const DEMO_TABLES = Object.freeze([
 'users','customers','products','customer_manager_assignments','customer_sales_rep_assignments',
 'customer_targets','sales_targets','sales_schedules','outlet_visits','visit_photos',
 'purchase_orders','po_line_items','po_audit_log','promotions','girard_orders','girard_order_items',
 'surat_jalan','sj_line_items','outlets','orders','order_line_items',
].map(name => `public.${name}`).concat(['private.pilot_order_requests','storage.objects','storage.buckets']))
export const DEMO_NEW_TABLES = Object.freeze({
 'private.pilot_promotion_requests':true,'private.pilot_promo_slices':false,'private.pilot_promo_movements':false,
 'private.pilot_schedule_requests':true,'private.pilot_visit_requests':true,'public.visit_requests':false,'private.pilot_visit_workflow_audit':false,
})
const genericAdditions = new Set(['public.purchase_orders.sales_person_id_at_creation','public.purchase_orders.sales_assignment_source_id','public.purchase_orders.sales_attributed_at','public.purchase_orders.sales_attribution_state','public.po_line_items.product_id'])
export const DEMO_BUCKET = Object.freeze({name:'promotion-images',public:false,file_size_limit:5242880,allowed_mime_types:['image/jpeg','image/png','image/webp']})
const sha256 = value => createHash('sha256').update(value).digest('hex')
const literal = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${literal(JSON.stringify(value))}::jsonb`
const validHash = (value, size=32) => typeof value==='string' && new RegExp(`^[a-f0-9]{${size}}$`).test(value)
const sorted = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))))
const snapshotQuery = readFileSync(new URL('./demo-rollout-snapshot.sql',import.meta.url),'utf8').trim().replace(/;$/,'')
const protectedSources = JSON.parse(readFileSync(new URL('./demo-rollout-protected-sources.json',import.meta.url),'utf8'))

function targetGuard(target) {
 if(['fixture','fixture-ci'].includes(target?.kind)) verifyDemoFixtureTarget(target)
 else if(target?.kind!=='hosted'||target.database!=='postgres'||target.operator!=='postgres'
 ||target.projectRef!==DEMO_PROJECT||target.verifiedProjectRef!==DEMO_PROJECT) {
  throw new Error('Exact independently verified project mqfpupsuthghubkeiuey / postgres / postgres required')
 }
 return `-- Project label is not identity proof. Verify the execution destination independently.\nDO $target$ BEGIN
 IF current_database()<>${literal(target.database)} OR current_user<>'postgres' THEN RAISE EXCEPTION 'Reviewed database/operator required'; END IF;
 ${target.kind==='hosted'?'':fixtureServerGuard(target)}
END $target$;\n`
}
const setup = target => `SET LOCAL search_path='';\nSET LOCAL TIME ZONE 'UTC';\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\n${targetGuard(target)}`
function columnsSetup(columns) {
 if(columns) return `CREATE TEMP TABLE demo_columns AS SELECT key AS relation,value AS columns FROM jsonb_each(${json(columns)});\n`
 return `CREATE TEMP TABLE demo_columns AS SELECT r.relation,jsonb_agg(a.attname ORDER BY a.attnum) AS columns
 FROM unnest(ARRAY[${DEMO_TABLES.map(literal)}]) r(relation)
 JOIN pg_attribute a ON a.attrelid=r.relation::regclass AND a.attnum>0 AND NOT a.attisdropped
 WHERE r.relation<>'public.users' OR a.attname IN('id','role','is_active','manager_id') GROUP BY r.relation;\n`
}
const dataTable = 'CREATE TEMP TABLE demo_data(relation text PRIMARY KEY,rows bigint,content_md5 text);\nCREATE TEMP TABLE demo_new_data(relation text PRIMARY KEY,present boolean,rows bigint,unresolved_requests bigint);\n'
const captureData = `DELETE FROM pg_temp.demo_data;
DO $capture$ DECLARE r record; projection text; row_count bigint; fingerprint text; BEGIN
 FOR r IN SELECT * FROM pg_temp.demo_columns ORDER BY relation LOOP
  SELECT string_agg(format('r.%I',value),',' ORDER BY ordinality) INTO projection FROM jsonb_array_elements_text(r.columns) WITH ORDINALITY;
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(md5(jsonb_build_array(%s)::text),'''' ORDER BY md5(jsonb_build_array(%s)::text)),'''')) FROM %s r %s',projection,projection,r.relation::regclass,CASE WHEN r.relation='storage.buckets' THEN 'WHERE r.id<>''promotion-images''' ELSE '' END) INTO row_count,fingerprint;
  INSERT INTO pg_temp.demo_data VALUES(r.relation,row_count,fingerprint);
 END LOOP;
END $capture$;
DELETE FROM pg_temp.demo_new_data;
DO $new_tables$ DECLARE r record; row_count bigint; unresolved bigint; BEGIN
 FOR r IN SELECT key AS relation,value::boolean AS requests FROM jsonb_each_text(${json(DEMO_NEW_TABLES)}) LOOP
  IF to_regclass(r.relation) IS NULL THEN
   INSERT INTO pg_temp.demo_new_data VALUES(r.relation,false,NULL,NULL);
  ELSE
   EXECUTE format('SELECT count(*)%s FROM %s',CASE WHEN r.requests THEN ',count(*) FILTER(WHERE result IS NULL AND NOT abandoned)' ELSE ',NULL::bigint' END,r.relation::regclass) INTO row_count,unresolved;
   INSERT INTO pg_temp.demo_new_data VALUES(r.relation,true,row_count,unresolved);
  END IF;
 END LOOP;
END $new_tables$;\n`
const snapshot = name => `${captureData}CREATE TEMP TABLE ${name} AS ${snapshotQuery};\n`
const lockedTables = `LOCK TABLE ${DEMO_TABLES.join(',')} IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n`

/** Repeatable read-only observation. The apply rechecks everything under write-draining locks. */
export function buildDemoPreflight({target,columns}={}) {
 if(columns) validateColumns(columns)
 return `${columnsSetup(columns)}${dataTable}BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${setup(target)}${captureData}${snapshotQuery};\nROLLBACK;\nDROP TABLE pg_temp.demo_columns,pg_temp.demo_data,pg_temp.demo_new_data;\n`
}
function validateColumns(columns) {
 if(!columns||JSON.stringify(Object.keys(columns).sort())!==JSON.stringify([...DEMO_TABLES].sort())) throw new Error('Complete protected old-column inventory required')
 for(const [relation,names] of Object.entries(columns)) {
  if(!Array.isArray(names)||!names.length||new Set(names).size!==names.length||names.some(n=>typeof n!=='string'||!/^[a-z_][a-z_0-9]*$/.test(n))) throw new Error('Invalid protected column inventory')
  if(relation==='public.users'&&JSON.stringify([...names].sort())!==JSON.stringify(['id','is_active','manager_id','role'])) throw new Error('Only minimal authority fields may be read from users')
 }
}
function approvedSources({repoRoot,sources,manifest,manifestSha256,target}) {
 if(!manifest||!validHash(manifestSha256,64)||sha256(JSON.stringify(manifest))!==manifestSha256) throw new Error('Reviewed source manifest hash mismatch')
 if(manifest.version!==1||manifest.upstream!==protectedSources.upstream||!['reviewed','synthetic'].includes(manifest.status)
 || (target.kind==='hosted'&&manifest.status!=='reviewed')) throw new Error('Final reviewed source manifest required; synthetic manifests are fixture-only')
 if(!Array.isArray(manifest.sources)||manifest.sources.length!==4) throw new Error('Exactly four source manifest entries required')
 for(const source of protectedSources.sources) if(sha256(readFileSync(resolve(repoRoot,source.path)))!==source.sha256) throw new Error(`Protected HR/reset/baseline source drift: ${source.path}`)
 const actual=sources??DEMO_MIGRATIONS.map(path=>({path,sql:readFileSync(resolve(repoRoot,path),'utf8')}))
 if(!Array.isArray(actual)||actual.length!==4) throw new Error('Exactly four migration sources required')
 return actual.map((source,i)=>{
  const pin=manifest.sources[i]
  if(source.path!==DEMO_MIGRATIONS[i]||pin.path!==source.path||!validHash(pin.commit,40)) throw new Error('Reviewed migration source order/commit mismatch')
  if(!validHash(pin.sha256,64)||sha256(source.sql)!==pin.sha256) throw new Error(`Pinned source hash mismatch: ${source.path}`)
  return {...pin,body:stripMigrationTransaction(source.sql,true)}
 })
}
function expectedMetadata(baseline,changes) {
 if(!baseline.schema||typeof baseline.schema!=='object'||Array.isArray(baseline.schema)||!Array.isArray(changes)) throw new Error('Reviewed metadata inventory/deltas required')
 const expected={...baseline.schema}, seen=new Set()
 for(const change of changes) {
  if(!change||typeof change.key!=='string'||seen.has(change.key)||typeof change.reason!=='string'||!change.reason.trim()
  ||!((change.before===null||validHash(change.before))&&(change.after===null||validHash(change.after)))
  ||change.before===change.after||(baseline.schema[change.key]??null)!==change.before) throw new Error('Invalid or stale enumerated metadata delta')
  // HR/auth/role/default-grant changes are outside this release even if listed.
  if(/^(?:table|policy):public\.(?:purchase_orders|po_line_items|po_audit_log|surat_jalan|sj_line_items)(?:\.|$)/.test(change.key)) throw new Error('Protected generic PO/SJ/audit RLS/ACL delta forbidden')
  if(/^column:public\.(?:purchase_orders|po_line_items|po_audit_log|surat_jalan|sj_line_items)\./.test(change.key)) {
   if(change.before!==null) throw new Error('Protected existing generic column metadata/ACL delta forbidden')
   if(!genericAdditions.has(change.key.slice('column:'.length))||change.after===null) throw new Error('Unapproved generic additive column')
  }
  if(/(?:^role:|^membership:|^default_acl:|^auth_uid:|ihr_|leave_)/i.test(change.key)) throw new Error('Protected HR/auth metadata delta forbidden')
  if(change.after===null) delete expected[change.key]; else expected[change.key]=change.after
  seen.add(change.key)
 }
 return expected
}
export function buildDemoRollout(options) {
 const {target,baseline,schemaChanges,manifestSha256}=options
 targetGuard(target)
 const sources=approvedSources(options)
 if(!baseline||baseline.database!==target.database||baseline.operator!=='postgres'||!validHash(baseline.data_md5)||!validHash(baseline.schema_md5)
 ||!newTableProof(baseline.new_tables,false)||baseline.promotion_bucket!==null||baseline.unresolved_requests!==0||!Number.isSafeInteger(baseline.pending_girard)||baseline.pending_girard<0
 ||(target.kind==='hosted'&&baseline.pending_girard!==2)) throw new Error('Reviewed baseline fingerprints, pending inventory and zero unresolved requests required')
 validateColumns(baseline.columns)
 const expectedSchema=expectedMetadata(baseline,schemaChanges)
 const before=`${setup(target)}${lockedTables}${columnsSetup()}${dataTable}
${snapshot('demo_before')}
DO $before$ BEGIN
 IF (SELECT state->>'data_md5' FROM pg_temp.demo_before) IS DISTINCT FROM ${literal(baseline.data_md5)}
 OR (SELECT state->>'schema_md5' FROM pg_temp.demo_before) IS DISTINCT FROM ${literal(baseline.schema_md5)}
 OR (SELECT state->'schema' FROM pg_temp.demo_before) IS DISTINCT FROM ${json(baseline.schema)}
 OR (SELECT state->'columns' FROM pg_temp.demo_before) IS DISTINCT FROM ${json(baseline.columns)}
 OR (SELECT (state->>'pending_girard')::bigint FROM pg_temp.demo_before)<>${baseline.pending_girard}
 OR (SELECT (state->>'unresolved_requests')::bigint FROM pg_temp.demo_before)<>0 THEN RAISE EXCEPTION 'Approved baseline fingerprint drift'; END IF;
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='promotion-images') THEN RAISE EXCEPTION 'Promotion bucket already exists; reconcile before apply'; END IF;
END $before$;\n`
 let transactionSql=`BEGIN;\n${before}`
 const fragments=[]
 for(const source of sources){
  const startByte=Buffer.byteLength(transactionSql)
  transactionSql+=source.body
  fragments.push({path:source.path,sourceSha256:source.sha256,bodySha256:sha256(source.body),startByte,endByte:Buffer.byteLength(transactionSql)})
  transactionSql+='\n'
 }
 transactionSql+=`SET LOCAL search_path='';\nSET LOCAL TIME ZONE 'UTC';\n${snapshot('demo_after')}
DO $after$ DECLARE r record; populated boolean; BEGIN
 IF (SELECT state->'data' FROM pg_temp.demo_before) IS DISTINCT FROM (SELECT state->'data' FROM pg_temp.demo_after) THEN RAISE EXCEPTION 'Protected old-column data changed'; END IF;
 IF (SELECT state->'schema' FROM pg_temp.demo_after) IS DISTINCT FROM ${json(expectedSchema)} THEN RAISE EXCEPTION 'Unreviewed schema/function/RLS/ACL delta'; END IF;
 IF (SELECT state->'promotion_bucket' FROM pg_temp.demo_after) IS DISTINCT FROM ${json(DEMO_BUCKET)} THEN RAISE EXCEPTION 'Expected private promotion-images bucket required'; END IF;
 IF (SELECT (state->>'generic_additions_ok')::boolean FROM pg_temp.demo_after) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Unapproved generic additive column metadata/ACL'; END IF;
 IF (SELECT (state->>'additive_defaults_ok')::boolean FROM pg_temp.demo_after) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Unapproved additive business values'; END IF;
 -- Every new business/ledger table starts empty. No opening stock or historical conversion.
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','private') AND c.relkind IN('r','p') AND NOT (${json(baseline.schema)} ? ('table:'||n.nspname||'.'||c.relname)) LOOP
  IF NOT (${json(DEMO_NEW_TABLES)} ? (r.nspname||'.'||r.relname)) THEN RAISE EXCEPTION 'New table outside reviewed inventory'; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I)',r.nspname,r.relname) INTO populated;
  IF populated THEN RAISE EXCEPTION 'New business/ledger table is not empty'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_temp.demo_new_data WHERE NOT present OR rows IS DISTINCT FROM 0 OR coalesce(unresolved_requests,0)<>0) THEN RAISE EXCEPTION 'Complete empty new-table proof required'; END IF;
END $after$;
NOTIFY pgrst,'reload schema';
COMMIT;\n`
 // Reuse the vetted lexer over the completed transaction, preserving every source byte.
 stripMigrationTransaction(transactionSql,true)
 const transactionSha256=sha256(transactionSql)
 const receiptSql=`SELECT jsonb_build_object('result','DEMO_ROLLOUT_COMMITTED','source_manifest_sha256',${literal(manifestSha256)},'transaction_sha256',${literal(transactionSha256)},'migrations',${json(options.manifest.sources)},'protected_data',state->'data','data_md5',state->>'data_md5','schema_md5',state->>'schema_md5','new_tables',state->'new_tables','generic_additions_ok',state->'generic_additions_ok','promotion_bucket',state->'promotion_bucket','additive_defaults_ok',state->'additive_defaults_ok','pending_girard',state->'pending_girard','unresolved_requests',state->'unresolved_requests') AS demo_rollout_receipt FROM pg_temp.demo_after;\n`
 const sql=transactionSql+receiptSql
 return {sql,transactionSql,transactionSha256,assembledSha256:sha256(sql),fragments,sourceManifestSha256:manifestSha256,manifest:options.manifest,baseline,expectedSchema,schemaChanges,newTables:DEMO_NEW_TABLES,
  readbackSql:buildDemoPreflight({target,columns:baseline.columns})}
}
function newTableProof(proof,present) {
 if(!proof||JSON.stringify(Object.keys(proof).sort())!==JSON.stringify(Object.keys(DEMO_NEW_TABLES).sort())) return false
 return Object.entries(DEMO_NEW_TABLES).every(([table,requests])=>proof[table]?.present===present&&proof[table].rows===(present?0:null)&&proof[table].unresolved_requests===(present&&requests?0:null))
}
/** An uncertain call is never replayed here. Readback must use the verified same target. */
export function reconcileDemoRollout(packet,observed) {
 if(observed?.database!==packet.baseline.database||observed?.operator!=='postgres') return {status:'REVIEW_REQUIRED',reapply:false}
 const preserved=observed.data_md5===packet.baseline.data_md5&&observed.pending_girard===packet.baseline.pending_girard&&observed.unresolved_requests===0
 const baseline=preserved&&newTableProof(observed.new_tables,false)&&observed.promotion_bucket===null&&observed.schema_md5===packet.baseline.schema_md5
 if(baseline) return {status:'BASELINE_INTACT',reapply:false,action:'Confirm the prior session ended, refresh preflight and review before a new apply'}
 if(preserved&&newTableProof(observed.new_tables,true)&&observed.generic_additions_ok===true&&observed.additive_defaults_ok===true&&observed.promotion_bucket&&sorted(observed.promotion_bucket)===sorted(DEMO_BUCKET)&&observed.schema&&sorted(observed.schema)===sorted(packet.expectedSchema)) return {status:'COMMITTED_STATE_VERIFIED',reapply:false,sourceManifestSha256:packet.sourceManifestSha256,transactionSha256:packet.transactionSha256}
 return {status:'REVIEW_REQUIRED',reapply:false,action:'Keep writes paused; reconcile metadata and current data before compatible forward recovery'}
}

/** Validate the final bytes again immediately before a separately authorized execution. */
export function assertDemoRollout({sql,...options}) {
 const packet=buildDemoRollout(options)
 if(sql!==packet.sql) throw new Error('Final rollout artifact differs from the reviewed assembly')
 return {assembledSha256:packet.assembledSha256,transactionSha256:packet.transactionSha256,sourceManifestSha256:packet.sourceManifestSha256}
}
