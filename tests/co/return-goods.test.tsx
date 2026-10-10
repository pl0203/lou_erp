import React from 'react';
import { expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { customer, id, mount, mountApp, stockFixture, wire } from './stock-ui-harness';
import App from '../../src/App';
import CODetail from '../../src/pages/athel/co/CODetail';

test('customer-wide return saves a draft without ledger effect then posts through shared review', async () => {
    const s = stockFixture();
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await click('Retur barang belum terjual');
    fireEvent.change(await screen.findByLabelText('Jumlah retur SJ-1 Item 1'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Referensi retur'), { target: { value: 'RET-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft retur' }));
    await waitFor(() => expect(s.commands).toHaveLength(1));
    expect(s.batches[0].available_quantity).toBe('30');
    fireEvent.click(await screen.findByRole('button', { name: 'Tinjau / post retur' }));
    fireEvent.change(screen.getByLabelText('Alasan perubahan'), { target: { value: 'Unsold stock returned' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau semua dampak' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Terapkan perubahan' }));
    await screen.findByText('Retur sudah tercatat');
    expect(s.commands[1]).toMatchObject({ op: 'post_return', payload: { draft_id: id(20), expected_draft_version: '1' } });
    expect(s.batches[0].available_quantity).toBe('25');
    expect(s.co.summary.revenue).toBe('720000');
});
test('detail draft discovery restores all customer-wide lines across COs and pages', async () => {
    const s = stockFixture(101);
    s.draft = s.makeDraft(s.batches.map((b: any) => ({ batch_id: b.id, quantity: 1 })));
    mount(<CODetail />, `/athel/co/${s.co.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Buka draft retur' }));
    await screen.findByText(/101 sumber tersimpan/);
    fireEvent.change(screen.getByLabelText('Referensi retur'), { target: { value: 'RESTORED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft retur' }));
    await waitFor(() => expect(s.commands).toHaveLength(1));
    expect(s.commands[0].payload.lines).toHaveLength(101);
    expect(s.commands[0].payload.lines.at(-1)).toEqual({ batch_id: id(2101), quantity: 1 });
});

async function click(name: string) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.matches(':disabled')).toBe(false));
    fireEvent.click(button);
}
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
async function openReturn(count = 2) {
    const state = stockFixture(count);
    const view = mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await click('Retur barang belum terjual');
    await screen.findByLabelText('Jumlah retur SJ-1 Item 1');
    return { state, ...view };
}
async function saveReturn() {
    change('Jumlah retur SJ-1 Item 1', '5');
    change('Referensi retur', 'RET-5');
    await click('Simpan Draft retur');
    await click('Tinjau / post retur');
    change('Alasan perubahan', 'Return original stock');
}

test.each(['0', '-1', '1.5', '1e2', '2147483648', '31'])('invalid source return quantity %s is retained and never sent', async value => {
    const { state } = await openReturn();
    change('Jumlah retur SJ-1 Item 1', value);
    change('Referensi retur', 'INVALID');
    await click('Simpan Draft retur');
    await screen.findByRole('alert');
    expect(state.commands).toHaveLength(0);
    expect((screen.getByLabelText('Jumlah retur SJ-1 Item 1') as HTMLInputElement).value).toBe(value);
});
test('future draft saves but server refusal of future posting retains the saved source', async () => {
    const { state } = await openReturn();
    change('Tanggal retur', '2099-01-01');
    await saveReturn();
    expect(state.draft.header.return_date).toBe('2099-01-01');
    state.fail = (n: string) => n === 'pilot_co_preview_v1' ? { data: null, error: { code: '23514', message: 'Future return cannot post' } } : null;
    await click('Tinjau semua dampak');
    await screen.findByText('Future return cannot post');
    expect(state.commands.map((c: any) => c.op)).toEqual(['save_return_draft']);
    expect(screen.queryByRole('button', { name: 'Terapkan perubahan' })).toBeNull();
});
test('stale customer retains quantities and requires deliberate availability re-review', async () => {
    const { state } = await openReturn();
    change('Jumlah retur SJ-1 Item 1', '5');
    change('Referensi retur', 'RETAIN');
    state.fail = (n: string) => n === 'pilot_co_transaction_v1' ? { data: null, error: { code: 'PT409', message: 'CO_VERSION_CONFLICT' } } : null;
    await click('Simpan Draft retur');
    await screen.findByText(/Sumber berubah/);
    state.cv = '2'; state.batches[0].available_quantity = '4'; state.fail = null;
    await click('Muat sumber retur terbaru');
    await screen.findByText(/Pilihan lama belum disetujui ulang/);
    expect(screen.getByRole('button', { name: 'Simpan Draft retur' }).matches(':disabled')).toBe(true);
    expect((screen.getByLabelText('Jumlah retur SJ-1 Item 1') as HTMLInputElement).value).toBe('5');
    await click('Saya sudah memeriksa sumber terbaru');
    await click('Simpan Draft retur');
    await screen.findByText(/melebihi sumber tersedia/);
    expect(state.commands).toHaveLength(0);
});
test('direct shared-preview authority denial clears the entire return and stock source', async () => {
    const { state, client } = await openReturn();
    await saveReturn();
    state.fail = (n: string) => n === 'pilot_co_preview_v1' ? { data: null, error: { code: '42501', message: 'Return authority denied' } } : null;
    await click('Tinjau semua dampak');
    await screen.findByText('Return authority denied');
    expect(screen.queryByDisplayValue('RET-5')).toBeNull();
    expect(screen.queryByText('SKU-1 · Item 1')).toBeNull();
    expect(screen.queryByText('Return original stock')).toBeNull();
    expect(client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.state.data)).toHaveLength(0);
});
test('known committed canonical retry does not resend and repeated failures preserve work', async () => {
    const { state } = await openReturn();
    change('Jumlah retur SJ-1 Item 1', '5'); change('Referensi retur', 'RETRY');
    state.fail = (n: string) => n === 'pilot_co_return_v1' ? { data: null, error: { code: '08006', message: 'Return canonical offline' } } : null;
    await click('Simpan Draft retur');
    await screen.findByText('Return canonical offline');
    await click('Buka hasil retur tersimpan');
    await screen.findByText('Return canonical offline');
    expect(state.commands).toHaveLength(1);
    expect(screen.getByDisplayValue('RETRY')).toBeTruthy();
    state.fail = null;
    await click('Buka hasil retur tersimpan');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Buka hasil retur tersimpan' })).toBeNull());
    expect(state.commands).toHaveLength(1);
});
test('dirty return blocks tabs, Keep retains fields and Discard leaves without a late save', async () => {
    const { router, state } = await openReturn();
    change('Referensi retur', 'DIRTY');
    fireEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await click('Tetap mengedit');
    expect(router.state.location.pathname).toBe('/athel/co/stock');
    expect(screen.getByDisplayValue('DIRTY')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Orders' }));
    await click('Buang perubahan');
    await waitFor(() => expect(router.state.location.pathname).toBe('/athel/co'));
    expect(state.commands).toHaveLength(0);
});
test('same editor survives a non-authority background source failure and retry', async () => {
    const { state, client } = await openReturn();
    change('Referensi retur', 'BACKGROUND');
    const field = screen.getByDisplayValue('BACKGROUND');
    state.fail = (n: string) => n === 'pilot_co_customer_batches_v1' ? { data: null, error: { code: '08006', message: 'Batches offline' } } : null;
    await act(async () => { await client.invalidateQueries({ predicate: q => q.queryKey[4] === 'return-preparation' }); });
    await screen.findAllByText('Batches offline');
    expect(screen.getByDisplayValue('BACKGROUND')).toBe(field);
    expect(screen.getByRole('button', { name: 'Simpan Draft retur' }).matches(':disabled')).toBe(true);
    state.fail = null;
    fireEvent.click(screen.getAllByRole('button', { name: 'Coba lagi' })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simpan Draft retur' }).matches(':disabled')).toBe(false));
    expect(screen.getByDisplayValue('BACKGROUND')).toBe(field);
});

test.each(['replace', 'void'] as const)('effective return %s is reachable and bound to its exact original head and revision', async action => {
    const s = stockFixture();
    s.draft = s.makeDraft([{ batch_id: id(2001), quantity: 5 }]);
    await s.handle('pilot_co_transaction_v1', { p_operation: 'post_return', p_payload: {} });
    const original = structuredClone(s.effective);
    s.commands = [];
    mount(<CODetail />, `/athel/co/${s.co.id}`);
    await click(action === 'replace' ? 'Siapkan pengganti retur' : 'Batalkan retur dengan koreksi');
    await screen.findByLabelText('Referensi retur');
    if (action === 'replace') change('Jumlah retur SJ-1 Item 1', '4');
    await click('Tinjau koreksi retur');
    change('Alasan perubahan', 'Correct actual returned quantity');
    await click('Tinjau semua dampak');
    await click('Terapkan perubahan');
    await screen.findByText('Retur sudah tercatat');
    expect(s.commands).toHaveLength(1);
    expect(s.commands[0]).toMatchObject({ op: 'correct_return', payload: {
        return_head_id: id(21), original_revision_id: original.header.revision_id, expected_return_version: '1', expected_customer_version: '2', action,
    } });
    expect(s.commands[0].payload.draft_id).toBeUndefined();
    if (action === 'void') {
        expect(s.commands[0].payload.lines).toBeUndefined();
        expect(s.commands[0].payload.return_date).toBeUndefined();
    } else expect(s.commands[0].payload.lines).toEqual([{ batch_id: id(2001), quantity: 4 }]);
    expect(s.history[0]).toEqual(original);
});
test('immutable return revision is read only and restored from revision view', async () => {
    const s = stockFixture(); s.draft = s.makeDraft([{ batch_id: id(2001), quantity: 5 }]);
    await s.handle('pilot_co_transaction_v1', { p_operation: 'post_return', p_payload: {} }); s.commands = [];
    mount(<CODetail />, `/athel/co/${s.co.id}`);
    await click('Lihat revisi retur');
    await screen.findByText(/Riwayat retur tersimpan, hanya baca/);
    expect(screen.getByLabelText('Referensi retur').matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Simpan Draft retur' })).toBeNull();
    expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_return_v1' && a.p_view === 'revision')).toBe(true);
});
test('nested return completion denial removes both nested and source-private content until checked retry', async () => {
    const { state, client } = await openReturn();
    state.report.impacts.missing_month = [{ report_month: '2026-09-01', reason: 'missing', head_id: null, coverage_through_date: null }];
    await saveReturn();
    await click('Tinjau semua dampak');
    await click('Lengkapi periode 2026-09');
    await click('Perbarui periode terhadap sumber usulan');
    await screen.findByLabelText('Terjual Item 1');
    change('Catatan laporan', 'NESTED PRIVATE');
    change('Terjual Item 1', '7');
    state.report.fail = (n: string) => n === 'pilot_co_report_v1' && state.report.commands.some((c: any) => c.payload.action === 'upsert_lines')
        ? { data: null, error: { code: '42501', message: 'Nested return authority denied' } } : null;
    await click('Simpan Draft periode');
    await screen.findByText('Nested return authority denied');
    expect(screen.queryByDisplayValue('NESTED PRIVATE')).toBeNull();
    expect(screen.queryByText('SKU-1 · Item 1')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.state.data)).toHaveLength(0);
    state.report.fail = null;
    await click('Coba lagi');
    await screen.findByText('SKU-1 · Item 1');
    expect(screen.queryByDisplayValue('NESTED PRIVATE')).toBeNull();
});
test('nested known-committed return completion retries canonical reads without repeating the write', async () => {
    const { state } = await openReturn();
    state.report.impacts.missing_month = [{ report_month: '2026-09-01', reason: 'missing', head_id: null, coverage_through_date: null }];
    await saveReturn(); await click('Tinjau semua dampak'); await click('Lengkapi periode 2026-09');
    await click('Perbarui periode terhadap sumber usulan');
    await screen.findByLabelText('Terjual Item 1');
    change('Terjual Item 1', '7'); change('Catatan laporan', 'UNSENT REPORT NOTE');
    state.report.fail = (n: string) => n === 'pilot_co_report_v1' && state.report.commands.some((c: any) => c.payload.action === 'upsert_lines')
        ? { data: null, error: { code: '08006', message: 'Nested canonical offline' } } : null;
    await click('Simpan Draft periode');
    await screen.findAllByText('Nested canonical offline');
    const count = state.report.commands.length;
    await click('Buka hasil laporan tersimpan');
    expect(state.report.commands).toHaveLength(count);
    expect(screen.getByDisplayValue('UNSENT REPORT NOTE')).toBeTruthy();
    state.report.fail = null;
    await click('Buka hasil laporan tersimpan');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Buka hasil laporan tersimpan' })).toBeNull());
    expect(state.report.commands).toHaveLength(count);
    expect(screen.getByDisplayValue('UNSENT REPORT NOTE')).toBeTruthy();
});
test('uncertain return recovery preserves Keep and imports the real draft before acknowledging', async () => {
    const { state, router } = await openReturn();
    let attempted = false;
    state.fail = async (n: string, a: any) => {
        if (n !== 'pilot_co_transaction_v1' || attempted) return null;
        attempted = true;
        await state.handle(n, a);
        return { data: null, error: { code: '08006', message: 'Reply lost' } };
    };
    change('Jumlah retur SJ-1 Item 1', '5'); change('Referensi retur', 'RECOVERY WORK');
    await click('Simpan Draft retur'); await screen.findByText('Reply lost');
    await click('Pulihkan hasil penyimpanan'); await click('Lihat hasil tersimpan');
    await click('Tetap mengedit');
    expect(screen.getByDisplayValue('RECOVERY WORK')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lihat hasil tersimpan' })).toBeTruthy();
    await click('Lihat hasil tersimpan'); await click('Buang perubahan');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Lihat hasil tersimpan' })).toBeNull());
    expect(state.commands).toHaveLength(1);
    expect(router.state.location.pathname).toBe('/athel/co/stock');
    expect(screen.getByDisplayValue('RECOVERY WORK')).toBeTruthy();
});

test.each(['42501', '08006'])('paged impact %s clears only confirmed authority denial and preserves ordinary retry', async code => {
    const { state } = await openReturn();
    await saveReturn(); await click('Tinjau semua dampak');
    await screen.findByRole('button', { name: 'Stok (0)' });
    state.fail = (n: string, a: any) => n === 'pilot_co_preview_impacts_v1' && a.p_kind === 'stock'
        ? { data: null, error: { code, message: 'Impact read failed' } } : null;
    await click('Stok (0)');
    await screen.findByText('Impact read failed');
    if (code === '42501') expect(screen.queryByText('SKU-1 · Item 1')).toBeNull();
    else {
        expect(screen.getByText('SKU-1 · Item 1')).toBeTruthy();
        expect(screen.getByDisplayValue('Return original stock')).toBeTruthy();
        state.fail = null; await click('Coba lagi');
        await screen.findByText('Tidak ada stok.');
    }
});

test('explicit source refresh keeps inputs frozen through import then requires re-review', async () => {
    const { state } = await openReturn();
    change('Referensi retur', 'REFRESH INPUT');
    let release!: (value: any) => void;
    let waiting = false;
    const deferred = new Promise(resolve => { release = resolve; });
    state.fail = (n: string) => {
        if (n === 'pilot_co_customer_batches_v1' && !waiting) { waiting = true; return deferred; }
        return null;
    };
    await click('Muat sumber retur terbaru');
    await waitFor(() => expect(waiting).toBe(true));
    expect(screen.getByLabelText('Referensi retur').matches(':disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Referensi retur'), { target: { value: 'ILLEGAL LATE EDIT' } });
    expect(screen.getByDisplayValue('REFRESH INPUT')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tutup retur' }).matches(':disabled')).toBe(true);
    await act(async () => { release(null); });
    await screen.findByText(/Pilihan lama belum disetujui ulang/);
    await click('Saya sudah memeriksa sumber terbaru');
    expect(screen.getByDisplayValue('REFRESH INPUT')).toBeTruthy();
});
test('authority denial during return canonical import hides parent stock and retains no private cache', async () => {
    const { state, client } = await openReturn();
    change('Referensi retur', 'PRIVATE RETURN'); change('Jumlah retur SJ-1 Item 1', '5');
    state.fail = (n: string) => n === 'pilot_co_return_v1'
        ? { data: null, error: { code: '42501', message: 'Canonical return denied' } } : null;
    await click('Simpan Draft retur');
    await screen.findByText('Canonical return denied');
    expect(screen.queryByDisplayValue('PRIVATE RETURN')).toBeNull();
    expect(screen.queryByText('SKU-1 · Item 1')).toBeNull();
    expect(client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.state.data)).toHaveLength(0);
});
test('malformed incomplete saved return pages cannot enable replacement saving', async () => {
    const s = stockFixture(101); s.draft = s.makeDraft(s.batches.map((b: any) => ({ batch_id: b.id, quantity: 1 })));
    const original = s.handle;
    wire.handler = async (n: string, a: any) => {
        const result = await original(n, a);
        if (n === 'pilot_co_return_v1' && a.p_page === 2) result.data.rows = [];
        return result;
    };
    mount(<CODetail />, `/athel/co/${s.co.id}`);
    await click('Buka draft retur');
    await screen.findAllByText(/page completeness/);
    expect(screen.queryByRole('button', { name: 'Simpan Draft retur' })).toBeNull();
    expect(s.commands).toHaveLength(0);
});
test('new return can preserve positive selections from multiple source pages in one draft', async () => {
    const { state } = await openReturn(21);
    change('Jumlah retur SJ-1 Item 1', '5'); change('Referensi retur', 'MULTI-CO');
    const dialog = screen.getByRole('dialog');
    const next = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Berikutnya')!;
    fireEvent.click(next);
    change('Jumlah retur SJ-21 Item 21', '2');
    await click('Simpan Draft retur');
    await waitFor(() => expect(state.commands).toHaveLength(1));
    expect(state.commands[0].payload.lines).toEqual([{ batch_id: id(2001), quantity: 5 }, { batch_id: id(2021), quantity: 2 }]);
    expect(state.commands[0].payload.co_id).toBeUndefined();
});

test('post receipt cannot replace the editor when consumed draft points to another return head', async () => {
    const { state } = await openReturn();
    await saveReturn();
    const original = state.handle;
    wire.handler = async (n: string, a: any) => {
        const result = await original(n, a);
        if (n === 'pilot_co_return_v1' && a.p_view === 'draft' && result.data.header.consumed) result.data.header.head_id = id(999);
        return result;
    };
    await click('Tinjau semua dampak'); await click('Terapkan perubahan');
    await screen.findByText(/Draft asal tidak terhubung ke hasil retur/);
    expect(screen.queryByText('Retur sudah tercatat')).toBeNull();
    expect(state.commands.map((c: any) => c.op)).toEqual(['save_return_draft', 'post_return']);
    expect(screen.getByRole('button', { name: 'Buka hasil retur tersimpan' })).toBeTruthy();
});

test('explicit source refresh recovers a failed background binding without reusing its old query version', async () => {
    const { state, client } = await openReturn();
    change('Referensi retur', 'RECOVER SOURCES'); change('Jumlah retur SJ-1 Item 1', '5');
    state.fail = (n: string) => n === 'pilot_co_customer_batches_v1'
        ? { data: null, error: { code: 'PT409', message: 'CO_VERSION_CONFLICT' } } : null;
    await act(async () => { await client.invalidateQueries({ predicate: q => q.queryKey[4] === 'return-preparation' }); });
    await screen.findByText(/Sumber berubah/);
    state.cv = '2'; state.fail = null;
    await click('Muat sumber retur terbaru'); await click('Saya sudah memeriksa sumber terbaru');
    const save = screen.getByRole('button', { name: 'Simpan Draft retur' });
    await waitFor(() => expect(save.matches(':disabled')).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(state.commands).toHaveLength(1));
    expect(state.commands[0].payload.expected_customer_version).toBe('2');
    expect(state.commands[0].payload.lines).toEqual([{ batch_id: id(2001), quantity: 5 }]);
});
test('Escape and signout Keep retain return fields and closing restores its trigger', async () => {
    await openReturn(); change('Referensi retur', 'FOCUS WORK');
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await click('Tetap mengedit');
    expect(screen.getByDisplayValue('FOCUS WORK')).toBeTruthy();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    let decision!: Promise<boolean>;
    act(() => { decision = wire.guard(new AbortController().signal); });
    await click('Tetap mengedit');
    await expect(decision).resolves.toBe(false);
    await click('Tutup retur'); await click('Buang perubahan');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retur barang belum terjual' }));
});

test('nested acknowledgement pending locks the return dialog until recovery is accepted', async () => {
    const { state } = await openReturn();
    state.report.impacts.missing_month = [{ report_month: '2026-09-01', reason: 'missing', head_id: null, coverage_through_date: null }];
    await saveReturn(); await click('Tinjau semua dampak'); await click('Lengkapi periode 2026-09');
    await click('Perbarui periode terhadap sumber usulan');
    await screen.findByLabelText('Terjual Item 1');
    change('Terjual Item 1', '7'); change('Catatan laporan', 'DIRTY NESTED');
    let attempted = false, reconciles = 0;
    let release!: (value: any) => void;
    const deferred = new Promise(resolve => { release = resolve; });
    state.report.fail = async (n: string, a: any) => {
        if (n === 'pilot_co_transaction_v1' && a.p_payload.action === 'upsert_lines' && !attempted) {
            attempted = true; await state.report.handle(n, a);
            return { data: null, error: { code: '08006', message: 'Nested reply lost' } };
        }
        if (n === 'pilot_reconcile_co_v1' && ++reconciles === 2) return deferred;
        return null;
    };
    await click('Simpan Draft periode'); await screen.findAllByText('Nested reply lost');
    await click('Pulihkan hasil penyimpanan'); await click('Lihat hasil tersimpan'); await click('Buang perubahan');
    await waitFor(() => expect(reconciles).toBe(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tutup retur' }).matches(':disabled')).toBe(true));
    expect(screen.getByRole('button', { name: 'Kembali ke sumber' }).matches(':disabled')).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => { release(null); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tutup retur' }).matches(':disabled')).toBe(false));
    expect(state.report.commands.filter((c: any) => c.payload.action === 'upsert_lines')).toHaveLength(1);
});

test('shared and source result-retry buttons cannot start competing canonical imports', async () => {
    const { state } = await openReturn(); await saveReturn();
    state.fail = (n: string, a: any) => n === 'pilot_co_return_v1' && a.p_view === 'effective'
        ? { data: null, error: { code: '08006', message: 'Posted canonical offline' } } : null;
    await click('Tinjau semua dampak'); await click('Terapkan perubahan');
    await screen.findAllByText('Posted canonical offline');
    let imports = 0, release!: (value: any) => void;
    const deferred = new Promise(resolve => { release = resolve; });
    state.fail = (n: string, a: any) => {
        if (n === 'pilot_co_return_v1' && a.p_view === 'effective') { imports++; return deferred; }
        return null;
    };
    await click('Buka hasil retur tersimpan');
    fireEvent.click(screen.getByRole('button', { name: 'Buka hasil perubahan tersimpan' }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(imports).toBe(1);
    await act(async () => { release(null); });
    await screen.findByText('Retur sudah tercatat');
    expect(state.commands).toHaveLength(2);
});

test('refreshing a saved draft requires re-saving fresh source bindings before preview', async () => {
    const { state } = await openReturn();
    change('Referensi retur', 'REBIND'); change('Jumlah retur SJ-1 Item 1', '5');
    await click('Simpan Draft retur');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tinjau / post retur' }).matches(':disabled')).toBe(false));
    state.cv = '2'; state.draft.header.bindings_current = false;
    await click('Muat sumber retur terbaru'); await click('Saya sudah memeriksa sumber terbaru');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simpan Draft retur' }).matches(':disabled')).toBe(false));
    expect(screen.getByRole('button', { name: 'Tinjau / post retur' }).matches(':disabled')).toBe(true);
    await click('Simpan Draft retur'); await click('Tinjau / post retur');
    expect(state.commands[1].payload).toMatchObject({ draft_id: id(20), expected_draft_version: '1', expected_customer_version: '2' });
});

test('newer authoritative parent version freezes a retained return before stale dispatch', async () => {
    const { state, client } = await openReturn();
    change('Referensi retur', 'PARENT DRIFT'); change('Jumlah retur SJ-1 Item 1', '5');
    const field = screen.getByDisplayValue('PARENT DRIFT');
    state.cv = '2';
    await act(async () => { await client.invalidateQueries({ predicate: q => q.queryKey[4] === 'customer-stock' }); });
    await screen.findByText(/Sumber berubah/);
    expect(screen.getByDisplayValue('PARENT DRIFT')).toBe(field);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simpan Draft retur' }).matches(':disabled')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft retur' }));
    expect(state.commands).toHaveLength(0);
    await click('Muat sumber retur terbaru'); await click('Saya sudah memeriksa sumber terbaru');
    await click('Simpan Draft retur');
    await waitFor(() => expect(state.commands).toHaveLength(1));
    expect(state.commands[0].payload.expected_customer_version).toBe('2');
});
