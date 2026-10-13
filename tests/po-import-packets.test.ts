// Synthetic values only. These tests generate SQL; they never connect to a database.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  IMPORT_FUNCTION_SIGNATURES, IMPORT_RELATIONS, buildPoImportBaselineSql,
  buildPoImportPackets, assertPoImportPacketSet, hashImportManifest,
} from '../scripts/build-po-import-packets.mjs'

const md5 = 'a'.repeat(32)
const customer = { key: 'customer-1', name: 'Synthetic customer', address: null, city: null, phone: null, email: null, sourceTier: 'unmapped group', pricingTier: 'others' }
const product = { key: 'product-1', name: 'Current synthetic catalog name', sku: 'CAT-1', size: null }
const order = (key: string) => ({
  key, customerKey: customer.key, poNumber: `PO-${key}`, orderDate: '2025-12-31', expectedDeliveryDate: null,
  sourceStatus: 'Historical approved', notes: null,
  lines: [{ key: 'line-1', productKey: product.key, productName: 'Historical synthetic name', sku: 'OLD-SKU', quantity: 10, unitPrice: '12.34', uom: 'BOX' }],
  shipments: [{ key: 'shipment-1', number: `SJ-${key}`, date: '2026-01-02', dateReceived: '2026-01-03', dateReturned: null, sourceSender: 'Synthetic sender', lines: [{ lineKey: 'line-1', quantity: 4 }] }],
})
const manifest = () => ({ version: 1, customers: [{ ...customer }], products: [{ ...product }], purchaseOrders: [order('first'), order('second'), order('third'), order('fourth')] })
const options = (m = manifest()) => ({ manifest: m, config: {
  expectedManifestSha256: hashImportManifest(m), expectedProjectRef: 'a'.repeat(20), expectedDatabase: 'postgres',
  actorId: '84000000-0000-0000-0000-000000000001', actorEmail: 'synthetic-actor@example.invalid', actorRole: 'executive', schemaMd5: md5,
  baselineData: Object.fromEntries(IMPORT_RELATIONS.map((r: string) => [r, { rows: 0, content_md5: md5 }])),
  expectedFunctionHashes: Object.fromEntries(IMPORT_FUNCTION_SIGNATURES.map((s: string) => [s, md5])),
  expectedAuditFields: ['status', 'fixture_line_write', 'fixture_delivery_write', 'sj_lines_revised'], batchSize: 2,
} })
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('private PO import packet compiler', () => {
  it('keeps all masters and the first complete real PO in one transaction, then bounds whole-PO batches', () => {
    const result = buildPoImportPackets(options())
    expect(result.packets.map((p: any) => p.poKeys)).toEqual([['first'], ['second', 'third'], ['fourth']])
    expect(result.counts).toEqual({ customers: 1, products: 1, purchaseOrders: 4, poLines: 4, shipments: 4, shipmentLines: 4, orderedQuantity: '40', deliveredQuantity: '16', orderedValue: '493.60', deliveredValue: '197.44' })
    expect(result.packets[1].counts).toMatchObject({ purchaseOrders: 2, orderedQuantity: '20', deliveredQuantity: '8', orderedValue: '246.80', deliveredValue: '98.72' })
    for (const packet of result.packets) {
      expect(packet.sql.match(/^BEGIN;$/gm)).toHaveLength(1)
      expect(packet.sql.match(/^COMMIT;$/gm)).toHaveLength(1)
      expect(packet.sha256).toBe(sha(packet.sql))
      expect(packet.sql.indexOf('SET CONSTRAINTS ALL IMMEDIATE;')).toBeLessThan(packet.sql.lastIndexOf('COMMIT;'))
      expect(packet.sql.indexOf('COMMIT;')).toBeLessThan(packet.sql.indexOf('PO_IMPORT_PACKET_COMMITTED'))
      expect(packet.sql).toContain("'planned_counts',value->'counts'")
      expect(packet.sql).toContain("'verified_counts',(SELECT value FROM pg_temp.import_controls)")
      expect(packet.sql.trim()).toMatch(/FROM pg_temp\.import_receipt_[a-f0-9]+_\d+;$/)
      expect(packet.sql).toContain('Unexpected temporary receipt identity')
    }
    expect(result.packets[0].sql).toContain('INSERT INTO public.customers')
    expect(result.packets[0].sql).toContain('INSERT INTO public.products')
    expect(result.packets[1].sql).not.toContain('INSERT INTO public.customers')
  })

  it('preserves historical identities/prices and all source provenance independently of catalog values', () => {
    const result = buildPoImportPackets(options())
    const line = result.resolved.purchaseOrders[0].lines[0]
    expect(line).toMatchObject({ productName: 'Historical synthetic name', sku: 'OLD-SKU', unitPrice: '12.34', quantity: 10, uom: 'BOX' })
    expect(result.resolved.purchaseOrders[0].shipments[0].sourceSender).toBe('Synthetic sender')
    expect(result.resolved.products[0]).toMatchObject({ name: 'Current synthetic catalog name', sku: 'CAT-1', unit_price: null, harga_pokok: null, luar_kota: null, dalam_kota: null, depo_bangunan: null })
    expect(result.resolved.customers[0].pricing_tier).toBe('others')
    expect(result.packets[0].sql).toContain('master_rows_md5')
    expect(result.packets[0].sql).toContain('import_provenance')
    expect(result.packets[0].sql).toContain('sourceStatus')
  })

  it('produces stable UUIDs and packet bytes without mutating supplied JSON', () => {
    const input = options(); const original = structuredClone(input)
    const first = buildPoImportPackets(input), second = buildPoImportPackets(structuredClone(input))
    expect(first).toEqual(second); expect(input).toEqual(original)
    expect(first.resolved.customers[0].id).toMatch(/^[a-f0-9-]{36}$/)
    expect(first.resolved.purchaseOrders[0].requestId).not.toBe(first.resolved.purchaseOrders[1].requestId)
    expect(assertPoImportPacketSet({ ...input, packets: first.packets })).toEqual(first.packets.map((p: any) => p.sha256))
  })

  it('rejects changed source values even when a previous packet was otherwise valid', () => {
    const input = options(); input.manifest.purchaseOrders[0].lines[0].unitPrice = '12.35'
    expect(() => buildPoImportPackets(input)).toThrow(/manifest/i)
  })

  it('rejects edited, missing, duplicate and extra final packet bytes', () => {
    const input = options(), built = buildPoImportPackets(input)
    for (const packets of [built.packets.slice(1), [...built.packets, built.packets[0]], built.packets.map((p: any, i: number) => i ? p : { ...p, sql: p.sql + 'SELECT 1;' })]) {
      expect(() => assertPoImportPacketSet({ ...input, packets })).toThrow(/packet/i)
    }
  })

  it('encodes untrusted workbook strings as JSON data, including quotes, backslashes and dollar delimiters', () => {
    const input = options(); const hostile = "Synthetic '); COMMIT; -- \\ $import$\n café"
    input.manifest.customers[0].name = hostile
    input.manifest.purchaseOrders[0].notes = hostile
    input.config.expectedManifestSha256 = hashImportManifest(input.manifest)
    const result = buildPoImportPackets(input)
    expect(result.resolved.customers[0].name).toBe(hostile)
    expect(result.packets[0].sql).not.toContain(hostile)
    expect(result.packets[0].sql).toContain("convert_from(decode('")
  })

  it('emits a guarded recovery path that verifies current rows before excluding them from the original baseline', () => {
    const sql = buildPoImportPackets(options()).packets[1].sql
    expect(sql).toContain('pg_temp.import_verify_state')
    expect(sql).toContain('Committed packet is incomplete')
    expect(sql).toContain('Noncontiguous committed packet')
    expect(sql).toContain('Source-owned master rows changed')
    expect(sql).toContain('Saved request payload changed')
    expect(sql).toContain('PO source fields or workflow version changed')
    expect(sql).toContain('PO line tuple mismatch')
    expect(sql).toContain('Delivery state changed')
    expect(sql).toContain('Original baseline changed')
    expect(sql).toContain('Import aggregate controls changed')
    expect(sql).toContain('SET LOCAL ROLE authenticated;')
    expect(sql).toContain('row_security_active')
    expect(sql).not.toMatch(/DISABLE\s+(?:TRIGGER|ROW LEVEL SECURITY)|session_replication_role|ON CONFLICT|UPDATE public\.|DELETE FROM public\./i)
  })

  it('uses the exact tuple and the current or recorded optimistic version instead of insertion order', () => {
    const sql = buildPoImportPackets(options()).packets[0].sql
    expect(sql).toContain('l.sku IS NOT DISTINCT FROM')
    expect(sql).toContain('l.product_name=')
    expect(sql).toContain('l.quantity=')
    expect(sql).toContain('l.unit_price=')
    expect(sql).toContain('expected_updated_at')
    expect(sql).not.toMatch(/row_number\s*\(|OFFSET\s+\d/i)
  })

  it('pins schema/functions/actor/UTC and all 25 original relations with an external target reminder', () => {
    const sql = buildPoImportPackets(options()).packets[0].sql
    expect(IMPORT_RELATIONS).toHaveLength(25)
    expect(sql).toContain("current_database()<>'postgres'")
    expect(sql).toContain("SET LOCAL statement_timeout='60s'")
    expect(sql).toContain("SET LOCAL search_path=''")
    expect(sql).toContain("SET LOCAL TIME ZONE 'UTC'")
    expect(sql).toContain("set_config('request.jwt.claim.role','authenticated',true)")
    expect(sql).toContain('Schema fingerprint changed')
    expect(sql).toContain('Function body changed')
    expect(sql).toContain('Independently verify the exact project destination')
    expect(buildPoImportBaselineSql()).toContain('schema_md5')
    expect(buildPoImportBaselineSql()).toContain("'database',current_database(),'current_user',current_user,'session_user',session_user")
    expect(buildPoImportBaselineSql()).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|COMMIT)\b/i)
  })

  it.each([
    ['wrong database', (i: any) => { i.config.expectedDatabase = 'production' }],
    ['missing actor', (i: any) => { delete i.config.actorId }],
    ['missing actor email', (i: any) => { delete i.config.actorEmail }],
    ['unauthorized actor role', (i: any) => { i.config.actorRole = 'sales_manager' }],
    ['unbounded batch', (i: any) => { i.config.batchSize = 101 }],
    ['fractional batch', (i: any) => { i.config.batchSize = 1.5 }],
    ['missing baseline relation', (i: any) => { delete i.config.baselineData['public.customers'] }],
    ['extra baseline relation', (i: any) => { i.config.baselineData['public.extra'] = { rows: 0, content_md5: md5 } }],
    ['missing function pin', (i: any) => { delete i.config.expectedFunctionHashes[IMPORT_FUNCTION_SIGNATURES[0]] }],
    ['bad schema hash', (i: any) => { i.config.schemaMd5 = 'x' }],
  ])('refuses %s', (_label, mutate) => {
    const input = options(); mutate(input)
    expect(() => buildPoImportPackets(input)).toThrow()
  })

  it.each([
    ['no anchor PO', (m: any) => { m.purchaseOrders = [] }],
    ['unknown key', (m: any) => { m.purchaseOrders[0].created_at = '2000-01-01' }],
    ['duplicate customer key', (m: any) => { m.customers.push({ ...m.customers[0] }) }],
    ['duplicate PO number', (m: any) => { m.purchaseOrders[1].poNumber = m.purchaseOrders[0].poNumber }],
    ['unknown customer', (m: any) => { m.purchaseOrders[0].customerKey = 'absent' }],
    ['unknown product', (m: any) => { m.purchaseOrders[0].lines[0].productKey = 'absent' }],
    ['missing historical name', (m: any) => { delete m.purchaseOrders[0].lines[0].productName }],
    ['ambiguous tuple', (m: any) => { m.purchaseOrders[0].lines.push({ ...m.purchaseOrders[0].lines[0], key: 'different' }) }],
    ['unsupported precision', (m: any) => { m.purchaseOrders[0].lines[0].unitPrice = '1.001' }],
    ['numeric rather than exact price', (m: any) => { m.purchaseOrders[0].lines[0].unitPrice = 12.34 }],
    ['fractional quantity', (m: any) => { m.purchaseOrders[0].lines[0].quantity = 1.5 }],
    ['invalid business date', (m: any) => { m.purchaseOrders[0].orderDate = '2025-02-29' }],
    ['overshipment', (m: any) => { m.purchaseOrders[0].shipments[0].lines[0].quantity = 11 }],
    ['duplicate shipment line', (m: any) => { m.purchaseOrders[0].shipments[0].lines.push({ ...m.purchaseOrders[0].shipments[0].lines[0] }) }],
    ['unknown shipment line', (m: any) => { m.purchaseOrders[0].shipments[0].lines[0].lineKey = 'absent' }],
    ['invented catalog price', (m: any) => { m.products[0].unit_price = '1.00' }],
    ['unknown unit', (m: any) => { m.purchaseOrders[0].lines[0].uom = '' }],
    ['embedded NUL', (m: any) => { m.customers[0].name = 'Bad\u0000value' }],
  ])('holds the entire manifest on %s rather than silently dropping a PO', (_label, mutate) => {
    const m = manifest(); mutate(m)
    expect(() => buildPoImportPackets(options(m))).toThrow()
  })

  it('handles legitimate zero and exact upper supported monetary totals', () => {
    const m = manifest(); m.purchaseOrders[0].lines[0].unitPrice = '0.00'
    m.purchaseOrders[1].lines[0].unitPrice = '99999999999.99'
    expect(buildPoImportPackets(options(m)).resolved.purchaseOrders[1].totalValue).toBe('999999999999.90')
    m.purchaseOrders[1].lines[0].unitPrice = '100000000000.00'
    expect(() => buildPoImportPackets(options(m))).toThrow(/total/i)
  })

  it('retains explicitly unknown provenance and accepts only the fixed disposable companion', () => {
    const input: any = options()
    input.manifest.customers[0].sourceTier = null
    input.manifest.purchaseOrders[0].sourceStatus = null
    input.config.expectedManifestSha256 = hashImportManifest(input.manifest)
    input.config.expectedDatabase = 'pilot_import_test'
    input.config.disposableFixture = 'disposable-pilot-ci'
    const built = buildPoImportPackets(input)
    expect(built.resolved.customers[0].sourceTier).toBeNull()
    expect(built.resolved.purchaseOrders[0].sourceStatus).toBeNull()
    expect(built.packets[0].sql).toContain('public.pilot_fixture_marker')
    delete input.config.disposableFixture
    expect(() => buildPoImportPackets(input)).toThrow(/disposable/i)
  })

  it('checks generated master timestamps through the anchor and fails closed on null identity drift', () => {
    const sql = buildPoImportPackets(options()).packets[0].sql
    expect(sql).toContain("SELECT to_jsonb(c)-'created_at' INTO actual FROM public.products")
    expect(sql).toContain("request.result->>'po_id' IS DISTINCT FROM po.id::text")
    expect(sql).toContain('a.changed_by IS DISTINCT FROM actor')
    expect(buildPoImportBaselineSql()).not.toContain("'schema',s.value")
  })

  it('reuses one verified master hash per guarded phase rather than rehashing every earlier PO', () => {
    const sql = buildPoImportPackets(options()).packets[0].sql
    const helper = sql.slice(sql.indexOf('CREATE FUNCTION pg_temp.import_create_payload'), sql.indexOf('CREATE FUNCTION pg_temp.import_delivery_payload'))
    expect(helper).not.toContain('pg_temp.import_master_hash()')
    expect(helper).toContain('import_master_state')
  })

  it('normalizes exact integer and one-decimal price strings without inventing precision', () => {
    const m=manifest(); m.purchaseOrders[0].lines[0].unitPrice='0'; m.purchaseOrders[1].lines[0].unitPrice='12.3'
    const built=buildPoImportPackets(options(m))
    expect(built.resolved.purchaseOrders[0].lines[0].unitPrice).toBe('0.00')
    expect(built.resolved.purchaseOrders[1].lines[0].unitPrice).toBe('12.30')
  })

  it('keeps deterministic shipment request IDs distinct when source keys contain delimiters', () => {
    const m=manifest(); m.purchaseOrders[0].key='a:b'; m.purchaseOrders[0].shipments[0].key='c'
    m.purchaseOrders[1].key='a'; m.purchaseOrders[1].shipments[0].key='b:c'
    const built=buildPoImportPackets(options(m))
    expect(built.resolved.purchaseOrders[0].shipments[0].requestId).not.toBe(built.resolved.purchaseOrders[1].shipments[0].requestId)
  })

  it('carries masters only in the anchor packet and full PO models only for the current batch', () => {
    const built=buildPoImportPackets(options())
    const input=(sql: string)=>JSON.parse(Buffer.from(sql.match(/convert_from\(decode\('([A-Za-z0-9+/=]+)','base64'\)/)![1],'base64').toString('utf8'))
    const first=input(built.packets[0].sql), later=input(built.packets[1].sql)
    expect(first.masterModel.text).toBeTypeOf('string')
    expect(later.masterModel.text).toBeUndefined()
    expect(first.currentModels.map((p: any)=>p.key)).toEqual(['first'])
    expect(later.currentModels.map((p: any)=>p.key)).toEqual(['second','third'])
    expect(later.descriptors).toHaveLength(4)
    expect(later.descriptors.every((d: any)=>Array.isArray(d)&&d.length===7&&/^[a-f0-9]{64}$/.test(d[5])&&d[6]>0)).toBe(true)
    const master=JSON.parse(first.masterModel.text)
    expect(Object.keys(master).sort()).toEqual(['c','p','v'])
    expect(master.c.every((r: any)=>r.length===9)).toBe(true)
    expect(master.p.every((r: any)=>r.length===5)).toBe(true)
    expect(built.packets[1].sql).toContain('Stored source model changed')
    expect(built.packets[1].sql).toContain("encode(pg_catalog.sha256(convert_to(model_text,'UTF8')),'hex')")
    expect(built.packets[1].sql).toContain('Source model descriptor mismatch')
    expect(built.packets[1].sql).toContain('Source model provenance keys changed')
  })

  it('pins exact UTF-8 source text bytes and hashes consistently across packet descriptors', () => {
    const m=manifest(); m.customers[0].name='Synthetic café 🧪'
    const built=buildPoImportPackets(options(m))
    const inputs=built.packets.map((p: any)=>JSON.parse(Buffer.from(p.sql.match(/convert_from\(decode\('([A-Za-z0-9+/=]+)','base64'\)/)![1],'base64').toString('utf8')))
    const master=inputs[0].masterModel
    expect(master.sha256).toBe(sha(master.text)); expect(master.bytes).toBe(Buffer.byteLength(master.text,'utf8'))
    expect(master.bytes).toBeGreaterThan(master.text.length)
    for(const packet of inputs) {
      expect(packet.masterModel.sha256).toBe(master.sha256)
      for(const model of packet.currentModels) {
        const descriptor=packet.descriptors.find((d: any)=>d[0]===model.key)
        expect(descriptor[5]).toBe(sha(model.text))
        expect(descriptor[6]).toBe(Buffer.byteLength(model.text,'utf8'))
        expect(JSON.parse(model.text)).toEqual(built.resolved.purchaseOrders.find((p: any)=>p.key===model.key))
        expect(sha(model.text+' ')).not.toBe(descriptor[5])
      }
    }
  })

  it('accepts the reviewed hard maximum of 100 whole POs while keeping the first packet anchored to one', () => {
    const input=options(); input.config.batchSize=100
    const built=buildPoImportPackets(input)
    expect(built.packets.map((p: any)=>p.poKeys.length)).toEqual([1,3])
    const lock=built.packets[0].sql.match(/^LOCK TABLE .*$/m)![0]
    expect(lock).toContain('private.pilot_order_requests')
    expect(lock).not.toMatch(/auth\.|storage\./)
    expect(built.packets[0].sql).toContain("'auth.users-safe-fields'")
    expect(built.packets[0].sql).toContain("'storage.objects'")
  })

  it('round-trips distinct non-null customer/product sentinels through fixed compact columns', () => {
    const m=manifest()
    Object.assign(m.customers[0],{address:'Synthetic street 14',city:'Synthetic city',phone:'Synthetic phone 123',email:'synthetic-customer@example.invalid',sourceTier:'Synthetic source group'})
    m.products[0].size='Synthetic size XL' as any
    const built=buildPoImportPackets(options(m)),sql=built.packets[0].sql
    const input=JSON.parse(Buffer.from(sql.match(/convert_from\(decode\('([A-Za-z0-9+/=]+)','base64'\)/)![1],'base64').toString('utf8'))
    const encoded=JSON.parse(input.masterModel.text)
    const customers=encoded.c.map(([key,id,name,address,city,phone,email,pricing_tier,sourceTier]: any[])=>({key,id,name,address,city,phone,email,pricing_tier,sourceTier,visit_frequency_days:7,last_visit_date:null}))
    const products=encoded.p.map(([key,id,name,sku,size]: any[])=>({key,id,name,sku,size,unit_price:null,harga_pokok:null,luar_kota:null,dalam_kota:null,depo_bangunan:null}))
    expect(customers).toEqual(built.resolved.customers);expect(products).toEqual(built.resolved.products)
    expect(sql).toContain("'address',x->3,'city',x->4,'phone',x->5,'email',x->6,'pricing_tier',x->7,'sourceTier',x->8")
    expect(sql).toContain("'name',x->2,'sku',x->3,'size',x->4")
    expect(sql).toContain('jsonb_array_length(x)<>9')
    expect(sql).toContain('jsonb_array_length(x)<>5')
    expect(sql).toContain('jsonb_array_length(x)<>7')
  })
})
