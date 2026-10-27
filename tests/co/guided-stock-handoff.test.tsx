import { fireEvent, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { customer, id, mountApp, stockFixture } from './stock-ui-harness';
import App from '../../src/App';

test('stock sale handoff carries selected customer without historical month and keeps returns separate', async () => {
    const s = stockFixture();
    const { router } = mountApp(<App/>, `/athel/co/stock?customer=${customer}&month=2026-09`);
    const link = await screen.findByRole('link', { name: 'Catat penjualan' });
    expect(link.getAttribute('href')).toBe(`/athel/co/reports?customer=${customer}`);
    expect(link.classList.contains('ui-action--primary')).toBe(true);
    const returns = screen.getByRole('group', { name: 'Pengembalian barang' });
    expect(within(returns).getByRole('button', { name: 'Retur barang belum terjual' })).toBeTruthy();
    expect(returns.contains(link)).toBe(false);
    await screen.findByRole('table',{name:'Stok pelanggan tercatat'});
    expect(screen.queryByText(/Total seluruh hasil filter/)).toBeNull();
    expect(screen.queryByText(/Barang diterima/)).toBeNull();
    fireEvent.click(link);
    await screen.findByRole('combobox',{name:'Pelanggan'});
    expect(router.state.location.search).toBe(`?customer=${customer}`);
    expect((screen.getByRole('combobox',{name:'Pelanggan'}) as HTMLInputElement).value).toBe('Store A');
    expect((screen.getByLabelText('Bulan laporan') as HTMLInputElement).value).toBe('');
    expect(s.commands).toHaveLength(0); expect(s.report.commands).toHaveLength(0);
});

test('all-customer stock sale actions use each record customer and never infer a report month', async () => {
    const s = stockFixture(); const rows = s.stockRows;
    s.stockRows = () => rows().map((row: any, i: number) => ({ ...row, customer_id: i === 0 ? customer : id(50) }));
    mountApp(<App/>, '/athel/co/stock?month=2026-09');
    const links = await screen.findAllByRole('link', { name: /Catat penjualan/ });
    expect(links.map(link => link.getAttribute('href'))).toEqual([`/athel/co/reports?customer=${customer}`, `/athel/co/reports?customer=${id(50)}`]);
    expect(screen.queryByRole('button', { name: 'Retur barang belum terjual' })).toBeNull();
    expect(s.commands).toHaveLength(0); expect(s.report.commands).toHaveLength(0);
});
