// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
 CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS, assertCustomerCategoryPreflightSource,
 buildCustomerCategoryMetadataSelect, buildCustomerCategoryPreflightSql,
 buildCustomerCategoryPreapplyMetadataSql, evaluateCustomerCategoryPreapply,
 evaluateCustomerCategoryCapturedBaseline,
} from '../scripts/customer-category-preapply.mjs'

// Explicitly fictional schema metadata. No hosted rows, IDs or target identity.
const metadata = (index=1) => ({
 current_user:'postgres',category_attribute_present:false,category_constraint_present:false,has_dropped_attributes:false,
 ...structuredClone(CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS[index]),
})
const cleanMetadata = (index=1) => { const {name,...rest}=metadata(index);return rest }
const captured = (index=1) => {
 const c=metadata(index)
 const {partition,inheritance,...table}=c.relation
 return {
  identity:{current_user:'postgres'},category_column_present:false,
  schema:{category_column:null,columns:c.columns.map(column=>({table:'public.customers',...column})),
   tables:[{schema:'public',name:'customers',...table,acl:`{${table.acl.join(',')}}` }],
   constraints:c.primary_keys.map(({columns,...key})=>({table:'public.customers',...key})),
  },
 }
}

test('migration pins the known legacy UUID default rather than assuming only the synthetic fixture layout', () => {
 const source = readFileSync('supabase/migrations/202610020001_customer_categories.sql', 'utf8')
 expect(source).toContain('extensions.uuid_generate_v4()')
 expect(source).toContain('known-legacy-v1')
})

test('source preflight is byte-identical to the shared producer and uses its exact catalog SELECT', () => {
 const source=readFileSync('supabase/migrations/202610020001_customer_categories.sql','utf8')
 expect(assertCustomerCategoryPreflightSource(source)).toBe(true)
 expect(source.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/)?.[0]).toBe(buildCustomerCategoryPreflightSql())
 expect(buildCustomerCategoryPreflightSql()).toContain(buildCustomerCategoryMetadataSelect())
 expect(buildCustomerCategoryPreapplyMetadataSql()).toContain(buildCustomerCategoryMetadataSelect())
 expect(()=>assertCustomerCategoryPreflightSource(source.replace('extensions.uuid_generate_v4()','gen_random_uuid()'))).toThrow('differs')
 expect(()=>assertCustomerCategoryPreflightSource(source.replace("a.attnotnull,'identity'","false,'identity'"))).toThrow('differs')
 expect(()=>assertCustomerCategoryPreflightSource(source+'\n'+buildCustomerCategoryPreflightSql())).toThrow('differs')
})

test.each([0,1])('accepts only complete metadata for explicit known contract %s without changing the input', index => {
 const input=cleanMetadata(index), original=structuredClone(input)
 expect(evaluateCustomerCategoryPreapply(input)).toEqual({accepted:true,complete:true,layout:CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS[index].name,reason:null})
 expect(input).toEqual(original)
 expect(Object.isFrozen(CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS[index].columns[0])).toBe(true)
})

test.each([0,1].flatMap(index=>['default','acl'].flatMap(field=>['1e400','-1e400'].map(number=>({index,field,number})))))
('rejects JSON numeric overflow in required-null $field for layout $index ($number)', ({index,field,number}) => {
 const raw=JSON.stringify(cleanMetadata(index)).replace(`"${field}":null`,`"${field}":${number}`)
 const decoded=JSON.parse(raw)
 expect(decoded.columns[field==='default'?1:0][field]).toBe(number==='1e400'?Infinity:-Infinity)
 expect(evaluateCustomerCategoryPreapply(decoded).accepted).toBe(false)
 expect(evaluateCustomerCategoryPreapply(decoded).reason).toBe('Unexpected customers column contract; migration refused')
})

test.each([
 ['unexpected physical order',(m:any)=>{[m.columns[2],m.columns[3]]=[m.columns[3],m.columns[2]]}],
 ['position gap',(m:any)=>{m.columns[9].position=11}],
 ['column type',(m:any)=>{m.columns[2].type='character varying(20)'}],
 ['created_at nullable',(m:any)=>{m.columns[4].notnull=false}],
 ['name nullable',(m:any)=>{m.columns[1].notnull=false}],
 ['UUID default',(m:any)=>{m.columns[0].default='gen_random_uuid()'}],
 ['frequency default',(m:any)=>{m.columns[6].default='14'}],
 ['new column default',(m:any)=>{m.columns[2].default="'fictional'::text"}],
 ['identity',(m:any)=>{m.columns[6].identity='a'}],
 ['generated',(m:any)=>{m.columns[6].generated='s'}],
 ['column ACL',(m:any)=>{m.columns[2].acl='{authenticated=r/postgres}'}],
 ['extra column',(m:any)=>{m.columns.push({...m.columns[2],position:11,name:'fictional_extra'})}],
 ['dropped attribute',(m:any)=>{m.has_dropped_attributes=true}],
 ['PK name',(m:any)=>{m.primary_keys[0].name='other_pkey'}],
 ['PK validation',(m:any)=>{m.primary_keys[0].validated=false}],
 ['PK key',(m:any)=>{m.primary_keys[0].columns=['name']}],
 ['PK definition',(m:any)=>{m.primary_keys[0].definition='PRIMARY KEY (name)'}],
 ['missing column field',(m:any)=>{delete m.columns[0].default}],
 ['missing dropped evidence',(m:any)=>{delete m.has_dropped_attributes}],
])('refuses %s using the migration column contract', (_,mutate) => {
 const m=cleanMetadata();mutate(m)
 expect(evaluateCustomerCategoryPreapply(m).reason).toBe('Unexpected customers column contract; migration refused')
})

test.each([
 ['table ACL',(m:any)=>{m.relation.acl.push('anon=r/postgres')}],
 ['RLS off',(m:any)=>{m.relation.rls=false}],
 ['forced RLS',(m:any)=>{m.relation.force_rls=true}],
 ['relation type',(m:any)=>{m.relation.kind='p'}],
 ['owner',(m:any)=>{m.relation.owner='another_owner'}],
 ['inspector',(m:any)=>{m.current_user='authenticated'}],
 ['partition',(m:any)=>{m.relation.partition=true}],
 ['inheritance',(m:any)=>{m.relation.inheritance=true}],
 ['missing partition evidence',(m:any)=>{delete m.relation.partition}],
 ['missing inheritance evidence',(m:any)=>{delete m.relation.inheritance}],
 ['legacy columns with DELETE regrant',(m:any)=>{m.relation.acl[0]='authenticated=arwd/postgres'}],
])('refuses %s using the migration relation contract', (_,mutate) => {
 const m=cleanMetadata();mutate(m)
 expect(evaluateCustomerCategoryPreapply(m).reason).toBe('Unexpected customers relation contract; migration refused')
})

test.each(['category_attribute_present','category_constraint_present'])('refuses preexisting %s', field => {
 const m:any=cleanMetadata();m[field]=true
 expect(evaluateCustomerCategoryPreapply(m).reason).toBe('Unexpected customer category schema; migration refused')
 delete m[field]
 expect(evaluateCustomerCategoryPreapply(m).accepted).toBe(false)
})

test('historical captured schema accepts known observed metadata but cannot open the pre-apply gate', () => {
 for(const index of [0,1]) {
  const result=evaluateCustomerCategoryCapturedBaseline(captured(index))
  expect(result.observedContractAccepted).toBe(true)
  expect(result.layout).toBe(CUSTOMER_CATEGORY_PREAPPLY_CONTRACTS[index].name)
  expect(result.accepted).toBe(false)
  expect(result.complete).toBe(false)
  expect(result.missingEvidence).toEqual(['relation.partition','relation.inheritance','has_dropped_attributes','category_attribute_present_including_dropped'])
 }
 const drift=captured();drift.schema.columns[4].notnull=false
 expect(evaluateCustomerCategoryCapturedBaseline(drift).observedContractAccepted).toBe(false)
 const wrongAcl=captured();wrongAcl.schema.tables[0].acl='{postgres=arwdDxtm/postgres,authenticated=arwd/postgres,service_role=arwdDxtm/postgres}'
 expect(evaluateCustomerCategoryCapturedBaseline(wrongAcl).observedContractAccepted).toBe(false)
})

test('same named/type source map misses real-layout order/nullability while pre-apply contract detects it', () => {
 const original=cleanMetadata(),drift=structuredClone(original)
 drift.columns[4].notnull=false
 const namesAndTypes=(m:any)=>Object.fromEntries(m.columns.map((c:any)=>[c.name,c.type]))
 expect(namesAndTypes(drift)).toEqual(namesAndTypes(original))
 expect(evaluateCustomerCategoryPreapply(original).accepted).toBe(true)
 expect(evaluateCustomerCategoryPreapply(drift).accepted).toBe(false)
})

test('new query is bounded read-only metadata only and pure evaluator has no execution capability', () => {
 const sql=buildCustomerCategoryPreapplyMetadataSql()
 expect(sql).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
 for(const text of ["SET LOCAL search_path='';",'SET LOCAL row_security=off;',"SET LOCAL statement_timeout='30s';","SET LOCAL lock_timeout='5s';","SET LOCAL idle_in_transaction_session_timeout='30s';",'pg_inherits','attisdropped','relispartition','pg_get_expr','pg_get_constraintdef'])expect(sql).toContain(text)
 expect(sql).toMatch(/\nROLLBACK;\n$/)
 const statements=sql.replace(/'(?:[^']|'')*'/g,"''")
 expect(statements).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMIT|LOCK|EXECUTE|COPY)\b/i)
 expect(sql).not.toMatch(/FROM public\.(?:customers|products|purchase_orders|users)\b/)
 expect(readFileSync('scripts/customer-category-preapply.mjs','utf8')).not.toMatch(/\b(?:process|fetch|execSync|spawn|readFile|writeFile)\b|node:(?:fs|child_process|net)|@supabase/)
})
