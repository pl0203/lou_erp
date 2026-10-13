// @vitest-environment node
import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { coInventoryPin, coReadCommittedSources, coValidateTargetReceipt, CO_MIGRATIONS, coInventoryQuery, coCatalogDelta, coBindEnumReceipt, coSha256 } from '../../scripts/build-co-rollout.mjs'
const inventory = readFileSync('scripts/co-preflight.sql','utf8')
test('source allowlist contains only enum00 and forward01–08, never applied owner or fixtures', () => {
 expect(CO_MIGRATIONS).toHaveLength(9)
 expect(CO_MIGRATIONS[0]).toBe('supabase/migrations/20261009110000_co_role.sql')
 expect(CO_MIGRATIONS.join('\n')).not.toMatch(/20261009061801|fixture|20261009065443/)
})
test('inventory remains one bounded read-only transaction and safely handles missing catalog inputs', () => {
 expect(inventory).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;')
 expect(inventory).toContain("SET LOCAL statement_timeout = '60s'")
 expect(inventory.trim()).toMatch(/ROLLBACK;$/)
 expect(inventory).not.toMatch(/\bCREATE\s+(?:TEMP|FUNCTION|TABLE)|pg_authid|rolpassword/i)
 expect(inventory.match(/FROM aclexplode\(CASE WHEN cardinality/g)).toHaveLength(6)
 const query=coInventoryQuery(inventory,{enumInstalled:true,entries:true})
 expect(query).toContain('catalog_entries')
 expect(query).not.toContain('BEGIN ISOLATION')
 expect(query).not.toContain('ROLLBACK;')
 expect(query).toContain("e.enumlabel='co_admin'")
})
test('fingerprints omit clocks but retain all metadata, authority and duplicate-sensitive data pins', () => {
 const original:any={complete:true,pre_co_state_matches:true,section_digests:{roles:{sha256:'a'}},function_pins:[{signature:'x',body_sha256:'a'}],data_pins:[{name:'t',row_count:'2',content_sha256:'b'}],user_role:{labels:['executive']},transaction_timestamp_utc:'now'}
 expect(coInventoryPin({...original,transaction_timestamp_utc:'later'})).toEqual(coInventoryPin(original))
 for(const changed of [{complete:false},{section_digests:{}},{function_pins:[]},{data_pins:[{name:'t',row_count:'3',content_sha256:'b'}]},{user_role:{labels:['executive','co_admin']}}])expect(coInventoryPin({...original,...changed})).not.toEqual(coInventoryPin(original))
})
test('target receipt drift is refused rather than repinned', () => {
 expect(()=>coValidateTargetReceipt(Buffer.from('{}'),Buffer.from('{}'))).toThrow(/snapshot.*hash/i)
})
test.each(['HEAD','main','../bad','a'.repeat(39)])('immutable source refuses symbolic or malformed candidate %s', candidate => {
 expect(()=>coReadCommittedSources(process.cwd(),candidate)).toThrow(/40.*hex|immutable/i)
})
test('a committed source can never silently consume dirty intended worktree inputs', () => {
 // This pre-Task13 commit is immutable but is no longer the current tree once integration is committed.
 expect(()=>coReadCommittedSources(process.cwd(),'7b743bfe5282b0a3d3b6b394c56545cac0ee4a7c')).toThrow(/dirty|HEAD|source/i)
})

test('portable delta entries do not pin generated internal-trigger OIDs', () => {
 const query=coInventoryQuery(inventory,{entries:true})
 expect(query).toContain('portable_internal_trigger')
 expect(query).toContain('pg_get_constraintdef')
})


test('catalog delta pins additions, rewrites and removals without admitting unrelated objects', () => {
 const row=(section:string,identity:string,c:string)=>({section,identity,sha256:c.repeat(64)})
 const before=[row('functions','private.old()','a'),row('policies','public.users.rule','b'),row('roles','authenticated','c')]
 const after=[row('functions','private.old()','d'),row('relations','private.co_orders','e'),row('roles','authenticated','c')]
 expect(coCatalogDelta(before,after)).toEqual([
  {section:'functions',identity:'private.old()',before:'a'.repeat(64),after:'d'.repeat(64)},
  {section:'policies',identity:'public.users.rule',before:'b'.repeat(64),after:null},
  {section:'relations',identity:'private.co_orders',before:null,after:'e'.repeat(64)},
 ])
 expect(()=>coCatalogDelta([...before,before[0]],after)).toThrow(/duplicate/i)
 expect(()=>coCatalogDelta([row('functions','private.bad()','!')],after)).toThrow(/hash|hex/i)
})


const enumSql="BEGIN;\nALTER TYPE public.user_role ADD VALUE 'co_admin';\nCOMMIT;\n"
const enumApproval={sourceSha256:'a'.repeat(64),packetSha256:coSha256(enumSql),name:'reviewed_co_role_20261009110000'}
const enumReceipt={version:'20261010123456',name:enumApproval.name,source_sha256:enumApproval.sourceSha256,packet_sha256:enumApproval.packetSha256,statement_sha256:enumApproval.packetSha256,statements:[enumSql]}
test('only one exact read-back enum receipt can arm forward assembly',()=>{
 expect(coBindEnumReceipt(enumApproval,[enumReceipt])).toEqual(enumReceipt)
 for(const receipts of [[],[enumReceipt,enumReceipt],[{...enumReceipt,version:'guess'}],[{...enumReceipt,version:'20261009065443'}],[{...enumReceipt,name:'same-looking-role'}],[{...enumReceipt,source_sha256:'c'.repeat(64)}],[{...enumReceipt,packet_sha256:'c'.repeat(64)}],[{...enumReceipt,statement_sha256:'c'.repeat(64)}],[{...enumReceipt,statements:[]}],[{...enumReceipt,statements:[enumSql+'SELECT 1;']}]])expect(()=>coBindEnumReceipt(enumApproval,receipts)).toThrow()
 expect(()=>coBindEnumReceipt(enumApproval,[{version:enumReceipt.version,name:enumReceipt.name}])).toThrow()
})

test('forward metadata delta is an explicit source-pinned allowlist, never learned at apply time',()=>{
 const delta=JSON.parse(readFileSync('scripts/co-rollout-delta.json','utf8'))
 expect(delta.version).toBe(1);expect(delta.newTables).toHaveLength(24)
 expect(delta.delta).toHaveLength(935)
 expect(Object.keys(delta.sourceHashes)).toEqual(CO_MIGRATIONS.slice(1))
 for(const path of CO_MIGRATIONS.slice(1))expect(coSha256(readFileSync(path))).toBe(delta.sourceHashes[path])
 expect(delta.delta.filter((d:any)=>d.before!==null).every((d:any)=>d.section==='functions'||d.identity==='public.customers.pilot_customer_visibility')).toBe(true)
 expect(delta.delta.some((d:any)=>['roles','role_memberships','schemas','default_acls','enums'].includes(d.section))).toBe(false)
})

test('portable entry projection retains exact legacy semantic preservation and changed source fields',()=>{
 const query=coInventoryQuery(inventory,{entries:true})
 expect(query).toContain("'preserved_sha256'")
 expect(query).toContain("metadata->'catalog'")
 expect(query).toContain("metadata-'using_sha256'")
 expect(query).toContain("'body_sha256',metadata->'body_sha256'")
})
test('final source removes inherited service grants only from new CO objects except attestation',()=>{
 const source=readFileSync(CO_MIGRATIONS[8],'utf8')
 expect(source).toContain('DO $co_explicit_service_boundary$')
 expect(source).toContain("starts_with(p.proname,'co_')")
 expect(source).toContain("starts_with(p.proname,'pilot_co_')")
 expect(source).toContain("p.proname IN ('pilot_procurement_access_v1','pilot_sales_metrics_v2','pilot_sales_metric_months_v2')")
 expect(source).toContain("AND p.proname<>'pilot_co_evidence_attest_v1'")
 expect(source).toContain("REVOKE ALL ON FUNCTION %s FROM service_role")
 expect(source).toContain("REVOKE ALL ON TABLE %s FROM service_role")
 expect(source).toContain('REVOKE ALL ON SEQUENCE private.co_delivery_heads_original_creation_order_seq FROM service_role')
})

test('legacy transforms preserve target ACL and all semantic metadata rather than using local hashes',()=>{
 const spec=JSON.parse(readFileSync('scripts/co-rollout-delta.json','utf8'))
 expect(spec.legacyChanges).toHaveLength(27)
 expect(spec.legacyChanges.filter((x:any)=>x.section==='functions')).toHaveLength(26)
 expect(spec.legacyChanges.every((x:any)=>['complete_catalog_metadata','all_except_using'].includes(x.preserve))).toBe(true)
 for(const rule of spec.legacyChanges.filter((x:any)=>x.section==='functions')){
  expect(rule.before.body_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(rule.after.body_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(rule.after.definition_sha256).toMatch(/^[a-f0-9]{64}$/)
 }
})

test('packet assembler exposes separate enum and unarmed atomic forward, exact timeouts and no history write',async()=>{
 const {coRenderPackets}=await import('../../scripts/build-co-rollout.mjs')
 const sources=CO_MIGRATIONS.map(path=>({path,sql:readFileSync(path,'utf8'),sha256:coSha256(readFileSync(path))}))
 const snapshot={complete:true,user_role:{labels:['executive']},data_pins:[{name:'public.users'},{name:'private.pilot_store_owner_audit_v1'}]}
 const delta=JSON.parse(readFileSync('scripts/co-rollout-delta.json','utf8'))
 const packet=coRenderPackets({sources,inventory,snapshot,delta})
 expect(packet.enumSql).toContain('CO_ENUM_PACKET_PASSED')
 expect(packet.forwardSql).toBe(null)
 expect(packet.forwardReviewSql).toContain('UNARMED: exact enum receipt required')
 expect(packet.forwardReviewSql).toContain('CO_FORWARD_PACKET_PASSED')
 expect(packet.forwardReviewSql).toContain("SET LOCAL statement_timeout = '60s'")
 expect(packet.forwardReviewSql).toContain('complete_catalog_metadata')
 expect(packet.forwardReviewSql).not.toMatch(/(?:INSERT INTO|DELETE FROM|UPDATE) supabase_migrations|DROP DATABASE|UPDATE public.users/)
 expect(packet.forwardReviewSql.match(/\nBEGIN ISOLATION LEVEL REPEATABLE READ;/g)).toHaveLength(1)
 const receipt={...enumReceipt,name:packet.enumApproval.name,source_sha256:packet.enumApproval.sourceSha256,packet_sha256:packet.enumApproval.packetSha256,statement_sha256:packet.enumApproval.packetSha256,statements:[packet.enumSql]}
 const armed=coRenderPackets({sources,inventory,snapshot,delta,enumReceipts:[receipt]})
 expect(armed.enumSql).toBe(packet.enumSql)
 expect(armed.forwardSql).toContain(receipt.version)
 expect(armed.forwardSql).not.toContain('UNARMED:')
 expect(()=>coRenderPackets({sources:[{...sources[0],sql:sources[0].sql+'-- changed'},...sources.slice(1)],inventory,snapshot,delta})).toThrow(/source/i)
})

test('uncertain results cannot authorize replay from a missing or name-only receipt',async()=>{
 const {coReconcileEnum}=await import('../../scripts/build-co-rollout.mjs')
 const pin={complete:true,user_role:{labels:['executive']}}
 expect(coReconcileEnum({approved:enumApproval,baseline:pin,observed:pin,labels:['executive'],receipts:[]})).toBe('enum_not_applied')
 expect(coReconcileEnum({approved:enumApproval,baseline:pin,observed:pin,labels:['executive','co_admin'],receipts:[enumReceipt]})).toBe('enum_verified_forward_requires_separate_approval')
 for(const evidence of [{observed:{complete:false}},{labels:['executive','co_admin'],receipts:[]},{labels:['executive'],receipts:[enumReceipt]},{labels:['executive','co_admin'],receipts:[{name:enumReceipt.name,version:enumReceipt.version}]},{labels:['executive','co_admin','extra'],receipts:[enumReceipt]}])expect(()=>coReconcileEnum({approved:enumApproval,baseline:pin,observed:pin,labels:['executive'],receipts:[],...evidence})).toThrow(/reconciliation|receipt|drift|Exactly|Inconsistent/)
})

test('final audience checks enumerate every reviewed new object independently of naming prefixes',()=>{
 const delta=JSON.parse(readFileSync('scripts/co-rollout-delta.json','utf8'))
 const sql=readFileSync('tests/database/co/rollout.sql','utf8')
 for(const entry of delta.delta.filter((x:any)=>x.before===null&&['functions','relations'].includes(x.section)))expect(sql).toContain("'"+entry.identity+"'")
 expect(sql).not.toContain('starts_with')
})
