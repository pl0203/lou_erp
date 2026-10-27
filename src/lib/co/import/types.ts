import type { ManualWorkbookFacts } from './workbookGuard'
import type { Quantity, Money, Version } from '../contracts'

/** reportMonth is validated ISO first-of-month text, never a local-time Date. */
export type ImportScope = { actorId: string; customerId: string; reportMonth: string; epoch: number }

export type SourceRef = { fileSha256: string; page: number|null; sheet: string|null; row: string; section: string }

/** null is unresolved, not zero; source precision is not ledger precision. */
export type SourceNumberConvention = 'decimal_dot'|'decimal_comma'|'canonical_integer_text'|'dash_zero'
export type SourceNumber = { raw: string; decimal: string|null; convention?:SourceNumberConvention|null }

export type SourceRow = { physicalReturnDate?:{date:string;ref:SourceRef;raw:string}; id: string; ref: SourceRef; sourceSku: string|null; name: string; transactionDate: string|null; transactionReference: string|null; quantity: SourceNumber; returned: SourceNumber|null; unit: string|null; unitPrice: SourceNumber|null; discount: SourceNumber|null; discountBasis: 'line_amount'|'unit_amount'|'percent'|'unknown'|null; netUnitPrice: SourceNumber|null; amount: SourceNumber|null; currency: string|null; priceBasisLabel: string|null; flags: string[] }

export type ManualTranscription = { mode:"human_transcribed"; version:1|2; originalParserVersion:string; originalWarnings:string[]; reason:string; confirmed:true };
export type PrintedSourceControl = {kind:'section'|'sheet';ref:SourceRef;rowIds:string[];count:SourceNumber;quantity:SourceNumber;returned:SourceNumber;amount:SourceNumber};
export type ManualPrintedSourceControl = {ref:SourceRef;rowIds:string[];count:SourceNumber|null;quantity:SourceNumber|null;returned:SourceNumber|null;amount:SourceNumber|null};
export type ManualPrintedControls = {version:2;reviewedSheets:string[];confirmed:true;controls:ManualPrintedSourceControl[]};
/** manualWorkbook is client context, never server permission or receipt authority. */
export type ExtractedReport = { manualWorkbook?:ManualWorkbookFacts; manualPrintedControls?:ManualPrintedControls; printedControls?:PrintedSourceControl[]; manualTranscription?:ManualTranscription; sha256: string; format: 'pdf'|'xlsx'; parserVersion: string; sourceRows: SourceRow[]; sections: {id:string; label:string; rowIds:string[]; printedTotal:SourceNumber|null}[]; periodCandidates:string[]; customerCandidates:string[]; warnings:string[] }

export type MappingDecision = { rowId:string; stockKeyId:string|null; ledgerUnit:string|null; quantity:Quantity|null; conversion:{numerator:string;denominator:string;reason:string}|null; included:boolean; exclusionReason:string|null; confirmed:boolean }

/** Explicit physical return evidence; a sale date is never a return date. */
export type ReturnConfirmation = { physicalReturnDate:string; basis:'source_return_date'|'selected_existing_return_evidence'; confirmed:boolean; note:string }

/** stockImpact is computed by the server, never trusted as client clearance. */
export type ReturnDecision = { rowId:string; state:'none'|'linked'|'unresolved'; links:{returnRevisionId:string;quantity:Quantity;/** Absent on legacy client drafts; strict immutable manifests require it. */ confirmation?:ReturnConfirmation}[]; stockImpact:'clear'|'uncertain'; note:string }

export type SourceConfirmation = { rowId:string; flag:'formula_cache_requires_confirmation'|'source_sku_format_requires_confirmation'; confirmed:boolean; reason:string }

export type ReviewInput = { sourceConfirmations?:SourceConfirmation[]; scope:ImportScope; extracted:ExtractedReport; mappings:MappingDecision[]; returns:ReturnDecision[]; includedSectionIds:string[]; completenessConfirmed:boolean; omittedZeroStockKeyIds:string[]; currency:string|null; reason:string|null }

export type ReviewIssue = { code:string; rowId:string|null; message:string; blocking:boolean }

/** Authenticated server identity, not scope.actorId, determines authority. */
export type ImportManifest = { schemaVersion:1; evidenceId:string; input:ReviewInput; digest:string }

export type ImportBinding = { importId:string; importVersion:Version; customerVersion:Version; draftId:string; draftVersion:Version; manifestDigest:string }

export type ImportReopenAcknowledgment = { coId:string; expectedCoVersion:Version }

export type ImportPreview = { requiredReopenOrders?:ImportReopenAcknowledgment[]; binding:ImportBinding; previewFingerprint:string; existingPreview:import('../contracts').COPreview; issues:ReviewIssue[] }

/** requestId is stable and persisted only via existing scoped recovery. */
export type ImportPost = { acknowledgedReopenOrders?:ImportReopenAcknowledgment[]; binding:ImportBinding; previewFingerprint:string; requestId:string; mode:'post'|'edit'; reason:string|null }

export type ReviewValidation = { issues:ReviewIssue[]; quantities:{stockKeyId:string;quantity:Quantity}[]; totalsByUnit:Record<string,Quantity>; sourceAmount:Money|null; canConfirm:boolean; /** Only permits asking the server, never confirmation. */ canRequestServerCheck?:boolean }

/** Authenticated immutable validation finding, separate from the human decision. */
export type PriorReturnProof = {basis:'prior_committed_exact_coverage';rowId:string;priorImportId:string;priorReportRevisionId:string;priorManifestDigest:string;priorValidationDigest:string}
