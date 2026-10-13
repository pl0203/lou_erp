import { expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { mount, reportImpact, store, wire } from './report-ui-harness';
import { choose } from './evidence-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';

function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

test('one dirty Review intent survives canonical hydration before a delayed preview response', async () => {
    const s = store();
    s.impacts.report = [reportImpact()];
    const preview = gate();
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_preview_v1') await preview.promise;
        return base(name, args);
    };
    mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await waitFor(() => expect(s.commands).toHaveLength(1));
    await waitFor(() => expect(wire.rpc.mock.calls.some(([name]) => name === 'pilot_co_preview_v1')).toBe(true));
    await screen.findByText('1 dari 1 baris tersimpan terisi · 0 belum diisi');
    await act(async () => { preview.release(); });
    expect(await screen.findByRole('button', { name: 'Post laporan' })).toBeTruthy();
    expect(s.commands).toHaveLength(1);
    expect(wire.rpc.mock.calls.find(([name]) => name === 'pilot_co_preview_v1')![1].p_payload.expected_draft_version).toBe('2');
});

test('dirty Review waits for the acknowledged row snapshot before starting its preview', async () => {
    const s = store();
    s.impacts.report = [reportImpact()];
    const canonical = gate(), rows = gate();
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_report_v1' && s.commands.length) await canonical.promise;
        if (name === 'pilot_co_report_rows_v1' && args.p_expected_draft_version === '2') await rows.promise;
        return base(name, args);
    };
    mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await waitFor(() => expect(wire.rpc.mock.calls.some(([name, args]) => name === 'pilot_co_report_rows_v1' && args.p_expected_draft_version === '2')).toBe(true));
    await act(async () => { canonical.release(); });
    expect(wire.rpc.mock.calls.filter(([name]) => name === 'pilot_co_preview_v1')).toHaveLength(0);
    await act(async () => { rows.release(); });
    expect(await screen.findByRole('button', { name: 'Post laporan' })).toBeTruthy();
    expect(s.commands).toHaveLength(1);
    expect(wire.rpc.mock.calls.filter(([name]) => name === 'pilot_co_preview_v1')).toHaveLength(1);
});

test.each(['metadata', 'quantities and metadata'])('one Review binds the final save when %s are dirty', async kind => {
    const s = store();
    s.rows[0].sold_quantity = '70';
    s.impacts.report = [reportImpact()];
    const preview = gate();
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_preview_v1') await preview.promise;
        return base(name, args);
    };
    mount(<COMonthlyReport />);
    await screen.findByLabelText('Terjual Item 1');
    if (kind === 'quantities and metadata')
        fireEvent.change(screen.getByLabelText('Terjual Item 1'), { target: { value: '71' } });
    fireEvent.change(screen.getByLabelText('Catatan laporan'), { target: { value: 'Checked sales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await waitFor(() => expect(wire.rpc.mock.calls.some(([name]) => name === 'pilot_co_preview_v1')).toBe(true));
    await act(async () => { preview.release(); });
    await screen.findByRole('button', { name: 'Post laporan' });
    expect(s.metadata.notes).toBe('Checked sales');
    expect(s.commands.map((command: any) => command.payload.action)).toEqual(kind === 'metadata' ? ['set_metadata'] : ['upsert_lines', 'set_metadata']);
    expect(wire.rpc.mock.calls.find(([name]) => name === 'pilot_co_preview_v1')![1].p_payload.expected_draft_version).toBe(kind === 'metadata' ? '2' : '3');
    fireEvent.change(screen.getByLabelText('Catatan laporan'), { target: { value: 'Newer unsaved notes' } });
    expect(screen.queryByRole('button', { name: 'Post laporan' })).toBeNull();
});

test('failed post-save row refresh cancels Review intent and retry cannot silently revive it', async () => {
    const s = store();
    s.impacts.report = [reportImpact()];
    const rows = gate();
    let failRows = true;
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_report_rows_v1' && args.p_expected_draft_version === '2' && failRows) {
            await rows.promise;
            return { data: null, error: { code: '08006', message: 'Saved rows offline' } };
        }
        return base(name, args);
    };
    mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await waitFor(() => expect(wire.rpc.mock.calls.some(([name, args]) => name === 'pilot_co_report_rows_v1' && args.p_expected_draft_version === '2')).toBe(true));
    await act(async () => { rows.release(); });
    await screen.findByText('Saved rows offline');
    expect(screen.queryByRole('button', { name: 'Post laporan' })).toBeNull();
    expect(s.previewCount).toBe(0);
    failRows = false;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Tinjau laporan' }) as HTMLButtonElement).disabled).toBe(false));
    expect(s.previewCount).toBe(0);
    expect(screen.queryByRole('button', { name: 'Post laporan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByRole('button', { name: 'Post laporan' });
    expect(s.commands).toHaveLength(1);
});

test.each(['canonical', 'rows'])('%s authority denial after saving clears private data and prevents queued preview', async source => {
    const s = store();
    s.impacts.report = [reportImpact()];
    const response = gate();
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (s.commands.length && (source === 'canonical' ? name === 'pilot_co_report_v1' : name === 'pilot_co_report_rows_v1' && args.p_expected_draft_version === '2')) {
            await response.promise;
            return { data: null, error: { code: '42501', message: 'Saved report authority denied' } };
        }
        return base(name, args);
    };
    const { client } = mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await waitFor(() => expect(s.commands).toHaveLength(1));
    await act(async () => { response.release(); });
    await screen.findByText('Saved report authority denied');
    expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Post laporan' })).toBeNull();
    expect(s.previewCount).toBe(0);
    expect(client.getQueryCache().getAll().filter(query => query.queryKey[0] === 'co' && query.state.data)).toHaveLength(0);
});

test.each(['navigate away', 'replace role'])('%s while saved rows reload cannot revive the old Review intent', async interruption => {
    const s = store();
    s.impacts.report = [reportImpact()];
    const rows = gate();
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_report_rows_v1' && args.p_expected_draft_version === '2') await rows.promise;
        return base(name, args);
    };
    const { router } = mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByText('1 dari 1 baris tersimpan terisi · 0 belum diisi');
    if (interruption === 'navigate away') {
        await act(() => router.navigate('/athel/co'));
        await screen.findByText('Destination');
    } else {
        wire.role = 'executive';
        await act(() => router.revalidate());
    }
    await act(async () => { rows.release(); });
    if (interruption === 'replace role') await screen.findByLabelText('Terjual Item 1');
    expect(screen.queryByRole('button', { name: 'Post laporan' })).toBeNull();
    expect(s.previewCount).toBe(0);
    expect(s.commands).toHaveLength(1);
});

test.each([false, true])('queued Review waits for root refetch and rejects drift=%s rather than changing its binding', async drift => {
    const s = store();
    s.impacts.report = [reportImpact()];
    const rows = gate(), root = gate();
    let refreshRoot = false;
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_report_rows_v1' && args.p_expected_draft_version === '2') await rows.promise;
        if (name === 'pilot_co_report_v1' && refreshRoot) await root.promise;
        return base(name, args);
    };
    const { client } = mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByText('1 dari 1 baris tersimpan terisi · 0 belum diisi');
    refreshRoot = true;
    let refreshed!: Promise<void>;
    await act(async () => { refreshed = client.invalidateQueries({ predicate: query => query.queryKey[4] === 'report' }); });
    await act(async () => { rows.release(); });
    expect(s.previewCount).toBe(0);
    if (drift) { s.version = '3'; s.cv = '2'; }
    await act(async () => { root.release(); await refreshed; });
    if (drift) {
        await screen.findByText(/Versi atau sumber berubah/);
        expect(s.previewCount).toBe(0);
        expect(screen.queryByRole('button', { name: 'Post laporan' })).toBeNull();
    } else {
        await screen.findByRole('button', { name: 'Post laporan' });
        expect(s.previewCount).toBe(1);
        expect(wire.rpc.mock.calls.find(([name]) => name === 'pilot_co_preview_v1')![1].p_payload.expected_draft_version).toBe('2');
    }
});

test('source change while delayed dirty-save preview is in flight cannot restore stale review', async () => {
    const s = store();
    s.impacts.report = [reportImpact()];
    const preview = gate();
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_preview_v1') {
            const result = await base(name, args);
            await preview.promise;
            return result;
        }
        return base(name, args);
    };
    const { client } = mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await waitFor(() => expect(s.previewCount).toBe(1));
    s.version = '3';
    s.cv = '2';
    await act(async () => { await client.invalidateQueries({ predicate: query => query.queryKey[4] === 'report' }); });
    await screen.findByText(/Versi atau sumber berubah/);
    await act(async () => { preview.release(); });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Siapkan / perbarui draft' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('button', { name: 'Post laporan' })).toBeNull();
    expect(s.commands).toHaveLength(1);
});

test('choosing then canceling evidence while saved rows reload cannot revive the queued Review', async () => {
    const s = store();
    s.impacts.report = [reportImpact()];
    const rows = gate();
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_report_rows_v1' && args.p_expected_draft_version === '2') await rows.promise;
        return base(name, args);
    };
    mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByText('1 dari 1 baris tersimpan terisi · 0 belum diisi');
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan pilihan lampiran' }));
    await waitFor(() => expect(screen.queryByText('synthetic.pdf · belum terpasang')).toBeNull());
    await act(async () => { rows.release(); });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Tinjau laporan' }) as HTMLButtonElement).disabled).toBe(false));
    expect(s.previewCount).toBe(0);
    expect(screen.queryByRole('button', { name: 'Post laporan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByRole('button', { name: 'Post laporan' });
    expect(s.commands).toHaveLength(1);
    expect(wire.invoke).not.toHaveBeenCalled();
});

test('failed root refetch cancels queued Review and retry requires a fresh explicit Review', async () => {
    const s = store();
    s.impacts.report = [reportImpact()];
    const rows = gate(), root = gate();
    let failRoot = false;
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_report_rows_v1' && args.p_expected_draft_version === '2') await rows.promise;
        if (name === 'pilot_co_report_v1' && failRoot) {
            await root.promise;
            return { data: null, error: { code: '08006', message: 'Saved header offline' } };
        }
        return base(name, args);
    };
    const { client } = mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByText('1 dari 1 baris tersimpan terisi · 0 belum diisi');
    failRoot = true;
    let refreshed!: Promise<void>;
    await act(async () => { refreshed = client.invalidateQueries({ predicate: query => query.queryKey[4] === 'report' }); });
    await act(async () => { rows.release(); });
    expect(s.previewCount).toBe(0);
    await act(async () => { root.release(); await refreshed; });
    await screen.findByText('Saved header offline');
    failRoot = false;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Tinjau laporan' }) as HTMLButtonElement).disabled).toBe(false));
    expect(s.previewCount).toBe(0);
    expect(screen.queryByRole('button', { name: 'Post laporan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByRole('button', { name: 'Post laporan' });
    expect(s.commands).toHaveLength(1);
});

test('dirty zero quantity reaches review in one click and still requires zero-sales confirmation', async () => {
    const s = store();
    s.impacts.report = [{ ...reportImpact(), after_sold_quantity: '0', after_revenue: '0' }];
    const preview = gate();
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_preview_v1') await preview.promise;
        return base(name, args);
    };
    mount(<COMonthlyReport />);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await waitFor(() => expect(wire.rpc.mock.calls.some(([name]) => name === 'pilot_co_preview_v1')).toBe(true));
    await act(async () => { preview.release(); });
    fireEvent.click(await screen.findByRole('button', { name: 'Post laporan' }));
    await screen.findByText('Konfirmasi bulan tanpa penjualan');
    expect(s.commands).toHaveLength(1);
    expect(s.commands[0].payload.lines[0].sold_quantity).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Konfirmasi nol' }));
    await waitFor(() => expect(s.commands).toHaveLength(2));
    expect(s.commands[1]).toMatchObject({ op: 'post_report', payload: { expected_draft_version: '2' } });
});
