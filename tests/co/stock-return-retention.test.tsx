import React from 'react';
import { expect, test } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { customer, mount, mountApp, stockFixture, wire } from './stock-ui-harness';
import App from '../../src/App';
import CODetail from '../../src/pages/athel/co/CODetail';

async function click(name: string) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.matches(':disabled')).toBe(false));
    fireEvent.click(button);
}
function change(name: string, value: string) {
    fireEvent.change(screen.getByLabelText(name), { target: { value } });
}
const sourceReads = () => wire.rpc.mock.calls.filter(([name]) =>
    name === 'pilot_co_customer_stock_v1' || name === 'pilot_co_customer_batches_v1').length;
async function reviewReturn(nested = false) {
    const state = stockFixture();
    if (nested) state.report.impacts.missing_month = [{
        report_month: '2026-09-01', reason: 'missing', head_id: null, coverage_through_date: null,
    }];
    mountApp(<App />, `/athel/co/stock?customer=${customer}`);
    await click('Retur barang belum terjual');
    await screen.findByLabelText('Jumlah retur SJ-1 Item 1');
    change('Jumlah retur SJ-1 Item 1', '5');
    change('Referensi retur', 'RETAIN SOURCE');
    await click('Simpan Draft retur');
    await click('Tinjau / post retur');
    change('Alasan perubahan', 'RETAIN REVIEW REASON');
    if (nested) {
        await click('Tinjau semua dampak');
        await click('Lengkapi periode 2026-09');
        await click('Perbarui periode terhadap sumber usulan');
        await screen.findByLabelText('Terjual Item 1');
        change('Terjual Item 1', '7');
        change('Catatan laporan', 'RETAIN NESTED NOTE');
    }
    return state;
}

test.each([false, true])('source refresh explicitly decides dirty review disposal with nested=%s', async nested => {
    const state = await reviewReturn(nested);
    const field = screen.getByDisplayValue(nested ? 'RETAIN NESTED NOTE' : 'RETAIN REVIEW REASON');
    const quantity = nested ? screen.getByLabelText('Terjual Item 1') : null;
    const reads = sourceReads();
    const writes = state.report.commands.length;
    await click('Muat sumber retur terbaru');
    await screen.findByRole('button', { name: 'Tetap mengedit' });
    fireEvent.click(screen.getByRole('button', { name: 'Muat sumber retur terbaru' }));
    expect(screen.getAllByRole('button', { name: 'Tetap mengedit' })).toHaveLength(1);
    expect(sourceReads()).toBe(reads);
    await click('Tetap mengedit');
    expect(screen.getByDisplayValue(nested ? 'RETAIN NESTED NOTE' : 'RETAIN REVIEW REASON')).toBe(field);
    if (quantity) expect(screen.getByLabelText('Terjual Item 1')).toBe(quantity);
    if (quantity) expect((quantity as HTMLInputElement).value).toBe('7');
    expect(sourceReads()).toBe(reads);
    expect(state.report.commands).toHaveLength(writes);

    await click('Muat sumber retur terbaru');
    await click('Buang perubahan');
    await screen.findByText(/Pilihan lama belum disetujui ulang/);
    expect(screen.queryByDisplayValue('RETAIN REVIEW REASON')).toBeNull();
    expect(screen.queryByDisplayValue('RETAIN NESTED NOTE')).toBeNull();
    expect(screen.getByDisplayValue('RETAIN SOURCE')).toBeTruthy();
    expect((screen.getByLabelText('Jumlah retur SJ-1 Item 1') as HTMLInputElement).value).toBe('5');
    expect(state.report.commands).toHaveLength(writes);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
});

test('an obsolete refresh discard decision cannot read or revive an unmounted return owner', async () => {
    await reviewReturn(true);
    const reads = sourceReads();
    await click('Muat sumber retur terbaru');
    await screen.findByRole('button', { name: 'Buang perubahan' });
    cleanup();
    await act(async () => { await Promise.resolve(); });
    expect(sourceReads()).toBe(reads);
    expect(screen.queryByRole('dialog')).toBeNull();
});

test.each(['unknown', 'committed'] as const)('nested %s result keeps outer source refresh locked', async outcome => {
    const state = await reviewReturn(true);
    let attempted = false;
    state.report.fail = async (name: string, args: any) => {
        if (outcome === 'unknown' && name === 'pilot_co_transaction_v1' && args.p_payload.action === 'upsert_lines' && !attempted) {
            attempted = true;
            await state.report.handle(name, args);
            return { data: null, error: { code: '08006', message: 'Nested reply lost before refresh' } };
        }
        if (outcome === 'committed' && name === 'pilot_co_report_v1'
            && state.report.commands.some((command: any) => command.payload.action === 'upsert_lines')) {
            return { data: null, error: { code: '08006', message: 'Nested import unavailable before refresh' } };
        }
        return null;
    };
    await click('Simpan Draft periode');
    await screen.findAllByText(outcome === 'unknown' ? 'Nested reply lost before refresh' : 'Nested import unavailable before refresh');
    const refresh = screen.getByRole('button', { name: 'Muat sumber retur terbaru' });
    await waitFor(() => expect(refresh.matches(':disabled')).toBe(true));
    const reads = sourceReads();
    fireEvent.click(refresh);
    expect(sourceReads()).toBe(reads);
    expect(screen.getByDisplayValue('RETAIN NESTED NOTE')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Buang perubahan' })).toBeNull();
    expect(screen.getByRole('button', { name: outcome === 'unknown' ? 'Pulihkan hasil penyimpanan' : 'Buka hasil laporan tersimpan' })).toBeTruthy();
    state.report.fail = null;
    if (outcome === 'unknown') {
        await click('Pulihkan hasil penyimpanan');
        await click('Lihat hasil tersimpan');
        await click('Buang perubahan');
    } else await click('Buka hasil laporan tersimpan');
    await waitFor(() => expect(refresh.matches(':disabled')).toBe(false));
    expect(state.report.commands.filter((command: any) => command.payload.action === 'upsert_lines')).toHaveLength(1);
});

test.each(['resolve_undelivered', 'close_co'] as const)('settlement %s conflict requires checked complete refresh and explicit re-review', async operation => {
    const state = stockFixture();
    if (operation === 'close_co') state.blockers = { stock_remains: false, undelivered_remains: false, missing_month_count: '0' };
    mount(<CODetail />, `/athel/co/${state.co.id}`);
    const label = operation === 'close_co' ? 'penutupan' : 'penyelesaian';
    await click(operation === 'close_co' ? 'Tutup CO' : 'Selesaikan sisa belum dikirim');
    const reason = await screen.findByLabelText(`Alasan ${label}`);
    await waitFor(() => expect(reason.matches(':disabled')).toBe(false));
    if (operation === 'resolve_undelivered') change('Jumlah dibatalkan Item 1', '5');
    change(`Alasan ${label}`, 'RETAIN SETTLEMENT CONFLICT');
    let attempts = 0;
    state.fail = (name: string) => name === 'pilot_co_transaction_v1'
        ? (++attempts, { data: null, error: { code: 'PT409', message: 'CO_VERSION_CONFLICT' } }) : null;
    await click(`Konfirmasi ${label}`);
    await screen.findByText(/^CO berubah\./);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Muat sumber penyelesaian terbaru' }).matches(':disabled')).toBe(false));
    const submit = screen.getByRole('button', { name: `Konfirmasi ${label}` });
    expect(submit.matches(':disabled')).toBe(true);
    fireEvent.click(submit);
    expect(attempts).toBe(1);
    expect(screen.getByDisplayValue('RETAIN SETTLEMENT CONFLICT')).toBe(reason);

    state.fail = (name: string) => name === 'pilot_co_detail_v1'
        ? { data: null, error: { code: '08006', message: 'Settlement refresh offline' } } : null;
    await click('Muat sumber penyelesaian terbaru');
    await screen.findByText('Settlement refresh offline');
    expect(submit.matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Saya sudah memeriksa sisa terbaru' })).toBeNull();

    state.co.co_version = '2'; state.cv = '2';
    let release!: (value: null) => void;
    const deferred = new Promise<null>(resolve => { release = resolve; });
    let waiting = false;
    state.fail = (name: string, args: any) => {
        const completeRead = operation === 'resolve_undelivered'
            ? name === 'pilot_co_detail_section_v1' && args.p_section === 'lines' && args.p_expected_version === '2'
            : name === 'pilot_co_detail_v1' && args.p_expected_version === '2';
        if (completeRead && !waiting) { waiting = true; return deferred; }
        return null;
    };
    await click('Muat sumber penyelesaian terbaru');
    await waitFor(() => expect(waiting).toBe(true));
    expect(submit.matches(':disabled')).toBe(true);
    const recheck = await screen.findByRole('button', { name: 'Saya sudah memeriksa sisa terbaru' });
    expect(recheck.matches(':disabled')).toBe(true);
    fireEvent.click(recheck); fireEvent.click(submit);
    expect(attempts).toBe(1);
    await act(async () => { release(null); });
    await waitFor(() => expect(recheck.matches(':disabled')).toBe(false));
    expect(submit.matches(':disabled')).toBe(true);
    await click('Saya sudah memeriksa sisa terbaru');
    await click(`Konfirmasi ${label}`);
    await waitFor(() => expect(state.commands).toHaveLength(1));
    expect(state.commands[0]).toMatchObject({ op: operation, payload: {
        expected_co_version: '2', expected_customer_version: '2', reason: 'RETAIN SETTLEMENT CONFLICT',
        ...(operation === 'resolve_undelivered' ? { lines: [{ co_line_id: state.lines[0].id, quantity: 5 }] } : {}),
    } });
});


test('settlement conflict cannot reuse a same-version cached line read as its explicit refresh', async () => {
    const state = stockFixture();
    mount(<CODetail />, `/athel/co/${state.co.id}`);
    await click('Selesaikan sisa belum dikirim');
    await screen.findByLabelText('Jumlah dibatalkan Item 1');
    change('Jumlah dibatalkan Item 1', '5'); change('Alasan penyelesaian', 'SAME VERSION');
    state.fail = (name: string) => name === 'pilot_co_transaction_v1'
        ? { data: null, error: { code: 'PT409', message: 'CO_VERSION_CONFLICT' } } : null;
    await click('Konfirmasi penyelesaian');
    await screen.findByText(/^CO berubah\./);
    state.fail = (name: string, args: any) => name === 'pilot_co_detail_section_v1' && args.p_section === 'lines'
        ? { data: null, error: { code: '08006', message: 'Complete fresh lines unavailable' } } : null;
    await click('Muat sumber penyelesaian terbaru');
    await screen.findAllByText('Complete fresh lines unavailable');
    expect(screen.getByRole('button', { name: 'Saya sudah memeriksa sisa terbaru' }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Konfirmasi penyelesaian' }).matches(':disabled')).toBe(true);
    expect(screen.getByDisplayValue('SAME VERSION')).toBeTruthy();
    expect((screen.getByLabelText('Jumlah dibatalkan Item 1') as HTMLInputElement).value).toBe('5');
    expect(state.commands).toHaveLength(0);
});
