// Source containment only. SQL semantics and ACL need a separately bound synthetic run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const candidate = new URL('supabase/catalogue/v1/new02-visit-reference-extraction.sql', root);
const suite = new URL('tests/database/catalogue/visit-reference-extraction.sql', root);
const sha = x => createHash('sha256').update(x).digest('hex');
test('pure visit reference extraction candidate exists', () => assert.ok(existsSync(candidate), 'Missing pure visit reference extraction'));
test('public producers and row-profile fixture remain pinned', () => {
 for (const [path, hash] of [
  ['supabase/migrations/202610081102_demo_visit_workflow.sql','2bca74f51de8a6f29065ef9ab88451b0bee9eb7d1caea03cf3ce19fe739488ca'],
  ['tests/database/fixture.sql','4e16437026c9afff1c25578bc6f9dcf47db945b27ecd578afefbf5df553922b5'],
  ['supabase/migrations/202609300001_pilot_security.sql','f361220734a5dc9bde13beb254e4089bbb1a4166ac0b90540c6d20d8e5fb15c4'],
 ]) assert.equal(sha(readFileSync(new URL(path, root))), hash, path);
});
test('helpers are closed private immutable invokers with no writer/query/lock effects', () => {
 assert.ok(existsSync(candidate), 'Missing pure visit reference extraction');
 const sql = readFileSync(candidate,'utf8');
 const defs = [...sql.matchAll(/CREATE FUNCTION (private\.[a-z0-9_]+)\([\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$;/g)];
 assert.ok(defs.length >= 8);
 assert.equal((sql.match(/CREATE FUNCTION /g)||[]).length,defs.length);
 for (const [definition,name,body] of defs) {
  assert.match(definition,/IMMUTABLE SECURITY INVOKER SET search_path = ''/);
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${name}(`),name);
  const executable=body.replace(/--[^\n]*/g,'').replace(/'(?:[^']|'')*'/g,"''");
  assert.doesNotMatch(executable,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|LOCK|EXECUTE|nextval|setval|random|gen_random_uuid|set_config|dblink|http)\b/i,name);
  assert.doesNotMatch(executable,/\b(?:FROM|JOIN)\s+(?:public|private|pg_catalog)\./i,name);
 }
 assert.doesNotMatch(sql,/CREATE (?:TRIGGER|TABLE|POLICY)|GRANT\s+EXECUTE|tracking_ready|catalog_identity_v1/i);
 assert.match(sql,/CATALOGUE_VISIT_REFERENCE_ACL_DRIFT/);
 assert.match(sql,/SQLSTATE 'PCV02'/);
 assert.doesNotMatch(sql,/WHEN OTHERS|jsonpath|jsonb_path_query|WITH RECURSIVE/i);
});
test('exact branches, OLD/NEW and explicit typed scopes are covered',()=>{
 assert.ok(existsSync(candidate));const sql=readFileSync(candidate,'utf8');
 for(const s of ['private.pilot_schedule_requests','private.pilot_visit_requests','private.pilot_visit_workflow_audit','source_customer_id','old_value','new_value','customerId','historicalNulls','origins','UNSUPPORTED_LEGACY_PROFILE'])assert.ok(sql.includes(s),s);
 for(const op of ['propose_visit','amend_visit','create_schedule','edit_schedule','delete_schedule','approve_request','reject_request','withdraw_request','edit_visit_note','finalize_visit','schedule_recovery_abandoned','visit_recovery_abandoned'])assert.ok(sql.includes(`'${op}'`),op);
 assert.match(sql,/FOREACH side IN ARRAY ARRAY\['OLD','NEW'\]/);
});
test('SQL contract has exact missing-function RED, behavioral vectors and actual API denial',()=>{
 assert.ok(existsSync(suite));const sql=readFileSync(suite,'utf8');
 assert.match(sql,/CATALOGUE_VISIT_REFERENCE_MISSING_FUNCTION/);assert.match(sql,/ERRCODE = 'PCV01'/);
 assert.match(sql,/actual IS DISTINCT FROM expected/);
 for(const label of ['removed OLD customer retained','authority source customer union','amend root changes resource type','approval wrapper required','historical absent schedule differs from missing key','capture binding survives extraction','UUID-shaped notes stay nonreference','unknown nested key refused','malformed OLD refuses','actual API role denial'])assert.ok(sql.includes(label),label);
 for(const text of ['has_function_privilege','aclexplode','proowner','provolatile','proconfig','prosecdef','SET LOCAL ROLE','RESET ROLE'])assert.ok(sql.includes(text),text);
});
test('all PL/pgSQL IF conditions shield SQL CASE from depth-zero THEN',()=>{
 // Static lexical containment check only, not SQL execution or a PG parser.
 // PG17 pl_gram.y read_sql_construct stops at K_THEN at depth zero and counts
 // parentheses/brackets, not CASE/END. Check every IF/ELSIF, not only recovery.
 const sql=readFileSync(candidate,'utf8');
 const tokens=[...sql.matchAll(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z0-9_]*|[()[\];]/g)]
  .filter(t=>!t[0].startsWith('--')&&!t[0].startsWith('/*'));
 const hazards=[];let checked=0;
 for(let i=0;i<tokens.length;i++){
  const keyword=tokens[i][0].toUpperCase();
  if(!['IF','ELSIF'].includes(keyword)||tokens[i-1]?.[0].toUpperCase()==='END')continue;
  let depth=0,terminated=false;checked++;
  for(let j=i+1;j<tokens.length;j++){
   const token=tokens[j][0].toUpperCase();
   if(token==='('||token==='[')depth++;
   else if(token===')'||token===']')depth--;
   else if(token==='CASE'&&depth===0)hazards.push({line:sql.slice(0,tokens[j].index).split('\n').length});
   else if(token==='THEN'&&depth===0){terminated=true;break;}
   else if(token===';')break;
  }
  assert.ok(terminated,'Every IF condition must reach a top-level THEN');
 }
 assert.ok(checked>20,'Inspect all visit helper IF conditions');
 assert.deepEqual(hazards,[],'Depth-zero SQL CASE truncates a PL/pgSQL IF condition (42601)');
});

test('synthetic visit SQL expressions have balanced parentheses outside literal strings',()=>{
 // Lexical source guard only, not a SQL parser or executed behavior proof.
 for(const path of [candidate,suite]){
  const sql=readFileSync(path,'utf8');
  const tokens=[...sql.matchAll(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[()]/g)];
  const stack=[],extra=[];
  for(const token of tokens){
   if(token[0]==='(')stack.push(token.index);
   else if(token[0]===')'){if(stack.length)stack.pop();else extra.push(sql.slice(0,token.index).split('\n').length);}
  }
  assert.deepEqual(extra,[],`${path.pathname}: unmatched closing parentheses`);
  assert.deepEqual(stack,[],`${path.pathname}: unmatched opening parentheses`);
 }
});

test('declared PL/pgSQL blocks keep SRF output names separate from local variables',()=>{
 // Narrow static namespace audit, not a PostgreSQL parser or SQL proof.
 const mask=text=>text.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"/g,
  match=>match.replace(/[^\n]/g,' '));
 const outputs={jsonb_object_keys:['jsonb_object_keys'],jsonb_array_elements:['value'],jsonb_each:['key','value'],
  unnest:['unnest'],aclexplode:['grantor','grantee','privilege_type','is_grantable']};
 const hazards=[];let sites=0;
 for(const path of [candidate,suite]){
  const sql=readFileSync(path,'utf8');
  for(const block of sql.matchAll(/\$(\w*)\$([\s\S]*?)\$\1\$/g)){
   const body=mask(block[2]),declarations=body.match(/\bDECLARE\b([\s\S]*?)\bBEGIN\b/i)?.[1];
   if(!declarations)continue;
   const variables=new Set([...declarations.matchAll(/(?:^|;)\s*([a-z_][a-z0-9_]*)\s+(?:jsonb|text|numeric|record|integer|boolean|regclass)\b/gi)].map(m=>m[1].toLowerCase()));
   for(const call of body.matchAll(/\b(?:FROM|JOIN)\s+(?:pg_catalog\.)?(jsonb_object_keys|jsonb_array_elements|jsonb_each|unnest|aclexplode)\s*\(/gi)){
    sites++;let cursor=call.index+call[0].length,depth=1;
    while(depth>0&&cursor<body.length){if(body[cursor]==='(')depth++;else if(body[cursor]===')')depth--;cursor++;}
    assert.equal(depth,0,'Every audited SRF call has a closed argument list');
    const tail=body.slice(cursor),match=tail.match(/^\s+(?:AS\s+)?([a-z_][a-z0-9_]*)(?:\s*\(([^)]*)\))?/i);
    const alias=match&&!['loop','where','order','group','limit','on','union','end','else','then'].includes(match[1].toLowerCase())?match:null;
    let columns=outputs[call[1].toLowerCase()];
    if(alias?.[2])columns=alias[2].split(',').map(x=>x.trim().toLowerCase());
    else if(alias&&call[1].toLowerCase()==='jsonb_object_keys')columns=[alias[1].toLowerCase()];
    for(const column of columns)if(variables.has(column))hazards.push({file:path.pathname,column});
   }
  }
 }
 assert.equal(sites,9,'Audit every current declared-block SRF site in candidate and fixture');
 assert.deepEqual(hazards,[],'SRF output aliases must not collide with same-block PL/pgSQL variables (42702)');
});
