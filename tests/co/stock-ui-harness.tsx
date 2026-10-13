import React from 'react';
import { afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { customer, freshness, id, store, wire } from './report-ui-harness';
export { customer, id, wire, mount } from './report-ui-harness';
export const root = { version: '1', as_of: '2026-10-09T00:00:00Z' };
export const batch = (n = 1) => ({
    id: id(2000 + n), customer_id: customer, co_id: id(10 + n), co_number: `CO-${n}`,
    co_line_id: id(3000 + n), stock_key_id: id(1000 + n), delivery_head_id: id(4000 + n),
    delivery_revision_id: id(5000 + n), sj_number: `SJ-${n}`, sj_date: '2026-09-01',
    display_sku: `SKU-${n}`, product_name: `Item ${n}`, available_quantity: '30', unit_price: '10000',
    sales_person_name: `PIC-${n}`, sales_person_id_at_creation: id(6000 + n),
    sales_assignment_source_id: id(7000 + n), sales_attributed_at: root.as_of, sales_attribution_state: 'assigned',
});
export function stockFixture(count = 2) {
    const report = store();
    report.rows[0].sold_quantity = '70';
    const s: any = {
        report, cv: '1', generation: id(8000), batches: Array.from({ length: count }, (_, i) => batch(i + 1)),
        draft: null, effective: null, history: [], commands: [], fail: null, receipt: null, movements: [], receipts: new Map(),
        allowed: ['save_return_draft', 'resolve_undelivered', 'close_co'],
        blockers: { stock_remains: true, undelivered_remains: true, missing_month_count: '0' },
    };
    s.co = {
        id: id(11), customer_id: customer, customer_name: 'Store A', co_number: 'CO-1', status: 'active',
        order_date: '2026-09-01', expected_delivery_date: null, notes: 'Private order note', co_version: '1',
        customer_version: s.cv, generation_id: s.generation, sales_person_name: 'Original PIC',
        sales_person_id_at_creation: id(601), sales_assignment_source_id: id(701), sales_attributed_at: root.as_of,
        sales_attribution_state: 'assigned', last_report_month: '2026-10-01', coverage_through_date: '2026-10-09',
        reporting_freshness: freshness,
        summary: { ordered_quantity: '100', delivered_quantity: '70', resolved_undelivered_quantity: '0', pending_quantity: '30',
            delivery_progress: 'partial', planned_value: '1000000', sold_quantity: '40', revenue: '720000', returned_quantity: '0', remaining_quantity: '30' },
    };
    s.lines = [{ id: id(3001), co_id: id(11), customer_id: customer, stock_key_id: id(1001), display_sku: 'SKU-1',
        product_name: 'Item 1', product_id: null, ordered_quantity: '100', resolved_undelivered_quantity: '0',
        delivered_quantity: '70', pending_quantity: '30', unit_price: '10000', removable: false }];
    s.stockRows = () => s.batches.map((b: any) => ({
        id: b.stock_key_id, customer_id: customer, customer_version: s.cv, generation_id: s.generation,
        normalized_sku: b.display_sku.toLowerCase(), display_sku: b.display_sku, product_name: b.product_name, product_id: null,
        opening_quantity: b.available_quantity, delivered_quantity: '0', sold_quantity: '0', returned_quantity: '0',
        recorded_quantity: b.available_quantity, has_delivery_history: true, last_report_month: '2026-10-01',
        coverage_through_date: '2026-10-09', reporting_freshness: freshness,
    }));
    s.makeDraft = (lines: any[], version = '1') => ({
        header: { id: id(20), customer_id: customer, target_kind: 'draft', draft_version: version, head_id: null, head_version: null,
            revision_id: null, revision_no: null, return_date: '2026-10-09', reference: 'RET-1', reason: null, notes: null,
            consumed: false, bound_customer_version: s.cv, bindings_current: true, line_count: String(lines.length) },
        lines: lines.map((l: any, i: number) => {
            const b = s.batches.find((b: any) => b.id === l.batch_id) ?? batch(i + 1);
            return { id: id(9000 + i), customer_id: customer, co_id: b.co_id, co_number: b.co_number, co_line_id: b.co_line_id,
                stock_key_id: b.stock_key_id, batch_id: l.batch_id, revision_id: null, draft_id: id(20), quantity: String(l.quantity),
                unit_price: b.unit_price, display_sku: b.display_sku, product_name: b.product_name };
        }),
    });
    s.handle = async (name: string, a: any) => {
        if (s.fail) { const fail = await s.fail(name, a); if (fail) return fail; }
        const ok = (data: any) => ({ data, error: null });
        const page = (rows: any[]) => ({ ...root, page: a.p_page, page_size: a.p_page_size, total: String(rows.length),
            rows: rows.slice((a.p_page - 1) * a.p_page_size, a.p_page * a.p_page_size) });
        if (name === 'pilot_co_customer_stock_v1') {
            const coverage = a.p_as_of ?? '2026-10-09';
            const f = coverage === '2026-10-09' ? freshness : { ...freshness, cutoff_date: coverage,
                pending_report_month_count: '1', days_since_pending_month_end: '0' };
            const rows = s.stockRows().filter((r: any) => !a.p_search || r.display_sku.toLowerCase().includes(a.p_search.toLowerCase()))
                .map((r: any) => ({ ...r, reporting_freshness: f }));
            const summary = Object.fromEntries(['opening_quantity', 'delivered_quantity', 'sold_quantity', 'returned_quantity', 'recorded_quantity']
                .map(k => [k, rows.reduce((sum: bigint, r: any) => sum + BigInt(r[k]), 0n).toString()]));
            return ok({ ...page(rows), customer_id: a.p_customer_id, customer_version: a.p_customer_id ? s.cv : null,
                generation_id: a.p_customer_id ? s.generation : null, stock_as_of: a.p_as_of, normalized_search: a.p_search.trim().toLowerCase(),
                reporting_freshness: a.p_customer_id ? f : null, period_start: coverage.slice(0, 7) + '-01', coverage_date: coverage, summary });
        }
        if (name === 'pilot_co_customer_batches_v1') return ok({ ...page(s.batches.filter((b: any) => BigInt(b.available_quantity) > 0n && (!a.p_stock_key_id || b.stock_key_id === a.p_stock_key_id))),
            customer_id: customer, customer_version: s.cv, stock_key_id: a.p_stock_key_id, generation_id: s.generation });
        if (name === 'pilot_co_stock_movements_v1') return ok({ ...page(s.movements), customer_id: customer, customer_version: s.cv,
            stock_key_id: a.p_stock_key_id, generation_id: s.generation, stock_as_of: a.p_as_of });
        if (name === 'pilot_co_return_v1') {
            const result = a.p_view === 'draft' ? s.draft : a.p_view === 'effective' ? s.effective : s.history.find((h: any) => h.header.revision_id === a.p_target_id);
            if (!result) return { data: null, error: { code: 'PT409', message: 'Return changed' } };
            return ok({ ...page(result.lines), customer_id: customer, customer_version: s.cv, target_id: a.p_target_id,
                view: a.p_view, draft_version: a.p_view === 'draft' ? result.header.draft_version : null, header: result.header });
        }
        if (name === 'pilot_co_detail_v1') return ok({ ...root, co: { ...s.co, customer_version: s.cv }, allowed_operations: s.allowed, close_blockers: s.blockers });
        if (name === 'pilot_co_detail_section_v1') {
            const rows = a.p_section === 'lines' ? s.lines : a.p_section === 'return_drafts' && s.draft ? [s.draft.header] : a.p_section === 'returns' && s.effective ? [{
                ...s.effective.header, id: s.effective.header.revision_id, current_revision_id: s.effective.header.revision_id,
                created_at: root.as_of, is_effective: true, is_void: !!s.effective.header.is_void,
            }] : [];
            return ok({ ...page(rows), co_id: s.co.id, customer_id: customer, co_version: s.co.co_version,
                customer_version: s.cv, section: a.p_section, parent_id: a.p_parent_id });
        }
        if (name === 'pilot_co_transaction_v1' && a.p_operation !== 'save_report_draft') {
            const p = a.p_payload, op = a.p_operation;
            s.commands.push({ op, payload: p });
            if (op === 'save_return_draft') {
                s.draft = s.makeDraft(p.lines, String(BigInt(s.draft?.header.draft_version ?? '0') + 1n));
                Object.assign(s.draft.header, { return_date: p.return_date, reference: p.reference ?? null, reason: p.reason ?? null, notes: p.notes ?? null });
                s.receipt = { id: id(20), operation: op, version: s.draft.header.draft_version, customer_id: customer, customer_version: s.cv };
            } else if (op === 'post_return' || op === 'correct_return') {
                const original = s.effective;
                const d = op === 'post_return' ? s.draft : p.action === 'replace' ? s.makeDraft(p.lines) : { ...original, lines: [] };
                s.cv = String(BigInt(s.cv) + 1n);
                const version = String(BigInt(original?.header.head_version ?? '0') + 1n), revision = id(210 + Number(version));
                s.effective = { header: { ...d.header, id: revision, target_kind: 'revision', draft_version: null,
                    head_id: id(21), head_version: version, revision_id: revision, revision_no: version, bound_customer_version: null,
                    line_count: String(d.lines.length), consumed: false, is_void: p.action === 'void', return_date: p.return_date ?? d.header.return_date },
                    lines: d.lines.map((l: any) => ({ ...l, revision_id: revision, draft_id: null })) };
                s.history.push(structuredClone(s.effective));
                if (s.draft && op === 'post_return') {
                    s.draft.header.consumed = true;
                    s.draft.header.head_id = id(21);
                    s.draft.header.draft_version = String(BigInt(s.draft.header.draft_version) + 1n);
                }
                if (op === 'post_return') for (const l of d.lines) {
                    const b = s.batches.find((b: any) => b.id === l.batch_id);
                    b.available_quantity = (BigInt(b.available_quantity) - BigInt(l.quantity)).toString();
                }
                s.receipt = { id: id(21), operation: op, version, customer_id: customer, customer_version: s.cv };
            } else {
                s.co.co_version = String(BigInt(s.co.co_version) + 1n);
                if (op === 'resolve_undelivered') {
                    for (const line of p.lines) {
                        const source = s.lines.find((l: any) => l.id === line.co_line_id);
                        source.pending_quantity = (BigInt(source.pending_quantity) - BigInt(line.quantity)).toString();
                        source.resolved_undelivered_quantity = (BigInt(source.resolved_undelivered_quantity) + BigInt(line.quantity)).toString();
                        s.co.summary.pending_quantity = (BigInt(s.co.summary.pending_quantity) - BigInt(line.quantity)).toString();
                        s.co.summary.resolved_undelivered_quantity = (BigInt(s.co.summary.resolved_undelivered_quantity) + BigInt(line.quantity)).toString();
                    }
                    s.blockers.undelivered_remains = s.co.summary.pending_quantity !== '0';
                }
                if (op === 'close_co') { s.co.status = 'closed'; s.allowed = []; }
                s.receipt = { id: s.co.id, operation: op, version: s.co.co_version, customer_id: customer, customer_version: s.cv };
            }
            s.receipts.set(a.p_request_id, s.receipt);
            return ok(s.receipt);
        }
        if (name === 'pilot_reconcile_co_v1' && s.receipts.has(a.p_request_id)) {
            const receipt = s.receipts.get(a.p_request_id);
            if (receipt.operation === 'save_report_draft') return report.handle(name, a);
            return ok({ status: 'committed', operation: receipt.operation, receipt });
        }
        report.cv = s.cv;
        const result = await report.handle(name, a);
        if (name === 'pilot_co_transaction_v1' && result.data) s.receipts.set(a.p_request_id, result.data);
        return result;
    };
    wire.handler = s.handle;
    return s;
}

const appResources: { router: ReturnType<typeof createMemoryRouter>; client: QueryClient }[] = [];
afterEach(() => { appResources.splice(0).forEach(({ router, client }) => { router.dispose(); client.clear(); }); });
export function mountApp(element: React.ReactNode, path: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: '*', element }], { initialEntries: [path] });
    appResources.push({ router, client });
    render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
    return { router, client };
}
