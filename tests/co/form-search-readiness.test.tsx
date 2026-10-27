import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { mount, state, product, change } from './ui-harness';
import * as rpc from '../../src/lib/co/rpc';
import COForm from '../../src/pages/athel/co/COForm';

const lookup = () => screen.getByRole('combobox', { name: 'Cari SKU atau nama barang' }) as HTMLInputElement;
async function selectCustomer() {
    const input = await screen.findByRole('combobox', { name: 'Pelanggan' });
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'Store A' } });
    fireEvent.click(await screen.findByRole('option', { name: /Store A/ }));
}

test('create fetches each complete catalogue once, including all 250-row pages', async () => {
    state.products = Array.from({ length: 501 }, (_, i) => product(i + 1));
    mount(<COForm mode="create" />, '/athel/co/new');
    await selectCustomer();
    await waitFor(() => expect(state.catalogueRPC.mock.calls.filter(([,a]) => a.p_kind === 'product' && a.p_page === 3).length).toBeGreaterThan(0));
    const pages = state.catalogueRPC.mock.calls.filter(([,a]) => a.p_kind === 'product').map(([,a]) => a.p_page);
    expect(pages).toEqual([1, 2, 3]);
    expect(state.catalogueRPC.mock.calls.filter(([,a]) => a.p_kind === 'customer')).toHaveLength(1);
});

test('SKU search accepts typing before choosing customer, with explicit guidance and no additions', async () => {
    mount(<COForm mode="create" />, '/athel/co/new');
    await screen.findByRole('combobox', { name: 'Cari SKU atau nama barang' });
    expect(lookup().disabled).toBe(false);
    expect(screen.getByText('Pilih pelanggan sebelum menambahkan barang.')).toBeTruthy();
    fireEvent.change(lookup(), { target: { value: 'SKU-1' } });
    fireEvent.keyDown(lookup(), { key: 'Enter' });
    expect(lookup().value).toBe('SKU-1');
    expect(screen.queryByDisplayValue('Product 1')).toBeNull();
    expect(state.commands).toHaveLength(0);
});

test('slow customer check allows typing but prevents selection until current version is ready', async () => {
    let release!: (value: any) => void;
    vi.spyOn(rpc, 'fetchCOCustomerStock').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const resolveKey = vi.spyOn(rpc, 'resolveCOStockKey');
    mount(<COForm mode="create" />, '/athel/co/new');
    await selectCustomer();
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(lookup().disabled).toBe(false);
    lookup().focus();
    fireEvent.change(lookup(), { target: { value: 'SKU-1' } });
    expect(screen.getByText('Memeriksa data pelanggan… Anda tetap dapat mencari barang.')).toBeTruthy();
    const option = await screen.findByRole('option', { name: /Product 1/ });
    expect((option as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(option); fireEvent.keyDown(lookup(), { key: 'Enter' });
    expect(lookup().value).toBe('SKU-1'); expect(resolveKey).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Simpan CO' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release({ customer_version: '1', rows: [], total: '0' }));
    await waitFor(() => expect((screen.getByRole('option', { name: /Product 1/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(lookup().value).toBe('SKU-1'); expect(document.activeElement).toBe(lookup());
    fireEvent.keyDown(lookup(), { key: 'Enter' });
    await screen.findByDisplayValue('Product 1');
});

test('catalogue refresh preserves search/focus, blocks stale choices, and explains failed refresh', async () => {
    const { client } = mount(<COForm mode="create" />, '/athel/co/new');
    await selectCustomer();
    await waitFor(() => expect(state.catalogueRPC.mock.calls.length).toBeGreaterThan(0));
    lookup().focus(); fireEvent.change(lookup(), { target: { value: 'SKU-1' } });
    await screen.findByRole('option', { name: /Product 1/ });
    const valid = state.catalogueRPC.getMockImplementation()!;
    let reject!: (e: Error) => void;
    state.catalogueRPC.mockImplementation((name, args) => args.p_kind === 'product' ? new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }) : valid(name, args));
    act(() => { void client.invalidateQueries({ queryKey: ['catalogue'] }); });
    await waitFor(() => expect(reject).toBeTypeOf('function'));
    expect(lookup().disabled).toBe(false); expect(lookup().value).toBe('SKU-1'); expect(document.activeElement).toBe(lookup());
    expect(screen.getByText('Memuat katalog barang… Anda tetap dapat mengetik pencarian.')).toBeTruthy();
    // Fetch-start invalidates the accepted catalogue envelope, so stale options
    // are absent, not merely disabled. The native runner must assert this state.
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(document.querySelectorAll('[data-co-line]')).toHaveLength(0);
    const stockReads = vi.spyOn(rpc, 'resolveCOStockKey');
    fireEvent.keyDown(lookup(), { key: 'Enter' }); expect(screen.queryByDisplayValue('Product 1')).toBeNull();
    expect(stockReads).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-co-line]')).toHaveLength(0);
    await act(async () => reject(new Error('Offline catalogue')));
    expect(await screen.findByText('Katalog barang gagal dimuat. Coba lagi untuk memilih barang.')).toBeTruthy();
    expect(lookup().value).toBe('SKU-1'); expect(state.commands).toHaveLength(0);
    state.catalogueRPC.mockImplementation(valid);
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang pilihan barang' }));
    await waitFor(() => expect((screen.getByRole('option', { name: /Product 1/ }) as HTMLButtonElement).disabled).toBe(false));
});
