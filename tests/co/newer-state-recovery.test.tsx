import React from 'react';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { customer, mountApp, stockFixture, wire, id } from './stock-ui-harness';
import App from '../../src/App';
const pending = () => Object.keys(localStorage).filter(key => key.startsWith('co-request:'));
async function click(name: string) {
    const node = await screen.findByRole('button', { name });
    await waitFor(() => expect(node.matches(':disabled')).toBe(false)); fireEvent.click(node);
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function begin(kind: 'return' | 'settlement', lost: boolean, sameTarget: boolean) {
    const s = stockFixture();
    const path = kind === 'return' ? `/athel/co/stock?customer=${customer}` : `/athel/co/${id(11)}`;
    const owner = mountApp(<App/>, path);
    await click(kind === 'return' ? 'Retur barang belum terjual' : 'Selesaikan sisa belum dikirim');
    await screen.findByLabelText(kind === 'return' ? 'Jumlah retur SJ-1 Item 1' : 'Jumlah dibatalkan Item 1');
    change(kind === 'return' ? 'Jumlah retur SJ-1 Item 1' : 'Jumlah dibatalkan Item 1', '5');
    change(kind === 'return' ? 'Referensi retur' : 'Alasan penyelesaian', 'PRIVATE BEFORE RECOVERY');
    let executed = false;
    s.fail = async (name: string, args: any) => {
        if (name === 'pilot_co_transaction_v1' && !executed) {
            executed = true;
            const result = await s.handle(name, args);
            s.cv = '9';
            if (sameTarget && kind === 'return') { s.draft.header.draft_version = '2'; s.draft.header.reference = 'Latest return'; s.draft.lines[0].quantity = '3'; }
            if (sameTarget && kind === 'settlement') { s.co.co_version = '3'; s.lines[0].pending_quantity = '20'; }
            return lost ? { data: null, error: { code: '08006', message: 'Reply lost after commit' } } : result;
        }
        if (name === 'pilot_co_return_v1' && args.p_expected_customer_version !== s.cv) return { data: null, error: { code: 'PT409', message: 'CO_VERSION_CONFLICT' } };
        return null;
    };
    await click(kind === 'return' ? 'Simpan Draft retur' : 'Konfirmasi penyelesaian');
    if (lost) {
        await screen.findByText('Reply lost after commit');
        await click('Pulihkan hasil penyimpanan'); await click('Lihat hasil tersimpan'); await click('Buang perubahan');
    } else await screen.findByRole('button', { name: kind === 'return' ? 'Buka hasil retur tersimpan' : 'Buka hasil penyelesaian tersimpan' });
    await waitFor(() => expect(pending()).toHaveLength(1));
    return { s, path, ...owner };
}
for (const kind of ['return', 'settlement'] as const) {
    test.each([[false, false], [true, false], [false, true], [true, true]])(`${kind}: known/lost=%s and same-target=%s permits Keep/Discard and one next legitimate write`, async (lost, sameTarget) => {
        const { s } = await begin(kind, lost, sameTarget);
        const key = pending()[0], before = localStorage.getItem(key);
        const original = JSON.parse(before!).committed;
        expect(original.customer_version).not.toBe('9');
        const resolve = kind === 'return' ? 'Selesaikan konflik retur' : 'Selesaikan konflik penyelesaian';
        await click(resolve); await click('Tetap mengedit');
        expect(localStorage.getItem(key)).toBe(before); expect(screen.getByDisplayValue('PRIVATE BEFORE RECOVERY')).toBeTruthy();
        await click(resolve); await click('Buang perubahan');
        await waitFor(() => expect(pending()).toHaveLength(0));
        expect(s.commands).toHaveLength(1);
        await click(kind === 'return' ? 'Saya sudah memeriksa sumber terbaru' : 'Saya sudah memeriksa sisa terbaru');
        change(kind === 'return' ? 'Jumlah retur SJ-1 Item 1' : 'Jumlah dibatalkan Item 1', '2');
        change(kind === 'return' ? 'Referensi retur' : 'Alasan penyelesaian', 'Next legitimate write');
        await click(kind === 'return' ? 'Simpan Draft retur' : 'Konfirmasi penyelesaian');
        await waitFor(() => expect(s.commands).toHaveLength(2));
        expect(s.commands[1].payload.expected_customer_version).toBe('9');
        expect(s.commands[1].payload[kind === 'return' ? 'expected_draft_version' : 'expected_co_version']).toBe(kind === 'return' ? sameTarget ? '2' : '1' : sameTarget ? '3' : '2');
        await waitFor(() => expect(pending()).toHaveLength(0));
    });
    test.each([[false, 'reload'], [true, 'reload'], [false, 'reopen'], [true, 'reopen']] as const)(`${kind}: committed state survives departure (lost=%s, %s)`, async (lost, departure) => {
        const { s, path, client } = await begin(kind, lost, true);
        const before = localStorage.getItem(pending()[0]);
        if (departure === 'reload') { cleanup(); mountApp(<App/>, path); }
        else {
            await click(kind === 'return' ? 'Tutup retur' : 'Batal'); await click('Buang perubahan');
            await act(async () => { await client.invalidateQueries({ queryKey: ['co'] }); });
        }
        await click(kind === 'return' ? 'Retur barang belum terjual' : 'Selesaikan sisa belum dikirim');
        await screen.findByLabelText(kind === 'return' ? 'Referensi retur' : 'Alasan penyelesaian');
        await click('Pulihkan hasil penyimpanan'); await click('Lihat hasil tersimpan');
        await click(kind === 'return' ? 'Selesaikan konflik retur' : 'Selesaikan konflik penyelesaian');
        // A clean reopened editor has no unsaved fields to discard; the action itself is deliberate.
        await waitFor(() => expect(pending()).toHaveLength(0));
        expect(s.commands).toHaveLength(1); expect(JSON.parse(before!).committed.version).toBe(kind === 'return' ? '1' : '2');
    });
    test(`${kind}: failed acknowledgement keeps exact receipt and unsaved input`, async () => {
        await begin(kind, true, true);
        const key = pending()[0], before = localStorage.getItem(key), base = wire.handler;
        wire.handler = async (name: string, args: any) => name === 'pilot_reconcile_co_v1'
            ? { data: null, error: { code: '08006', message: 'Acknowledgement unavailable' } } : base(name, args);
        await click(kind === 'return' ? 'Selesaikan konflik retur' : 'Selesaikan konflik penyelesaian'); await click('Buang perubahan');
        await screen.findByText('Acknowledgement unavailable');
        expect(localStorage.getItem(key)).toBe(before); expect(screen.getByDisplayValue('PRIVATE BEFORE RECOVERY')).toBeTruthy();
    });
    test(`${kind}: obsolete owner cannot acknowledge or import into a replacement`, async () => {
        const { path } = await begin(kind, true, true);
        const key = pending()[0], before = localStorage.getItem(key), base = wire.handler;
        let release!: () => Promise<void>;
        wire.handler = async (name: string, args: any) => name === 'pilot_reconcile_co_v1'
            ? new Promise(resolve => { release = async () => resolve(await base(name, args)); }) : base(name, args);
        await click(kind === 'return' ? 'Selesaikan konflik retur' : 'Selesaikan konflik penyelesaian'); await click('Buang perubahan');
        await waitFor(() => expect(release).toBeTypeOf('function'));
        cleanup(); mountApp(<App/>, path); await screen.findByRole('heading', { name: kind === 'return' ? 'Customer Stock' : 'CO-1' });
        await act(async () => release());
        expect(localStorage.getItem(key)).toBe(before); expect(screen.queryByDisplayValue('PRIVATE BEFORE RECOVERY')).toBeNull();
    });
}

test.each([false, true])('later return-head revision preserves original consumed-draft linkage (bad linkage=%s)', async badLinkage => {
    const s = stockFixture(); mountApp(<App/>, `/athel/co/stock?customer=${customer}`);
    await click('Retur barang belum terjual'); await screen.findByLabelText('Jumlah retur SJ-1 Item 1');
    change('Jumlah retur SJ-1 Item 1', '5'); change('Referensi retur', 'POST ORIGINAL');
    await click('Simpan Draft retur'); await click('Tinjau / post retur');
    change('Alasan perubahan', 'Original return reason'); await click('Tinjau semua dampak');
    let posted = false;
    s.fail = async (name: string, args: any) => {
        if (name === 'pilot_co_transaction_v1' && args.p_operation === 'post_return' && !posted) {
            posted = true;
            await s.handle(name, args);
            await s.handle(name, { p_request_id: id(888), p_operation: 'correct_return', p_payload: { action: 'void' } });
            if (badLinkage) s.draft.header.head_id = id(999);
            return { data: null, error: { code: '08006', message: 'Original post response lost' } };
        }
        if (name === 'pilot_co_return_v1' && args.p_expected_customer_version !== s.cv)
            return { data: null, error: { code: 'PT409', message: 'CO_VERSION_CONFLICT' } };
        return null;
    };
    await click('Terapkan perubahan'); await screen.findAllByText('Original post response lost');
    // The source and nested review share one sender; use the source recovery panel.
    const recoveries = await screen.findAllByRole('button', { name: 'Pulihkan hasil penyimpanan' });
    fireEvent.click(recoveries[0]); await click('Lihat hasil tersimpan'); await click('Buang perubahan');
    await screen.findByRole('button', { name: 'Selesaikan konflik retur' });
    const key = pending()[0], before = localStorage.getItem(key);
    expect(JSON.parse(before!).binding.draft_id).toBe(id(20));
    expect(JSON.parse(before!).committed).toMatchObject({ operation: 'post_return', id: id(21), version: '1' });
    await click('Selesaikan konflik retur'); await click('Buang perubahan');
    if (badLinkage) {
        await screen.findByText('Draft asal tidak terhubung ke hasil retur yang diterima.');
        expect(localStorage.getItem(key)).toBe(before);
    } else {
        await waitFor(() => expect(pending()).toHaveLength(0));
        await screen.findByText(/Retur dibatalkan/);
    }
    expect(s.commands.filter((command: any) => command.op === 'post_return')).toHaveLength(1);
});
