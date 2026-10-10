import { supabase } from '../supabase';
import { decodeCORead, invalid, parseUUID, parseVersion, parseHash, parseMonth, parseDate, parseSafeCount, sections } from './validation';
import type { COReadName, COReadResult, COSection } from './validation';
export class COConflictError extends Error {
    readonly code = 'PT409';
    constructor() { super('CO berubah. Muat ulang dan periksa perubahan sebelum melanjutkan.'); this.name = 'COConflictError'; }
}
class COEvidenceRegistrationConflictError extends Error {
    readonly code = 'PT409';
    constructor() {
        super('Berkas yang sama telah didaftarkan operator lain. Minta operator tersebut menyelesaikan lampiran, atau batalkan pilihan lalu simpan dan tinjau versi laporan baru sebelum mencoba lagi. Isian laporan Anda tetap disimpan.');
    }
}
export function coError(error: unknown): Error {
    const e = error as { code?: string; message?: string };
    if (error instanceof COEvidenceRegistrationConflictError) return error;
    if (e?.code === 'PT409' && e.message === 'CO_EVIDENCE_REGISTERED_BY_OTHER_ACTOR')
        return new COEvidenceRegistrationConflictError();
    if (e?.code === 'PT409') return new COConflictError();
    if (['PGRST202', '42883'].includes(e?.code ?? ''))
        return new Error('Pembaruan database diperlukan sebelum menggunakan CO. Hubungi administrator.');
    return error instanceof Error ? error : Object.assign(new Error(e?.message ?? 'Data CO belum tersedia.'), { code: e?.code });
}
export type COReadOptions = {
    signal?: AbortSignal;
    isCurrent?: () => boolean;
};
export type COPageInput = {
    p_page: number;
    p_page_size: number;
};
export type COStockInput = COPageInput & {
    p_customer_id: string | null;
    p_as_of: string | null;
    p_search: string;
    p_expected_customer_version: string | null;
};
export type COSectionInput = COPageInput & {
    p_co_id: string;
    p_section: COSection;
    p_parent_id: string | null;
    p_expected_version: string;
    p_expected_customer_version: string;
    p_expected_draft_version?: string | null;
};
export async function callCORead(name: COReadName, args: Record<string, any>, options: COReadOptions = {}): Promise<COReadResult> {
    options.signal?.throwIfAborted();
    if (options.isCurrent && !options.isCurrent())
        invalid('identity');
    for (const [key, value] of Object.entries(args)) {
        if (value == null)
            continue;
        if (key === 'p_page' || key === 'p_page_size') {
            parseSafeCount(value);
            if (value < 1 || (key === 'p_page_size' && value > 100))
                invalid('page');
        }
        else if (key.endsWith('_id'))
            parseUUID(value);
        else if (key.includes('expected_') && key.endsWith('_version'))
            parseVersion(value);
        else if (key === 'p_month' || key === 'p_report_month')
            parseMonth(value);
        else if (key === 'p_as_of')
            parseDate(value);
        else if (key === 'p_preview_fingerprint')
            parseHash(value);
    }
    if (args.p_section && !Object.hasOwn(sections, args.p_section))
        invalid('section');
    let request = supabase.rpc(name, args);
    if (options.signal)
        request = request.abortSignal(options.signal);
    const { data, error } = await request;
    options.signal?.throwIfAborted();
    if (options.isCurrent && !options.isCurrent())
        invalid('identity');
    if (error)
        throw coError(error);
    return decodeCORead(name, args, data);
}
export const fetchCOPage = (args: COPageInput & {
    p_status: string;
    p_search: string;
    p_customer_id?: string | null;
}, o?: COReadOptions) => callCORead('pilot_co_page_v1', { ...args, p_customer_id: args.p_customer_id ?? null }, o);
export const fetchCODetail = (coId: string, expectedVersion: string | null = null, o?: COReadOptions) => callCORead('pilot_co_detail_v1', { p_co_id: coId, p_expected_version: expectedVersion }, o);
export const fetchCODetailSection = (args: COSectionInput, o?: COReadOptions) => callCORead('pilot_co_detail_section_v1', { ...args, p_expected_draft_version: args.p_expected_draft_version ?? null }, o);
export const fetchCOReportsPage = (args: COPageInput & {
    p_customer_id: string | null;
    p_month: string | null;
    p_status: string;
}, o?: COReadOptions) => callCORead('pilot_co_reports_page_v1', args, o);
export const fetchCOReportMonths = (customerId: string, o?: COReadOptions) => callCORead('pilot_co_report_months_v1', { p_customer_id: customerId }, o);
export const fetchCOReport = (customerId: string, month: string, version: string | null = null, o?: COReadOptions) => callCORead('pilot_co_report_v1', { p_customer_id: customerId, p_month: month, p_expected_customer_version: version }, o);
export const fetchCOReportRows = (args: COPageInput & {
    p_customer_id: string;
    p_month: string;
    p_view: 'draft' | 'effective' | 'revision';
    p_revision_id?: string | null;
    p_expected_draft_version: string | null;
    p_expected_customer_version: string;
}, o?: COReadOptions) => callCORead('pilot_co_report_rows_v1', { ...args, p_revision_id: args.p_revision_id ?? null }, o);
export const fetchCOReportAllocations = (args: COPageInput & {
    p_customer_id: string;
    p_month: string;
    p_revision_id: string;
    p_expected_customer_version: string;
}, o?: COReadOptions) => callCORead('pilot_co_report_allocations_v1', args, o);
export const fetchCOCustomerStock = (args: COStockInput, o?: COReadOptions) => callCORead('pilot_co_customer_stock_v1', args, o);
export const fetchCOStockMovements = (args: COPageInput & {
    p_customer_id: string;
    p_stock_key_id: string;
    p_as_of: string | null;
}, o?: COReadOptions) => callCORead('pilot_co_stock_movements_v1', args, o);
export const fetchCOCustomerBatches = (args: COPageInput & {
    p_customer_id: string;
    p_stock_key_id: string | null;
    p_expected_customer_version: string;
}, o?: COReadOptions) => callCORead('pilot_co_customer_batches_v1', args, o);
export const previewCOOperation = (operation: string, payload: unknown, o?: COReadOptions) => callCORead('pilot_co_preview_v1', { p_operation: operation, p_payload: payload }, o);
export const fetchCOPreviewImpacts = (args: COPageInput & {
    p_operation: string;
    p_payload: unknown;
    p_preview_fingerprint: string;
    p_kind: string;
}, o?: COReadOptions) => callCORead('pilot_co_preview_impacts_v1', args, o);
export const fetchCOPreviewAllocations = (args: COPageInput & {
    p_operation: string;
    p_payload: unknown;
    p_preview_fingerprint: string;
    p_report_month: string;
    p_stock_key_id: string | null;
}, o?: COReadOptions) => callCORead('pilot_co_preview_allocations_v1', args, o);
/** Only one-entity editable collections; versions must stay pinned across every page. */
export async function completeCORead(fetchPage: (page: number) => Promise<COReadResult>, key = (r: Record<string, any>) => r.id): Promise<Record<string, any>[]> { const rows: Record<string, any>[] = [], seen = new Set<string>(); let total: string | undefined, binding: string | undefined; for (let page = 1;; page++) {
    const result = await fetchPage(page);
    const current = JSON.stringify([result.customer_id, result.customer_version, result.co_id, result.co_version, result.draft_id, result.draft_version, result.generation_id, result.preview_fingerprint]);
    if (total !== undefined && (result.total !== total || binding !== current))
        invalid('changed collection');
    total = result.total;
    binding = current;
    for (const row of result.rows) {
        const id = key(row);
        if (typeof id !== 'string' || seen.has(id))
            invalid('duplicate collection');
        seen.add(id);
        rows.push(row);
    }
    if (BigInt(rows.length) === BigInt(total!))
        return rows;
    if (result.rows.length === 0 || BigInt(rows.length) > BigInt(total!) || page === Number.MAX_SAFE_INTEGER)
        invalid('incomplete collection');
} }
export function fetchCompleteCOLines(coId: string, coVersion: string, customerVersion: string, o?: COReadOptions) { return completeCORead(page => fetchCODetailSection({ p_co_id: coId, p_expected_version: coVersion, p_expected_customer_version: customerVersion, p_parent_id: null, p_section: 'lines', p_page: page, p_page_size: 100 }, o)); }
export async function fetchCompleteCOSJDraft(coId: string, draftId: string, coVersion: string, customerVersion: string, o?: COReadOptions) { const args = { p_co_id: coId, p_expected_version: coVersion, p_expected_customer_version: customerVersion, p_parent_id: draftId, p_page: 1, p_page_size: 100 }; const header = await fetchCODetailSection({ ...args, p_section: 'sj_drafts' }, o); if (header.rows.length !== 1)
    invalid('draft header'); const draft = header.rows[0]; const lines = await completeCORead(page => fetchCODetailSection({ ...args, p_section: 'sj_draft_lines', p_expected_draft_version: draft.draft_version, p_page: page }, o)); if (BigInt(lines.length) !== BigInt(draft.line_count))
    invalid('draft lines'); return { header: draft, lines }; }
export const fetchCompleteCOStockKeys = (customerId: string, version: string, o?: COReadOptions) => completeCORead(page => fetchCOCustomerStock({ p_customer_id: customerId, p_as_of: null, p_search: '', p_expected_customer_version: version, p_page: page, p_page_size: 100 }, o));
export async function resolveCOStockKey(customerId: string, sku: string, version: string, o?: COReadOptions) { let normalized: string | undefined; const rows = await completeCORead(async (page) => { const r = await fetchCOCustomerStock({ p_customer_id: customerId, p_as_of: null, p_search: sku, p_expected_customer_version: version, p_page: page, p_page_size: 100 }, o); if (normalized !== undefined && normalized !== r.normalized_search)
    invalid('normalization'); normalized = r.normalized_search; return r; }); const matches = rows.filter(r => r.normalized_sku === normalized); if (matches.length > 1)
    invalid('ambiguous stock identity'); return matches[0] ?? null; }
export const fetchCOReturn = (args: COPageInput & {
    p_customer_id: string;
    p_target_id: string;
    p_view: 'draft' | 'effective' | 'revision';
    p_expected_customer_version: string;
    p_expected_draft_version: string | null;
}, o?: COReadOptions) => callCORead('pilot_co_return_v1', args, o);
export async function fetchCompleteCOReturn(args: {
    p_customer_id: string;
    p_target_id: string;
    p_view: 'draft' | 'effective' | 'revision';
    p_expected_customer_version: string;
    p_expected_draft_version: string | null;
}, o?: COReadOptions) { let header: Record<string, any> | undefined; const rows = await completeCORead(async (page) => { const r = await fetchCOReturn({ ...args, p_page: page, p_page_size: 100 }, o); if (header && JSON.stringify(header) !== JSON.stringify(r.header))
    invalid('changed return'); header = r.header; return r; }); if (BigInt(rows.length) !== BigInt(header!.line_count))
    invalid('return completeness'); return { header: header!, lines: rows }; }
