// Fixed disposable collision ownership. No caller SQL, file, root or CLI inputs.
import assert from 'node:assert/strict'
const definitions=Object.freeze({
 table:{identity:'private.employee_install_collision',class:'pg_class',kind:'r',owner:'relowner',lookup:"to_regclass('private.employee_install_collision')",cast:'regclass',kindColumn:'relkind',create:'CREATE TABLE private.employee_install_collision(token uuid PRIMARY KEY);',target:'TABLE private.employee_install_collision'},
 overload:{identity:'private.employee_context_v1(integer)',class:'pg_proc',kind:'f',owner:'proowner',lookup:"to_regprocedure('private.employee_context_v1(integer)')",cast:'regprocedure',kindColumn:'prokind',create:'CREATE FUNCTION private.employee_context_v1(integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;',target:'FUNCTION private.employee_context_v1(integer)'},
 type:{identity:'private.employee_install_collision',class:'pg_type',kind:'e',owner:'typowner',lookup:"to_regtype('private.employee_install_collision')",cast:'regtype',kindColumn:'typtype',create:"CREATE TYPE private.employee_install_collision AS ENUM ('synthetic');",target:'TYPE private.employee_install_collision'},
})
const definition=kind=>{assert.equal(typeof kind,'string','Fixed collision kind required');assert.ok(Object.hasOwn(definitions,kind),'Unknown fixed collision kind');return definitions[kind]}
const keys=(value,expected)=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Collision metadata object required');assert.deepEqual(Object.keys(value).sort(),expected.slice().sort(),'Exact collision metadata keys required')}
const digest=value=>assert.match(value,/^[a-f0-9]{64}$/,'Exact collision fingerprint required')
function invocation(value){keys(value,['kind','token','baseline']);definition(value.kind);assert.match(value.token,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,'Invocation UUID required');digest(value.baseline)}
const fingerprint="encode(sha256(convert_to(pg_temp.employee_legacy_snapshot()::text,'UTF8')),'hex')"
export const COLLISION_SERIALIZATION="SET LOCAL search_path=pg_catalog,pg_temp;SET LOCAL timezone='UTC';SET LOCAL datestyle='ISO, MDY';SET LOCAL intervalstyle='postgres';SET LOCAL extra_float_digits=1;"
export function collisionCreateSql(expected){
 invocation(expected);const d=definition(expected.kind)
 // The marker and object commit together. Comments are checked separately from
 // the unchanged full snapshot, avoiding self-referential fingerprint metadata.
 return `BEGIN;${COLLISION_SERIALIZATION}\n${d.create}\nDO $mark$ DECLARE object_oid oid:=${d.lookup}::oid; BEGIN
 EXECUTE format('COMMENT ON ${d.target} IS %L',jsonb_build_object('version',1,'kind','${expected.kind}','token','${expected.token}','oid',object_oid,'baseline','${expected.baseline}','fingerprint',${fingerprint})::text);
 END $mark$;COMMIT;`
}
export function collisionObservationSql(kind){
 const d=definition(kind),select=column=>`(SELECT ${column} FROM pg_catalog.${d.class} WHERE oid=${d.lookup}::oid)`
 return `SELECT jsonb_build_object('oid',${d.lookup}::oid,'identity',${select(`oid::${d.cast}::text`)},'owner',${select(`pg_get_userbyid(${d.owner})`)},'objectKind',${select(d.kindColumn)},'marker',obj_description(${d.lookup}::oid,'${d.class}'),'fingerprint',${fingerprint});`
}
export function collisionDropSql(kind){return `DROP ${definition(kind).target};`}
export function assertOwnedCollision(expected,raw){
 invocation(expected);assert.equal(typeof raw,'string');const observed=JSON.parse(raw),d=definition(expected.kind)
 keys(observed,['oid','identity','owner','objectKind','marker','fingerprint']);digest(observed.fingerprint)
 if(observed.oid===null){
  for(const key of ['identity','owner','objectKind','marker'])assert.equal(observed[key],null,'Absent collision must have no residual metadata')
  assert.equal(observed.fingerprint,expected.baseline,'Absent collision requires exact original baseline')
  return {absent:true}
 }
 // PostgreSQL jsonb renders oid as canonical decimal text, never a JSON number.
 assert.equal(typeof observed.oid,'string','Canonical PostgreSQL OID text required')
 assert.match(observed.oid,/^[1-9][0-9]{0,9}$/,'Canonical PostgreSQL OID text required')
 assert.ok(Number(observed.oid)<=4294967295,'PostgreSQL OID range required')
 assert.equal(observed.identity,d.identity,'Foreign collision identity');assert.equal(observed.owner,'postgres','Foreign collision owner');assert.equal(observed.objectKind,d.kind,'Changed collision shape')
 assert.equal(typeof observed.marker,'string','Atomic ownership marker required');const marker=JSON.parse(observed.marker)
 keys(marker,['version','kind','token','oid','baseline','fingerprint']);assert.equal(marker.version,1)
 assert.equal(marker.kind,expected.kind,'Foreign collision kind');assert.equal(marker.token,expected.token,'Foreign collision token');assert.equal(marker.oid,observed.oid,'Changed collision OID');assert.equal(marker.baseline,expected.baseline,'Foreign collision baseline');digest(marker.fingerprint)
 assert.equal(observed.fingerprint,marker.fingerprint,'Changed collision rows, structure, grants or catalog')
 return {absent:false,oid:observed.oid}
}
export async function withCollisionCleanup(work,cleanup){
 let original,result,failed=false
 try{result=await work()}catch(error){original=error;failed=true}
 try{await cleanup()}catch(error){if(failed)throw new AggregateError([original,error],`${original?.message??String(original)}; collision cleanup: ${error?.message??String(error)}`);throw error}
 if(failed)throw original
 return result
}
