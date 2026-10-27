import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { mount, mountRoutes, state, ids, product, addProduct, change } from '../co/ui-harness';
import COOrders from '../../src/pages/athel/co/COOrders';
import COForm from '../../src/pages/athel/co/COForm';
import CODetail from '../../src/pages/athel/co/CODetail';
import COLayout from '../../src/pages/athel/co/COLayout';
import COStatusActions, { COCancelDialog } from '../../src/components/co/COStatusActions';
import { CORecoveryPanel, COPagination, COFreshness } from '../../src/components/co/COShared';
import * as auth from '../../src/lib/AuthContext';
import * as rpc from '../../src/lib/co/rpc';
import { supabase } from '../../src/lib/supabase';
import { coKeys } from '../../src/lib/co/queryKeys';
import type { COReceipt } from '../../src/lib/co/contracts';

afterEach(() => vi.restoreAllMocks());
const sharedAction = (node: HTMLElement) => expect(node.classList.contains('ui-action')).toBe(true);

test.each(['co_admin', 'executive'] as const)('orders use shared actions and fresh edit capabilities for %s', async role => {
    const current = auth.useAuth();
    vi.spyOn(auth, 'useAuth').mockReturnValue({ ...current, profile: { ...current.profile!, role } });
    state.header.allowed_operations = [];
    const { router, client } = mountRoutes([{path:'/athel/co/list',element:<COOrders/>},{path:'/athel/co/:id',element:<CODetail/>},{path:'/athel/co/:id/edit',element:<p>Canonical edit destination</p>}], '/athel/co/list');
    const mobile = await screen.findByRole('article');
    expect(screen.queryAllByRole('link', { name: 'Edit' })).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Lihat CO' })).toHaveLength(2);
    sharedAction(screen.getByRole('link', { name: 'Buat CO' }));
    expect(screen.getByRole('region', { name: 'Filter pesanan CO' }).classList.contains('ui-filter-bar')).toBe(true);
    const region = screen.getByRole('region', { name: 'Daftar CO' });
    expect(region.tabIndex).toBe(0);
    expect(region.contains(screen.getByRole('table'))).toBe(true);
    expect(within(mobile).getByText('Nilai CO').nextElementSibling?.textContent).toBe('Rp 20');
    expect(within(mobile).queryByText('Pendapatan terjual')).toBeNull();
    // Task12 ruling: list does not expose unverified capabilities or perform per-row detail reads.
    const view=screen.getAllByRole('link',{name:'Lihat CO'})[0];
    expect(view.getAttribute('href')).toBe(`/athel/co/${ids.co}`);
    fireEvent.click(view);
    await screen.findByRole('heading',{name:'CO-A'});
    expect(screen.queryByRole('link',{name:'Edit CO'})).toBeNull();
    state.header.allowed_operations=['edit_co'];
    await act(async()=>{await client.invalidateQueries({queryKey:coKeys.read({actorId:ids.actor,role},'detail',{id:ids.co})})});
    const link=await screen.findByRole('link',{name:'Edit CO'});sharedAction(link);
    expect(link.getAttribute('href')).toBe(`/athel/co/${ids.co}/edit`);
    let intercepted=true;
    document.addEventListener('click',event=>{intercepted=event.defaultPrevented;event.preventDefault()},{once:true});
    fireEvent.click(link,{ctrlKey:true,button:0});expect(intercepted).toBe(false);
    expect(router.state.location.pathname).toBe(`/athel/co/${ids.co}`);
    fireEvent.click(link);await waitFor(()=>expect(router.state.location.pathname).toBe(`/athel/co/${ids.co}/edit`));
});

test('edit header and lines are read-only when fresh edit_co capability is absent', async () => {
    state.header.allowed_operations = [];
    mount(<COForm mode="edit"/>);
    await screen.findByDisplayValue('Item 1');
    for (const label of ['Nomor CO', 'Tanggal CO', 'Tanggal akhir CO', 'Catatan', 'Qty Item 1']) {
        expect(screen.getByLabelText(label).matches(':disabled'), label).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'Simpan Perubahan' }).matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Nomor CO').closest('.ui-field')).toBeTruthy();
    sharedAction(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    expect(state.commands).toHaveLength(0);
});

test('edit fields retain historical manual identity and exact price while new choices use the catalogue', async () => {
    state.products = [product(2)];
    mount(<COForm mode="edit"/>);
    const name = await screen.findByDisplayValue('Item 1');
    const qty = screen.getByLabelText('Qty Item 1');
    expect(name.closest('[data-co-line]')?.getAttribute('data-co-line')).toBe(state.lines[0].id);
    expect(qty.closest('.ui-field')).toBeTruthy();
    expect((qty as HTMLInputElement).labels?.[0].htmlFor).toBe(qty.id);
    expect(qty.id).toBe(`co-line-${state.lines[0].id}-quantity`);
    expect((screen.getByLabelText('Harga satuan Item 1') as HTMLInputElement).value).toBe('10.00');
    expect(screen.getByLabelText('Harga satuan Item 1').matches(':disabled')).toBe(true);
    expect(state.lines[0].product_id).toBeNull();
    expect(name.matches(':disabled')).toBe(true);
    expect(screen.getByText(/Barang manual lama tetap tersimpan dengan identitas dan harga asli/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tambah barang manual' })).toBeNull();
    change('Qty Item 1', '3');
    const search = await addProduct('SKU-2');
    await screen.findByDisplayValue('Product 2');
    await waitFor(() => expect(document.activeElement).toBe(search));
    const newQuantity = screen.getByLabelText('Qty Product 2') as HTMLInputElement;
    expect(newQuantity.labels?.[0].htmlFor).toBe(newQuantity.id);
    expect(screen.getByLabelText('Nama produk Product 2').matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('SKU Product 2').matches(':disabled')).toBe(true);
    change('Harga satuan Product 2', '12.50');
    expect((screen.getByLabelText('Harga satuan Product 2') as HTMLInputElement).value).toBe('12.50');
    sharedAction(screen.getByRole('button', { name: 'Hapus Product 2' }));
    expect((qty as HTMLInputElement).value).toBe('3');
    expect(state.commands).toHaveLength(0);
});

test.each(['create', 'edit'] as const)('%s Back and Cancel are real destination links with native modified activation and one dirty blocker', async mode => {
    const path = mode === 'edit' ? `/athel/co/${ids.co}/edit` : '/athel/co/new';
    const destination = mode === 'edit' ? `/athel/co/${ids.co}` : '/athel/co';
    const { router } = mountRoutes([{ path: '/athel/co', children: [
        { index: true, element: <p>Order list destination</p> },
        { path: 'new', element: <COForm mode="create"/> },
        { path: ':id/edit', element: <COForm mode="edit"/> },
        { path: ':id', element: <p>Order detail destination</p> },
    ] }], path);
    if (mode === 'edit') await screen.findByDisplayValue('Item 1');
    else await screen.findByLabelText('Nomor CO');
    fireEvent.change(screen.getByLabelText('Catatan'), { target: { value: 'Retained destination draft' } });
    for (const name of ['Kembali', 'Batal']) {
        const link = screen.getByRole('link', { name });
        expect(link.getAttribute('href')).toBe(destination); sharedAction(link);
        expect(link.classList.contains('ui-action--quiet')).toBe(true);
        expect(link.classList.contains('ui-action--compact')).toBe(true);
        for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
            let intercepted = true;
            document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault(); }, { once: true });
            fireEvent.click(link, { [modifier]: true, button: 0 });
            expect(intercepted, `${name} ${modifier}`).toBe(false);
            expect(router.state.location.pathname).toBe(path);
            expect(screen.queryByRole('dialog')).toBeNull();
            expect((screen.getByLabelText('Catatan') as HTMLTextAreaElement).value).toBe('Retained destination draft');
        }
        fireEvent.click(link);
        await screen.findByRole('dialog', { name: 'Buang perubahan?' });
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        expect(router.state.location.pathname).toBe(path);
        fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }));
        expect((screen.getByLabelText('Catatan') as HTMLTextAreaElement).value).toBe('Retained destination draft');
    }
    fireEvent.click(screen.getByRole('link', { name: 'Batal' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(destination));
    expect(state.commands).toHaveLength(0);
});

test.each(['pending', 'unknown'] as const)('fixed navigation preserves original %s command ownership and guarded leave availability', async outcome => {
    let finish!: (receipt: COReceipt) => void;
    if (outcome === 'pending') state.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    else state.send.mockImplementationOnce(async () => { state.unresolved = true; throw new Error('Result unknown'); });
    const path = `/athel/co/${ids.co}/edit`, destination = `/athel/co/${ids.co}`;
    const { router } = mountRoutes([{ path: '/athel/co', children: [
        { path: ':id/edit', element: <COForm mode="edit"/> },
        { path: ':id', element: <p>Saved order destination</p> },
    ] }], path);
    await screen.findByDisplayValue('Item 1');
    fireEvent.change(screen.getByLabelText('Catatan'), { target: { value: 'Guarded in-flight draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    if (outcome === 'unknown') await screen.findByText('Result unknown');
    expect(screen.getByLabelText('Catatan').matches(':disabled')).toBe(true);
    for (const name of ['Kembali', 'Batal']) {
        const link = screen.getByRole('link', { name });
        expect(link.getAttribute('href')).toBe(destination);
        let intercepted = true;
        document.addEventListener('click', event => { intercepted = event.defaultPrevented; event.preventDefault(); }, { once: true });
        fireEvent.click(link, { ctrlKey: true, button: 0 });
        expect(intercepted).toBe(false);
        expect(router.state.location.pathname).toBe(path);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(link);
        await screen.findByRole('dialog', { name: 'Buang perubahan?' });
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }));
        expect((screen.getByLabelText('Catatan') as HTMLTextAreaElement).value).toBe('Guarded in-flight draft');
        expect(screen.getByLabelText('Catatan').matches(':disabled')).toBe(true);
        expect(state.send).toHaveBeenCalledTimes(1);
    }
    fireEvent.click(screen.getByRole('link', { name: 'Batal' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(destination));
    if (outcome === 'pending') await act(async () => finish({ id: ids.co, operation: 'edit_co', version: '2', customer_id: ids.customer, customer_version: '2' }));
    expect(router.state.location.pathname).toBe(destination);
    expect(screen.getByText('Saved order destination')).toBeTruthy();
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.acknowledge).not.toHaveBeenCalled();
    expect(state.reconcile).not.toHaveBeenCalled();
    if (outcome === 'unknown') expect(state.unresolved).toBe(true);
});

test('detail preserves independent exact ordered value and revenue without mixed-unit totals', async () => {
    Object.assign(state.header.summary, { planned_value: '9007199254740993.01', revenue: '0.01', delivery_progress: 'complete', pending_quantity: '0' });
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    expect(await screen.findByText('Nilai CO: Rp 9.007.199.254.740.993,01')).toBeTruthy();
    expect(screen.getByText(/Pendapatan terjual: Rp 0,01/)).toBeTruthy();
    expect(screen.getByText('Informasi pesanan dan penjualan').closest('details')!.open).toBe(false);
    expect(screen.queryByText('Sisa stok tercatat')).toBeNull();
    expect(screen.getByText('Aktif').classList.contains('ui-status-badge')).toBe(true);
    expect(screen.getByText('Terkirim penuh')).toBeTruthy();
    sharedAction(screen.getByRole('link', { name: 'Edit CO' }));
});

test.each([
    { stock_remains: false, undelivered_remains: true, missing_month_count: '0' },
    { stock_remains: false, undelivered_remains: false, missing_month_count: '1' },
    { stock_remains: true, undelivered_remains: false, missing_month_count: '0' },
])('close keeps the authoritative blocker %j even when recorded stock is zero', blockers => {
    const close = vi.fn();
    mount(<COStatusActions co={state.header} id={ids.co} customerId={ids.customer} allowed={['close_co']} blockers={blockers} pending={false} onSJ={vi.fn()} onCancel={vi.fn()} onResolve={vi.fn()} onClose={close}/>);
    const button = screen.getByRole('button', { name: 'Tutup CO' });
    sharedAction(button);
    expect(button.matches(':disabled')).toBe(true); fireEvent.click(button); expect(close).not.toHaveBeenCalled();
});

test('cancel shared dialog retains pending native dismissal guards and original trigger focus', async () => {
    function Owner() {
        const [open, setOpen] = React.useState(false), [pending, setPending] = React.useState(false);
        const trigger = React.useRef<HTMLButtonElement>(null);
        return <><button ref={trigger} onClick={() => setOpen(true)}>Open cancellation</button>
            {open && <COCancelDialog editorKey="test-cancel" pending={pending} error="" returnFocus={trigger.current} onClose={() => setOpen(false)} onConfirm={async () => { setPending(true); }}/>}</>;
    }
    mount(<Owner/>);
    const trigger = screen.getByRole('button', { name: 'Open cancellation' }); trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Batalkan CO?' });
    expect(dialog.tagName).toBe('DIALOG'); expect(dialog.classList.contains('ui-dialog')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const reason = screen.getByLabelText('Alasan pembatalan');
    expect(reason.closest('.ui-field')).toBeTruthy();
    fireEvent.change(reason, { target: { value: 'Explicit reason' } });
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi pembatalan' }));
    const pendingDialog = screen.getByRole('dialog');
    fireEvent.keyDown(pendingDialog, { key: 'Escape' });
    const cancel = new Event('cancel', { cancelable: true }); fireEvent(pendingDialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(screen.getByRole('dialog')).toBe(pendingDialog);
    expect(screen.getByRole('button', { name: 'Batal' }).matches(':disabled')).toBe(true);
});

test.each(['ready', 'loading', 'error', 'denied'] as const)('layout owns one focusable main target through %s descendants', async mode => {
    if (mode === 'loading') vi.spyOn(rpc, 'fetchCODetail').mockReturnValue(new Promise(() => {}));
    if (mode === 'error') vi.spyOn(rpc, 'fetchCODetail').mockRejectedValue(new Error('CO read unavailable'));
    if (mode === 'denied') vi.spyOn(rpc, 'fetchCODetail').mockRejectedValue(Object.assign(new Error('CO authority required'), { code: '42501' }));
    const navigation = await import('../../src/components/AthelNav');
    const { default: ActualNav } = await vi.importActual<typeof navigation>('../../src/components/AthelNav');
    vi.spyOn(navigation, 'default').mockImplementation(ActualNav);
    mountRoutes([{ path: '/athel/co', element: <COLayout/>, children: [{ path: ':id', element: <CODetail/> }, { path: 'reports', element: <p>Report destination</p> }] }], `/athel/co/${ids.co}`);
    if (mode === 'ready') await screen.findByText('CO-A');
    if (mode === 'error') await screen.findByText('CO read unavailable');
    if (mode === 'denied') { await screen.findByText('CO authority required'); expect(screen.queryByText('Original PIC')).toBeNull(); }
    expect(screen.queryByRole('navigation', { name: 'Bagian pesanan konsinyasi' })).toBeNull();
    if (mode === 'ready') {
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('CO-A');
    }
    const main = screen.getByRole('main');
    expect(main.id).toBe('main-content'); expect(main.tabIndex).toBe(-1);
    expect(document.querySelectorAll('#main-content')).toHaveLength(1);
    main.focus(); expect(document.activeElement).toBe(main);
    fireEvent.click(screen.getByRole('link', { name: 'Laporan Penjualan Bulanan' }));
    await screen.findByText('Report destination');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Laporan Penjualan Bulanan' }).getAttribute('aria-current')).toBe('page');
});

test('shared exact pagination preserves BigInt totals and pending page clamping', async () => {
    const onPage = vi.fn();
    const view = render(<COPagination page={2147483647} total="9007199254740993" pending={false} onPage={onPage}/>);
    sharedAction(screen.getByRole('button', { name: 'Berikutnya' }));
    expect(screen.getByRole('button', { name: 'Berikutnya' }).matches(':disabled')).toBe(true);
    expect(screen.getByText('Halaman 2147483647 dari 450.359.962.737.050')).toBeTruthy();
    view.rerender(<COPagination page={2} total="20" pending onPage={onPage}/>);
    expect(onPage).not.toHaveBeenCalled();
    view.rerender(<COPagination page={2} total="20" pending={false} onPage={onPage}/>);
    await waitFor(() => expect(onPage).toHaveBeenCalledWith(1));
});

async function realRecovery(status: 'committed' | 'unknown' | 'abandoned' = 'committed') {
    const { createCOTransactionSender } = await vi.importActual<typeof import('../../src/lib/co/transactions')>('../../src/lib/co/transactions');
    const receipt: COReceipt = { id: ids.co, operation: 'edit_co', version: '2', customer_id: ids.customer, customer_version: '2' };
    const backend = vi.fn(async (name: string) => name === 'pilot_co_transaction_v1'
        ? { data: null, error: { code: '08006', message: 'Response lost' } }
        : { data: status === 'committed' ? { status, operation: 'edit_co', receipt } : { status }, error: null });
    Object.assign(supabase, { rpc: backend });
    const sender = createCOTransactionSender({ actorId: ids.actor, role: 'co_admin', scope: 'ui-recovery', customerId: ids.customer, coId: ids.co, storage: () => localStorage, authorize: async () => {} });
    await expect(sender('edit_co', { co_id: ids.co, customer_id: ids.customer, expected_co_version: '1', expected_customer_version: '1' })).rejects.toThrow('Response lost');
    return { sender, receipt, backend };
}

test('shared recovery preserves real sender receipt until explicit false/throw/true canonical acceptance', async () => {
    const { sender, receipt } = await realRecovery();
    const accept = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('Canonical source unavailable')).mockImplementationOnce(async (value: COReceipt) => { expect(value).toEqual(receipt); await sender.acknowledgeRecovered(); return true; });
    render(<CORecoveryPanel sender={sender} current={() => true} accept={accept}/>);
    const recover = screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }); sharedAction(recover);
    fireEvent.click(recover); fireEvent.click(await screen.findByRole('button', { name: 'Lihat hasil tersimpan' }));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1)); expect(sender.hasUnresolved()).toBe(true);
    expect(sender.getCommittedIdentity(receipt)).toMatchObject({ operation: 'edit_co', co_id: ids.co, customer_id: ids.customer });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lihat hasil tersimpan' }).matches(':disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Lihat hasil tersimpan' }));
    await screen.findByText('Canonical source unavailable'); expect(sender.hasUnresolved()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Lihat hasil tersimpan' }));
    await waitFor(() => expect(sender.hasUnresolved()).toBe(false));
    expect(screen.queryByRole('button', { name: 'Lihat hasil tersimpan' })).toBeNull();
});

test.each(['unknown', 'abandoned'] as const)('shared recovery preserves real sender %s semantics', async status => {
    const { sender } = await realRecovery(status);
    const accept = vi.fn(async () => true);
    const view = render(<CORecoveryPanel sender={sender} current={() => true} accept={accept} pending/>);
    expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull();
    expect(screen.getByRole('status').classList.contains('ui-notice')).toBe(true);
    view.rerender(<CORecoveryPanel sender={sender} current={() => true} accept={accept}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }));
    await screen.findByText(status === 'unknown' ? 'Hasil belum dapat dipastikan. Jangan buat permintaan baru.' : 'Pemeriksaan selesai. Permintaan sebelumnya tidak tersimpan.');
    expect(sender.hasUnresolved()).toBe(status === 'unknown'); expect(accept).not.toHaveBeenCalled();
});


test.each([false, true])('static freshness avoids live alerts and qualifies physical stock only at page level, compact=%s', compact => {
    render(<COFreshness value={state.header.reporting_freshness} compact={compact}/>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryAllByText('Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.')).toHaveLength(compact ? 0 : 1);
});
