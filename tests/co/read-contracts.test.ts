import { expect, test } from 'vitest';
const modules = import.meta.glob('../../src/lib/co/validation.ts');
export async function decoder() { const load = modules['../../src/lib/co/validation.ts']; expect(load, 'CO strict decoder exists').toBeTypeOf('function'); return await load() as any; }
const id = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
export const stockArgs = { p_customer_id: id, p_as_of: null, p_search: '', p_expected_customer_version: '1', p_page: 1, p_page_size: 100 };
const reportingFreshness = {
    cutoff_date: '2026-10-09', next_required_report_month: '2026-09-01',
    pending_report_month_count: '2', overdue_report_month_count: '1',
    next_required_month_end: '2026-09-30', days_since_pending_month_end: '9',
    status: 'missing_completed_period', zero_stock_reporting_pending: false,
};
export const stock = { version: '1', as_of: '2026-10-09T00:00:00+00:00', customer_id: id, customer_version: '1', generation_id: null, stock_as_of: null, reporting_freshness: reportingFreshness, period_start: '2026-10-01', coverage_date: '2026-10-09', normalized_search: '', total: '1', page: 1, page_size: 100, summary: { recorded_quantity: '9007199254740993', opening_quantity: '9007199254740993', delivered_quantity: '0', sold_quantity: '0', returned_quantity: '0' }, rows: [{ id: key, customer_id: id, customer_version: '1', normalized_sku: 'sku', display_sku: 'SKU', product_id: null, product_name: 'Original', recorded_quantity: '9007199254740993', generation_id: null, opening_quantity: '9007199254740993', delivered_quantity: '0', sold_quantity: '0', returned_quantity: '0', has_delivery_history: false, reporting_freshness: reportingFreshness, last_report_month: null, coverage_through_date: null }] };
test('strict stock decoding retains exact bigint quantity text and rejects incomplete or foreign identities', async () => { const { decodeCORead } = await decoder(); expect(decodeCORead('pilot_co_customer_stock_v1', stockArgs, stock)).toEqual(stock); for (const value of [{ ...stock, rows: [] }, { ...stock, total: '2', rows: [stock.rows[0], stock.rows[0]] }, { ...stock, rows: [{ ...stock.rows[0], customer_id: key }] }, { ...stock, customer_version: '2' }, { ...stock, rows: [{ ...stock.rows[0], recorded_quantity: 9007199254740992 }] }])
    expect(() => decodeCORead('pilot_co_customer_stock_v1', stockArgs, value)).toThrow(); });
test('wire parsers reject malformed calendar values and lossy decimal/version encodings', async () => { const a = await decoder(); for (const v of ['0', '01', '9223372036854775808', 1])
    expect(() => a.parseVersion(v)).toThrow(); for (const v of ['2026-02-30', 'infinity', '2026-1-01'])
    expect(() => a.parseDate(v)).toThrow(); for (const v of ['1e3', 'NaN', '-1', 1])
    expect(() => a.parseMoney(v)).toThrow(); expect(a.parseMoney('999999999999999999999.99')).toBe('999999999999999999999.99'); });
test('decoder rejects a coherent-looking stock page with a broken month equation', async () => { const { decodeCORead } = await decoder(); const row = { ...stock.rows[0], generation_id: null, opening_quantity: '9007199254740993', delivered_quantity: '0', sold_quantity: '0', returned_quantity: '0' }; const value = { ...stock, period_start: '2026-10-01', coverage_date: '2026-10-09', summary: { ...stock.summary, opening_quantity: '9007199254740993', delivered_quantity: '0', sold_quantity: '0', returned_quantity: '0' }, rows: [row] }; expect(decodeCORead('pilot_co_customer_stock_v1', stockArgs, value)).toEqual(value); expect(() => decodeCORead('pilot_co_customer_stock_v1', stockArgs, { ...value, rows: [{ ...row, delivered_quantity: '1' }] })).toThrow(); });
test('report impacts use their own bounded count contract, not saved-report completeness fields', async () => { const { decodeCORead } = await decoder(); const fingerprint = 'a'.repeat(64); const args = { p_kind: 'report', p_preview_fingerprint: fingerprint, p_page: 1, p_page_size: 100 }; const value = { version: '1', as_of: stock.as_of, kind: 'report', preview_fingerprint: fingerprint, page: 1, page_size: 100, total: '1', rows: [{ ref: 'report:new', head_id: null, revision_id: null, month: '2026-01-01', coverage: '2026-01-31', is_partial_month: false, report_reference: null, received_date: null, notes: null, row_count: '601', before_sold_quantity: '0', after_sold_quantity: '601', before_revenue: '0.00', after_revenue: '606.00', complete: true }] }; expect(decodeCORead('pilot_co_preview_impacts_v1', args, value)).toEqual(value); });
test('stock pages reject foreign generation bindings even when quantity totals match', async () => { const { decodeCORead } = await decoder(); expect(() => decodeCORead('pilot_co_customer_stock_v1', stockArgs, { ...stock, generation_id: id, rows: [{ ...stock.rows[0], generation_id: key }] })).toThrow(); });
test('impact issue codes are a closed business contract', async () => { const { decodeCORead } = await decoder(); const fp = 'b'.repeat(64), args = { p_kind: 'issue', p_preview_fingerprint: fp, p_page: 1, p_page_size: 100 }; expect(() => decodeCORead('pilot_co_preview_impacts_v1', args, { version: '1', as_of: stock.as_of, kind: 'issue', preview_fingerprint: fp, page: 1, page_size: 100, total: '1', rows: [{ code: 'attach_evidence' }] })).toThrow(); });
const third = '33333333-3333-4333-8333-333333333333';
test('posted allocation rows must belong to the requested immutable revision', async () => { const { decodeCORead } = await decoder(); const row = { id: key, customer_id: id, report_revision_id: third, report_month: '2026-01-01', stock_key_id: key, batch_id: key, co_id: third, co_number: 'CO', co_line_id: key, delivery_head_id: key, delivery_revision_id: key, sj_number: 'SJ', sj_date: '2026-01-01', quantity: '2', unit_price: '1.50', amount: '3.00', sales_person_name: null, sales_person_id_at_creation: null, sales_assignment_source_id: null, sales_attributed_at: stock.as_of, sales_attribution_state: 'unassigned' }; const args = { p_customer_id: id, p_month: '2026-01-01', p_revision_id: third, p_expected_customer_version: '1', p_page: 1, p_page_size: 100 }; const value = { version: '1', as_of: stock.as_of, customer_id: id, customer_version: '1', report_month: '2026-01-01', revision_id: third, generation_id: key, is_effective: false, summary: { quantity: '2', amount: '3.00' }, total: '1', page: 1, page_size: 100, rows: [row] }; expect(decodeCORead('pilot_co_report_allocations_v1', args, value)).toEqual(value); expect(() => decodeCORead('pilot_co_report_allocations_v1', args, { ...value, rows: [{ ...row, report_revision_id: key }] })).toThrow(); expect(() => decodeCORead('pilot_co_report_allocations_v1', args, { ...value, summary: { quantity: '1', amount: '1.50' } })).toThrow(); });
test('saved return view requires a draft-kind header and matching line bindings', async () => { const { decodeCORead } = await decoder(); const args = { p_customer_id: id, p_target_id: key, p_view: 'draft', p_expected_customer_version: '1', p_expected_draft_version: '1', p_page: 1, p_page_size: 100 }; const header = { id: key, customer_id: id, target_kind: 'draft', draft_version: '1', head_id: null, head_version: null, revision_id: null, revision_no: null, return_date: '2026-01-01', reference: null, reason: null, notes: null, consumed: false, bound_customer_version: '1', bindings_current: true, line_count: '1' }; const row = { id: third, customer_id: id, co_id: third, co_number: 'CO', co_line_id: third, stock_key_id: third, batch_id: third, revision_id: null, draft_id: key, quantity: '1', unit_price: '0.00', display_sku: 'SKU', product_name: 'Name' }; const value = { version: '1', as_of: stock.as_of, customer_id: id, customer_version: '1', target_id: key, view: 'draft', draft_version: '1', header, total: '1', page: 1, page_size: 100, rows: [row] }; expect(decodeCORead('pilot_co_return_v1', args, value)).toEqual(value); for (const changed of [{ ...value, header: { ...header, target_kind: 'revision' } }, { ...value, header: { ...header, line_count: '2' } }, { ...value, rows: [{ ...row, draft_id: third }] }])
    expect(() => decodeCORead('pilot_co_return_v1', args, changed)).toThrow(); });

test('SJ input pages require the exact draft binding even with zero rows', async () => {
    const { decodeCORead } = await decoder();
    const args = { p_co_id: third, p_section: 'sj_draft_lines', p_parent_id: key,
        p_expected_version: '1', p_expected_customer_version: '2',
        p_expected_draft_version: '3', p_page: 1, p_page_size: 100 };
    const value = { version: '1', as_of: stock.as_of, co_id: third, customer_id: id,
        co_version: '1', customer_version: '2', section: 'sj_draft_lines', parent_id: key,
        draft_id: key, draft_version: '3', total: '0', page: 1, page_size: 100, rows: [] };
    expect(decodeCORead('pilot_co_detail_section_v1', args, value)).toEqual(value);
    for (const changed of [{ ...value, draft_version: undefined }, { ...value, draft_id: undefined },
        { ...value, draft_version: '4' }, { ...value, draft_id: third }]) {
        expect(() => decodeCORead('pilot_co_detail_section_v1', args, changed)).toThrow();
    }
});

test('preview versions bind unconditionally to the original operation payload', async () => {
    const { decodeCORead } = await decoder();
    const args = { p_operation: 'post_report', p_payload: { draft_id: key,
        expected_customer_version: '2', expected_draft_version: '3' } };
    const summary = { sold_quantity: '0', revenue: '0.00', remaining_quantity: '0', complete: true };
    const value = { version: '1', as_of: stock.as_of, operation: 'post_report', customer_id: id,
        customer_version: '2', draft_version: '3', preview_fingerprint: 'c'.repeat(64),
        can_post: true, before: summary, after: summary,
        counts: { report: '0', stock: '0', revenue: '0', credit: '0', reopen: '0', issue: '0', missing_month: '0' } };
    expect(decodeCORead('pilot_co_preview_v1', args, value)).toEqual(value);
    for (const changed of [{ ...value, customer_version: '99', draft_version: '98' },
        { ...value, draft_version: null }, { ...value, customer_version: undefined }]) {
        expect(() => decodeCORead('pilot_co_preview_v1', args, changed)).toThrow();
    }
});

test('stock summaries equal column sums when the matching collection fits completely on the page', async () => {
    const { decodeCORead } = await decoder();
    const value = { ...stock, summary: { ...stock.summary, opening_quantity: '9007199254740994', recorded_quantity: '9007199254740994' } };
    expect(() => decodeCORead('pilot_co_customer_stock_v1', stockArgs, value)).toThrow();
});


test('customer reporting freshness is complete, date-coherent and shared by every stock row', async () => {
    const { decodeCORead } = await decoder();
    expect(decodeCORead('pilot_co_customer_stock_v1', stockArgs, stock)).toEqual(stock);
    for (const changed of [
        { ...stock, reporting_freshness: undefined },
        { ...stock, reporting_freshness: { ...reportingFreshness, days_since_pending_month_end: '10' } },
        { ...stock, reporting_freshness: { ...reportingFreshness, status: 'current_partial' } },
        { ...stock, rows: [{ ...stock.rows[0], reporting_freshness: { ...reportingFreshness, pending_report_month_count: '3' } }] },
    ]) {
        expect(() => decodeCORead('pilot_co_customer_stock_v1', stockArgs, changed)).toThrow();
    }
});

test('preview allocation selection retains unanswered versus zero and binds the requested report key', async () => {
    const { decodeCORead } = await decoder();
    const args = { p_operation: 'post_report', p_payload: { draft_id: key,
        expected_customer_version: '2', expected_draft_version: '3' },
        p_preview_fingerprint: 'd'.repeat(64), p_report_month: '2026-09-01',
        p_stock_key_id: key, p_page: 1, p_page_size: 100 };
    const value = { version: '1', as_of: stock.as_of, operation: 'post_report',
        customer_id: id, customer_version: '2', preview_fingerprint: args.p_preview_fingerprint,
        report_month: args.p_report_month, report_ref: `draft:${key}`, stock_key_id: key,
        selected_row: { stock_key_id: key, sold_quantity: null },
        can_post: false, report_complete: false, total: '0', page: 1, page_size: 100, rows: [] };
    expect(decodeCORead('pilot_co_preview_allocations_v1', args, value)).toEqual(value);
    const zero = { ...value, selected_row: { stock_key_id: key, sold_quantity: '0' } };
    expect(decodeCORead('pilot_co_preview_allocations_v1', args, zero)).toEqual(zero);
    for (const changed of [
        { ...value, selected_row: null },
        { ...value, selected_row: { stock_key_id: third, sold_quantity: null } },
        { ...value, report_complete: true },
    ]) {
        expect(() => decodeCORead('pilot_co_preview_allocations_v1', args, changed)).toThrow();
    }
    expect(() => decodeCORead('pilot_co_preview_allocations_v1',
        { ...args, p_stock_key_id: null }, { ...value, stock_key_id: null })).toThrow();
});

test('an explicit selected zero cannot claim allocations on another page', async () => {
    const { decodeCORead } = await decoder();
    const args = { p_operation: 'post_report', p_payload: { draft_id: key,
        expected_customer_version: '2', expected_draft_version: '3' },
        p_preview_fingerprint: 'e'.repeat(64), p_report_month: '2026-09-01',
        p_stock_key_id: key, p_page: 2, p_page_size: 100 };
    expect(() => decodeCORead('pilot_co_preview_allocations_v1', args, {
        version: '1', as_of: stock.as_of, operation: 'post_report', customer_id: id,
        customer_version: '2', preview_fingerprint: args.p_preview_fingerprint,
        report_month: args.p_report_month, report_ref: `draft:${key}`, stock_key_id: key,
        selected_row: { stock_key_id: key, sold_quantity: '0' }, can_post: false,
        report_complete: false, total: '1', page: 2, page_size: 100, rows: [],
    })).toThrow();
});
