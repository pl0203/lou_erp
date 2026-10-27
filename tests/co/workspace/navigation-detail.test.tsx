import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { mount, mountRoutes, state, ids, line } from '../ui-harness';
import * as navigation from '../../../src/components/AthelNav';
const { default: ActualNav } = await vi.importActual<typeof navigation>('../../../src/components/AthelNav');
import COLayout from '../../../src/pages/athel/co/COLayout';
import CODetail from '../../../src/pages/athel/co/CODetail';
import COOrders from '../../../src/pages/athel/co/COOrders';
import { formatAuditTimestamp, formatDisplayDate } from '../../../src/lib/displayDate';
import { formatCOReportMonth } from '../../../src/lib/co/presentation';
import * as auth from '../../../src/lib/AuthContext';

const labels = ['Pesanan CO', 'Laporan Penjualan Bulanan', 'Stok Pelanggan', 'Stock Return'];
function workspace(path: string) {
    vi.spyOn(navigation, 'default').mockImplementation(ActualNav);
    return mountRoutes([{ path: '/athel/co', element: <COLayout/>, children: [
        { index: true, element: <COOrders/> }, { path: 'reports/*', element: <p>Reports destination</p> },
        { path: 'stock', element: <p>Stock destination</p> }, { path: 'returns', element: <p>Return destination</p> }, { path: ':id', element: <CODetail/> },
    ] }], path);
}
test.each([['/athel/co', 'Pesanan CO'], ['/athel/co/reports/customer/2026-10-01?revision=old', 'Laporan Penjualan Bulanan'], ['/athel/co/stock?customer=x', 'Stok Pelanggan'], ['/athel/co/returns', 'Stock Return'], [`/athel/co/${ids.co}`, 'Pesanan CO']])('direct/refresh route %s selects only %s without top tabs', async (path, selected) => {
    workspace(path);
    const group = await screen.findByRole('group', { name: 'Submenu Consignment Order' });
    expect(within(group).getAllByRole('link').map(link => link.textContent)).toEqual(labels);
    expect(within(group).getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'page').map(link => link.textContent)).toEqual([selected]);
    expect(screen.queryByRole('navigation', { name: 'Bagian pesanan konsinyasi' })).toBeNull();
});
test('sidebar follows Back/Forward and role restrictions remain unchanged', async () => {
    const { router } = workspace('/athel/co/reports');
    fireEvent.click(await screen.findByRole('link', { name: 'Stok Pelanggan' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Stok Pelanggan' }).getAttribute('aria-current')).toBe('page'));
    await act(async () => { await router.navigate(-1); });
    expect(screen.getByRole('link', { name: 'Laporan Penjualan Bulanan' }).getAttribute('aria-current')).toBe('page');
    await act(async () => { await router.navigate(1); });
    expect(screen.getByRole('link', { name: 'Stok Pelanggan' }).getAttribute('aria-current')).toBe('page');
});
test('po_admin has no CO group or submenu', async () => {
    const current = auth.useAuth();
    vi.spyOn(auth, 'useAuth').mockReturnValue({ ...current, profile: { ...current.profile!, role: 'po_admin' } });
    workspace('/athel/co/reports');
    expect(screen.queryByRole('button', { name: 'Consignment Order' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Pesanan CO' })).toBeNull();
});
test('detail prioritises order lines with exact agreed values and honest unavailable units, not cross-SKU KPIs', async () => {
    state.lines = [{ ...line(), ordered_quantity: '9007199254740993', delivered_quantity: '2', pending_quantity: '9007199254740991', unit_price: '0.01' }];
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    const table = await screen.findByRole('table', { name: 'Barang pesanan CO' });
    for (const heading of ['Satuan', 'Dipesan', 'Dikirim', 'Belum dikirim', 'Harga satuan CO', 'Total baris CO']) expect(within(table).getByRole('columnheader', { name: heading })).toBeTruthy();
    const unavailable = within(table).getByLabelText('Satuan tidak tersedia pada pembacaan ini');
    expect(unavailable.textContent).toBe('—');
    expect(unavailable.title).toBe('Satuan tidak tersedia pada pembacaan ini');
    expect(within(table).queryByText('pcs')).toBeNull();
    expect(within(table).getByText('Rp 90.071.992.547.409,93')).toBeTruthy();
    expect(within(table).getByText('9.007.199.254.740.991')).toBeTruthy();
    expect(screen.queryByText('Pelaporan pelanggan (semua CO)')).toBeNull();
    expect(screen.queryByText('Sisa stok tercatat')).toBeNull();
    expect(screen.getByText(/Nilai CO:/)).toBeTruthy();
});
test('shipping prepares without mutations, rare actions are collapsed and closure remains explicit', async () => {
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    const prepare = await screen.findByRole('button', { name: 'Buat surat jalan' });
    const toggle = screen.getByRole('button', { name: 'Actions' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const other = screen.getByRole('group', { name: 'Actions CO' });
    expect(within(other).getByRole('button', { name: 'Batalkan CO' })).toBeTruthy();
    expect(document.querySelector('details[data-co-history]')?.hasAttribute('open')).toBe(false);
    fireEvent.click(prepare);
    await screen.findByLabelText('Nomor SJ');
    expect(state.commands).toHaveLength(0);
    expect(screen.getByText(/Catat pengiriman menambah stok tercatat/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Catat pengiriman' }).matches(':disabled')).toBe(true);
});
test('fully dispatched retains active status but no enabled shipping preparation', async () => {
    Object.assign(state.header.summary, { pending_quantity: '0', delivered_quantity: '2', delivery_progress: 'complete' });
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    await screen.findByText('CO-A');
    expect(screen.queryByText('Aktif')).toBeNull();
    expect(screen.getByRole('button', { name: 'Buat surat jalan' }).matches(':disabled')).toBe(true);
    expect(state.commands).toHaveLength(0);
});
test('orders persist filters/page in URL and breadcrumb restores list context', async () => {
    const { router } = workspace(`/athel/co?search=CO-A&status=active&customer=${ids.customer}&page=2`);
    await screen.findAllByText('CO-A');
    expect(screen.getByLabelText('Cari CO').getAttribute('value')).toBe('CO-A');
    await waitFor(() => expect(state.page.mock.calls.some(([args]) => args.page === 2 && args.search === 'CO-A')).toBe(true));
    expect(await screen.findByRole('columnheader', { name: 'Nilai CO' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /Terjual/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Cari CO'), { target: { value: 'search new' } });
    await waitFor(() => expect(router.state.location.search).toContain('search=search+new'));
    const listURL = router.state.location.pathname + router.state.location.search;
    fireEvent.click((await screen.findAllByRole('link', { name: 'Lihat CO' }))[0]);
    expect(within(await screen.findByRole('navigation', { name: 'Jejak halaman CO' })).getByRole('link', { name: 'Pesanan CO' }).getAttribute('href')).toBe(listURL);
});
test('human audit timestamp uses WIB without reinterpreting report month or calendar cutoff', () => {
    expect(formatAuditTimestamp('2026-10-31T17:30:00Z', 'WIB')).toMatch(/1 November 2026.*00[.:]30[.:]00 WIB/);
    expect(formatCOReportMonth('2026-10-01')).toContain('Oktober');
    expect(formatDisplayDate('2026-10-31')).toContain('31 Oktober');
});
test('shipment history is a compact secondary table with no empty pagination', async () => {
    state.sections.deliveries = [{ id: 'delivery-1', head_id: 'head-1', sj_number: 'SJ-A', sj_date: '2026-10-01', received_date: null, revision_no: '1', is_effective: true, is_void: false }];
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    const history = await screen.findByRole('table', { name: 'Riwayat surat jalan' });
    expect(within(history).getByRole('columnheader', { name: 'Nomor surat jalan' })).toBeTruthy();
    expect(within(history).getByRole('columnheader', { name: 'Status' })).toBeTruthy();
    expect(within(history).getByText('SJ-A')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Halaman hasil' })).toBeNull();
});
test('history clamps a shrinking page even after single-page controls are omitted', async () => {
    const { COHistorySection } = await import('../../../src/pages/athel/co/CODetail');
    state.sections.audit = Array.from({ length: 21 }, (_, i) => ({ id: `audit-${i}` }));
    const { client } = mount(<COHistorySection co={state.header} section="audit" title="Audit test" renderRow={row => <p>{row.id}</p>}/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Berikutnya' }));
    await screen.findByText('audit-20');
    state.sections.audit = [{ id: 'audit-0' }];
    await act(async () => { await client.invalidateQueries({ queryKey: ['co'] }); });
    expect(await screen.findByText('audit-0')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Halaman hasil' })).toBeNull());
});
test('order editor labels its price basis explicitly without inventing a unit', async () => {
    const { COLineRow } = await import('../../../src/components/co/COLineItems');
    mount(<COLineRow line={{ key: 'line', id: 'line', existing: false, removable: true, product_id: null, product_name: 'Item', sku: 'SKU', quantity: '2', agreed_price: '10', minimum: '0' }} disabled={false} change={vi.fn()} remove={vi.fn()} refs={{ name: null, quantity: null, price: null }}/>);
    expect(screen.getByText('Harga satuan CO (Rp)')).toBeTruthy();
    expect(screen.getByText(/Total baris CO:/)).toBeTruthy();
    expect(screen.queryByText(/PCS|BOX|DOS/)).toBeNull();
});

test('detail omits requested secondary return, audit and information panels without changing records', async () => {
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    await screen.findByText('CO-A');
    for (const label of ['Draft retur pelanggan (semua sumber CO)', 'Retur barang CO (bagian sumber CO ini)', 'Audit CO dan laporan pelanggan', 'Informasi pesanan dan penjualan']) expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByText(/SJ Kembali adalah pengembalian dokumen/)).toBeNull();
    expect(screen.getByText('Draft Surat Jalan')).toBeTruthy();
    expect(state.commands).toHaveLength(0);
});
