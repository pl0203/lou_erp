// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect,test } from 'vitest'
import * as fixtures from './fixtures/po-import-manifest.mjs'
import { buildPoImportPackets,hashImportManifest } from '../scripts/build-po-import-packets.mjs'
const source=readFileSync('scripts/test-po-import-ci.mjs','utf8')
test('defers only category until unchanged original v1 lifecycle and realistic size controls finish',()=>{
 expect(source).toContain("f>='202610010001_scalable_order_reads.sql'&&f!==CATEGORY_MIGRATION")
 const boundary=source.indexOf('run(categoryMigration);')
 expect(boundary).toBeGreaterThan(source.indexOf("console.log('PO_IMPORT_SIZE_AND_LATE_REPLAY_VERIFIED')"))
 expect(boundary).toBeLessThan(source.indexOf("console.log('PO_IMPORT_V1_POST_CATEGORY_SCHEMA_REJECTED')"))
 expect(source).toContain("reject(p.sql,'Schema fingerprint changed')")
 expect(source).toContain('assertCategoryTransitionPreserved')
 expect(source).not.toMatch(/buildLegacyAudit|legacy-audit\.mjs|GITHUB_ACTIONS\s*[:=]\s*['"]true/)
})
test('future fixture deliberately covers five categories and reviewed null with distinct identities',()=>{
 const future=(fixtures as any).syntheticCategoryImportManifest()
 expect(future.version).toBe(2)
 expect(future.customers.map((c:any)=>c.customer_category)).toEqual(['supermarket_besar','supermarket_sedang','supermarket_kecil','tradisional_market','perorangan',null])
 expect(future.customers.every((c:any)=>Object.hasOwn(c,'customer_category')&&c.pricingTier==='others')).toBe(true)
 const original=fixtures.syntheticImportManifest()
 expect(future.customers.some((c:any)=>original.customers.some(o=>o.key===c.key||o.name===c.name))).toBe(false)
 const input=JSON.parse(readFileSync('tests/fixtures/po-import-v1-golden/input.json','utf8'))
 const config={...input.config,expectedManifestSha256:hashImportManifest(future)}
 expect(buildPoImportPackets({manifest:future,config,modelVersion:'po-import-v2'}).counts).toEqual({customers:6,products:2,purchaseOrders:6,poLines:7,shipments:3,shipmentLines:4,orderedQuantity:'19',deliveredQuantity:'8',orderedValue:'87.89',deliveredValue:'53.75'})
})
test.each(['SCHEMA_DRIFT_REJECTED','ACTOR_DRIFT_REJECTED','OUT_OF_ORDER_REJECTED','INVALID_CATEGORY_ATOMIC_FAILURE_VERIFIED','ATOMIC_FAILURE_VERIFIED','LOST_RESPONSE_REPLAY_VERIFIED','SAME_SESSION_REPLAY_VERIFIED','LATER_BATCH_ATOMIC_FAILURE_VERIFIED','COMPLETE_REPLAY_VERIFIED','LATE_REPLAY_VERIFIED','CATEGORIES_PRICING_HISTORY_VERIFIED','CATEGORY_DRIFT_REJECTED','SOURCE_DRIFT_REJECTED','BASELINE_DRIFT_REJECTED','PO_EDIT_PRESERVED','STORED_MODEL_TAMPER_REJECTED'])('has a bounded explicit future scenario %s',marker=>{
 expect(source).toContain(`PO_IMPORT_V2_${marker}`)
})

test('transition comparison accepts only additive schema/category differences and detects protected drift',async()=>{
 const {assertCategoryTransitionPreserved}=await import('../scripts/test-po-import-ci.mjs')
 const before={schema_md5:'old',customers:'original-rows',access:{acl:'original',policies:[]},baselineData:{'public.customers':{rows:2,content_md5:'before'},'public.products':{rows:3,content_md5:'prices'},'private.pilot_order_requests':{rows:4,content_md5:'requests'}}}
 const after={...structuredClone(before),schema_md5:'new',baselineData:{...structuredClone(before.baselineData),'public.customers':{rows:2,content_md5:'after-category'}}}
 expect(()=>assertCategoryTransitionPreserved(before,after)).not.toThrow()
 for(const mutate of [
  (s:any)=>{s.schema_md5='old'},(s:any)=>{s.customers='changed-original-rows'},(s:any)=>{s.access.acl='widened'},
  (s:any)=>{s.baselineData['public.customers'].rows++},(s:any)=>{s.baselineData['public.products'].content_md5='prices-changed'},
  (s:any)=>{s.baselineData['private.pilot_order_requests'].content_md5='rewritten-ledger'},
 ]){const drift=structuredClone(after);mutate(drift);expect(()=>assertCategoryTransitionPreserved(before,drift)).toThrow(/protected/)}
})
