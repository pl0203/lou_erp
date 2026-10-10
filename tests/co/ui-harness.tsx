import React, { useEffect } from 'react';
import { transferableAbortController } from 'node:util';
import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
export const ids = { actor: '00000000-0000-0000-0000-000000000001', customer: '00000000-0000-0000-0000-000000000002', co: '00000000-0000-0000-0000-000000000003', draft: '00000000-0000-0000-0000-000000000004', head: '00000000-0000-0000-0000-000000000005' };
export const uuid = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const state = vi.hoisted(() => ({ actor: true, header: null as any, lines: [] as any[], products: [] as any[], customers: [] as any[], keys: [] as any[], drafts: [] as any[], draftLines: [] as any[], sections: {} as Record<string, any[]>, send: vi.fn(), reconcile: vi.fn(), acknowledge: vi.fn(), unresolved: false, guard: null as null | ((signal: AbortSignal) => Promise<boolean>), page: vi.fn(), complete: vi.fn(), failCatalog: false, failLines: false, failDraftRead: false, commands: [] as any[] }));
export { state };
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../src/lib/AuthContext', () => ({ useAuth: () => ({ user: state.actor ? { id: '00000000-0000-0000-0000-000000000001' } : null, profile: state.actor ? { id: '00000000-0000-0000-0000-000000000001', role: 'co_admin', is_active: true } : null, loading: false, error: null }), useBeforeSignOut: (guard: any) => { useEffect(() => { state.guard = guard; return () => { state.guard = null; }; }, [guard]); } }));
vi.mock('../../src/components/AthelNav', () => ({ default: () => null }));
vi.mock('../../src/lib/co/catalog', async (original) => ({ ...await original<any>(), fetchCOCustomers: async () => state.customers, fetchCOCatalog: async () => { if (state.failCatalog)
        throw new Error('Catalog unavailable'); return state.products; } }));
vi.mock('../../src/lib/co/rpc', async (original) => ({ ...await original<any>(), fetchCODetail: async () => ({ co: state.header, allowed_operations: state.header.allowed_operations, close_blockers: state.header.close_blockers }), fetchCompleteCOLines: async (...args: any[]) => { state.complete(...args); if (state.failLines)
        throw new Error('CO changed during pages'); return state.lines; }, fetchCOPage: async (args: any) => { state.page(args); return { version: '1', as_of: '2026-10-09T00:00:00Z', rows: [state.header], page: args.p_page, page_size: 20, total: '1', summary: { order_count: '1', planned_value: '20', revenue: '0', remaining_quantity: '2' } }; }, fetchCOCustomerStock: async () => ({ customer_version: '1', rows: state.keys, total: String(state.keys.length) }), fetchCompleteCOStockKeys: async () => state.keys, resolveCOStockKey: async (_c: string, sku: string) => state.keys.find(k => k.normalized_sku === sku.trim().toLowerCase()) ?? null, fetchCompleteCOSJDraft: async () => { if (state.failDraftRead)
        throw new Error('Saved SJ read failed'); return { header: state.drafts[0], lines: state.draftLines }; }, fetchCODetailSection: async (args: any) => { const rows = args.p_section === 'lines' ? state.lines : args.p_section === 'sj_drafts' ? state.drafts : state.sections[args.p_section] ?? []; const offset = (args.p_page - 1) * args.p_page_size; return { rows: rows.slice(offset, offset + args.p_page_size), total: String(rows.length), page: args.p_page, page_size: args.p_page_size }; }, fetchCOStockMovements: async () => ({ rows: [], total: '0', page: 1, page_size: 20 }) }));
vi.mock('../../src/lib/co/transactions', async (original) => ({ ...await original<any>(), useCOTransactionSender: () => Object.assign(state.send, { hasUnresolved: () => state.unresolved, reconcile: state.reconcile, acknowledgeRecovered: state.acknowledge }) }));
export const line = (n = 1) => ({ id: uuid(n), co_id: ids.co, customer_id: ids.customer, stock_key_id: uuid(10000 + n), display_sku: `SKU-${n}`, product_name: `Item ${n}`, product_id: null, ordered_quantity: '2', resolved_undelivered_quantity: '0', delivered_quantity: '0', pending_quantity: '2', unit_price: '10.00', removable: true });
export const product = (n = 1, sku = `SKU-${n}`) => ({ id: uuid(20000 + n), name: `Product ${n}`, sku, size: null, harga_pokok: '0', luar_kota: '10.00', dalam_kota: null, depo_bangunan: null });
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
beforeEach(() => { vi.stubGlobal('AbortController', class {
    constructor() { return transferableAbortController(); }
}); state.actor = true; state.unresolved = false; state.failCatalog = false; state.failLines = false; state.failDraftRead = false; state.guard = null; state.keys = []; state.drafts = []; state.draftLines = []; state.sections = {}; state.lines = [line()]; state.products = [product()]; state.customers = [{ id: ids.customer, name: 'Store A', pricing_tier: 'luar_kota' }]; state.header = { id: ids.co, customer_id: ids.customer, customer_name: 'Store A', co_number: 'CO-A', status: 'active', order_date: '2026-10-01', expected_delivery_date: null, notes: null, co_version: '1', customer_version: '1', generation_id: null, sales_person_name: 'Original PIC', sales_person_id_at_creation: uuid(999), sales_assignment_source_id: uuid(998), sales_attribution_state: 'assigned', last_report_month: null, coverage_through_date: null, summary: { ordered_quantity: '2', delivered_quantity: '0', resolved_undelivered_quantity: '0', pending_quantity: '2', delivery_progress: 'not_started', planned_value: '20.00', sold_quantity: '0', revenue: '0', returned_quantity: '0', remaining_quantity: '0' }, reporting_freshness: { status: 'current_unreported', next_required_report_month: '2026-10-01', pending_report_month_count: '1', overdue_report_month_count: '0', zero_stock_reporting_pending: false }, allowed_operations: ['edit_co', 'cancel_co', 'save_sj_draft', 'post_sj'], close_blockers: { stock_remains: false, undelivered_remains: true, missing_month_count: '1' } }; state.page.mockReset(); state.complete.mockReset(); state.commands = []; state.send.mockReset().mockImplementation(async (op, payload) => { state.commands.push({ op, payload }); if (op === 'save_sj_draft') {
    state.header.customer_version = '2';
    state.drafts = [{ id: '00000000-0000-0000-0000-000000000004', mode: payload.delivery_head_id ? 'delivery_correction' : 'new_delivery', preparation_ready: true, bound_delivery_head_id: payload.delivery_head_id ?? null, bound_delivery_revision_id: payload.original_revision_id ?? null, bound_delivery_version: payload.expected_delivery_version ?? null, draft_version: '1', bindings_current: true, consumed: false, ...payload }];
    state.draftLines = payload.lines.map((l: any) => ({ ...state.lines.find(r => r.id === l.co_line_id), id: l.co_line_id, co_line_id: l.co_line_id, quantity: String(l.quantity), source_available: true }));
} if (op === 'post_sj') {
    state.sections.deliveries = [{ id: '00000000-0000-0000-0000-000000000007', head_id: '00000000-0000-0000-0000-000000000005' }];
} return { id: op === 'save_sj_draft' ? ids.draft : op === 'post_sj' ? ids.head : ids.co, operation: op, version: '1', customer_id: ids.customer, customer_version: '2' }; }); state.reconcile.mockReset().mockResolvedValue({ status: 'committed', operation: 'edit_co', receipt: { id: ids.co, operation: 'edit_co', version: '2', customer_id: ids.customer, customer_version: '2' } }); state.acknowledge.mockReset().mockImplementation(async () => { state.unresolved = false; }); });
afterEach(() => { cleanup(); routers.splice(0).forEach(r => r.dispose()); clients.splice(0).forEach(c => c.clear()); localStorage.clear(); vi.unstubAllGlobals(); });
export function mount(element: React.ReactNode, path = `/athel/co/${ids.co}/edit`) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{ path: '/athel/co/new', element }, { path: '/athel/co/:id/edit', element }, { path: '/athel/co/:id', element }, { path: '*', element: <p>Destination page</p> }], { initialEntries: ['/before', path, '/after'], initialIndex: 1 });
    clients.push(client);
    routers.push(router);
    render(<QueryClientProvider client={client}>
    <RouterProvider router={router}/>
    </QueryClientProvider>);
    return { router, client };
}
export async function chooseCustomer() { const input = await screen.findByRole('combobox', { name: 'Pelanggan' }); fireEvent.change(input, { target: { value: 'Store A' } }); fireEvent.click(await screen.findByRole('option', { name: /Store A/ })); await waitFor(() => expectEnabled(screen.getByRole('button', { name: 'Tambah barang manual' }))); }
function expectEnabled(node: HTMLElement) { if ((node as HTMLButtonElement).disabled)
    throw new Error('UI not ready'); }
export async function addProduct(sku = 'SKU-1') { const input = await screen.findByRole('combobox', { name: 'Cari SKU atau nama barang' }); await waitFor(() => expectEnabled(input)); fireEvent.change(input, { target: { value: sku } }); fireEvent.keyDown(input, { key: 'Enter' }); return input; }
export const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
export const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
export function mountRoutes(routes:Parameters<typeof createMemoryRouter>[0],path:string){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});const router=createMemoryRouter(routes,{initialEntries:[path]});clients.push(client);routers.push(router);render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);return {router,client}}
