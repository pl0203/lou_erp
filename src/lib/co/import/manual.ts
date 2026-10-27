import type { ExtractedReport } from './types';
import { canTranscribeSource, isManualTranscription } from './manualPolicy';
import { canonicalManifestValue, decodeImportManifest } from './manifest';
import { invalid } from '../validation';
export { isManualTranscription, canTranscribeSource };
export type ManualSourceInput = Pick<ExtractedReport, 'sourceRows' | 'sections' | 'periodCandidates' | 'customerCandidates'> & {
    manualPrintedControls?: ExtractedReport['manualPrintedControls'];
    reason: string;
    confirmed: true;
};
/** Only controller supplies original extraction. No caller-supplied SHA, file, format or provenance. */
export function buildManualTranscription(original: ExtractedReport, proposal: ManualSourceInput): ExtractedReport {
    if (!canTranscribeSource(original) || proposal.confirmed !== true || !proposal.reason?.trim())
        invalid('manual transcription eligibility');
    const version=original.format==='xlsx'?2:1;
    if(version===1 && proposal.manualPrintedControls!==undefined)invalid('PDF manual controls');
    const source: ExtractedReport = { ...original, sourceRows: proposal.sourceRows, sections: proposal.sections, periodCandidates: proposal.periodCandidates, customerCandidates: proposal.customerCandidates, parserVersion: `co-human-transcribed-${version}`, manualTranscription: { mode: 'human_transcribed', version, originalParserVersion: original.parserVersion, originalWarnings: original.warnings, reason: proposal.reason, confirmed: true } };
    if(version===2){
      delete source.printedControls;
      if(!proposal.manualPrintedControls)invalid('all-sheet printed control review required');
      source.manualPrintedControls=proposal.manualPrintedControls;
    }
    const id = '11111111-1111-1111-1111-111111111111';
    // Reuse the exact wire decoder and expanded-result budget before cloning untrusted input.
    const decoded = decodeImportManifest({ schemaVersion: 1, evidenceId: id, digest: 'a'.repeat(64), input: { scope: { actorId: id, customerId: id, reportMonth: '2026-01-01', epoch: 0 }, extracted: source, mappings: [], returns: [], includedSectionIds: [], completenessConfirmed: false, omittedZeroStockKeyIds: [], currency: null, reason: null } }).input.extracted;
    if (!decoded.sourceRows.length || !decoded.sections.length)
        invalid('manual physical rows required');
    if(version===2){
      decoded.manualPrintedControls!.reviewedSheets=decoded.manualWorkbook!.sheets.map(s=>s.name);
      return structuredClone(decoded);
    }
    const physical = new Set<string>();
    for (const row of decoded.sourceRows) {
        if (row.ref.fileSha256 !== original.sha256 || row.ref.page === null || row.ref.page > 50 || row.ref.sheet !== null || !row.ref.row.trim() || !row.ref.section.trim())
            invalid('manual physical source reference');
        const key = canonicalManifestValue(row.ref);
        if (physical.has(key))
            invalid('manual duplicate physical reference');
        physical.add(key);
    }
    return structuredClone(decoded);
}
