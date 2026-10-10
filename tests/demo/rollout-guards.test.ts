// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createHistoricalProtectedRoot } from './historical-protected-root.mjs'
let historical: ReturnType<typeof createHistoricalProtectedRoot>
beforeAll(() => { historical = createHistoricalProtectedRoot() })
afterAll(() => historical?.cleanup())
import { DEMO_MIGRATIONS, DEMO_TABLES, DEMO_NEW_TABLES, buildDemoPreflight, buildDemoRollout, reconcileDemoRollout, verifyDemoFixtureTarget } from '../../scripts/build-demo-rollout.mjs'
const hash = (text:string) => createHash('sha256').update(text).digest('hex')
const sources = [0,1,2,3].map(i => ({ path: `supabase/migrations/${['202610081101_demo_order_promotions.sql','202610081102_demo_visit_workflow.sql','202610081103_demo_sales_reporting.sql','202610081104_demo_sales_assignment_cardinality.sql'][i]}`, sql: `-- source ${i}\nBEGIN;\nSELECT ${i};\nCOMMIT;\n` }))
const target = { kind:'fixture', host:'127.0.0.1', port:65443, database:'demo_rollout_test', operator:'postgres', permit:'disposable-demo-rollout' }
const manifest = { version:1, status:'synthetic', upstream:'18ec064e43466dc8b567482a628b3ef91f886ce4', sources:sources.map(s=>({path:s.path,sha256:hash(s.sql),commit:'1'.repeat(40)})) }
const baseline = { database:'demo_rollout_test', operator:'postgres', data_md5:'1'.repeat(32), schema_md5:'2'.repeat(32), pending_girard:2, unresolved_requests:0, promotion_bucket:null, new_tables:Object.fromEntries(Object.keys(DEMO_NEW_TABLES).map(r=>[r,{present:false,rows:null,unresolved_requests:null}])), columns:Object.fromEntries(DEMO_TABLES.map(r=>[r,r==='public.users'?['id','role','is_active','manager_id']:['id']])), schema:{"function:public.changed()":"a".repeat(32)} }
const inputs = () => ({repoRoot:historical.root, sources, target, manifest, manifestSha256:hash(JSON.stringify(manifest)), baseline, schemaChanges:[{key:"function:public.changed()",before:"a".repeat(32),after:"b".repeat(32),reason:"Reviewed replacement"}] })
test('pins the exact ordered four reviewed sources before atomic assembly', () => {
 const packet=buildDemoRollout(inputs())
 expect(DEMO_MIGRATIONS).toEqual(sources.map(s=>s.path))
 expect(packet.sourceManifestSha256).toBe(hash(JSON.stringify(manifest)))
 expect(packet.sql).toContain('NOWAIT')
 expect(packet.sql).toContain('Protected old-column data changed')
 expect(packet.sql.lastIndexOf('DEMO_ROLLOUT_COMMITTED')).toBeGreaterThan(packet.sql.lastIndexOf('COMMIT;'))
 expect(packet.fragments).toHaveLength(4)
 for(const f of packet.fragments) expect(hash(Buffer.from(packet.transactionSql).subarray(f.startByte,f.endByte).toString())).toBe(f.bodySha256)
 expect(()=>buildDemoRollout({...inputs(),manifestSha256:'f'.repeat(64)})).toThrow(/manifest/i)
 expect(()=>buildDemoRollout({...inputs(),sources:[...sources].reverse()})).toThrow(/order|source/i)
 expect(()=>buildDemoRollout({...inputs(),sources:sources.map((s,i)=>i? s : {...s,sql:s.sql+'SELECT 8;\n'})})).toThrow(/hash/i)
})
test.each(['COMMIT;','ROLLBACK;','SAVEPOINT escape;','START TRANSACTION;','\\include bad.sql'])('rejects transaction escape %s despite a matching source hash', escape => {
 const altered=sources.map((s,i)=>i?s:{...s,sql:`BEGIN;\n${escape}\nSELECT 0;\nCOMMIT;\n`})
 const pinned={...manifest,sources:altered.map(s=>({path:s.path,sha256:hash(s.sql),commit:'1'.repeat(40)}))}
 expect(()=>buildDemoRollout({...inputs(),sources:altered,manifest:pinned,manifestSha256:hash(JSON.stringify(pinned))})).toThrow()
})
test('requires exact independent hosted identity and prevents fixture network redirection',()=>{
 expect(()=>buildDemoPreflight({target:{kind:'hosted',database:'postgres',operator:'postgres'}})).toThrow(/project/i)
 expect(()=>buildDemoPreflight({target:{kind:'hosted',database:'postgres',operator:'postgres',projectRef:'aaaaaaaaaaaaaaaaaaaa',verifiedProjectRef:'aaaaaaaaaaaaaaaaaaaa'}})).toThrow(/project/i)
 expect(()=>buildDemoRollout({...inputs(),target:{kind:'hosted',database:'postgres',operator:'postgres',projectRef:'mqfpupsuthghubkeiuey',verifiedProjectRef:'mqfpupsuthghubkeiuey'}})).toThrow(/synthetic|reviewed/i)
 expect(verifyDemoFixtureTarget(target)).toBeUndefined()
 for(const override of [{host:'db.example.com'},{database:'postgres'},{permit:''},{port:5432}]) expect(()=>verifyDemoFixtureTarget({...target,...override})).toThrow()
})
test('preflight emits only fingerprints/metadata and never reads Auth or private HR rows',()=>{
 const sql=buildDemoPreflight({target})
 expect(sql).not.toMatch(/FROM\s+auth\.users/i)
 expect(sql).not.toMatch(/FROM\s+(?:public|private)\.ihr_/i)
 expect(sql).toContain('pending_girard')
 expect(sql).toContain('unresolved_requests')
 expect(sql).toContain('columns')
})
test('reconciliation classifies confirmed baseline, commit and drift without automatic reapply',()=>{
 const packet=buildDemoRollout(inputs())
 const state={...baseline}
 expect(reconcileDemoRollout(packet,state).status).toBe('BASELINE_INTACT')
 expect(reconcileDemoRollout(packet,{...state,data_md5:'f'.repeat(32)}).status).toBe('REVIEW_REQUIRED')
 expect(reconcileDemoRollout(packet,{...state,schema_md5:'e'.repeat(32)}).status).toBe('REVIEW_REQUIRED')
})
test('rejects incomplete columns, unresolved requests and unapproved generic ACL/HR deltas',()=>{
 expect(()=>buildDemoRollout({...inputs(),baseline:{...baseline,columns:{}}})).toThrow(/column/i)
 expect(()=>buildDemoRollout({...inputs(),baseline:{...baseline,unresolved_requests:1}})).toThrow(/unresolved/i)
 for(const key of ['table:public.purchase_orders','policy:public.surat_jalan.fixture_read','function:public.ihr_leave_read()','role:authenticated']) {
  expect(()=>buildDemoRollout({...inputs(),schemaChanges:[{key,before:null,after:'a'.repeat(32),reason:'Should be refused'}]})).toThrow(/protected|generic/i)
 }
})
test('binds committed readback to the expected private bucket and immutable source receipt',()=>{
 const packet=buildDemoRollout(inputs())
 const observed={...baseline,schema_md5:'c'.repeat(32),schema:packet.expectedSchema}
 expect(reconcileDemoRollout(packet,observed).status).toBe('REVIEW_REQUIRED')
})
test('requires explicit changed-object reasons and correct pre-change fingerprints',()=>{
 for(const delta of [
  {key:'function:public.changed()',before:'f'.repeat(32),after:'b'.repeat(32),reason:'stale'},
  {key:'function:public.changed()',before:'a'.repeat(32),after:'b'.repeat(32),reason:''},
 ]) expect(()=>buildDemoRollout({...inputs(),schemaChanges:[delta]})).toThrow(/delta/i)
})
test('rejects a changed SQL packet after generation', async()=>{
 const { assertDemoRollout } = await import('../../scripts/build-demo-rollout.mjs')
 const packet=buildDemoRollout(inputs())
 expect(()=>assertDemoRollout({...inputs(),sql:packet.sql+'SELECT 0;'})).toThrow(/artifact/i)
 expect(assertDemoRollout({...inputs(),sql:packet.sql}).assembledSha256).toBe(packet.assembledSha256)
})
test('an already existing promotion bucket cannot be classified as intact baseline',()=>{
 const packet=buildDemoRollout(inputs())
 const bucket={name:'promotion-images',public:false,file_size_limit:5242880,allowed_mime_types:['image/jpeg','image/png','image/webp']}
 expect(reconcileDemoRollout(packet,{...baseline,promotion_bucket:bucket}).status).toBe('REVIEW_REQUIRED')
 expect(()=>buildDemoRollout({...inputs(),baseline:{...baseline,promotion_bucket:bucket}})).toThrow(/baseline|bucket/i)
})
test('committed readback requires every reviewed new table empty and every new request family resolved',()=>{
 const packet=buildDemoRollout(inputs())
 const newTables=['private.pilot_promotion_requests','private.pilot_promo_slices','private.pilot_promo_movements','private.pilot_schedule_requests','private.pilot_visit_requests','public.visit_requests','private.pilot_visit_workflow_audit']
 const proof=Object.fromEntries(newTables.map(t=>[t,{present:true,rows:0,unresolved_requests:t.endsWith('_requests')&&t.startsWith('private.')?0:null}]))
 const observed={...baseline,schema_md5:'c'.repeat(32),schema:packet.expectedSchema,promotion_bucket:{name:'promotion-images',public:false,file_size_limit:5242880,allowed_mime_types:['image/jpeg','image/png','image/webp']},additive_defaults_ok:true,generic_additions_ok:true,new_tables:proof}
 expect(reconcileDemoRollout(packet,observed).status).toBe('COMMITTED_STATE_VERIFIED')
 for(const altered of [undefined,{}, {...proof,'public.visit_requests':{present:true,rows:1,unresolved_requests:null}}, {...proof,'private.pilot_visit_requests':{present:true,rows:0,unresolved_requests:1}}, {...proof,'private.pilot_promo_movements':{present:false,rows:null,unresolved_requests:null}}]) {
  const result=reconcileDemoRollout(packet,{...observed,new_tables:altered})
  expect(result).toMatchObject({status:'REVIEW_REQUIRED',reapply:false})
 }
})
test('matching explicit old generic column delta is forbidden; only intended additions are eligible',()=>{
 for(const name of ['purchase_orders.id','po_line_items.unit_price','po_audit_log.id','surat_jalan.id','sj_line_items.id']) {
  const key=`column:public.${name}`
  expect(()=>buildDemoRollout({...inputs(),baseline:{...baseline,schema:{...baseline.schema,[key]:'d'.repeat(32)}},schemaChanges:[{key,before:'d'.repeat(32),after:'e'.repeat(32),reason:'Explicit matching changed column ACL'}]})).toThrow(/protected.*column/i)
 }
 expect(()=>buildDemoRollout({...inputs(),schemaChanges:[{key:'column:public.purchase_orders.unapproved',before:null,after:'e'.repeat(32),reason:'Unapproved new column'}]})).toThrow(/additive|column/i)
 for(const key of ['column:public.purchase_orders.sales_person_id_at_creation','column:public.purchase_orders.sales_assignment_source_id','column:public.purchase_orders.sales_attributed_at','column:public.purchase_orders.sales_attribution_state','column:public.po_line_items.product_id']) expect(()=>buildDemoRollout({...inputs(),schemaChanges:[{key,before:null,after:'e'.repeat(32),reason:'Intended addition; SQL bounds its type/default/ACL'}]})).not.toThrow()
})
test('baseline classification and packet construction also require complete absent-new-table evidence',()=>{
 const packet=buildDemoRollout(inputs())
 expect(reconcileDemoRollout(packet,{...baseline,new_tables:undefined})).toMatchObject({status:'REVIEW_REQUIRED',reapply:false})
 expect(()=>buildDemoRollout({...inputs(),baseline:{...baseline,new_tables:undefined}})).toThrow(/baseline|inventory/i)
})

test('historical production guard still rejects the current CO frontend tree',()=>{expect(()=>buildDemoRollout({...inputs(),repoRoot:process.cwd()})).toThrow(/Protected HR\/reset\/baseline source drift: src\/lib\/AuthContext.tsx/)})

test('database lifecycle uses the hash-verified historical root without changing old pins',()=>{
 const source=readFileSync('tests/demo/rollout-database.mjs','utf8')
 expect(source).toContain("import { createHistoricalProtectedRoot } from './historical-protected-root.mjs'")
 expect(source).toContain('repoRoot:historical.root')
 expect(source).toMatch(/finally\s*\{\s*historical\.cleanup\(\)/)
 expect(source).not.toContain('repoRoot:process.cwd()')
})
