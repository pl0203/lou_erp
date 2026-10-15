import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { mount, state, product, line, uuid, chooseCustomer, addProduct, change } from './ui-harness';
import * as rpc from '../../src/lib/co/rpc';
import COForm from '../../src/pages/athel/co/COForm';
async function create() { const view = mount(<COForm mode="create"/>, '/athel/co/new'); await chooseCustomer(); change('Nomor CO', 'CO-CATALOGUE'); return view; }
test('real catalogue hook/backend/decoder supplies enabled complete new-order choices and immutable new identity', async () => {
    state.products = [product(1), { ...product(2), is_enabled: false }];
    await create(); await addProduct(); await screen.findByDisplayValue('Product 1');
    expect(screen.queryByRole('button', { name: 'Tambah barang manual' })).toBeNull();
    expect(screen.getByLabelText('SKU Product 1').matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Nama produk Product 1').matches(':disabled')).toBe(true);
    await addProduct('SKU-2'); expect(screen.queryByRole('option', { name: /Product 2/ })).toBeNull();
    expect(state.catalogueRPC).toHaveBeenCalledWith('pilot_catalog_page_v1', expect.objectContaining({ p_kind: 'product', p_purpose: 'enabled-for-order', p_status: 'enabled' }));
});
test.each([null, '10000000-0000-0000-0000-000000099999'])('new use rejects stock key belonging to %s without changing product identity', async oldProduct => {
    state.keys = [{ id: uuid(10001), normalized_sku: 'sku-1', display_sku: 'SKU-1', product_name: 'Old label', product_id: oldProduct }];
    await create(); await addProduct(); await screen.findByText(/identitas stok lama yang berbeda/);
    expect(screen.queryByRole('button', { name: 'Gunakan identitas stok lama' })).toBeNull();
    expect(screen.queryByDisplayValue('Old label')).toBeNull(); expect(state.commands).toHaveLength(0);
});
test('renamed enabled historical product and manual line retain quantities, saved keys and prices', async () => {
    state.lines = [{ ...line(1), product_id: product(1).id }, line(2)]; state.products = [{ ...product(1), name: 'Renamed', sku: 'NEW-SKU' }];
    mount(<COForm mode="edit"/>); await screen.findByDisplayValue('Item 1');
    change('Qty Item 1', '3'); change('Qty Item 2', '4');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    await waitFor(() => expect(state.commands).toHaveLength(1));
    expect(state.commands[0].payload.lines).toEqual([{ id: uuid(1), ordered_quantity: 3 }, { id: uuid(2), ordered_quantity: 4 }]);
});
test.each(['customer', 'product'] as const)('disabled %s caps saved quantities independently without blocking reductions', async kind => {
    state.lines = [{ ...line(1), product_id: product(1).id }, { ...line(2), ordered_quantity: '7' }];
    if (kind === 'customer') state.customers[0].is_enabled = false; else state.products[0].is_enabled = false;
    mount(<COForm mode="edit"/>); await screen.findByDisplayValue('Item 1');
    change('Qty Item 1', '3'); change('Qty Item 2', '6');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    await screen.findAllByText(/tidak boleh melebihi/); expect(state.commands).toHaveLength(0);
    change('Qty Item 1', '1'); change('Qty Item 2', '8');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    if (kind === 'customer') {
        await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Qty Item 2')));
        expect(state.commands).toHaveLength(0);
        change('Qty Item 2', '7'); fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    }
    await waitFor(() => expect(state.commands).toHaveLength(1));
    expect(state.commands[0].payload.lines).toEqual([{ id: uuid(1), ordered_quantity: 1 }, { id: uuid(2), ordered_quantity: kind === 'customer' ? 7 : 8 }]);
});
test('a product disabled after selection cannot be saved or silently converted to manual', async () => {
    const { client } = await create(); await addProduct(); await screen.findByDisplayValue('Product 1');
    state.products[0].is_enabled = false;
    await act(async () => { await client.invalidateQueries({ queryKey: ['catalogue'] }); });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan CO' }));
    await screen.findAllByText(/katalog aktif/); expect(state.commands).toHaveLength(0);
});
test('malformed catalogue responses never become selectable', async () => {
    state.catalogueRPC.mockResolvedValue({ data: { version: 1, actor_id: uuid(99), rows: [] }, error: null });
    mount(<COForm mode="create"/>, '/athel/co/new');
    await screen.findAllByText(/Data katalog tidak lengkap/);
    expect(screen.getByRole('combobox', { name: 'Pelanggan' }).matches(':disabled')).toBe(true);
    expect(state.commands).toHaveLength(0);
});

test('catalogue disable during an awaited stock-key lookup never admits an obsolete selection', async () => {
    const { client } = await create();
    let release!: (value: any) => void;
    const lookup = vi.spyOn(rpc, 'resolveCOStockKey').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await addProduct(); await waitFor(() => expect(release).toBeTypeOf('function'));
    state.products[0].is_enabled = false;
    await act(async () => { await client.invalidateQueries({ queryKey: ['catalogue'] }); });
    await act(async () => release(null));
    await screen.findAllByText(/katalog aktif/);
    expect(screen.queryByDisplayValue('Product 1')).toBeNull(); expect(state.commands).toHaveLength(0);
    lookup.mockRestore();
});
test('catalogue authority denial clears private draft fields through the existing source boundary', async () => {
    const { client } = await create(); change('Catatan', 'Private catalogue draft');
    state.catalogueRPC.mockRejectedValue(Object.assign(new Error('Catalogue authority required'), { code: '42501' }));
    await act(async () => { await client.invalidateQueries({ queryKey: ['catalogue'] }); });
    await screen.findByText('Catalogue authority required');
    expect(screen.queryByDisplayValue('Private catalogue draft')).toBeNull(); expect(state.commands).toHaveLength(0);
});

test('complete catalogue responses bound to another actor never become selectable', async () => {
    const valid = state.catalogueRPC.getMockImplementation()!;
    state.catalogueRPC.mockImplementation(async (name, args) => {
        const response = await valid(name, args);
        return { ...response, data: { ...response.data, actor_id: uuid(99) } };
    });
    mount(<COForm mode="create"/>, '/athel/co/new');
    await screen.findAllByText(/Data katalog tidak lengkap/);
    expect(screen.getByRole('combobox', { name: 'Pelanggan' }).matches(':disabled')).toBe(true);
    expect(state.commands).toHaveLength(0);
});
