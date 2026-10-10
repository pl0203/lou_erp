import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { mount, state, ids } from './ui-harness';
import CODetail from '../../src/pages/athel/co/CODetail';
import COOrders from '../../src/pages/athel/co/COOrders';
import * as rpc from '../../src/lib/co/rpc';
import * as auth from '../../src/lib/AuthContext';
import { coKeys } from '../../src/lib/co/queryKeys';
test('fully delivered remains active with independent revenue and stock', async () => { Object.assign(state.header.summary, { delivered_quantity: '2', pending_quantity: '0', delivery_progress: 'complete', remaining_quantity: '2' }); mount(<CODetail />, `/athel/co/${ids.co}`); await screen.findByText('CO-A'); expect(screen.getByText('Aktif')).toBeTruthy(); expect(screen.getByText('Terkirim penuh')).toBeTruthy(); expect(screen.getByText('Original PIC')).toBeTruthy(); expect(screen.getByText('Nilai rencana CO')).toBeTruthy(); expect(screen.getByText('Pendapatan terjual')).toBeTruthy(); expect(state.commands).toHaveLength(0); });
test('distinct monthly and stock routes expose truthful later operation seams', async () => { const { router } = mount(<CODetail />, `/athel/co/${ids.co}`); await screen.findByText('CO-A'); expect(screen.getByRole('button', { name: 'Tambah Surat Jalan' })).toBeTruthy(); expect(screen.getByRole('link', { name: 'Catat penjualan bulanan' }).getAttribute('href')).toContain(`/reports?customer=${ids.customer}`); expect(screen.getByRole('link', { name: 'Retur barang belum terjual' }).getAttribute('href')).toContain(`/stock?customer=${ids.customer}`); expect(screen.queryByRole('button', { name: /SJ Kembali/ })).toBeNull(); fireEvent.click(screen.getByRole('link', { name: 'Catat penjualan bulanan' })); await waitFor(() => expect(router.state.location.pathname).toBe('/athel/co/reports')); });
test('server capabilities disable edit and add SJ; close blockers are explicit', async () => { state.header.allowed_operations = []; state.header.close_blockers = { stock_remains: true, undelivered_remains: true, missing_month_count: '2' }; mount(<CODetail />, `/athel/co/${ids.co}`); await screen.findByText('CO-A'); expect(screen.queryByRole('link', { name: 'Ubah CO' })).toBeNull(); expect((screen.getByRole('button', { name: 'Tambah Surat Jalan' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText(/2 laporan bulan belum lengkap/)).toBeTruthy(); });
test('Orders customer/status filter is sent before pagination', async () => { mount(<COOrders />, '/athel/co/list'); await screen.findAllByText('CO-A'); fireEvent.change(screen.getByLabelText('Status CO'), { target: { value: 'closed' } }); fireEvent.change(screen.getByLabelText('Filter pelanggan'), { target: { value: ids.customer } }); await waitFor(() => expect(state.page.mock.calls.at(-1)[0]).toMatchObject({ p_customer_id: ids.customer, p_status: 'closed', p_page: 1 })); });
test('history is independently paged and labeled customer report scope', async () => { state.sections.deliveries = Array.from({ length: 21 }, (_, i) => ({ id: `d${i}`, head_id: `h${i}`, sj_number: `SJ-${i}`, sj_date: '2026-10-01', received_date: null, is_effective: true, is_void: false, revision_no: '1' })); mount(<CODetail />, `/athel/co/${ids.co}`); await screen.findByText(/SJ-0 ·/); expect(screen.queryByText(/SJ-20 ·/)).toBeNull(); expect(screen.getByText('Laporan bulanan pelanggan (semua CO)')).toBeTruthy(); const next = screen.getAllByRole('button', { name: 'Berikutnya' }).find(b => !(b as HTMLButtonElement).disabled)!; fireEvent.click(next); await screen.findByText(/SJ-20 ·/); });
test.each(['grant', 'revoke', 'error'])('Orders Edit uses an actual deferred capability refetch: %s', async outcome => {
    const { client } = mount(<COOrders />, '/athel/co/list');
    await screen.findAllByRole('link', { name: 'Ubah' });
    let resolve!: (value: any) => void; let reject!: (error: Error) => void;
    const pending = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
    const read = vi.spyOn(rpc, 'fetchCODetail').mockReturnValue(pending);
    try {
        let refetch!: Promise<void>;
        await act(async () => { refetch = client.invalidateQueries({ queryKey: coKeys.read({ actorId: ids.actor, role: 'co_admin' }, 'order-actions', { id: ids.co, version: '1' }) }); });
        expect(read).toHaveBeenCalledWith(ids.co, '1', expect.anything());
        await waitFor(() => expect(screen.queryAllByRole('link', { name: 'Ubah' })).toHaveLength(0));
        expect(screen.getAllByRole('link', { name: 'Lihat' })).toHaveLength(2);
        await act(async () => {
            if (outcome === 'error') reject(new Error('Current authority unavailable'));
            else resolve({ co: state.header, allowed_operations: outcome === 'grant' ? ['edit_co'] : [], close_blockers: state.header.close_blockers });
            await refetch;
        });
        await waitFor(() => expect(screen.queryAllByRole('link', { name: 'Ubah' })).toHaveLength(outcome === 'grant' ? 2 : 0));
        expect(state.commands).toHaveLength(0);
    } finally { read.mockRestore(); }
});
test('mobile Orders retains sold quantity alongside revenue and stock', async () => {
    Object.assign(state.header.summary, { sold_quantity: '601', revenue: '606.00', remaining_quantity: '602' });
    mount(<COOrders />, '/athel/co/list');
    const mobile = await screen.findByRole('article');
    expect(within(mobile).getByText('Jumlah terjual').nextElementSibling?.textContent).toBe('601');
    expect(within(mobile).getByText('Pendapatan terjual').nextElementSibling?.textContent).toContain('606');
    expect(within(mobile).getByText('Stok tercatat').nextElementSibling?.textContent).toBe('602');
});
test('cancellation reason is protected on dirty dismissal', async () => { mount(<CODetail />, `/athel/co/${ids.co}`); fireEvent.click(await screen.findByRole('button', { name: 'Batalkan CO' })); fireEvent.change(screen.getByLabelText('Alasan pembatalan'), { target: { value: 'Keep this reason' } }); fireEvent.click(screen.getByRole('button', { name: 'Batal' })); await screen.findByRole('button', { name: 'Tetap mengedit' }); fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' })); expect(screen.getByDisplayValue('Keep this reason')).toBeTruthy(); });
test('exact pager clamps a now-out-of-range page without lossy total arithmetic',async()=>{const {COPagination}=await import('../../src/components/co/COShared');function Pager(){const [page,setPage]=React.useState(2);return <COPagination page={page} total="20" pending={false} onPage={setPage}/>};mount(<Pager/>,`/athel/co/${ids.co}`);await screen.findByText('Halaman 1 dari 1');expect(screen.getByText('1–20 dari 20')).toBeTruthy()})

// Regression: a background transport failure must not unmount the protected editor.
test.each(['sj', 'cancel'] as const)('dirty %s survives failed detail refresh, freezes writes, and resumes without initialization', async editor => {
    const { client } = mount(<CODetail />, `/athel/co/${ids.co}`);
    fireEvent.click(await screen.findByRole('button', { name: editor === 'sj' ? 'Tambah Surat Jalan' : 'Batalkan CO' }));
    const field = await screen.findByLabelText(editor === 'sj' ? 'Nomor SJ' : 'Alasan pembatalan');
    fireEvent.change(field, { target: { value: 'UNSAVED WORK' } });
    if (editor === 'sj') fireEvent.change(screen.getByLabelText('Jumlah dikirim Item 1'), { target: { value: '1' } });
    const action = screen.getByRole('button', { name: editor === 'sj' ? 'Simpan Draft SJ' : 'Konfirmasi pembatalan' });
    const original = rpc.fetchCODetail;
    const read = vi.spyOn(rpc, 'fetchCODetail').mockImplementation((id, version, options) => version === null ? Promise.reject(new Error('Header network error')) : original(id, version, options));
    await act(async () => { await client.invalidateQueries({ queryKey: coKeys.read({ actorId: ids.actor, role: 'co_admin' }, 'detail', { id: ids.co }) }); });
    await screen.findByText('Header network error');
    expect(screen.queryByDisplayValue('UNSAVED WORK')).toBe(field);
    expect(action.matches(':disabled')).toBe(true);
    fireEvent.click(action);
    expect(state.commands).toHaveLength(0);
    read.mockImplementation(original);
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect(action.matches(':disabled')).toBe(false));
    expect(screen.getByDisplayValue('UNSAVED WORK')).toBe(field);
    fireEvent.click(action);
    await waitFor(() => expect(state.commands).toHaveLength(1));
    expect(state.commands[0].payload[editor === 'sj' ? 'sj_number' : 'reason']).toBe('UNSAVED WORK');
});

test('authoritative detail denial clears editors and a later network failure cannot restore private work', async () => {
    const { client } = mount(<CODetail />, `/athel/co/${ids.co}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah Surat Jalan' }));
    fireEvent.change(await screen.findByLabelText('Nomor SJ'), { target: { value: 'PRIVATE WORK' } });
    const read = vi.spyOn(rpc, 'fetchCODetail').mockRejectedValue(Object.assign(new Error('CO authority required'), { code: '42501' }));
    const key = coKeys.read({ actorId: ids.actor, role: 'co_admin' }, 'detail', { id: ids.co });
    await act(async () => { await client.invalidateQueries({ queryKey: key }); });
    await screen.findByText('CO authority required');
    expect(screen.queryByDisplayValue('PRIVATE WORK')).toBeNull();
    expect(screen.queryByText('Original PIC')).toBeNull();
    expect(client.getQueryData(key)).toBeUndefined();
    read.mockRejectedValue(new Error('Header network error'));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await screen.findByText('Header network error');
    expect(screen.queryByText('Original PIC')).toBeNull();
    expect(state.commands).toHaveLength(0);
});

test.each(['identity', 'role', 'deactivation'] as const)('%s replacement still clears dirty detail editors and the old private cache', async loss => {
    const { client } = mount(<CODetail />, `/athel/co/${ids.co}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Batalkan CO' }));
    fireEvent.change(screen.getByLabelText('Alasan pembatalan'), { target: { value: 'PRIVATE REASON' } });
    const current = auth.useAuth();
    const nextId = '00000000-0000-0000-0000-000000000009';
    vi.spyOn(auth, 'useAuth').mockReturnValue({ ...current,
        user: loss === 'identity' ? { ...current.user!, id: nextId } : current.user,
        profile: { ...current.profile!, ...(loss === 'identity' ? { id: nextId } : loss === 'role' ? { role: 'executive' } : { is_active: false }) },
    });
    const key = coKeys.read({ actorId: ids.actor, role: 'co_admin' }, 'detail', { id: ids.co });
    await act(async () => { await client.invalidateQueries({ queryKey: key }); });
    await waitFor(() => expect(screen.queryByDisplayValue('PRIVATE REASON')).toBeNull());
    expect(client.getQueryData(key)).toBeUndefined();
    expect(state.commands).toHaveLength(0);
});
