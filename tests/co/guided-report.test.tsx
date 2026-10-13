import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { customer, draftId, fingerprint, freshness, id, month, mount, reportImpact, store, wire } from './report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COMonthlyReports from '../../src/pages/athel/co/COMonthlyReports';
import { COFreshness } from '../../src/components/co/COShared';

const primary = (element: HTMLElement) => expect(element.classList.contains('ui-action--primary')).toBe(true);
const stockLink = () => screen.queryByRole('link', { name: 'Lihat sisa stok pelanggan' });
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { release, promise }; }
function noRequired(status: 'complete' | 'no_recorded_activity') {
    return { ...freshness, status, next_required_report_month: null, pending_report_month_count: '0', overdue_report_month_count: '0', next_required_month_end: null, days_since_pending_month_end: null };
}

test('chooser opens authoritative next month independently of the historical filter without saving', async () => {
    const s = store();
    mount(<COMonthlyReports/>, `/athel/co/reports?customer=${customer}&month=2025-02`);
    const next = await screen.findByRole('link', { name: 'Buka pengisian: September 2026' });
    primary(next); expect(next.getAttribute('href')).toBe(`/athel/co/reports/${customer}/${month}`);
    expect(screen.getByRole('link', { name: 'Buka periode pilihan: Februari 2025' }).getAttribute('href')).toBe(`/athel/co/reports/${customer}/2025-02-01`);
    expect(screen.getByText(/Membuka pengisian belum menyimpan draft/)).toBeTruthy();
    expect(s.commands).toHaveLength(0);
});

test('query navigation and Back/Forward keep the chooser customer in sync without commands', async () => {
    const s = store(); const { router } = mount(<COMonthlyReports/>, '/athel/co/reports');
    await screen.findByLabelText('Pelanggan laporan');
    await act(() => router.navigate(`/athel/co/reports?customer=${customer}&month=2025-02`));
    expect((screen.getByLabelText('Pelanggan laporan') as HTMLSelectElement).value).toBe(customer);
    expect((screen.getByLabelText('Bulan laporan') as HTMLInputElement).value).toBe('2025-02');
    await screen.findByRole('link', { name: 'Buka pengisian: September 2026' });
    await act(() => router.navigate(-1));
    expect((screen.getByLabelText('Pelanggan laporan') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('link', { name: /Buka pengisian:/ })).toBeNull();
    await act(() => router.navigate(1));
    await screen.findByRole('link', { name: 'Buka pengisian: September 2026' });
    expect(s.commands).toHaveLength(0);
});

test('refreshing and failed month authority never offer a cached next-month action', async () => {
    const s = store(); const { client } = mount(<COMonthlyReports/>, `/athel/co/reports?customer=${customer}`);
    await screen.findByRole('link', { name: 'Buka pengisian: September 2026' });
    const pending = gate();
    s.fail = async (name: string) => { if (name === 'pilot_co_report_months_v1') { await pending.promise; return { data: null, error: { code: '08006', message: 'Months offline' } }; } return null; };
    let refreshed!: Promise<void>;
    await act(async () => { refreshed = client.invalidateQueries({ predicate: query => query.queryKey[4] === 'report-months' }); });
    await screen.findByText('Memeriksa periode laporan berikutnya…');
    expect(screen.queryByRole('link', { name: /Buka pengisian:/ })).toBeNull();
    await act(async () => { pending.release(); await refreshed; });
    await screen.findByText('Months offline');
    expect(screen.queryByRole('link', { name: /Buka pengisian:/ })).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test.each(['complete', 'no_recorded_activity'] as const)('chooser describes %s with no invented next period', async status => {
    const s = store(), base = s.handle;
    wire.handler = async (name: string, args: any) => { const result = await base(name, args); if (name === 'pilot_co_report_months_v1') Object.assign(result.data, { reporting_freshness: noRequired(status), ...(status === 'no_recorded_activity' ? { first_month: null, last_month: null } : {}) }); return result; };
    mount(<COMonthlyReports/>, `/athel/co/reports?customer=${customer}`);
    await screen.findByText(status === 'complete' ? /Tidak ada periode wajib yang perlu dilengkapi saat ini\./ : /Posting Surat Jalan terlebih dahulu/);
    expect(screen.queryByRole('link', { name: /Buka pengisian:/ })).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test('an absent report stays read-only through mount, StrictMode, query navigation and remount until explicit start', async () => {
    const s = store(); s.draft = false;
    const { router } = mount(<COMonthlyReport/>, undefined, true);
    const start = await screen.findByRole('button', { name: 'Mulai laporan' });
    primary(start); expect(screen.getByText(/Halaman ini belum menyimpan draft/)).toBeTruthy();
    expect(s.commands).toHaveLength(0);
    await act(() => router.navigate(`/athel/co/reports/${customer}/${month}?start=1`));
    await act(() => router.navigate('/away'));
    await act(() => router.navigate(-1));
    await screen.findByRole('button', { name: 'Mulai laporan' });
    expect(s.commands).toHaveLength(0);
    s.cv = '2';
    fireEvent.click(screen.getByRole('button', { name: 'Mulai laporan' }));
    await screen.findByLabelText('Terjual Item 1');
    expect(s.commands).toHaveLength(1);
    expect(s.commands[0]).toEqual({ op: 'save_report_draft', payload: { action: 'initialize', customer_id: customer, report_month: month, expected_customer_version: '2' } });
});

test('saved draft opens unchanged with a period-total guide and review as the incomplete next action', async () => {
    const s = store(2); s.rows[0].sold_quantity = '7'; s.metadata.notes = 'Saved note';
    mount(<COMonthlyReport/>);
    expect((await screen.findByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('7');
    expect((screen.getByLabelText('Terjual Item 2') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Saved note');
    expect(screen.getByRole('region', { name: 'Langkah laporan' }).textContent).toMatch(/Lanjutkan laporan/);
    expect(screen.getByText(/total terjual selama periode ini, bukan jumlah stok atau tambahan penjualan/)).toBeTruthy();
    expect(screen.getByText(/Kosong berarti belum diketahui; isi 0/)).toBeTruthy();
    primary(screen.getByRole('button', { name: 'Tinjau laporan' }));
    expect(screen.getByRole('button', { name: 'Tinjau laporan' }).matches(':disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Simpan Draft' }).classList.contains('ui-action--secondary')).toBe(true);
    expect(s.commands).toHaveLength(0);
});

test('incomplete reports remain reviewable and expose blockers outside technical details', async () => {
    const s = store(); s.impacts.report = [{ ...reportImpact(), after_sold_quantity: '0', complete: false }];
    s.impacts.issue = [{ code: 'CO_REPORT_INCOMPLETE', report_month: month, stock_key_id: id(1001) }];
    mount(<COMonthlyReport/>); await screen.findByLabelText('Terjual Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    const post = await screen.findByRole('button', { name: 'Post laporan' });
    expect(post.matches(':disabled')).toBe(true);
    expect((await screen.findByText(/CO_REPORT_INCOMPLETE/)).closest('details')).toBeNull();
    expect(screen.getByText(/Provisional: laporan belum lengkap/).closest('details')).toBeNull();
    expect(screen.getByRole('button', { name: 'Periode wajib (0)' }).closest('details')).toBeNull();
    const detail = screen.getByText('Detail teknis peninjauan').closest('details')!;
    expect(detail.open).toBe(false); expect(detail.querySelector('summary')).toBeTruthy();
    expect(detail.textContent).toContain(fingerprint);
    expect(s.previewCount).toBe(1); expect(s.commands).toHaveLength(0);
});

test('dirty review saves once, retains current-period and stock summaries, and disclosure does not refetch', async () => {
    const s = store(); s.impacts.report = [reportImpact()];
    mount(<COMonthlyReport/>);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } });
    primary(screen.getByRole('button', { name: 'Tinjau laporan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByText('Terjual periode dipilih: 70');
    const revenue = screen.getByText('Pendapatan periode dipilih: Rp 720.000');
    const stock = screen.getByText(/Sisa stok tercatat pelanggan ini \(semua CO\):.*30 → 30/);
    expect(revenue.closest('details')).toBeNull(); expect(stock.closest('details')).toBeNull();
    expect(screen.getByText(/Cakupan periode dipilih: 30 September 2026.*UTC/).closest('details')).toBeNull();
    const detail = screen.getByText('Detail teknis peninjauan').closest('details')!;
    expect(screen.getByText(/Seluruh riwayat pelanggan sesudah:/).closest('details')).toBe(detail);
    const before = wire.rpc.mock.calls.length;
    fireEvent.click(detail.querySelector('summary')!); expect(detail.open).toBe(true);
    fireEvent.click(detail.querySelector('summary')!); expect(detail.open).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(wire.rpc.mock.calls.length).toBe(before);
    expect(s.commands).toHaveLength(1);
    expect(s.commands[0].payload).toMatchObject({ action: 'upsert_lines', draft_id: draftId, expected_draft_version: '1', lines: [{ stock_key_id: id(1001), sold_quantity: 70 }] });
    expect(wire.rpc.mock.calls.find(([name]) => name === 'pilot_co_preview_v1')![1].p_payload.expected_draft_version).toBe('2');
});

test('remaining-stock navigation appears only after canonical post readback and preserves the customer', async () => {
    const s = store(); s.rows[0].sold_quantity = '70'; s.impacts.report = [reportImpact()];
    mount(<COMonthlyReport/>); await screen.findByLabelText('Terjual Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByRole('button', { name: 'Post laporan' });
    const pending = gate(); let failReadback = true;
    s.fail = async (name: string) => { if (name === 'pilot_co_report_v1' && s.commands.some((c: any) => c.op === 'post_report') && failReadback) { await pending.promise; return { data: null, error: { code: '08006', message: 'Posted readback offline' } }; } return null; };
    fireEvent.click(screen.getByRole('button', { name: 'Post laporan' }));
    await waitFor(() => expect(s.commands).toHaveLength(1));
    expect(stockLink()).toBeNull();
    await act(async () => pending.release());
    await screen.findByText('Posted readback offline');
    expect(stockLink()).toBeNull();
    failReadback = false;
    fireEvent.click(screen.getByRole('button', { name: 'Buka hasil laporan tersimpan' }));
    const link = await screen.findByRole('link', { name: 'Lihat sisa stok pelanggan' });
    expect(link.getAttribute('href')).toBe(`/athel/co/stock?customer=${customer}`);
    primary(link);
    expect(screen.getByText(/Stok buku pelanggan, bukan hasil pemeriksaan stok fisik/)).toBeTruthy();
    expect(s.commands).toHaveLength(1);
    expect(s.commands[0].payload.preview_fingerprint).toBe(fingerprint);
    expect(screen.getByText(/Revisi efektif:/).closest('details')?.open).toBe(false);
});

test('no-activity report explains posted delivery prerequisite instead of offering a draft write', async () => {
    const s = store(); s.draft = false; const base = s.root;
    s.root = () => ({ ...base(), reporting_freshness: noRequired('no_recorded_activity') });
    mount(<COMonthlyReport/>);
    await screen.findByText(/Posting Surat Jalan terlebih dahulu/);
    expect(screen.queryByRole('button', { name: 'Mulai laporan' })).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test('failed explicit preparation exposes its blocker while keeping the start retry deliberate', async () => {
    const s = store(); s.draft = false;
    s.fail = (name: string) => name === 'pilot_co_transaction_v1' ? { data: null, error: { code: '22023', message: 'Source not ready' } } : null;
    mount(<COMonthlyReport/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Mulai laporan' }));
    await screen.findByText('Source not ready');
    expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test.each([['complete', 'success'], ['no_recorded_activity', 'neutral'], ['missing_completed_period', 'warning'], ['current_unreported', 'warning'], ['current_partial', 'warning']] as const)('freshness %s has its existing semantic tone', async (status, tone) => {
    store(); mount(<COFreshness value={{ ...freshness, status } as any} compact/>);
    const badge = document.querySelector('.ui-status-badge')!;
    expect(badge.classList.contains(`ui-status-badge--${tone}`)).toBe(true);
    expect(badge.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
});

test('an absent report shows a background read blocker and explicit retry before preparation', async () => {
    const s = store(); s.draft = false;
    const { client } = mount(<COMonthlyReport/>);
    await screen.findByRole('button', { name: 'Mulai laporan' });
    s.fail = (name: string) => name === 'pilot_co_report_v1' ? { data: null, error: { code: '08006', message: 'Preparation source offline' } } : null;
    await act(async () => { await client.invalidateQueries({ predicate: query => query.queryKey[4] === 'report' }); });
    expect(await screen.findByText('Preparation source offline')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mulai laporan' }).matches(':disabled')).toBe(true);
    expect(s.commands).toHaveLength(0);
    s.fail = null;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mulai laporan' }).matches(':disabled')).toBe(false));
    expect(s.commands).toHaveLength(0);
});

test('correction guide preserves effective-first initialization and explains its separate save requirement', async () => {
    const s = store(); s.rows[0].sold_quantity = '7'; s.metadata.notes = 'Existing correction draft';
    s.effective = { ...s.header(), id: id(4), status: 'posted', draft_id: null, draft_version: null, report_head_id: id(4), revision_id: id(5), report_version: '1', eligible_set_fingerprint: null, revenue: '70000' };
    mount(<COMonthlyReport/>);
    const prepare = await screen.findByRole('button', { name: 'Siapkan revisi laporan' });
    await waitFor(() => expect(prepare.matches(':disabled')).toBe(false));
    expect(screen.queryByLabelText('Terjual Item 1')).toBeNull(); expect(s.commands).toHaveLength(0);
    fireEvent.click(prepare);
    const sold = await screen.findByLabelText('Terjual Item 1');
    expect((sold as HTMLInputElement).value).toBe('7');
    expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Existing correction draft');
    fireEvent.change(sold, { target: { value: '8' } });
    expect(screen.getByRole('region', { name: 'Langkah laporan' }).textContent).toMatch(/Simpan Draft sebelum meninjau koreksi/);
    expect(screen.getByRole('button', { name: 'Tinjau koreksi laporan' }).matches(':disabled')).toBe(true);
    expect(s.commands).toHaveLength(1); expect(s.commands[0].payload.action).toBe('initialize');
});
