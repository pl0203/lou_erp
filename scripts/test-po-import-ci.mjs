// Fixed, credential-free synthetic companion database on the authorized CI service.
import { execFileSync } from 'node:child_process';
import { readFileSync,readdirSync,mkdirSync,writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { rolloutCiConnection } from './test-read-rollout-ci.mjs';
import { buildPoImportBaselineSql,buildPoImportPackets,hashImportManifest,assertPoImportPacketSet,IMPORT_RELATIONS,IMPORT_CUSTOMER_CATEGORIES } from './build-po-import-packets.mjs';
import { buildCustomerCategoryBaselineSql,buildCustomerCategoryLegacyAuditSql } from './build-customer-category-review.mjs';
import { syntheticImportManifest,syntheticImportSizeManifest,syntheticCategoryImportManifest } from '../tests/fixtures/po-import-manifest.mjs';
export const CATEGORY_MIGRATION='202610020001_customer_categories.sql';
export function isExpectedImportRefusal(stderr,message,sqlstate='P0001') {
 const errors=String(stderr).split(/\r?\n/).filter(line=>/^(?:psql:(?:[^\n]*?:)?\s*)?(?:ERROR|FATAL|PANIC):/i.test(line));
 if(errors.length!==1||!/^\w{5}$/.test(sqlstate))return false;
 return errors[0].replace(/^(?:psql:[^\n]*?:\s*)?ERROR:\s+/,'')===`${sqlstate}: ${message}`;
}
export function assertCategoryTransitionPreserved(before,after) {
 if(before.schema_md5===after.schema_md5||before.customers!==after.customers||!isDeepStrictEqual(before.access,after.access))throw new Error('Category migration changed protected customer state/access');
 const omitCustomers=baseline=>Object.fromEntries(Object.entries(baseline).filter(([relation])=>relation!=='public.customers'));
 if(!isDeepStrictEqual(omitCustomers(before.baselineData),omitCustomers(after.baselineData))||before.baselineData['public.customers'].rows!==after.baselineData['public.customers'].rows)throw new Error('Category migration changed protected baseline/history');
}
const exactKeys=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&isDeepStrictEqual(Object.keys(value).sort(),[...keys].sort());
const md5=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const categoryRowsValid=rows=>Array.isArray(rows)&&rows.every(row=>exactKeys(row,['id','customer_category'])&&uuid(row.id)&&(row.customer_category===null||IMPORT_CUSTOMER_CATEGORIES.includes(row.customer_category)))&&isDeepStrictEqual(rows.map(row=>row.id),[...new Set(rows.map(row=>row.id))].sort());
const reviewIdentityValid=identity=>exactKeys(identity,['database','current_user','session_user','server_address','server_port','server_version','captured_at','transaction_read_only','transaction_isolation','row_security','timezone','search_path'])
 &&identity.database==='pilot_import_test'&&identity.current_user==='postgres'&&identity.session_user==='postgres'
 &&identity.transaction_read_only==='on'&&identity.transaction_isolation==='repeatable read'&&identity.row_security==='off'&&identity.timezone==='UTC'&&identity.search_path==='""'
 &&typeof identity.server_address==='string'&&Number.isInteger(identity.server_port)&&typeof identity.server_version==='string'&&!Number.isNaN(Date.parse(identity.captured_at));
export function assertCustomerCategoryReadOnlySql(sql) {
 const statements=String(sql).replace(/'(?:[^']|'')*'/g,"''").replace(/--[^\n]*/g,'');
 if(!sql.startsWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;')||!sql.endsWith('\nROLLBACK;\n')
 ||["SET LOCAL TIME ZONE 'UTC';","SET LOCAL search_path='';",'SET LOCAL row_security=off;',"SET LOCAL statement_timeout='30s';","SET LOCAL lock_timeout='5s';","SET LOCAL idle_in_transaction_session_timeout='30s';"].some(setting=>!sql.includes(setting))
 ||/\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|COMMIT|LOCK|dblink|pg_terminate_backend|pg_read_file|lo_import)\b/i.test(statements))throw new Error('Category read-only SQL contract changed');
}
export function assertCustomerCategoryBaselineEvidence(value,categoryColumnPresent) {
 const keys=['review_version','identity','schema','schema_md5','protected_data','request_states','category_column_present','category_rows','invalid_category_ids'];
 const schemaKeys=['schemas','types','tables','columns','constraints','policies','functions','triggers','indexes','roles','memberships','category_column'];
 const requestKeys=['actor_id','request_id','operation','created_at','state','completed','abandoned','source_key','model','plan_sha256','manifest_sha256','master_rows_md5','master_model_sha256','master_model_bytes','po_model_sha256','po_model_bytes','provenance_present','payload_md5','result','result_md5','result_id','result_po_id','payload_po_id'];
 if(!exactKeys(value,keys)||value.review_version!=='customer-category-baseline-v1'||!reviewIdentityValid(value.identity)||!md5(value.schema_md5)
 ||!exactKeys(value.schema,schemaKeys)||schemaKeys.filter(key=>key!=='category_column').some(key=>value.schema[key]!==null&&!Array.isArray(value.schema[key]))
 ||!exactKeys(value.protected_data,IMPORT_RELATIONS)||Object.values(value.protected_data).some(state=>!exactKeys(state,['rows','content_md5'])||!Number.isSafeInteger(state.rows)||state.rows<0||!md5(state.content_md5))
 ||!Array.isArray(value.request_states)||value.request_states.length!==value.protected_data['private.pilot_order_requests'].rows
 ||value.request_states.some(request=>!exactKeys(request,requestKeys)||!uuid(request.actor_id)||!uuid(request.request_id)||typeof request.completed!=='boolean'||typeof request.abandoned!=='boolean'||request.state!==(request.abandoned?'ABANDONED':request.completed?'COMPLETED':'PENDING')||!md5(request.payload_md5)||(request.result_md5!==null&&!md5(request.result_md5)))
 ||new Set(value.request_states.map(request=>`${request.actor_id}/${request.request_id}`)).size!==value.request_states.length
 ||value.category_column_present!==categoryColumnPresent||!categoryRowsValid(value.category_rows)||value.category_rows.length!==value.protected_data['public.customers'].rows||!isDeepStrictEqual(value.invalid_category_ids,[]))throw new Error('Category baseline evidence incomplete or unsafe');
 const column=value.schema.category_column;
 if(categoryColumnPresent?(!exactKeys(column,['present','type','notnull','default','acl','identity','generated'])||column.present!==true||column.type!=='text'||column.notnull!==false||![null,'NULL::text'].includes(column.default)||column.acl!==null||column.identity!==''||column.generated!==''):column!==null)throw new Error('Category baseline evidence column contract changed');
}
const legacyCustomerColumns={id:'uuid',name:'text',address:'text',city:'text',phone:'text',email:'text',pricing_tier:'public.pricing_tier',visit_frequency_days:'integer',last_visit_date:'date',created_at:'timestamp with time zone'};
const legacyProductColumns={id:'uuid',name:'text',sku:'text',size:'text',unit_price:'numeric(14,2)',harga_pokok:'numeric(14,2)',luar_kota:'numeric(14,2)',dalam_kota:'numeric(14,2)',depo_bangunan:'numeric(14,2)',created_at:'timestamp with time zone'};
export function assertCustomerCategoryAuditEvidence(value,expected) {
 const keys=['review_version','identity','expected_master_rows_md5','actual_master_rows_md5','source_status','source_match','source_projection_matches_schema','source_schema','requested_customer_ids','requested_product_ids','missing_customer_ids','missing_product_ids','category_column_present','category_status','category_rows','invalid_category_ids'];
 const schema=value?.source_schema;
 const schemaValid=exactKeys(schema,['customer_columns','product_columns','expected_customer_columns','expected_product_columns']);
 const schemaMatches=schemaValid&&isDeepStrictEqual(schema.customer_columns,schema.expected_customer_columns)&&isDeepStrictEqual(schema.product_columns,schema.expected_product_columns);
 if(!exactKeys(value,keys)||value.review_version!=='customer-category-legacy-audit-v1'||!reviewIdentityValid(value.identity)
 ||value.expected_master_rows_md5!==expected.expectedMasterRowsMd5||!md5(value.actual_master_rows_md5)
 ||(expected.actualMasterRowsMd5==='different'?value.actual_master_rows_md5===expected.expectedMasterRowsMd5:value.actual_master_rows_md5!==expected.actualMasterRowsMd5)
 ||!isDeepStrictEqual(schema?.expected_customer_columns,legacyCustomerColumns)||!isDeepStrictEqual(schema?.expected_product_columns,legacyProductColumns)
 ||value.source_status!==expected.sourceStatus||value.source_match!==(expected.sourceStatus==='MATCH')||!schemaValid||schemaMatches!==expected.sourceSchemaMatches||value.source_projection_matches_schema!==schemaMatches
 ||!isDeepStrictEqual(value.requested_customer_ids,[...expected.customerIds].sort())||!isDeepStrictEqual(value.requested_product_ids,[...expected.productIds].sort())
 ||!isDeepStrictEqual(value.missing_customer_ids,expected.missingCustomerIds)||!isDeepStrictEqual(value.missing_product_ids,expected.missingProductIds)
 ||value.category_column_present!==expected.categoryColumnPresent||value.category_status!==(expected.categoryColumnPresent?'VALID':'NOT_PRESENT')
 ||!categoryRowsValid(value.category_rows)||!isDeepStrictEqual(value.category_rows,expected.categoryRows)||!isDeepStrictEqual(value.invalid_category_ids,[]))throw new Error('Category audit evidence does not match the saved inventory and expected verdict');
}
export function assertCustomerCategoryReadUnchanged(before,after) {
 const stable=value=>({...value,identity:Object.fromEntries(Object.entries(value.identity).filter(([key])=>key!=='captured_at'))});
 if(!isDeepStrictEqual(stable(before),stable(after)))throw new Error('Category read changed full protected baseline, metadata, requests or categories');
}
export function customerCategoryLegacyInventory({resolved,receipts,manifestSha256,planSha256}) {
 if(!Array.isArray(receipts)||!receipts.some(receipt=>receipt.skipped===false)||receipts.some(receipt=>receipt.model!=='po-import-v1'||receipt.manifest_sha256!==manifestSha256||receipt.plan_sha256!==planSha256||!Number.isSafeInteger(receipt.packet_index)||receipt.packet_index<0||!Number.isSafeInteger(receipt.verified_through)||receipt.verified_through<receipt.packet_index||!md5(receipt.master_rows_md5)||receipt.master_rows_md5!==receipts[0].master_rows_md5))throw new Error('Unchanged successful saved v1 receipt required for legacy audit');
 const input={customerIds:resolved.customers.map(row=>row.id).sort(),productIds:resolved.products.map(row=>row.id).sort(),expectedMasterRowsMd5:receipts[0].master_rows_md5};
 // Reuse the frozen builder's exact original-ID validation; never compute a new pin.
 buildCustomerCategoryLegacyAuditSql(input);
 return {...input,receipts:structuredClone(receipts)};
}
export function parseCustomerCategoryReviewJson(output) {
 const lines=String(output).trim().split('\n').filter(Boolean);
 if(lines.length!==1||!lines[0].startsWith('{'))throw new Error('Complete single category review JSON result required');
 try{return JSON.parse(lines[0]);}catch(error){throw new Error('Complete single category review JSON result required',{cause:error});}
}
export function poImportCiPsqlInvocation(connection,sql,database,remaining) {
 // Pure argument preparation for this one guarded runner, not an execution route.
 return {file:'psql',args:['-X','--no-password','-qAt','--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose'],options:{env:{...connection,PGDATABASE:database},input:sql,encoding:'utf8',maxBuffer:32*1024*1024,timeout:Math.min(120000,remaining),shell:false,stdio:['pipe','pipe','pipe']}};
}
export async function runPoImportCi({env=process.env,execute=execFileSync,repoRoot=process.cwd()}={}) {
 const connection=rolloutCiConnection(env);
 let phaseDeadline=Infinity;
 const run=(sql,db='pilot_import_test')=>{const remaining=phaseDeadline-Date.now();if(remaining<=0)throw new Error('Bounded synthetic import phase exceeded ten minutes');const call=poImportCiPsqlInvocation(connection,sql,db,remaining);return execute(call.file,call.args,call.options);};
 const oneJson=s=>JSON.parse(s.trim().split('\n').filter(Boolean).at(-1));
 const marker=run("SELECT current_database()='pilot_test' AND current_user='postgres' AND (SELECT count(*) FROM public.pilot_fixture_marker)=1 AND EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci');",'pilot_test').trim();
 if(marker!=='t')throw new Error('Original disposable fixture marker required');
 run('CREATE DATABASE pilot_import_test;','postgres');
 run(readFileSync(`${repoRoot}/tests/database/fixture.sql`,'utf8'));
 const files=readdirSync(`${repoRoot}/supabase/migrations`).filter(f=>f.endsWith('.sql')).sort();
 for(const file of files.filter(f=>f<'202610010001_scalable_order_reads.sql'))run(readFileSync(`${repoRoot}/supabase/migrations/${file}`,'utf8'));
 const topology=readFileSync(`${repoRoot}/tests/database/hosted-read-policy-fixture.sql`,'utf8');
 if(topology.split("current_database()<>'pilot_test'").length!==2)throw new Error('Unexpected disposable topology guard');
 run(topology.replace("current_database()<>'pilot_test'","current_database()<>'pilot_import_test'"));
 for(const file of files.filter(f=>f>='202610010001_scalable_order_reads.sql'&&f!==CATEGORY_MIGRATION))run(readFileSync(`${repoRoot}/supabase/migrations/${file}`,'utf8'));
 // Explicit provider/schema approximations and insertion-only audit semantics.
 // These are synthetic test definitions, never a hosted bootstrap.
 run(`ALTER TABLE auth.users ADD COLUMN email text,ADD COLUMN role text,ADD COLUMN aud text,ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE storage.objects ADD COLUMN metadata jsonb;
ALTER TABLE public.products ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION public.log_line_item_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,new_value) VALUES(NEW.purchase_order_id,auth.uid(),'line_item_added','Synthetic line insert'); END IF;
 RETURN coalesce(NEW,OLD); END $$;
CREATE OR REPLACE FUNCTION public.log_sj_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP='INSERT' THEN INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,new_value) VALUES(NEW.purchase_order_id,auth.uid(),'sj_created','Synthetic shipment insert'); END IF;
 RETURN coalesce(NEW,OLD); END $$;
CREATE FUNCTION public.synthetic_import_fault() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF current_setting('pilot.import_fault',true)='on' AND NEW.sku='HISTORIC-A' THEN RAISE EXCEPTION 'Synthetic import fault'; END IF;
 IF current_setting('pilot.import_fault',true)='later' AND EXISTS(SELECT 1 FROM public.purchase_orders WHERE id=NEW.purchase_order_id AND po_number IN('SYNTH-IMPORT-partial','SYNTH-FUTURE-2')) THEN RAISE EXCEPTION 'Synthetic later-batch import fault'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_import_fault BEFORE INSERT ON public.po_line_items FOR EACH ROW EXECUTE FUNCTION public.synthetic_import_fault();
INSERT INTO auth.users(id,email,role,aud) VALUES('98000000-0000-0000-0000-000000000001','synthetic-import@example.invalid','authenticated','authenticated');
INSERT INTO public.users(id,email,full_name,role,is_active) VALUES('98000000-0000-0000-0000-000000000001','synthetic-import@example.invalid','Synthetic import actor','executive',true);
INSERT INTO public.customers(id,name) VALUES('98000000-0000-0000-0000-000000000002','Original synthetic customer');
INSERT INTO public.products(id,name,sku,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan) VALUES('98000000-0000-0000-0000-000000000003','Original synthetic product','ORIGINAL-SYNTHETIC',10,8,10,11,9);
BEGIN; SELECT set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
SELECT public.pilot_order_transaction('98000000-0000-0000-0000-000000000004','create_po','{"customer_id":"98000000-0000-0000-0000-000000000002","po_number":"ORIGINAL-SYNTHETIC-PO","order_date":"2026-01-01","items":[{"product_name":"Original synthetic line","sku":"ORIGINAL-SYNTHETIC","quantity":5,"unit_price":10}]}'::jsonb); COMMIT;`);
 const snapshot=(modelVersion='po-import-v1')=>oneJson(run("BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path='';\n"+buildPoImportBaselineSql({modelVersion})+'\nROLLBACK;'));
 const before=snapshot(),manifest=syntheticImportManifest();
 const config={expectedManifestSha256:hashImportManifest(manifest),expectedProjectRef:'a'.repeat(20),expectedDatabase:'pilot_import_test',disposableFixture:'disposable-pilot-ci',actorId:'98000000-0000-0000-0000-000000000001',actorEmail:'synthetic-import@example.invalid',actorRole:'executive',schemaMd5:before.schema_md5,baselineData:before.baselineData,expectedFunctionHashes:before.expectedFunctionHashes,expectedAuditFields:['status','line_item_added','sj_created','sj_lines_revised'],batchSize:2};
 const built=buildPoImportPackets({manifest,config});assertPoImportPacketSet({manifest,config,packets:built.packets});
 const v1Receipts=[];
 mkdirSync(`${repoRoot}/import-results`,{recursive:true});
 for(const p of built.packets)writeFileSync(`${repoRoot}/import-results/packet-${p.index}.sql`,p.sql);
 const reject=(sql,expected,sqlstate='P0001')=>{try{run(sql)}catch(error){if(isExpectedImportRefusal(error.stderr,expected,sqlstate))return;throw error;}throw new Error('Expected import rejection did not occur');};
 const unchanged=baseline=>{const current=snapshot();if(JSON.stringify(current.baselineData)!==JSON.stringify(baseline.baselineData)||current.schema_md5!==baseline.schema_md5)throw new Error('Rejected import changed state');};
 reject(buildPoImportPackets({manifest,config:{...config,schemaMd5:'0'.repeat(32)}}).packets[0].sql,'Schema fingerprint changed');unchanged(before);console.log('PO_IMPORT_SCHEMA_DRIFT_REJECTED');
 reject(buildPoImportPackets({manifest,config:{...config,actorEmail:'different-actor@example.invalid'}}).packets[0].sql,'Reviewed active actor changed');unchanged(before);console.log('PO_IMPORT_ACTOR_DRIFT_REJECTED');
 reject(built.packets[1].sql,'Prior packet must commit and verify before this packet');unchanged(before);console.log('PO_IMPORT_OUT_OF_ORDER_REJECTED');
 reject("SET pilot.import_fault='on';\n"+built.packets[0].sql,'Synthetic import fault');unchanged(before);console.log('PO_IMPORT_ATOMIC_FAILURE_VERIFIED');
 const runPacket=p=>{const output=run(p.sql);const lines=output.trim().split('\n').filter(x=>x.startsWith('PO_IMPORT_PACKET_COMMITTED|'));if(lines.length!==1)throw new Error('Import receipt marker missing');const receipt=JSON.parse(lines[0].slice('PO_IMPORT_PACKET_COMMITTED|'.length));if(receipt.packet_index!==p.index||receipt.manifest_sha256!==built.manifestSha256||receipt.plan_sha256!==built.planSha256||receipt.verified_through<p.index)throw new Error('Import receipt mismatch');v1Receipts.push(receipt);return receipt;};
 // Intentionally discard the first committed output to model a lost response.
 run(built.packets[0].sql);const first=snapshot();if(!runPacket(built.packets[0]).skipped)throw new Error('Lost-response replay was not skipped');unchanged(first);console.log('PO_IMPORT_LOST_RESPONSE_REPLAY_VERIFIED');
 const sameSession=run(built.packets[0].sql+'\n'+built.packets[0].sql).trim().split('\n').filter(x=>x.startsWith('PO_IMPORT_PACKET_COMMITTED|')).map(x=>JSON.parse(x.slice('PO_IMPORT_PACKET_COMMITTED|'.length)));
 if(sameSession.length!==2||sameSession.some(r=>!r.skipped||r.packet_index!==0||r.manifest_sha256!==built.manifestSha256))throw new Error('Same-session replay receipt mismatch');unchanged(first);console.log('PO_IMPORT_SAME_SESSION_REPLAY_VERIFIED');
 reject("SET pilot.import_fault='later';\n"+built.packets[1].sql,'Synthetic later-batch import fault');unchanged(first);console.log('PO_IMPORT_LATER_BATCH_ATOMIC_FAILURE_VERIFIED');
 for(const p of built.packets.slice(1))if(runPacket(p).skipped)throw new Error('New packet was skipped');
 const complete=snapshot();for(const p of built.packets)if(!runPacket(p).skipped)throw new Error('Committed packet replay was not skipped');unchanged(complete);console.log('PO_IMPORT_COMPLETE_REPLAY_VERIFIED');
 const totals=oneJson(run(`SELECT jsonb_build_object('customers',(SELECT count(*) FROM public.customers),'products',(SELECT count(*) FROM public.products),'orders',(SELECT count(*) FROM public.purchase_orders),'lines',(SELECT count(*) FROM public.po_line_items),'shipments',(SELECT count(*) FROM public.surat_jalan),'shipmentLines',(SELECT count(*) FROM public.sj_line_items),'newOrderValue',(SELECT sum(total_value)::text FROM public.purchase_orders WHERE po_number LIKE 'SYNTH-IMPORT-%'),'nullProducts',(SELECT count(*) FROM public.products WHERE unit_price IS NULL AND harga_pokok IS NULL AND luar_kota IS NULL AND dalam_kota IS NULL AND depo_bangunan IS NULL));`));
 if(totals.customers!==2||totals.products!==3||totals.orders!==5||totals.lines!==6||totals.shipments!==3||totals.shipmentLines!==4||totals.newOrderValue!=='74.57'||totals.nullProducts!==2)throw new Error('Independent synthetic import controls failed');
 console.log('PO_IMPORT_COUNTS_AND_VALUES_VERIFIED');
 const actualMasters=oneJson(run(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c)-'created_at' ORDER BY c.id) FROM public.customers c WHERE c.name='Synthetic imported customer'),'products',(SELECT jsonb_agg(to_jsonb(p)-'created_at' ORDER BY p.id) FROM public.products p WHERE p.sku IN ('CURRENT-CATALOG-A','CURRENT-CATALOG-UNUSED')));`));
 const expectedMasters={customers:built.resolved.customers.map(({key,sourceTier,...row})=>row).sort((a,b)=>a.id.localeCompare(b.id)),products:built.resolved.products.map(({key,...row})=>row).sort((a,b)=>a.id.localeCompare(b.id))};
 if(!isDeepStrictEqual(actualMasters,expectedMasters))throw new Error('Compact master columns changed source values');
 console.log('PO_IMPORT_MASTER_FIELDS_VERIFIED');
 run("UPDATE public.products SET name='Original changed after import' WHERE id='98000000-0000-0000-0000-000000000003';");const originalChanged=snapshot();reject(built.packets[0].sql,'Original baseline changed');unchanged(originalChanged);run("UPDATE public.products SET name='Original synthetic product' WHERE id='98000000-0000-0000-0000-000000000003';");console.log('PO_IMPORT_ORIGINAL_EDIT_PRESERVED');
 const ownId=built.resolved.products[0].id;run(`UPDATE public.products SET name='Imported product changed afterward' WHERE id='${ownId}';`);const ownedChanged=snapshot();reject(built.packets[0].sql,'Source-owned master rows changed');unchanged(ownedChanged);console.log('PO_IMPORT_OWNED_EDIT_PRESERVED');
 run(`UPDATE public.products SET name='Current catalog name' WHERE id='${ownId}';`);
 const requestId=built.resolved.purchaseOrders[0].requestId;
 const originalRequest=oneJson(run(`SELECT jsonb_build_object('payload',payload,'po_id',result->>'id') FROM private.pilot_order_requests WHERE actor_id='98000000-0000-0000-0000-000000000001' AND request_id='${requestId}';`));
 run(`UPDATE private.pilot_order_requests SET payload=payload||'{"synthetic_changed_payload":true}'::jsonb WHERE actor_id='98000000-0000-0000-0000-000000000001' AND request_id='${requestId}';`);
 const requestChanged=snapshot();reject(built.packets[0].sql,'Saved request payload changed');unchanged(requestChanged);console.log('PO_IMPORT_REQUEST_EDIT_PRESERVED');
 const payloadHex=Buffer.from(JSON.stringify(originalRequest.payload),'utf8').toString('hex');
 run(`UPDATE private.pilot_order_requests SET payload=convert_from(decode('${payloadHex}','hex'),'UTF8')::jsonb WHERE actor_id='98000000-0000-0000-0000-000000000001' AND request_id='${requestId}';`);
 for(const field of ['master_model','po_model']) {
  run(`UPDATE private.pilot_order_requests SET payload=jsonb_set(payload,ARRAY['import_provenance','${field}'],to_jsonb('tampered canonical text'::text)) WHERE actor_id='98000000-0000-0000-0000-000000000001' AND request_id='${requestId}';`);
  const tampered=snapshot();reject(built.packets.at(-1).sql,'Stored source model changed');unchanged(tampered);
  run(`UPDATE private.pilot_order_requests SET payload=convert_from(decode('${payloadHex}','hex'),'UTF8')::jsonb WHERE actor_id='98000000-0000-0000-0000-000000000001' AND request_id='${requestId}';`);
  console.log(`PO_IMPORT_STORED_MODEL_TAMPER_REJECTED field=${field}`);
 }
 const edit=oneJson(run(`SELECT jsonb_build_object('po_id',p.id,'customer_id',p.customer_id,'expected_updated_at',p.updated_at,'notes','Synthetic authorized later correction','items',(SELECT jsonb_agg(jsonb_build_object('id',l.id,'product_name',l.product_name,'sku',l.sku,'quantity',l.quantity,'unit_price',l.unit_price) ORDER BY l.id) FROM public.po_line_items l WHERE l.purchase_order_id=p.id)) FROM public.purchase_orders p WHERE p.po_number='SYNTH-IMPORT-open';`));
 const editHex=Buffer.from(JSON.stringify(edit),'utf8').toString('hex');
 run(`BEGIN; SELECT set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true); SET LOCAL ROLE authenticated; SELECT public.pilot_order_transaction('98000000-0000-0000-0000-000000000009','edit_po',convert_from(decode('${editHex}','hex'),'UTF8')::jsonb); COMMIT;`);
 const poChanged=snapshot();reject(built.packets[0].sql,'PO source fields or workflow version changed');unchanged(poChanged);console.log('PO_IMPORT_PO_EDIT_PRESERVED');
 writeFileSync(`${repoRoot}/import-results/verified-controls.json`,JSON.stringify({manifestSha256:built.manifestSha256,planSha256:built.planSha256,counts:built.counts,totals},null,2));
 console.log('PO_IMPORT_LIFECYCLE_VERIFIED');
 const sizeManifest=syntheticImportSizeManifest(),sizeBefore=snapshot();
 const sizeConfig={...config,expectedManifestSha256:hashImportManifest(sizeManifest),schemaMd5:sizeBefore.schema_md5,baselineData:sizeBefore.baselineData,expectedFunctionHashes:sizeBefore.expectedFunctionHashes,batchSize:100};
 const sizeBuilt=buildPoImportPackets({manifest:sizeManifest,config:sizeConfig});
 assertPoImportPacketSet({manifest:sizeManifest,config:sizeConfig,packets:sizeBuilt.packets});
 const sizeEvidence={plannedCounts:sizeBuilt.counts,packetBytes:sizeBuilt.packets.map(p=>Buffer.byteLength(p.sql,'utf8')),timings:[]};
 writeFileSync(`${repoRoot}/import-results/size-timings.json`,JSON.stringify(sizeEvidence,null,2));
 phaseDeadline=Date.now()+10*60*1000;
 const sizePacket=p=>{const started=performance.now(),output=run(p.sql),elapsed=performance.now()-started;
  const lines=output.trim().split('\n').filter(x=>x.startsWith('PO_IMPORT_PACKET_COMMITTED|'));if(lines.length!==1)throw new Error('Size packet receipt missing');
  const receipt=JSON.parse(lines[0].slice('PO_IMPORT_PACKET_COMMITTED|'.length));
  if(receipt.packet_index!==p.index||receipt.manifest_sha256!==sizeBuilt.manifestSha256||receipt.plan_sha256!==sizeBuilt.planSha256||receipt.verified_through<p.index)throw new Error('Size packet receipt mismatch');
  sizeEvidence.timings.push({packet:p.index,elapsedMs:elapsed,bytes:Buffer.byteLength(p.sql,'utf8'),skipped:receipt.skipped});
  writeFileSync(`${repoRoot}/import-results/size-timings.json`,JSON.stringify(sizeEvidence,null,2));
  console.log(`PO_IMPORT_SIZE_PACKET_VERIFIED index=${p.index} skipped=${receipt.skipped} elapsed_ms=${elapsed.toFixed(3)} bytes=${Buffer.byteLength(p.sql,'utf8')}`);return receipt;
 };
 for(const p of sizeBuilt.packets)if(sizePacket(p).skipped)throw new Error('Fresh size packet unexpectedly skipped');
 const sizeComplete=snapshot();
 if(!sizePacket(sizeBuilt.packets.at(-1)).skipped)throw new Error('Late size replay not skipped');unchanged(sizeComplete);
 const sizeTotals=oneJson(run(`SELECT jsonb_build_object('customers',(SELECT count(*) FROM public.customers),'products',(SELECT count(*) FROM public.products),'orders',(SELECT count(*) FROM public.purchase_orders),'lines',(SELECT count(*) FROM public.po_line_items),'shipments',(SELECT count(*) FROM public.surat_jalan),'shipmentLines',(SELECT count(*) FROM public.sj_line_items),'value',(SELECT sum(total_value)::text FROM public.purchase_orders WHERE po_number LIKE 'SYNTH-SIZE-PO-%'),'delivered',(SELECT sum(l.quantity_delivered*p.unit_price)::text FROM public.sj_line_items l JOIN public.po_line_items p ON p.id=l.po_line_item_id JOIN public.purchase_orders o ON o.id=p.purchase_order_id WHERE o.po_number LIKE 'SYNTH-SIZE-PO-%'));`));
 if(sizeTotals.customers!==302||sizeTotals.products!==2103||sizeTotals.orders!==1505||sizeTotals.lines!==3543||sizeTotals.shipments!==1453||sizeTotals.shipmentLines!==3578||sizeTotals.value!=='155646.25'||sizeTotals.delivered!=='115671.25')throw new Error('Independent synthetic size controls failed');
 sizeEvidence.verifiedTotals=sizeTotals;writeFileSync(`${repoRoot}/import-results/size-timings.json`,JSON.stringify(sizeEvidence,null,2));
 console.log('PO_IMPORT_SIZE_AND_LATE_REPLAY_VERIFIED');
 // Forward-only boundary: all genuinely unchanged v1/size packets ran before this.
 // The audit pin comes only from independently retained successful v1 receipts.
 const transitionSnapshot=()=>({...snapshot(),...oneJson(run(`SELECT jsonb_build_object(
 'customers',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c)-'customer_category' ORDER BY c.id),'[]')::text) FROM public.customers c),
 'access',jsonb_build_object('relation',(SELECT jsonb_build_object('owner',relowner,'acl',relacl::text,'rls',relrowsecurity,'force',relforcerowsecurity) FROM pg_class WHERE oid='public.customers'::regclass),
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',attname,'acl',attacl::text) ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.customers'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'customer_category'),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='customers')));`))});
 phaseDeadline=Date.now()+10*60*1000;
 const legacyInventory=customerCategoryLegacyInventory({resolved:built.resolved,receipts:v1Receipts,manifestSha256:built.manifestSha256,planSha256:built.planSha256});
 writeFileSync(`${repoRoot}/import-results/legacy-audit-inventory.json`,JSON.stringify(legacyInventory,null,2));
 const {customerIds,productIds,expectedMasterRowsMd5}=legacyInventory;
 const legacyInput={customerIds,productIds,expectedMasterRowsMd5};
 const categoryBaselineSql=buildCustomerCategoryBaselineSql();assertCustomerCategoryReadOnlySql(categoryBaselineSql);
 writeFileSync(`${repoRoot}/import-results/customer-category-baseline.sql`,categoryBaselineSql);
 const reviewBaseline=present=>{const baseline=parseCustomerCategoryReviewJson(run(categoryBaselineSql));assertCustomerCategoryBaselineEvidence(baseline,present);return baseline;};
 const legacyEvidence={inventory:legacyInventory,scenarios:{}};
 const nullCategories=customerIds.map(id=>({id,customer_category:null}));
 const legacyExpected={...legacyInput,sourceStatus:'MATCH',actualMasterRowsMd5:expectedMasterRowsMd5,sourceSchemaMatches:true,categoryColumnPresent:true,categoryRows:nullCategories,missingCustomerIds:[],missingProductIds:[]};
 const auditLegacy=(scenario,expected=legacyExpected,input=legacyInput)=>{
  const before=reviewBaseline(expected.categoryColumnPresent),sql=buildCustomerCategoryLegacyAuditSql(input);
  assertCustomerCategoryReadOnlySql(sql);
  const audit=parseCustomerCategoryReviewJson(run(sql));assertCustomerCategoryAuditEvidence(audit,expected);
  const after=reviewBaseline(expected.categoryColumnPresent);assertCustomerCategoryReadUnchanged(before,after);
  const evidence={audit,beforeBaseline:before,afterBaseline:after,readOnlySqlVerified:true,noWritesVerified:true};
  legacyEvidence.scenarios[scenario]=evidence;
  writeFileSync(`${repoRoot}/import-results/legacy-audit-${scenario}.sql`,sql);
  writeFileSync(`${repoRoot}/import-results/legacy-audit-${scenario}.json`,JSON.stringify(evidence,null,2));
  console.log(`PO_IMPORT_LEGACY_AUDIT_${scenario.toUpperCase()}_VERIFIED source_status=${audit.source_status} category_status=${audit.category_status} expected_master_rows_md5=${expectedMasterRowsMd5} actual_master_rows_md5=${audit.actual_master_rows_md5} no_writes=true`);
  return evidence;
 };
 const beforeLegacy=auditLegacy('pre_category',{...legacyExpected,categoryColumnPresent:false});
 const originalAnchor=beforeLegacy.afterBaseline.request_states.find(request=>request.actor_id===config.actorId&&request.request_id===built.resolved.purchaseOrders[0].requestId);
 if(!originalAnchor||originalAnchor.state!=='COMPLETED'||originalAnchor.operation!=='create_po'||originalAnchor.abandoned||originalAnchor.master_rows_md5!==expectedMasterRowsMd5||originalAnchor.manifest_sha256!==built.manifestSha256||originalAnchor.plan_sha256!==built.planSha256)throw new Error('Legacy receipt pin differs from original successful request anchor');
 const beforeCategory=transitionSnapshot();
 const categoryMigration=readFileSync(`${repoRoot}/supabase/migrations/${CATEGORY_MIGRATION}`,'utf8');
 run(categoryMigration);
 const afterCategory=transitionSnapshot();assertCategoryTransitionPreserved(beforeCategory,afterCategory);
 if(run('SELECT count(*) FROM public.customers WHERE customer_category IS NOT NULL;').trim()!=='0')throw new Error('Legacy categories were inferred');
 const afterLegacy=auditLegacy('post_category');
 const beforeReview=beforeLegacy.afterBaseline,afterReview=afterLegacy.afterBaseline;
 const originalMetadata=structuredClone(afterReview.schema);
 const newColumns=originalMetadata.columns.filter(column=>column.table==='public.customers'&&column.name==='customer_category');
 const newChecks=originalMetadata.constraints.filter(constraint=>constraint.table==='public.customers'&&constraint.name==='customers_customer_category_check');
 if(newColumns.length!==1||newChecks.length!==1||newChecks[0].kind!=='c'||newChecks[0].validated!==true||beforeReview.schema_md5===afterReview.schema_md5)throw new Error('Exact additive category schema evidence required');
 originalMetadata.columns=originalMetadata.columns.filter(column=>!newColumns.includes(column));
 originalMetadata.constraints=originalMetadata.constraints.filter(constraint=>!newChecks.includes(constraint));
 originalMetadata.category_column=null;
 if(!isDeepStrictEqual(beforeReview.schema,originalMetadata))throw new Error('Category migration changed unrelated actual schema/privilege metadata');
 assertCustomerCategoryReadUnchanged({...beforeReview,schema:afterReview.schema,schema_md5:afterReview.schema_md5,category_column_present:true},afterReview);
 legacyEvidence.migration={beforeBaseline:beforeReview,afterBaseline:afterReview,protectedDataAndAccessVerified:true};
 const syntheticChange=sql=>run("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n"+sql+'\nCOMMIT;');
 const legacyCustomer=built.resolved.customers[0],legacyProduct=built.resolved.products[0];
 syntheticChange(`UPDATE public.customers SET customer_category='perorangan' WHERE id='${legacyCustomer.id}';`);
 const selectedCategories=nullCategories.map(row=>row.id===legacyCustomer.id?{...row,customer_category:'perorangan'}:row);
 const selected=auditLegacy('category_only',{...legacyExpected,categoryRows:selectedCategories});
 const selectedBaselineRows=afterReview.category_rows.map(row=>row.id===legacyCustomer.id?{...row,customer_category:'perorangan'}:row);
 assertCustomerCategoryReadUnchanged({...afterReview,category_rows:selectedBaselineRows},selected.afterBaseline);
 syntheticChange(`UPDATE public.customers SET customer_category=NULL WHERE id='${legacyCustomer.id}';`);
 for(const category of IMPORT_CUSTOMER_CATEGORIES.filter(value=>value!=='perorangan')) {
  syntheticChange(`UPDATE public.customers SET customer_category='${category}' WHERE id='${legacyCustomer.id}';`);
  const categoryRows=nullCategories.map(row=>row.id===legacyCustomer.id?{...row,customer_category:category}:row);
  const changedCategory=auditLegacy(`category_only_${category}`,{...legacyExpected,categoryRows});
  const baselineRows=afterReview.category_rows.map(row=>row.id===legacyCustomer.id?{...row,customer_category:category}:row);
  assertCustomerCategoryReadUnchanged({...afterReview,category_rows:baselineRows},changedCategory.afterBaseline);
  syntheticChange(`UPDATE public.customers SET customer_category=NULL WHERE id='${legacyCustomer.id}';`);
 }
 const categoryRestored=auditLegacy('category_restored');assertCustomerCategoryReadUnchanged(afterReview,categoryRestored.afterBaseline);
 for(const [relation,row] of [['customers',legacyCustomer],['products',legacyProduct]]) {
  syntheticChange(`UPDATE public.${relation} SET name='Changed synthetic legacy audit source' WHERE id='${row.id}';`);
  const changedSource=auditLegacy(`${relation}_source_changed`,{...legacyExpected,sourceStatus:'SOURCE_FIELDS_CHANGED',actualMasterRowsMd5:'different'});
  for(const [protectedRelation,state] of Object.entries(afterReview.protected_data))if(protectedRelation!==`public.${relation}`&&!isDeepStrictEqual(state,changedSource.afterBaseline.protected_data[protectedRelation]))throw new Error('Synthetic source edit changed unrelated protected data/history');
  syntheticChange(`UPDATE public.${relation} SET name=convert_from(decode('${Buffer.from(row.name,'utf8').toString('hex')}','hex'),'UTF8') WHERE id='${row.id}';`);
  const restored=auditLegacy(`${relation}_source_restored`);assertCustomerCategoryReadUnchanged(afterReview,restored.afterBaseline);
 }
 const originalProductCreatedAt=run(`BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; SELECT created_at::text FROM public.products WHERE id='${legacyProduct.id}'; ROLLBACK;`).trim();
 if(Number.isNaN(Date.parse(originalProductCreatedAt)))throw new Error('Original synthetic provider timestamp required');
 syntheticChange(`UPDATE public.products SET created_at=created_at+interval '1 second' WHERE id='${legacyProduct.id}';`);
 auditLegacy('product_timestamp_changed',{...legacyExpected,sourceStatus:'SOURCE_FIELDS_CHANGED',actualMasterRowsMd5:'different'});
 syntheticChange(`UPDATE public.products SET created_at=convert_from(decode('${Buffer.from(originalProductCreatedAt,'utf8').toString('hex')}','hex'),'UTF8')::timestamptz WHERE id='${legacyProduct.id}';`);
 const timestampRestored=auditLegacy('product_timestamp_restored');assertCustomerCategoryReadUnchanged(afterReview,timestampRestored.afterBaseline);
 const missingCustomer='98000000-0000-0000-0000-000000000099',missingProduct='98000000-0000-0000-0000-000000000098';
 const missingInput={...legacyInput,customerIds:[...customerIds,missingCustomer].sort(),productIds:[...productIds,missingProduct].sort()};
 auditLegacy('missing_ids',{...legacyExpected,...missingInput,sourceStatus:'ID_MISSING',missingCustomerIds:[missingCustomer],missingProductIds:[missingProduct]},missingInput);
 syntheticChange('ALTER TABLE public.products ADD COLUMN synthetic_category_audit_drift text;');
 auditLegacy('schema_drift',{...legacyExpected,sourceStatus:'SOURCE_FIELDS_CHANGED',sourceSchemaMatches:false});
 syntheticChange('ALTER TABLE public.products DROP COLUMN synthetic_category_audit_drift;');
 const schemaRestored=auditLegacy('schema_restored');assertCustomerCategoryReadUnchanged(afterReview,schemaRestored.afterBaseline);
 syntheticChange('ALTER TABLE public.products ALTER COLUMN size TYPE varchar;');
 auditLegacy('source_type_drift',{...legacyExpected,sourceStatus:'SOURCE_FIELDS_CHANGED',sourceSchemaMatches:false});
 syntheticChange('ALTER TABLE public.products ALTER COLUMN size TYPE text;');
 const typeRestored=auditLegacy('source_type_restored');assertCustomerCategoryReadUnchanged(afterReview,typeRestored.afterBaseline);
 const restrictedBefore=reviewBaseline(true),restrictedSql=buildCustomerCategoryLegacyAuditSql(legacyInput);
 const restrictedRole=restrictedBefore.schema.roles.find(role=>role.name==='authenticated');
 if(!restrictedRole||restrictedRole.superuser||restrictedRole.bypass_rls)throw new Error('Existing restricted authenticated role required');
 let restrictedRefusal;
 try{run('SET ROLE authenticated;\n'+restrictedSql);}catch(error){
  const messages=['customers','products'].map(table=>`query would be affected by row-level security policy for table "${table}"`);
  const message=messages.find(message=>isExpectedImportRefusal(error.stderr,message,'42501'));
  if(!message||/"source_status"\s*:\s*"MATCH"/.test(String(error.stdout)))throw error;
  restrictedRefusal={role:'authenticated',sqlstate:'42501',message};
 }
 if(!restrictedRefusal)throw new Error('Restricted legacy audit returned a filtered result instead of failing closed');
 const restrictedAfter=reviewBaseline(true);assertCustomerCategoryReadUnchanged(restrictedBefore,restrictedAfter);
 legacyEvidence.restrictedRead={...restrictedRefusal,beforeBaseline:restrictedBefore,afterBaseline:restrictedAfter,noWritesVerified:true};
 legacyEvidence.runtimeStatus='VERIFIED_THROUGH_CATEGORY_BOUNDARY';
 console.log('PO_IMPORT_LEGACY_AUDIT_FILTERED_ROLE_REJECTED sqlstate=42501 no_writes=true');
 console.log('PO_IMPORT_CATEGORY_ADDITIVE_HISTORY_ACCESS_VERIFIED');
 for(const p of [...built.packets,...sizeBuilt.packets]){reject(p.sql,'Schema fingerprint changed');unchanged(afterCategory);}
 console.log('PO_IMPORT_V1_POST_CATEGORY_SCHEMA_REJECTED');
 writeFileSync(`${repoRoot}/import-results/category-transition.json`,JSON.stringify({before:beforeCategory,after:afterCategory,oldPacketSha256:[...built.packets,...sizeBuilt.packets].map(p=>p.sha256),legacyAudit:legacyEvidence},null,2));
 phaseDeadline=Date.now()+10*60*1000;
 const futureManifest=syntheticCategoryImportManifest(),futureBefore=snapshot('po-import-v2');
 if(futureBefore.model!=='po-import-v2')throw new Error('Future baseline model mismatch');
 const futureConfig={...config,expectedManifestSha256:hashImportManifest(futureManifest),schemaMd5:futureBefore.schema_md5,baselineData:futureBefore.baselineData,expectedFunctionHashes:futureBefore.expectedFunctionHashes};
 const futureInput={manifest:futureManifest,config:futureConfig,modelVersion:'po-import-v2'};
 const future=buildPoImportPackets(futureInput);assertPoImportPacketSet({...futureInput,packets:future.packets});
 if(!isDeepStrictEqual(future,buildPoImportPackets(structuredClone(futureInput))))throw new Error('Future import is nondeterministic');
 for(const p of future.packets)writeFileSync(`${repoRoot}/import-results/v2-packet-${p.index}.sql`,p.sql);
 for(const invalid of ['missing','invalid']) {
  const m=structuredClone(futureManifest);
  if(invalid==='missing')delete m.customers[0].customer_category;else m.customers[0].customer_category='Other';
  let refused=false;
  try{buildPoImportPackets({...futureInput,manifest:m,config:{...futureConfig,expectedManifestSha256:hashImportManifest(m)}})}catch(error){if(error.message===(invalid==='missing'?'Explicit customer category mapping required':'Invalid explicit customer category mapping'))refused=true;else throw error;}
  if(!refused)throw new Error('Invalid future category generated SQL');
 }
 console.log('PO_IMPORT_V2_COMPILER_CATEGORY_REFUSALS_VERIFIED');
 const futurePacket=p=>{
  const lines=run(p.sql).trim().split('\n').filter(x=>x.startsWith('PO_IMPORT_PACKET_COMMITTED|'));
  if(lines.length!==1)throw new Error('Future receipt marker missing');
  const receipt=JSON.parse(lines[0].slice('PO_IMPORT_PACKET_COMMITTED|'.length));
  if(receipt.model!=='po-import-v2'||receipt.packet_index!==p.index||receipt.manifest_sha256!==future.manifestSha256||receipt.plan_sha256!==future.planSha256||receipt.verified_through<p.index)throw new Error('Future receipt mismatch');
  return receipt;
 };
 reject(buildPoImportPackets({...futureInput,config:{...futureConfig,schemaMd5:'0'.repeat(32)}}).packets[0].sql,'Schema fingerprint changed');unchanged(futureBefore);console.log('PO_IMPORT_V2_SCHEMA_DRIFT_REJECTED');
 reject(buildPoImportPackets({...futureInput,config:{...futureConfig,actorEmail:'wrong@example.invalid'}}).packets[0].sql,'Reviewed active actor changed');unchanged(futureBefore);console.log('PO_IMPORT_V2_ACTOR_DRIFT_REJECTED');
 reject(future.packets[1].sql,'Prior packet must commit and verify before this packet');unchanged(futureBefore);console.log('PO_IMPORT_V2_OUT_OF_ORDER_REJECTED');
 const categoryValue=",x->>'customer_category'\nFROM pg_temp.import_master_input";
 if(future.packets[0].sql.split(categoryValue).length!==2)throw new Error('Future category insert injection boundary changed');
 reject(future.packets[0].sql.replace(categoryValue,",'invalid-synthetic-category'\nFROM pg_temp.import_master_input"),'new row for relation "customers" violates check constraint "customers_customer_category_check"','23514');unchanged(futureBefore);console.log('PO_IMPORT_V2_INVALID_CATEGORY_ATOMIC_FAILURE_VERIFIED');
 reject("SET pilot.import_fault='on';\n"+future.packets[0].sql,'Synthetic import fault');unchanged(futureBefore);console.log('PO_IMPORT_V2_ATOMIC_FAILURE_VERIFIED');
 run(future.packets[0].sql);const futureFirst=snapshot();
 if(!futurePacket(future.packets[0]).skipped)throw new Error('Future lost-response retry inserted again');unchanged(futureFirst);console.log('PO_IMPORT_V2_LOST_RESPONSE_REPLAY_VERIFIED');
 const futureSession=run(future.packets[0].sql+'\n'+future.packets[0].sql).trim().split('\n').filter(x=>x.startsWith('PO_IMPORT_PACKET_COMMITTED|')).map(x=>JSON.parse(x.slice('PO_IMPORT_PACKET_COMMITTED|'.length)));
 if(futureSession.length!==2||futureSession.some(r=>!r.skipped||r.packet_index!==0||r.model!=='po-import-v2'||r.manifest_sha256!==future.manifestSha256||r.plan_sha256!==future.planSha256))throw new Error('Future same-session receipt mismatch');unchanged(futureFirst);console.log('PO_IMPORT_V2_SAME_SESSION_REPLAY_VERIFIED');
 reject("SET pilot.import_fault='later';\n"+future.packets[1].sql,'Synthetic later-batch import fault');unchanged(futureFirst);console.log('PO_IMPORT_V2_LATER_BATCH_ATOMIC_FAILURE_VERIFIED');
 reject(future.packets[2].sql,'Prior packet must commit and verify before this packet');unchanged(futureFirst);
 for(const p of future.packets.slice(1))if(futurePacket(p).skipped)throw new Error('New future packet was skipped');
 const futureComplete=snapshot();for(const p of future.packets)if(!futurePacket(p).skipped)throw new Error('Future complete retry inserted again');unchanged(futureComplete);console.log('PO_IMPORT_V2_COMPLETE_REPLAY_VERIFIED');
 if(!futurePacket(future.packets.at(-1)).skipped)throw new Error('Future late retry inserted again');unchanged(futureComplete);console.log('PO_IMPORT_V2_LATE_REPLAY_VERIFIED');
 const futureMasters=oneJson(run(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c)-'created_at' ORDER BY c.id) FROM public.customers c WHERE c.name LIKE 'Future synthetic customer %'),'products',(SELECT jsonb_agg(to_jsonb(p)-'created_at' ORDER BY p.id) FROM public.products p WHERE p.sku LIKE 'FUTURE-%'));`));
 const expectedFutureMasters={customers:future.resolved.customers.map(({key,sourceTier,...row})=>row).sort((a,b)=>a.id.localeCompare(b.id)),products:future.resolved.products.map(({key,...row})=>row).sort((a,b)=>a.id.localeCompare(b.id))};
 if(!isDeepStrictEqual(futureMasters,expectedFutureMasters))throw new Error('Future explicit categories/pricing/master values changed');
 const futureTotals=oneJson(run(`SELECT jsonb_build_object('orders',count(*),'value',sum(total_value)::text,'lines',(SELECT count(*) FROM public.po_line_items l JOIN public.purchase_orders p ON p.id=l.purchase_order_id WHERE p.po_number LIKE 'SYNTH-FUTURE-%'),'ordered',(SELECT sum(l.quantity)::text FROM public.po_line_items l JOIN public.purchase_orders p ON p.id=l.purchase_order_id WHERE p.po_number LIKE 'SYNTH-FUTURE-%'),'shipments',(SELECT count(*) FROM public.surat_jalan s JOIN public.purchase_orders p ON p.id=s.purchase_order_id WHERE p.po_number LIKE 'SYNTH-FUTURE-%'),'shipmentLines',(SELECT count(*) FROM public.sj_line_items s JOIN public.po_line_items l ON l.id=s.po_line_item_id JOIN public.purchase_orders p ON p.id=l.purchase_order_id WHERE p.po_number LIKE 'SYNTH-FUTURE-%'),'delivered',(SELECT sum(s.quantity_delivered)::text FROM public.sj_line_items s JOIN public.po_line_items l ON l.id=s.po_line_item_id JOIN public.purchase_orders p ON p.id=l.purchase_order_id WHERE p.po_number LIKE 'SYNTH-FUTURE-%'),'deliveredValue',(SELECT sum(s.quantity_delivered*l.unit_price)::text FROM public.sj_line_items s JOIN public.po_line_items l ON l.id=s.po_line_item_id JOIN public.purchase_orders p ON p.id=l.purchase_order_id WHERE p.po_number LIKE 'SYNTH-FUTURE-%')) FROM public.purchase_orders WHERE po_number LIKE 'SYNTH-FUTURE-%';`));
 if(!isDeepStrictEqual(futureTotals,{orders:6,value:'87.89',lines:7,ordered:'19',shipments:3,shipmentLines:4,delivered:'8',deliveredValue:'53.75'}))throw new Error('Independent future quantity/value controls failed');
 console.log('PO_IMPORT_V2_CATEGORIES_PRICING_HISTORY_VERIFIED');
 const futureCustomer=future.resolved.customers[0];
 run(`UPDATE public.customers SET customer_category='perorangan' WHERE id='${futureCustomer.id}';`);
 const categoryChanged=snapshot();reject(future.packets[0].sql,'Source-owned master rows changed');unchanged(categoryChanged);
 for(const [relation,state] of Object.entries(futureComplete.baselineData))if(relation!=='public.customers'&&!isDeepStrictEqual(state,categoryChanged.baselineData[relation]))throw new Error('Category edit changed pricing/history');
 run(`UPDATE public.customers SET customer_category='supermarket_besar' WHERE id='${futureCustomer.id}';`);console.log('PO_IMPORT_V2_CATEGORY_DRIFT_REJECTED');
 run(`UPDATE public.customers SET name='Changed future synthetic source' WHERE id='${futureCustomer.id}';`);
 const futureSourceChanged=snapshot();reject(future.packets[0].sql,'Source-owned master rows changed');unchanged(futureSourceChanged);
 run(`UPDATE public.customers SET name='Future synthetic customer 0' WHERE id='${futureCustomer.id}';`);console.log('PO_IMPORT_V2_SOURCE_DRIFT_REJECTED');
 run("UPDATE public.products SET name='Changed synthetic baseline' WHERE id='98000000-0000-0000-0000-000000000003';");
 const futureBaselineChanged=snapshot();reject(future.packets[0].sql,'Original baseline changed');unchanged(futureBaselineChanged);
 run("UPDATE public.products SET name='Original synthetic product' WHERE id='98000000-0000-0000-0000-000000000003';");console.log('PO_IMPORT_V2_BASELINE_DRIFT_REJECTED');
 const futureRequestId=future.resolved.purchaseOrders[0].requestId;
 const futurePayload=oneJson(run(`SELECT payload FROM private.pilot_order_requests WHERE actor_id='${futureConfig.actorId}' AND request_id='${futureRequestId}';`));
 const futurePayloadHex=Buffer.from(JSON.stringify(futurePayload),'utf8').toString('hex');
 for(const field of ['master_model','po_model']) {
  run(`UPDATE private.pilot_order_requests SET payload=jsonb_set(payload,ARRAY['import_provenance','${field}'],to_jsonb('tampered future canonical text'::text)) WHERE actor_id='${futureConfig.actorId}' AND request_id='${futureRequestId}';`);
  const changed=snapshot();reject(future.packets.at(-1).sql,'Stored source model changed');unchanged(changed);
  run(`UPDATE private.pilot_order_requests SET payload=convert_from(decode('${futurePayloadHex}','hex'),'UTF8')::jsonb WHERE actor_id='${futureConfig.actorId}' AND request_id='${futureRequestId}';`);
 }
 console.log('PO_IMPORT_V2_STORED_MODEL_TAMPER_REJECTED');
 const futureEdit=oneJson(run(`SELECT jsonb_build_object('po_id',p.id,'customer_id',p.customer_id,'expected_updated_at',p.updated_at,'notes','Synthetic authorized future correction','items',(SELECT jsonb_agg(jsonb_build_object('id',l.id,'product_name',l.product_name,'sku',l.sku,'quantity',l.quantity,'unit_price',l.unit_price) ORDER BY l.id) FROM public.po_line_items l WHERE l.purchase_order_id=p.id)) FROM public.purchase_orders p WHERE p.po_number='SYNTH-FUTURE-1';`));
 const futureEditHex=Buffer.from(JSON.stringify(futureEdit),'utf8').toString('hex');
 run(`BEGIN; SELECT set_config('request.jwt.claim.sub','${futureConfig.actorId}',true); SET LOCAL ROLE authenticated; SELECT public.pilot_order_transaction('98000000-0000-0000-0000-000000000010','edit_po',convert_from(decode('${futureEditHex}','hex'),'UTF8')::jsonb); COMMIT;`);
 const futureEdited=snapshot();reject(future.packets[0].sql,'PO source fields or workflow version changed');unchanged(futureEdited);console.log('PO_IMPORT_V2_PO_EDIT_PRESERVED');
 auditLegacy('after_v2');legacyEvidence.runtimeStatus='VERIFIED_THROUGH_V2_LIFECYCLE';
 writeFileSync(`${repoRoot}/import-results/v2-verified-controls.json`,JSON.stringify({model:'po-import-v2',manifestSha256:future.manifestSha256,planSha256:future.planSha256,packetSha256:future.packets.map(p=>p.sha256),counts:future.counts,totals:futureTotals,categories:futureMasters.customers.map(c=>({id:c.id,customer_category:c.customer_category,pricing_tier:c.pricing_tier})),legacyAudit:legacyEvidence},null,2));
 console.log('PO_IMPORT_V2_LIFECYCLE_VERIFIED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.length!==2)throw new Error('No custom import CI runner arguments');await runPoImportCi();}
