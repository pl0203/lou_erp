import type { ExtractedReport, SourceNumber } from './types';
import { normalizeSourceNumber } from './decimal';
/** Printed workbook arithmetic is source evidence, not a mixed-unit stock KPI.
 * Preserve arbitrary supported decimal precision; do not round or net returns. */
function decimal(value:SourceNumber|null|undefined):string|null {
 if(!value||value.decimal===null)return null;
 const expected=value.convention==='canonical_integer_text'&&/^(0|[1-9][0-9]*)$/.test(value.raw)?value.raw
  :value.convention==='decimal_dot'?normalizeSourceNumber(value.raw,'.').decimal
  :value.convention==='decimal_comma'?normalizeSourceNumber(value.raw,',').decimal:null;
 return expected===value.decimal&&/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(expected??'')?expected:null;
}
function equalSum(printed:SourceNumber,values:(SourceNumber|null|undefined)[]):boolean {
 const parts=[printed,...values].map(decimal);if(parts.some(p=>p===null))return false;
 const scale=Math.max(...parts.map(p=>p!.split('.')[1]?.length??0));
 const integer=(v:string)=>{const [a,b='']=v.split('.');return BigInt(a+b.padEnd(scale,'0'))};
 return integer(parts[0]!)===parts.slice(1).reduce((sum,v)=>sum+integer(v!),0n);
}
export function sourceControlIssues(source:ExtractedReport):string[] {
 if(source.manualTranscription?.version===2)return manualControlIssues(source);
 const errors=new Set<string>(),controls=source.printedControls??[];
 if(source.format==='xlsx'&&/^co-guarded-xlsx-[67]$/.test(source.parserVersion)&&!source.printedControls)errors.add('source_controls_required');
 // Older parsed workbooks dropped controls. They remain readable history, not new reviewed evidence.
 if(source.format==='xlsx'&&/^co-guarded-xlsx-[1-5]$/.test(source.parserVersion))errors.add('source_controls_required');
 if(source.format==='xlsx'&&/^co-guarded-xlsx-[67]$/.test(source.parserVersion)&&source.sections.some(s=>s.printedTotal!==null&&!controls.some(c=>c.kind==='section'&&c.ref.section===s.id)))errors.add('source_controls_required');
 const seen=new Set<string>();
 for(const c of controls){
  const key=`${c.ref.sheet}:${c.ref.row}`;
  const rows=source.sourceRows.filter(r=>c.kind==='sheet'?r.ref.sheet===c.ref.sheet:r.ref.section===c.ref.section);
  if(source.format!=='xlsx'||!c.ref.sheet||c.ref.page!==null||c.ref.fileSha256!==source.sha256||!/^r[1-9][0-9]*$/.test(c.ref.row)||seen.has(key)||!rows.length||new Set(c.rowIds).size!==c.rowIds.length||c.rowIds.length!==rows.length||rows.some(r=>!c.rowIds.includes(r.id)||r.ref.sheet!==c.ref.sheet))errors.add('source_control_identity_mismatch');
  seen.add(key);
  if(c.kind==='section'){
   const section=source.sections.find(s=>s.id===c.ref.section);
   if(!section||JSON.stringify(section.printedTotal)!==JSON.stringify(c.amount))errors.add('source_control_identity_mismatch');
  }
  if(!equalSum(c.count,[{raw:String(rows.length),decimal:String(rows.length),convention:'canonical_integer_text'}]))errors.add('source_control_count_mismatch');
  for(const metric of ['quantity','returned','amount'] as const)if(!equalSum(c[metric],rows.map(r=>r[metric])))errors.add(`source_control_${metric}_mismatch`);
 }
 return [...errors];
}

/** Syntactic physical membership only. Server repeats against immutable byte facts. */
export function manualPhysicalIssues(source:ExtractedReport):string[] {
 const facts=source.manualWorkbook, review=source.manualPrintedControls, errors=new Set<string>();
 const fail=()=>errors.add('manual_physical_identity_mismatch');
 if(!facts||!review||review.version!==2||review.confirmed!==true||source.printedControls!==undefined)return ['manual_controls_required'];
 const names=facts.sheets.map(s=>s.name);
 if(!names.length||new Set(names).size!==names.length||new Set(review.reviewedSheets).size!==names.length||review.reviewedSheets.length!==names.length||names.some(n=>!review.reviewedSheets.includes(n)))fail();
 for(const s of facts.sheets)if(new Set(s.rows).size!==s.rows.length)fail();
 const physical=(ref:import('./types').SourceRef)=>{
  if(ref.fileSha256!==source.sha256||ref.page!==null||!ref.sheet||!/^r[1-9][0-9]*$/.test(ref.row)||!facts.sheets.find(s=>s.name===ref.sheet)?.rows.includes(Number(ref.row.slice(1))))fail();
  return JSON.stringify([ref.sheet,ref.row]);
 };
 const seen=new Set<string>(),ids=new Map(source.sourceRows.map(r=>[r.id,r]));
 if(!source.sourceRows.length||!source.sections.length||ids.size!==source.sourceRows.length)fail();
 for(const row of source.sourceRows){const key=physical(row.ref);if(seen.has(key))fail();seen.add(key)}
 for(const c of review.controls){
  const key=physical(c.ref);if(seen.has(key))fail();seen.add(key);
  if(!c.rowIds.length||new Set(c.rowIds).size!==c.rowIds.length||c.rowIds.some(id=>!ids.has(id)||ids.get(id)!.ref.sheet!==c.ref.sheet))fail();
  if([c.count,c.quantity,c.returned,c.amount].every(n=>n===null))fail();
 }
 for(const section of source.sections)if(section.printedTotal!==null){
  const rows=section.rowIds.map(id=>ids.get(id));
  const matches=review.controls.filter(c=>c.amount!==null && c.amount.raw===section.printedTotal!.raw && c.amount.decimal===section.printedTotal!.decimal && c.amount.convention===section.printedTotal!.convention && Object.hasOwn(c.amount,'convention')===Object.hasOwn(section.printedTotal!,'convention')&&c.rowIds.length===section.rowIds.length&&section.rowIds.every(id=>c.rowIds.includes(id))&&rows.every(r=>r?.ref.sheet===c.ref.sheet));
  if(matches.length!==1)fail();
 }
 return [...errors];
}
function manualControlIssues(source:ExtractedReport):string[]{
 const errors=new Set(manualPhysicalIssues(source));
 for(const c of source.manualPrintedControls?.controls??[]){
  const rows=c.rowIds.map(id=>source.sourceRows.find(r=>r.id===id));
  if(c.count!==null && !equalSum(c.count,[{raw:String(rows.length),decimal:String(rows.length),convention:'canonical_integer_text'}]))errors.add('source_control_count_mismatch');
  for(const metric of ['quantity','returned','amount'] as const)if(c[metric]!==null&&!equalSum(c[metric],rows.map(r=>r?.[metric])))errors.add(`source_control_${metric}_mismatch`);
 }
 return [...errors];
}
