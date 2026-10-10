import React from 'react';
import { expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { customer, id, mount, mountApp, stockFixture, wire } from './stock-ui-harness';
import App from '../../src/App';
import * as catalog from '../../src/lib/co/catalog';
import CODetail from '../../src/pages/athel/co/CODetail';

test('stock route shows current equation, old overdue month and separate partial coverage', async () => {
    stockFixture();
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByRole('heading', { name: 'Customer Stock' });
    await screen.findAllByText('30 + 0 − 0 − 0 = 30');
    expect(screen.getAllByText(/2026-09/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Cakupan.*2026-10-09/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Bulan akhir stok').getAttribute('type')).toBe('month');
});
test('canonical stock-key URL opens movement scope without using UUID as SKU text search', async () => {
    stockFixture();
    mountApp(<App />, `/athel/co/stock?customer=${customer}&sku=${id(1002)}`);
    await screen.findByRole('heading', { name: /Riwayat stok pelanggan\/SKU/ });
    expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_stock_movements_v1' && a.p_stock_key_id === id(1002))).toBe(true);
    expect(wire.rpc.mock.calls.filter(([n]) => n === 'pilot_co_customer_stock_v1').every(([, a]) => a.p_search === '')).toBe(true);
});
test('failed stock read is unavailable rather than recorded zero', async () => {
    const s = stockFixture();
    s.fail = (n: string) => n === 'pilot_co_customer_stock_v1' ? { data: null, error: { code: '08006', message: 'Stock offline' } } : null;
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByText('Stock offline');
    expect(screen.queryByText(/= 0$/)).toBeNull();
});
test('resolution uses reasoned additional quantities and closure has its own reason', async () => {
    const s = stockFixture();
    s.co.summary.sold_quantity = '70'; s.co.summary.remaining_quantity = '0'; s.blockers.stock_remains = false;
    mount(<CODetail />, `/athel/co/${s.co.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Selesaikan sisa belum dikirim' }));
    fireEvent.change(await screen.findByLabelText('Jumlah dibatalkan Item 1'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Alasan penyelesaian'), { target: { value: 'Customer reduced plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi penyelesaian' }));
    await waitFor(() => expect(s.commands[0]).toMatchObject({ op: 'resolve_undelivered', payload: {
        co_id: s.co.id, expected_co_version: '1', expected_customer_version: '1', reason: 'Customer reduced plan', lines: [{ co_line_id: id(3001), quantity: 5 }],
    } }));
    await waitFor(() => expect(screen.queryByLabelText('Alasan penyelesaian')).toBeNull());
    expect(screen.getByRole('button', { name: 'Tutup CO' }).matches(':disabled')).toBe(true);
    expect(s.co.summary.pending_quantity).toBe('25');
    expect(s.co.status).toBe('active');
    fireEvent.click(screen.getByRole('button', { name: 'Selesaikan sisa belum dikirim' }));
    const additional = await screen.findByLabelText('Jumlah dibatalkan Item 1');
    await waitFor(() => expect(additional.matches(':disabled')).toBe(false));
    fireEvent.change(additional, { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Alasan penyelesaian'), { target: { value: 'Cancel remaining plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi penyelesaian' }));
    await waitFor(() => expect(screen.queryByLabelText('Alasan penyelesaian')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tutup CO' }).matches(':disabled')).toBe(false));
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
    const close = await screen.findByRole('button', { name: 'Tutup CO' });
    expect(close.matches(':disabled')).toBe(true);
    fireEvent.click(close);
    expect(s.commands).toHaveLength(0);
});
test('month-end filter is a calendar month end and future month end is refused', async () => {
    stockFixture();
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findAllByText('30 + 0 − 0 − 0 = 30');
    fireEvent.change(screen.getByLabelText('Bulan akhir stok'), { target: { value: '2026-09' } });
    await waitFor(() => expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_customer_stock_v1' && a.p_as_of === '2026-09-30')).toBe(true));
    fireEvent.change(screen.getByLabelText('Bulan akhir stok'), { target: { value: '2026-10' } });
    await screen.findByText(/Pilih akhir bulan yang sudah selesai/);
    expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_customer_stock_v1' && a.p_as_of === '2026-10-31')).toBe(false);
});
test('recorded never-delivered zero remains visible and is qualified', async () => {
    const s = stockFixture(1);
    const rows = s.stockRows();
    Object.assign(rows[0], { opening_quantity: '0', recorded_quantity: '0', has_delivery_history: false });
    s.stockRows = () => rows;
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByText('0 + 0 − 0 − 0 = 0');
    expect(screen.getByText(/Nol tercatat tidak membuktikan saldo fisik awal/)).toBeTruthy();
});

test('movement pagination refuses mixing effective generations and explicit reload starts a new binding', async () => {
    const s = stockFixture(1);
    s.movements = Array.from({ length: 21 }, (_, i) => ({ id: id(50000 + i), customer_id: customer,
        stock_key_id: id(1001), generation_id: s.generation, batch_id: id(2001), co_id: id(11), co_line_id: id(3001),
        kind: 'delivery', quantity_delta: '1', effective_date: '2026-09-01', delivery_revision_line_id: id(51000 + i),
        return_revision_line_id: null, report_revision_line_id: null }));
    mountApp(<App />, `/athel/co/stock?customer=${customer}&sku=${id(1001)}`);
    await screen.findAllByRole('link', { name: 'Bukti CO sumber' });
    s.generation = id(8001); s.movements.forEach((r: any) => r.generation_id = s.generation);
    const next = screen.getAllByRole('button', { name: 'Berikutnya' }).find(b => !b.matches(':disabled'))!;
    fireEvent.click(next);
    await screen.findByText('Riwayat berubah di antara halaman. Muat ulang seluruh riwayat.');
    expect(screen.queryByRole('link', { name: 'Bukti CO sumber' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await screen.findAllByRole('link', { name: 'Bukti CO sumber' });
});
test('stock filters and page totals remain server scoped across more than 100 keys', async () => {
    stockFixture(101);
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await screen.findByText('Halaman 1 dari 6');
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await screen.findByText('SKU-21 · Item 21');
    fireEvent.change(screen.getByLabelText('Cari SKU stok'), { target: { value: 'SKU-101' } });
    await screen.findByText('SKU-101 · Item 101');
    expect(screen.getByText('Halaman 1 dari 1')).toBeTruthy();
    expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_customer_stock_v1' && a.p_search === 'SKU-101' && a.p_page === 1)).toBe(true);
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
    expect(screen.getByText('9007199254740993 + 0 − 0 − 0 = 9007199254740993')).toBeTruthy();
});

test('newer authoritative CO version freezes retained settlement until explicit refresh', async () => {
    const s = stockFixture();
    const { client } = mount(<CODetail />, `/athel/co/${s.co.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Selesaikan sisa belum dikirim' }));
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
    rows.push({ ...rows[0], id: id(1002), customer_id: second, opening_quantity: '7', recorded_quantity: '7' });
    s.stockRows = () => rows;
    const directory = vi.spyOn(catalog, 'fetchCOCustomers').mockResolvedValue([{ id: customer, name: 'Store A', pricing_tier: 'others' }, { id: second, name: 'Store B', pricing_tier: 'others' }]);
    const { router } = mountApp(<App/>, '/athel/co/stock');
    const table = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
    await waitFor(() => expect(table.textContent).toContain('Store A'));
    expect(table.textContent).toContain('Store B');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    for (const row of table.querySelectorAll('tbody tr')) {
        expect(row.className).toContain('md:table-row');
        expect(row.querySelector('td')?.className).toContain('md:table-cell');
    }
    const button = screen.getByRole('button', { name: 'Lihat pergerakan Store B · SKU-1' });
    fireEvent.click(button);
    await waitFor(() => expect(router.state.location.search).toContain(`customer=${second}`));
    expect(router.state.location.search).toContain(`sku=${id(1002)}`);
    directory.mockRestore();
});

test('missing authorized directory identity is explicit on the row and accessible action', async () => {
    const s = stockFixture(1), rows = s.stockRows();
    rows[0].customer_id = id(98); s.stockRows = () => rows;
    mountApp(<App/>, '/athel/co/stock');
    const table = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
    await waitFor(() => expect(table.textContent).toContain('Identitas pelanggan tidak tersedia'));
    expect(screen.getByRole('button', { name: `Lihat pergerakan Identitas pelanggan tidak tersedia (${id(98)}) · SKU-1` })).toBeTruthy();
});
