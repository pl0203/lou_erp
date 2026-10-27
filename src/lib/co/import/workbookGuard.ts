import { guardWorkbook, workbookErrorCode } from '../../../../supabase/functions/_shared/workbook-guard';
import type { ReviewIssue } from './types';
export { guardWorkbook, workbookErrorCode, WORKBOOK_LIMITS, validateWorkbook, classifyManualWorkbook, CO_XLSX_HEADERS } from '../../../../supabase/functions/_shared/workbook-guard';
export type { RawCell, GuardedWorkbook, ManualWorkbookFacts } from '../../../../supabase/functions/_shared/workbook-guard';
/** Async by design: actual streamed expansion/CRC, not merely ZIP metadata. */
export async function inspectWorkbook(bytes: Uint8Array, signal: AbortSignal = new AbortController().signal): Promise<{
    sheetNames: string[];
    issues: ReviewIssue[];
}> {
    try {
        const g = await guardWorkbook(bytes, signal);
        return { sheetNames: g.sheetNames, issues: [] };
    }
    catch (e) {
        if (signal.aborted)
            throw e;
        return { sheetNames: [], issues: [{ code: workbookErrorCode(e), rowId: null, message: 'Berkas tidak dapat diproses dengan aman. Gunakan pemeriksaan dan entri manual.', blocking: true }] };
    }
}
