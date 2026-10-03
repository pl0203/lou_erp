// Pure, offline metadata preparation/evaluation. No I/O, connection or execution.
// One contract and one catalog SELECT produce both the migration preflight and
// the independent pre-apply query. Never derive this contract from business rows.
import { isDeepStrictEqual } from 'node:util';
const column = (position,name,type,notnull,defaultExpression=null) => ({
 position,name,type,notnull,identity:'',generated:'',default:defaultExpression,acl:null,
});
const relation = authenticatedPrivileges => ({
 kind:'r',owner:'postgres',rls:true,force_rls:false,partition:false,inheritance:false,
 acl:[`authenticated=${authenticatedPrivileges}/postgres`,'postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres'],
});
const primaryKey = name => [{name,kind:'p',validated:true,definition:'PRIMARY KEY (id)',columns:['id']}];
const layouts = [
 {
  // The category gate runs after pilot_security has revoked customer DELETE.
  name:'canonical-fixture-v1',relation:relation('arw'),primary_keys:primaryKey('customers_pkey'),
  columns:[
   column(1,'id','uuid',true,'gen_random_uuid()'),column(2,'name','text',true),
   column(3,'address','text',false),column(4,'city','text',false),column(5,'phone','text',false),column(6,'email','text',false),
   column(7,'pricing_tier','public.pricing_tier',true,"'luar_kota'::public.pricing_tier"),column(8,'visit_frequency_days','integer',true,'7'),
   column(9,'last_visit_date','date',false),column(10,'created_at','timestamp with time zone',false,'now()'),
  ],
 },
 {
  name:'known-legacy-v1',relation:relation('arw'),primary_keys:primaryKey('suppliers_pkey'),
  columns:[
   column(1,'id','uuid',true,'extensions.uuid_generate_v4()'),column(2,'name','text',true),
   column(3,'phone','text',false),column(4,'email','text',false),column(5,'created_at','timestamp with time zone',true,'now()'),
   column(6,'address','text',false),column(7,'visit_frequency_days','integer',true,'7'),column(8,'last_visit_date','date',false),
   column(9,'city','text',false),column(10,'pricing_tier','public.pricing_tier',true,"'luar_kota'::public.pricing_tier"),
  ],
 },
];
const freeze = value => { if(value && typeof value==='object') { Object.values(value).forEach(freeze);Object.freeze(value); }return value; };
export const CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS = freeze(layouts);
const literal = value => `'${value.replaceAll("'","''")}'`;
const equal = isDeepStrictEqual;

// Empty search_path is mandatory for stable format_type/default representations.
export function buildCustomerCategoryMetadataSelect() {
 return `SELECT jsonb_build_object(
 'current_user',current_user,
 'category_attribute_present',EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.customers'::regclass AND attname='customer_category'),
 'category_constraint_present',EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.customers'::regclass AND conname='customers_customer_category_check'),
 'has_dropped_attributes',EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.customers'::regclass AND attnum>0 AND attisdropped),
 'relation',(SELECT jsonb_build_object('kind',c.relkind,'owner',pg_catalog.pg_get_userbyid(c.relowner),
  'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'partition',c.relispartition,
  'inheritance',EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid),
  'acl',(SELECT jsonb_agg(e::text ORDER BY e::text) FROM unnest(c.relacl) e))
  FROM pg_catalog.pg_class c WHERE c.oid='public.customers'::regclass),
 'columns',(SELECT jsonb_agg(jsonb_build_object('position',a.attnum,'name',a.attname,
  'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
  'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) ORDER BY a.attnum)
  FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.customers'::regclass AND a.attnum>0 AND NOT a.attisdropped),
 'primary_keys',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'kind',k.contype,'validated',k.convalidated,
  'definition',pg_catalog.pg_get_constraintdef(k.oid),'columns',(SELECT jsonb_agg(a.attname ORDER BY key.position)
   FROM unnest(k.conkey) WITH ORDINALITY AS key(number,position) JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=key.number)) ORDER BY k.conname),'[]'::jsonb)
  FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customers'::regclass AND k.contype='p')
) AS value`;
}

export function buildCustomerCategoryPreflightSql() {
 return `DO $preflight$
DECLARE actual jsonb; expected jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.customers'::regclass AND attname='customer_category')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.customers'::regclass AND conname='customers_customer_category_check')
 THEN RAISE EXCEPTION 'Unexpected customer category schema; migration refused'; END IF;
 IF current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.customers'::regclass AND relkind='r'
   AND NOT relispartition AND relrowsecurity AND NOT relforcerowsecurity
   AND relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid='public.customers'::regclass OR inhparent='public.customers'::regclass)
 THEN RAISE EXCEPTION 'Unexpected customers relation contract; migration refused'; END IF;
 SELECT metadata.value INTO actual FROM (${buildCustomerCategoryMetadataSelect()}) metadata;
 SELECT contract INTO expected FROM jsonb_array_elements(${literal(JSON.stringify(CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS))}::jsonb) contract
 WHERE actual->'columns'=contract->'columns';
 IF expected IS NULL OR actual->'has_dropped_attributes' IS DISTINCT FROM 'false'::jsonb
 OR actual->'primary_keys' IS DISTINCT FROM expected->'primary_keys'
 THEN RAISE EXCEPTION 'Unexpected customers column contract; migration refused'; END IF;
 IF actual->'relation' IS DISTINCT FROM expected->'relation'
 THEN RAISE EXCEPTION 'Unexpected customers relation contract; migration refused'; END IF;
END $preflight$;`;
}

export function assertCustomerCategoryPreflightSource(source) {
 if(typeof source!=='string')throw new Error('Exact category migration source required');
 const blocks=source.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/g);
 if(blocks?.length!==1 || blocks[0]!==buildCustomerCategoryPreflightSql())throw new Error('Category preflight source differs from the shared contract');
 return true;
}

export function buildCustomerCategoryPreapplyMetadataSql() {
 return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path='';
SET LOCAL row_security=off;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL idle_in_transaction_session_timeout='30s';
${buildCustomerCategoryMetadataSelect()};
ROLLBACK;
`;
}

export function evaluateCustomerCategoryPreapply(metadata) {
 const reject = reason => ({accepted:false,complete:true,layout:null,reason});
 if(!metadata || typeof metadata!=='object' || Array.isArray(metadata))return reject('Incomplete pre-apply metadata');
 if(metadata.category_attribute_present!==false || metadata.category_constraint_present!==false)return reject('Unexpected customer category schema; migration refused');
 const r=metadata.relation;
 if(metadata.current_user!=='postgres' || !r || r.kind!=='r' || r.owner!=='postgres' || r.rls!==true || r.force_rls!==false
 || r.partition!==false || r.inheritance!==false)return reject('Unexpected customers relation contract; migration refused');
 const expected=CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS.find(item=>equal(metadata.columns,item.columns));
 if(!expected || metadata.has_dropped_attributes!==false || !equal(metadata.primary_keys,expected.primary_keys))return reject('Unexpected customers column contract; migration refused');
 if(!equal(r,expected.relation))return reject('Unexpected customers relation contract; migration refused');
 return {accepted:true,complete:true,layout:expected.name,reason:null};
}

// Historical baseline captures omitted these live predicates. Evaluate only the
// actual captured fields, and ALWAYS keep the release gate closed on that input.
// The returned result never includes customer rows, IDs, actors or target details.
export function evaluateCustomerCategoryCapturedBaseline(baseline) {
 const incomplete = ['relation.partition','relation.inheritance','has_dropped_attributes','category_attribute_present_including_dropped'];
 const reject = reason => ({accepted:false,observedContractAccepted:false,complete:false,layout:null,missingEvidence:incomplete,reason});
 const schema=baseline?.schema;
 if(!schema || !Array.isArray(schema.columns) || !Array.isArray(schema.tables) || !Array.isArray(schema.constraints))return reject('Incomplete captured schema');
 const tables=schema.tables.filter(table=>table.schema==='public' && table.name==='customers');
 const columns=schema.columns.filter(c=>c.table==='public.customers').map(({table,...c})=>c);
 const expected=CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS.find(item=>equal(columns,item.columns));
 if(!expected || tables.length!==1)return reject('Unexpected captured customers column contract');
 const table=tables[0];
 const acl=typeof table.acl==='string' && /^\{[^{}]+\}$/.test(table.acl)?table.acl.slice(1,-1).split(',').sort():null;
 const observedRelation={kind:table.kind,owner:table.owner,rls:table.rls,force_rls:table.force_rls,acl};
 const {partition,inheritance,...expectedRelation}=expected.relation;
 const keys=schema.constraints.filter(k=>k.table==='public.customers' && k.kind==='p').map(({table,...k})=>k);
 const expectedKeys=expected.primary_keys.map(({columns,...k})=>k);
 if(!equal(observedRelation,expectedRelation) || baseline.identity?.current_user!=='postgres')return reject('Unexpected captured customers relation contract');
 if(!equal(keys,expectedKeys))return reject('Unexpected captured customers primary key contract');
 if(schema.category_column!==null || baseline.category_column_present!==false
 || schema.constraints.some(k=>k.table==='public.customers' && k.name==='customers_customer_category_check'))return reject('Unexpected captured category schema');
 return {accepted:false,observedContractAccepted:true,complete:false,layout:expected.name,missingEvidence:incomplete,reason:'Complete pre-apply metadata is required before rollout'};
}
