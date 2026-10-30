import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { customer, id, mountApp, stockFixture } from '../co/stock-ui-harness';
import App from '../../src/App';
import { LegacyReturnOwner } from '../co/legacy-return-owner';
import { MainContent } from '../../src/components/ui/MainContent';
// Legacy return cases exercise the exported editor, not current App creation routes.

const variant = (node: HTMLElement, value: string) => expect(node.classList.contains(`ui-action--${value}`)).toBe(true);
const click = async (name: string) => {
    const node = await screen.findByRole('button', { name });
    await waitFor(() => expect(node.matches(':disabled')).toBe(false));
    fireEvent.click(node); return node;
};

test('current stock movement and return workspace links retain distinct compact emphasis', async () => {
    const s = stockFixture();
    s.movements = [{ id: id(51), customer_id: customer, stock_key_id: id(1001), generation_id: s.generation, co_line_id: id(3001), batch_id: id(2001), co_id: id(11), effective_date: '2026-09-01', kind: 'delivery', quantity_delta: '30', delivery_revision_line_id: id(5001), return_revision_line_id: null, report_revision_line_id: null }];
    mountApp(<App/>, `/athel/co/stock?customer=${customer}`);
    const history = await screen.findByRole('button', { name: 'Lihat mutasi Store A · SKU-1' });
    variant(history, 'quiet'); expect(history.classList.contains('ui-action--compact')).toBe(true);
    variant(screen.getByRole('button', { name: 'Stok terkini' }), 'quiet');
    variant(screen.getByRole('link', { name: 'Catat penjualan' }), 'primary');
    const returns = screen.getByRole('link', { name: 'Stock Return' });
    expect(returns.getAttribute('href')).toBe('/athel/co/returns');
    variant(returns, 'quiet'); expect(returns.classList.contains('ui-action--compact')).toBe(true);
    fireEvent.click(history);
    const link = await screen.findByRole('link', { name: 'Lihat CO sumber' });
    variant(link, 'secondary'); expect(link.classList.contains('ui-action--compact')).toBe(true);
    expect(link.getAttribute('href')).toBe(`/athel/co/${id(11)}`);
    expect(s.commands).toHaveLength(0);
});

test('legacy return editor save, review, and apply each become the single existing progression emphasis', async () => {
    const s = stockFixture(); mountApp(<MainContent><LegacyReturnOwner state={s}/></MainContent>, `/athel/co/stock?customer=${customer}`);
    await click('Retur barang belum terjual');
    const quantity = await screen.findByLabelText('Jumlah retur SJ-1 Item 1');
    await waitFor(() => expect(quantity.matches(':disabled')).toBe(false));
    const save = screen.getByRole('button', { name: 'Simpan Draft retur' });
    const review = screen.getByRole('button', { name: 'Tinjau / post retur' });
    variant(save, 'primary'); variant(review, 'secondary');
    fireEvent.change(quantity, { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Referensi retur'), { target: { value: 'Compact return' } });
    await click('Simpan Draft retur');
    await waitFor(() => expect(review.matches(':disabled')).toBe(false));
    variant(save, 'secondary'); variant(review, 'primary');
    await click('Tinjau / post retur');
    const reason = await screen.findByLabelText('Alasan perubahan');
    const inspect = screen.getByRole('button', { name: 'Tinjau semua dampak' });
    variant(inspect, 'primary');
    fireEvent.change(reason, { target: { value: 'Explicit reviewed return' } });
    await click('Tinjau semua dampak');
    const apply = await screen.findByRole('button', { name: 'Terapkan perubahan' });
    variant(apply, 'primary'); variant(inspect, 'secondary');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('button').filter(b => !b.matches(':disabled') && b.classList.contains('ui-action--primary'))).toEqual([apply]);
    expect(s.commands).toHaveLength(1);
});
