// Source/containment checks only. Passing Node never constitutes PostgreSQL proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {foundationTopLevelSql,foundationSqlPaths,foundationExpectedMarkers,buildCatalogueFoundationSession} from '../../scripts/catalogue-foundation.mjs';
import {cataloguePublicSourcePaths} from '../../scripts/catalogue-capture-source.mjs';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const candidate=read('supabase/catalogue/v1/new06-co-order-boundaries.sql');
const behavior=read('tests/database/catalogue/co-orders.sql');
const source=read('supabase/migrations/20261009110004_co_returns_corrections.sql');
const body=(text,name)=>{
 const starts=[...text.matchAll(new RegExp('^CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('.','\\.')+'\\(','gm'))];
 const start=starts.at(-1)?.index;assert.ok(start!==undefined,name);
 const a=text.indexOf('AS $$',start)+5,b=text.indexOf('END $$;',a)+4;assert.ok(b>a,name);
 return text.slice(a,b);
};
const hash=x=>createHash('sha256').update(x).digest('hex');
const monthlyHook=text=>text.replace('   g:=private.co_materialize_generation_v1(c,v+1,actor,plan,revision,line_ids);','   PERFORM private.co_link_evidence_v1(c,head,revision,d.id,d.version);\n   g:=private.co_materialize_generation_v1(c,v+1,actor,plan,revision,line_ids);');
test('CO candidate and behavior are bounded fragments with no transaction or activation escape',()=>{
 assert.doesNotThrow(()=>foundationTopLevelSql(candidate));assert.doesNotThrow(()=>foundationTopLevelSql(behavior));
 assert.doesNotMatch(candidate,/ALTER\s+TABLE\s+private\.catalog_cutover_v1|UPDATE\s+private\.catalog_cutover_v1/i);
 assert.match(candidate,/execution_version smallint NOT NULL DEFAULT 1 CHECK\(execution_version IN\(1,2\)\)/);
 assert.doesNotMatch(candidate,/CREATE(?: OR REPLACE)? FUNCTION private\.co_command_begin_v1\(/);
 assert.match(candidate,/state\.execution_generation<>2 OR NOT state\.tracking_ready/);
});
test('CO legacy dispatcher is byte-exact and every v2 writer differs only at approved seams',()=>{
 const original=body(source,'public.pilot_co_transaction_v1');
 assert.equal(hash(original),'2fe1a0188e2d64eaadce590c947e4358ac6e620117b5470abde87eb8dd6fdace');
 assert.equal(body(candidate,'private.catalog_co_legacy_transaction_v1'),original);
 assert.equal(hash(body(source,'private.co_orders_transaction_v1')),'5a8fd19becd31fe379b276dbcbe36ac6331574510fe78159850b02dc800556f6');
 assert.equal(hash(monthlyHook(body(source,'private.co_monthly_transaction_v1'))),'0442408fd2b5cee0326495e155f75f62ae96a30bd02e1888fcebdb3204ddf61f');
 for(const [oldName,newName,monthly] of [
  ['private.co_orders_transaction_v1','private.catalog_co_orders_transaction_v2',false],
  ['private.co_monthly_transaction_v1','private.catalog_co_monthly_transaction_v2',true],
  ['public.pilot_co_transaction_v1','private.catalog_co_dispatch_v2',false],
 ]){
  let expected=body(source,oldName);if(monthly)expected=monthlyHook(expected);
  expected=expected.replaceAll('private.co_command_begin_v1(','private.catalog_co_command_begin_v2(').replaceAll('private.co_write_order_lines_v1(','private.catalog_co_write_order_lines_v2(').replaceAll('private.co_orders_transaction_v1(','private.catalog_co_orders_transaction_v2(').replaceAll('private.co_monthly_transaction_v1(','private.catalog_co_monthly_transaction_v2(');
  expected=expected.replaceAll("private.co_lock_customer_v1(customer,private.co_input_version_v1(p_payload->'expected_customer_version'))","private.catalog_co_customer_phase_v2(customer,private.co_input_version_v1(p_payload->'expected_customer_version'),CASE WHEN p_operation IN('create_co','edit_co') THEN p_payload->'lines' ELSE '[]'::jsonb END)").replaceAll("private.co_lock_customer_v1(c,private.co_input_version_v1(p_payload->'expected_customer_version'))","private.catalog_co_customer_phase_v2(c,private.co_input_version_v1(p_payload->'expected_customer_version'),'[]'::jsonb)");
  assert.equal(body(candidate,newName),expected,newName);
 }
 assert.match(candidate,/'private\.co_publish_reviewed_v1\(uuid,uuid,uuid,text,jsonb,text\)','bece31e4/);
});
test('CO exact operation authorized replay precedes target classification and every new scope/gate lock',()=>{
 for(const name of ['public.pilot_co_transaction_v1','private.catalog_co_transaction_core_v2','private.catalog_co_transaction_v2']){
  const b=body(candidate,name);assert.ok(b.indexOf('private.catalog_co_replay_v2(')<b.indexOf('IF result IS NOT NULL THEN RETURN result;'));
  const after=b.slice(b.indexOf('IF result IS NOT NULL THEN RETURN result;'));
  if(name.includes('core'))assert.ok(after.includes('INSERT INTO private.catalog_co_active_v2'));
  if(name==='private.catalog_co_transaction_v2')assert.ok(after.includes('FOR SHARE'));
 }
 const replay=body(candidate,'private.catalog_co_replay_v2');
 assert.ok(replay.indexOf('private.co_actor_v1()')<replay.indexOf('FROM private.co_commands'));
 assert.ok(replay.indexOf('command.operation IS DISTINCT FROM p_operation')<replay.indexOf("command.status='committed'"));
 assert.doesNotMatch(replay,/FROM private\.co_(?:drafts|orders|stock_keys)|FROM public\.(?:customers|products)|catalog_identity_v1|catalog_cutover_v1/);
 assert.match(body(candidate,'private.catalog_co_command_begin_v2'),/status,execution_version\)[\s\S]*'pending',2\)/);
});
test('CO full prepared chronology and master phase precedes evidence and stock helper takes no locks',()=>{
 const phase=body(candidate,'private.catalog_co_customer_phase_v2');
 const spans=['version:=private.co_lock_customer_v1','FROM private.co_orders','FROM private.co_delivery_heads','FROM private.co_return_heads','FROM private.co_report_heads','FROM private.co_drafts','FROM public.customers','FROM public.products','LOCK TABLE private.catalog_identity_v1','pg_try_advisory_xact_lock','FOR UPDATE NOWAIT'];
 for(let i=1;i<spans.length;i++)assert.ok(phase.indexOf(spans[i-1])<phase.indexOf(spans[i]),spans[i]);
 assert.match(phase,/SELECT k\.product_id id FROM private\.co_stock_keys k WHERE k\.customer_id=customer/);
 assert.match(phase,/array_agg\(DISTINCT id ORDER BY id\)/);
 const stock=body(candidate,'private.catalog_co_stock_key_v2');
 assert.ok(stock.indexOf('FROM public.products')<stock.indexOf('FROM private.co_stock_keys'));
 assert.ok(stock.indexOf('product.is_enabled')<stock.indexOf('FROM private.co_stock_keys'));
 assert.ok(stock.indexOf('Product ID and SKU do not match')<stock.indexOf('FROM private.co_stock_keys'));
 assert.match(stock,/existing\.product_id IS DISTINCT FROM product\.id/);
 assert.doesNotMatch(stock,/FOR SHARE|FOR UPDATE|advisory|co_lock_customer_v1\(/);
 const lines=body(candidate,'private.catalog_co_write_order_lines_v2');
 assert.match(lines,/product\.id IS NOT NULL AND NOT product\.is_enabled AND q>current_line\.ordered_quantity/);
 assert.doesNotMatch(lines,/stock\.normalized_sku IS DISTINCT FROM|product\.id IS NULL OR NOT product\.is_enabled/);
 assert.match(lines,/co_delivered_line_quantity_v1\(line_id\)\+current_line\.resolved_undelivered_quantity/);
});
test('CO assertions use actual OLD and NEW after context cleanup without taking locks or repairing evidence',()=>{
 assert.match(body(candidate,'private.catalog_co_assert_event_v2'),/TG_OP<>'INSERT'[\s\S]*to_jsonb\(OLD\)[\s\S]*TG_OP<>'DELETE'[\s\S]*to_jsonb\(NEW\)/);
 for(const name of ['catalog_co_assert_ref_v2','catalog_co_assert_stock_v2','catalog_co_assert_line_v2','catalog_co_assert_json_v2','catalog_co_assert_event_v2']){
  const b=body(candidate,'private.'+name);assert.doesNotMatch(b,/FOR UPDATE|FOR SHARE|pg_(?:try_)?advisory|\b(?:INSERT INTO|UPDATE private|DELETE FROM)\b/);
  assert.doesNotMatch(b,/catalog_co_active_v2\(/);
 }
 assert.match(body(candidate,'private.catalog_co_assert_line_v2'),/a\.before_state->'lines'/);
 assert.match(candidate,/'co_commands','co_audit_events','co_report_evidence'/);
 assert.match(candidate,/WHEN \(private\.catalog_co_active_v2\(\)\)/);
 assert.match(candidate,/GRANT EXECUTE ON FUNCTION private\.catalog_co_active_v2\(\) TO PUBLIC/);
 assert.match(candidate,/a\.grantee<>p\.proowner/);
});
test('CO actual-role suite covers canonical keys, immutable history, final composition and assertion failures',()=>{
 for(const label of ['authenticated cannot call admitted CO core','authenticated cannot call v2 begin','authenticated cannot establish CO scope',
 'disabled customer caps each persisted line','disabled product own cap survives enabled customer','retained enabled historical identity allows increase after catalogue SKU rename',
 'canonical SKU checked before existing customer SKU key reuse','same product reuses immutable saved key label and requested agreed price','legacy null key blocks new selected use instead of relinking',
 'different product ID on existing stock key blocks new use','post_sj receipt replay precedes later correction draft classification','committed replay does not newly mark customer stock references',
 'disabled catalogue masters do not block historical fulfillment','historical return correction keeps revision semantics','final stage08 monthly publication links evidence',
 'removed CO line UUID cannot be reused','non-edit before snapshot retains retired CO identity refusal','foreign persisted CO line cannot be claimed','missing master does not invent a stricter historical quantity cap',
 'supported edit removes unposted line after draft snapshot','actual deleted OLD stock identity missing mark aborts','early CO state insertion queues missing customer assertion','forced immediate missing CO evidence fails closed',
 'former CO current authority revoked before own receipt recovery','legacy loaded begin default remains generation one'])assert.ok(behavior.includes(label),label);
 assert.match(behavior,/SET LOCAL ROLE authenticated/);assert.match(behavior,/SET LOCAL ROLE anon/);assert.match(behavior,/SET LOCAL ROLE service_role/);
 assert.match(behavior,/SET CONSTRAINTS ALL IMMEDIATE;\nSET CONSTRAINTS ALL DEFERRED;/);
});
test('CO positive actor fixture is independent of earlier role revocation probes',()=>{
 const roles=read('tests/database/catalogue/roles.sql');
 assert.ok(roles.includes("UPDATE public.users SET role='po_admin' WHERE id=md5('catalogue-foundation-actor-1')::uuid;"));
 assert.ok(roles.includes("UPDATE public.users SET is_active=false WHERE id=md5('catalogue-foundation-actor-1')::uuid;"));
 assert.equal(behavior.includes('catalogue-foundation-actor-1'),false,'CO must not reuse the actor revoked by the earlier suite');
 const auth="INSERT INTO auth.users(id) VALUES(md5('co-guard-actor')::uuid);";
 const profile="VALUES(md5('co-guard-actor')::uuid,'Fictional CO guard actor','co-guard@example.invalid','co_admin',true);";
 const claims="SELECT set_config('request.jwt.claim.sub',md5('co-guard-actor')::uuid::text,true);";
 assert.ok(behavior.indexOf(auth)>=0&&behavior.indexOf(auth)<behavior.indexOf(profile));
 assert.ok(behavior.indexOf(profile)<behavior.indexOf(claims));
 assert.ok(behavior.includes("'dedicated CO fixture starts active with CO authority'"));
 assert.ok(behavior.includes("UPDATE public.users SET role='po_admin' WHERE id=md5('co-guard-actor')::uuid;"));
 assert.ok(behavior.includes("UPDATE public.users SET role='co_admin',is_active=false WHERE id=md5('co-guard-actor')::uuid;"));
 assert.ok(behavior.includes("UPDATE public.users SET is_active=true WHERE id=md5('co-guard-actor')::uuid;"));
 assert.ok(behavior.includes("set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-2')"));
});
test('CO service role denial probe does not require an ungranted temporary assertion helper',()=>{
 const probe=behavior.split('SET LOCAL ROLE service_role;')[1]?.split('RESET ROLE;')[0];
 assert.ok(probe);
 assert.equal(/\b(?:SELECT|PERFORM)\s+pg_temp\./.test(probe),false,'Service role must test the RPC itself, not fail entering the assertion helper');
 assert.match(probe,/DO \$\$ DECLARE denied boolean:=false;/);
 assert.match(probe,/current_user<>'service_role'/);
 assert.match(probe,/PERFORM public\.pilot_co_transaction_v1/);
 assert.match(probe,/EXCEPTION WHEN insufficient_privilege THEN denied:=true;/);
 assert.match(probe,/IF NOT denied THEN RAISE EXCEPTION/);
});
test('CO fixture authority updates clear inherited JWT only during trusted owner maintenance',()=>{
 const security=read('supabase/migrations/202609300001_pilot_security.sql');
 assert.ok(security.includes('IF auth.uid() IS NULL THEN RETURN NEW; END IF;'));
 assert.ok(security.includes("(OLD.id=auth.uid() OR public.current_user_role()<>'executive')"));
 for(const change of ["role='po_admin'","role='co_admin',is_active=false","is_active=true"]) {
  const sequence="RESET ROLE;\nSELECT set_config('request.jwt.claim.sub','',true);\n"
   +`UPDATE public.users SET ${change} WHERE id=md5('co-guard-actor')::uuid;\n`
   +"SELECT set_config('request.jwt.claim.sub',md5('co-guard-actor')::uuid::text,true);\n";
  assert.ok(behavior.includes(sequence),`Owner fixture update must clear and restore JWT: ${change}`);
 }
 assert.equal(/DISABLE\s+TRIGGER|DROP\s+TRIGGER|CREATE(?: OR REPLACE)? FUNCTION private\.pilot_guard_user_update/i.test(behavior),false);
});
test('CO SQL and source checks are captured and rollback-gated in the existing bounded runner',()=>{
 assert.equal(foundationSqlPaths.coOrderCandidate,'supabase/catalogue/v1/new06-co-order-boundaries.sql');assert.equal(foundationSqlPaths.coOrders,'tests/database/catalogue/co-orders.sql');
 assert.ok(foundationExpectedMarkers.includes('CATALOGUE_CO_ORDERS_CORE_PASSED'));
 for(const path of [foundationSqlPaths.coOrderCandidate,foundationSqlPaths.coOrders,'tests/catalogue-ci/co-orders.node.mjs'])assert.ok(cataloguePublicSourcePaths.includes(path));
 const strict=read('tests/catalogue-ci/capture.test.ts');
 const expected=strict.match(/expect\(runner\.cataloguePublicSourcePaths\)\.toEqual\(\[([\s\S]*?)\]\)/)?.[1];assert.ok(expected);
 assert.deepEqual([...expected.matchAll(/'([^']+)'/g)].map(x=>x[1]),cataloguePublicSourcePaths);
 const parts=Object.fromEntries(Object.keys(foundationSqlPaths).map(key=>[key,`SELECT 1 AS ${key};`]));
 parts.guardedDelete='SAVEPOINT guarded_delete_fixture;\nSELECT 1 AS guarded_delete;\nROLLBACK TO SAVEPOINT guarded_delete_fixture;\nRELEASE SAVEPOINT guarded_delete_fixture;';
 parts.guardedDeleteHistory='SAVEPOINT guarded_delete_history_fixture;\n'+['trusted_history_fixture','trusted_history_topology','trusted_history_removed_visit','trusted_history_retired_co'].map(name=>`SAVEPOINT ${name};\nSELECT 1 AS ${name};\nROLLBACK TO SAVEPOINT ${name};\nRELEASE SAVEPOINT ${name};`).join('\n')+'\nROLLBACK TO SAVEPOINT guarded_delete_history_fixture;\nRELEASE SAVEPOINT guarded_delete_history_fixture;';
 const identity={profile:'github-catalogue-baseline-v1',source:{clean:true,commit:'a'.repeat(40),tree:'b'.repeat(40),candidate:'c'.repeat(64)},serverAddress:'172.18.0.2',serverPort:5432,serverVersion:'170011',systemIdentifier:'123456789',runIdentity:'00000000-0000-4000-8000-000000000001',ci:{}};
 const sql=buildCatalogueFoundationSession(identity,parts);
 assert.ok(sql.indexOf(parts.orders)<sql.indexOf(parts.coOrderCandidate));assert.ok(sql.indexOf(parts.coOrderCandidate)<sql.indexOf(parts.coOrders));assert.ok(sql.indexOf(parts.coOrders)<sql.lastIndexOf('ROLLBACK;'));
 for(const text of ["pg_catalog.to_regclass('private.catalog_co_active_v2') IS NULL","pg_catalog.to_regprocedure('private.catalog_co_transaction_core_v2(uuid,text,jsonb)') IS NULL","attname='execution_version'","253ac5728e67fa26e1736bca30ccc4b0"])assert.equal(sql.split(text).length,3,text);
});
