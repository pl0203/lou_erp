import React from 'react';
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ids, mount, state, uuid } from './ui-harness';
import CODetail from '../../src/pages/athel/co/CODetail';

// Unsuppressed requirement guards, not assumptions that the current redesign is approved.
// Provenance: docs/superpowers/specs/2026-10-09-consignment-orders-approved.txt,
// "Work from the order detail"; baseline order-detail.test.tsx lifecycle/PIC/value checks.
async function detail(search = '') {
    Object.assign(state.header.summary, {
        ordered_quantity: '113', delivered_quantity: '113', pending_quantity: '0',
        delivery_progress: 'complete', sold_quantity: '37', returned_quantity: '19',
        remaining_quantity: '57', planned_value: '1130.00', revenue: '370.00',
    });
    state.header.status = 'active';
    state.header.sales_person_name = 'Historical credited PIC';
    state.header.sales_person_id_at_creation = uuid(901);
    state.customers[0].sales_person_name = 'Current reassigned PIC';
    state.customers[0].sales_person_id = uuid(902);
    mount(<CODetail/>, `/athel/co/${ids.co}${search}`);
    await screen.findByRole('heading', { name: 'CO-A', exact: true });
}

test('approved detail keeps lifecycle active independently of complete delivery', async () => {
    await detail();
    expect(screen.getByText('Terkirim penuh')).toBeTruthy();
    expect(screen.getByText('Aktif', { exact: true })).toBeTruthy();
    expect(screen.queryByText('Ditutup', { exact: true })).toBeNull();
    expect(state.commands).toHaveLength(0);
});

test.each([
    ['delivered', /^(?:Jumlah )?(?:terkirim|dikirim)$/i, '113'],
    ['sold', /^(?:Jumlah )?terjual$/i, '37'],
    ['unsold returned', /^(?:Jumlah )?(?:retur|dikembalikan|retur belum terjual)$/i, '19'],
    ['remaining', /^(?:Stok tercatat|Sisa stok|Jumlah tersisa)$/i, '57'],
] as const)('approved detail exposes independently labeled %s quantity', async (_kind, label, quantity) => {
    await detail();
    const title = screen.getByText(label);
    // An actual displayed label/value pair, never a fixture self-assertion.
    expect(title.nextElementSibling?.textContent).toBe(quantity);
});

test('approved detail displays read-only historical credited PIC, not current reassignment', async () => {
    await detail();
    expect(screen.getByText('Historical credited PIC', { exact: true })).toBeTruthy();
    expect(screen.queryByText('Current reassigned PIC', { exact: true })).toBeNull();
    expect(screen.queryByDisplayValue('Historical credited PIC')).toBeNull();
});

test('approved detail separates planned value from sold revenue', async () => {
    await detail();
    expect(screen.getByText('Nilai rencana CO').nextElementSibling?.textContent).toMatch(/1[.,]130/);
    expect(screen.getByText('Pendapatan terjual').nextElementSibling?.textContent).toMatch(/370/);
});

// Oct26 accepted redesign replaces large reporting panels with links for this toko.
// Reviewed contract: retain direct scoped navigation without duplicate detail panels.
test('approved compact detail links bind stock and monthly reports to this customer', async () => {
    await detail('?customer=00000000-0000-0000-0000-000000000099');
    const report = new URL(screen.getByRole('link', { name: 'Lihat laporan bulanan' }).getAttribute('href')!, 'https://local.test');
    const stock = new URL(screen.getByRole('link', { name: 'Lihat stok toko' }).getAttribute('href')!, 'https://local.test');
    expect(report.pathname).toBe('/athel/co/reports');
    expect(Array.from(report.searchParams.getAll('customer'))).toEqual([ids.customer]);
    expect(report.searchParams.has('co')).toBe(false);
    expect(stock.pathname).toBe('/athel/co/stock');
    expect(stock.searchParams.getAll('customer')).toEqual([ids.customer]);
    expect(stock.searchParams.get('co')).toBe(ids.co);
    expect(state.commands).toHaveLength(0);
});
