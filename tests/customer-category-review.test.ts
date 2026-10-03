// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import * as review from '../scripts/build-customer-category-review.mjs'
const customers = ['10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001']
const products = ['20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001']
const expectedMasterRowsMd5 = '0123456789abcdef0123456789abcdef'
const input = () => ({ customerIds: [...customers], productIds: [...products], expectedMasterRowsMd5 })
const baseline = () => review.buildCustomerCategoryBaselineSql()
const audit = (options: any = input()) => review.buildCustomerCategoryLegacyAuditSql(options)
const compact = (sql: string) => sql.replace(/\s+/g, ' ').trim()
const customerFields = ['id','name','address','city','phone','email','pricing_tier','visit_frequency_days','last_visit_date','created_at']
const productFields = ['id','name','sku','size','unit_price','harga_pokok','luar_kota','dalam_kota','depo_bangunan','created_at']

test('exports the two pure SQL generators', () => {
 expect(review.buildCustomerCategoryBaselineSql).toBeTypeOf('function')
 expect(review.buildCustomerCategoryLegacyAuditSql).toBeTypeOf('function')
})

test('bounds both read-only snapshots and refuses filtered visibility', () => {
 for (const sql of [baseline(), audit()]) {
  expect(sql).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
  for (const setting of ["SET LOCAL TIME ZONE 'UTC';", "SET LOCAL search_path='';", 'SET LOCAL row_security=off;', "SET LOCAL statement_timeout='30s';", "SET LOCAL lock_timeout='5s';", "SET LOCAL idle_in_transaction_session_timeout='30s';"]) expect(sql).toContain(setting)
  expect(sql).toMatch(/\nROLLBACK;\n$/)
  // Ignore data literals: privilege names in actual ACL metadata are not writes.
  const statements = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '')
  expect(statements).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|COMMIT|LOCK)\b/i)
  expect(statements).not.toMatch(/\b(?:dblink|pg_terminate_backend|pg_read_file|lo_import)\b/i)
 }
})

test('baseline exposes actual identity and schema evidence rather than only a digest', () => {
 const sql = baseline()
 for (const identity of ['current_database()','current_user','session_user','inet_server_addr()','inet_server_port()','version()','transaction_timestamp()']) expect(sql).toContain(identity)
 for (const metadata of ['pg_namespace','pg_type','pg_attribute','pg_attrdef','pg_constraint','pg_proc','pg_policies','pg_index','pg_roles','pg_auth_members']) expect(sql).toContain(metadata)
 for (const value of ['nspacl','typowner','attacl','relacl','relrowsecurity','relforcerowsecurity','pg_get_expr','pg_get_constraintdef','pg_get_functiondef','pg_get_indexdef','customer_category','category_column']) expect(sql).toContain(value)
 expect(sql).toContain("'schema',s.value")
 expect(sql).toContain("'schema_md5',md5(s.value::text)")
 expect(sql).toContain('AS customer_category_baseline')
})

test('baseline fingerprints exact original customers and all protected relations deterministically', () => {
 const sql = compact(baseline())
 expect(sql).toContain(`SELECT ${customerFields.map(f => `c.${f}`).join(',')} FROM public.customers c`)
 for (const relation of ['public.products','public.promotions','public.purchase_orders','public.po_line_items','public.surat_jalan','public.sj_line_items','public.customer_manager_assignments','public.customer_sales_rep_assignments','public.users','private.pilot_order_requests']) {
  expect(sql).toContain(`'${relation}' AS relation`)
  expect(sql).toContain(`FROM ${relation} r`)
 }
 expect(sql).toContain("md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY r.id),''))")
 expect(sql).toContain("ORDER BY r.actor_id,r.request_id")
 expect(sql).toContain('jsonb_object_agg(relation,')
 expect(sql).toContain("'category_rows'")
 expect(sql).toContain("'invalid_category_ids'")
})

test('baseline enumerates real request states and available provenance without inventing inventory membership', () => {
 const sql = compact(baseline())
 for (const field of ['actor_id','request_id','operation','source_key','model','plan_sha256','manifest_sha256','master_rows_md5','master_model_sha256','po_model_sha256','state','completed','abandoned','result','result_id','result_po_id','payload_po_id','created_at']) expect(sql).toContain(`'${field}'`)
 expect(sql).toContain("CASE WHEN r.abandoned THEN 'ABANDONED' WHEN r.result IS NOT NULL THEN 'COMPLETED' ELSE 'PENDING' END")
 expect(sql).toContain("'completed',r.result IS NOT NULL")
 expect(sql).toContain("r.payload->'import_provenance'->>'master_model_sha256'")
 expect(sql).toContain("r.result->>'po_id'")
 expect(sql).toContain('ORDER BY r.actor_id,r.request_id')
 expect(sql).not.toMatch(/WHERE[^;]*r\.result IS NULL/)
 expect(sql).not.toContain('original_packet_complete')
})

test.each([undefined, null, '', [], {}, { customerIds: customers }, { ...input(), extra: true }, { ...input(), customerIds: undefined }, { ...input(), productIds: undefined }])('rejects incomplete or unexpected audit options before SQL: %j', options => {
 expect(() => review.buildCustomerCategoryLegacyAuditSql(options)).toThrow()
})

test.each(['customerIds','productIds'])('rejects invalid, duplicate, sparse and excessive %s without coercion', field => {
 for (const invalid of [null, undefined, [], '', [''], [undefined], [42], new Array(2), ['not-a-uuid'], ["10000000-0000-4000-8000-000000000001'); SELECT 1;--"], [customers[0],customers[0]], [customers[0],customers[0].toUpperCase()], Array.from({length:10001}, (_,i) => `30000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`)]) {
  expect(() => audit({ ...input(), [field]: invalid })).toThrow()
 }
})

test.each([undefined, null, '', 123, 'a'.repeat(31), 'g'.repeat(32), 'a'.repeat(33), "a'; SELECT 1;--", ' A'.repeat(16)])('rejects invalid saved master MD5: %j', hash => {
 expect(() => audit({ ...input(), expectedMasterRowsMd5: hash })).toThrow()
})

test('normalizes and orders valid UUID sets without changing caller inputs or accepting baseline options', () => {
 const source = input(), original = structuredClone(source)
 const first = audit(source)
 expect(first).toBe(audit({ customerIds: [...customers].reverse(), productIds: [...products].reverse(), expectedMasterRowsMd5 }))
 expect(first).toBe(audit({ ...source, expectedMasterRowsMd5: expectedMasterRowsMd5.toUpperCase() }))
 expect(source).toEqual(original)
 expect(first.indexOf(customers[1])).toBeLessThan(first.indexOf(customers[0]))
 expect(first.indexOf(products[1])).toBeLessThan(first.indexOf(products[0]))
 for (const options of [undefined, null, {}, { customerIds: customers }]) expect(() => review.buildCustomerCategoryBaselineSql(options)).toThrow()
 expect(baseline()).toBe(baseline())
})

test('reconstructs the original v1 JSONB master hash from exact projections, not a convenient subset or category-bearing rows', () => {
 const sql = compact(audit())
 expect(sql).toContain(`SELECT ${customerFields.map(f => `c.${f}`).join(',')} FROM public.customers c JOIN requested_customers q ON q.id=c.id`)
 expect(sql).toContain(`SELECT ${productFields.map(f => `p.${f}`).join(',')} FROM public.products p JOIN requested_products q ON q.id=p.id`)
 expect(sql).toContain("md5(jsonb_build_object( 'customers',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM original_customers c), 'products',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM original_products p))::text) AS actual_master_rows_md5")
 expect(sql).not.toContain("to_jsonb(c)-'customer_category'")
 expect(sql).not.toContain('SELECT c.*')
 expect(sql).not.toContain('SELECT p.*')
 expect(sql).toContain(`'expected_master_rows_md5','${expectedMasterRowsMd5}'`)
 expect(sql).toContain("'actual_master_rows_md5',h.actual_master_rows_md5")
 // Every v1 source field participates; category cannot enter the hash CTEs.
 expect(sql.slice(sql.indexOf('original_customers AS ('),sql.indexOf('source_schema AS ('))).not.toContain('customer_category')
})

test('missing identity wins over hash drift, later source columns cannot silently match, and categories never decide source status', () => {
 const sql = compact(audit())
 expect(sql).toContain('LEFT JOIN public.customers c ON c.id=q.id WHERE c.id IS NULL')
 expect(sql).toContain('LEFT JOIN public.products p ON p.id=q.id WHERE p.id IS NULL')
 expect(sql).toContain("CASE WHEN jsonb_array_length(m.customer_ids)>0 OR jsonb_array_length(m.product_ids)>0 THEN 'ID_MISSING' WHEN NOT s.matches OR h.actual_master_rows_md5<>'0123456789abcdef0123456789abcdef' THEN 'SOURCE_FIELDS_CHANGED' ELSE 'MATCH' END")
 expect(sql).toContain("'source_match',v.source_status='MATCH'")
 expect(sql).toContain("'source_projection_matches_schema',s.matches")
 expect(sql).toContain("'missing_customer_ids',m.customer_ids")
 expect(sql).toContain("'missing_product_ids',m.product_ids")
 expect(sql).toContain("'category_status',CASE WHEN NOT k.present THEN 'NOT_PRESENT' WHEN jsonb_array_length(k.invalid_ids)>0 THEN 'INVALID_VALUES' ELSE 'VALID' END")
 expect(sql).toContain('to_jsonb(c)->\'customer_category\' AS category')
 expect(sql).toContain("'category_rows',k.rows")
 expect(sql).toContain("'invalid_category_ids',k.invalid_ids")
 expect(sql).toContain("category<>'null'::jsonb")
 expect(sql).toContain('AS customer_category_legacy_audit')
})

test('generator module has no ambient I/O or database execution entry point', () => {
 const source = readFileSync('scripts/build-customer-category-review.mjs','utf8')
 expect(source).not.toMatch(/\b(?:process|fetch|execSync|spawn|require|readFile|writeFile)\b/)
 expect(source).not.toMatch(/node:(?:fs|child_process|http|https|net)|@supabase|\bfrom\s+['"]pg['"]|\bimport\s*\(/)
})


test('accepts the maximum unique cohort and normalizes alphabetic UUIDs while rejecting extra call arguments', () => {
 const ids = Array.from({length:10000}, (_,i) => `30000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`)
 const sql = audit({ ...input(), customerIds: ids })
 expect(sql).toContain(ids[0])
 expect(sql).toContain(ids[9999])
 const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
 expect(audit({ ...input(), customerIds: [id.toUpperCase()] })).toBe(audit({ ...input(), customerIds: [id] }))
 expect(() => (review.buildCustomerCategoryLegacyAuditSql as any)(input(), {})).toThrow()
})

test('schema comparison includes all original field types and rejects later fields even with the same row digest', () => {
 const sql = compact(audit())
 const expectedCustomers = {id:'uuid', name:'text', address:'text', city:'text', phone:'text', email:'text', pricing_tier:'public.pricing_tier', visit_frequency_days:'integer', last_visit_date:'date', created_at:'timestamp with time zone'}
 const expectedProducts = {id:'uuid', name:'text', sku:'text', size:'text', unit_price:'numeric(14,2)', harga_pokok:'numeric(14,2)', luar_kota:'numeric(14,2)', dalam_kota:'numeric(14,2)', depo_bangunan:'numeric(14,2)', created_at:'timestamp with time zone'}
 expect(sql).toContain(`'${JSON.stringify(expectedCustomers)}'::jsonb AS expected_customer_columns`)
 expect(sql).toContain(`'${JSON.stringify(expectedProducts)}'::jsonb AS expected_product_columns`)
 expect(sql).toContain("a.attrelid='public.customers'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'customer_category'")
 expect(sql).toContain("a.attrelid='public.products'::regclass AND a.attnum>0 AND NOT a.attisdropped)")
 expect(sql).toContain('customer_columns=expected_customer_columns AND product_columns=expected_product_columns AS matches')
})

test('auth fingerprints expose only the original safe fields and never serialize a full auth row', () => {
 const sql = compact(baseline())
 const auth = sql.match(/SELECT 'auth.users-safe-fields' AS relation,[^;]*?FROM auth.users r/)![0]
 expect(auth).toContain("md5(jsonb_build_object('id',r.id,'email',r.email,'role',r.role,'aud',r.aud,'created_at',r.created_at)::text)")
 expect(auth).not.toContain('to_jsonb(r)')
 expect(auth).not.toMatch(/password|token|secret|encrypted/i)
})


test('retains provider product created_at in the original row consumed by the v1 master hash', () => {
 // The minimal fixture omits this provider field; the reviewed v1 CI schema adds it.
 // v1 compares model fields without it but hashes the entire persisted row with it.
 const sql = compact(audit())
 const productProjection = sql.slice(sql.indexOf('original_products AS ('), sql.indexOf('master_hash AS ('))
 expect(productProjection).toContain('p.depo_bangunan,p.created_at FROM public.products p')
 expect(sql).toContain("'products',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM original_products p)")
 expect(sql).toContain('"created_at":"timestamp with time zone"}\'::jsonb AS expected_product_columns')
 expect(sql).not.toContain("to_jsonb(p)-'created_at'")
})
