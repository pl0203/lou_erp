import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { mount, state, ids, uuid, line, product, chooseCustomer, addProduct, change } from './ui-harness';
import COForm from '../../src/pages/athel/co/COForm';
import { coKeys } from '../../src/lib/co/queryKeys';
import { COConflictError } from '../../src/lib/co/rpc';
import * as rpc from '../../src/lib/co/rpc';
async function create() { mount(<COForm mode="create"/>, '/athel/co/new'); await chooseCustomer(); change('Nomor CO', 'CO-NEW'); }
test('unique exact lookup adds once, preserves search focus, and consumes IME/repeated Enter', async () => { await create(); const input = await addProduct(); await screen.findByDisplayValue('Product 1'); await waitFor(() => expect(document.activeElement).toBe(input)); fireEvent.keyDown(input, { key: 'Enter', repeat: true }); fireEvent.change(input, { target: { value: 'SKU-1' } }); fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 }); expect(screen.getAllByDisplayValue('Product 1')).toHaveLength(1); expect(state.commands).toHaveLength(0); });
test('complete lookup finds product 1001 and ambiguous SKU requires arrows', async () => { state.products = Array.from({ length: 1001 }, (_, i) => product(i + 1)); await create(); await addProduct('SKU-1001'); await screen.findByDisplayValue('Product 1001'); expect(state.commands).toHaveLength(0); });
test('duplicate normalized SKU focuses quantity and retains manual price', async () => { await create(); await addProduct(); const qty = await screen.findByLabelText('Qty Product 1'); change('Qty Product 1', '7'); change('Harga satuan Product 1', '40.25'); await addProduct(' sku-1 '); await waitFor(() => expect(document.activeElement).toBe(qty)); expect((qty as HTMLInputElement).value).toBe('7'); expect((screen.getByLabelText('Harga satuan Product 1') as HTMLInputElement).value).toBe('40.25'); });
test('missing price blocks and explicit zero saves exact decimal text', async () => { state.products[0].luar_kota = null; await create(); await addProduct(); await screen.findByDisplayValue('Product 1'); fireEvent.click(screen.getByRole('button', { name: 'Simpan CO' })); await screen.findAllByText(/Harga wajib diisi/); expect(state.commands).toHaveLength(0); change('Harga satuan Product 1', '0.00'); fireEvent.click(screen.getByRole('button', { name: 'Simpan CO' })); await waitFor(() => expect(state.commands).toHaveLength(1)); expect(state.commands[0].payload.lines[0].unit_price).toBe('0.00'); });
test('manual SKU supports unknown identity and exact large planned amount', async () => { await create(); fireEvent.click(screen.getByRole('button', { name: 'Tambah barang manual' })); change('Nama produk barang baru', 'Manual'); change('SKU Manual', 'UNKNOWN'); change('Qty Manual', '2147483647'); change('Harga satuan Manual', '999999999999.99'); expect(await screen.findAllByText(/2\.147\.483\.646\.999\.978\.525\.163,53/)).toHaveLength(2); fireEvent.click(screen.getByRole('button', { name: 'Simpan CO' })); await waitFor(() => expect(state.commands).toHaveLength(1)); expect(state.commands[0].payload.lines[0].product_id).toBeNull(); });
test('existing stock identity requires explicit reuse and preserves historic identity', async () => { state.keys = [{ id: uuid(10001), normalized_sku: 'sku-1', display_sku: 'SKU-1', product_name: 'Historical key', product_id: null }]; await create(); await addProduct(); await screen.findByText(/SKU sudah memiliki identitas stok/); expect(screen.queryByDisplayValue('Product 1')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Gunakan identitas stok lama' })); await screen.findByDisplayValue('Historical key'); fireEvent.click(screen.getByRole('button', { name: 'Simpan CO' })); await waitFor(() => expect(state.commands).toHaveLength(1)); expect(state.commands[0].payload.lines[0].stock_key_id).toBe(uuid(10001)); expect(state.commands[0].payload.lines[0].product_id).toBeNull(); });
test('edit preserves all 601 identities while only quantities are editable', async () => { state.lines = Array.from({ length: 601 }, (_, i) => line(i + 1)); mount(<COForm mode="edit"/>); await screen.findByDisplayValue('Item 1'); expect((screen.getByLabelText('Harga satuan Item 1') as HTMLInputElement).disabled).toBe(true); expect(screen.getByText('Original PIC')).toBeTruthy(); change('Qty Item 1', '3'); fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' })); await waitFor(() => expect(state.commands).toHaveLength(1)); expect(state.commands[0].payload.lines).toHaveLength(601); expect(state.commands[0].payload.lines[600]).toEqual({ id: uuid(601), ordered_quantity: 2 }); expect(state.commands[0].payload.customer_id).toBeUndefined(); });
test('catalog and line read failures disable execution rather than submit partial data', async () => { state.failLines = true; mount(<COForm mode="edit"/>); await screen.findByText('CO changed during pages'); expect(state.commands).toHaveLength(0); expect(screen.queryByRole('button', { name: 'Simpan Perubahan' })).toBeNull(); });
test('ambiguous normalized catalog SKU does not create until explicit option', async () => { state.products = [product(1, 'same'), product(2, 'SAME')]; await create(); const input = await addProduct('same'); expect(screen.queryByDisplayValue('Product 1')).toBeNull(); fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' }); await screen.findByDisplayValue('Product 1'); });
test('removing a preceding new row preserves later row DOM and values', async () => { state.products = [product(1), product(2)]; await create(); await addProduct(); await addProduct('SKU-2'); const qty = await screen.findByLabelText('Qty Product 2'); change('Qty Product 2', '9'); const row = screen.getByDisplayValue('Product 1').closest('[data-co-line]')!; fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Hapus Product 1' })); expect(screen.getByLabelText('Qty Product 2')).toBe(qty); });
test('below-minimum numeric edit focuses quantity rather than price', async () => { state.lines[0].delivered_quantity = '2'; state.lines[0].pending_quantity = '0'; state.lines[0].removable = false; mount(<COForm mode="edit"/>); const qty = await screen.findByLabelText('Qty Item 1'); change('Qty Item 1', '1'); fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' })); await screen.findAllByText(/Jumlah kurang/); expect(document.activeElement).toBe(qty); expect(state.commands).toHaveLength(0); });
test('conflict refresh reads new header before any complete lines are requested',async()=>{state.failLines=true;mount(<COForm mode="edit"/>);await screen.findByText('CO changed during pages');state.header={...state.header,co_version:'2',customer_version:'3'};state.failLines=false;state.complete.mockClear();fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await screen.findByDisplayValue('Item 1');expect(state.complete.mock.calls.every(args=>args[1]==='2'&&args[2]==='3')).toBe(true)})

// Regression: a customer-only version change must not silently rebind this editor's desired set.
test('customer-only version refresh preserves typed values and requires explicit reload', async () => {
    const { client } = mount(<COForm mode="edit"/>);
    await screen.findByDisplayValue('Item 1');
    change('Qty Item 1', '7');
    state.header = { ...state.header, customer_version: '2' };
    await act(async () => { await client.invalidateQueries({ queryKey: coKeys.read({ actorId: ids.actor, role: 'co_admin' }, 'edit-header', { id: ids.co }) }); });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await screen.findByText(/CO atau sumber pelanggan berubah/);
    expect((screen.getByRole('button', { name: 'Simpan Perubahan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByDisplayValue('7')).toBeTruthy();
    expect(state.commands).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }));
    expect(screen.getByDisplayValue('7')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Simpan Perubahan' }) as HTMLButtonElement).disabled).toBe(true);
});
// Regression: changing the rendered page to show an invalid row must also focus that field.
test('save focuses the first invalid quantity after revealing its off-page line', async () => {
    state.lines = Array.from({ length: 101 }, (_, i) => line(i + 1));
    mount(<COForm mode="edit"/>);
    await screen.findByDisplayValue('Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    change('Qty Item 101', '');
    fireEvent.click(screen.getByRole('button', { name: 'Sebelumnya' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    await screen.findAllByText(/Jumlah harus berupa bilangan bulat/);
    expect(document.activeElement).toBe(screen.getByLabelText('Qty Item 101'));
    expect(state.commands).toHaveLength(0);
});
test('save focuses a missing agreed price when the new row is on another page', async () => {
    state.lines = Array.from({ length: 100 }, (_, i) => line(i + 1));
    mount(<COForm mode="edit"/>);
    await screen.findByDisplayValue('Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Tambah barang manual' }));
    change('Nama produk barang baru', 'Manual');
    change('SKU Manual', 'UNKNOWN');
    fireEvent.click(screen.getByRole('button', { name: 'Sebelumnya' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    await screen.findAllByText(/Harga wajib diisi/);
    expect(document.activeElement).toBe(screen.getByLabelText('Harga satuan Manual'));
    expect(state.commands).toHaveLength(0);
});

test('version conflict freezes old-version order saves until an explicit refresh decision', async () => {
    mount(<COForm mode="edit"/>);
    await screen.findByDisplayValue('Item 1');
    change('Qty Item 1', '7');
    state.send.mockRejectedValueOnce(new COConflictError());
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    await screen.findByText(/CO berubah. Muat ulang/);
    expect((screen.getByRole('button', { name: 'Simpan Perubahan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByDisplayValue('7')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }));
    expect(screen.getByDisplayValue('7')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Simpan Perubahan' }) as HTMLButtonElement).disabled).toBe(true);
});

async function staleDirtyEdit() {
    const view = mount(<COForm mode="edit"/>);
    await screen.findByDisplayValue('Item 1');
    change('Catatan', 'Original local work');
    state.header = { ...state.header, customer_version: '2' };
    await act(async () => { await view.client.invalidateQueries({ queryKey: coKeys.read({ actorId: ids.actor, role: 'co_admin' }, 'edit-header', { id: ids.co }) }); });
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    await screen.findByText(/CO atau sumber pelanggan berubah/);
    return view;
}
function expectRefreshFrozen() {
    for (const label of ['Nomor CO', 'Tanggal CO', 'Tanggal akhir CO', 'Catatan', 'Qty Item 1', 'Cari SKU atau nama barang']) {
        expect(screen.getByLabelText(label).matches(':disabled'), label).toBe(true);
    }
    for (const label of ['Tambah barang manual', 'Hapus Item 1', 'Simpan Perubahan']) {
        expect(screen.getByRole('button', { name: label }).matches(':disabled'), label).toBe(true);
    }
}
// Regression: the accepted discard applies only to the draft that existed at the decision.
test('accepted refresh freezes editable values across slow header and complete-line reads', async () => {
    await staleDirtyEdit();
    let headerRelease!: (value: any) => void;
    let linesRelease!: (value: any) => void;
    vi.spyOn(rpc, 'fetchCODetail').mockImplementationOnce(() => new Promise(resolve => { headerRelease = resolve; }));
    vi.spyOn(rpc, 'fetchCompleteCOLines').mockImplementationOnce(() => new Promise(resolve => { linesRelease = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }));
    await waitFor(() => expect(headerRelease).toBeTypeOf('function'));
    expectRefreshFrozen();
    expect(screen.getByDisplayValue('Original local work')).toBeTruthy();
    await act(async () => headerRelease({ co: state.header, allowed_operations: state.header.allowed_operations, close_blockers: state.header.close_blockers }));
    await waitFor(() => expect(linesRelease).toBeTypeOf('function'));
    expectRefreshFrozen();
    await act(async () => linesRelease(state.lines));
    await waitFor(() => expect(screen.getByLabelText('Catatan').matches(':disabled')).toBe(false));
    expect((screen.getByLabelText('Catatan') as HTMLTextAreaElement).value).toBe('');
    change('Catatan', 'New work after completed refresh');
    expect((screen.getByLabelText('Catatan') as HTMLTextAreaElement).value).toBe('New work after completed refresh');
    expect(state.commands).toHaveLength(0);
});

test('late accepted refresh cannot initialize a replacement document generation', async () => {
    const { router } = await staleDirtyEdit();
    let release!: (value: any) => void;
    vi.spyOn(rpc, 'fetchCompleteCOLines').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    const previousLines = state.lines;
    const nextId = uuid(900);
    state.header = { ...state.header, id: nextId, co_number: 'CO-B', notes: 'Second document' };
    state.lines = [{ ...line(2), co_id: nextId }];
    await act(async () => { void router.navigate(`/athel/co/${nextId}/edit`); });
    fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }));
    await screen.findByDisplayValue('CO-B');
    change('Catatan', 'Newer protected generation');
    await act(async () => release(previousLines));
    expect(screen.getByDisplayValue('Newer protected generation')).toBeTruthy();
    expect(screen.getByDisplayValue('CO-B')).toBeTruthy();
    expect(screen.queryByDisplayValue('Item 1')).toBeNull();
    expect(router.state.location.pathname).toBe(`/athel/co/${nextId}/edit`);
});

async function manualCollision() {
    state.keys = [{ id: uuid(10001), normalized_sku: 'sku-1', display_sku: 'SKU-1', product_name: 'Historical key', product_id: null }];
    const view = mount(<COForm mode="create"/>, '/athel/co/new');
    await chooseCustomer();
    change('Nomor CO', 'CO-NEW');
    fireEvent.click(screen.getByRole('button', { name: 'Tambah barang manual' }));
    change('Nama produk barang baru', 'Manual');
    change('SKU Manual', 'SKU-1');
    change('Harga satuan Manual', '10.00');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan CO' }));
    await screen.findByText(/SKU sudah memiliki identitas stok/);
    await waitFor(() => expect(screen.getByLabelText('Qty Manual').matches(':disabled')).toBe(false));
    return view;
}
// Regression: accepting identity must not restore the discovery-time quantity or price snapshot.
test.each([['quantity', '7', '10.00'], ['price', '1', '40.25'], ['both', '7', '40.25']])('stock-key reuse preserves intervening %s edits and the stable row', async (_kind, quantity, price) => {
    await manualCollision();
    const qty = screen.getByLabelText('Qty Manual');
    const row = qty.closest('[data-co-line]');
    change('Qty Manual', quantity);
    change('Harga satuan Manual', price);
    fireEvent.click(screen.getByRole('button', { name: 'Gunakan identitas stok lama' }));
    const reusedQty = await screen.findByLabelText('Qty Historical key');
    expect((reusedQty as HTMLInputElement).value).toBe(quantity);
    expect((screen.getByLabelText('Harga satuan Historical key') as HTMLInputElement).value).toBe(price);
    expect(reusedQty).toBe(qty);
    expect(reusedQty.closest('[data-co-line]')).toBe(row);
    fireEvent.click(screen.getByRole('button', { name: 'Simpan CO' }));
    await waitFor(() => expect(state.commands).toHaveLength(1));
    expect(state.commands[0].payload.lines[0]).toMatchObject({ id: row?.getAttribute('data-co-line'), ordered_quantity: Number(quantity), unit_price: price, stock_key_id: uuid(10001), product_id: null });
});

test.each(['changed SKU', 'removed row'])('stale reuse choice rejects a %s', async kind => {
    await manualCollision();
    if (kind === 'changed SKU') change('SKU Manual', 'OTHER-SKU');
    else fireEvent.click(screen.getByRole('button', { name: 'Hapus Manual' }));
    const choice = screen.queryByRole('button', { name: 'Gunakan identitas stok lama' });
    if (choice) fireEvent.click(choice);
    expect(screen.queryByDisplayValue('Historical key')).toBeNull();
    expect(screen.queryByText(/harga kesepakatan dipertahankan/)).toBeNull();
    if (kind === 'changed SKU') expect(screen.getByDisplayValue('OTHER-SKU')).toBeTruthy();
    else expect(screen.getByText(/Belum ada barang/)).toBeTruthy();
    expect(state.commands).toHaveLength(0);
});

test('changing customer discards the old stock identity choice and manual row', async () => {
    state.customers.push({ id: uuid(800), name: 'Store B', pricing_tier: 'luar_kota' });
    await manualCollision();
    const customer = screen.getByRole('combobox', { name: 'Pelanggan' });
    fireEvent.change(customer, { target: { value: 'Store B' } });
    fireEvent.click(await screen.findByRole('option', { name: /Store B/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gunakan identitas stok lama' })).toBeNull());
    expect(screen.queryByDisplayValue('Manual')).toBeNull();
    expect((customer as HTMLInputElement).value).toBe('Store B');
});

test.each(['pending', 'unresolved', 'not ready'] as const)('reuse is frozen when the editor is %s', async kind => {
    const { client } = await manualCollision();
    let release: (() => void) | undefined;
    if (kind === 'pending') {
        vi.spyOn(rpc, 'resolveCOStockKey').mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(null); }));
        state.products.push(product(2));
        await act(async () => { await client.invalidateQueries({ queryKey: coKeys.read({ actorId: ids.actor, role: 'co_admin' }, 'catalog', {}) }); });
        await addProduct('SKU-2');
        await waitFor(() => expect(release).toBeTypeOf('function'));
    } else {
        if (kind === 'unresolved') state.unresolved = true;
        else state.failCatalog = true;
        await act(async () => { await client.invalidateQueries({ queryKey: coKeys.read({ actorId: ids.actor, role: 'co_admin' }, 'catalog', {}) }); });
    }
    const choice = screen.getByRole('button', { name: 'Gunakan identitas stok lama' });
    await waitFor(() => expect(choice.matches(':disabled')).toBe(true));
    fireEvent.click(choice);
    expect(screen.queryByDisplayValue('Historical key')).toBeNull();
    expect(screen.getByDisplayValue('Manual')).toBeTruthy();
    if (release) await act(async () => release!());
    expect(state.commands).toHaveLength(0);
});

test('reuse rejects a stock identity checked against an older customer version', async () => {
    const { client } = await manualCollision();
    vi.spyOn(rpc, 'fetchCOCustomerStock').mockResolvedValue({ customer_version: '2', rows: state.keys, total: '1' } as any);
    await act(async () => { await client.invalidateQueries({ queryKey: coKeys.identity({ actorId: ids.actor, role: 'co_admin' }), predicate: query => query.queryKey[4] === 'customer-binding' }); });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    fireEvent.click(screen.getByRole('button', { name: 'Gunakan identitas stok lama' }));
    expect(screen.queryByDisplayValue('Historical key')).toBeNull();
    expect(screen.getByDisplayValue('Manual')).toBeTruthy();
    expect(state.commands).toHaveLength(0);
});

test('accepted refresh freezes conflicting recovery controls until its read completes', async () => {
    const { client } = await staleDirtyEdit();
    let release!: (value: any) => void;
    vi.spyOn(rpc, 'fetchCompleteCOLines').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    state.unresolved = true;
    await act(async () => { await client.invalidateQueries({ queryKey: coKeys.read({ actorId: ids.actor, role: 'co_admin' }, 'catalog', {}) }); });
    const recovery = await screen.findByRole('button', { name: 'Pulihkan hasil penyimpanan' });
    expect(recovery.matches(':disabled')).toBe(true);
    fireEvent.click(recovery);
    expect(state.reconcile).not.toHaveBeenCalled();
    await act(async () => release(state.lines));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }).matches(':disabled')).toBe(false));
});
