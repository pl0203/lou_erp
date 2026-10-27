import type { COOperation, COReceipt, Money, SignedMoney, Quantity, SignedQuantity, Version, COStockPageV2, COStockRowV2 } from './contracts';
export class COReadError extends Error {
    readonly code = 'CO_READ_INVALID';
    constructor(path = 'response') { super(`Data CO tidak lengkap atau tidak valid: ${path}`); this.name = 'COReadError'; }
}
export function invalid(path?: string): never { throw new COReadError(path); }
export const operations: readonly COOperation[] = ['create_co', 'edit_co', 'cancel_co', 'save_sj_draft', 'post_sj', 'save_report_draft', 'post_report', 'save_return_draft', 'post_return', 'correct_sj', 'correct_report', 'correct_return', 'resolve_undelivered', 'close_co'];
export const impactKinds = ['report', 'stock', 'revenue', 'credit', 'reopen', 'issue', 'missing_month'] as const;
export function record(v: unknown): Record<string, any> { if (!v || typeof v !== 'object' || Array.isArray(v))
    invalid('object'); return v as Record<string, any>; }
export function parseText(v: unknown): string { if (typeof v !== 'string')
    invalid('text'); return v; }
export function parseUUID(v: unknown): string { if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v))
    invalid('UUID'); return v; }
export function parseQuantity(v: unknown): Quantity { if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v))
    invalid('quantity'); return v as Quantity; }
export function parseSignedQuantity(v: unknown): SignedQuantity { if (typeof v !== 'string' || !/^(0|-?[1-9][0-9]*)$/.test(v))
    invalid('signed quantity'); return v as SignedQuantity; }
export function parseVersion(v: unknown): Version { const x = parseQuantity(v); if (BigInt(x) < 1n || BigInt(x) > 9223372036854775807n)
    invalid('version'); return x as unknown as Version; }
export function parseMoney(v: unknown): Money { if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(v))
    invalid('money'); return v as Money; }
export function parseSignedMoney(v: unknown): SignedMoney { if (typeof v !== 'string' || !/^-?(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(v))
    invalid('signed money'); return v as SignedMoney; }
export function minorUnits(v: string): bigint { parseSignedMoney(v); const negative = v.startsWith('-'); const [a, b = ''] = v.replace(/^-/, '').split('.'); return BigInt(a + b.padEnd(2, '0')) * (negative ? -1n : 1n); }
export function parseDate(v: unknown): string { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v)
    invalid('date'); return v; }
export function parseMonth(v: unknown): string { const x = parseDate(v); if (!x.endsWith('-01'))
    invalid('month'); return x; }
export function parseTimestamp(v: unknown): string { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v) || !Number.isFinite(Date.parse(v)))
    invalid('timestamp'); parseDate(v.slice(0, 10)); return v; }
export function parseHash(v: unknown): string { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
    invalid('fingerprint'); return v; }
export function parseBoolean(v: unknown): boolean { if (typeof v !== 'boolean')
    invalid('boolean'); return v; }
export function parseSafeCount(v: unknown): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    invalid('integer'); return v; }
export function parseEnteredQuantity(v: unknown, allowZero = false): number { const n = parseSafeCount(v); if (n < (allowZero ? 0 : 1) || n > 2147483647)
    invalid('entered quantity'); return n; }
export function quantityForInput(v: unknown, allowZero = false): number { const x = BigInt(parseQuantity(v)); if (x > 2147483647n || x < (allowZero ? 0n : 1n))
    invalid('input quantity'); return Number(x); }
export const oneOf = <const T extends readonly string[]>(values: T) => (v: unknown): T[number] => { const s = parseText(v); if (!values.includes(s))
    invalid('enum'); return s; };
export const nullable = <T>(parse: (v: unknown) => T) => (v: unknown): T | null => v === null ? null : parse(v);
export const optional = <T>(parse: (v: unknown) => T) => (v: unknown): T | undefined => v === undefined ? undefined : parse(v);
type Parser = (v: unknown) => unknown;
export const shape = <T extends Record<string, Parser>>(fields: T) => (v: unknown): {
    [K in keyof T]: ReturnType<T[K]>;
} => { const o = record(v); for (const [key, parse] of Object.entries(fields)) {
    try {
        parse(o[key]);
    }
    catch {
        invalid(key);
    }
} return o as {
    [K in keyof T]: ReturnType<T[K]>;
}; };
export function list(parse: Parser, max = 100) { return (v: unknown) => { if (!Array.isArray(v) || v.length > max)
    invalid('array'); v.forEach(parse); return v; }; }
const uuid = parseUUID, q = parseQuantity, sq = parseSignedQuantity, ver = parseVersion, money = parseMoney, sm = parseSignedMoney, t = parseText, dt = parseDate, month = parseMonth, ts = parseTimestamp, b = parseBoolean, n = parseSafeCount, nu = nullable(uuid), nv = nullable(ver), nt = nullable(t), nd = nullable(dt), nm = nullable(month), hash = parseHash, nh = nullable(hash), ref = (v: unknown) => { const x = t(v); if (!x || x.length > 500)
    invalid('reference'); return x; };
export function parseCOReceipt(v: unknown): COReceipt { const o = shape({ id: uuid, operation: oneOf(operations), version: ver, customer_id: uuid, customer_version: ver })(v); if (Object.keys(o).length !== 5)
    invalid('receipt fields'); return { id: o.id, operation: o.operation as COOperation, version: o.version, customer_id: o.customer_id, customer_version: o.customer_version }; }
const reportingFreshness = shape({
    cutoff_date: dt,
    next_required_report_month: nm,
    pending_report_month_count: q,
    overdue_report_month_count: q,
    next_required_month_end: nd,
    days_since_pending_month_end: nullable(q),
    status: oneOf(['no_recorded_activity', 'complete', 'missing_completed_period', 'current_unreported', 'current_partial']),
    zero_stock_reporting_pending: b,
});
function checkReportingFreshness(value: unknown) {
    const f = reportingFreshness(value);
    const pending = BigInt(f.pending_report_month_count);
    const overdue = BigInt(f.overdue_report_month_count);
    if (overdue > pending) invalid('reporting counts');
    if (pending === 0n) {
        if (f.next_required_report_month !== null || f.next_required_month_end !== null
            || f.days_since_pending_month_end !== null || overdue !== 0n || f.zero_stock_reporting_pending
            || !['complete', 'no_recorded_activity'].includes(f.status)) {
            invalid('complete reporting freshness');
        }
        return f;
    }
    if (f.next_required_report_month === null || f.next_required_month_end === null
        || f.days_since_pending_month_end === null || f.next_required_report_month > f.cutoff_date) {
        invalid('pending reporting freshness');
    }
    const ending = new Date(`${f.next_required_report_month}T00:00:00Z`);
    ending.setUTCMonth(ending.getUTCMonth() + 1);
    ending.setUTCDate(0);
    const elapsed = Math.max(0, (Date.parse(f.cutoff_date) - ending.getTime()) / 86400000);
    if (ending.toISOString().slice(0, 10) !== f.next_required_month_end
        || String(elapsed) !== f.days_since_pending_month_end) {
        invalid('reporting calendar binding');
    }
    if (overdue > 0n) {
        if (f.status !== 'missing_completed_period' || f.next_required_month_end > f.cutoff_date) {
            invalid('completed reporting period');
        }
    } else if (pending !== 1n || f.next_required_month_end <= f.cutoff_date
        || !['current_unreported', 'current_partial'].includes(f.status)) {
        invalid('current reporting period');
    }
    return f;
}
const credit = { sales_person_name: nullable(t), sales_person_id_at_creation: nu, sales_assignment_source_id: nu, sales_attributed_at: ts, sales_attribution_state: oneOf(['assigned', 'unassigned']) };
function creditCheck(v: Record<string, any>) { if (v.sales_attribution_state === 'assigned' ? (v.sales_person_id_at_creation === null || v.sales_assignment_source_id === null) : (v.sales_person_id_at_creation !== null || v.sales_assignment_source_id !== null))
    invalid('credit binding'); }
const summary = shape({ ordered_quantity: q, delivered_quantity: q, resolved_undelivered_quantity: q, pending_quantity: q, delivery_progress: oneOf(['not_started', 'partial', 'complete']), planned_value: money, sold_quantity: q, revenue: money, returned_quantity: q, remaining_quantity: q });
const co = shape({ reporting_freshness: checkReportingFreshness, id: uuid, customer_id: uuid, customer_name: t, co_number: t, status: oneOf(['active', 'closed', 'cancelled']), order_date: dt, expected_delivery_date: nd, notes: nt, co_version: ver, customer_version: ver, generation_id: nu, ...credit, summary, last_report_month: nm, coverage_through_date: nd });
const stockEquation = { opening_quantity: q, delivered_quantity: q, sold_quantity: q, returned_quantity: q, recorded_quantity: q };
function checkStockEquation(v: Record<string, any>) { if (BigInt(v.opening_quantity) + BigInt(v.delivered_quantity) - BigInt(v.sold_quantity) - BigInt(v.returned_quantity) !== BigInt(v.recorded_quantity))
    invalid('stock equation'); }
const stock = shape({ reporting_freshness: checkReportingFreshness, ...stockEquation, generation_id: nu, id: uuid, customer_id: uuid, customer_version: ver, normalized_sku: t, display_sku: t, product_id: nu, product_name: t, recorded_quantity: q, has_delivery_history: b, last_report_month: nm, coverage_through_date: nd });
const line = shape({ id: uuid, co_id: uuid, customer_id: uuid, stock_key_id: uuid, display_sku: t, product_name: t, product_id: nu, ordered_quantity: q, resolved_undelivered_quantity: q, delivered_quantity: q, pending_quantity: q, unit_price: money, removable: b });
const sj = shape({ id: uuid, co_id: uuid, customer_id: uuid, draft_version: ver, mode: oneOf(['new_delivery', 'delivery_correction']), sj_number: t, sj_date: dt, received_date: nd, notes: nt, bound_co_version: ver, bound_customer_version: ver, bound_delivery_head_id: nu, bound_delivery_revision_id: nu, bound_delivery_version: nv, posted_delivery_head_id: nu, line_count: q, consumed: b, bindings_current: b, preparation_ready: b });
const sjLine = shape({ id: uuid, co_line_id: uuid, co_id: uuid, customer_id: uuid, draft_id: uuid, source_available: b, source_issue: nullable(oneOf(['CO_SJ_SOURCE_UNAVAILABLE'])), stock_key_id: nu, display_sku: nt, product_name: nt, unit_price: nullable(money), quantity: q });
const delivery = shape({ id: uuid, head_id: uuid, customer_id: uuid, co_id: uuid, head_version: ver, revision_no: ver, current_revision_id: uuid, sj_number: t, sj_date: dt, received_date: nd, notes: nt, is_void: b, reason: nt, created_at: ts, line_count: q, is_effective: b });
const sourceLine = shape({ id: uuid, revision_id: uuid, customer_id: uuid, co_id: uuid, co_line_id: uuid, stock_key_id: uuid, batch_id: uuid, quantity: q, unit_price: money, display_sku: t, product_name: t });
const contextLink = shape({ operation: oneOf(['post_sj', 'post_return', 'correct_sj', 'correct_report', 'correct_return']), target_id: nu, draft_id: nu, original_revision_id: nu, expected_source_version: nv, expected_co_version: nv, expected_customer_version: ver, expected_draft_version: nv });
const report = shape({ reporting_freshness: checkReportingFreshness, generation_id: nu, source_context_link: nullable(contextLink), id: ref, customer_id: uuid, customer_name: t, report_month: month, status: oneOf(['draft', 'posted']), draft_id: nu, report_head_id: nu, revision_id: nu, draft_version: nv, report_version: nv, customer_version: ver, coverage_through_date: dt, is_partial_month: b, report_reference: nt, received_date: nd, notes: nt, row_count: q, entered_count: q, missing_count: q, sold_quantity: q, revenue: nullable(money), complete: b, eligible_set_fingerprint: nh, source_context_fingerprint: nh, context_issue: nt, consumed: b });
const returnHeader = shape({ id: uuid, customer_id: uuid, target_kind: oneOf(['draft', 'revision']), draft_version: nv, head_id: nu, head_version: nv, revision_id: nu, revision_no: nv, return_date: dt, reference: nt, reason: nt, notes: nt, consumed: b, bound_customer_version: nv, bindings_current: b, line_count: q, is_void: optional(b) });
const returnLine = shape({ id: uuid, customer_id: uuid, co_id: uuid, co_number: t, co_line_id: uuid, stock_key_id: uuid, batch_id: uuid, revision_id: nu, draft_id: nu, quantity: q, unit_price: money, display_sku: t, product_name: t });
const returnRow = shape({ id: uuid, head_id: uuid, customer_id: uuid, head_version: ver, revision_no: ver, current_revision_id: uuid, return_date: dt, reference: nt, notes: nt, reason: nt, is_void: b, created_at: ts, line_count: q, is_effective: b });
const batch = shape({ id: uuid, customer_id: uuid, co_id: uuid, co_number: t, co_line_id: uuid, stock_key_id: uuid, delivery_head_id: uuid, delivery_revision_id: uuid, sj_number: t, sj_date: dt, display_sku: t, product_name: t, available_quantity: q, unit_price: money, ...credit });
const audit = shape({ id: uuid, customer_id: uuid, actor_id: uuid, request_id: nu, operation: t, reason: nt, created_at: ts, delivery_revision_id: nu, report_revision_id: nu, return_revision_id: nu, generation_id: nu });
const change = shape({ id: ref, audit_id: uuid, side: oneOf(['before', 'after']), path: t, value: nt });
const allocation = shape({ id: uuid, customer_id: uuid, report_revision_id: uuid, report_month: month, stock_key_id: uuid, batch_id: uuid, co_id: uuid, co_number: t, co_line_id: uuid, delivery_head_id: uuid, delivery_revision_id: uuid, sj_number: t, sj_date: dt, quantity: q, unit_price: money, amount: money, ...credit });
const previewAllocation = shape({ allocation_ref: ref, report_ref: ref, report_line_ref: ref, report_month: month, stock_key_id: uuid, source_batch_ref: ref, delivery_ref: ref, source_state: oneOf(['posted', 'proposed']), batch_id: nu, delivery_head_id: nu, delivery_revision_id: nu, co_id: uuid, co_number: t, co_line_id: uuid, sj_number: t, sj_date: dt, quantity: q, unit_price: money, amount: money, ...credit });
const reportLine = shape({ id: uuid, stock_key_id: uuid, customer_id: uuid, report_month: month, display_sku: t, product_name: t, product_id: nu, sold_quantity: nullable(q), eligible_quantity: nullable(sq), revision_line_id: nu });
const movement = shape({ id: uuid, customer_id: uuid, stock_key_id: uuid, generation_id: uuid, batch_id: uuid, co_id: uuid, co_line_id: uuid, kind: oneOf(['delivery', 'return', 'sold']), quantity_delta: sq, effective_date: dt, delivery_revision_line_id: nu, return_revision_line_id: nu, report_revision_line_id: nu });
const planSummary = shape({ sold_quantity: q, revenue: money, remaining_quantity: sq, complete: b });
const impactSchemas: Record<string, Parser> = { report: shape({ ref, head_id: nu, revision_id: nu, month, coverage: dt, is_partial_month: b, report_reference: nt, received_date: nd, notes: nt, row_count: q, before_sold_quantity: q, after_sold_quantity: q, before_revenue: money, after_revenue: money, complete: b }), stock: shape({ stock_key_id: uuid, batch_id: uuid, before_quantity: sq, after_quantity: sq }), revenue: shape({ report_month: month, before_amount: sm, after_amount: sm }), credit: shape({ report_month: month, sales_person_id_at_creation: nu, before_amount: sm, after_amount: sm }), reopen: shape({ co_id: uuid, remaining_quantity: q, expected_co_version: optional(ver), pending_quantity: optional(q), missing_month_count: optional(q) }), issue: shape({ code: oneOf(['CO_REPORT_INCOMPLETE', 'CO_SOLD_EXCEEDS_ELIGIBLE', 'CO_SOURCE_STOCK_NEGATIVE', 'CO_REPORT_REVISION_REQUIRED', 'CO_FUTURE_REPORT_MONTH', 'CO_FUTURE_RECEIVED_DATE', 'CO_CORRECTION_REASON_REQUIRED', 'CO_MISSING_REQUIRED_MONTH', 'CO_PARTIAL_MONTH_INCOMPLETE', 'CO_REOPEN_REQUIRED', 'CO_REVIEWED_CORRECTION_REQUIRED']), report_month: optional(month), stock_key_id: optional(uuid), batch_id: optional(uuid), co_id: optional(uuid), date: optional(dt), sold_quantity: optional(q), eligible_quantity: optional(sq) }), missing_month: shape({ report_month: month, reason: oneOf(['missing', 'partial_coverage']), head_id: nu, coverage_through_date: nd }) };
export const sections = { lines: line, deliveries: delivery, delivery_lines: sourceLine, reports: report, returns: returnRow, return_lines: sourceLine, return_drafts: returnHeader, audit, audit_changes: change, available_batches: batch, sj_drafts: sj, sj_draft_lines: sjLine } as const;
export type COSection = keyof typeof sections;
export const readNames = ['pilot_co_customer_stock_v2', 'pilot_co_page_v2', 'pilot_co_page_v1', 'pilot_co_detail_v1', 'pilot_co_detail_section_v1', 'pilot_co_reports_page_v1', 'pilot_co_report_months_v1', 'pilot_co_report_v1', 'pilot_co_report_rows_v1', 'pilot_co_report_allocations_v1', 'pilot_co_customer_stock_v1', 'pilot_co_stock_movements_v1', 'pilot_co_customer_batches_v1', 'pilot_co_preview_v1', 'pilot_co_preview_impacts_v1', 'pilot_co_preview_allocations_v1', 'pilot_co_return_v1'] as const;
export type COReadName = typeof readNames[number];
export type COReadPage = {
    version: '1';
    as_of: string;
    total: Quantity;
    page: number;
    page_size: number;
    rows: Record<string, any>[];
    [key: string]: any;
};
export type COReadResult = Record<string, any>;
export function decodeCORead(name: COReadName, args: Record<string, any>, data: unknown): COReadResult {
    if (name === 'pilot_co_customer_stock_v2') return decodeCOStockV2(args, data);
    if (name === 'pilot_co_page_v2') return decodeCOOrdersV2(args, data);
    const v = record(data);
    if (v.version !== '1')
        invalid('contract version');
    ts(v.as_of);
    let row: Parser | undefined;
    switch (name) {
        case 'pilot_co_page_v1':
            row = co;
            shape({ customer_id: nu, summary: shape({ order_count: q, planned_value: money, revenue: money, remaining_quantity: q }) })(v);
            break;
        case 'pilot_co_detail_v1':
            co(v.co);
            list(oneOf(operations), 14)(v.allowed_operations);
            if (new Set(v.allowed_operations).size !== v.allowed_operations.length)
                invalid('operations');
            shape({ stock_remains: b, undelivered_remains: b, missing_month_count: q })(v.close_blockers);
            break;
        case 'pilot_co_detail_section_v1':
            oneOf(Object.keys(sections))(v.section);
            shape({ co_id: uuid, customer_id: uuid, co_version: ver, customer_version: ver, parent_id: nu, draft_id: optional(uuid), draft_version: optional(ver) })(v);
            row = sections[v.section as COSection];
            if (v.section !== args.p_section || v.parent_id !== args.p_parent_id) {
                invalid('section');
            }
            if (v.section === 'sj_draft_lines') {
                uuid(v.draft_id);
                ver(v.draft_version);
                if (v.draft_id !== args.p_parent_id || v.draft_version !== args.p_expected_draft_version) {
                    invalid('draft binding');
                }
            }
            break;
        case 'pilot_co_customer_stock_v1':
            row = stock;
            shape({ customer_id: nu, customer_version: nv, generation_id: nu, stock_as_of: nd, normalized_search: t, reporting_freshness: nullable(checkReportingFreshness), period_start: month, coverage_date: dt, summary: shape(stockEquation) })(v);
            break;
        case 'pilot_co_customer_batches_v1':
            row = batch;
            shape({ customer_id: uuid, customer_version: ver, stock_key_id: nu, generation_id: nu })(v);
            break;
        case 'pilot_co_reports_page_v1':
            row = report;
            shape({ customer_id: nu, report_month: nm, status: oneOf(['all', 'draft', 'posted']) })(v);
            break;
        case 'pilot_co_report_v1':
            shape({ customer_id: uuid, customer_version: ver, generation_id: nu, report_month: month, reporting_freshness: checkReportingFreshness, draft: nullable(report), effective: nullable(report), last_report_month: nm, coverage_through_date: nd })(v);
            break;
        case 'pilot_co_report_months_v1':
            shape({ customer_id: uuid, customer_version: ver, first_month: nm, last_month: nm, reporting_freshness: checkReportingFreshness, last_report_month: nm, coverage_through_date: nd })(v);
            break;
        case 'pilot_co_return_v1':
            row = returnLine;
            shape({ customer_id: uuid, customer_version: ver, target_id: uuid, view: oneOf(['draft', 'effective', 'revision']), draft_version: nv, header: returnHeader })(v);
            if (v.view !== args.p_view || v.target_id !== args.p_target_id || v.header.customer_id !== v.customer_id)
                invalid('return target');
            if (v.view === 'draft' && (v.header.id !== v.target_id || v.header.draft_version !== v.draft_version) || v.view === 'effective' && v.header.head_id !== v.target_id || v.view === 'revision' && v.header.revision_id !== v.target_id)
                invalid('return identity');
            break;
        case 'pilot_co_report_rows_v1':
            row = reportLine;
            shape({ customer_id: uuid, customer_version: ver, report_month: month, view: oneOf(['draft', 'effective', 'revision']), generation_id: nu, source_context_link: nullable(contextLink), draft_id: nu, draft_version: nv, revision_id: nu, eligible_set_fingerprint: nh, source_context_fingerprint: nh, context_issue: nt })(v);
            if (v.view !== args.p_view)
                invalid('view');
            if (v.view === 'draft' ? (!v.draft_id || !v.draft_version || v.revision_id !== null)
                : (v.draft_id !== null || v.draft_version !== null || !v.revision_id || v.eligible_set_fingerprint !== null
                    || v.source_context_link !== null || v.source_context_fingerprint !== null || v.context_issue !== null))
                invalid('report row identity');
            break;
        case 'pilot_co_report_allocations_v1':
            row = allocation;
            shape({ customer_id: uuid, customer_version: ver, report_month: month, revision_id: uuid, generation_id: nu, is_effective: b, summary: shape({ quantity: q, amount: money }) })(v);
            break;
        case 'pilot_co_stock_movements_v1':
            row = movement;
            shape({ customer_id: uuid, customer_version: ver, stock_key_id: uuid, generation_id: nu, stock_as_of: nd })(v);
            break;
        case 'pilot_co_preview_v1':
            shape({ operation: oneOf(['post_report', 'post_sj', 'post_return', 'correct_sj', 'correct_report', 'correct_return']), customer_id: uuid, customer_version: ver, draft_version: nv, preview_fingerprint: hash, source_context_fingerprint: optional(hash), can_post: b, before: planSummary, after: planSummary, counts: shape(Object.fromEntries(impactKinds.map(k => [k, q]))) })(v);
            if (Object.keys(v.counts).sort().join() !== [...impactKinds].sort().join() || ['rows', 'allocations', 'issues', 'impacts'].some(k => k in v))
                invalid('bounded preview');
            break;
        case 'pilot_co_preview_impacts_v1':
            oneOf(impactKinds)(v.kind);
            hash(v.preview_fingerprint);
            if (v.kind !== args.p_kind)
                invalid('impact kind');
            row = impactSchemas[v.kind];
            break;
        case 'pilot_co_preview_allocations_v1':
            row = previewAllocation;
            shape({ operation: oneOf(operations), customer_id: uuid, customer_version: ver, preview_fingerprint: hash, report_month: month, report_ref: ref, stock_key_id: nu, selected_row: nullable(shape({ stock_key_id: uuid, sold_quantity: nullable(q) })), can_post: b, report_complete: b })(v);
            break;
        default: invalid('RPC');
    }
    for (const [arg, field] of [['p_customer_id', 'customer_id'], ['p_co_id', 'co_id'], ['p_month', 'report_month'], ['p_report_month', 'report_month'], ['p_stock_key_id', 'stock_key_id'], ['p_expected_customer_version', 'customer_version'], ['p_expected_draft_version', 'draft_version'], ['p_revision_id', 'revision_id'], ['p_preview_fingerprint', 'preview_fingerprint'], ['p_operation', 'operation']] as const) {
        // These two existing envelopes deliberately put identity elsewhere.
        const indirect = name === 'pilot_co_detail_v1' && arg === 'p_co_id'
            || name === 'pilot_co_preview_impacts_v1' && arg === 'p_operation';
        const requested = args[arg] != null
            || ['p_customer_id', 'p_month', 'p_stock_key_id'].includes(arg) && args[arg] === null;
        if (!indirect && requested && v[field] !== args[arg]) {
            invalid(field);
        }
    }
    if (name === 'pilot_co_preview_v1' || name === 'pilot_co_preview_allocations_v1') {
        const payload = record(args.p_payload);
        if (v.customer_version !== ver(payload.expected_customer_version)) {
            invalid('preview customer version');
        }
        if (payload.customer_id !== undefined && v.customer_id !== uuid(payload.customer_id)) {
            invalid('preview customer identity');
        }
        // Allocation pages bind the entire request by the checked fingerprint;
        // only the existing preview header also exposes the primary draft version.
        if (name === 'pilot_co_preview_v1') {
            const hasDraft = ['post_report', 'post_sj', 'post_return', 'correct_report'].includes(v.operation)
                || v.operation === 'correct_sj' && payload.action === 'replace';
            if (hasDraft) {
                uuid(payload.draft_id);
                if (v.draft_version !== ver(payload.expected_draft_version)) {
                    invalid('preview draft version');
                }
            } else if (v.draft_version !== null) {
                invalid('unexpected preview draft');
            }
        }
    }
    if (args.p_expected_version != null && (v.co?.co_version ?? v.co_version) !== args.p_expected_version)
        invalid('CO version');
    if (args.p_co_id != null && v.co && v.co.id !== args.p_co_id)
        invalid('CO identity');
    if ('p_as_of' in args && v.stock_as_of !== args.p_as_of)
        invalid('stock date');
    if (row) {
        const total = BigInt(q(v.total));
        n(v.page);
        n(v.page_size);
        if (v.page !== args.p_page || v.page_size !== args.p_page_size || v.page < 1 || v.page_size < 1 || v.page_size > 100)
            invalid('page');
        const offset = BigInt(v.page - 1) * BigInt(v.page_size), expected = total <= offset ? 0n : (total - offset < BigInt(v.page_size) ? total - offset : BigInt(v.page_size));
        list(row, 100)(v.rows);
        if (BigInt(v.rows.length) !== expected)
            invalid('page completeness');
        const seen = new Set<string>();
        for (const r of v.rows) {
            const identity = r.id ?? r.allocation_ref ?? r.ref ?? (v.kind === 'stock' ? `${r.stock_key_id}:${r.batch_id}` : v.kind === 'credit' ? `${r.report_month}:${r.sales_person_id_at_creation}` : v.kind === 'issue' ? JSON.stringify(r) : r.report_month ?? r.co_id);
            if (typeof identity !== 'string' || seen.has(identity))
                invalid('duplicate row');
            seen.add(identity);
            if (v.customer_id && r.customer_id !== undefined && r.customer_id !== v.customer_id)
                invalid('foreign customer');
            if (v.co_id && r.co_id !== undefined && r.co_id !== v.co_id)
                invalid('foreign CO');
            if (v.report_month && r.report_month !== undefined && r.report_month !== v.report_month)
                invalid('foreign month');
            if (args.p_stock_key_id && r.stock_key_id !== args.p_stock_key_id)
                invalid('foreign key');
            if (v.customer_version && r.customer_version && r.customer_version !== v.customer_version)
                invalid('row version');
            if (r.sales_attribution_state)
                creditCheck(r);
            if (r.amount !== undefined && minorUnits(r.amount) !== minorUnits(r.unit_price) * BigInt(r.quantity))
                invalid('allocation amount');
            if (r.entered_count !== undefined && (BigInt(r.entered_count) + BigInt(r.missing_count) !== BigInt(r.row_count) || r.complete !== (r.missing_count === '0')))
                invalid('completeness totals');
            if (v.section === 'sj_drafts') {
                const correction = r.mode === 'delivery_correction';
                if (correction !== !!r.bound_delivery_head_id || correction !== !!r.bound_delivery_revision_id || correction !== !!r.bound_delivery_version)
                    invalid('draft mode');
            }
            if (v.section === 'sj_draft_lines' && (r.draft_id !== v.draft_id || v.draft_id !== args.p_parent_id))
                invalid('draft identity');
            if (name === 'pilot_co_preview_allocations_v1' && r.report_ref !== v.report_ref)
                invalid('report reference');
            if (name === 'pilot_co_preview_allocations_v1' && r.source_state === 'posted' && (!r.batch_id || !r.delivery_head_id || !r.delivery_revision_id))
                invalid('posted source');
        }
    }
    if (v.co)
        creditCheck(v.co);
    if (name === 'pilot_co_preview_allocations_v1') {
        if (args.p_stock_key_id === null) {
            if (v.selected_row !== null) invalid('unfiltered allocation selection');
        } else {
            if (v.selected_row === null || v.selected_row.stock_key_id !== args.p_stock_key_id) {
                invalid('selected report key');
            }
            if (v.selected_row.sold_quantity === null && v.report_complete) {
                invalid('unanswered report selection');
            }
            if (v.selected_row.sold_quantity === '0' && v.total !== '0') {
                invalid('zero report allocation');
            }
        }
    }
    if (name === 'pilot_co_report_allocations_v1') {
        let quantity = 0n, amount = 0n;
        for (const r of v.rows) {
            if (r.report_revision_id !== v.revision_id)
                invalid('allocation revision');
            quantity += BigInt(r.quantity);
            amount += minorUnits(r.amount);
        }
        if (quantity > BigInt(v.summary.quantity) || amount > minorUnits(v.summary.amount) || v.total === String(v.rows.length) && (quantity !== BigInt(v.summary.quantity) || amount !== minorUnits(v.summary.amount)))
            invalid('allocation summary');
    }
    if (name === 'pilot_co_return_v1') {
        if (v.header.target_kind !== (v.view === 'draft' ? 'draft' : 'revision') || v.header.line_count !== v.total)
            invalid('return header binding');
        for (const r of v.rows)
            if (r.draft_id !== (v.view === 'draft' ? v.target_id : null) || r.revision_id !== v.header.revision_id)
                invalid('return line binding');
    }
    if (v.section === 'delivery_lines' || v.section === 'return_lines')
        for (const r of v.rows)
            if (r.revision_id !== v.parent_id)
                invalid('source revision');
    if (v.section === 'audit_changes')
        for (const r of v.rows)
            if (r.audit_id !== v.parent_id)
                invalid('audit identity');
    if (name === 'pilot_co_customer_stock_v1' && v.customer_id || name === 'pilot_co_stock_movements_v1') {
        for (const r of v.rows)
            if (r.generation_id !== v.generation_id)
                invalid('generation binding');
    }
    if (v.section === 'sj_draft_lines')
        for (const r of v.rows) {
            if (r.id !== r.co_line_id)
                invalid('saved line identity');
            if (r.source_available) {
                if (r.source_issue !== null || [r.stock_key_id, r.display_sku, r.product_name, r.unit_price].some(x => x === null))
                    invalid('available source bindings');
            }
            else if (r.source_issue !== 'CO_SJ_SOURCE_UNAVAILABLE' || [r.stock_key_id, r.display_sku, r.product_name, r.unit_price].some(x => x !== null))
                invalid('unavailable source bindings');
        }
    if (name === 'pilot_co_page_v1' && v.summary.order_count !== v.total)
        invalid('order count summary');
    if (name === 'pilot_co_customer_stock_v1') {
        if (v.customer_id !== null) {
            checkReportingFreshness(v.reporting_freshness);
            if (v.reporting_freshness.cutoff_date !== v.coverage_date) {
                invalid('customer reporting cutoff');
            }
        } else if (v.reporting_freshness !== null) {
            invalid('all-customer reporting scope');
        }
        for (const r of v.rows) {
            if (r.reporting_freshness.cutoff_date !== v.coverage_date
                || v.customer_id !== null && Object.keys(v.reporting_freshness).some(key => r.reporting_freshness[key] !== v.reporting_freshness[key])) {
                invalid('row reporting freshness');
            }
        }
        checkStockEquation(v.summary);
        for (const r of v.rows)
            checkStockEquation(r);
        for (const k of Object.keys(stockEquation)) {
            const pageSum = v.rows.reduce((sum: bigint, r: Record<string, any>) => sum + BigInt(r[k]), 0n);
            const summarySum = BigInt(v.summary[k]);
            const complete = v.total === String(v.rows.length);
            if (pageSum > summarySum || complete && pageSum !== summarySum) {
                invalid('stock summary');
            }
        }
        if (v.period_start !== v.coverage_date.slice(0, 7) + '-01' || v.stock_as_of !== null && v.coverage_date !== v.stock_as_of)
            invalid('stock period');
    }
    for (const h of [v.draft, v.effective].filter(Boolean)) {
        if (h.customer_id !== v.customer_id || h.report_month !== v.report_month || h.customer_version !== v.customer_version)
            invalid('report header scope');
        if (BigInt(h.entered_count) + BigInt(h.missing_count) !== BigInt(h.row_count) || h.complete !== (h.missing_count === '0'))
            invalid('report header counts');
    }
    for (const o of [v.co, ...(name === 'pilot_co_page_v1' ? v.rows : [])].filter(Boolean)) {
        const s = o.summary;
        if (BigInt(s.delivered_quantity) + BigInt(s.resolved_undelivered_quantity) + BigInt(s.pending_quantity) !== BigInt(s.ordered_quantity) || BigInt(s.delivered_quantity) - BigInt(s.sold_quantity) - BigInt(s.returned_quantity) !== BigInt(s.remaining_quantity))
            invalid('order equation');
    }
    return v;
}
/** Runtime schemas above are the authoritative field definitions for these UI records. */
export type COOrderRecord = ReturnType<typeof co>;
export type COStockRecord = ReturnType<typeof stock>;
export type COOrderLine = ReturnType<typeof line>;
export type COSJDraftHeader = ReturnType<typeof sj>;
export type COSJDraftLine = ReturnType<typeof sjLine>;
export type CODeliveryRevision = ReturnType<typeof delivery>;
export type COReportHeader = ReturnType<typeof report>;
export type COReportRow = ReturnType<typeof reportLine>;
export type COSourceBatch = ReturnType<typeof batch>;
export type COReturnHeader = ReturnType<typeof returnHeader>;
export type COReturnLine = ReturnType<typeof returnLine>;
export type COAllocation = ReturnType<typeof allocation>;
export type COPreviewAllocation = ReturnType<typeof previewAllocation>;
export type COStockMovement = ReturnType<typeof movement>;
export type COAuditEntry = ReturnType<typeof audit>;

export type COReportingFreshness = ReturnType<typeof reportingFreshness>;

// Additive v2 boundaries: exact envelopes, no v1 relaxation or implicit totals.
function exactRead(value: unknown, fields: readonly string[]): Record<string, any> {
    const v = record(value);
    if (Object.keys(v).length !== fields.length || fields.some(k => !Object.hasOwn(v, k))) invalid('v2 fields');
    return v;
}
/** Match SQL btrim(text), not browser-locale normalization or an inferred SKU. */
function normalizedReadText(value: unknown): string { return parseText(value).replace(/^ +| +$/g, '').toLowerCase(); }
export function validateCOStockV2Args(a: Record<string, any>): void {
    nullable(parseUUID)(a.p_customer_id);
    if (a.p_sku !== null && !normalizedReadText(a.p_sku)) invalid('exact SKU');
    parseText(a.p_search);
    if (a.p_as_of !== null) {
        const date = parseDate(a.p_as_of), end = new Date(`${date}T00:00:00Z`);
        end.setUTCMonth(end.getUTCMonth() + 1, 0);
        if (end.toISOString().slice(0,10) !== date) invalid('completed month end');
    }
    oneOf(['sku','customer','balance'])(a.p_sort); oneOf(['asc','desc'])(a.p_direction);
    if (parseSafeCount(a.p_page) < 1 || ![25,50,100].includes(a.p_page_size)) invalid('stock page');
}
function checkedV2Page(v: Record<string, any>, a: Record<string, any>): void {
    if (v.version !== '2' || v.page !== a.p_page || v.page_size !== a.p_page_size) invalid('v2 page binding');
    parseTimestamp(v.as_of);
    const total = BigInt(parseQuantity(v.total)), offset = (BigInt(a.p_page)-1n)*BigInt(a.p_page_size);
    const expected = total <= offset ? 0n : total-offset < BigInt(a.p_page_size) ? total-offset : BigInt(a.p_page_size);
    if (!Array.isArray(v.rows) || BigInt(v.rows.length) !== expected) invalid('v2 page completeness');
}
function strictFreshness(value: unknown, cutoff: string) {
    exactRead(value,['cutoff_date','next_required_report_month','pending_report_month_count','overdue_report_month_count','next_required_month_end','days_since_pending_month_end','status','zero_stock_reporting_pending']);
    const f = checkReportingFreshness(value);
    if (f.cutoff_date !== cutoff) invalid('v2 freshness cutoff');
    return f;
}
// PostgreSQL C collation orders Unicode code points (not browser-localized labels).
function compareReadText(a: string, b: string): number {
    const aa=Array.from(a), bb=Array.from(b);
    for(let i=0;i<Math.min(aa.length,bb.length);i++) {
        const d=aa[i].codePointAt(0)!-bb[i].codePointAt(0)!; if(d) return d;
    }
    return aa.length-bb.length;
}
export function decodeCOStockV2(a: Record<string, any>, data: unknown): COStockPageV2 {
    validateCOStockV2Args(a);
    const v = exactRead(data,['version','as_of','customer_id','customer_version','generation_id','sku','normalized_search','stock_as_of','period_start','coverage_date','sort','direction','page','page_size','total','reporting_freshness','rows']);
    checkedV2Page(v,a);
    const statementDay = new Date(v.as_of).toISOString().slice(0,10);
    const cutoff = a.p_as_of ?? statementDay;
    if(v.customer_id !== a.p_customer_id || v.sku !== (a.p_sku===null ? null : normalizedReadText(a.p_sku)) || v.normalized_search !== normalizedReadText(a.p_search)
        || v.stock_as_of !== a.p_as_of || v.coverage_date !== cutoff || cutoff > statementDay || v.period_start !== `${cutoff.slice(0,7)}-01`
        || v.sort !== a.p_sort || v.direction !== a.p_direction) invalid('v2 stock binding');
    parseDate(v.coverage_date); parseMonth(v.period_start);
    nullable(parseVersion)(v.customer_version); nullable(parseUUID)(v.generation_id);
    if(v.customer_id===null) {
        if(v.customer_version!==null || v.generation_id!==null || v.reporting_freshness!==null) invalid('all-store binding');
    } else { parseVersion(v.customer_version); strictFreshness(v.reporting_freshness,cutoff); }
    const seen = new Set<string>(), declarations = new Set<string>(), customers = new Map<string,string>();
    let previous: COStockRowV2 | undefined;
    const rows: COStockRowV2[] = v.rows.map((value:unknown) => {
        const r = exactRead(value,['id','stock_key_id','customer_id','customer_name','customer_version','generation_id','normalized_sku','display_sku','product_id','product_name','unit','unit_basis','unit_declaration','opening_quantity','delivered_quantity','sold_quantity','returned_quantity','recorded_quantity','has_delivery_history','last_report_month','coverage_through_date','reporting_freshness','contract_stock_value','contract_currency','contract_unit_price','price_state','valuation_basis']);
        parseUUID(r.id); parseUUID(r.stock_key_id); parseUUID(r.customer_id); parseText(r.customer_name); parseVersion(r.customer_version); nullable(parseUUID)(r.generation_id);
        const key=`${r.customer_id}:${r.stock_key_id}`;
        if(r.id!==r.stock_key_id || seen.has(key) || (a.p_customer_id!==null && (r.customer_id!==v.customer_id || r.customer_version!==v.customer_version || r.generation_id!==v.generation_id))) invalid('v2 stock identity');
        seen.add(key);
        parseText(r.normalized_sku); parseText(r.display_sku); parseText(r.product_name); nullable(parseUUID)(r.product_id);
        if(!r.normalized_sku || r.normalized_sku!==normalizedReadText(r.display_sku) || (v.sku!==null && r.normalized_sku!==v.sku)
            || (v.normalized_search && !r.normalized_sku.includes(v.normalized_search) && !r.product_name.toLowerCase().includes(v.normalized_search))) invalid('v2 stock filter membership');
        Object.values(stockEquation).forEach((parse,i)=>parse(r[Object.keys(stockEquation)[i]])); checkStockEquation(r); parseBoolean(r.has_delivery_history);
        if((!r.has_delivery_history || r.generation_id===null) && Object.keys(stockEquation).some(k=>r[k]!=='0')) invalid('undelivered stock');
        nullable(parseMonth)(r.last_report_month); nullable(parseDate)(r.coverage_through_date);
        if((r.last_report_month===null)!==(r.coverage_through_date===null) || (r.coverage_through_date!==null && (r.coverage_through_date>cutoff || r.coverage_through_date.slice(0,7)!==r.last_report_month.slice(0,7)))) invalid('v2 report coverage');
        const f = strictFreshness(r.reporting_freshness,cutoff);
        const binding=JSON.stringify([r.customer_name,r.customer_version,r.generation_id,r.last_report_month,r.coverage_through_date,...Object.keys(f).sort().map(k=>f[k as keyof typeof f])]);
        if(customers.has(r.customer_id) && customers.get(r.customer_id)!==binding) invalid('v2 customer facts');
        customers.set(r.customer_id,binding);
        if(a.p_customer_id!==null && Object.keys(f).some(k=>f[k as keyof typeof f]!==v.reporting_freshness[k])) invalid('v2 selected freshness');
        nullable(parseText)(r.unit); oneOf(['unknown','declared_by_cutoff','declared_after_cutoff'])(r.unit_basis);
        if(r.unit_declaration===null) {
            if(r.unit!==null || r.unit_basis!=='unknown') invalid('missing declaration');
        } else {
            const d=exactRead(r.unit_declaration,['id','version','unit','declared_at']); parseUUID(d.id); parseVersion(d.version); parseText(d.unit); parseTimestamp(d.declared_at);
            if(d.version!=='1' || !d.unit || d.unit!==d.unit.trim() || d.unit.length>128 || /[\x00-\x1f\x7f]/.test(d.unit) || declarations.has(d.id) || Date.parse(d.declared_at)>Date.parse(v.as_of)) invalid('immutable declaration');
            declarations.add(d.id);
            const known = a.p_as_of===null || Date.parse(d.declared_at)<Date.parse(`${cutoff}T00:00:00Z`)+86400000;
            if(r.unit_basis!==(known?'declared_by_cutoff':'declared_after_cutoff') || r.unit!==(known?d.unit:null)) invalid('declaration cutoff provenance');
        }
        nullable(parseMoney)(r.contract_stock_value); nullable(parseMoney)(r.contract_unit_price); oneOf(['unknown','single','mixed'])(r.price_state);
        if(r.contract_stock_value===null) {
            if(r.contract_currency!==null || r.contract_unit_price!==null || r.price_state!=='unknown' || r.valuation_basis!==null) invalid('unavailable valuation');
        } else {
            if(r.unit===null || r.contract_currency!=='IDR' || r.valuation_basis!=='retained_co_batch') invalid('valuation basis');
            if(r.recorded_quantity==='0') {
                if(minorUnits(r.contract_stock_value)!==0n || r.price_state!=='unknown' || r.contract_unit_price!==null) invalid('zero surviving batches');
            } else if(r.price_state==='single') {
                if(r.contract_unit_price===null || minorUnits(r.contract_stock_value)!==BigInt(r.recorded_quantity)*minorUnits(r.contract_unit_price)) invalid('single retained price');
            } else if(r.price_state!=='mixed' || r.contract_unit_price!==null) invalid('mixed retained prices');
        }
        if(previous) {
            const comparison=a.p_sort==='balance' ? (BigInt(previous.recorded_quantity)<BigInt(r.recorded_quantity)?-1:BigInt(previous.recorded_quantity)>BigInt(r.recorded_quantity)?1:0)
                : compareReadText(a.p_sort==='sku'?previous.normalized_sku:previous.customer_name,a.p_sort==='sku'?r.normalized_sku:r.customer_name);
            const tie=compareReadText(previous.customer_id,r.customer_id)||compareReadText(previous.stock_key_id,r.stock_key_id);
            if(comparison*(a.p_direction==='asc'?1:-1)>0 || (comparison===0 && tie>=0)) invalid('v2 stock order');
        }
        previous=r as COStockRowV2;
        return r as COStockRowV2;
    });
    return {...v,rows} as COStockPageV2;
}
export function validateCOOrdersV2Args(a:Record<string,any>):void {
    nullable(parseUUID)(a.p_customer_id); parseText(a.p_search); oneOf(['all','active','closed','cancelled'])(a.p_status);
    oneOf(['order_date','co_number'])(a.p_sort); oneOf(['asc','desc'])(a.p_direction);
    if(parseSafeCount(a.p_page)<1 || parseSafeCount(a.p_page_size)<1 || a.p_page_size>100) invalid('order v2 page');
}
export function decodeCOOrdersV2(a:Record<string,any>,data:unknown):COReadResult {
    validateCOOrdersV2Args(a);
    const v=exactRead(data,['version','as_of','customer_id','status','normalized_search','sort','direction','page','page_size','total','rows']); checkedV2Page(v,a);
    if(v.customer_id!==a.p_customer_id || v.status!==a.p_status || v.normalized_search!==normalizedReadText(a.p_search) || v.sort!==a.p_sort || v.direction!==a.p_direction) invalid('order v2 binding');
    const seen=new Set<string>(); let previous:Record<string,any>|undefined;
    for(const r of v.rows) {
        exactRead(r,['id','customer_id','customer_name','co_number','status','order_date','expected_delivery_date','notes','co_version','customer_version','generation_id',...Object.keys(credit),'summary','last_report_month','coverage_through_date','reporting_freshness','sku_count']);
        co(r); creditCheck(r); parseQuantity(r.sku_count);
        exactRead(r.summary,['ordered_quantity','delivered_quantity','resolved_undelivered_quantity','pending_quantity','delivery_progress','planned_value','sold_quantity','revenue','returned_quantity','remaining_quantity']);
        const s=r.summary;
        if(BigInt(s.ordered_quantity)-BigInt(s.delivered_quantity)-BigInt(s.resolved_undelivered_quantity)!==BigInt(s.pending_quantity)
            || s.delivery_progress!==(s.pending_quantity==='0'?'complete':s.delivered_quantity==='0'?'not_started':'partial')) invalid('order v2 delivery progress');
        const cutoff=new Date(v.as_of).toISOString().slice(0,10);
        strictFreshness(r.reporting_freshness,cutoff);
        if((r.last_report_month===null)!==(r.coverage_through_date===null) || (r.coverage_through_date!==null && (r.coverage_through_date>cutoff || r.coverage_through_date.slice(0,7)!==r.last_report_month.slice(0,7)))) invalid('order v2 report coverage');
        if(seen.has(r.id) || (a.p_customer_id!==null && r.customer_id!==a.p_customer_id) || (a.p_status!=='all' && r.status!==a.p_status)
            || (v.normalized_search && !r.co_number.toLowerCase().includes(v.normalized_search) && !r.customer_name.toLowerCase().includes(v.normalized_search))) invalid('order v2 membership');
        seen.add(r.id);
        if(previous) {
            const comparison=compareReadText(previous[a.p_sort],r[a.p_sort]);
            if(comparison*(a.p_direction==='asc'?1:-1)>0 || (comparison===0 && compareReadText(previous.id,r.id)>=0)) invalid('order v2 sort');
        }
        previous=r;
    }
    return v;
}
