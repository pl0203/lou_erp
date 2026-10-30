import React from 'react';
import { readFileSync } from 'node:fs';
const stockTableCss = readFileSync('src/components/co/COStockTable.css', 'utf8');
import { expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { customer, id, mount, mountApp, stockFixture, wire } from './stock-ui-harness';
import App from '../../src/App';
import * as catalog from '../../src/lib/co/catalog';
import CODetail from '../../src/pages/athel/co/CODetail';
async function showActions(){const t=await screen.findByRole('button',{name:/^Actions/});if(t.getAttribute('aria-expanded')!=='true')fireEvent.click(t)}
function stockNumbers(sku:string){const table=screen.getByRole('table',{name:'Stok pelanggan tercatat'});const row=within(table).getByRole('rowheader',{name:sku,exact:true}).closest('tr')!;return Array.from(row.querySelectorAll('td.co-stock-number'),x=>x.textContent)}

test('stock route shows current equation, old overdue month and separate partial coverage', async () => {
    stockFixture();
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByRole('heading', { name: 'Stok Pelanggan' });
    await screen.findByRole('table',{name:'Stok pelanggan tercatat'});
    expect(stockNumbers('SKU-1')).toEqual(['30','0','0','0','30']);
    expect(screen.getAllByText(/September 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Cakupan sampai: 9 Oktober 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Laporan terakhir: Oktober 2026/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Bulan akhir stok').getAttribute('type')).toBe('month');
});
test('canonical stock-key URL opens movement scope without using UUID as SKU text search', async () => {
    stockFixture();
    mountApp(<App />, `/athel/co/stock?customer=${customer}&movementCustomer=${customer}&stockKey=${id(1002)}`);
    await screen.findByRole('heading', { name: 'Mutasi stok' });
    await waitFor(()=>expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_stock_movements_v1' && a.p_stock_key_id === id(1002))).toBe(true));
    expect(wire.rpc.mock.calls.filter(([n]) => n === 'pilot_co_customer_stock_v2').every(([, a]) => a.p_search === '')).toBe(true);
});
test('failed stock read is unavailable rather than recorded zero', async () => {
    const s = stockFixture();
    s.fail = (n: string) => n === 'pilot_co_customer_stock_v2' ? { data: null, error: { code: '08006', message: 'Stock offline' } } : null;
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByText('Stock offline');
    expect(screen.queryByRole('table', {name:'Stok pelanggan tercatat'})).toBeNull();
    expect(document.querySelectorAll('td.co-stock-number')).toHaveLength(0);
});
test('resolution uses reasoned additional quantities and closure has its own reason', async () => {
    const s = stockFixture();
    s.co.summary.sold_quantity = '70'; s.co.summary.remaining_quantity = '0'; s.blockers.stock_remains = false;
    mount(<CODetail />, `/athel/co/${s.co.id}`);
    await showActions();fireEvent.click(await screen.findByRole('button', { name: 'Selesaikan sisa belum dikirim' }));
    fireEvent.change(await screen.findByLabelText('Jumlah dibatalkan Item 1'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Alasan penyelesaian'), { target: { value: 'Customer reduced plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi penyelesaian' }));
    await waitFor(() => expect(s.commands[0]).toMatchObject({ op: 'resolve_undelivered', payload: {
        co_id: s.co.id, expected_co_version: '1', expected_customer_version: '1', reason: 'Customer reduced plan', lines: [{ co_line_id: id(3001), quantity: 5 }],
    } }));
    await waitFor(() => expect(screen.queryByLabelText('Alasan penyelesaian')).toBeNull());
    await showActions();expect(screen.getByRole('button', { name: 'Tutup CO' }).matches(':disabled')).toBe(true);
    expect(s.co.summary.pending_quantity).toBe('25');
    expect(s.co.status).toBe('active');
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan sisa belum dikirim' }));
    const additional = await screen.findByLabelText('Jumlah dibatalkan Item 1');
    await waitFor(() => expect(additional.matches(':disabled')).toBe(false));
    fireEvent.change(additional, { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Alasan penyelesaian'), { target: { value: 'Cancel remaining plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi penyelesaian' }));
    await waitFor(() => expect(screen.queryByLabelText('Alasan penyelesaian')).toBeNull());
    await showActions();await waitFor(() => expect(screen.getByRole('button', { name: 'Tutup CO' }).matches(':disabled')).toBe(false));
    expect(s.commands[1].payload.lines).toEqual([{ co_line_id: id(3001), quantity: 25 }]);
    expect(s.co.summary.resolved_undelivered_quantity).toBe('30');
    expect(s.co.summary.delivered_quantity).toBe('70');
    fireEvent.click(screen.getByRole('button', { name: 'Tutup CO' }));
    await waitFor(() => expect(screen.getByLabelText('Alasan penutupan').matches(':disabled')).toBe(false));
    fireEvent.change(screen.getByLabelText('Alasan penutupan'), { target: { value: 'Final settled' } });
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi penutupan' }));
    await waitFor(() => expect(s.commands[2]).toMatchObject({ op: 'close_co', payload: { reason: 'Final settled' } }));
    expect(wire.rpc.mock.calls.some(([n]) => n === 'pilot_co_preview_v1')).toBe(false);
});

test.each([
    { stock_remains: true, undelivered_remains: false, missing_month_count: '0' },
    { stock_remains: false, undelivered_remains: true, missing_month_count: '0' },
    { stock_remains: false, undelivered_remains: false, missing_month_count: '1' },
])('every authoritative closure blocker independently disables Close: %j', async blockers => {
    const s = stockFixture(); s.blockers = blockers;
    mount(<CODetail />, `/athel/co/${s.co.id}`);
    await showActions();const close = await screen.findByRole('button', { name: 'Tutup CO' });
    expect(close.matches(':disabled')).toBe(true);
    fireEvent.click(close);
    expect(s.commands).toHaveLength(0);
});
test('month-end filter is a calendar month end and future month end is refused', async () => {
    stockFixture();
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByRole('table',{name:'Stok pelanggan tercatat'});
    expect(stockNumbers('SKU-1')).toEqual(['30','0','0','0','30']);
    fireEvent.change(screen.getByLabelText('Bulan akhir stok'), { target: { value: '2026-09' } });
    await waitFor(() => expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_customer_stock_v2' && a.p_as_of === '2026-09-30')).toBe(true));
    fireEvent.change(screen.getByLabelText('Bulan akhir stok'), { target: { value: '2026-10' } });
    await screen.findByText(/Pilih akhir bulan yang sudah selesai/);
    expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_customer_stock_v2' && a.p_as_of === '2026-10-31')).toBe(false);
});
test('recorded never-delivered zero remains visible and is qualified', async () => {
    const s = stockFixture(1);
    const rows = s.stockRows();
    Object.assign(rows[0], { opening_quantity: '0', recorded_quantity: '0', has_delivery_history: false });
    s.stockRows = () => rows;
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByRole('table',{name:'Stok pelanggan tercatat'});expect(stockNumbers('SKU-1')).toEqual(['0','0','0','0','0']);
    expect(screen.getByText(/Belum dikirim/).closest('td')?.title).toContain('nol tercatat tidak membuktikan saldo fisik awal');
});

test('movement pagination refuses mixing effective generations and explicit reload starts a new binding', async () => {
    const s = stockFixture(1);
    s.movements = Array.from({ length: 21 }, (_, i) => ({ id: id(50000 + i), customer_id: customer,
        stock_key_id: id(1001), generation_id: s.generation, batch_id: id(2001), co_id: id(11), co_line_id: id(3001),
        kind: 'delivery', quantity_delta: '1', effective_date: '2026-09-01', delivery_revision_line_id: id(51000 + i),
        return_revision_line_id: null, report_revision_line_id: null }));
    mountApp(<App />, `/athel/co/stock?customer=${customer}&movementCustomer=${customer}&stockKey=${id(1001)}`);
    await screen.findAllByRole('link', { name: 'Lihat CO sumber' });
    s.generation = id(8001); s.movements.forEach((r: any) => r.generation_id = s.generation);
    const next = screen.getAllByRole('button', { name: 'Berikutnya' }).find(b => !b.matches(':disabled'))!;
    fireEvent.click(next);
    await screen.findByText('Riwayat berubah di antara halaman. Muat ulang seluruh riwayat.');
    expect(screen.queryByRole('link', { name: 'Lihat CO sumber' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await screen.findAllByRole('link', { name: 'Lihat CO sumber' });
});
test('stock filters and page totals remain server scoped across more than 100 keys', async () => {
    stockFixture(101);
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByText('Halaman 1 dari 5');
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await screen.findByText('SKU-31');
    fireEvent.change(screen.getByLabelText('Cari SKU stok'), { target: { value: 'SKU-101' } });
    await screen.findByText('SKU-101');
    expect(screen.getByText('Halaman 1 dari 1')).toBeTruthy();
    expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_customer_stock_v2' && a.p_search === 'SKU-101' && a.p_page === 1)).toBe(true);
});
test('return draft section authority denial clears the containing detail private source', async () => {
    const s = stockFixture();
    s.fail = (n: string, a: any) => n === 'pilot_co_detail_section_v1' && a.p_section === 'return_drafts'
        ? { data: null, error: { code: '42501', message: 'Return discovery denied' } } : null;
    mount(<CODetail />, `/athel/co/${s.co.id}`);
    await screen.findByText('Return discovery denied');
    expect(screen.queryByText('Private order note')).toBeNull();
    expect(screen.queryByText('Original PIC')).toBeNull();
});

test('stock has one semantic desktop table with responsive rows and exact large quantities', async () => {
    const s = stockFixture(1);
    const rows = s.stockRows();
    Object.assign(rows[0], { opening_quantity: '9007199254740993', recorded_quantity: '9007199254740993' });
    s.stockRows = () => rows;
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
    expect(stockNumbers('SKU-1')).toEqual(['9.007.199.254.740.993','0','0','0','9.007.199.254.740.993']);
});

test('newer authoritative CO version freezes retained settlement until explicit refresh', async () => {
    const s = stockFixture();
    const { client } = mount(<CODetail />, `/athel/co/${s.co.id}`);
    await showActions();fireEvent.click(await screen.findByRole('button', { name: 'Selesaikan sisa belum dikirim' }));
    const field = await screen.findByLabelText('Jumlah dibatalkan Item 1');
    await waitFor(() => expect(field.matches(':disabled')).toBe(false));
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Alasan penyelesaian'), { target: { value: 'RETAIN SETTLEMENT' } });
    s.co.co_version = '2';
    await act(async () => { await client.invalidateQueries({ predicate: q => q.queryKey[4] === 'detail' }); });
    await screen.findByText(/Versi CO berubah/);
    expect(screen.getByDisplayValue('RETAIN SETTLEMENT')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Konfirmasi penyelesaian' }).matches(':disabled')).toBe(true));
    expect(s.commands).toHaveLength(0);
});

test('same-SKU stock rows identify canonical customers in responsive cells and movement destinations', async () => {
    const s = stockFixture(1), second = id(99);
    const rows = s.stockRows();
    rows.push({ ...rows[0], id: id(1002), customer_id: second, customer_name:'Store B', opening_quantity: '7', recorded_quantity: '7' });
    s.stockRows = () => rows;
    const directory = vi.spyOn(catalog, 'fetchCOCustomers').mockResolvedValue([{ id: customer, name: 'Store A', pricing_tier: 'others' }, { id: second, name: 'Store B', pricing_tier: 'others' }]);
    const { router } = mountApp(<App/>, '/athel/co/stock');
    const table = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
    await waitFor(() => expect(table.textContent).toContain('Store A'));
    expect(table.textContent).toContain('Store B');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    for (const row of table.querySelectorAll('tbody tr')) {
        expect(row.querySelectorAll('th[scope="row"]')).toHaveLength(2);
        expect(row.querySelector('td')).toBeTruthy();
    }
    const button = screen.getByRole('button', { name: 'Lihat mutasi Store B · SKU-1' });
    fireEvent.click(button);
    await waitFor(() => expect(router.state.location.search).toContain(`movementCustomer=${second}`));
    expect(router.state.location.search).toContain(`stockKey=${id(1002)}`);
    directory.mockRestore();
});

test('authoritative V2 row identity remains explicit even when absent from the filter directory', async () => {
    const s = stockFixture(1), rows = s.stockRows();
    rows[0].customer_id = id(98); rows[0].customer_name='Authorized Store 98'; s.stockRows = () => rows;
    mountApp(<App/>, '/athel/co/stock');
    const table = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
    await waitFor(() => expect(table.textContent).toContain('Authorized Store 98'));
    expect(screen.getByRole('button', { name: 'Lihat mutasi Authorized Store 98 · SKU-1' })).toBeTruthy();
});

test('stock shares the physical-stock caveat once and uses aligned quantity labels with compact per-row reporting', async () => {
    stockFixture(3); mountApp(<App/>, `/athel/co/stock?customer=${customer}`);
    const table = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
    await waitFor(() => expect(table.querySelectorAll('tbody tr')).toHaveLength(3));
    expect(screen.getAllByText('Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.')).toHaveLength(1);
    expect(table.querySelectorAll('td.co-stock-number')).toHaveLength(15);
    expect(screen.getByRole('button', { name: 'Lihat mutasi Store A · SKU-1' }).textContent).toBe('Lihat mutasi');
});

test('stock filters retain customer-wide scope and exact large row quantities across unopened pages', async () => {
    const s = stockFixture(26), rows = s.stockRows();
    rows[25].opening_quantity = '9007199254740993'; rows[25].recorded_quantity = '9007199254740993';
    s.stockRows = () => rows;
    mountApp(<App/>, `/athel/co/stock?customer=${customer}&month=2026-09`);
    const table = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
    const region = screen.getByRole('region', { name: 'Daftar stok pelanggan' });
    expect(region.tabIndex).toBe(0); expect(region.className).toContain('overflow-x-auto'); expect(region.contains(table)).toBe(true);
    const filters = screen.getByRole('region', { name: 'Filter stok pelanggan' });
    const month = within(filters).getByLabelText('Bulan akhir stok') as HTMLInputElement;
    expect(month.labels?.[0].htmlFor).toBe(month.id);
    expect(screen.getByText(/stok seluruh CO pelanggan/)).toBeTruthy();
    expect(screen.getByText('26 baris toko/SKU')).toBeTruthy();expect(table.querySelectorAll('tbody tr')).toHaveLength(25);
    // V2 has exact row totals, not the removed all-filter quantity aggregate.
    fireEvent.change(screen.getByLabelText('SKU tepat'),{target:{value:'SKU-26'}});await screen.findByText('SKU-26');expect(stockNumbers('SKU-26')).toEqual(['9.007.199.254.740.993','0','0','0','9.007.199.254.740.993']);
    expect(screen.getByText(/Akhir bulan, riwayat efektif dinyatakan ulang/)).toBeTruthy();
    expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_customer_stock_v2' && a.p_as_of === '2026-09-30')).toBe(true);
    expect(document.querySelectorAll('main#main-content')).toHaveLength(1);
});

test('never-delivered recorded zero retains qualified meaning and native stock quantity labels', async () => {
    const s = stockFixture(1), rows = s.stockRows();
    rows[0].opening_quantity = '0'; rows[0].recorded_quantity = '0'; rows[0].has_delivery_history = false;
    s.stockRows = () => rows;
    mountApp(<App/>, `/athel/co/stock?customer=${customer}`);
    const table = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
    expect(within(table).getByText(/Belum dikirim/)).toBeTruthy();
    expect(screen.getByText(/Belum dikirim/).closest('td')?.title).toContain('nol tercatat tidak membuktikan saldo fisik awal');
    expect(stockNumbers('SKU-1')).toEqual(['0','0','0','0','0']);
    expect(within(table).getByRole('button',{name:'Urutkan Sisa tercatat'})).toBeTruthy();
    expect(screen.queryByText(/Saldo historis awal tidak diasumsikan/)).toBeNull();
});

test('empty stock filter uses an explicit empty state without inventing historical keys', async () => {
    stockFixture(0); mountApp(<App/>, `/athel/co/stock?customer=${customer}`);
    expect(await screen.findByRole('heading', { name: 'Tidak ada kunci stok sesuai filter.' })).toBeTruthy();
    expect(screen.getByText('Saldo historis awal tidak diasumsikan.')).toBeTruthy();
    expect(screen.queryByText('Belum dikirim')).toBeNull();
});

test('effective stock movement history names its source list and preserves customer stock-key binding', async () => {
    const s = stockFixture(1);
    s.movements = [{ id: id(91), customer_id: customer, stock_key_id: id(1001), generation_id: s.generation, co_line_id: id(3001), effective_date: '2026-09-30', kind: 'sold', quantity_delta: '-7', co_id: id(11), batch_id: id(2001), delivery_revision_line_id: null, return_revision_line_id: null, report_revision_line_id: id(92) }];
    mountApp(<App/>, `/athel/co/stock?customer=${customer}&movementCustomer=${customer}&stockKey=${id(1001)}`);
    const link = await screen.findByRole('link', { name: 'Lihat CO sumber' });
    expect(screen.getByRole('table', { name: 'Pergerakan stok tercatat' }).contains(link)).toBe(true);
    expect(link.getAttribute('href')).toBe(`/athel/co/${id(11)}`);
    expect(screen.getByText(/Tanggal penjualan adalah batas cakupan laporan, bukan tanggal transaksi harian/)).toBeTruthy();
});

test('stock table uses documented 14px minimum stylesheet with native numeric cells outside description-list styling', async () => {
    // An unlayered normal rule is stronger than the primitive's components-layer rule.
    // The native value text must still use the approved table size beneath that ancestor.
    const style = document.createElement('style');
    style.textContent = stockTableCss + '\n.ui-summary-list dd { font-size: 16px; }';
    document.head.append(style);
    try {
        stockFixture(1); mountApp(<App/>, `/athel/co/stock?customer=${customer}`);
        const table = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
        expect(getComputedStyle(table).fontSize).toBe('14px');
        const values = table.querySelectorAll('td.co-stock-number');
        expect(values).toHaveLength(5);
        expect(Array.from(values, value => value.textContent)).toEqual(['30', '0', '0', '0', '30']);
        for (const value of values) {
            expect(value.tagName).toBe('TD');expect(value.closest('.ui-summary-list')).toBeNull();
        }
    } finally { style.remove(); }
});

// Approved Oct30: defer whole-filter quantity totals until unit-safe server calculation.
// Preserve exact count/paging; do not invent aggregate values from a partial page.
test('deferred unit-safe quantity totals preserve exact result count without inventing page aggregates', async () => {
    const s=stockFixture(26), rows=s.stockRows();
    rows[25].opening_quantity='9007199254740993'; rows[25].recorded_quantity='9007199254740993';
    rows[25].display_sku='ZZZ-LAST';rows[25].normalized_sku='zzz-last';
    s.stockRows=()=>rows;
    mountApp(<App/>, `/athel/co/stock?customer=${customer}&month=2026-09`);
    const table=await screen.findByRole('table',{name:'Stok pelanggan tercatat'});
    expect(table.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(within(table).queryByText('ZZZ-LAST')).toBeNull();
    expect(screen.getByText('26 baris toko/SKU')).toBeTruthy();
    expect(screen.getByText('Halaman 1 dari 2')).toBeTruthy();
    expect(screen.queryByText(/Total seluruh hasil filter/)).toBeNull();
    expect(screen.queryByText(/9007199254741743|9.007.199.254.741.743/)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Berikutnya'}));
    await screen.findByText('ZZZ-LAST');
    expect(screen.getByText('26 baris toko/SKU')).toBeTruthy();
    expect(stockNumbers('ZZZ-LAST')).toEqual(['9.007.199.254.740.993','0','0','0','9.007.199.254.740.993']);
});
// docs/ui-design-guidelines.md requires table data at least 14px.
test('documented readability contract: stock quantity typography remains at least 14px', async () => {
    const style=document.createElement('style');
    style.textContent=stockTableCss+'\n.ui-summary-list dd { font-size: 16px; }';
    document.head.append(style);
    try {
        stockFixture(1);mountApp(<App/>,`/athel/co/stock?customer=${customer}`);
        const table=await screen.findByRole('table',{name:'Stok pelanggan tercatat'});
        expect(table.querySelectorAll('td.co-stock-number')).toHaveLength(5);
        expect(getComputedStyle(table).fontSize).toBe('14px');
    } finally {style.remove();}
});
