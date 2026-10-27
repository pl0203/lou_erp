import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { mount, state, ids, change, chooseCustomer } from './ui-harness';
import COForm from '../../src/pages/athel/co/COForm';
import CODetail from '../../src/pages/athel/co/CODetail';
import COLayout from '../../src/pages/athel/co/COLayout';
import COOrders from '../../src/pages/athel/co/COOrders';
import { COFreshness, CORecoveryPanel } from '../../src/components/co/COShared';
import type { COTransactionSender } from '../../src/lib/co/transactions';

test.each([false, true])('CO freshness shows the required calendar month in Indonesian, compact=%s', compact => {
    const value = Object.freeze({ ...state.header.reporting_freshness,
        next_required_report_month: '2026-09-01', pending_report_month_count: '2' });
    render(<COFreshness value={value} compact={compact}/>);
    expect(screen.getByText(compact
        ? 'Berikutnya: September 2026 · 2 belum lengkap'
        : 'Periode berikutnya yang perlu dilengkapi: September 2026 · 2 periode belum lengkap')).toBeTruthy();
    expect(value.next_required_report_month).toBe('2026-09-01');
});

test('first CO save shows neutral progress, then recovery only after an unresolved outcome', async () => {
    let reject!: (reason: Error) => void;
    state.send.mockImplementation(() => { state.unresolved = true; return new Promise((_resolve, fail) => { reject = fail; }); });
    mount(<COForm mode="edit"/>);
    await screen.findByDisplayValue('Item 1');
    change('Catatan', 'New note');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
    expect(screen.queryByText(/Hasil penyimpanan sebelumnya perlu dipulihkan/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/Sedang memproses/);
    await act(async () => reject(new Error('Respons belum diketahui')));
    await screen.findByRole('button', { name: 'Pulihkan hasil penyimpanan' });
    expect(state.send).toHaveBeenCalledOnce();
    expect(state.unresolved).toBe(true);
});

test('shared CO recovery keeps the durable guard while pending and restores the recovery route afterward', () => {
    const reconcile = vi.fn(async () => ({ status: 'unknown' as const }));
    const sender = Object.assign(vi.fn(), { hasUnresolved: () => true, reconcile }) as unknown as COTransactionSender;
    const props = { sender, current: () => true, accept: vi.fn(async () => true) };
    const { rerender } = render(<CORecoveryPanel {...props} {...{ pending: true }}/>);
    expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull();
    expect(sender.hasUnresolved()).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/Sedang memproses/);
    rerender(<CORecoveryPanel {...props} {...{ pending: false }}/>);
    expect(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeTruthy();
    expect(reconcile).not.toHaveBeenCalled();
});

test('new CO distinguishes lifetime order totals from older customer-wide reporting and audit', async () => {
    state.header.last_report_month = '2026-09-01';
    state.header.coverage_through_date = '2026-09-30';
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    await screen.findByText('CO-A');
    expect(screen.getByText(/Nilai CO:/)).toBeTruthy();
    expect(screen.queryByText('Pelaporan pelanggan (semua CO)')).toBeNull();
    expect(screen.getByRole('link', { name: 'Lihat laporan bulanan' }).getAttribute('href')).toContain(`/reports?customer=${ids.customer}`);
    const audit = screen.getByText('Audit CO dan laporan pelanggan').closest('details')!;
    expect(audit.open).toBe(false);
});

test('lifecycle guide explains the next delivery step without equating full delivery and closure', async () => {
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    await screen.findByText('CO-A');
    const actions = screen.getByText('Tindakan lainnya').closest('details')!;
    expect(actions.open).toBe(false);
    expect(actions.textContent).toMatch(/Surat Jalan/);
    expect(screen.getByRole('button', { name: 'Buat surat jalan' }).matches(':disabled')).toBe(false);
    expect(state.commands).toHaveLength(0);
});

test('audit summarizes the actor and customer reporting scope with readable WIB time, retaining exact metadata', async () => {
    state.sections.audit = [{ id: 'audit-1', operation: 'post_report', actor_id: ids.actor,
        created_at: '2026-10-10T23:10:00Z', report_revision_id: 'report-revision', reason: 'Laporan September' }];
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    await screen.findByText(/memposting laporan penjualan bulanan/);
    expect(screen.getByText(/Pengguna tercatat memposting/)).toBeTruthy();
    expect(screen.getByText(/11 Oktober 2026.*06.10.*WIB/)).toBeTruthy();
    const details = screen.getByText('Detail teknis audit').closest('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('post_report');
    expect(details.textContent).toContain(ids.actor);
    expect(screen.getByRole('button', { name: 'Lihat perubahan' })).toBeTruthy();
});

test('new-item guidance requires active catalogue selection while retaining old manual history', async () => {
    mount(<COForm mode="create"/>, '/athel/co/new');
    await chooseCustomer();
    expect(screen.queryByRole('button', { name: 'Tambah barang manual' })).toBeNull();
    expect(screen.getByText(/Barang baru wajib dipilih dari katalog aktif/)).toBeTruthy();
    expect(screen.getByText(/Barang manual lama tetap tersimpan/)).toBeTruthy();
});

test.each([
    { status: 'active', pending: '0', stock: '2', missing: '1', next: /laporan penjualan bulanan/ },
    { status: 'active', pending: '0', stock: '0', missing: '0', next: /Tutup CO/ },
    { status: 'closed', pending: '0', stock: '0', missing: '0', next: /CO sudah ditutup/ },
])('lifecycle next step follows existing state and blockers: %j', async ({ status, pending, stock, missing, next }) => {
    state.header.status = status;
    state.header.summary.pending_quantity = pending;
    state.header.summary.remaining_quantity = stock;
    state.header.close_blockers = { stock_remains: stock !== '0', undelivered_remains: pending !== '0', missing_month_count: missing };
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    await screen.findByText('CO-A');
    expect(screen.getByText('Tindakan lainnya').closest('details')!.textContent).toMatch(next);
});

test('CO layout has one main landmark and task heading without redundant top tabs', async () => {
    const { mountRoutes } = await import('./ui-harness');
    mountRoutes([{ path: '/athel/co', element: <COLayout/>, children: [{ index: true, element: <COOrders/> }] }], '/athel/co');
    const main = screen.getByRole('main');
    expect(screen.queryByRole('navigation', { name: 'Bagian pesanan konsinyasi' })).toBeNull();
    expect(within(main).getByRole('heading', { level: 1, name: 'Pesanan CO' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(main.id).toBe('main-content');
    await within(main).findByRole('article');
});

test('known committed CO result uses its specific readback notice instead of uncertain recovery warning', () => {
    const sender = Object.assign(vi.fn(), { hasUnresolved: () => true }) as unknown as COTransactionSender;
    render(<CORecoveryPanel sender={sender} current={() => true} accept={vi.fn(async () => true)} {...{ confirmed: true }}/>);
    expect(screen.queryByText(/Hasil penyimpanan sebelumnya perlu dipulihkan/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull();
    expect(sender.hasUnresolved()).toBe(true);
});

test('failed acceptance of a known CO receipt keeps the precise recovery error visible', async () => {
    const sender = Object.assign(vi.fn(), { hasUnresolved: () => true,
        reconcile: async () => ({ status: 'committed', receipt: { id: ids.co } }) }) as unknown as COTransactionSender;
    function Owner() {
        const [confirmed, setConfirmed] = React.useState(false);
        return <CORecoveryPanel confirmed={confirmed} sender={sender} current={() => true} accept={async () => {
            setConfirmed(true); throw new Error('Canonical source is newer');
        }}/>;
    }
    render(<Owner/>);
    fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lihat hasil tersimpan' }));
    expect(await screen.findByText('Canonical source is newer')).toBeTruthy();
    expect(screen.queryByText(/Hasil penyimpanan sebelumnya perlu dipulihkan/)).toBeNull();
});

test('absence of a posted customer report does not claim that no draft has been saved', async () => {
    state.header.last_report_month = null;
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    await screen.findByText('CO-A');
    expect(screen.queryByText(/Belum ada laporan yang diposting/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Lihat laporan bulanan' })).toBeTruthy();
    expect(screen.queryByText(/Belum ada laporan tersimpan/)).toBeNull();
});

test('owner acknowledgement clears panel result and error while a later unresolved request still offers recovery', async () => {
    let unresolved = true;
    const sender = Object.assign(vi.fn(), { hasUnresolved: () => unresolved,
        reconcile: async () => ({ status: 'committed', receipt: { id: ids.co } }) }) as unknown as COTransactionSender;
    function Owner() {
        const [confirmed, setConfirmed] = React.useState(false);
        const [generation, setGeneration] = React.useState(0);
        return <div data-generation={generation}>
            <CORecoveryPanel confirmed={confirmed} sender={sender} current={() => true} accept={async () => {
                setConfirmed(true); throw new Error('Canonical read unavailable');
            }}/>
            {confirmed && <button onClick={() => { unresolved = false; setConfirmed(false); }}>Buka hasil milik form</button>}
            <button onClick={() => { unresolved = true; setGeneration(value => value + 1); }}>Permintaan baru belum terkonfirmasi</button>
        </div>;
    }
    render(<Owner/>);
    fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lihat hasil tersimpan' }));
    await screen.findByText('Canonical read unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Buka hasil milik form' }));
    expect(screen.queryByText('Canonical read unavailable')).toBeNull();
    expect(screen.queryByText(/Hasil penyimpanan sebelumnya perlu dipulihkan/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lihat hasil tersimpan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Permintaan baru belum terkonfirmasi' }));
    expect(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lihat hasil tersimpan' })).toBeNull();
    expect(screen.queryByText('Canonical read unavailable')).toBeNull();
});

test('CO list labels older reports as customer-wide and renders calendar dates without shifting the day', async () => {
    state.header.last_report_month = '2026-09-01';
    const { default: COOrders } = await import('../../src/pages/athel/co/COOrders');
    mount(<COOrders/>, '/athel/co/list');
    const mobile = await screen.findByRole('article');
    expect(within(mobile).getByText(/Store A · 1 Oktober 2026/)).toBeTruthy();
    expect(within(mobile).queryByText('Laporan pelanggan (semua CO)')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Laporan pelanggan (semua CO)' })).toBeNull();
    expect(screen.getByRole('table').textContent).toContain('1 Oktober 2026');
    expect(screen.getByRole('table').textContent).not.toContain('2026-10-01');
});

test('safely abandoned reconciliation shows a terminal result without an unresolved recovery warning', async () => {
    let unresolved = true;
    const sender = Object.assign(vi.fn(), { hasUnresolved: () => unresolved,
        reconcile: async () => { unresolved = false; return { status: 'abandoned' }; } }) as unknown as COTransactionSender;
    render(<CORecoveryPanel sender={sender} current={() => true} accept={vi.fn(async () => true)}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }));
    await screen.findByText('Permintaan lama dibatalkan secara aman. Anda dapat menyimpan kembali.');
    expect(screen.getByText('Pemeriksaan selesai. Permintaan sebelumnya tidak tersimpan.')).toBeTruthy();
    expect(screen.queryByText(/Hasil penyimpanan sebelumnya perlu dipulihkan/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull();
    expect(unresolved).toBe(false);
});

