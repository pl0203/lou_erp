import React, { useEffect } from 'react';
import { transferableAbortController } from 'node:util';
import { vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
export const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
export const customer = id(2), draftId = id(3), month = '2026-09-01';
export const hash = 'a'.repeat(64), fingerprint = 'b'.repeat(64);
const wire = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), handler: null as any, actor: true, role: 'co_admin', guard: null as any }));
export { wire };
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: wire.rpc, functions: {invoke: wire.invoke} } }));
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: wire.actor ? { id: '00000000-0000-0000-0000-000000000001' } : null, profile: wire.actor ? { id: '00000000-0000-0000-0000-000000000001', role: wire.role, is_active: true } : null, loading: false, error: null }), useBeforeSignOut: (guard: any) => { useEffect(() => { wire.guard = guard; return () => { wire.guard = null; }; }, [guard]); } }));
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }));
vi.mock('../../src/lib/co/catalog', async (original) => ({ ...await original<any>(), fetchCOCustomers: async () => [{ id: customer, name: 'Store A', pricing_tier: 'others' }] }));
export const freshness = { cutoff_date: '2026-10-09', next_required_report_month: '2026-09-01', pending_report_month_count: '2', overdue_report_month_count: '1', next_required_month_end: '2026-09-30', days_since_pending_month_end: '9', status: 'missing_completed_period', zero_stock_reporting_pending: false };
export const row = (n = 1, sold: string | null = null, m = month) => ({ id: id(1000 + n), stock_key_id: id(1000 + n), customer_id: customer, report_month: m, display_sku: `SKU-${n}`, product_name: `Item ${n}`, product_id: null, sold_quantity: sold, eligible_quantity: '100', revision_line_id: null });
export function reportHeader(rows: any[], version = '1', m = month, extra: any = {}) { const missing = rows.filter(r => r.sold_quantity === null).length; return { reporting_freshness: freshness, generation_id: null, source_context_link: null, id: `draft:${draftId}`, customer_id: customer, customer_name: 'Store A', report_month: m, status: 'draft', draft_id: draftId, report_head_id: null, revision_id: null, draft_version: version, report_version: null, customer_version: '1', coverage_through_date: '2026-09-30', is_partial_month: false, report_reference: null, received_date: null, notes: null, row_count: String(rows.length), entered_count: String(rows.length - missing), missing_count: String(missing), sold_quantity: rows.reduce((s, r) => s + BigInt(r.sold_quantity ?? '0'), 0n).toString(), revenue: null, complete: missing === 0, eligible_set_fingerprint: hash, source_context_fingerprint: null, context_issue: null, consumed: false, ...extra }; }
export function store(count = 1, reportMonth = month, reportDraftId = draftId) {
    const month = reportMonth, draftId = reportDraftId;
    const s: any = { rows: Array.from({ length: count }, (_, i) => row(i + 1, null, month)), version: '1', cv: '1', draft: true, effective: null, metadata: {}, commands: [], receipt: null, previewCount: 0, fail: null, impacts: { report: [], stock: [], revenue: [], credit: [], reopen: [], issue: [], missing_month: [] }, allocations: [] };
    s.header = () => reportHeader(s.rows, s.version, month, { ...s.metadata, id: `draft:${draftId}`, draft_id: draftId, customer_version: s.cv });
    s.root = () => ({ version: '1', as_of: '2026-10-09T00:00:00Z', customer_id: customer, customer_version: s.cv, generation_id: null, report_month: month, reporting_freshness: freshness, draft: s.draft ? s.header() : null, effective: s.effective, last_report_month: null, coverage_through_date: null });
    s.handle = async (name: string, a: any) => {
        if (s.fail) {
            const failed = await s.fail(name, a);
            if (failed)
                return failed;
        }
        const root = { version: '1', as_of: '2026-10-09T00:00:00Z' };
        const page = (rows: any[]) => ({ ...root, page: a.p_page, page_size: a.p_page_size, total: String(rows.length), rows: rows.slice((a.p_page - 1) * a.p_page_size, a.p_page * a.p_page_size) });
        if (name === 'pilot_co_evidence_selection_v1') return { data: {version:'1',customer_id:customer,draft_id:a.p_draft_id, draft_version:a.p_expected_draft_version,revision_id:a.p_revision_id,evidence:null},error:null };
        if (name === 'pilot_my_profile')
            return { data: [{ id: id(1), role: wire.role, is_active: true }], error: null };
        if (name === 'pilot_co_report_v1')
            return { data: s.root(), error: null };
        if (name === 'pilot_co_report_months_v1')
            return { data: { ...root, customer_id: customer, customer_version: s.cv, first_month: month, last_month: '2026-10-01', reporting_freshness: freshness, last_report_month: null, coverage_through_date: null }, error: null };
        if (name === 'pilot_co_reports_page_v1')
            return { data: { ...page([s.header()]), customer_id: a.p_customer_id, report_month: a.p_month, status: a.p_status }, error: null };
        if (name === 'pilot_co_report_rows_v1')
            return { data: { ...page(s.rows), customer_id: customer, customer_version: s.cv, report_month: month, view: a.p_view, generation_id: null, source_context_link: s.metadata.source_context_link ?? null, draft_id: a.p_view === 'draft' ? draftId : null, draft_version: a.p_view === 'draft' ? s.version : null, revision_id: a.p_view === 'draft' ? null : s.effective.revision_id, eligible_set_fingerprint: a.p_view === 'draft' ? hash : null, source_context_fingerprint: s.metadata.source_context_fingerprint ?? null, context_issue: s.metadata.context_issue ?? null }, error: null };
        if (name === 'pilot_co_preview_v1') {
            s.previewCount++;
            const sum = { sold_quantity: s.header().sold_quantity, revenue: '720000', remaining_quantity: '30', complete: s.header().complete };
            return { data: { ...root, operation: a.p_operation, customer_id: customer, customer_version: s.cv, draft_version: a.p_payload.expected_draft_version ?? null, preview_fingerprint: fingerprint, source_context_fingerprint: 'c'.repeat(64), can_post: s.header().complete && s.impacts.issue.length === 0 && s.impacts.missing_month.length === 0, before: { ...sum, revenue: '1000000' }, after: { ...sum, revenue: '1720000' }, counts: Object.fromEntries(Object.entries(s.impacts).map(([k, v]: any) => [k, String(v.length)])) }, error: null };
        }
        if (name === 'pilot_co_preview_impacts_v1')
            return { data: { ...page(s.impacts[a.p_kind]), preview_fingerprint: a.p_preview_fingerprint, kind: a.p_kind }, error: null };
        if (name === 'pilot_co_preview_allocations_v1') {
            const rows = s.allocations.filter((r: any) => !a.p_stock_key_id || r.stock_key_id === a.p_stock_key_id);
            return { data: { ...page(rows), operation: a.p_operation, customer_id: customer, customer_version: s.cv, preview_fingerprint: a.p_preview_fingerprint, report_month: a.p_report_month, report_ref: `draft:${draftId}`, stock_key_id: a.p_stock_key_id, selected_row: a.p_stock_key_id ? { stock_key_id: a.p_stock_key_id, sold_quantity: s.rows.find((r: any) => r.id === a.p_stock_key_id)?.sold_quantity } : null, can_post: s.header().complete, report_complete: s.header().complete }, error: null };
        }
        if (name === 'pilot_co_transaction_v1') {
            const p = a.p_payload, op = a.p_operation;
            s.commands.push({ op, payload: p });
            if (op === 'save_report_draft') {
                if (p.expected_draft_version && p.expected_draft_version !== s.version)
                    return { data: null, error: { code: 'PT409', message: 'Stale draft' } };
                if (p.action === 'upsert_lines')
                    for (const l of p.lines)
                        s.rows.find((r: any) => r.id === l.stock_key_id).sold_quantity = l.sold_quantity === null ? null : String(l.sold_quantity);
                if (p.action === 'fill_remaining_zero')
                    s.rows.forEach((r: any) => { if (r.sold_quantity === null)
                        r.sold_quantity = '0'; });
                if (p.action === 'initialize' && p.source_context) {
                    s.metadata.source_context_fingerprint = p.source_context.source_context_fingerprint;
                    s.metadata.source_context_link = { operation: p.source_context.operation, target_id: p.source_context.payload.report_head_id ?? null, draft_id: p.source_context.payload.draft_id ?? null, original_revision_id: p.source_context.payload.original_revision_id ?? null, expected_source_version: p.source_context.payload.expected_report_version ?? null, expected_co_version: null, expected_customer_version: p.source_context.payload.expected_customer_version, expected_draft_version: p.source_context.payload.expected_draft_version ?? null };
                }
                if (p.action === 'set_metadata')
                    for (const k of ['report_reference', 'received_date', 'notes'])
                        if (k in p)
                            s.metadata[k] = p[k];
                s.draft = true;
                s.version = String(BigInt(s.version) + 1n);
            }
            else {
                s.cv = String(BigInt(s.cv) + 1n);
                s.effective = { ...s.header(), id: id(4), status: 'posted', draft_id: null, draft_version: null, report_head_id: id(4), revision_id: id(5), report_version: '1', revenue: '720000', eligible_set_fingerprint: null, consumed: false };
                s.draft = false;
            }
            s.receipt = { id: op === 'save_report_draft' ? draftId : id(4), operation: op, version: op === 'save_report_draft' ? s.version : '1', customer_id: customer, customer_version: s.cv };
            return { data: s.receipt, error: null };
        }
        if (name === 'pilot_reconcile_co_v1')
            return { data: { status: 'committed', operation: s.receipt.operation, receipt: s.receipt }, error: null };
        throw new Error(`Unhandled RPC ${name}`);
    };
    wire.handler = s.handle;
    return s;
}
export const reportImpact = (m = month) => ({ ref: `draft:${draftId}:${m}`, head_id: null, revision_id: null, month: m, coverage: m === '2026-09-01' ? '2026-09-30' : m, is_partial_month: false, report_reference: null, received_date: null, notes: null, row_count: '1', before_sold_quantity: '0', after_sold_quantity: '70', before_revenue: '0', after_revenue: '720000', complete: true });
export const allocation = (n: number, q: string, p: string) => ({ allocation_ref: `allocation:${n}`, report_ref: `draft:${draftId}`, report_line_ref: `row:${n}`, report_month: month, stock_key_id: id(1001), source_batch_ref: `candidate:${id(2000 + n)}`, delivery_ref: `candidate:${id(3000 + n)}`, source_state: 'proposed', batch_id: null, delivery_head_id: null, delivery_revision_id: null, co_id: id(4000 + n), co_number: `CO-${n}`, co_line_id: id(5000 + n), sj_number: `SJ-${n}`, sj_date: '2026-09-01', quantity: q, unit_price: p, amount: String(BigInt(q) * BigInt(p)), sales_person_name: `PIC-${n}`, sales_person_id_at_creation: id(6000 + n), sales_assignment_source_id: id(7000 + n), sales_attributed_at: '2026-09-01T00:00:00Z', sales_attribution_state: 'assigned' });
const clients: QueryClient[] = [], routers: ReturnType<typeof createMemoryRouter>[] = [];
beforeEach(() => { vi.stubGlobal('AbortController', class {
    constructor() { return transferableAbortController(); }
}); wire.actor = true; wire.role = 'co_admin'; wire.invoke.mockReset(); localStorage.clear(); wire.rpc.mockReset().mockImplementation((name, args) => { const p = Promise.resolve().then(() => wire.handler(name, args)).then(result => structuredClone(result)); return Object.assign(p, { abortSignal: () => p }); }); });
afterEach(() => { cleanup(); routers.splice(0).forEach(r => r.dispose()); clients.splice(0).forEach(c => c.clear()); localStorage.clear(); vi.unstubAllGlobals(); });
export function mount(element: React.ReactNode, path = `/athel/co/reports/${customer}/${month}`, strict = false) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const router = createMemoryRouter([{ path: '/athel/co/reports/:customerId/:month', element }, { path: '/athel/co/reports', element }, { path: '/athel/co/:id', element }, { path: '*', element: <p>Destination</p> }], { initialEntries: [path] }); clients.push(client); routers.push(router); const view=<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>; render(strict?<React.StrictMode>{view}</React.StrictMode>:view); return { client, router }; }
export function deliveryFixture(count = 1, voided = false) { const s = store(); s.rows[0].sold_quantity = '70'; const co: any = { id: id(10), customer_id: customer, customer_name: 'Store A', co_number: 'CO-1', status: 'active', order_date: '2026-09-01', expected_delivery_date: null, notes: null, co_version: '1', customer_version: '1', generation_id: null, sales_person_name: null, sales_person_id_at_creation: null, sales_assignment_source_id: null, sales_attributed_at: '2026-09-01T00:00:00Z', sales_attribution_state: 'unassigned', summary: { ordered_quantity: '100', delivered_quantity: voided ? '0' : '70', resolved_undelivered_quantity: '0', pending_quantity: voided ? '100' : '30', delivery_progress: voided ? 'not_started' : 'partial', planned_value: '1000000', sold_quantity: '0', revenue: '0', returned_quantity: '0', remaining_quantity: voided ? '0' : '70' }, last_report_month: null, coverage_through_date: null, reporting_freshness: freshness }; let revision: any = { id: id(13), head_id: id(12), customer_id: customer, co_id: co.id, head_version: '2', revision_no: '2', current_revision_id: id(13), sj_number: 'SJ-original', sj_date: '2026-09-01', received_date: null, notes: null, is_void: voided, reason: null, created_at: '2026-09-01T00:00:00Z', line_count: voided ? '0' : String(count), is_effective: true }; const lines = Array.from({ length: count }, (_, i) => ({ id: id(100 + i), co_id: co.id, customer_id: customer, stock_key_id: id(1001 + i), display_sku: `SKU-${i + 1}`, product_name: `Item ${i + 1}`, product_id: null, ordered_quantity: '100', resolved_undelivered_quantity: '0', delivered_quantity: voided ? '0' : '70', pending_quantity: voided ? '100' : '30', unit_price: '10000', removable: false })); let saved: any = null; let receipt: any = null; const state = { co, lines, get revision() { return revision; }, set revision(r) { revision = r; }, commands: [] as any[], allowed: ['edit_co', 'save_sj_draft', 'post_sj', 'save_report_draft', 'save_return_draft', 'correct_sj'], stale: false, canonicalFail: false }; wire.handler = async (n: string, a: any) => { const root = { version: '1', as_of: '2026-10-09T00:00:00Z' }; if (n === 'pilot_co_detail_v1')
    return { data: { ...root, co, allowed_operations: state.allowed, close_blockers: { stock_remains: !voided, undelivered_remains: true, missing_month_count: '1' } }, error: null }; if (n === 'pilot_co_detail_section_v1') {
    if (state.canonicalFail && a.p_section === 'deliveries')
        return { data: null, error: { code: '08006', message: 'Canonical delivery offline' } };
    let rows: any[] = a.p_section === 'lines' ? lines : a.p_section === 'deliveries' ? [state.stale ? { ...revision, current_revision_id: id(99), is_effective: false } : revision] : a.p_section === 'delivery_lines' ? (voided ? [] : lines.map(l => ({ id: id(9000 + Number(l.id.slice(-3))), revision_id: revision.id, customer_id: customer, co_id: co.id, co_line_id: l.id, stock_key_id: l.stock_key_id, batch_id: id(8000 + Number(l.id.slice(-3))), quantity: '70', unit_price: '10000', display_sku: l.display_sku, product_name: l.product_name }))) : a.p_section === 'sj_drafts' ? (saved ? [saved] : []) : a.p_section === 'sj_draft_lines' ? saved.lines.map((l: any) => ({ ...lines.find(r => r.id === l.co_line_id), id: l.co_line_id, co_line_id: l.co_line_id, draft_id: draftId, quantity: String(l.quantity), source_available: true, source_issue: null })) : [];
    return { data: { ...root, co_id: co.id, customer_id: customer, co_version: co.co_version, customer_version: co.customer_version, section: a.p_section, parent_id: a.p_parent_id, ...(a.p_section === 'sj_draft_lines' ? { draft_id: draftId, draft_version: saved.draft_version } : {}), total: String(rows.length), page: a.p_page, page_size: a.p_page_size, rows: rows.slice((a.p_page - 1) * a.p_page_size, a.p_page * a.p_page_size) }, error: null };
} if (n === 'pilot_co_transaction_v1') {
    const p = a.p_payload;
    state.commands.push({ op: a.p_operation, payload: p });
    if (a.p_operation === 'save_sj_draft') {
        saved = { id: draftId, co_id: co.id, customer_id: customer, draft_version: '1', mode: p.delivery_head_id ? 'delivery_correction' : 'new_delivery', sj_number: p.sj_number, sj_date: p.sj_date, received_date: p.received_date, notes: p.notes, bound_co_version: co.co_version, bound_customer_version: co.customer_version, bound_delivery_head_id: p.delivery_head_id ?? null, bound_delivery_revision_id: p.original_revision_id ?? null, bound_delivery_version: p.expected_delivery_version ?? null, posted_delivery_head_id: null, line_count: String(p.lines.length), consumed: false, bindings_current: true, preparation_ready: true, lines: p.lines };
        receipt = { id: draftId, operation: a.p_operation, version: '1', customer_id: customer, customer_version: '1' };
    }
    else {
        revision = { ...revision, id: id(14), head_version: '3', revision_no: '3', current_revision_id: id(14), is_void: p.action === 'void' };
        receipt = { id: id(12), operation: a.p_operation, version: '3', customer_id: customer, customer_version: '1' };
    }
    return { data: receipt, error: null };
} if (n === 'pilot_reconcile_co_v1')
    return { data: { status: 'committed', operation: receipt.operation, receipt }, error: null }; return s.handle(n, a); }; return state; }
