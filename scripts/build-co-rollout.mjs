// Offline assembly only. No network, connection URL, credential lookup or apply path.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripMigrationTransaction } from './assemble-read-rollout.mjs'

export const CO_MIGRATIONS = [
  'supabase/migrations/20261009110000_co_role.sql',
  'supabase/migrations/20261009110001_co_foundation.sql',
  'supabase/migrations/20261009110002_co_orders_deliveries.sql',
  'supabase/migrations/20261009110003_co_monthly_fifo.sql',
  'supabase/migrations/20261009110004_co_returns_corrections.sql',
  'supabase/migrations/20261009110005_co_reads.sql',
  'supabase/migrations/20261009110006_co_reporting.sql',
  'supabase/migrations/20261009110007_co_access.sql',
  'supabase/migrations/20261009110008_co_evidence.sql',
]
export const CO_TARGET = Object.freeze({ projectRef: 'mqfpupsuthghubkeiuey', upstream: '75d38e55aa886386441597e8c22bb2fd90013565',
  snapshotSha256: '8a194cf3f041853dd7fa2e6ca957a8a641b2cd93b95a8a056357424240ffa87e',
  metadataReceiptSha256: 'f340355e8291c1a7f6bcad18838062e8f7138ff384dd5532d95d0b148b46e173',
  inventorySha256: '678c76253cf89c642ce2819efc2168218a9fc2d46f095021b4f117639b1e3bda',
  observedAt: '2026-10-10T01:18:23.717736Z',
})
export const coSha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function coInventoryPin(snapshot) {
  return Object.fromEntries(['inventory_version','intended_project_ref','complete','missing_required','pre_co_state_matches','pre_co_expected_absence','section_digests','function_pins','authority_relations','column_pins','user_role','storage_buckets','data_pins'].map(key => [key,snapshot[key]]))
}
export function coValidateTargetReceipt(snapshotBytes, metadataBytes) {
  assert.equal(coSha256(snapshotBytes), CO_TARGET.snapshotSha256, 'Pinned target snapshot hash drift; explicit review required')
  assert.equal(coSha256(metadataBytes), CO_TARGET.metadataReceiptSha256, 'Pinned branch/migration/Edge receipt hash drift')
  const snapshot = JSON.parse(snapshotBytes), metadata = JSON.parse(metadataBytes)
  assert.equal(snapshot.intended_project_ref,CO_TARGET.projectRef)
  assert.equal(snapshot.transaction_timestamp_utc,CO_TARGET.observedAt)
  assert.equal(snapshot.complete,true); assert.equal(snapshot.pre_co_state_matches,true)
  assert.equal(snapshot.function_pins.length,35); assert.equal(Object.keys(snapshot.section_digests).length,15)
  assert.equal(snapshot.data_pins.filter(x=>x.category==='protected').length,41)
  assert.equal(snapshot.data_pins.filter(x=>x.category==='authority').length,3)
  assert.equal(snapshot.observation.server_version_num,'170011')
  assert.equal(snapshot.observation.transaction_read_only,'on')
  assert.equal(snapshot.observation.transaction_isolation,'repeatable read')
  assert.equal(metadata.target,CO_TARGET.projectRef)
  const branch=JSON.parse(metadata.branch.structuredContent.content)
  assert.equal(branch.object.sha,CO_TARGET.upstream)
  const migrations=JSON.parse(metadata.migrations.content[0].text).migrations
  assert.deepEqual(migrations.map(x=>x.version),['20261009014122','20261009065443'])
  const edges=JSON.parse(metadata.edge_functions.content[0].text).functions
  assert.deepEqual(edges.map(x=>x.slug).sort(),['invite-user','promotion-image-url'])
  assert.ok(edges.every(x=>x.status==='ACTIVE'&&x.verify_jwt===true))
  return { snapshot, branch, migrations, edges }
}
export function coInventoryQuery(sql,{enumInstalled=false,entries=false}={}) {
  assert.equal(coSha256(sql),CO_TARGET.inventorySha256,'Inventory source drift requires a new reviewed contract')
  let query=sql.slice(sql.indexOf('\nWITH\n')+1).replace(/\nROLLBACK;\s*$/,'')
  if(enumInstalled) query=query.replace('WHERE e.enumtypid=t.oid)',"WHERE e.enumtypid=t.oid AND NOT (n.nspname='public' AND t.typname='user_role' AND e.enumlabel='co_admin'))")
  if(entries) {
    // Catalog-wide receipt digests remain exact. Only the delta projection makes
    // PostgreSQL-generated FK trigger names portable across disposable/hosted DBs.
    query=query.replace('section_names(section) AS',`portable_internal_trigger AS MATERIALIZED (
 SELECT r.identity||'.'||quote_ident(t.tgname) AS original_identity,
 r.identity||'.'||quote_ident(c.conname)||'.'||t.tgfoid::regprocedure::text||'.'||t.tgtype::text AS identity,
 jsonb_build_object('enabled',t.tgenabled,'internal',true,'type',t.tgtype,
 'deferrable',t.tgdeferrable,'initially_deferred',t.tginitdeferred,
 'function',t.tgfoid::regprocedure::text,
 'function_body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
 'constraint_sha256',encode(sha256(convert_to(pg_get_constraintdef(c.oid,false),'UTF8')),'hex')) AS metadata
 FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid AND t.tgisinternal
 JOIN pg_constraint c ON c.oid=t.tgconstraint JOIN pg_proc p ON p.oid=t.tgfoid
),
portable_entries AS MATERIALIZED (
 SELECT m.section,coalesce(t.identity,m.identity) AS identity,coalesce(t.metadata,m.metadata) AS metadata
 FROM metadata_entries m LEFT JOIN portable_internal_trigger t ON m.section='triggers' AND m.identity=t.original_identity
),
section_names(section) AS`)
    query=query.replace(') AS co_staging_inventory;',`) || jsonb_build_object('catalog_entries',(SELECT coalesce(jsonb_agg(jsonb_build_object('section',section,'identity',identity,'sha256',encode(sha256(convert_to(metadata::text,'UTF8')),'hex'),
 'body_sha256',metadata->'body_sha256','definition_sha256',metadata->'definition_sha256','using_sha256',metadata->'using_sha256',
 'preserved_sha256',CASE WHEN section='functions' THEN encode(sha256(convert_to((metadata->'catalog')::text,'UTF8')),'hex')
 WHEN section='policies' THEN encode(sha256(convert_to((metadata-'using_sha256')::text,'UTF8')),'hex') END) ORDER BY section COLLATE "C",identity COLLATE "C"),'[]') FROM portable_entries)) AS co_staging_inventory;`)
  }
  return query
}
export function coReadCommittedSources(repoRoot,candidateSha) {
  assert.match(candidateSha??'',/^[a-f0-9]{40}$/,'An immutable 40-character hexadecimal candidate commit is required')
  const git=args=>execFileSync('git',args,{cwd:repoRoot,env:{PATH:process.env.PATH},encoding:'utf8',maxBuffer:32*1024*1024,timeout:10000})
  assert.equal(git(['rev-parse','HEAD']).trim(),candidateSha,'Candidate must equal actual HEAD')
  assert.equal(git(['status','--porcelain','--untracked-files=normal']).trim(),'','Dirty source inputs refused')
  git(['merge-base','--is-ancestor',CO_TARGET.upstream,candidateSha])
  const paths=[...CO_MIGRATIONS,'scripts/co-preflight.sql','scripts/co-rollout-delta.json','scripts/build-co-rollout.mjs',
    'supabase/functions/_shared/co-evidence.ts','supabase/functions/co-evidence-upload/index.ts','supabase/functions/co-evidence-download/index.ts','supabase/functions/invite-user/index.ts',
    'supabase/functions/invite-user/deno.json','supabase/functions/invite-user/.npmrc','supabase/config.toml','package-lock.json','docs/co-rollout.md']
  const sources=paths.map(path=>{
    const sql=git(['show',`${candidateSha}:${path}`])
    assert.equal(readFileSync(join(repoRoot,path),'utf8'),sql,`Changed intended source: ${path}`)
    return {path,sql,sha256:coSha256(sql),blob:git(['rev-parse',`${candidateSha}:${path}`]).trim()}
  })
  return {commit:candidateSha,tree:git(['rev-parse',`${candidateSha}^{tree}`]).trim(),sources}
}

export function coCatalogDelta(before,after) {
  const index=entries=>{
    assert.ok(Array.isArray(entries),'Catalog entries required')
    const map=new Map()
    for(const entry of entries){
      assert.match(entry.sha256??'',/^[a-f0-9]{64}$/,'Catalog entry hash must be hexadecimal SHA256')
      assert.ok(typeof entry.section==='string'&&typeof entry.identity==='string','Portable catalog identity required')
      const key=entry.section+'\0'+entry.identity
      assert.ok(!map.has(key),'Duplicate catalog identity refused');map.set(key,entry)
    }
    return map
  }
  const left=index(before),right=index(after)
  return [...new Set([...left.keys(),...right.keys()])].sort().flatMap(key=>{
    const a=left.get(key),b=right.get(key)
    return a?.sha256===b?.sha256?[]:[{section:(a??b).section,identity:(a??b).identity,before:a?.sha256??null,after:b?.sha256??null}]
  })
}

export function coBindEnumReceipt(approval,receipts) {
  assert.ok(Array.isArray(receipts)&&receipts.length===1,'Exactly one read-back enum receipt required')
  const receipt=receipts[0]
  assert.match(receipt.version??'',/^[0-9]{14}$/,'Actual connector-assigned enum receipt version required')
  assert.ok(!['20261009014122','20261009065443'].includes(receipt.version),'Existing hosted receipt cannot be repurposed')
  assert.equal(receipt.name,approval.name,'Enum receipt name mismatch')
  for(const [field,expected] of [['source_sha256',approval.sourceSha256],['packet_sha256',approval.packetSha256],['statement_sha256',approval.packetSha256]]){
    assert.match(expected??'',/^[a-f0-9]{64}$/,'Approved enum hash required')
    assert.equal(receipt[field],expected,`Inconsistent enum receipt ${field}`)
  }
  assert.ok(Array.isArray(receipt.statements)&&receipt.statements.length>0&&receipt.statements.every(x=>typeof x==='string'),'Actual receipt statements required, not a matching name or claimed hash')
  assert.equal(coSha256(receipt.statements.join('\n')),approval.packetSha256,'Actual receipt statement bytes differ from the approved enum packet')
  return {...receipt}
}

const jsonLiteral = value => "'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb"
const textLiteral = value => "'"+value.replaceAll("'","''")+"'"
const baselineReceipts = [
 {version:'20261009014122',name:'reviewed_demo_release_atomic_20261009'},
 {version:'20261009065443',name:'unify_store_owner_credit'},
]
const pinKeys = Object.keys(coInventoryPin({}))
const pinExpression = alias => `jsonb_build_object(${pinKeys.flatMap(k=>[textLiteral(k),`${alias}->${textLiteral(k)}`]).join(',')})`
function receiptGuard(enumReceipt) {
 const expected=[...baselineReceipts,...(enumReceipt?[{version:enumReceipt.version,name:enumReceipt.name}]:[])].sort((a,b)=>a.version.localeCompare(b.version))
 return `DO $receipts$ DECLARE actual jsonb; statements_hash text; BEGIN
 IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'Migration receipt table missing'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version),'[]') INTO actual FROM supabase_migrations.schema_migrations;
 IF actual IS DISTINCT FROM ${jsonLiteral(expected)} THEN RAISE EXCEPTION 'Exact migration receipts drifted'; END IF;
 ${enumReceipt?`SELECT encode(sha256(convert_to(array_to_string(statements,E'\\n'),'UTF8')),'hex') INTO statements_hash FROM supabase_migrations.schema_migrations WHERE version=${textLiteral(enumReceipt.version)};
 IF statements_hash IS DISTINCT FROM ${textLiteral(enumReceipt.packet_sha256)} THEN RAISE EXCEPTION 'Enum receipt statement bytes drifted'; END IF;`:''}
 END $receipts$;`
}
function enumGuard(snapshot,installed) {
 const labels=[...snapshot.user_role.labels,...(installed?['co_admin']:[])]
 return `DO $enum$ BEGIN IF (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid='public.user_role'::regtype) IS DISTINCT FROM ${jsonLiteral(labels)} THEN RAISE EXCEPTION 'Exact enum stage mismatch'; END IF; END $enum$;`
}
function captureSql(inventory,name,enumInstalled) {
 return `CREATE TEMP TABLE ${name} ON COMMIT DROP AS ${coInventoryQuery(inventory,{enumInstalled,entries:true})}`
}
function baselineGuard(snapshot) {
 return `DO $baseline$ DECLARE observed jsonb; BEGIN
 SELECT co_staging_inventory INTO STRICT observed FROM pg_temp.co_packet_before;
 IF ${pinExpression('observed')} IS DISTINCT FROM ${jsonLiteral(coInventoryPin(snapshot))} THEN RAISE EXCEPTION 'Pinned target metadata/data baseline drift'; END IF;
 IF current_user<>'postgres' OR session_user<>'postgres' OR current_setting('server_version_num')<>'170011' THEN RAISE EXCEPTION 'Reviewed operator or PostgreSQL version drift'; END IF;
 END $baseline$;`
}
function forwardPostGuard(delta) {
 return `DO $postflight$
 DECLARE before_state jsonb; after_state jsonb; change jsonb; rule jsonb; old_entry jsonb; new_entry jsonb; observed_changes jsonb; expected_keys jsonb; observed_keys jsonb;
 BEGIN
 SELECT co_staging_inventory INTO STRICT before_state FROM pg_temp.co_packet_before;
 SELECT co_staging_inventory INTO STRICT after_state FROM pg_temp.co_packet_after;
 IF after_state->'complete'<>'true'::jsonb OR after_state->'missing_required'<>'[]'::jsonb THEN RAISE EXCEPTION 'Incomplete postflight'; END IF;
 IF after_state->'data_pins' IS DISTINCT FROM before_state->'data_pins' THEN RAISE EXCEPTION 'Protected/authority data changed'; END IF;
 IF after_state->'user_role' IS DISTINCT FROM before_state->'user_role' OR after_state->'column_pins' IS DISTINCT FROM before_state->'column_pins' THEN RAISE EXCEPTION 'Existing enum/required columns changed'; END IF;
 IF after_state->'storage_buckets'->'metadata' IS DISTINCT FROM (SELECT jsonb_agg(b ORDER BY b->>'id' COLLATE "C") FROM jsonb_array_elements((before_state->'storage_buckets'->'metadata')||'[{"id":"co-evidence","name":"co-evidence","public":false,"file_size_limit":10485760,"allowed_mime_types":["application/pdf","image/png","image/jpeg"]}]'::jsonb) b) THEN RAISE EXCEPTION 'Storage bucket delta mismatch'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('section',coalesce(l->>'section',r->>'section'),'identity',coalesce(l->>'identity',r->>'identity')) ORDER BY coalesce(l->>'section',r->>'section') COLLATE "C",coalesce(l->>'identity',r->>'identity') COLLATE "C"),'[]') INTO observed_keys
 FROM jsonb_array_elements(before_state->'catalog_entries') l FULL JOIN jsonb_array_elements(after_state->'catalog_entries') r ON l->>'section'=r->>'section' AND l->>'identity'=r->>'identity' WHERE l->>'sha256' IS DISTINCT FROM r->>'sha256';
 SELECT jsonb_agg(jsonb_build_object('section',d->>'section','identity',d->>'identity') ORDER BY d->>'section' COLLATE "C",d->>'identity' COLLATE "C") INTO expected_keys FROM jsonb_array_elements(${jsonLiteral(delta.delta)}) d;
 IF observed_keys IS DISTINCT FROM expected_keys THEN RAISE EXCEPTION 'Unexpected catalog delta identities'; END IF;
 FOR change IN SELECT * FROM jsonb_array_elements(${jsonLiteral(delta.delta)}) LOOP
  SELECT e INTO old_entry FROM jsonb_array_elements(before_state->'catalog_entries') e WHERE e->>'section'=change->>'section' AND e->>'identity'=change->>'identity';
  SELECT e INTO new_entry FROM jsonb_array_elements(after_state->'catalog_entries') e WHERE e->>'section'=change->>'section' AND e->>'identity'=change->>'identity';
  SELECT e INTO rule FROM jsonb_array_elements(${jsonLiteral(delta.legacyChanges)}) e WHERE e->>'section'=change->>'section' AND e->>'identity'=change->>'identity';
  IF rule IS NULL THEN
   IF old_entry IS NOT NULL OR new_entry->>'sha256' IS DISTINCT FROM change->>'after' THEN RAISE EXCEPTION 'Exact new object metadata drift: %',change->>'identity'; END IF;
  ELSE
   -- complete_catalog_metadata preserves owner, ACL, definer, volatility, settings and all other portable pg_proc fields.
   IF old_entry IS NULL OR new_entry IS NULL OR old_entry->>'preserved_sha256' IS NULL OR old_entry->>'preserved_sha256' IS DISTINCT FROM new_entry->>'preserved_sha256' OR NOT (old_entry @> (rule->'before')) OR NOT (new_entry @> (rule->'after')) THEN RAISE EXCEPTION 'Legacy semantic metadata/source drift: %',change->>'identity'; END IF;
  END IF;
 END LOOP;
 ${delta.newTables.map(t=>`IF EXISTS(SELECT 1 FROM ${t}) THEN RAISE EXCEPTION 'New CO table not empty: ${t}'; END IF;`).join('\n ')}
 END $postflight$;`
}

// Pure renderer shared with guarded synthetic tests. The release entrypoint below
// accepts only immutable Git sources and the two frozen target receipt hashes.
export function coRenderPackets({sources,inventory,snapshot,delta,enumReceipts}) {
 assert.deepEqual(sources.map(s=>s.path),CO_MIGRATIONS,'Exact source allowlist required')
 for(const s of sources)assert.equal(coSha256(s.sql),s.sha256,`Changed source bytes: ${s.path}`)
 assert.equal(snapshot.complete,true,'Complete target snapshot required')
 assert.deepEqual(Object.keys(delta.sourceHashes),CO_MIGRATIONS.slice(1),'Exact delta sources required')
 for(const s of sources.slice(1))assert.equal(s.sha256,delta.sourceHashes[s.path],`Source/delta drift: ${s.path}`)
 assert.equal(delta.legacyChanges.length,27);assert.equal(delta.newTables.length,24)
 const settings=inventory.slice(inventory.indexOf('SET LOCAL statement_timeout'),inventory.indexOf('\nWITH\n'))
 const locks=[...snapshot.data_pins.map(x=>x.name),'storage.buckets'].sort()
 assert.ok(locks.every(x=>/^(public|private|storage)\.[a-z_][a-z_0-9]*$/.test(x)),'Fixed relation identities required')
 const prelude=`\nBEGIN ISOLATION LEVEL REPEATABLE READ;\n${settings}\nLOCK TABLE ${locks.join(',')} IN SHARE MODE;\n`
 const enumSql=`-- Exact source ${sources[0].path} SHA256 ${sources[0].sha256}\n${prelude}${receiptGuard()}\n${enumGuard(snapshot,false)}\n${captureSql(inventory,'co_packet_before',false)}\n${baselineGuard(snapshot)}\n${stripMigrationTransaction(sources[0].sql,true)}\n${enumGuard(snapshot,true)}\n${captureSql(inventory,'co_packet_after',true)}\nDO $enum_post$ BEGIN IF (SELECT ${pinExpression('co_staging_inventory')} FROM pg_temp.co_packet_after) IS DISTINCT FROM (SELECT ${pinExpression('co_staging_inventory')} FROM pg_temp.co_packet_before) THEN RAISE EXCEPTION 'Enum-only metadata/data drift'; END IF; END $enum_post$;\nSELECT 'CO_ENUM_PACKET_PASSED';\nCOMMIT;\n`
 const enumApproval={name:'reviewed_co_role_20261009110000',sourceSha256:sources[0].sha256,packetSha256:coSha256(enumSql)}
 const receipt=enumReceipts===undefined?null:coBindEnumReceipt(enumApproval,enumReceipts)
 const forward=(binding)=>`${prelude}${binding?receiptGuard(binding):"DO $unarmed$ BEGIN RAISE EXCEPTION 'UNARMED: exact enum receipt required'; END $unarmed$;"}\n${enumGuard(snapshot,true)}\n${captureSql(inventory,'co_packet_before',true)}\n${baselineGuard(snapshot)}\n${sources.slice(1).map((s,i)=>`-- Exact fragment ${s.path} SHA256 ${s.sha256}\nSET LOCAL statement_timeout = '${i===4||i===7?120:60}s';\nSET LOCAL lock_timeout = '5s';\n${stripMigrationTransaction(s.sql,true)}`).join('\n')}\n${settings}\n${captureSql(inventory,'co_packet_after',true)}\n${enumGuard(snapshot,true)}\n${forwardPostGuard(delta)}\nSELECT 'CO_FORWARD_PACKET_PASSED';\nCOMMIT;\n`
 return {enumSql,enumApproval,forwardSql:receipt?forward(receipt):null,forwardReviewSql:forward(null),enumReceipt:receipt}
}

export function buildCoRollout({repoRoot,candidateSha,snapshotBytes,metadataBytes,enumReceipts}) {
 const source=coReadCommittedSources(repoRoot,candidateSha)
 const target=coValidateTargetReceipt(snapshotBytes,metadataBytes)
 const get=path=>source.sources.find(s=>s.path===path).sql
 const packets=coRenderPackets({sources:source.sources.filter(s=>CO_MIGRATIONS.includes(s.path)),inventory:get('scripts/co-preflight.sql'),snapshot:target.snapshot,delta:JSON.parse(get('scripts/co-rollout-delta.json')),enumReceipts})
 const descriptor={version:1,target:CO_TARGET,commit:source.commit,tree:source.tree,sources:source.sources.map(({path,sha256,blob})=>({path,sha256,blob})),existingReceipts:target.migrations,appliedOwnerSource:{source:'20261009061801',receipt:'20261009065443',sourceSha256:'117eba412ae0aeaef699f68ddfec9df7e1dc35d1cd0c49a462efb279dfc40057',replay:false},enumApproval:packets.enumApproval,enumReceipt:packets.enumReceipt,forwardArmed:packets.forwardSql!==null}
 return {...packets,manifest:{...descriptor,descriptorSha256:coSha256(JSON.stringify(descriptor)),files:{'enum.sql':coSha256(packets.enumSql),'forward-review.sql':coSha256(packets.forwardReviewSql),...(packets.forwardSql?{'forward.sql':coSha256(packets.forwardSql)}:{})}}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [candidateSha,snapshotPath,metadataPath,out,receiptPath,...extra]=process.argv.slice(2)
  assert.ok(candidateSha&&snapshotPath&&metadataPath&&out&&!extra.length,'Usage: node scripts/build-co-rollout.mjs EXACT_COMMIT SNAPSHOT METADATA OUTPUT_DIR [ENUM_READBACK_JSON]')
  const result=buildCoRollout({repoRoot:fileURLToPath(new URL('../',import.meta.url)),candidateSha,snapshotBytes:readFileSync(snapshotPath),metadataBytes:readFileSync(metadataPath),...(receiptPath?{enumReceipts:JSON.parse(readFileSync(receiptPath,'utf8'))}:{})})
  mkdirSync(out,{recursive:false})
  for(const [name,bytes] of [['enum.sql',result.enumSql],['forward-review.sql',result.forwardReviewSql],['manifest.json',JSON.stringify(result.manifest,null,2)+'\n'],...(result.forwardSql?[['forward.sql',result.forwardSql]]:[])])writeFileSync(join(out,name),bytes,{flag:'wx'})
  console.log(JSON.stringify({commit:result.manifest.commit,enumSha256:result.manifest.files['enum.sql'],forwardArmed:result.manifest.forwardArmed,output:out}))
 }catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1}
}

// Read-only evidence classification. Never retries an application. Observed is
// the exact normalized inventory (only co_admin removed), not a refreshed pin.
export function coReconcileEnum({approved,baseline,observed,labels,receipts}) {
 assert.deepEqual(coInventoryPin(observed),coInventoryPin(baseline),'Reconciliation metadata/data drift requires review')
 const original=baseline.user_role.labels
 if(JSON.stringify(labels)===JSON.stringify(original)&&receipts.length===0)return 'enum_not_applied'
 assert.deepEqual(labels,[...original,'co_admin'],'Reconciliation enum/receipt inconsistency')
 coBindEnumReceipt(approved,receipts)
 return 'enum_verified_forward_requires_separate_approval'
}
