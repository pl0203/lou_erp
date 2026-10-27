/** Additive workspace read contracts. Never reinterpret a permissive v1 envelope. */
import { supabase } from '../supabase';
import type { COCustomerBatchesV2, COCustomerBatchesV2Args, COStockRowV2, COImpactKind, COImpactRows, COPreviewImpactPage, Money, Quantity, Version } from './contracts';
import type { ImportBinding, ImportReopenAcknowledgment, ImportManifest, PriorReturnProof } from './import/types';
import { canonicalManifestValue, decodeImportBinding, decodeImportManifest } from './import/manifest';
import { decodeCORead, minorUnits, impactKinds, invalid, parseHash, parseDate, parseEnteredQuantity, parseBoolean, parseMoney, parseMonth, parseQuantity, parseSafeCount, parseText, parseTimestamp, parseUUID, parseVersion } from './validation';
import { coError, type COReadOptions } from './rpc';
export type ReportsPageArgs = {p_customer_id:string|null;p_month:string|null;p_status:string;p_page:number;p_page_size:number};
export type COReportListRow = {id:string;customer_id:string;customer_name:string;report_month:string;status:'posted'|'historical_pending';revision_id:string|null;report_head_id:string|null;legacy_pending:boolean;source_filename:string|null;updated_at:string};
export type COReportsPageV2 = {version:'2';as_of:string;customer_id:string|null;report_month:string|null;status:string;page:number;page_size:number;total:Quantity;rows:COReportListRow[]};
export type COUnitPin = {id:string;version:Version;unit:string};
export type COReportImport = {return_proofs?:PriorReturnProof[];version:'1';as_of:string;customer_id:string;report_month:string;revision_id:string;report_head_id:string;effective_revision_id:string;manifest:ImportManifest|null;unit_declarations:Record<string,COUnitPin>;source_amount:Money|null;currency:string|null;source_filename:string|null;created_at:string;created_by:string;author_name:string|null;reason:string|null;report_version:Version;previous_revision_id:string|null};
export type COReportHistoryRow = {revision_id:string;report_version:Version;created_at:string;created_by:string;author_name:string|null;reason:string|null;is_effective:boolean};
export type COReportHistory = {version:'1';as_of:string;customer_id:string;report_month:string;page:number;page_size:number;total:Quantity;rows:COReportHistoryRow[]};
function obj(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid('workspace object');return value as Record<string,unknown>}
function exact(value:unknown,keys:readonly string[]){const r=obj(value);if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))invalid('workspace fields');return r}
const nullText=(v:unknown)=>v===null?null:parseText(v);
const nullUuid=(v:unknown)=>v===null?null:parseUUID(v);
function pageInput(a:ReportsPageArgs){if(a.p_customer_id!==null)parseUUID(a.p_customer_id);if(a.p_month!==null)parseMonth(a.p_month);if(!['all','posted','historical_pending'].includes(a.p_status))invalid('report status');parseSafeCount(a.p_page);parseSafeCount(a.p_page_size);if(a.p_page<1||a.p_page_size<1||a.p_page_size>100)invalid('workspace page')}
function pageRows(v:Record<string,unknown>,a:{p_page:number;p_page_size:number}){const total=parseQuantity(v.total);if(v.page!==a.p_page||v.page_size!==a.p_page_size||!Array.isArray(v.rows))invalid('workspace page binding');const remaining=BigInt(total)-BigInt(a.p_page-1)*BigInt(a.p_page_size);const count=remaining<0n?0n:remaining>BigInt(a.p_page_size)?BigInt(a.p_page_size):remaining;if(BigInt(v.rows.length)!==count)invalid('workspace page completeness');return v.rows as unknown[]}
export function decodeCOReportsPageV2(data:unknown,a:ReportsPageArgs):COReportsPageV2{
 pageInput(a);const v=exact(data,['version','as_of','customer_id','report_month','status','page','page_size','total','rows']);
 if(v.version!=='2'||v.customer_id!==a.p_customer_id||v.report_month!==a.p_month||v.status!==a.p_status)invalid('workspace list binding');parseTimestamp(v.as_of);
 const seen=new Set<string>();const ids=new Set<string>();
 const rows=pageRows(v,a).map(value=>{const r=exact(value,['id','customer_id','customer_name','report_month','status','revision_id','report_head_id','legacy_pending','source_filename','updated_at']);const row:COReportListRow={id:parseUUID(r.id),customer_id:parseUUID(r.customer_id),customer_name:parseText(r.customer_name),report_month:parseMonth(r.report_month),status:r.status==='posted'?'posted':r.status==='historical_pending'?'historical_pending':invalid('workspace report state'),revision_id:nullUuid(r.revision_id),report_head_id:nullUuid(r.report_head_id),legacy_pending:parseBoolean(r.legacy_pending),source_filename:nullText(r.source_filename),updated_at:parseTimestamp(r.updated_at)};
 const key=`${row.customer_id}:${row.report_month}`;if(seen.has(key)||ids.has(row.id)||a.p_customer_id!==null&&row.customer_id!==a.p_customer_id||a.p_month!==null&&row.report_month!==a.p_month||a.p_status!=='all'&&row.status!==a.p_status)invalid('workspace duplicate/scope');seen.add(key);ids.add(row.id);
 if(row.status==='posted'?!row.revision_id||row.report_head_id!==row.id:row.revision_id!==null||row.report_head_id!==null||!row.legacy_pending||row.source_filename!==null)invalid('workspace report identity');return row});
 return {version:'2',as_of:parseTimestamp(v.as_of),customer_id:a.p_customer_id,report_month:a.p_month,status:a.p_status,page:a.p_page,page_size:a.p_page_size,total:parseQuantity(v.total),rows};
}
export function decodeCOReportImport(data:unknown,customerId:string,month:string,revisionId:string):COReportImport{
 const hasProofs=Object.hasOwn(obj(data),'return_proofs');
 const v=exact(data,[...(hasProofs?['return_proofs']:[]),'version','as_of','customer_id','report_month','revision_id','report_head_id','effective_revision_id','manifest','unit_declarations','source_amount','currency','source_filename','created_at','created_by','author_name','reason','report_version','previous_revision_id']);
 if(v.version!=='1'||v.customer_id!==customerId||v.report_month!==month||v.revision_id!==revisionId)invalid('immutable report source binding');
 const manifest=v.manifest===null?null:decodeImportManifest(v.manifest);const pins:Record<string,COUnitPin>={};
 for(const [key,value] of Object.entries(obj(v.unit_declarations))){parseUUID(key);const p=exact(value,['id','version','unit']);const unit=parseText(p.unit);if(!unit.trim())invalid('unit pin');pins[key]={id:parseUUID(p.id),version:parseVersion(p.version),unit}}
 const sourceAmount=v.source_amount===null?null:parseMoney(v.source_amount),currency=nullText(v.currency),filename=nullText(v.source_filename);
 if(manifest){if(manifest.input.scope.customerId!==customerId||manifest.input.scope.reportMonth!==month||filename===null||manifest.input.currency!==currency)invalid('source manifest scope');for(const m of manifest.input.mappings){if(m.included&&m.stockKeyId&&(!pins[m.stockKeyId]||pins[m.stockKeyId].unit!==m.ledgerUnit))invalid('source unit pin')}}
 else if(Object.keys(pins).length||sourceAmount!==null||currency!==null)invalid('legacy source unavailable');
 let proofs:PriorReturnProof[]|undefined;
 if(hasProofs){
  if(!manifest||!Array.isArray(v.return_proofs)||!v.return_proofs.length||v.return_proofs.length>manifest.input.returns.length)invalid('return proof envelope');
  const seen=new Set<string>();proofs=(v.return_proofs as unknown[]).map(value=>{
   const p=exact(value,['basis','rowId','priorImportId','priorReportRevisionId','priorManifestDigest','priorValidationDigest']);const rowId=parseText(p.rowId);
   const decision=manifest!.input.returns.find(d=>d.rowId===rowId),mapping=manifest!.input.mappings.find(m=>m.rowId===rowId),row=manifest!.input.extracted.sourceRows.find(r=>r.id===rowId);
   if(p.basis!=='prior_committed_exact_coverage'||seen.has(rowId)||decision?.state!=='unresolved'||decision.stockImpact!=='uncertain'||decision.links.length||!mapping?.included||!mapping.confirmed||!row||!manifest!.input.includedSectionIds.includes(row.ref.section)||row.returned?.decimal==null||BigInt(parseQuantity(row.returned.decimal))<=0n)invalid('return proof row');seen.add(rowId);
   return {basis:'prior_committed_exact_coverage',rowId,priorImportId:parseUUID(p.priorImportId),priorReportRevisionId:parseUUID(p.priorReportRevisionId),priorManifestDigest:parseHash(p.priorManifestDigest),priorValidationDigest:parseHash(p.priorValidationDigest)};
  });
 }
 return {...(proofs?{return_proofs:proofs}:{}),version:'1',as_of:parseTimestamp(v.as_of),customer_id:parseUUID(v.customer_id),report_month:parseMonth(v.report_month),revision_id:parseUUID(v.revision_id),report_head_id:parseUUID(v.report_head_id),effective_revision_id:parseUUID(v.effective_revision_id),manifest,unit_declarations:pins,source_amount:sourceAmount,currency,source_filename:filename,created_at:parseTimestamp(v.created_at),created_by:parseUUID(v.created_by),author_name:nullText(v.author_name),reason:nullText(v.reason),report_version:parseVersion(v.report_version),previous_revision_id:nullUuid(v.previous_revision_id)};
}
export function decodeCOReportHistory(data:unknown,a:{p_customer_id:string;p_month:string;p_page:number;p_page_size:number}):COReportHistory{
 const v=exact(data,['version','as_of','customer_id','report_month','page','page_size','total','rows']);if(v.version!=='1'||v.customer_id!==a.p_customer_id||v.report_month!==a.p_month)invalid('history scope');const seen=new Set<string>();
 const rows=pageRows(v,a).map(value=>{const r=exact(value,['revision_id','report_version','created_at','created_by','author_name','reason','is_effective']);const revision=parseUUID(r.revision_id);if(seen.has(revision))invalid('history duplicate');seen.add(revision);return {revision_id:revision,report_version:parseVersion(r.report_version),created_at:parseTimestamp(r.created_at),created_by:parseUUID(r.created_by),author_name:nullText(r.author_name),reason:nullText(r.reason),is_effective:parseBoolean(r.is_effective)}});
 return {version:'1',as_of:parseTimestamp(v.as_of),customer_id:a.p_customer_id,report_month:a.p_month,page:a.p_page,page_size:a.p_page_size,total:parseQuantity(v.total),rows};
}
async function read<T>(name:string,args:Record<string,unknown>,decode:(data:unknown)=>T,o:COReadOptions={}):Promise<T>{o.signal?.throwIfAborted();if(o.isCurrent&&!o.isCurrent())invalid('workspace owner');let request=supabase.rpc(name,args);if(o.signal)request=request.abortSignal(o.signal);const result=await request;o.signal?.throwIfAborted();if(o.isCurrent&&!o.isCurrent())invalid('workspace owner');if(result.error)throw coError(result.error);return decode(result.data)}
export function fetchCOReportsPageV2(a:ReportsPageArgs,o?:COReadOptions):Promise<COReportsPageV2>{pageInput(a);return read('pilot_co_reports_page_v2',a,d=>decodeCOReportsPageV2(d,a),o)}
export function fetchCOReportImport(customerId:string,month:string,revisionId:string,o?:COReadOptions):Promise<COReportImport>{parseUUID(customerId);parseMonth(month);parseUUID(revisionId);return read('pilot_co_report_import_v1',{p_customer_id:customerId,p_month:month,p_revision_id:revisionId},d=>decodeCOReportImport(d,customerId,month,revisionId),o)}
export function fetchCOReportHistory(a:{p_customer_id:string;p_month:string;p_page:number;p_page_size:number},o?:COReadOptions):Promise<COReportHistory>{pageInput({...a,p_status:'all'});return read('pilot_co_report_history_v1',a,d=>decodeCOReportHistory(d,a),o)}
export type COReportDelta = {version:'1';as_of:string;customer_id:string;report_month:string;revision_id:string;previous_revision_id:string|null;page:number;page_size:number;total:Quantity;rows:{stock_key_id:string;display_sku:string;product_name:string;before_quantity:Quantity|null;after_quantity:Quantity|null}[]};
export function decodeCOReportDelta(data:unknown,a:{p_customer_id:string;p_month:string;p_revision_id:string;p_page:number;p_page_size:number}):COReportDelta{
 const v=exact(data,['version','as_of','customer_id','report_month','revision_id','previous_revision_id','page','page_size','total','rows']);if(v.version!=='1'||v.customer_id!==a.p_customer_id||v.report_month!==a.p_month||v.revision_id!==a.p_revision_id)invalid('delta scope');const seen=new Set<string>();const rows=pageRows(v,a).map(value=>{const r=exact(value,['stock_key_id','display_sku','product_name','before_quantity','after_quantity']);const id=parseUUID(r.stock_key_id);if(seen.has(id))invalid('delta duplicate');seen.add(id);const before=r.before_quantity===null?null:parseQuantity(r.before_quantity),after=r.after_quantity===null?null:parseQuantity(r.after_quantity);if(before===after)invalid('unchanged delta');return {stock_key_id:id,display_sku:parseText(r.display_sku),product_name:parseText(r.product_name),before_quantity:before,after_quantity:after}});return {version:'1',as_of:parseTimestamp(v.as_of),customer_id:a.p_customer_id,report_month:a.p_month,revision_id:a.p_revision_id,previous_revision_id:nullUuid(v.previous_revision_id),page:a.p_page,page_size:a.p_page_size,total:parseQuantity(v.total),rows};
}
export function fetchCOReportDelta(a:{p_customer_id:string;p_month:string;p_revision_id:string;p_page:number;p_page_size:number},o?:COReadOptions):Promise<COReportDelta>{pageInput({...a,p_status:'all'});parseUUID(a.p_revision_id);return read('pilot_co_report_revision_delta_v1',a,d=>decodeCOReportDelta(d,a),o)}

export type COImportImpactBinding = {binding:ImportBinding;previewFingerprint:string;acknowledgedReopenOrders:ImportReopenAcknowledgment[]};
export type COImportImpactPage<K extends COImpactKind> = COPreviewImpactPage<K> & {binding:ImportBinding;acknowledged_reopen_orders:ImportReopenAcknowledgment[]};
function impactInput(snapshot:COImportImpactBinding,kind:COImpactKind,page:number,size:number){decodeImportBinding(snapshot.binding);parseHash(snapshot.previewFingerprint);if(!impactKinds.includes(kind)||!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>100||!Array.isArray(snapshot.acknowledgedReopenOrders)||snapshot.acknowledgedReopenOrders.length>1000)invalid('import impact input');const seen=new Set<string>();for(const ack of snapshot.acknowledgedReopenOrders){const a=exact(ack,['coId','expectedCoVersion']);parseUUID(a.coId);parseVersion(a.expectedCoVersion);if(seen.has(ack.coId))invalid('duplicate import acknowledgment');seen.add(ack.coId)}}
const impactFields:Record<COImpactKind,readonly string[]>={report:['ref','head_id','revision_id','month','coverage','is_partial_month','report_reference','received_date','notes','row_count','before_sold_quantity','after_sold_quantity','before_revenue','after_revenue','complete'],stock:['stock_key_id','batch_id','before_quantity','after_quantity'],revenue:['report_month','before_amount','after_amount'],credit:['report_month','sales_person_id_at_creation','before_amount','after_amount'],reopen:['co_id','remaining_quantity','expected_co_version','pending_quantity','missing_month_count'],issue:['code','report_month','stock_key_id','batch_id','co_id','date','sold_quantity','eligible_quantity'],missing_month:['report_month','reason','head_id','coverage_through_date']};
export function decodeCOImportImpacts<K extends COImpactKind>(data:unknown,snapshot:COImportImpactBinding,kind:K,page:number,size:number):COImportImpactPage<K>{
 impactInput(snapshot,kind,page,size);const v=exact(data,['version','as_of','binding','preview_fingerprint','acknowledged_reopen_orders','kind','page','page_size','total','rows']);decodeImportBinding(v.binding);
 if(canonicalManifestValue(v.binding)!==canonicalManifestValue(snapshot.binding)||v.preview_fingerprint!==snapshot.previewFingerprint||canonicalManifestValue(v.acknowledged_reopen_orders)!==canonicalManifestValue(snapshot.acknowledgedReopenOrders)||v.kind!==kind)invalid('import impact binding');
 const rows=pageRows(v,{p_page:page,p_page_size:size});for(const row of rows){const r=obj(row);if(Object.keys(r).some(k=>k!=='labels'&&!impactFields[kind].includes(k)))invalid('import impact row fields');
  if(Object.hasOwn(r,'labels')){const labels=exact(r.labels,['sku','productName','coNumber','sjNumber','picName']);for(const value of Object.values(labels)){if(value!==null&&(typeof value!=='string'||!value.trim()||value.length>512))invalid('impact label')}}
 }

 const legacy={version:v.version,as_of:v.as_of,preview_fingerprint:v.preview_fingerprint,kind:v.kind,page:v.page,page_size:v.page_size,total:v.total,rows:rows.map(row=>{const {labels,...rest}=obj(row);return rest})};
 decodeCORead('pilot_co_preview_impacts_v1',{p_kind:kind,p_preview_fingerprint:snapshot.previewFingerprint,p_page:page,p_page_size:size},legacy);
 return {version:'1',as_of:parseTimestamp(v.as_of),binding:decodeImportBinding(v.binding),preview_fingerprint:snapshot.previewFingerprint,acknowledged_reopen_orders:structuredClone(snapshot.acknowledgedReopenOrders),kind,page,page_size:size,total:parseQuantity(v.total),rows:rows as COImpactRows[K][]};
}
export function fetchCOImportImpacts<K extends COImpactKind>(snapshot:COImportImpactBinding,kind:K,page:number,size:number,o?:COReadOptions):Promise<COImportImpactPage<K>>{impactInput(snapshot,kind,page,size);return read('pilot_co_import_impacts_v1',{p_binding:snapshot.binding,p_preview_fingerprint:snapshot.previewFingerprint,p_acknowledged_reopen_orders:snapshot.acknowledgedReopenOrders,p_kind:kind,p_page:page,p_page_size:size},d=>decodeCOImportImpacts(d,snapshot,kind,page,size),o)}

/** Ordinary preview labels are an additive checked read, never a latest-name catalog. */
export type COImpactLabels={sku:string|null;productName:string|null;coNumber:string|null;sjNumber:string|null;picName:string|null};
export type COOrdinaryImpactBinding={operation:string;payload:Record<string,unknown>;header:{customer_id:string;customer_version:string;preview_fingerprint:string}};
export function decodeCOOrdinaryImpacts<K extends COImpactKind>(data:unknown,snapshot:COOrdinaryImpactBinding,kind:K,page:number,size:number):COPreviewImpactPage<K>{
 const v=exact(data,['version','as_of','operation','payload','customer_id','customer_version','preview_fingerprint','kind','page','page_size','total','rows']);
 if(v.operation!==snapshot.operation||canonicalManifestValue(v.payload)!==canonicalManifestValue(snapshot.payload)||v.customer_id!==snapshot.header.customer_id||v.customer_version!==snapshot.header.customer_version||v.preview_fingerprint!==snapshot.header.preview_fingerprint||v.kind!==kind)invalid('ordinary impact binding');
 const rows=pageRows(v,{p_page:page,p_page_size:size});
 for(const value of rows){const r=obj(value);if(Object.keys(r).some(k=>k!=='labels'&&!impactFields[kind].includes(k)))invalid('ordinary impact row fields');const labels=exact(r.labels,['sku','productName','coNumber','sjNumber','picName']);for(const label of Object.values(labels))if(label!==null&&(typeof label!=='string'||!label.trim()||label.length>512))invalid('impact label')}
 const legacy={version:v.version,as_of:v.as_of,preview_fingerprint:v.preview_fingerprint,kind:v.kind,page:v.page,page_size:v.page_size,total:v.total,rows:rows.map(value=>{const {labels,...row}=obj(value);return row})};
 decodeCORead('pilot_co_preview_impacts_v1',{p_kind:kind,p_preview_fingerprint:snapshot.header.preview_fingerprint,p_page:page,p_page_size:size},legacy);
 return {...legacy,rows} as COPreviewImpactPage<K>;
}
export function fetchCOOrdinaryImpacts<K extends COImpactKind>(snapshot:COOrdinaryImpactBinding,kind:K,page:number,size:number,o?:COReadOptions):Promise<COPreviewImpactPage<K>>{
 parseUUID(snapshot.header.customer_id);parseVersion(snapshot.header.customer_version);parseHash(snapshot.header.preview_fingerprint);
 if(!['post_report','correct_report','post_sj','correct_sj','post_return','correct_return'].includes(snapshot.operation)||!impactKinds.includes(kind)||!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>100)invalid('ordinary impact input');
 return read('pilot_co_preview_labeled_impacts_v1',{p_operation:snapshot.operation,p_payload:snapshot.payload,p_customer_id:snapshot.header.customer_id,p_expected_customer_version:snapshot.header.customer_version,p_preview_fingerprint:snapshot.header.preview_fingerprint,p_kind:kind,p_page:page,p_page_size:size},d=>decodeCOOrdinaryImpacts(d,snapshot,kind,page,size),o);
}

/** A checked retained source proposal, never a draft/consent capability. */
export type COSourceProposalArgs={p_customer_id:string;p_month:string;p_draft_id:string;p_expected_draft_version:string;p_expected_customer_version:string};
export type COSourceProposalResume={version:'1';customer_id:string;report_month:string;draft_id:string;draft_version:Version;customer_version:Version;source_context:import('./contracts').COSourceContext;owner:{kind:'delivery'|'return'|'report';co_id:string|null;report_month:string|null}};
function sourceProposalInput(a:COSourceProposalArgs){parseUUID(a.p_customer_id);parseMonth(a.p_month);parseUUID(a.p_draft_id);parseVersion(a.p_expected_draft_version);parseVersion(a.p_expected_customer_version)}
/** Operation-specific source-only parser. Do not normalize stored text or quantities. */
export function decodeCOSourceContext(data:unknown):import('./contracts').COSourceContext{
 const c=exact(data,['operation','payload','source_context_fingerprint']);parseHash(c.source_context_fingerprint);
 const p=obj(c.payload),op=c.operation,keys=['expected_customer_version','reason'];
 if(!['post_sj','post_return','correct_sj','correct_return','correct_report'].includes(String(op)))invalid('source operation');
 if(op==='post_sj'||op==='correct_sj')keys.push('expected_co_version');
 if(op==='post_sj'||op==='post_return'||op==='correct_report'||op==='correct_sj'&&p.action==='replace')keys.push('draft_id','expected_draft_version');
 if(String(op).startsWith('correct_')){const kind=op==='correct_sj'?'delivery':op==='correct_return'?'return':'report';keys.push(`${kind}_head_id`,'original_revision_id',`expected_${kind}_version`);if(kind==='report')keys.push('eligible_set_fingerprint');else {if(p.action!=='replace'&&p.action!=='void')invalid('source action');keys.push('action')}}
 if(op==='correct_return'&&p.action==='replace')keys.push('return_date','lines',...['reference','notes'].filter(k=>Object.hasOwn(p,k)));
 exact(p,keys);
 for(const [k,v] of Object.entries(p)){
  if(k.endsWith('_id'))parseUUID(v);else if(k.endsWith('_version'))parseVersion(v);else if(k.endsWith('_fingerprint'))parseHash(v);
  else if(k==='reason'){if(!parseText(v).trim()||String(v).length>10000)invalid('source reason')}
  else if(k==='return_date')parseDate(v);
  else if(k==='reference'||k==='notes'){if(v!==null&&parseText(v).length>10000)invalid('source text')}
 }
 if(Object.hasOwn(p,'lines')){if(!Array.isArray(p.lines)||p.lines.length<1||p.lines.length>1000)invalid('source lines');const seen=new Set<string>();for(const value of p.lines){const l=exact(value,['batch_id','quantity']),id=parseUUID(l.batch_id);parseEnteredQuantity(l.quantity);if(seen.has(id))invalid('duplicate source line');seen.add(id)}}
 if(JSON.stringify(c).length>1048576)invalid('source size');
 return structuredClone(c) as import('./contracts').COSourceContext;
}
export function decodeCOReportSourceProposal(data:unknown,a:COSourceProposalArgs):COSourceProposalResume{
 sourceProposalInput(a);const v=exact(data,['version','customer_id','report_month','draft_id','draft_version','customer_version','source_context','owner']);
 if(v.version!=='1'||v.customer_id!==a.p_customer_id||v.report_month!==a.p_month||v.draft_id!==a.p_draft_id||v.draft_version!==a.p_expected_draft_version||v.customer_version!==a.p_expected_customer_version)invalid('source proposal binding');
 const context=decodeCOSourceContext(v.source_context);if(context.payload.expected_customer_version!==v.customer_version)invalid('source customer version');
 const o=exact(v.owner,['kind','co_id','report_month']),kind=context.operation.includes('sj')?'delivery':context.operation.includes('return')?'return':'report';
 if(o.kind!==kind||(kind==='delivery'?(o.co_id===null||o.report_month!==null):(o.co_id!==null||kind==='return'&&o.report_month!==null||kind==='report'&&o.report_month===null)))invalid('source owner');
 if(o.co_id!==null)parseUUID(o.co_id);if(o.report_month!==null)parseMonth(o.report_month);
 return {...v,source_context:context,owner:{kind,co_id:o.co_id as string|null,report_month:o.report_month as string|null}} as COSourceProposalResume;
}
export function fetchCOReportSourceProposal(a:COSourceProposalArgs,o?:COReadOptions):Promise<COSourceProposalResume>{sourceProposalInput(a);return read('pilot_co_report_source_proposal_v1',a,d=>decodeCOReportSourceProposal(d,a),o)}
/** Identifiers only; every destination must run the checked read again. */
export function coSourceProposalURL(v:COSourceProposalResume):string{
 const q=new URLSearchParams({proposalDraft:v.draft_id,proposalMonth:v.report_month,proposalDraftVersion:v.draft_version,proposalCustomerVersion:v.customer_version});
 if(v.owner.kind==='return')q.set('customer',v.customer_id);
 const path=v.owner.kind==='delivery'?`/athel/co/${v.owner.co_id}`:v.owner.kind==='return'?'/athel/co/stock':`/athel/co/reports/${v.customer_id}/${v.owner.report_month}`;
 return `${path}?${q}`;
}
export function coSourceProposalRequest(params:URLSearchParams,customerId:string):COSourceProposalArgs|null{
 const names=['proposalDraft','proposalMonth','proposalDraftVersion','proposalCustomerVersion'];if(!names.some(k=>params.has(k)))return null;
 if(names.some(k=>params.getAll(k).length!==1))invalid('source proposal URL');
 const a={p_customer_id:customerId,p_month:params.get('proposalMonth')!,p_draft_id:params.get('proposalDraft')!,p_expected_draft_version:params.get('proposalDraftVersion')!,p_expected_customer_version:params.get('proposalCustomerVersion')!};sourceProposalInput(a);return a;
}


function batchInput(a:COCustomerBatchesV2Args){
 parseUUID(a.p_customer_id);parseUUID(a.p_stock_key_id);parseUUID(a.p_expected_generation_id);parseVersion(a.p_expected_customer_version);
 const cutoff=parseDate(a.p_as_of);if(cutoff>new Date().toISOString().slice(0,10))invalid('future batch cutoff');
 parseSafeCount(a.p_page);parseSafeCount(a.p_page_size);if(a.p_page<1||![25,50,100].includes(a.p_page_size))invalid('batch page');
}
/** Whole-result aggregates are server facts; the loaded page is not a replacement for them. */
export function decodeCOCustomerBatchesV2(data:unknown,a:COCustomerBatchesV2Args):COCustomerBatchesV2{
 batchInput(a);
 const v=exact(data,['version','as_of','customer_id','stock_key_id','customer_version','generation_id','stock_as_of','coverage_date','page','page_size','total','recorded_quantity','contract_stock_value','contract_currency','rows']);
 const asOf=parseTimestamp(v.as_of);
 if(v.version!=='2'||v.customer_id!==a.p_customer_id||v.stock_key_id!==a.p_stock_key_id||v.customer_version!==a.p_expected_customer_version||v.generation_id!==a.p_expected_generation_id||v.stock_as_of!==a.p_as_of||v.coverage_date!==a.p_as_of||a.p_as_of>new Date(asOf).toISOString().slice(0,10)||v.contract_currency!=='IDR')invalid('batch pins');
 const quantity=parseQuantity(v.recorded_quantity),value=parseMoney(v.contract_stock_value),total=parseQuantity(v.total),seen=new Set<string>();let pageQuantity=0n,pageValue=0n,previousDate:string|null=null,unknownDateSeen=false;
 const rows=pageRows(v,a).map(item=>{
  const r=exact(item,['id','co_id','co_number','delivery_head_id','delivery_revision_id','sj_number','sj_date','available_quantity','unit_price','contract_value']);
  const id=parseUUID(r.id),revision=nullUuid(r.delivery_revision_id),sj=nullText(r.sj_number),date=r.sj_date===null?null:parseDate(r.sj_date),q=parseQuantity(r.available_quantity),price=parseMoney(r.unit_price),amount=parseMoney(r.contract_value),coNumber=parseText(r.co_number);
  if(seen.has(id)||BigInt(q)<=0n||minorUnits(amount)!==BigInt(q)*minorUnits(price)||!coNumber.trim()||sj!==null&&!sj.trim()||revision===null&&(sj!==null||date!==null)||date!==null&&(date>a.p_as_of||previousDate!==null&&date<previousDate))invalid('batch row');
  // Unknown source dates sort last in SQL; do not manufacture an ordering key.
  if(unknownDateSeen&&date!==null)invalid('batch source ordering');if(date===null)unknownDateSeen=true;else previousDate=date;seen.add(id);pageQuantity+=BigInt(q);pageValue+=minorUnits(amount);
  return {id,co_id:parseUUID(r.co_id),co_number:coNumber,delivery_head_id:parseUUID(r.delivery_head_id),delivery_revision_id:revision,sj_number:sj,sj_date:date,available_quantity:q,unit_price:price,contract_value:amount};
 });
 if(pageQuantity>BigInt(quantity)||pageValue>minorUnits(value)||BigInt(total)>BigInt(quantity)||total==='0'&&(quantity!=='0'||minorUnits(value)!==0n)||BigInt(total)===BigInt(rows.length)&&(pageQuantity!==BigInt(quantity)||pageValue!==minorUnits(value)))invalid('batch aggregates');
 return {version:'2',as_of:asOf,customer_id:a.p_customer_id,stock_key_id:a.p_stock_key_id,customer_version:parseVersion(v.customer_version),generation_id:a.p_expected_generation_id,stock_as_of:a.p_as_of,coverage_date:a.p_as_of,page:a.p_page,page_size:a.p_page_size,total,recorded_quantity:quantity,contract_stock_value:value,contract_currency:'IDR',rows};
}
export function assertCOBatchParent(detail:COCustomerBatchesV2,parent:COStockRowV2,cutoff:string):void{
 if(detail.customer_id!==parent.customer_id||detail.stock_key_id!==parent.stock_key_id||detail.customer_version!==parent.customer_version||detail.generation_id!==parent.generation_id||detail.stock_as_of!==cutoff||detail.coverage_date!==cutoff||parent.contract_stock_value===null||parent.contract_currency!=='IDR'||parent.valuation_basis!=='retained_co_batch'||BigInt(detail.recorded_quantity)!==BigInt(parent.recorded_quantity)||minorUnits(detail.contract_stock_value)!==minorUnits(parent.contract_stock_value))throw new Error('Basis stok berubah atau nilai belum tersedia. Muat ulang stok sebelum melihat batch.');
}
export async function fetchCOCustomerBatchesV2(a:COCustomerBatchesV2Args,o?:COReadOptions):Promise<COCustomerBatchesV2>{batchInput(a);return read('pilot_co_customer_batches_v2',a,d=>decodeCOCustomerBatchesV2(d,a),o)}
