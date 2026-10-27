import { completeCORead, fetchCOReport, fetchCOReportHistory, fetchCOReportImport } from './rpc';
import type { COReceipt } from './contracts';
import { invalid } from './validation';
/** Exact original ordinary result and fresh current state. No acknowledgment or new command. */
export async function inspectCOReportCorrection(customerId:string,month:string,receipt:COReceipt,isCurrent:()=>boolean){
 const snapshot=(r:Record<string,unknown>)=>JSON.stringify([r.customer_version,r.generation_id,r.draft,r.effective]);

  const o={isCurrent};
  if(receipt.operation!=='correct_report'||receipt.customer_id!==customerId)invalid('original correction receipt scope');
  const r=await fetchCOReport(customerId,month,null,o);
  const validHead=(v:typeof r)=>{
   if(v.effective?.report_head_id!==receipt.id||BigInt(v.effective.report_version)<BigInt(receipt.version)||BigInt(v.customer_version)<BigInt(receipt.customer_version))invalid('original correction current scope');
  };
  validHead(r);
  let revisionId=r.effective.revision_id as string;
  if(r.effective.report_version!==receipt.version){
   const history=await completeCORead(page=>fetchCOReportHistory({p_customer_id:customerId,p_month:month,p_page:page,p_page_size:100},o),row=>row.revision_id);
   const original=history.filter(row=>row.report_version===receipt.version);
   if(original.length!==1)invalid('original correction revision');
   revisionId=original[0].revision_id;
  }
  const original=await fetchCOReportImport(customerId,month,revisionId,o);
  if(original.report_head_id!==receipt.id||original.report_version!==receipt.version||original.manifest!==null||original.effective_revision_id!==r.effective.revision_id)invalid('original legacy correction scope');
  // Recheck after complete history/original reads; no stored read grants authority.
  const latest=await fetchCOReport(customerId,month,null,o);validHead(latest);
  return {originalRevisionId:revisionId,currentRevisionId:latest.effective.revision_id as string,reportVersion:latest.effective.report_version as string,customerVersion:latest.customer_version as string,value:latest,snapshot:snapshot(latest),changed:latest.customer_version!==receipt.customer_version||latest.effective.report_version!==receipt.version||snapshot(latest)!==snapshot(r)};
}
