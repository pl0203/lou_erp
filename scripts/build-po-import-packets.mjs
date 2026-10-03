// Pure private SQL packet compiler. No CLI, connection, file access or execution.
import { createHash } from 'node:crypto'

export const IMPORT_RELATIONS = Object.freeze([
  ...['users','customers','products','customer_manager_assignments','customer_sales_rep_assignments','customer_targets','sales_targets','sales_schedules','outlet_visits','visit_photos','purchase_orders','po_line_items','po_audit_log','promotions','girard_orders','girard_order_items','surat_jalan','sj_line_items','outlets','orders','order_line_items'].map(t => `public.${t}`),
  'private.pilot_order_requests','auth.users-safe-fields','storage.objects','storage.buckets',
])
export const IMPORT_FUNCTION_SIGNATURES = Object.freeze([
  'public.pilot_order_transaction(uuid,text,jsonb)', 'private.pilot_validate_order_lines(jsonb)',
  'private.pilot_insert_po(uuid,jsonb,jsonb)', 'private.pilot_reconcile_po(uuid)',
  'public.current_user_role()', 'auth.uid()', 'public.log_po_changes()',
  'public.log_line_item_changes()', 'public.log_sj_changes()', 'public.recalculate_po_total()', 'public.check_po_completion()',
])
// Default v1 bytes/identities are frozen. v2 is a separately reviewed new plan,
// never a schema-refresh or recovery path for any unfinished v1 import.
export const IMPORT_MODEL_VERSION = 'po-import-v1'
export const IMPORT_MODEL_VERSION_V2 = 'po-import-v2'
// Node-only mirror of the frozen frontend/migration contract, equality-tested.
export const IMPORT_CUSTOMER_CATEGORIES = Object.freeze([
  'supermarket_besar','supermarket_sedang','supermarket_kecil','tradisional_market','perorangan',
])
function manifestVersion(modelVersion) {
  if (modelVersion===IMPORT_MODEL_VERSION) return 1
  if (modelVersion===IMPORT_MODEL_VERSION_V2) return 2
  throw new Error('Unsupported import model')
}
// Reviewed deny fingerprint; the production reference itself is never published.
const PRODUCTION_REF_SHA256 = 'b9232010a9ecb6badf98b27953f21c8544219cf264441d09bcc4bbc6f41e8627'
const sha = value => createHash('sha256').update(value).digest('hex')
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  throw new Error('Plain finite JSON required')
}
export function hashImportManifest(value) { return sha(canonical(value)) }
const jsonSql = value => `convert_from(decode('${Buffer.from(canonical(value), 'utf8').toString('base64')}','base64'),'UTF8')::jsonb`
const literal = value => `'${value.replaceAll("'", "''")}'`
const fail = message => { throw new Error(message) }
function fields(value, allowed, name) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !allowed.includes(k))) fail(`Unexpected ${name} fields`)
}
function text(value, name, nullable = false) {
  if (nullable && (value === undefined || value === null)) return null
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 16000 || value !== value.trim()) fail(`Invalid ${name}`)
  return value
}
function provenance(value,name) {
  if (value===null || value==='') return value
  return text(value,name)
}
function date(value, name, nullable = false) {
  if (nullable && (value === undefined || value === null)) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2100-12-31' || new Date(value).toISOString().slice(0,10) !== value) fail(`Invalid ${name}`)
  return value
}
function integer(value, max, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(`Invalid ${name}`)
  return value
}
function list(value, name, min = 0, max = 10000) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`Invalid ${name} count`)
  return value
}
function unique(items, key, name) {
  if (new Set(items.map(key)).size !== items.length) fail(`Duplicate ${name}`)
}
function uuid(seed) {
  const h = sha(seed).slice(0,32).split(''); h[12] = '8'; h[16] = ((parseInt(h[16],16) & 3) | 8).toString(16)
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].map(a=>a.join('')).join('-')
}
function money(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) fail('Invalid exact historical price')
  const [whole,part='']=value.split('.')
  return BigInt(whole)*100n+BigInt(part.padEnd(2,'0'))
}
const moneyText = cents => `${cents / 100n}.${String(cents % 100n).padStart(2,'0')}`
const tiers = ['harga_pokok','luar_kota','dalam_kota','depo_bangunan','others']
function validateConfig(config, manifestSha256) {
  fields(config,['expectedManifestSha256','expectedProjectRef','expectedDatabase','disposableFixture','actorId','actorEmail','actorRole','schemaMd5','baselineData','expectedFunctionHashes','expectedAuditFields','batchSize'],'config')
  if (config.expectedManifestSha256 !== manifestSha256) fail('Reviewed manifest SHA256 mismatch')
  if (!['postgres','pilot_import_test'].includes(config.expectedDatabase) || !/^[a-z]{20}$/.test(config.expectedProjectRef ?? '')) fail('Exact reviewed project and database required')
  if (sha(config.expectedProjectRef)===PRODUCTION_REF_SHA256) fail('Production target is forbidden')
  if (config.expectedDatabase==='pilot_import_test' && config.disposableFixture!=='disposable-pilot-ci') fail('Explicit disposable fixture context required')
  if (config.expectedDatabase==='postgres' && config.disposableFixture!==undefined) fail('Disposable context cannot identify a hosted target')
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(config.actorId ?? '') || !['executive','po_admin'].includes(config.actorRole)) fail('Explicit authorized actor required')
  if (!text(config.actorEmail,'actor email').includes('@')) fail('Exact actor email required')
  if (!/^[a-f0-9]{32}$/.test(config.schemaMd5 ?? '')) fail('Schema fingerprint required')
  for (const [object, keys, kind] of [[config.baselineData, IMPORT_RELATIONS, 'baseline'],[config.expectedFunctionHashes, IMPORT_FUNCTION_SIGNATURES,'function']]) {
    fields(object, keys, kind)
    if (Object.keys(object).length !== keys.length) fail(`Complete ${kind} pins required`)
    for (const key of keys) {
      const value = object[key]
      if (kind === 'baseline') {
        fields(value,['rows','content_md5'],kind)
        if (!Number.isSafeInteger(value.rows) || value.rows < 0 || !/^[a-f0-9]{32}$/.test(value.content_md5 ?? '')) fail('Invalid baseline fingerprint')
      } else if (!/^[a-f0-9]{32}$/.test(value ?? '')) fail('Invalid function body pin')
    }
  }
  list(config.expectedAuditFields,'audit fields',4,4); unique(config.expectedAuditFields,x=>x,'audit field')
  if (!config.expectedAuditFields.includes('status') || !config.expectedAuditFields.includes('sj_lines_revised') || config.expectedAuditFields.some(x=>!/^\w{1,64}$/.test(x))) fail('Explicit reviewed audit fields required')
  integer(config.batchSize,100,'batch size')
}
function resolveManifest(manifest, manifestSha256, planSha256, batchSize, modelVersion) {
  fields(manifest,['version','customers','products','purchaseOrders'],'manifest')
  if (manifest.version !== manifestVersion(modelVersion)) fail('Unsupported manifest version for import model')
  const v2=modelVersion===IMPORT_MODEL_VERSION_V2
  const id = (kind,key) => uuid(`${manifestSha256}:${kind}:${key}`)
  const customers = list(manifest.customers,'customers',1).map(c => {
    fields(c,['key','name','address','city','phone','email','sourceTier','pricingTier',...(v2?['customer_category']:[])],'customer')
    const category=v2?Object.getOwnPropertyDescriptor(c,'customer_category'):null
    if (v2 && (!category?.enumerable || !Object.hasOwn(category,'value'))) fail('Explicit customer category mapping required')
    if (v2 && c.customer_category!==null && !IMPORT_CUSTOMER_CATEGORIES.includes(c.customer_category)) fail('Invalid explicit customer category mapping')
    text(c.key,'customer key'); provenance(c.sourceTier,'source tier')
    if (!tiers.includes(c.pricingTier)) fail('Unsupported customer pricing tier; use others')
    return { key:c.key,id:id('customer',c.key),name:text(c.name,'customer name'),address:text(c.address,'address',true),city:text(c.city,'city',true),phone:text(c.phone,'phone',true),email:text(c.email,'email',true),pricing_tier:c.pricingTier,visit_frequency_days:7,last_visit_date:null,sourceTier:c.sourceTier,...(v2?{customer_category:c.customer_category}:{}) }
  })
  unique(customers,c=>c.key,'customer key'); unique(customers,c=>c.name.toLowerCase(),'customer name')
  const products = list(manifest.products,'products',1).map(p => {
    fields(p,['key','name','sku','size'],'product'); text(p.key,'product key')
    return {key:p.key,id:id('product',p.key),name:text(p.name,'product name'),sku:text(p.sku,'product sku'),size:text(p.size,'size',true),unit_price:null,harga_pokok:null,luar_kota:null,dalam_kota:null,depo_bangunan:null}
  })
  unique(products,p=>p.key,'product key'); unique(products,p=>p.sku,'product SKU')
  const purchaseOrders = list(manifest.purchaseOrders,'anchor PO',1).map((p,index) => {
    fields(p,['key','customerKey','poNumber','orderDate','expectedDeliveryDate','sourceStatus','notes','lines','shipments'],'PO'); text(p.key,'PO key')
    const customer = customers.find(c=>c.key===p.customerKey)
    if (!customer) fail('Unknown PO customer')
    let total=0n
    const lines = list(p.lines,'PO lines',1,1000).map(l => {
      fields(l,['key','productKey','productName','sku','quantity','unitPrice','uom'],'PO line'); text(l.key,'line key')
      if (!products.some(product=>product.key===l.productKey)) fail('Unknown PO product')
      const cents=money(l.unitPrice), quantity=integer(l.quantity,2147483647,'line quantity'); total+=cents*BigInt(quantity)
      return {key:l.key,productKey:l.productKey,productName:text(l.productName,'historical product name'),sku:text(l.sku,'historical SKU',true),quantity,unitPrice:moneyText(cents),uom:text(l.uom,'source UOM')}
    })
    if (total>99999999999999n) fail('PO total exceeds numeric(14,2)')
    unique(lines,l=>l.key,'line key'); unique(lines,l=>canonical([l.sku,l.productName,l.quantity,l.unitPrice]),'ambiguous line tuple')
    const shipped = new Map(lines.map(l=>[l.key,0]))
    const shipments = list(p.shipments,'shipments',0,1000).map(s => {
      fields(s,['key','number','date','dateReceived','dateReturned','sourceSender','lines'],'shipment'); text(s.key,'shipment key')
      const deliveryLines = list(s.lines,'shipment lines',1,1000).map(l => {
        fields(l,['lineKey','quantity'],'shipment line')
        if (!shipped.has(l.lineKey)) fail('Unknown shipment line')
        const quantity=integer(l.quantity,2147483647,'shipment quantity'); shipped.set(l.lineKey,shipped.get(l.lineKey)+quantity)
        return {lineKey:l.lineKey,quantity}
      })
      unique(deliveryLines,l=>l.lineKey,'shipment line')
      return {key:s.key,requestId:uuid(canonical([planSha256,'delivery',p.key,s.key])),number:text(s.number,'shipment number'),date:date(s.date,'shipment date'),dateReceived:date(s.dateReceived,'received date',true),dateReturned:date(s.dateReturned,'returned date',true),sourceSender:text(s.sourceSender,'source sender',true),lines:deliveryLines}
    })
    unique(shipments,s=>s.key,'shipment key'); unique(shipments,s=>s.number,'shipment number')
    if (lines.some(l=>shipped.get(l.key)>l.quantity)) fail('Shipment exceeds ordered quantity')
    const status=shipments.length===0?'confirm':lines.every(l=>shipped.get(l.key)===l.quantity)?'complete':'in_progress'
    return {key:p.key,requestId:uuid(`${planSha256}:create:${p.key}`),packetIndex:index===0?0:1+Math.floor((index-1)/batchSize),customerId:customer.id,poNumber:text(p.poNumber,'PO number'),orderDate:date(p.orderDate,'order date'),expectedDeliveryDate:date(p.expectedDeliveryDate,'expected delivery date',true),sourceStatus:provenance(p.sourceStatus,'source status'),notes:text(p.notes,'notes',true),lines,shipments,totalValue:moneyText(total),status,auditCount:lines.length+2*shipments.length+(shipments.length===0?0:status==='complete'&&shipments.length>1?2:1)}
  })
  unique(purchaseOrders,p=>p.key,'PO key'); unique(purchaseOrders,p=>p.poNumber,'PO number')
  return {customers,products,purchaseOrders}
}
export function buildPoImportPackets({manifest,config,modelVersion=IMPORT_MODEL_VERSION}) {
  manifestVersion(modelVersion)
  const manifestSha256=hashImportManifest(manifest); validateConfig(config,manifestSha256)
  const planSha256=sha(canonical({model:modelVersion,manifestSha256,config}))
  const resolved=resolveManifest(manifest,manifestSha256,planSha256,config.batchSize,modelVersion)
  const counts=controls(resolved.customers.length,resolved.products.length,resolved.purchaseOrders)
  const runtime={model:modelVersion,manifestSha256,planSha256,config,resolved,counts}
  const packetCount=Math.max(...resolved.purchaseOrders.map(p=>p.packetIndex))+1
  runtime.prefixControls=Array.from({length:packetCount},(_,index)=>controls(resolved.customers.length,resolved.products.length,resolved.purchaseOrders.filter(p=>p.packetIndex<=index)))
  const packets=Array.from({length:packetCount},(_,index)=>{
    const orders=resolved.purchaseOrders.filter(p=>p.packetIndex===index),poKeys=orders.map(p=>p.key)
    const sql=packetSql(runtime,index)
    return {index,poKeys,counts:controls(index===0?resolved.customers.length:0,index===0?resolved.products.length:0,orders),sql,sha256:sha(sql)}
  })
  return {manifestSha256,planSha256,counts,resolved,packets}
}
function controls(customers,products,orders) {
  let orderedQuantity=0n,deliveredQuantity=0n,orderedValue=0n,deliveredValue=0n,poLines=0,shipments=0,shipmentLines=0
  for (const po of orders) {
    poLines+=po.lines.length; shipments+=po.shipments.length
    for (const l of po.lines) { orderedQuantity+=BigInt(l.quantity); orderedValue+=BigInt(l.quantity)*money(l.unitPrice) }
    for (const sj of po.shipments) for (const l of sj.lines) {
      shipmentLines++; deliveredQuantity+=BigInt(l.quantity); deliveredValue+=BigInt(l.quantity)*money(po.lines.find(x=>x.key===l.lineKey).unitPrice)
    }
  }
  return {customers,products,purchaseOrders:orders.length,poLines,shipments,shipmentLines,orderedQuantity:String(orderedQuantity),deliveredQuantity:String(deliveredQuantity),orderedValue:moneyText(orderedValue),deliveredValue:moneyText(deliveredValue)}
}
function sourceModel(value) {
  const text=canonical(value)
  return {text,sha256:sha(text),bytes:Buffer.byteLength(text,'utf8')}
}
function compactPacket(runtime,index) {
  // Fixed transport columns, versioned independently of business row timestamps.
  // Null catalog prices and the customer visit defaults are model invariants.
  const master=sourceModel({v:manifestVersion(runtime.model),c:runtime.resolved.customers.map(c=>[c.key,c.id,c.name,c.address,c.city,c.phone,c.email,c.pricing_tier,c.sourceTier,...(runtime.model===IMPORT_MODEL_VERSION_V2?[c.customer_category]:[])]),p:runtime.resolved.products.map(p=>[p.key,p.id,p.name,p.sku,p.size])})
  const currentModels=[],descriptors=runtime.resolved.purchaseOrders.map(p=>{
    const model=sourceModel(p)
    if(p.packetIndex===index) currentModels.push({key:p.key,...model})
    return [p.key,p.poNumber,p.requestId,p.packetIndex,p.shipments.map(s=>[s.key,s.requestId]),model.sha256,model.bytes]
  })
  const {resolved,...meta}=runtime
  return {...meta,packetIndex:index,masterModel:index===0?master:{sha256:master.sha256,bytes:master.bytes},currentModels,descriptors}
}
export function assertPoImportPacketSet({packets,...input}) {
  const expected=buildPoImportPackets(input).packets
  if (!Array.isArray(packets) || canonical(packets)!==canonical(expected)) fail('Final packet set differs from the reviewed source/config')
  return expected.map(p=>p.sha256)
}

// Same fixed metadata model as the reviewed read-rollout snapshot.
const SCHEMA_STATE_SQL = `SELECT jsonb_build_object(
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN('public','private','storage')),
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND c.relkind='r'),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'number',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum),'acl',a.attacl::text) ORDER BY a.attrelid::regclass::text,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
 'enums',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'type',t.typname,'label',e.enumlabel,'order',e.enumsortorder) ORDER BY n.nspname,t.typname,e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN('public','private')),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conrelid::regclass::text,c.conname) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN('public','private','storage')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN('public','private','storage')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'volatility',p.provolatile,'definer',p.prosecdef,'leakproof',p.proleakproof,'strict',p.proisstrict,'parallel',p.proparallel,'config',p.proconfig,'acl',p.proacl::text,'arguments',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),'body_md5',md5(p.prosrc)) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN('public','private') AND p.prokind='f'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgrelid::regclass::text,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND NOT t.tgisinternal),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('table',i.indrelid::regclass::text,'name',i.indexrelid::regclass::text,'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid::regclass::text) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'bypass_rls',rolbypassrls) ORDER BY rolname) FROM pg_roles WHERE rolname IN('anon','authenticated')),
 'memberships',(SELECT jsonb_agg(jsonb_build_object('member',pg_get_userbyid(m.member),'role',pg_get_userbyid(m.roleid),'admin_option',m.admin_option) ORDER BY m.member,m.roleid) FROM pg_auth_members m WHERE m.member IN(SELECT oid FROM pg_roles WHERE rolname IN('anon','authenticated'))),
 'auth_uid',(SELECT jsonb_build_object('volatility',provolatile,'definer',prosecdef,'returns',prorettype::regtype::text,'args',pronargs) FROM pg_proc WHERE oid='auth.uid()'::regprocedure)
) AS value`

function dataStateSql(excludeOwned) {
  return IMPORT_RELATIONS.map(relation=>{
    let table=relation, row='to_jsonb(r)', sort='md5(to_jsonb(r)::text)', filter=''
    if (relation==='auth.users-safe-fields') {
      table='auth.users'; row="jsonb_build_object('id',id,'email',email,'role',role,'aud',aud,'created_at',created_at)"; sort='id'
    } else if (relation==='storage.objects') {
      row="jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,'owner_id',owner_id,'metadata',metadata)"; sort='id'
    } else if (relation==='storage.buckets') sort='id'
    if (excludeOwned && ['public.customers','public.products','public.purchase_orders','public.po_line_items','public.surat_jalan','public.sj_line_items','public.po_audit_log','private.pilot_order_requests'].includes(relation)) {
      filter=` WHERE NOT EXISTS(SELECT 1 FROM pg_temp.import_owned o WHERE o.relation=${literal(relation)} AND o.id=r.${relation==='private.pilot_order_requests'?'request_id':'id'}${relation==='private.pilot_order_requests'?" AND r.actor_id=(SELECT (value->'config'->>'actorId')::uuid FROM pg_temp.import_context)":''})`
    }
    return `SELECT ${literal(relation)} AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(${row}::text),'' ORDER BY ${sort}),'')) AS content_md5 FROM ${table} r${filter}`
  }).join('\nUNION ALL\n')
}
// The caller captures this read-only query under UTC and an empty search_path,
// exactly as the packet does. It contains no credentials or workbook records.
export function buildPoImportBaselineSql({modelVersion=IMPORT_MODEL_VERSION}={}) {
  manifestVersion(modelVersion)
  return `WITH schema_state AS (${SCHEMA_STATE_SQL}),data_state AS (${dataStateSql(false)})
SELECT jsonb_build_object('model',${literal(modelVersion)},'database',current_database(),'current_user',current_user,'session_user',session_user,'schema_md5',md5(s.value::text),
 'baselineData',(SELECT jsonb_object_agg(relation,jsonb_build_object('rows',rows,'content_md5',content_md5) ORDER BY relation) FROM data_state),
 'expectedFunctionHashes',(SELECT jsonb_object_agg(signature,md5(p.prosrc)) FROM unnest(ARRAY[${IMPORT_FUNCTION_SIGNATURES.map(literal).join(',')}]) signature JOIN pg_proc p ON p.oid=to_regprocedure(signature))) AS import_preflight
FROM schema_state s;\n`
}

function loadModelsSql(modelVersion) {
  const v2=modelVersion===IMPORT_MODEL_VERSION_V2
  return `
CREATE FUNCTION pg_temp.import_decode_model(model_text text,expected_sha text,expected_bytes integer) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $fn$
BEGIN
 IF model_text IS NULL OR expected_sha IS NULL OR expected_bytes IS NULL OR octet_length(convert_to(model_text,'UTF8'))<>expected_bytes
 OR encode(pg_catalog.sha256(convert_to(model_text,'UTF8')),'hex') IS DISTINCT FROM expected_sha THEN RAISE EXCEPTION 'Stored source model changed'; END IF;
 RETURN model_text::jsonb;
END $fn$;
CREATE TEMP TABLE import_master_model(model_text text NOT NULL,sha256 text NOT NULL,bytes integer NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE import_po_models(key text PRIMARY KEY,model_text text NOT NULL,sha256 text NOT NULL,bytes integer NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE import_po_state(ordinal integer PRIMARY KEY,value jsonb NOT NULL) ON COMMIT DROP;
DO $load_models$
DECLARE doc jsonb; d jsonb; m jsonb; p jsonb; masters jsonb; prov jsonb; actor uuid; anchor_id uuid; model_text text;
 anchor private.pilot_order_requests%ROWTYPE; request private.pilot_order_requests%ROWTYPE; keyset text[]; expected_keys text[]; ord integer:=0;
BEGIN
 SELECT value INTO STRICT doc FROM pg_temp.import_packet_input;${v2?"\n IF doc->>'model' IS DISTINCT FROM 'po-import-v2' THEN RAISE EXCEPTION 'Import model changed'; END IF;":""}
 IF jsonb_typeof(doc->'descriptors') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(doc->'descriptors') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'array' OR jsonb_array_length(x)<>7 OR jsonb_typeof(x->4) IS DISTINCT FROM 'array')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(doc->'descriptors') x CROSS JOIN LATERAL jsonb_array_elements(x->4) s WHERE jsonb_typeof(s) IS DISTINCT FROM 'array' OR jsonb_array_length(s)<>2) THEN RAISE EXCEPTION 'Source model descriptor shape changed'; END IF;
 SELECT jsonb_agg(jsonb_build_object('key',x->0,'poNumber',x->1,'requestId',x->2,'packetIndex',x->3,
  'shipments',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',s->0,'requestId',s->1) ORDER BY i),'[]') FROM jsonb_array_elements(x->4) WITH ORDINALITY z(s,i)),
  'modelSha256',x->5,'modelBytes',x->6) ORDER BY n) INTO d FROM jsonb_array_elements(doc->'descriptors') WITH ORDINALITY a(x,n);
 doc:=jsonb_set(doc,'{descriptors}',d);
 actor:=(doc->'config'->>'actorId')::uuid; anchor_id:=(doc->'descriptors'->0->>'requestId')::uuid;
 SELECT * INTO anchor FROM private.pilot_order_requests WHERE actor_id=actor AND request_id=anchor_id;
 IF FOUND THEN
  IF anchor.operation<>'create_po' OR anchor.result IS NULL OR anchor.abandoned THEN RAISE EXCEPTION 'Invalid master ownership anchor'; END IF;
  prov:=anchor.payload->'import_provenance'; model_text:=prov->>'master_model';
  IF prov->>'master_model_sha256' IS DISTINCT FROM doc->'masterModel'->>'sha256' OR (prov->>'master_model_bytes')::integer IS DISTINCT FROM (doc->'masterModel'->>'bytes')::integer THEN RAISE EXCEPTION 'Stored source model changed'; END IF;
 ELSE
  IF (doc->>'packetIndex')::integer<>0 THEN RAISE EXCEPTION 'Prior packet must commit and verify before this packet'; END IF;
  model_text:=doc->'masterModel'->>'text';
 END IF;
 masters:=pg_temp.import_decode_model(model_text,doc->'masterModel'->>'sha256',(doc->'masterModel'->>'bytes')::integer);
 IF doc->'masterModel' ? 'text' AND doc->'masterModel'->>'text' IS DISTINCT FROM model_text THEN RAISE EXCEPTION 'Stored source model changed'; END IF;
 INSERT INTO pg_temp.import_master_model VALUES(model_text,doc->'masterModel'->>'sha256',(doc->'masterModel'->>'bytes')::integer);
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(masters) k) IS DISTINCT FROM ARRAY['c','p','v']::text[] OR masters->'v' IS DISTINCT FROM '${v2?2:1}'::jsonb
 OR jsonb_typeof(masters->'c') IS DISTINCT FROM 'array' OR jsonb_typeof(masters->'p') IS DISTINCT FROM 'array'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(masters->'c') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'array' OR jsonb_array_length(x)<>${v2?10:9})
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(masters->'p') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'array' OR jsonb_array_length(x)<>5) THEN RAISE EXCEPTION 'Master source model shape changed'; END IF;${v2?`
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(masters->'c') x WHERE x->9 IS DISTINCT FROM 'null'::jsonb
  AND (jsonb_typeof(x->9) IS DISTINCT FROM 'string' OR NOT (x->>9=ANY(ARRAY[${IMPORT_CUSTOMER_CATEGORIES.map(literal).join(',')}])))) THEN RAISE EXCEPTION 'Invalid explicit customer category model'; END IF;`:''}
 SELECT jsonb_build_object('customers',(SELECT jsonb_agg(jsonb_build_object('key',x->0,'id',x->1,'name',x->2,'address',x->3,'city',x->4,'phone',x->5,'email',x->6,'pricing_tier',x->7,'sourceTier',x->8${v2?",'customer_category',x->9":''},'visit_frequency_days',7,'last_visit_date',NULL) ORDER BY n) FROM jsonb_array_elements(masters->'c') WITH ORDINALITY a(x,n)),
  'products',(SELECT jsonb_agg(jsonb_build_object('key',x->0,'id',x->1,'name',x->2,'sku',x->3,'size',x->4,'unit_price',NULL,'harga_pokok',NULL,'luar_kota',NULL,'dalam_kota',NULL,'depo_bangunan',NULL) ORDER BY n) FROM jsonb_array_elements(masters->'p') WITH ORDINALITY a(x,n))) INTO masters;
 FOR m IN SELECT value FROM jsonb_array_elements(doc->'currentModels') LOOP
  SELECT value INTO STRICT d FROM jsonb_array_elements(doc->'descriptors') WHERE value->>'key'=m->>'key';
  IF (d->>'packetIndex')::integer<>(doc->>'packetIndex')::integer OR m->>'sha256' IS DISTINCT FROM d->>'modelSha256' OR (m->>'bytes')::integer IS DISTINCT FROM (d->>'modelBytes')::integer THEN RAISE EXCEPTION 'Source model descriptor mismatch'; END IF;
  PERFORM pg_temp.import_decode_model(m->>'text',d->>'modelSha256',(d->>'modelBytes')::integer);
  INSERT INTO pg_temp.import_po_models VALUES(m->>'key',m->>'text',d->>'modelSha256',(d->>'modelBytes')::integer);
 END LOOP;
 IF (SELECT count(*) FROM pg_temp.import_po_models)<>(SELECT count(*) FROM jsonb_array_elements(doc->'descriptors') x WHERE (x->>'packetIndex')::integer=(doc->>'packetIndex')::integer) THEN RAISE EXCEPTION 'Current packet source models missing'; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(doc->'descriptors') LOOP
  SELECT * INTO request FROM private.pilot_order_requests WHERE actor_id=actor AND request_id=(d->>'requestId')::uuid;
  IF FOUND THEN
   IF request.operation<>'create_po' OR request.result IS NULL OR request.abandoned THEN RAISE EXCEPTION 'Committed packet is incomplete'; END IF;
   prov:=request.payload->'import_provenance';
   expected_keys:=ARRAY['model','manifest_sha256','plan_sha256','source_key','master_rows_md5','po_model','po_model_sha256','po_model_bytes'];
   IF request.request_id=anchor_id THEN expected_keys:=expected_keys||ARRAY['master_model','master_model_sha256','master_model_bytes']; END IF;
   SELECT array_agg(k ORDER BY k) INTO expected_keys FROM unnest(expected_keys) k;
   SELECT array_agg(k ORDER BY k) INTO keyset FROM jsonb_object_keys(prov) k;
   IF keyset IS DISTINCT FROM expected_keys THEN RAISE EXCEPTION 'Source model provenance keys changed'; END IF;
   IF prov->>'po_model_sha256' IS DISTINCT FROM d->>'modelSha256' OR (prov->>'po_model_bytes')::integer IS DISTINCT FROM (d->>'modelBytes')::integer THEN RAISE EXCEPTION 'Stored source model changed'; END IF;
   model_text:=prov->>'po_model';
   PERFORM pg_temp.import_decode_model(model_text,d->>'modelSha256',(d->>'modelBytes')::integer);
   IF EXISTS(SELECT 1 FROM pg_temp.import_po_models WHERE key=d->>'key') THEN
    IF (SELECT x.model_text FROM pg_temp.import_po_models x WHERE key=d->>'key') IS DISTINCT FROM model_text THEN RAISE EXCEPTION 'Stored source model changed'; END IF;
   ELSE INSERT INTO pg_temp.import_po_models VALUES(d->>'key',model_text,d->>'modelSha256',(d->>'modelBytes')::integer); END IF;
  END IF;
  SELECT x.model_text INTO model_text FROM pg_temp.import_po_models x WHERE key=d->>'key';
  IF FOUND THEN
   p:=pg_temp.import_decode_model(model_text,d->>'modelSha256',(d->>'modelBytes')::integer);
   IF jsonb_build_object('key',p->>'key','poNumber',p->>'poNumber','requestId',p->>'requestId','packetIndex',p->'packetIndex',
    'shipments',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',s->>'key','requestId',s->>'requestId') ORDER BY n),'[]') FROM jsonb_array_elements(p->'shipments') WITH ORDINALITY x(s,n)))
    IS DISTINCT FROM d-'modelSha256'-'modelBytes' THEN RAISE EXCEPTION 'Source model descriptor mismatch'; END IF;
  ELSE p:=d; END IF;
  INSERT INTO pg_temp.import_po_state VALUES(ord,p); ord:=ord+1;
 END LOOP;
 INSERT INTO pg_temp.import_context SELECT (doc-'masterModel'-'currentModels'-'descriptors'-'packetIndex')||jsonb_build_object('resolved',masters||jsonb_build_object('purchaseOrders',(SELECT jsonb_agg(value ORDER BY ordinal) FROM pg_temp.import_po_state)));
END $load_models$;
CREATE TEMP TABLE import_metadata ON COMMIT DROP AS SELECT (value-'resolved'-'prefixControls')||jsonb_build_object('anchor_request_id',value->'resolved'->'purchaseOrders'->0->>'requestId') AS value FROM pg_temp.import_context;
`
}

const HELPERS_SQL = `
CREATE FUNCTION pg_temp.import_master_hash() RETURNS text LANGUAGE sql STABLE SET search_path='' AS $fn$
 SELECT md5(jsonb_build_object(
  'customers',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.customers c WHERE c.id IN(SELECT (x->>'id')::uuid FROM pg_temp.import_context, jsonb_array_elements(value->'resolved'->'customers') x)),
  'products',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.products p WHERE p.id IN(SELECT (x->>'id')::uuid FROM pg_temp.import_context, jsonb_array_elements(value->'resolved'->'products') x)))::text)
$fn$;
CREATE FUNCTION pg_temp.import_create_payload(p jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $fn$
 SELECT jsonb_build_object('customer_id',p->>'customerId','po_number',p->>'poNumber','order_date',p->>'orderDate','expected_delivery_date',p->'expectedDeliveryDate',
 'notes',coalesce(p->>'notes','')||E'\\n[Import provenance] '||jsonb_build_object('manifest_sha256',c.value->>'manifestSha256','sourceKey',p->>'key','sourceStatus',p->>'sourceStatus',
   'lines',(SELECT jsonb_agg(jsonb_build_object('key',l->>'key','productKey',l->>'productKey','uom',l->>'uom') ORDER BY ord) FROM jsonb_array_elements(p->'lines') WITH ORDINALITY a(l,ord)),
   'shipments',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',s->>'key','sourceSender',s->'sourceSender') ORDER BY ord),'[]') FROM jsonb_array_elements(p->'shipments') WITH ORDINALITY a(s,ord)))::text,
 'items',(SELECT jsonb_agg(jsonb_build_object('product_name',l->>'productName','sku',l->'sku','quantity',(l->>'quantity')::integer,'unit_price',(l->>'unitPrice')::numeric) ORDER BY ord) FROM jsonb_array_elements(p->'lines') WITH ORDINALITY a(l,ord)),
 'import_provenance',jsonb_build_object('model',c.value->>'model','manifest_sha256',c.value->>'manifestSha256','plan_sha256',c.value->>'planSha256','source_key',p->>'key','master_rows_md5',(SELECT master_rows_md5 FROM pg_temp.import_master_state),
  'po_model',m.model_text,'po_model_sha256',m.sha256,'po_model_bytes',m.bytes)||CASE WHEN p->>'requestId'=c.value->>'anchor_request_id' THEN (SELECT jsonb_build_object('master_model',model_text,'master_model_sha256',sha256,'master_model_bytes',bytes) FROM pg_temp.import_master_model) ELSE '{}'::jsonb END)
 FROM pg_temp.import_metadata c JOIN pg_temp.import_po_models m ON m.key=p->>'key'
$fn$;
CREATE FUNCTION pg_temp.import_delivery_payload(p jsonb,s jsonb,po uuid,version timestamptz) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE input_line jsonb; source_line jsonb; found_ids uuid[]; items jsonb:='[]';
BEGIN
 FOR input_line IN SELECT value FROM jsonb_array_elements(s->'lines') LOOP
  SELECT value INTO STRICT source_line FROM jsonb_array_elements(p->'lines') WHERE value->>'key'=input_line->>'lineKey';
  SELECT array_agg(l.id) INTO found_ids FROM public.po_line_items l WHERE l.purchase_order_id=po
   AND l.sku IS NOT DISTINCT FROM source_line->>'sku' AND l.product_name=source_line->>'productName'
   AND l.quantity=(source_line->>'quantity')::integer AND l.unit_price=(source_line->>'unitPrice')::numeric;
  IF coalesce(cardinality(found_ids),0)<>1 THEN RAISE EXCEPTION 'PO line tuple mismatch'; END IF;
  items:=items||jsonb_build_array(jsonb_build_object('po_line_item_id',found_ids[1],'quantity_delivered',(input_line->>'quantity')::integer));
 END LOOP;
 RETURN jsonb_build_object('po_id',po,'expected_updated_at',version,'sj_number',s->>'number','sj_date',s->>'date','sj_date_received',s->'dateReceived','sj_date_returned',s->'dateReturned','lines',items,
  'import_provenance',jsonb_build_object('source_key',s->>'key','source_sender',s->'sourceSender','plan_sha256',(SELECT value->>'planSha256' FROM pg_temp.import_metadata)));
END $fn$;

-- Owner-only inspection; all business writes happen later under authenticated.
CREATE FUNCTION pg_temp.import_verify_state() RETURNS integer LANGUAGE plpgsql SET search_path='' AS $fn$
DECLARE cfg jsonb; doc jsonb; p jsonb; s jsonb; l jsonb; master jsonb; request private.pilot_order_requests%ROWTYPE;
 po public.purchase_orders%ROWTYPE; h public.surat_jalan%ROWTYPE; previous_version timestamptz; expected jsonb; actual jsonb;
 master_hash text; anchor private.pilot_order_requests%ROWTYPE; actor uuid; n integer; last_packet integer:=-1; gap boolean:=false; packet_complete boolean; packet_present boolean; packet integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Owner inspection required'; END IF;
 SELECT value,value->'config' INTO STRICT doc,cfg FROM pg_temp.import_context; actor:=(cfg->>'actorId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=actor AND u.email=cfg->>'actorEmail' AND u.is_active AND u.role::text=cfg->>'actorRole') THEN RAISE EXCEPTION 'Reviewed active actor changed'; END IF;
 TRUNCATE pg_temp.import_owned;
 master_hash:=pg_temp.import_master_hash();
 TRUNCATE pg_temp.import_master_state;
 INSERT INTO pg_temp.import_master_state VALUES(master_hash);
 SELECT * INTO anchor FROM private.pilot_order_requests WHERE actor_id=actor AND request_id=(doc->'resolved'->'purchaseOrders'->0->>'requestId')::uuid;
 IF FOUND THEN
  IF anchor.operation<>'create_po' OR anchor.result IS NULL OR anchor.abandoned THEN RAISE EXCEPTION 'Invalid master ownership anchor'; END IF;
  IF anchor.payload->'import_provenance'->>'master_rows_md5' IS DISTINCT FROM master_hash THEN RAISE EXCEPTION 'Source-owned master rows changed'; END IF;
  FOR master IN SELECT value FROM jsonb_array_elements(doc->'resolved'->'customers') LOOP
   SELECT to_jsonb(c)-'created_at' INTO actual FROM public.customers c WHERE c.id=(master->>'id')::uuid;
   IF actual IS DISTINCT FROM master-'key'-'sourceTier' THEN RAISE EXCEPTION 'Customer source fields changed'; END IF;
   INSERT INTO pg_temp.import_owned VALUES('public.customers',(master->>'id')::uuid);
  END LOOP;
  FOR master IN SELECT value FROM jsonb_array_elements(doc->'resolved'->'products') LOOP
   SELECT to_jsonb(c)-'created_at' INTO actual FROM public.products c WHERE c.id=(master->>'id')::uuid;
   IF actual IS DISTINCT FROM master-'key' THEN RAISE EXCEPTION 'Product source fields changed'; END IF;
   INSERT INTO pg_temp.import_owned VALUES('public.products',(master->>'id')::uuid);
  END LOOP;
 ELSE
  IF EXISTS(SELECT 1 FROM public.customers c,jsonb_array_elements(doc->'resolved'->'customers') e WHERE c.id=(e->>'id')::uuid OR lower(btrim(c.name))=lower(e->>'name'))
   OR EXISTS(SELECT 1 FROM public.products c,jsonb_array_elements(doc->'resolved'->'products') e WHERE c.id=(e->>'id')::uuid OR c.sku=e->>'sku') THEN RAISE EXCEPTION 'Unrelated master collision without ledger anchor'; END IF;
 END IF;
 FOR packet IN SELECT DISTINCT (value->>'packetIndex')::integer FROM jsonb_array_elements(doc->'resolved'->'purchaseOrders') ORDER BY 1 LOOP
  packet_present:=false; packet_complete:=true;
  FOR p IN SELECT value FROM jsonb_array_elements(doc->'resolved'->'purchaseOrders') WHERE (value->>'packetIndex')::integer=packet LOOP
   SELECT * INTO request FROM private.pilot_order_requests WHERE actor_id=actor AND request_id=(p->>'requestId')::uuid;
   IF NOT FOUND THEN
    packet_complete:=false;
    IF EXISTS(SELECT 1 FROM public.purchase_orders WHERE po_number=p->>'poNumber') OR EXISTS(SELECT 1 FROM private.pilot_order_requests r,jsonb_array_elements(p->'shipments') x WHERE r.actor_id=actor AND r.request_id=(x->>'requestId')::uuid) THEN RAISE EXCEPTION 'Unrelated PO/request collision'; END IF;
    CONTINUE;
   END IF;
   packet_present:=true;
   IF anchor.result IS NULL OR request.operation<>'create_po' OR request.result IS NULL OR request.abandoned THEN RAISE EXCEPTION 'Committed packet is incomplete'; END IF;
   expected:=pg_temp.import_create_payload(p);
   IF request.payload IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Saved request payload changed'; END IF;
   IF jsonb_typeof(request.result)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(request.result) key) IS DISTINCT FROM ARRAY['id','updated_at']::text[] THEN RAISE EXCEPTION 'Create result contract changed'; END IF;
   SELECT * INTO po FROM public.purchase_orders WHERE id=(request.result->>'id')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Committed PO missing'; END IF;
   previous_version:=(request.result->>'updated_at')::timestamptz;
   SELECT count(*) INTO n FROM public.po_line_items WHERE purchase_order_id=po.id;
   IF n<>jsonb_array_length(p->'lines') THEN RAISE EXCEPTION 'PO line tuple mismatch'; END IF;
   FOR l IN SELECT value FROM jsonb_array_elements(p->'lines') LOOP
    SELECT count(*) INTO n FROM public.po_line_items x WHERE x.purchase_order_id=po.id AND x.sku IS NOT DISTINCT FROM l->>'sku' AND x.product_name=l->>'productName' AND x.quantity=(l->>'quantity')::integer AND x.unit_price=(l->>'unitPrice')::numeric AND x.line_total=(l->>'quantity')::numeric*(l->>'unitPrice')::numeric;
    IF n<>1 THEN RAISE EXCEPTION 'PO line tuple mismatch'; END IF;
   END LOOP;
   INSERT INTO pg_temp.import_owned VALUES('private.pilot_order_requests',(p->>'requestId')::uuid);
   SELECT count(*) INTO n FROM public.surat_jalan WHERE purchase_order_id=po.id;
   IF n<>jsonb_array_length(p->'shipments') THEN RAISE EXCEPTION 'Delivery state changed'; END IF;
   FOR s IN SELECT value FROM jsonb_array_elements(p->'shipments') LOOP
    SELECT * INTO request FROM private.pilot_order_requests WHERE actor_id=actor AND request_id=(s->>'requestId')::uuid;
    IF NOT FOUND OR request.operation<>'save_delivery' OR request.result IS NULL OR request.abandoned THEN RAISE EXCEPTION 'Committed packet is incomplete'; END IF;
    expected:=pg_temp.import_delivery_payload(p,s,po.id,previous_version);
    IF request.payload IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Saved request payload changed'; END IF;
    IF jsonb_typeof(request.result)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(request.result) key) IS DISTINCT FROM ARRAY['id','po_id','updated_at']::text[] OR request.result->>'po_id' IS DISTINCT FROM po.id::text THEN RAISE EXCEPTION 'Delivery result contract changed'; END IF;
    SELECT * INTO h FROM public.surat_jalan WHERE id=(request.result->>'id')::uuid;
    IF NOT FOUND OR ROW(h.purchase_order_id,h.sj_number,h.sj_date,h.sj_date_received,h.sj_date_returned,h.created_by,h.voided_at,h.voided_by,h.void_reason)
      IS DISTINCT FROM ROW(po.id,s->>'number',(s->>'date')::date,(s->>'dateReceived')::date,(s->>'dateReturned')::date,actor,NULL::timestamptz,NULL::uuid,NULL::text) THEN RAISE EXCEPTION 'Delivery state changed'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('po_line_item_id',x.po_line_item_id,'quantity_delivered',x.quantity_delivered) ORDER BY x.po_line_item_id),'[]') INTO actual FROM public.sj_line_items x WHERE x.surat_jalan_id=h.id;
    SELECT jsonb_agg(x ORDER BY x->>'po_line_item_id') INTO expected FROM jsonb_array_elements(expected->'lines') x;
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Delivery state changed'; END IF;
    previous_version:=(request.result->>'updated_at')::timestamptz;
    INSERT INTO pg_temp.import_owned VALUES('private.pilot_order_requests',(s->>'requestId')::uuid),('public.surat_jalan',h.id);
    INSERT INTO pg_temp.import_owned SELECT 'public.sj_line_items',id FROM public.sj_line_items WHERE surat_jalan_id=h.id;
   END LOOP;
   expected:=pg_temp.import_create_payload(p);
   IF ROW(po.customer_id,po.created_by,po.po_number,po.status::text,po.order_date,po.expected_delivery_date,po.total_value,po.notes,po.updated_at)
    IS DISTINCT FROM ROW((p->>'customerId')::uuid,actor,p->>'poNumber',p->>'status',(p->>'orderDate')::date,(p->>'expectedDeliveryDate')::date,(p->>'totalValue')::numeric,expected->>'notes',previous_version)
    OR (po.status='complete') IS DISTINCT FROM (po.completed_at IS NOT NULL) THEN RAISE EXCEPTION 'PO source fields or workflow version changed'; END IF;
   SELECT count(*) INTO n FROM public.po_audit_log WHERE purchase_order_id=po.id;
   IF n<>(p->>'auditCount')::integer OR EXISTS(SELECT 1 FROM public.po_audit_log a WHERE a.purchase_order_id=po.id AND (a.changed_by IS DISTINCT FROM actor OR NOT coalesce(cfg->'expectedAuditFields' ? a.field_changed,false) OR a.changed_at IS NULL OR a.changed_at<po.created_at OR a.changed_at>po.updated_at)) THEN RAISE EXCEPTION 'Import audit count/actor/fields/time changed'; END IF;
   INSERT INTO pg_temp.import_owned VALUES('public.purchase_orders',po.id);
   INSERT INTO pg_temp.import_owned SELECT 'public.po_line_items',id FROM public.po_line_items WHERE purchase_order_id=po.id;
   INSERT INTO pg_temp.import_owned SELECT 'public.po_audit_log',id FROM public.po_audit_log WHERE purchase_order_id=po.id;
  END LOOP;
  IF packet_present AND NOT packet_complete THEN RAISE EXCEPTION 'Committed packet is incomplete'; END IF;
  IF packet_present AND gap THEN RAISE EXCEPTION 'Noncontiguous committed packet'; END IF;
  IF packet_present THEN last_packet:=packet; ELSE gap:=true; END IF;
 END LOOP;
 RETURN last_packet;
END $fn$;
`

function packetSql(runtime,index) {
  const {config,resolved,planSha256}=runtime
  const packetInput=compactPacket(runtime,index)
  const receipt=`import_receipt_${planSha256.slice(0,12)}_${index}`
  const claim=literal(canonical({sub:config.actorId,role:'authenticated'}))
  const authenticated=`SET LOCAL ROLE authenticated;
DO $identity$ BEGIN
 IF current_user<>'authenticated' OR auth.uid() IS DISTINCT FROM '${config.actorId}'::uuid OR public.current_user_role()::text IS DISTINCT FROM '${config.actorRole}'
 OR NOT row_security_active('public.customers') OR NOT row_security_active('public.products') OR NOT row_security_active('public.purchase_orders') OR NOT row_security_active('public.po_line_items') OR NOT row_security_active('public.surat_jalan') OR NOT row_security_active('public.sj_line_items') THEN RAISE EXCEPTION 'Effective authenticated actor/RLS required'; END IF;
END $identity$;
`
  const executeAction=`${authenticated}SELECT public.pilot_order_transaction(request_id,operation,payload) FROM pg_temp.import_actions;
RESET ROLE;
`
  const operations=[]
  for (const [poIndex,p] of resolved.purchaseOrders.entries()) {
    if (p.packetIndex!==index) continue
    operations.push(`TRUNCATE pg_temp.import_actions;
INSERT INTO pg_temp.import_actions SELECT (p->>'requestId')::uuid,'create_po',pg_temp.import_create_payload(p)
FROM pg_temp.import_context c CROSS JOIN LATERAL (SELECT c.value->'resolved'->'purchaseOrders'->${poIndex} AS p) selected
WHERE NOT (SELECT skip FROM pg_temp.import_state);
${executeAction}`)
    p.shipments.forEach((_s,shipmentIndex)=>{
      operations.push(`TRUNCATE pg_temp.import_actions;
INSERT INTO pg_temp.import_actions SELECT (s->>'requestId')::uuid,'save_delivery',pg_temp.import_delivery_payload(p,s,po.id,po.updated_at)
FROM pg_temp.import_context c CROSS JOIN LATERAL (SELECT c.value->'resolved'->'purchaseOrders'->${poIndex} AS p) selected
CROSS JOIN LATERAL (SELECT p->'shipments'->${shipmentIndex} AS s) shipment
JOIN private.pilot_order_requests r ON r.actor_id='${config.actorId}'::uuid AND r.request_id=(p->>'requestId')::uuid
JOIN public.purchase_orders po ON po.id=(r.result->>'id')::uuid
WHERE NOT (SELECT skip FROM pg_temp.import_state);
${executeAction}`)
    })
  }
  const masters=index===0?`${authenticated}INSERT INTO public.customers(id,name,address,city,phone,email,pricing_tier,visit_frequency_days,last_visit_date${runtime.model===IMPORT_MODEL_VERSION_V2?',customer_category':''})
SELECT (x->>'id')::uuid,x->>'name',x->>'address',x->>'city',x->>'phone',x->>'email',(x->>'pricing_tier')::public.pricing_tier,7,NULL${runtime.model===IMPORT_MODEL_VERSION_V2?",x->>'customer_category'":''}
FROM pg_temp.import_master_input,jsonb_array_elements(value->'customers') x WHERE NOT skip;
INSERT INTO public.products(id,name,sku,size,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan)
SELECT (x->>'id')::uuid,x->>'name',x->>'sku',x->>'size',NULL,NULL,NULL,NULL,NULL
FROM pg_temp.import_master_input,jsonb_array_elements(value->'products') x WHERE NOT skip;
RESET ROLE;
TRUNCATE pg_temp.import_master_state;
INSERT INTO pg_temp.import_master_state SELECT pg_temp.import_master_hash();
`:''
  return `-- PRIVATE REVIEW ARTIFACT: contains source data encoded as JSON, not anonymized data.
-- Independently verify the exact project destination ${config.expectedProjectRef}; this label is not identity proof.
-- Fixed manifest ${runtime.manifestSha256}; plan ${planSha256}; packet ${index}.
-- Review the exact final bytes and counts before execution. No import is authorized by this generator.
-- Required transport: stop at the first SQL error; accept only an error-free committed receipt.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path='';
SET LOCAL TIME ZONE 'UTC';
DO $target$ BEGIN
 IF current_database()<>${literal(config.expectedDatabase)} OR current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'Reviewed database and owner required'; END IF;
 ${config.expectedDatabase==='pilot_import_test'?"IF NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Actual disposable marker required'; END IF;":''}
END $target$;
-- Keep the committed receipt as the final statement for SQL-editor transports.
-- A same-session retry may remove only its own previous verified temp receipt.
DO $receipt_cleanup$ DECLARE matches boolean; BEGIN
 IF to_regclass('pg_temp.${receipt}') IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('pg_temp.${receipt}') AND relkind='r' AND relpersistence='t' AND relnamespace=pg_my_temp_schema() AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN RAISE EXCEPTION 'Unexpected temporary receipt identity'; END IF;
  SELECT count(*)=1 AND bool_and(value->>'manifest_sha256'='${runtime.manifestSha256}' AND value->>'plan_sha256'='${planSha256}' AND value->>'packet_index'='${index}') INTO matches FROM pg_temp.${receipt};
  IF NOT coalesce(matches,false) THEN RAISE EXCEPTION 'Unexpected temporary receipt identity'; END IF;
  DROP TABLE pg_temp.${receipt};
 END IF;
END $receipt_cleanup$;
SELECT pg_advisory_xact_lock(hashtextextended('reviewed-private-po-import',0));
-- Provider auth/storage tables are fingerprinted, not locked by this business import.
LOCK TABLE ${IMPORT_RELATIONS.filter(t=>t.startsWith('public.')||t==='private.pilot_order_requests').join(',')} IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE import_context(value jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE import_packet_input(value jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO pg_temp.import_packet_input VALUES(${jsonSql(packetInput)});
${loadModelsSql(runtime.model)}
CREATE TEMP TABLE import_owned(relation text NOT NULL,id uuid NOT NULL,PRIMARY KEY(relation,id)) ON COMMIT DROP;
CREATE TEMP TABLE import_master_state(master_rows_md5 text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE import_actions(request_id uuid PRIMARY KEY,operation text NOT NULL,payload jsonb NOT NULL) ON COMMIT DROP;
GRANT SELECT ON pg_temp.import_actions TO authenticated;
${HELPERS_SQL}
CREATE FUNCTION pg_temp.import_check_contracts() RETURNS void LANGUAGE plpgsql SET search_path='' AS $fn$
DECLARE cfg jsonb; observed text; f record;
BEGIN
 SELECT value->'config' INTO STRICT cfg FROM pg_temp.import_context;
 WITH s AS (${SCHEMA_STATE_SQL}) SELECT md5(value::text) INTO observed FROM s;
 IF observed IS DISTINCT FROM cfg->>'schemaMd5' THEN RAISE EXCEPTION 'Schema fingerprint changed'; END IF;
 FOR f IN SELECT key,value FROM jsonb_each_text(cfg->'expectedFunctionHashes') LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure(f.key)) IS DISTINCT FROM f.value THEN RAISE EXCEPTION 'Function body changed'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND (rolsuper OR rolbypassrls)) OR NOT has_function_privilege('authenticated','public.pilot_order_transaction(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Authenticated authority drift'; END IF;
END $fn$;
CREATE FUNCTION pg_temp.import_check_baseline() RETURNS void LANGUAGE plpgsql SET search_path='' AS $fn$
DECLARE observed jsonb; expected jsonb;
BEGIN
 WITH data_state AS (${dataStateSql(true)}) SELECT jsonb_object_agg(relation,jsonb_build_object('rows',rows,'content_md5',content_md5) ORDER BY relation) INTO observed FROM data_state;
 SELECT value->'config'->'baselineData' INTO STRICT expected FROM pg_temp.import_context;
 IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Original baseline changed'; END IF;
END $fn$;
SELECT pg_temp.import_check_contracts();
CREATE TEMP TABLE import_state(latest integer NOT NULL,skip boolean NOT NULL) ON COMMIT DROP;
INSERT INTO pg_temp.import_state SELECT n,n>=${index} FROM (SELECT pg_temp.import_verify_state() AS n) verified;
SELECT pg_temp.import_check_baseline();
DO $order$ BEGIN
 IF (SELECT latest FROM pg_temp.import_state)<${index-1} THEN RAISE EXCEPTION 'Prior packet must commit and verify before this packet'; END IF;
END $order$;
CREATE TEMP TABLE import_master_input ON COMMIT DROP AS SELECT value->'resolved' AS value,(SELECT skip FROM pg_temp.import_state) AS skip FROM pg_temp.import_context;
GRANT SELECT ON pg_temp.import_master_input TO authenticated;
SELECT set_config('request.jwt.claim.sub','${config.actorId}',true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',${claim},true);
${masters}${operations.join('\n')}
SET CONSTRAINTS ALL IMMEDIATE;
CREATE TEMP TABLE import_final_state ON COMMIT DROP AS SELECT pg_temp.import_verify_state() AS latest;
SELECT pg_temp.import_check_baseline();
SELECT pg_temp.import_check_contracts();
CREATE TEMP TABLE import_controls ON COMMIT DROP AS SELECT jsonb_build_object(
 'customers',(SELECT count(*) FROM pg_temp.import_owned WHERE relation='public.customers'),
 'products',(SELECT count(*) FROM pg_temp.import_owned WHERE relation='public.products'),
 'purchaseOrders',(SELECT count(*) FROM pg_temp.import_owned WHERE relation='public.purchase_orders'),
 'poLines',(SELECT count(*) FROM pg_temp.import_owned WHERE relation='public.po_line_items'),
 'shipments',(SELECT count(*) FROM pg_temp.import_owned WHERE relation='public.surat_jalan'),
 'shipmentLines',(SELECT count(*) FROM pg_temp.import_owned WHERE relation='public.sj_line_items'),
 'orderedQuantity',(SELECT coalesce(sum(quantity),0)::text FROM public.po_line_items l JOIN pg_temp.import_owned o ON o.relation='public.po_line_items' AND o.id=l.id),
 'deliveredQuantity',(SELECT coalesce(sum(quantity_delivered),0)::text FROM public.sj_line_items l JOIN pg_temp.import_owned o ON o.relation='public.sj_line_items' AND o.id=l.id),
 'orderedValue',(SELECT to_char(coalesce(sum(line_total),0),'FM999999999999999999999999999990.00') FROM public.po_line_items l JOIN pg_temp.import_owned o ON o.relation='public.po_line_items' AND o.id=l.id),
 'deliveredValue',(SELECT to_char(coalesce(sum(s.quantity_delivered::numeric*l.unit_price),0),'FM999999999999999999999999999990.00') FROM public.sj_line_items s JOIN public.po_line_items l ON l.id=s.po_line_item_id JOIN pg_temp.import_owned o ON o.relation='public.sj_line_items' AND o.id=s.id)) AS value;
DO $complete$ BEGIN
 IF (SELECT latest FROM pg_temp.import_final_state) IS DISTINCT FROM (SELECT CASE WHEN skip THEN latest ELSE ${index} END FROM pg_temp.import_state) THEN RAISE EXCEPTION 'Packet completion mismatch'; END IF;
 IF (SELECT value FROM pg_temp.import_controls) IS DISTINCT FROM (SELECT value->'prefixControls'->(SELECT latest FROM pg_temp.import_final_state) FROM pg_temp.import_context) THEN RAISE EXCEPTION 'Import aggregate controls changed'; END IF;
END $complete$;
CREATE TEMP TABLE ${receipt} AS SELECT jsonb_build_object('model',value->>'model','manifest_sha256',value->>'manifestSha256','plan_sha256',value->>'planSha256','packet_index',${index},'skipped',(SELECT skip FROM pg_temp.import_state),'verified_through',(SELECT latest FROM pg_temp.import_final_state),'planned_counts',value->'counts','verified_counts',(SELECT value FROM pg_temp.import_controls),'master_rows_md5',(SELECT master_rows_md5 FROM pg_temp.import_master_state),'schema_md5',value->'config'->>'schemaMd5') AS value FROM pg_temp.import_context;
DROP FUNCTION pg_temp.import_check_baseline(),pg_temp.import_check_contracts(),pg_temp.import_verify_state(),pg_temp.import_delivery_payload(jsonb,jsonb,uuid,timestamptz),pg_temp.import_create_payload(jsonb),pg_temp.import_master_hash(),pg_temp.import_decode_model(text,text,integer);
COMMIT;
SELECT 'PO_IMPORT_PACKET_COMMITTED' AS marker,value AS receipt FROM pg_temp.${receipt};
`
}
