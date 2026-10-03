// @vitest-environment node
// Frozen fictional v1 outputs and new future-only v2 plans. Never connects.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as compiler from '../scripts/build-po-import-packets.mjs'
import { CUSTOMER_CATEGORIES } from '../src/lib/customerCategory'
const path = 'tests/fixtures/po-import-v1-golden/'
const input = () => JSON.parse(readFileSync(path + 'input.json', 'utf8'))
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const decode = (sql: string) => JSON.parse(Buffer.from(sql.match(/convert_from\(decode\('([A-Za-z0-9+/=]+)','base64'\)/)![1], 'base64').toString('utf8'))
const v2 = (category: any = 'supermarket_besar') => {
 const i = input(); i.modelVersion = 'po-import-v2'; i.manifest.version = 2
 i.manifest.customers[0].customer_category = category
 i.config.expectedManifestSha256 = compiler.hashImportManifest(i.manifest)
 return i
}
describe('frozen v1 compatibility boundary', () => {
 it('preserves every output byte, packet/model/request identity and baseline query from the untouched compiler', () => {
  const provenance = JSON.parse(readFileSync(path + 'provenance.json', 'utf8'))
  expect(provenance.compilerSha256).toBe('88ec522c2abbf1edf6d5fec1c503da9830ca237debf05b9b210faa034e022320')
  const golden = readFileSync(path + 'output.json', 'utf8')
  expect(sha(golden)).toBe('5b8efc9a5c61b6b2405bf9c060b0c8c242c258f1362d6159076ee8759c060bf9')
  expect(JSON.stringify(compiler.buildPoImportPackets(input()), null, 2) + '\n').toBe(golden)
  expect(JSON.stringify(compiler.buildPoImportPackets({ ...input(), modelVersion: 'po-import-v1' }), null, 2) + '\n').toBe(golden)
  expect(compiler.buildPoImportBaselineSql()).toBe(readFileSync(path + 'baseline.sql', 'utf8'))
  expect(sha(compiler.buildPoImportBaselineSql())).toBe(provenance.baselineSha256)
 })
 it('continues rejecting a category in the strict v1 customer shape', () => {
  const i = input(); i.manifest.customers[0].customer_category = null
  i.config.expectedManifestSha256 = compiler.hashImportManifest(i.manifest)
  expect(() => compiler.buildPoImportPackets(i)).toThrow('Unexpected customer fields')
 })
})
describe('explicit future category import model', () => {
 it('mirrors the exact frozen frontend and migration keys', () => {
  const keys = (compiler as any).IMPORT_CUSTOMER_CATEGORIES
  expect(keys).toEqual(CUSTOMER_CATEGORIES.map(c => c.value)); expect(Object.isFrozen(keys)).toBe(true)
  const sql = readFileSync('supabase/migrations/202610020001_customer_categories.sql', 'utf8')
  const check = sql.match(/customer_category IN \(([\s\S]*?)\)/)![1]
  expect([...check.matchAll(/'([^']+)'/g)].map(m => m[1])).toEqual(keys)
 })
 it.each([...CUSTOMER_CATEGORIES.map(c => c.value), null])('preserves explicit category %j without changing pricing/history', category => {
  const i = v2(category), built = compiler.buildPoImportPackets(i), packet = decode(built.packets[0].sql), master = JSON.parse(packet.masterModel.text)
  expect(packet.model).toBe('po-import-v2'); expect(master.v).toBe(2)
  expect(master.c[0]).toHaveLength(10); expect(master.c[0][9]).toBe(category)
  expect(built.resolved.customers[0]).toMatchObject({ customer_category: category, pricing_tier: 'others' })
  expect(built.counts).toEqual(compiler.buildPoImportPackets(input()).counts)
  expect(built.resolved.products.every((p: any) => [p.unit_price,p.harga_pokok,p.luar_kota,p.dalam_kota,p.depo_bangunan].every(x => x === null))).toBe(true)
  expect(built.resolved.purchaseOrders[0].lines).toEqual(compiler.buildPoImportPackets(input()).resolved.purchaseOrders[0].lines)
  expect(built).toEqual(compiler.buildPoImportPackets(structuredClone(i)))
  expect(compiler.assertPoImportPacketSet({ ...i, packets: built.packets })).toEqual(built.packets.map((p: any) => p.sha256))
  const sql = built.packets[0].sql
  expect(sql).toContain("doc->>'model' IS DISTINCT FROM 'po-import-v2'")
  expect(sql).toContain("'customer_category',x->9")
  expect(sql).toContain('jsonb_array_length(x)<>10')
  expect(sql).toContain('last_visit_date,customer_category)')
  expect(sql).toContain("NULL,x->>'customer_category'")
  expect(sql).toContain('Invalid explicit customer category model')
  expect(sql).toContain("SELECT to_jsonb(c)-'created_at' INTO actual FROM public.customers")
  expect(sql).toContain('Source-owned master rows changed')
  expect(sql).toContain('Schema fingerprint changed'); expect(sql).toContain('Original baseline changed')
 })
 it.each(['', ' ', 'Supermarket Besar', 'SUPERMARKET_BESAR', 'supermarket_besar ', ' supermarket_besar', 'others', 'unclassified', false, 0, {}, [], undefined])('rejects invalid mapping %j before producing SQL', category => {
  const i = v2(); i.manifest.customers[0].customer_category = category
  // Undefined is not JSON and must also be rejected by the compiler itself.
  if (category !== undefined) i.config.expectedManifestSha256 = compiler.hashImportManifest(i.manifest)
  expect(() => compiler.buildPoImportPackets(i)).toThrow(/explicit customer category|finite JSON/)
 })
 it('requires every customer to own a reviewed mapping, including explicit null', () => {
  const i = v2(); i.manifest.customers.push({ ...i.manifest.customers[0], key:'other', name:'Other fictional customer' })
  delete i.manifest.customers[1].customer_category
  i.config.expectedManifestSha256 = compiler.hashImportManifest(i.manifest)
  expect(() => compiler.buildPoImportPackets(i)).toThrow('Explicit customer category mapping required')
 })
 it.each([['po-import-v1',2], ['po-import-v2',1], ['po-import-v3',2]])('rejects caller/model mismatch %s %s', (modelVersion, version) => {
  const i = v2(); i.modelVersion = modelVersion; i.manifest.version = version
  i.config.expectedManifestSha256 = compiler.hashImportManifest(i.manifest)
  expect(() => compiler.buildPoImportPackets(i)).toThrow(/model|manifest version/)
 })
 it.each(['hidden','accessor'])('rejects %s category properties that are not a stable explicit JSON mapping', kind => {
  const i=v2(); delete i.manifest.customers[0].customer_category
  Object.defineProperty(i.manifest.customers[0],'customer_category',kind==='hidden'?{value:'perorangan',enumerable:false}:{get:()=> 'perorangan',enumerable:true})
  i.config.expectedManifestSha256=compiler.hashImportManifest(i.manifest)
  expect(()=>compiler.buildPoImportPackets(i)).toThrow('Explicit customer category mapping required')
 })
 it('never turns an old or changed plan into a retry with recycled request IDs', () => {
  const a=compiler.buildPoImportPackets(input()), b=compiler.buildPoImportPackets(v2(null)), c=compiler.buildPoImportPackets(v2('perorangan'))
  for (const [left,right] of [[a,b],[b,c]]) {
   expect(left.planSha256).not.toBe(right.planSha256)
   expect(left.manifestSha256).not.toBe(right.manifestSha256)
   const ids=new Set(left.resolved.purchaseOrders.flatMap((p: any)=>[p.requestId,...p.shipments.map((s: any)=>s.requestId)]))
   expect(right.resolved.purchaseOrders.flatMap((p: any)=>[p.requestId,...p.shipments.map((s: any)=>s.requestId)]).some((id: string)=>ids.has(id))).toBe(false)
  }
  expect(() => compiler.assertPoImportPacketSet({ ...v2(null), packets:a.packets })).toThrow('Final packet set differs')
 })
 it('pins the requested baseline model explicitly and refuses unknown versions', () => {
  expect((compiler.buildPoImportBaselineSql as any)({ modelVersion:'po-import-v2' })).toContain("'model','po-import-v2'")
  expect(() => (compiler.buildPoImportBaselineSql as any)({ modelVersion:'po-import-v3' })).toThrow('Unsupported import model')
 })
})
