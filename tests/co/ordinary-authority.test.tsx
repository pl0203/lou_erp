import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { mount, mountRoutes, state, ids, change } from './ui-harness';
import COForm from '../../src/pages/athel/co/COForm';
import CODetail from '../../src/pages/athel/co/CODetail';
import COOrders from '../../src/pages/athel/co/COOrders';
import * as rpc from '../../src/lib/co/rpc';
import { coKeys } from '../../src/lib/co/queryKeys';
const denial = () => Object.assign(new Error('Confirmed source denial'), { code: '42501' });
afterEach(() => vi.restoreAllMocks());
async function click(name: string) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.matches(':disabled')).toBe(false));
    fireEvent.click(button);
}
function privateCache(client: ReturnType<typeof mount>['client']) {
    return client.getQueriesData({ queryKey: coKeys.identity({ actorId: ids.actor, role: 'co_admin' }) }).filter(([, data]) => data !== undefined);
}
test.each(['edit', 'sj', 'cancel'] as const)('%s transaction denial unmounts every private field and cache until explicit retry', async kind => {
    const { client } = mount(kind === 'edit' ? <COForm mode="edit"/> : <CODetail/>, `/athel/co/${ids.co}${kind === 'edit' ? '/edit' : ''}`);
    const privateSentinel = kind === 'edit' ? 'Original PIC' : 'CO-A';
    await screen.findByText(privateSentinel);
    if (kind === 'edit') { await screen.findByDisplayValue('Item 1'); change('Catatan', 'PRIVATE ORDER'); }
    else {
        if (kind === 'cancel') await click('Actions');
        await click(kind === 'sj' ? 'Buat surat jalan' : 'Batalkan CO');
        fireEvent.change(await screen.findByLabelText(kind === 'sj' ? 'Nomor SJ' : 'Alasan pembatalan'), { target: { value: 'PRIVATE OPERATION' } });
        if (kind === 'sj') change('Jumlah dikirim Item 1', '1');
    }
    const read = vi.spyOn(rpc, 'fetchCODetail');
    state.send.mockRejectedValue(denial());
    await click(kind === 'edit' ? 'Simpan Perubahan' : kind === 'sj' ? 'Simpan Draft SJ' : 'Konfirmasi pembatalan');
    await screen.findByText('Confirmed source denial');
    expect(screen.queryByDisplayValue(/PRIVATE/)).toBeNull();
    expect(screen.queryByText(privateSentinel)).toBeNull();
    expect(privateCache(client)).toEqual([]);
    expect(screen.queryByRole('button', { name: /Simpan Perubahan|Simpan Draft SJ|Konfirmasi pembatalan/ })).toBeNull();
    const count = read.mock.calls.length;
    await act(async () => { await client.invalidateQueries({ queryKey: ['co'] }); });
    expect(read).toHaveBeenCalledTimes(count);
    state.send.mockReset();
    await click('Coba lagi');
    await screen.findByText(privateSentinel);
    expect(screen.queryByDisplayValue(/PRIVATE/)).toBeNull();
});
test.each(['edit-header', 'edit-lines', 'sj-preparation', 'detail', 'order-actions', 'orders'] as const)('%s authoritative read denial clears its whole owning source', async resource => {
    const form = resource.startsWith('edit');
    // Inline order-actions RPC was removed; this case now checks its canonical detail owner.
    const orders = resource === 'orders';
    const ownedResource = resource === 'order-actions' ? 'detail' : resource;
    const { client } = resource === 'order-actions'
        ? mountRoutes([{path:'/athel/co',element:<COOrders/>},{path:'/athel/co/:id',element:<CODetail/>}],'/athel/co')
        : mount(form ? <COForm mode="edit"/> : orders ? <COOrders/> : <CODetail/>, `/athel/co/${ids.co}${form ? '/edit' : ''}`);
    if(resource === 'order-actions') {
        fireEvent.click((await screen.findAllByRole('link',{name:'Lihat CO'}))[0]);
        await screen.findByRole('link',{name:'Edit CO'});
    }
    const privateSentinel = form ? 'Original PIC' : orders ? 'Store A' : 'CO-A';
    await screen.findAllByText(privateSentinel);
    if (form) change('Catatan', 'PRIVATE READ');
    if (resource === 'sj-preparation') { await click('Buat surat jalan'); await screen.findByLabelText('Nomor SJ'); }
    const fetcher = vi.spyOn(rpc, resource === 'edit-lines' ? 'fetchCompleteCOLines' : resource === 'orders' ? 'fetchCOPageV2' : 'fetchCODetail').mockRejectedValue(denial());
    await act(async () => { await client.invalidateQueries({ predicate: q => q.queryKey[4] === ownedResource }); });
    await screen.findByText('Confirmed source denial');
    expect(screen.queryByDisplayValue('PRIVATE READ')).toBeNull();
    expect(screen.queryAllByText(privateSentinel)).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Buat CO' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit CO' })).toBeNull();
    expect(privateCache(client)).toEqual([]);
    const count = fetcher.mock.calls.length;
    await act(async () => { await client.invalidateQueries({ queryKey: ['co'] }); });
    expect(fetcher).toHaveBeenCalledTimes(count);
});
test.each(['08006', 'PT409'])('ordinary network/conflict %s preserves private edits', async code => {
    mount(<COForm mode="edit"/>); await screen.findByDisplayValue('Item 1'); change('Catatan', 'Retained input');
    state.send.mockRejectedValue(Object.assign(new Error('Ordinary failure'), { code }));
    await click('Simpan Perubahan'); await screen.findByText('Ordinary failure');
    expect(screen.getByDisplayValue('Retained input')).toBeTruthy(); expect(screen.getByText('Original PIC')).toBeTruthy();
});

test('new order authority denial clears its chosen customer and private new input', async () => {
    const { chooseCustomer, addProduct } = await import('./ui-harness');
    const { client } = mount(<COForm mode="create"/>, '/athel/co/new');
    await chooseCustomer(); change('Nomor CO', 'PRIVATE NEW ORDER'); await addProduct();
    await screen.findByDisplayValue('Product 1'); change('Harga satuan Product 1', '10.00');
    state.send.mockRejectedValue(denial()); await click('Simpan CO'); await screen.findByText('Confirmed source denial');
    expect(screen.queryByDisplayValue('PRIVATE NEW ORDER')).toBeNull(); expect(screen.queryByText('Product 1')).toBeNull();
    expect(privateCache(client)).toEqual([]);
});

test.each(['reconcile', 'acknowledge'] as const)('order recovery %s denial clears private source without a dirty-work escape', async stage => {
    state.unresolved = true;
    const { client } = mount(<COForm mode="edit"/>); await screen.findByDisplayValue('Item 1');
    if (stage === 'reconcile') state.reconcile.mockRejectedValue(denial()); else state.acknowledge.mockRejectedValue(denial());
    await click('Pulihkan hasil penyimpanan');
    if (stage === 'acknowledge') await click('Lihat hasil tersimpan');
    await screen.findByText('Confirmed source denial'); expect(screen.queryByText('Original PIC')).toBeNull();
    expect(privateCache(client)).toEqual([]); expect(state.unresolved).toBe(true);
});

test('ordinary SJ committed canonical import denial clears both dialog and detail', async () => {
    const { client } = mount(<CODetail/>, `/athel/co/${ids.co}`); await screen.findByText('CO-A'); await click('Buat surat jalan');
    await screen.findByLabelText('Nomor SJ'); change('Nomor SJ', 'PRIVATE CANONICAL SJ'); change('Jumlah dikirim Item 1', '1');
    vi.spyOn(rpc, 'fetchCompleteCOSJDraft').mockRejectedValue(denial());
    await click('Simpan Draft SJ'); await screen.findByText('Confirmed source denial');
    expect(screen.queryByDisplayValue('PRIVATE CANONICAL SJ')).toBeNull(); expect(screen.queryByText('CO-A')).toBeNull();
    expect(privateCache(client)).toEqual([]);
});

test('obsolete ordinary command denial cannot clear the replacement owner or cache', async () => {
    const { cleanup } = await import('@testing-library/react');
    let reject!: (reason: unknown) => void;
    state.send.mockImplementation(() => new Promise((_resolve, failure) => { reject = failure; }));
    mount(<COForm mode="edit"/>); await screen.findByDisplayValue('Item 1'); change('Catatan', 'Old private note');
    await click('Simpan Perubahan'); await waitFor(() => expect(reject).toBeTypeOf('function'));
    cleanup(); state.header = { ...state.header, notes: 'Replacement private note' };
    const { client } = mount(<COForm mode="edit"/>); await screen.findByDisplayValue('Replacement private note');
    await act(async () => reject(denial()));
    expect(screen.getByDisplayValue('Replacement private note')).toBeTruthy(); expect(privateCache(client).length).toBeGreaterThan(0);
    expect(screen.queryByText('Confirmed source denial')).toBeNull();
});

test('ordinary source denial aborts an outstanding read and a late success cannot resurrect it', async () => {
    const { client } = mount(<COForm mode="edit"/>); await screen.findByDisplayValue('Item 1');
    let release!: (value: any) => void, signal!: AbortSignal;
    vi.spyOn(rpc, 'fetchCODetail').mockImplementation((_id, _version, options) => {
        signal = options!.signal!;
        return new Promise(resolve => { release = resolve; });
    });
    void client.invalidateQueries({ predicate: q => q.queryKey[4] === 'edit-header' });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    // An independent source read can authoritatively deny while the header is still in flight.
    vi.spyOn(rpc, 'fetchCompleteCOLines').mockRejectedValue(denial());
    await act(async () => { await client.invalidateQueries({ predicate: q => q.queryKey[4] === 'edit-lines' }); });
    await screen.findByText('Confirmed source denial'); expect(signal.aborted).toBe(true);
    await act(async () => release({ co: state.header, allowed_operations: state.header.allowed_operations, close_blockers: state.header.close_blockers }));
    expect(screen.queryByText('Original PIC')).toBeNull(); expect(privateCache(client)).toEqual([]);
});
