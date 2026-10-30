import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ids, line, mount, mountRoutes, state, product, addProduct, change } from '../co/ui-harness';
import COOrders from '../../src/pages/athel/co/COOrders';
import COForm from '../../src/pages/athel/co/COForm';
import COLayout from '../../src/pages/athel/co/COLayout';
import COStatusActions, { COCancelDialog } from '../../src/components/co/COStatusActions';
import CODeliveryDialog from '../../src/components/co/CODeliveryDialog';
import { CO_INPUT, COPagination } from '../../src/components/co/COShared';

const { default: ActualAthelNav } = await vi.importActual<typeof import('../../src/components/AthelNav')>('../../src/components/AthelNav');
// The shared CO harness suppresses navigation; include its real replacement for layout integration.
const NavigatedLayout = () => <><ActualAthelNav/><COLayout/></>;

const compact = (node: HTMLElement, variant: string) => {
    expect(node.classList.contains('ui-action--compact')).toBe(true);
    expect(node.classList.contains(`ui-action--${variant}`)).toBe(true);
};

test('CO pilot keeps balanced filters, seven columns, and compact detail navigation in both presentations', async () => {
    mount(<COOrders/>, '/athel/co/list');
    const views = await screen.findAllByRole('link', { name: 'Lihat CO' });
    expect(views).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Ubah' })).toBeNull();
    for (const view of screen.getAllByRole('link', { name: 'Lihat CO' })) {
        compact(view, 'quiet');
        expect(view.getAttribute('href')).toBe(`/athel/co/${ids.co}`);
        expect(view.parentElement?.classList.contains('flex-wrap')).toBe(true);
        expect(view.parentElement?.classList.contains('items-center')).toBe(true);
    }
    expect(views[0].closest('td')?.classList.contains('min-w-36')).toBe(true);
    expect(screen.getByRole('link', { name: 'Buat CO' }).classList.contains('ui-action--primary')).toBe(true);
    expect(screen.getAllByRole('columnheader').map(n => n.textContent)).toEqual(['Nomor CO', 'Toko', 'Tanggal CO', 'Status', 'Jumlah SKU', 'Nilai CO', 'Aksi']);
    expect(screen.getByRole('table').classList.contains('min-w-[56rem]')).toBe(true);
    expect(screen.getByRole('region', { name: 'Daftar CO' }).tabIndex).toBe(0);
    for (const [label, basis] of [['Cari CO', 'basis-72'], ['Status CO', 'basis-44'], ['Filter pelanggan', 'basis-60']]) {
        const field = screen.getByLabelText(label).closest('.ui-field')!;
        expect(field.classList.contains('flex-1'), label).toBe(true);
        expect(field.classList.contains(basis), label).toBe(true);
    }
    fireEvent.change(screen.getByLabelText('Status CO'), { target: { value: 'closed' } });
    await waitFor(() => expect(state.page).toHaveBeenCalledWith(expect.objectContaining({ p_status: 'closed', p_page: 1 })));
    expect(state.commands).toHaveLength(0);
});

test('CO fields retain responsive density, saved manual editing and compact catalogue line removal', async () => {
    expect(CO_INPUT.split(' ')).toContain('ui-control');
    for (const override of ['min-h-11', 'px-3', 'py-2', 'text-base']) expect(CO_INPUT.split(' ')).not.toContain(override);
    state.products = [product(2)];
    mount(<COForm mode="edit"/>);
    const quantity = await screen.findByLabelText('Qty Item 1');
    expect(quantity.classList.contains('ui-control')).toBe(true);
    fireEvent.change(quantity, { target: { value: '3' } });
    expect((quantity as HTMLInputElement).value).toBe('3');
    expect(state.lines[0].product_id).toBeNull();
    compact(screen.getByRole('button', { name: 'Hapus Item 1' }), 'danger-quiet');
    expect(screen.getByRole('button', { name: 'Simpan Perubahan' }).classList.contains('ui-action--primary')).toBe(true);
    for (const name of ['Kembali', 'Batal']) compact(screen.getByRole('link', { name }), 'quiet');
    expect(screen.queryByRole('button', { name: 'Tambah barang manual' })).toBeNull();
    const search = await addProduct('SKU-2');
    await screen.findByDisplayValue('Product 2');
    await waitFor(() => expect(document.activeElement).toBe(search));
    for (const label of ['SKU Product 2', 'Nama produk Product 2', 'Qty Product 2', 'Harga satuan Product 2'])
        expect(screen.getByLabelText(label).classList.contains('ui-control')).toBe(true);
    expect(screen.getByLabelText('Nama produk Product 2').matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Harga satuan Product 2').matches(':disabled')).toBe(false);
    change('Harga satuan Product 2', '12.50');
    expect((screen.getByLabelText('Harga satuan Product 2') as HTMLInputElement).value).toBe('12.50');
    const remove = screen.getByRole('button', { name: 'Hapus Product 2' });
    compact(remove, 'danger-quiet'); fireEvent.click(remove);
    expect(screen.queryByDisplayValue('Product 2')).toBeNull();
    expect((screen.getByLabelText('Qty Item 1') as HTMLInputElement).value).toBe('3');
    expect(state.commands).toHaveLength(0);
});

test('CO status commands distinguish one delivery progression from quiet routing and destructive openers', () => {
    const onCancel = vi.fn();
    mount(<COStatusActions co={state.header} id={ids.co} customerId={ids.customer} allowed={['edit_co', 'save_sj_draft', 'cancel_co', 'resolve_undelivered', 'close_co']} blockers={state.header.close_blockers} pending={false} onSJ={vi.fn()} onCancel={onCancel} onResolve={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByRole('button', { name: 'Buat surat jalan' }).classList.contains('ui-action--primary')).toBe(true);
    for (const name of ['Edit CO', 'Lihat laporan bulanan', 'Lihat stok toko']) compact(screen.getByRole('link', { name }), 'secondary');
    const toggle=screen.getByRole('button',{name:'Actions'});
    expect(screen.queryByRole('button',{name:'Batalkan CO'})).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(toggle,{key:'Escape'});
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    compact(screen.getByRole('link',{name:'Retur barang belum terjual'}),'secondary');
    expect(screen.getByRole('button', { name: 'Tutup CO' }).matches(':disabled')).toBe(true);
    const cancel = screen.getByRole('button', { name: 'Batalkan CO' });
    compact(cancel, 'danger-quiet'); fireEvent.click(cancel); expect(onCancel).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
});

test('CO cancellation retains deliberate final danger and quiet native dismissal', () => {
    mount(<COCancelDialog editorKey="compact-cancel" pending={false} error="" returnFocus={null} onClose={vi.fn()} onConfirm={vi.fn()}/>);
    const dialog = screen.getByRole('dialog', { name: 'Batalkan CO?' });
    compact(within(dialog).getByRole('button', { name: 'Batal' }), 'quiet');
    const confirm = within(dialog).getByRole('button', { name: 'Konfirmasi pembatalan' });
    expect(confirm.classList.contains('ui-action--danger')).toBe(true);
    expect(confirm.matches(':disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Alasan pembatalan'), { target: { value: 'Explicit cancellation' } });
    expect(confirm.matches(':disabled')).toBe(false);
});

test('CO pagination is compact support and preserves pending and exact page bounds for Sales consumers', () => {
    const onPage = vi.fn();
    const view = render(<COPagination page={1} total="9007199254740993" pending onPage={onPage}/>);
    for (const name of ['Sebelumnya', 'Berikutnya']) {
        const button = screen.getByRole('button', { name }); compact(button, 'quiet');
        expect(button.matches(':disabled')).toBe(true); fireEvent.click(button);
    }
    expect(onPage).not.toHaveBeenCalled();
    view.rerender(<COPagination page={1} total="9007199254740993" pending={false} onPage={onPage}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' })); expect(onPage).toHaveBeenCalledWith(2);
    expect(screen.getByText('Halaman 1 dari 450.359.962.737.050')).toBeTruthy();
});

test('CO sidebar navigation retains native destinations and selected-page semantics', () => {
    mountRoutes([{ path: '/athel/co', element: <NavigatedLayout/>, children: [{ path: 'reports', element: <p>Reports</p> }] }], '/athel/co/reports');
    const nav = screen.getByRole('navigation', { name: 'Navigasi Procurement' });
    for (const link of within(nav).getAllByRole('link')) expect(link.classList.contains('navigation-link')).toBe(true);
    expect(within(nav).getByRole('link', { name: 'Laporan Penjualan Bulanan' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Stok Pelanggan' }).getAttribute('href')).toBe('/athel/co/stock');
});

test.each([true, false])('saved SJ emphasizes the existing %s prepared-review stage while direct Post remains available', async prepared => {
    state.drafts = [{ id: ids.draft, mode: 'new_delivery', sj_number: 'SJ-A', sj_date: '2026-10-09', received_date: null, notes: null, draft_version: '1', preparation_ready: prepared, bindings_current: true, consumed: false }];
    state.draftLines = [{ ...line(), co_line_id: line().id, quantity: '1', source_available: true }];
    mount(<CODeliveryDialog co={state.header} draftId={ids.draft} returnFocus={null} onClose={vi.fn()}/>);
    await screen.findByDisplayValue('SJ-A');
    const save = screen.getByRole('button', { name: 'Simpan Draft SJ' });
    const post = screen.getByRole('button', { name: 'Catat pengiriman' });
    const review = screen.getByRole('button', { name: 'Tinjau perubahan SJ' });
    expect(save.classList.contains('ui-action--secondary')).toBe(true);
    expect(post.classList.contains(prepared ? 'ui-action--secondary' : 'ui-action--primary')).toBe(true);
    expect(review.classList.contains(prepared ? 'ui-action--primary' : 'ui-action--secondary')).toBe(true);
    expect(post.matches(':disabled')).toBe(false);
    expect(review.matches(':disabled')).toBe(!prepared);
    fireEvent.change(screen.getByLabelText('Catatan SJ'), { target: { value: 'Retained local draft' } });
    expect(save.classList.contains('ui-action--primary')).toBe(true);
    expect(post.matches(':disabled')).toBe(true);
    expect(review.matches(':disabled')).toBe(true);
    expect(state.commands).toHaveLength(0);
});

test('saved SJ keeps Save primary when server authority permits no publication step', async () => {
    state.header.allowed_operations = ['save_sj_draft'];
    state.drafts = [{ id: ids.draft, mode: 'new_delivery', sj_number: 'Save only', sj_date: '2026-10-09', received_date: null, notes: null, draft_version: '1', preparation_ready: true, bindings_current: true, consumed: false }];
    state.draftLines = [{ ...line(), co_line_id: line().id, quantity: '1', source_available: true }];
    mount(<CODeliveryDialog co={state.header} draftId={ids.draft} returnFocus={null} onClose={vi.fn()}/>);
    await screen.findByDisplayValue('Save only');
    expect(screen.getByRole('button', { name: 'Simpan Draft SJ' }).classList.contains('ui-action--primary')).toBe(true);
    expect(screen.getByRole('button', { name: 'Tinjau perubahan SJ' }).classList.contains('ui-action--secondary')).toBe(true);
    expect(screen.getByRole('button', { name: 'Catat pengiriman' }).matches(':disabled')).toBe(true);
    expect(state.commands).toHaveLength(0);
});
