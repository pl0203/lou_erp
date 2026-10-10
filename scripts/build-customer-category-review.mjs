// Pure SQL preparation only: no connection, execution, file access or CLI.
import { IMPORT_RELATIONS, IMPORT_CUSTOMER_CATEGORIES } from './build-po-import-packets.mjs'

const CUSTOMER_FIELDS = Object.freeze(['id','name','address','city','phone','email','pricing_tier','visit_frequency_days','last_visit_date','created_at'])
// v1 hashed the entire product row. These are ALL columns in its reviewed schema,
// including the provider created_at column added by test-po-import-ci.mjs,
// and every nullable catalog price, not just fields present in its source model.
const PRODUCT_FIELDS = Object.freeze(['id','name','sku','size','unit_price','harga_pokok','luar_kota','dalam_kota','depo_bangunan','created_at'])
const CUSTOMER_TYPES = ['uuid','text','text','text','text','text','public.pricing_tier','integer','date','timestamp with time zone']
const PRODUCT_TYPES = ['uuid','text','text','text',...Array(5).fill('numeric(14,2)'), 'timestamp with time zone']
const literal = value => `'${value.replaceAll("'", "''")}'`
const projection = (fields, alias) => fields.map(field => `${alias}.${field}`).join(',')
const readonly = sql => `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path='';
SET LOCAL row_security=off;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL idle_in_transaction_session_timeout='30s';
${sql}
ROLLBACK;
`
const identitySql = `jsonb_build_object('database',current_database(),'current_user',current_user,'session_user',session_user,
 'server_address',inet_server_addr(),'server_port',inet_server_port(),'server_version',version(),'captured_at',transaction_timestamp(),
 'transaction_read_only',current_setting('transaction_read_only'),'transaction_isolation',current_setting('transaction_isolation'),
 'row_security',current_setting('row_security'),'timezone',current_setting('TimeZone'),'search_path',current_setting('search_path'))`

// A fixed, inspectable metadata snapshot. The import baseline helper returns only
// schema_md5, so it cannot supply the actual schema/ACL evidence needed here.
const schemaSql = `SELECT jsonb_build_object(
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl::text) ORDER BY n.nspname)
  FROM pg_catalog.pg_namespace n WHERE n.nspname IN('public','private','auth','storage')),
 'types',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'owner',pg_get_userbyid(t.typowner),'kind',t.typtype,
  'category',t.typcategory,'notnull',t.typnotnull,'default',t.typdefault,'base',format_type(t.typbasetype,t.typtypmod),
  'labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid)) ORDER BY n.nspname,t.typname)
  FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN('public','private','auth','storage')),
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
  'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) ORDER BY n.nspname,c.relname)
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth','storage') AND c.relkind IN('r','p','v','m','f')),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'position',a.attnum,'name',a.attname,
  'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
  'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) ORDER BY a.attrelid::regclass::text,a.attnum)
  FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname IN('public','private','auth','storage') AND c.relkind IN('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',k.conrelid::regclass::text,'name',k.conname,'kind',k.contype,
  'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY n.nspname,k.conrelid::regclass::text,k.conname)
  FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace WHERE n.nspname IN('public','private','auth','storage')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.schemaname,p.tablename,p.policyname) FROM pg_catalog.pg_policies p WHERE p.schemaname IN('public','private','auth','storage')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
  'language',l.lanname,'volatility',p.provolatile,'definer',p.prosecdef,'leakproof',p.proleakproof,'strict',p.proisstrict,'parallel',p.proparallel,
  'config',p.proconfig,'arguments',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),
  'definition',pg_get_functiondef(p.oid),'body_md5',md5(p.prosrc)) ORDER BY p.oid::regprocedure::text)
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE n.nspname IN('public','private','auth','storage') AND p.prokind IN('f','p')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgrelid::regclass::text,t.tgname)
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth','storage') AND NOT t.tgisinternal),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('table',i.indrelid::regclass::text,'name',i.indexrelid::regclass::text,'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid::regclass::text)
  FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','auth','storage')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',r.rolname,'superuser',r.rolsuper,'inherit',r.rolinherit,'bypass_rls',r.rolbypassrls,'login',r.rolcanlogin) ORDER BY r.rolname) FROM pg_catalog.pg_roles r),
 'memberships',(SELECT jsonb_agg(jsonb_build_object('member',pg_get_userbyid(m.member),'role',pg_get_userbyid(m.roleid),'admin_option',m.admin_option) ORDER BY pg_get_userbyid(m.member),pg_get_userbyid(m.roleid)) FROM pg_catalog.pg_auth_members m),
 'category_column',(SELECT jsonb_build_object('present',true,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,
  'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text,'identity',a.attidentity,'generated',a.attgenerated)
  FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.customers'::regclass AND a.attname='customer_category' AND a.attnum>0 AND NOT a.attisdropped)
) AS value`

function categorySql(cohort = false) {
 return `category_values AS (
 SELECT c.id,to_jsonb(c)->'customer_category' AS category FROM public.customers c${cohort ? ' JOIN requested_customers q ON q.id=c.id' : ''}
), category_state AS (
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.customers'::regclass
  AND a.attname='customer_category' AND a.attnum>0 AND NOT a.attisdropped) AS present,
 coalesce(jsonb_agg(jsonb_build_object('id',id,'customer_category',category) ORDER BY id),'[]'::jsonb) AS rows,
 coalesce(jsonb_agg(id ORDER BY id) FILTER(WHERE category IS NOT NULL AND category<>'null'::jsonb
  AND category NOT IN(${IMPORT_CUSTOMER_CATEGORIES.map(value => `${literal(JSON.stringify(value))}::jsonb`).join(',')})),'[]'::jsonb) AS invalid_ids
 FROM category_values
)`
}
function protectedDataSql() {
 return IMPORT_RELATIONS.map(relation => {
  let table = relation, row = 'to_jsonb(r)', sort = 'r.id'
  if (relation === 'public.customers') table = `(SELECT ${projection(CUSTOMER_FIELDS, 'c')} FROM public.customers c)`
  if (relation === 'private.pilot_order_requests') sort = 'r.actor_id,r.request_id'
  if (relation === 'auth.users-safe-fields') {
   table = 'auth.users'
   row = "jsonb_build_object('id',r.id,'email',r.email,'role',r.role,'aud',r.aud,'created_at',r.created_at)"
  }
  if (relation === 'storage.objects') row = "jsonb_build_object('id',r.id,'bucket_id',r.bucket_id,'name',r.name,'owner_id',r.owner_id,'metadata',r.metadata)"
  return `SELECT ${literal(relation)} AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(${row}::text),'' ORDER BY ${sort}),'')) AS content_md5 FROM ${table} r`
 }).join('\nUNION ALL\n')
}
const requestsSql = `SELECT coalesce(jsonb_agg(jsonb_build_object(
 'actor_id',r.actor_id,'request_id',r.request_id,'operation',r.operation,'created_at',r.created_at,
 'state',CASE WHEN r.abandoned THEN 'ABANDONED' WHEN r.result IS NOT NULL THEN 'COMPLETED' ELSE 'PENDING' END,
 'completed',r.result IS NOT NULL,'abandoned',r.abandoned,
 'source_key',r.payload->'import_provenance'->>'source_key','model',r.payload->'import_provenance'->>'model',
 'plan_sha256',r.payload->'import_provenance'->>'plan_sha256','manifest_sha256',r.payload->'import_provenance'->>'manifest_sha256',
 'master_rows_md5',r.payload->'import_provenance'->>'master_rows_md5','master_model_sha256',r.payload->'import_provenance'->>'master_model_sha256',
 'master_model_bytes',r.payload->'import_provenance'->'master_model_bytes','po_model_sha256',r.payload->'import_provenance'->>'po_model_sha256',
 'po_model_bytes',r.payload->'import_provenance'->'po_model_bytes','provenance_present',r.payload ? 'import_provenance',
 'payload_md5',md5(r.payload::text),'result',r.result,'result_md5',md5(r.result::text),
 'result_id',r.result->>'id','result_po_id',r.result->>'po_id','payload_po_id',r.payload->>'po_id'
 ) ORDER BY r.actor_id,r.request_id),'[]'::jsonb) AS value FROM private.pilot_order_requests r`

export function buildCustomerCategoryBaselineSql(...args) {
 if (args.length) throw new Error('Baseline takes no parameters')
 return readonly(`WITH schema_state AS (${schemaSql}),
 protected_data AS (${protectedDataSql()}),
 request_state AS (${requestsSql}),
 ${categorySql()}
SELECT jsonb_build_object('review_version','customer-category-baseline-v1','identity',${identitySql},
 'schema',s.value,'schema_md5',md5(s.value::text),
 'protected_data',(SELECT jsonb_object_agg(relation,jsonb_build_object('rows',rows,'content_md5',content_md5) ORDER BY relation) FROM protected_data),
 'request_states',r.value,'category_column_present',k.present,'category_rows',k.rows,'invalid_category_ids',k.invalid_ids
) AS customer_category_baseline FROM schema_state s CROSS JOIN request_state r CROSS JOIN category_state k;`)
}

function uuidSet(value, label) {
 if (!Array.isArray(value) || value.length < 1 || value.length > 10000) throw new Error(`Invalid ${label}: 1..10000 original UUIDs required`)
 const ids = []
 for (const item of value) {
  if (typeof item !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(item)) throw new Error(`Invalid ${label} UUID`)
  ids.push(item.toLowerCase())
 }
 if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} UUID`)
 return ids.sort()
}
function validateAudit(options) {
 const keys = ['customerIds','productIds','expectedMasterRowsMd5']
 if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
  || Object.keys(options).length !== keys.length || keys.some(key => !Object.hasOwn(options, key))) throw new Error('Exact original-ID audit parameters required')
 const customerIds = uuidSet(options.customerIds, 'customerIds'), productIds = uuidSet(options.productIds, 'productIds')
 if (typeof options.expectedMasterRowsMd5 !== 'string' || !/^[a-f0-9]{32}$/i.test(options.expectedMasterRowsMd5)) throw new Error('Saved master MD5 required')
 return { customerIds, productIds, expectedMasterRowsMd5: options.expectedMasterRowsMd5.toLowerCase() }
}
const uuidRows = ids => `SELECT unnest(ARRAY[${ids.map(literal).join(',')}]::uuid[]) AS id`
function sourceSchemaSql() {
 const expected = (fields, types) => `${literal(JSON.stringify(Object.fromEntries(fields.map((field, i) => [field, types[i]]))))}::jsonb`
 const actual = (relation, excludeCategory) => `(SELECT jsonb_object_agg(a.attname,format_type(a.atttypid,a.atttypmod) ORDER BY a.attname)
  FROM pg_catalog.pg_attribute a WHERE a.attrelid=${literal(relation)}::regclass AND a.attnum>0 AND NOT a.attisdropped${excludeCategory ? " AND a.attname<>'customer_category'" : ''})`
 return `SELECT ${actual('public.customers', true)} AS customer_columns,${actual('public.products', false)} AS product_columns,
 ${expected(CUSTOMER_FIELDS, CUSTOMER_TYPES)} AS expected_customer_columns,${expected(PRODUCT_FIELDS, PRODUCT_TYPES)} AS expected_product_columns`
}

export function buildCustomerCategoryLegacyAuditSql(options, ...extra) {
 if (extra.length) throw new Error('Exactly one audit parameter object required')
 const { customerIds, productIds, expectedMasterRowsMd5 } = validateAudit(options)
 return readonly(`WITH requested_customers AS (${uuidRows(customerIds)}),
 requested_products AS (${uuidRows(productIds)}),
 original_customers AS (
 SELECT ${projection(CUSTOMER_FIELDS, 'c')} FROM public.customers c JOIN requested_customers q ON q.id=c.id
), original_products AS (
 SELECT ${projection(PRODUCT_FIELDS, 'p')} FROM public.products p JOIN requested_products q ON q.id=p.id
), master_hash AS (
 SELECT md5(jsonb_build_object(
  'customers',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM original_customers c),
  'products',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM original_products p))::text) AS actual_master_rows_md5
), source_schema AS (${sourceSchemaSql()}
), source_schema_state AS (
 SELECT *,customer_columns=expected_customer_columns AND product_columns=expected_product_columns AS matches FROM source_schema
), missing AS (
 SELECT (SELECT coalesce(jsonb_agg(q.id ORDER BY q.id),'[]'::jsonb) FROM requested_customers q LEFT JOIN public.customers c ON c.id=q.id WHERE c.id IS NULL) AS customer_ids,
  (SELECT coalesce(jsonb_agg(q.id ORDER BY q.id),'[]'::jsonb) FROM requested_products q LEFT JOIN public.products p ON p.id=q.id WHERE p.id IS NULL) AS product_ids
), ${categorySql(true)}, verdict AS (
 SELECT CASE WHEN jsonb_array_length(m.customer_ids)>0 OR jsonb_array_length(m.product_ids)>0 THEN 'ID_MISSING'
  WHEN NOT s.matches OR h.actual_master_rows_md5<>${literal(expectedMasterRowsMd5)} THEN 'SOURCE_FIELDS_CHANGED' ELSE 'MATCH' END AS source_status
 FROM master_hash h CROSS JOIN missing m CROSS JOIN source_schema_state s
)
SELECT jsonb_build_object('review_version','customer-category-legacy-audit-v1','identity',${identitySql},
 'expected_master_rows_md5',${literal(expectedMasterRowsMd5)},'actual_master_rows_md5',h.actual_master_rows_md5,
 'source_status',v.source_status,'source_match',v.source_status='MATCH','source_projection_matches_schema',s.matches,
 'source_schema',to_jsonb(s)-'matches',
 'requested_customer_ids',(SELECT jsonb_agg(id ORDER BY id) FROM requested_customers),
 'requested_product_ids',(SELECT jsonb_agg(id ORDER BY id) FROM requested_products),
 'missing_customer_ids',m.customer_ids,'missing_product_ids',m.product_ids,
 'category_column_present',k.present,
 'category_status',CASE WHEN NOT k.present THEN 'NOT_PRESENT' WHEN jsonb_array_length(k.invalid_ids)>0 THEN 'INVALID_VALUES' ELSE 'VALID' END,
 'category_rows',k.rows,'invalid_category_ids',k.invalid_ids
) AS customer_category_legacy_audit
FROM master_hash h CROSS JOIN missing m CROSS JOIN source_schema_state s CROSS JOIN category_state k CROSS JOIN verdict v;`)
}
