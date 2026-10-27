import type { ExtractedReport } from './types';
/** Client affordance only: final permission requires the server byte-bound receipt. */
export function canTranscribeSource(source: ExtractedReport): boolean {
 if(source.manualTranscription || source.warnings.length!==1)return false;
 if(source.format==='pdf')return source.parserVersion==='co-searchable-pdf-3' && source.warnings[0]==='manual_review:unsupported_layout_or_image_only';
 return source.format==='xlsx' && source.parserVersion==='co-guarded-xlsx-7' && source.warnings[0]==='manual_review:safe_unsupported_xlsx_layout'
  && source.manualWorkbook?.version===1 && source.manualWorkbook.policy==='co-manual-xlsx-values-1' && !!source.manualWorkbook.sheets.length && !(source.printedControls?.length);
}
export function isManualTranscription(source: ExtractedReport): boolean {
 const p=source.manualTranscription, version=source.format==='xlsx'?2:1;
 return !!p && p.mode==='human_transcribed' && p.version===version && p.confirmed===true && source.parserVersion===`co-human-transcribed-${version}`
 && p.reason.trim().length>0 && p.reason.length<=2000 && JSON.stringify(p.originalWarnings)===JSON.stringify(source.warnings)
 && canTranscribeSource({...source,parserVersion:p.originalParserVersion,manualTranscription:undefined});
}
