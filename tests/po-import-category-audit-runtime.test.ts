// @vitest-environment node
import { expect,test } from 'vitest'
import * as ci from '../scripts/test-po-import-ci.mjs'
import { buildCustomerCategoryBaselineSql,buildCustomerCategoryLegacyAuditSql } from '../scripts/build-customer-category-review.mjs'
const customer='10000000-0000-4000-8000-000000000001',product='20000000-0000-4000-8000-000000000001'
const saved='0123456789abcdef0123456789abcdef',changed='fedcba9876543210fedcba9876543210'
const identity=()=>({database:'pilot_import_test',current_user:'postgres',session_user:'postgres',server_address:'127.0.0.1',server_port:5432,server_version:'Synthetic PostgreSQL',captured_at:'2026-10-02T00:00:00Z',transaction_read_only:'on',transaction_isolation:'repeatable read',row_security:'off',timezone:'UTC',search_path:'""'})
const customerColumns={id:'uuid',name:'text',address:'text',city:'text',phone:'text',email:'text',pricing_tier:'public.pricing_tier',visit_frequency_days:'integer',last_visit_date:'date',created_at:'timestamp with time zone'}
const productColumns={id:'uuid',name:'text',sku:'text',size:'text',unit_price:'numeric(14,2)',harga_pokok:'numeric(14,2)',luar_kota:'numeric(14,2)',dalam_kota:'numeric(14,2)',depo_bangunan:'numeric(14,2)',created_at:'timestamp with time zone'}
const inventory=()=>({customerIds:[customer],productIds:[product],expectedMasterRowsMd5:saved})
const expectation=()=>({...inventory(),sourceStatus:'MATCH',actualMasterRowsMd5:saved,sourceSchemaMatches:true,categoryColumnPresent:true,categoryRows:[{id:customer,customer_category:null}],missingCustomerIds:[],missingProductIds:[]})
const audit=()=>({review_version:'customer-category-legacy-audit-v1',identity:identity(),expected_master_rows_md5:saved,actual_master_rows_md5:saved,source_status:'MATCH',source_match:true,source_projection_matches_schema:true,source_schema:{customer_columns:{...customerColumns},product_columns:{...productColumns},expected_customer_columns:{...customerColumns},expected_product_columns:{...productColumns}},requested_customer_ids:[customer],requested_product_ids:[product],missing_customer_ids:[],missing_product_ids:[],category_column_present:true,category_status:'VALID',category_rows:[{id:customer,customer_category:null}],invalid_category_ids:[]})
const relations=['public.users','public.customers','public.products','public.customer_manager_assignments','public.customer_sales_rep_assignments','public.customer_targets','public.sales_targets','public.sales_schedules','public.outlet_visits','public.visit_photos','public.purchase_orders','public.po_line_items','public.po_audit_log','public.promotions','public.girard_orders','public.girard_order_items','public.surat_jalan','public.sj_line_items','public.outlets','public.orders','public.order_line_items','private.pilot_order_requests','auth.users-safe-fields','storage.objects','storage.buckets']
const baseline=()=>({review_version:'customer-category-baseline-v1',identity:identity(),schema:{schemas:[],types:[],tables:[],columns:[],constraints:[],policies:[],functions:[],triggers:[],indexes:[],roles:[],memberships:[],category_column:{present:true,type:'text',notnull:false,default:null,acl:null,identity:'',generated:''}},schema_md5:saved,protected_data:Object.fromEntries(relations.map(relation=>[relation,{rows:0,content_md5:saved}])),request_states:[],category_column_present:true,category_rows:[],invalid_category_ids:[]})
const validateAudit=(a:any,e:any=expectation())=>(ci as any).assertCustomerCategoryAuditEvidence(a,e)
const validateBaseline=(b:any)=>(ci as any).assertCustomerCategoryBaselineEvidence(b,true)

test('read-only runtime guard accepts the frozen SQL and rejects a write before execution',()=>{
 for(const sql of [buildCustomerCategoryBaselineSql(),buildCustomerCategoryLegacyAuditSql(inventory())]){
  expect(()=>(ci as any).assertCustomerCategoryReadOnlySql(sql)).not.toThrow()
  expect(()=>(ci as any).assertCustomerCategoryReadOnlySql(sql.replace('ROLLBACK;','UPDATE public.customers SET name=\'unsafe\';\nROLLBACK;'))).toThrow(/read.only/i)
  expect(()=>(ci as any).assertCustomerCategoryReadOnlySql(sql.replace('SET LOCAL row_security=off;',''))).toThrow(/read.only/i)
 }
})
test('runtime evidence accepts the exact saved-hash MATCH and independent null or selected category',()=>{
 expect(()=>validateAudit(audit())).not.toThrow()
 const selected=audit();selected.category_rows[0].customer_category='perorangan' as any
 expect(()=>validateAudit(selected,{...expectation(),categoryRows:[{id:customer,customer_category:'perorangan'}]})).not.toThrow()
 const absent=audit();absent.category_column_present=false;absent.category_status='NOT_PRESENT'
 expect(()=>validateAudit(absent,{...expectation(),categoryColumnPresent:false})).not.toThrow()
})
test.each([
 ['observed hash',(a:any)=>{a.actual_master_rows_md5=changed}],['saved hash',(a:any)=>{a.expected_master_rows_md5=changed}],
 ['source status',(a:any)=>{a.source_status='SOURCE_FIELDS_CHANGED'}],['source match',(a:any)=>{a.source_match=false}],
 ['filtered identity',(a:any)=>{a.identity.current_user='authenticated'}],['writable transaction',(a:any)=>{a.identity.transaction_read_only='off'}],
 ['filtered policy setting',(a:any)=>{a.identity.row_security='on'}],['missing IDs',(a:any)=>{a.missing_customer_ids=[customer]}],
 ['category mismatch',(a:any)=>{a.category_rows[0].customer_category='perorangan'}],['category status',(a:any)=>{a.category_status='INVALID_VALUES'}],
 ['unexpected output',(a:any)=>{a.unreviewed=true}],['schema mismatch',(a:any)=>{a.source_schema.product_columns.created_at='text'}],
 ['weakened provider projection',(a:any)=>{delete a.source_schema.product_columns.created_at;delete a.source_schema.expected_product_columns.created_at}],
])('runtime evidence refuses %s rather than producing a verified marker',(_label,mutate)=>{
 const value=audit();mutate(value);expect(()=>validateAudit(value)).toThrow(/audit evidence/)
})
test('runtime evidence separates source edits, schema drift and missing original IDs without repinning',()=>{
 const source=audit();source.actual_master_rows_md5=changed;source.source_status='SOURCE_FIELDS_CHANGED';source.source_match=false
 expect(()=>validateAudit(source,{...expectation(),sourceStatus:'SOURCE_FIELDS_CHANGED',actualMasterRowsMd5:'different'})).not.toThrow()
 expect(()=>validateAudit(audit(),{...expectation(),sourceStatus:'SOURCE_FIELDS_CHANGED',actualMasterRowsMd5:'different'})).toThrow(/audit evidence/)
 const schema=audit();schema.source_schema.product_columns={...productColumns,synthetic_category_audit_drift:'text'} as any;schema.source_projection_matches_schema=false;schema.source_status='SOURCE_FIELDS_CHANGED';schema.source_match=false
 expect(()=>validateAudit(schema,{...expectation(),sourceStatus:'SOURCE_FIELDS_CHANGED',sourceSchemaMatches:false})).not.toThrow()
 const missing='10000000-0000-4000-8000-000000000099',gone=audit();gone.requested_customer_ids.push(missing);gone.missing_customer_ids=[missing];gone.source_status='ID_MISSING';gone.source_match=false
 expect(()=>validateAudit(gone,{...expectation(),customerIds:[customer,missing],sourceStatus:'ID_MISSING',missingCustomerIds:[missing]})).not.toThrow()
})
test('complete baseline evidence refuses truncated request states, metadata, protected relations and unsafe identity',()=>{
 expect(()=>validateBaseline(baseline())).not.toThrow()
 for(const mutate of [
  (b:any)=>{delete b.protected_data['public.products']},(b:any)=>{b.protected_data['private.pilot_order_requests'].rows=1},
  (b:any)=>{delete b.schema.policies},(b:any)=>{b.protected_data['public.products'].content_md5='not-md5'},
  (b:any)=>{b.identity.transaction_isolation='read committed'},(b:any)=>{b.schema.category_column.notnull=true},
  (b:any)=>{b.invalid_category_ids=[customer]},(b:any)=>{b.category_rows=[{id:customer,customer_category:'invalid'}]},
 ]){const value=baseline();mutate(value);expect(()=>validateBaseline(value)).toThrow(/baseline evidence/)}
})
test('audit no-write proof compares all protected fingerprints, metadata, request states and separate categories',()=>{
 const before=baseline(),after=structuredClone(before);after.identity.captured_at='2026-10-02T00:01:00Z'
 expect(()=>(ci as any).assertCustomerCategoryReadUnchanged(before,after)).not.toThrow()
 for(const mutate of [
  (b:any)=>{b.protected_data['public.products'].content_md5=changed},(b:any)=>{b.schema.policies.push({unexpected:true})},
  (b:any)=>{b.schema_md5=changed},(b:any)=>{b.request_states.push({request_id:customer})},
  (b:any)=>{b.category_rows.push({id:customer,customer_category:null})},(b:any)=>{b.identity.row_security='on'},
 ]){const drift=structuredClone(after);mutate(drift);expect(()=>(ci as any).assertCustomerCategoryReadUnchanged(before,drift)).toThrow(/changed/)}
})

const manifestHash='a'.repeat(64),planHash='b'.repeat(64)
const receipt=()=>({model:'po-import-v1',manifest_sha256:manifestHash,plan_sha256:planHash,packet_index:0,verified_through:0,skipped:false,master_rows_md5:saved})
const savedInventory=(receipts:any[])=>(ci as any).customerCategoryLegacyInventory({resolved:{customers:[{id:customer}],products:[{id:product}]},receipts,manifestSha256:manifestHash,planSha256:planHash})
test('legacy audit inventory takes only the unchanged successful v1 receipt hash and resolved synthetic IDs',()=>{
 expect(savedInventory([receipt(),{...receipt(),skipped:true}])).toEqual({...inventory(),receipts:[receipt(),{...receipt(),skipped:true}]})
 for(const receipts of [[],[{...receipt(),skipped:true}],[{...receipt(),model:'po-import-v2'}],[{...receipt(),manifest_sha256:'c'.repeat(64)}],[{...receipt(),master_rows_md5:'not-md5'}],[receipt(),{...receipt(),master_rows_md5:changed}]])expect(()=>savedInventory(receipts)).toThrow(/saved v1 receipt/)
})

test('complete review transport parses one large JSON row and refuses errors, extra rows or truncation',()=>{
 const value={payload:'x'.repeat(2*1024*1024)}
 expect((ci as any).parseCustomerCategoryReviewJson(JSON.stringify(value)+'\n')).toEqual(value)
 for(const output of [JSON.stringify(value).slice(0,-1),'{"ok":true}\n{"ok":true}\n','ERROR: failure\n{"ok":true}\n',''])expect(()=>(ci as any).parseCustomerCategoryReviewJson(output)).toThrow(/complete.*JSON/i)
})

test('bounded review output preserves the fixed psql transport, guarded connection identity and phase timeouts',()=>{
 // Prepare the actual call arguments only. No execution, CI impersonation or SQL adapter.
 const connection={PATH:'/usr/bin:/bin',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'pilot_test',PGUSER:'postgres'}
 const before=structuredClone(connection)
 const call=(ci as any).poImportCiPsqlInvocation(connection,'SELECT fictional_test_only;', 'pilot_import_test',500)
 expect(call).toEqual({file:'psql',args:['-X','--no-password','-qAt','--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose'],options:{env:{...connection,PGDATABASE:'pilot_import_test'},input:'SELECT fictional_test_only;',encoding:'utf8',maxBuffer:33554432,timeout:500,shell:false,stdio:['pipe','pipe','pipe']}})
 expect(call.options.maxBuffer).toBeGreaterThan(2*1024*1024)
 expect(call.options.maxBuffer).toBeLessThanOrEqual(32*1024*1024)
 expect((ci as any).poImportCiPsqlInvocation(connection,'SELECT fictional_test_only;','pilot_import_test',200000).options.timeout).toBe(120000)
 expect(connection).toEqual(before)
})

const requestState=()=>({actor_id:customer,request_id:product,operation:'create_po',created_at:'2026-10-02T00:00:00Z',state:'PENDING',completed:false,abandoned:false,source_key:null,model:null,plan_sha256:null,manifest_sha256:null,master_rows_md5:null,master_model_sha256:null,master_model_bytes:null,po_model_sha256:null,po_model_bytes:null,provenance_present:false,payload_md5:saved,result:null,result_md5:null,result_id:null,result_po_id:null,payload_po_id:null})
test('baseline retains unrelated request state faithfully and refuses a contradictory derived state',()=>{
 const pending=baseline();pending.request_states=[requestState()] as any;pending.protected_data['private.pilot_order_requests'].rows=1
 expect(()=>validateBaseline(pending)).not.toThrow()
 const abandoned=structuredClone(pending);Object.assign(abandoned.request_states[0],{abandoned:true,completed:true,result:{id:customer},result_md5:saved,state:'ABANDONED'})
 expect(()=>validateBaseline(abandoned)).not.toThrow()
 const contradictory=structuredClone(pending);(contradictory.request_states[0] as any).state='COMPLETED'
 expect(()=>validateBaseline(contradictory)).toThrow(/baseline evidence/)
})
test('pre-migration baseline preserves actual category absence with complete null customer rows',()=>{
 const value=baseline();value.schema.category_column=null as any;value.category_column_present=false;value.category_rows=[{id:customer,customer_category:null}] as any;value.protected_data['public.customers'].rows=1
 expect(()=>(ci as any).assertCustomerCategoryBaselineEvidence(value,false)).not.toThrow()
 expect(()=>(ci as any).assertCustomerCategoryBaselineEvidence(value,true)).toThrow(/baseline evidence/)
})
