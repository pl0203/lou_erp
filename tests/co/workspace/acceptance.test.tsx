import { extractor, mappingContext, loadSource, expandMapping, AcceptanceRoutes, integratedServer, syntheticFile, checkMapping, beginIntegrated, readyPreview, deferred } from './import-acceptance-harness';
// Synthetic transport + extractor boundary. These tests are not PostgreSQL or native PDF-worker evidence.
import { test, expect, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { store, mount, wire, id, customer, month, draftId, allocation, reportImpact } from '../report-ui-harness';
import { input } from '../import/reviewFixture';
import { useLocation } from 'react-router-dom';
import COCustomerStock from '../../../src/pages/athel/co/COCustomerStock';
import { freshness } from '../report-ui-harness';
import COMonthlyReport from '../../../src/pages/athel/co/COMonthlyReport';

test.each(['1e2', '-1', '1.5', '2147483648'])('R6 actual upload retains invalid raw %s across blur and close/reopen without a command', async raw => {
  const s = await loadSource();
  const quantity = await expandMapping();
  fireEvent.change(quantity, { target: { value: raw } });
  fireEvent.blur(quantity);
  fireEvent.click(screen.getByRole('button', { name: 'Periksa baris' }));
  fireEvent.click(screen.getByRole('button', { name: 'Periksa baris' }));
  expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe(raw);
  expect(screen.getAllByText('Isi jumlah terjual dalam satuan buku.').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau pencatatan' }));
  expect(screen.getByRole('region', { name: 'Hal yang perlu diperiksa' })).toBe(document.activeElement);
  expect(screen.queryByRole('button', { name: 'Catat penjualan' })).toBeNull();
  expect(s.commands).toHaveLength(0);
  expect(wire.invoke).not.toHaveBeenCalled();
});

test.each(['pdf', 'xlsx'] as const)('R1 production %s upload → mapping → pinned preview → confirm → recorded → stock → immutable Edit seed', async format => {
  const f = integratedServer(), source = await syntheticFile(format);
  extractor.extract.mockReset().mockResolvedValue(source.extracted);
  const { router } = mount(<AcceptanceRoutes />);
  fireEvent.change(await screen.findByLabelText('Pilih PDF atau XLSX'), { target: { files: [source.file] } });
  await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
  await checkMapping();
  expect(f.requests.filter(r => r.n === 'pilot_co_import_prepare_v1')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau pencatatan' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Catat penjualan' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText(/^Total sumber:/).textContent).toMatch(/^Total sumber: 2264500(?:\.00)? IDR$/);
  expect(await screen.findByText('Nilai alokasi CO periode dipilih: Rp 720.000')).toBeTruthy();
  expect(f.requests.filter(r => r.n === 'pilot_co_import_prepare_v1')).toHaveLength(1);
  expect(f.requests.find(r => r.n === 'pilot_co_import_prepare_v1')!.a.p_payload).toMatchObject({ expected_draft_version: '2', manifest: { input: { mappings: [{ quantity: '70' }] } } });
  fireEvent.click(screen.getByRole('button', { name: 'Catat penjualan' }));
  await screen.findByRole('button', { name: 'Edit' });
  expect(screen.getByRole('link', { name: 'Lihat stok toko' }).getAttribute('href')).toBe(`/athel/co/stock?customer=${customer}`);
  await screen.findByRole('columnheader', { name: 'Harga CO' });
  expect(screen.getByText('Rp 720.000')).toBeTruthy();
  fireEvent.click(screen.getByText('Bukti alokasi FIFO dan PIC asli'));
  await screen.findByText(/PIC-1/); expect(screen.getByText(/PIC-2/)).toBeTruthy();
  expect(screen.getByText('60 × Rp 10.000 = Rp 600.000')).toBeTruthy();
  expect(screen.getByText('10 × Rp 12.000 = Rp 120.000')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Lihat stok toko' }));
  const stock = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
  expect(stock.querySelector('tbody tr')?.textContent).toContain('70');
  expect(stock.querySelector('tbody tr')?.textContent).toContain('30');
  expect((screen.getByLabelText('Pelanggan stok') as HTMLSelectElement).value).toBe(customer);
  expect(f.requests.filter(r => r.n === 'pilot_co_customer_stock_v2').every(r => r.a.p_customer_id === customer)).toBe(true);
  await act(() => router.navigate(`/athel/co/reports/${customer}/${month}`));
  await screen.findByRole('button', { name: 'Edit' });
  const original = structuredClone(f.imports.get(id(5)));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByText('Nilai awal dari laporan tercatat');
  fireEvent.click(screen.getByRole('button', { name: 'Sesuai' }));
  expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('70');
  expect((screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini') as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'), { target: { value: '69' } });
  expect(f.imports.get(id(5))).toEqual(original);
  expect(f.evidenceHistory.size).toBe(1);
  fireEvent.change(screen.getByLabelText('Alasan Edit'), { target: { value: 'Rechecked original source and FIFO' } });
  fireEvent.change(screen.getByLabelText('Pilih PDF atau XLSX'), { target: { files: [source.file] } });
  await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
  fireEvent.click(screen.getByRole('button', { name: 'Periksa baris' }));
  fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'), { target: { value: '70' } });
  fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));
  fireEvent.click(screen.getByLabelText(/Semua barang dan bagian sumber/));
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau pencatatan' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Simpan perubahan' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
  await screen.findByRole('button', { name: 'Edit' });
  expect(f.imports.get(id(5))).toEqual(original);
  expect(f.imports.get(id(6)).manifest.evidenceId).not.toBe(original.manifest.evidenceId);
  expect(f.imports.get(id(6)).reason).toBe('Rechecked original source and FIFO');
  expect(f.evidenceHistory.size).toBe(2);
  expect(f.requests.filter(r => r.n === 'pilot_co_import_commit_v1')).toHaveLength(2);
  expect(f.s.commands).toEqual([]);
  expect(localStorage.length).toBe(0);
});

test('report save with durable identity stays neutral until canonical acknowledgment and never offers recovery in flight', async () => {
  const { f } = await beginIntegrated();
  await readyPreview();
  const sent = deferred(), acknowledgment = deferred();
  let committed = false;
  wire.handler = async (n, a) => {
    const result = await f.server(n, a);
    if (n === 'pilot_co_import_commit_v1') { committed = true; await sent.promise; }
    else if (committed && n === 'pilot_co_report_v1') await acknowledgment.promise;
    return result;
  };
  const confirm = screen.getByRole('button', { name: 'Catat penjualan' });
  fireEvent.click(confirm); fireEvent.click(confirm);
  await waitFor(() => expect(f.requests.filter(r => r.n === 'pilot_co_import_commit_v1')).toHaveLength(1));
  const key = localStorage.key(0)!, original = localStorage.getItem(key)!;
  expect(JSON.parse(original).id).toBeTruthy();
  expect(f.requests.find(r => r.n === 'pilot_co_import_commit_v1')!.a.p_request_id).toBe(JSON.parse(original).id);
  expect(screen.queryByRole('button', { name: 'Periksa hasil pencatatan' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  await act(async () => { sent.resolve(); });
  expect(localStorage.getItem(key)).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(key)!).id).toBe(JSON.parse(original).id);
  expect(screen.queryByRole('button', { name: 'Periksa hasil pencatatan' })).toBeNull();
  await act(async () => { acknowledgment.resolve(); });
  await screen.findByRole('button', { name: 'Edit' });
  expect(localStorage.length).toBe(0);
  expect(f.requests.filter(r => r.n === 'pilot_co_import_commit_v1')).toHaveLength(1);
});
test.each([{phase:'authorization',name:'direct authorization authority denial clears private fields and cache instead of offering an offline state'},{phase:'post-prepare-header',name:'direct import authority denial clears private fields and cache instead of offering an offline state'},{phase:'commit',name:'direct transaction authority denial clears private fields and cache instead of offering an offline state'},{phase:'preview',name:'R4 preview authority denial clears private fields and cache instead of offering an offline state'}] as const)('$name', async ({phase}) => {
  const { f, client } = await beginIntegrated();
  fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'), {target:{value:'Private unsent note'}});
  if (phase === 'commit') await readyPreview();
  let denial = true;
  const target = phase === 'authorization' ? 'pilot_my_profile' : phase === 'post-prepare-header' ? 'pilot_co_report_v1' : phase === 'preview' ? 'pilot_co_import_preview_v1' : 'pilot_co_import_commit_v1';
  wire.handler = async (n, a) => {
    if (denial && n === target && (phase !== 'post-prepare-header' || f.requests.some(r => r.n === 'pilot_co_import_prepare_v1'))) return { data: null, error: { code: '42501', message: `Denied ${phase}` } };
    return f.server(n, a);
  };
  fireEvent.click(screen.getByRole('button', { name: phase === 'commit' ? 'Catat penjualan' : 'Tinjau pencatatan' }));
  await screen.findByText(`Denied ${phase}`);
  expect(screen.queryByText('Synthetic')).toBeNull();
  expect(screen.queryByDisplayValue('Private unsent note')).toBeNull();
  expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Catat penjualan' })).toBeNull();
  expect(client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.state.data)).toHaveLength(0);
  const readCount = wire.rpc.mock.calls.length;
  await act(async () => { await Promise.resolve(); });
  expect(wire.rpc.mock.calls.length).toBe(readCount);
  denial = false;
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  // A committed prepare's retained identity may remain; it must never restore old input automatically.
  await waitFor(() => expect(screen.queryByText(`Denied ${phase}`)).toBeNull());
  expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();
  expect(f.requests.filter(r => r.n === 'pilot_co_import_commit_v1')).toHaveLength(0);
  if(phase==='post-prepare-header')expect(f.requests.filter(r=>r.n==='pilot_co_import_preview_v1')).toHaveLength(0);
});
test.each([{phase:'logout',name:'forced actor loss during review clears private report input and cannot restore the late result'},{phase:'allowed-role-replacement',name:'role replacement drops staged values and a delayed review cannot reinstate the old fingerprint'}] as const)('$name', async ({phase}) => {
  const { f, router, client } = await beginIntegrated();
  const gate = deferred();
  wire.handler = async (n, a) => { const result = await f.server(n, a); if (n === 'pilot_co_import_preview_v1') await gate.promise; return result; };
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau pencatatan' }));
  await waitFor(() => expect(f.requests.some(r => r.n === 'pilot_co_import_preview_v1')).toBe(true));
  if (phase === 'logout') wire.actor = false; else wire.role = 'executive';
  await act(() => router.revalidate());
  await waitFor(() => expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull());
  await act(async () => { gate.resolve(); });
  expect(screen.queryByRole('button', { name: 'Catat penjualan' })).toBeNull();
  expect(f.requests.filter(r => r.n === 'pilot_co_import_commit_v1')).toHaveLength(0);
  expect(client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.queryKey.includes('co_admin') && q.state.data)).toHaveLength(0);
});
test('stale final fingerprint keeps input and never auto-reposts', async () => {
  const { f } = await beginIntegrated();
  await readyPreview();
  fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'), { target: { value: '69' } });
  expect(screen.queryByRole('button', { name: 'Catat penjualan' })).toBeNull();
  expect(f.requests.filter(r => r.n === 'pilot_co_import_commit_v1')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'), { target: { value: '70' } });
  fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));
  await readyPreview();
  wire.handler = async (n, a) => n === 'pilot_co_import_commit_v1' ? { data: null, error: { code: 'PT409', message: 'Preview changed at final commit' } } : f.server(n, a);
  fireEvent.click(screen.getByRole('button', { name: 'Catat penjualan' }));
  await screen.findByText(/CO berubah/);
  expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('70');
  expect(screen.queryByRole('button', { name: 'Catat penjualan' })).toBeNull();
  expect(wire.rpc.mock.calls.filter(([n]) => n === 'pilot_co_import_commit_v1')).toHaveLength(1);
});

test('test-only 100-SKU visual fixture has mixed units, long labels, explicit zero and semantic keyboard-scroll regions, not geometry proof', async () => {
  const { default: VisualFixture, visualReview, visualStock, APPROVED_SCREENS, VISUAL_VIEWPORTS } = await import('./visual-fixture');
  const data = visualStock();
  expect(data.rows).toHaveLength(100); expect(visualReview().extracted.sourceRows).toHaveLength(100);
  expect(new Set(data.rows.map(r => r.unit))).toEqual(new Set([null, 'PCS', 'BOX']));
  expect(data.rows[0].recorded_quantity).toBe('0');
  expect(APPROVED_SCREENS).toHaveLength(8); expect(VISUAL_VIEWPORTS.map(v => v.width)).toEqual([1180, 1440, 360, 390]);
  store(); mount(<VisualFixture />);
  const table = await screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
  expect(table.querySelectorAll('tbody tr')).toHaveLength(100);
  expect(screen.getByRole('region', { name: 'Daftar stok pelanggan' }).tabIndex).toBe(0);
});

test('malicious source labels remain plain text and unsupported XLSX cannot enter a permissive manual override', async () => {
  const extracted = input().extracted;
  extracted.sourceRows[0].name = '<script>throw "not executable"</script>';
  extracted.sections[0].label = '<img src=x onerror=alert(1)>';
  const s = await loadSource(extracted);
  expect(screen.getByText(extracted.sourceRows[0].name)).toBeTruthy();
  expect(screen.getByLabelText(extracted.sections[0].label)).toBeTruthy();
  expect(document.querySelector('script, img')).toBeNull();
  expect(s.commands).toHaveLength(0);
});
test('unsupported XLSX fallback stays unresolved, does not upload, and offers no unsafe human-override capability', async () => {
  const fallback = { ...input().extracted, format: 'xlsx' as const, parserVersion: 'co-xlsx-3', sourceRows: [], sections: [], warnings: ['manual_review:unsupported_layout'] };
  const s = await loadSource(fallback);
  await screen.findByText('Format sumber memerlukan pemeriksaan manual');
  expect(screen.queryByRole('button', { name: /Gunakan.*transkripsi|Terima.*transkripsi/i })).toBeNull();
  expect((screen.getByRole('button', { name: 'Tinjau pencatatan' }) as HTMLButtonElement).disabled).toBe(true);
  expect(s.commands).toHaveLength(0); expect(wire.invoke).not.toHaveBeenCalled();
});
test('R2 omitted eligible SKU is never zero without its own decision and completeness; all 101 rows come from canonical paging', async () => {
  const s = store(101), extracted = input().extracted;
  extracted.periodCandidates = [month]; extractor.extract.mockReset().mockResolvedValue(extracted);
  wire.handler = mappingContext(s, wire.handler);
  mount(<COMonthlyReport />);
  fireEvent.change(await screen.findByLabelText('Pilih PDF atau XLSX'), { target: { files: [new File(['synthetic'], 'synthetic.pdf')] } });
  await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
  const quantity = await expandMapping();
  fireEvent.change(quantity, { target: { value: '2' } });
  fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));
  fireEvent.click(screen.getByLabelText(/Semua barang dan bagian sumber/));
  fireEvent.change(screen.getByLabelText('Mata uang sumber'), { target: { value: 'IDR' } });
  const omitted = screen.getAllByLabelText(/^Nol penjualan:/);
  expect(omitted).toHaveLength(100);
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau pencatatan' }));
  expect(s.commands).toHaveLength(0); expect(wire.invoke).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('2');
  for (const zero of omitted) fireEvent.click(zero);
  await screen.findByText('Pemeriksaan sumber lengkap');
  expect(omitted.every(zero => (zero as HTMLInputElement).checked)).toBe(true);
  expect(wire.rpc.mock.calls.filter(([n]) => n === 'pilot_co_import_eligible_v1').map(([, a]) => a.p_page)).toEqual([1, 2]);
  expect(s.commands).toHaveLength(0);
});

test('editing after review removes Post and stale review cannot restore it', async () => {
  await beginIntegrated(); await readyPreview();
  fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'),{target:{value:'71'}});
  expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
  await act(async()=>{await Promise.resolve()});
  expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
  expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_import_commit_v1')).toHaveLength(0);
});

test.each(['reconcile', 'recovered-import', 'acknowledge'] as const)('direct %s authority denial latches without discarding recovery identity', async phase => {
  const { f, client } = await beginIntegrated();
  fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'), { target: { value: 'Private unsent note' } });
  await readyPreview();
  let recovery = false, originalRead = false, canonicalRead = false;
  wire.handler = async (n, a) => {
    if (recovery && (phase === 'reconcile' && n === 'pilot_co_import_reconcile_v1' || phase === 'recovered-import' && n === 'pilot_co_import_read_v1' || phase === 'acknowledge' && n === 'pilot_my_profile' && canonicalRead)) return { data: null, error: { code: '42501', message: `Recovery denied ${phase}` } };
    const result = await f.server(n, a);
    if (n === 'pilot_co_import_commit_v1') return { data: null, error: { message: 'Lost original commit response' } };
    if (recovery && n === 'pilot_co_import_read_v1') originalRead = true;
    if (recovery && originalRead && n === 'pilot_co_report_v1') canonicalRead = true;
    return result;
  };
  fireEvent.click(screen.getByRole('button', { name: 'Catat penjualan' }));
  await screen.findByText('Lost original commit response');
  const key = localStorage.key(0)!, original = JSON.parse(localStorage.getItem(key)!);
  recovery = true;
  fireEvent.click(screen.getByRole('button', { name: 'Periksa hasil pencatatan' }));
  await screen.findByText(`Recovery denied ${phase}`);
  expect(screen.queryByDisplayValue('Private unsent note')).toBeNull();
  expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();
  expect(client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.state.data)).toHaveLength(0);
  expect(JSON.parse(localStorage.getItem(key)!).id).toBe(original.id);
  expect(wire.rpc.mock.calls.filter(([n]) => n === 'pilot_co_import_commit_v1')).toHaveLength(1);
  const reads = wire.rpc.mock.calls.length;
  await act(async () => { await Promise.resolve(); });
  expect(wire.rpc.mock.calls.length).toBe(reads);
  if (phase === 'acknowledge') expect(canonicalRead).toBe(true);
});

test('R2 selected explicit zero remains separate from all-history sales and an earlier required month blocks the whole confirmation', async () => {
  const {f}=await beginIntegrated(integratedServer(),'0');
  const base=wire.handler;
  wire.handler=async(n,a)=>{
    const r=await base(n,a);
    if(n==='pilot_co_import_preview_v1'){
      r.data.existingPreview.after.sold_quantity='700';r.data.existingPreview.after.revenue='1720000';
      r.data.existingPreview.can_post=false;r.data.existingPreview.counts.missing_month='1';
    }
    if(n==='pilot_co_import_impacts_v1'&&a.p_kind==='report')Object.assign(r.data.rows[0],{after_sold_quantity:'0',after_revenue:'0'});
    if(n==='pilot_co_import_impacts_v1'&&a.p_kind==='missing_month')Object.assign(r.data,{total:'1',rows:[{report_month:'2026-08-01',reason:'missing',head_id:null,coverage_through_date:null}]});
    return r;
  };
  expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('0');
  expect((screen.getByLabelText(/Semua barang dan bagian sumber/) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
  await screen.findByText('Nilai alokasi CO periode dipilih: Rp 0');
  expect(screen.getByText(/Cakupan periode dipilih: 30 September 2026.*UTC/)).toBeTruthy();
  expect(screen.getByRole('heading',{name:'Store A · September 2026'})).toBeTruthy();
  expect(screen.getByText(/Belum dapat diterapkan/)).toBeTruthy();
  expect(screen.getByRole('button',{name:/Periode wajib \(1\)/})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
  expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
  expect(f.requests.find(r=>r.n==='pilot_co_import_prepare_v1')!.a.p_payload.manifest.input.scope.reportMonth).toBe(month);
});

test('blocker navigation reveals the collapsed editor from the source pane and focuses unchanged invalid raw input', async () => {
  await beginIntegrated();
  fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'), { target: { value: '1.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Periksa baris' }));
  fireEvent.click(screen.getByLabelText('Tampilkan yang perlu diperiksa'));
  fireEvent.click(screen.getByRole('button', { name: 'Lihat sumber' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau pencatatan' }));
  fireEvent.click(screen.getByRole('link', { name: 'Isi jumlah terjual dalam satuan buku.' }));
  const field = await screen.findByLabelText('Jumlah terjual (tidak dikurangi retur)');
  expect(field).toBe(document.activeElement);
  expect((field as HTMLInputElement).value).toBe('1.5');
  expect((screen.getByLabelText('Tampilkan yang perlu diperiksa') as HTMLInputElement).checked).toBe(false);
  expect(wire.rpc.mock.calls.filter(([n]) => n === 'pilot_co_import_prepare_v1')).toHaveLength(0);
});

test('corrected fresh source69 is retained through final Edit: source2232150, FIFO708000, stock31 and immutable original70', async () => {
  const { f } = await beginIntegrated(integratedServer(), '70', <AcceptanceRoutes />);
  await readyPreview(); fireEvent.click(screen.getByRole('button', { name: 'Catat penjualan' }));
  await screen.findByRole('button', { name: 'Edit' });
  const original = structuredClone(f.imports.get(id(5))), originalEvidence = structuredClone([...f.evidenceHistory.values()]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' })); await screen.findByText('Nilai awal dari laporan tercatat');
  fireEvent.change(screen.getByLabelText('Alasan Edit'), { target: { value: 'Correct physical statement to69' } });
  const corrected = await syntheticFile('pdf');
  const bytes = new TextEncoder().encode('%PDF-1.7\n% synthetic corrected source69\n%%EOF\n');
  const file = Object.assign(new File([bytes], 'corrected69.pdf', { type: 'application/pdf' }), { arrayBuffer: async () => bytes.buffer });
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
  corrected.extracted.sha256=sha;corrected.extracted.sourceRows[0].ref.fileSha256=sha;
  corrected.extracted.sourceRows[0].quantity={raw:'69',decimal:'69'};corrected.extracted.sourceRows[0].amount={raw:'2232150',decimal:'2232150'};
  extractor.extract.mockResolvedValue(corrected.extracted);
  fireEvent.change(screen.getByLabelText('Pilih PDF atau XLSX'),{target:{files:[file]}});
  await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');await checkMapping('69');
  fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Simpan perubahan'}) as HTMLButtonElement).disabled).toBe(false));expect(screen.getByText(/^Total sumber:/).textContent).toContain('2232150');
  expect(await screen.findByText('Nilai alokasi CO periode dipilih: Rp 708.000')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Simpan perubahan'}));await screen.findByRole('button',{name:'Edit'});
  await screen.findByText('Rp 708.000');
  expect(f.imports.get(id(6)).manifest.input.mappings[0].quantity).toBe('69');
  expect(f.imports.get(id(6)).source_amount).toBe('2232150');
  expect(f.imports.get(id(5))).toEqual(original);
  expect([...f.evidenceHistory.values()].slice(0,1)).toEqual(originalEvidence);
  fireEvent.click(screen.getByRole('link',{name:'Lihat stok toko'}));const stock=await screen.findByRole('table',{name:'Stok pelanggan tercatat'});
  expect(stock.querySelector('tbody tr')?.textContent).toContain('69');expect(stock.querySelector('tbody tr')?.textContent).toContain('31');
  expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(2);
});

test('checked canonical identity adoption without a loading transition invalidates preview and retains raw intent',async()=>{
 const {f,client}=await beginIntegrated();await readyPreview();const quantity=screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement;
 f.s.cv='2';f.s.rows.push({...f.s.rows[0],id:id(1002),stock_key_id:id(1002),display_sku:'SKU-2',product_name:'Item2',sold_quantity:null});
 const {fetchCOReport}=await import('../../../src/lib/co/rpc');const canonical=await fetchCOReport(customer,month);const key=client.getQueryCache().getAll().find(q=>q.queryKey[4]==='report')!.queryKey;
 await act(()=>client.setQueryData(key,canonical));await screen.findByRole('button',{name:'Periksa ulang dampak'});expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(quantity.value).toBe('70');expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(1);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
});

test('canonical adoption after an original committed response loss retains original identity and accepts once without a stamp loop',async()=>{
 const {f,client}=await beginIntegrated();await readyPreview();wire.handler=async(n,a)=>{const r=await f.server(n,a);return n==='pilot_co_import_commit_v1'?{data:null,error:{message:'Lost original committed result'}}:r};
 fireEvent.click(screen.getByRole('button',{name:'Catat penjualan'}));await screen.findByText('Lost original committed result');const key=localStorage.key(0)!,original=JSON.parse(localStorage.getItem(key)!).id;
 f.s.cv='3';f.s.effective={...f.s.effective,customer_version:'3'};const {fetchCOReport}=await import('../../../src/lib/co/rpc');const checked=await fetchCOReport(customer,month);const queryKey=client.getQueryCache().getAll().find(q=>q.queryKey[4]==='report')!.queryKey;await act(()=>client.setQueryData(queryKey,checked));
 await screen.findByText('Ada hasil perintah yang perlu diperiksa');fireEvent.click(screen.getByRole('button',{name:'Periksa hasil pencatatan'}));await screen.findByRole('heading',{name:'Edit laporan penjualan'});fireEvent.click(screen.getByRole('button',{name:'Periksa hasil pencatatan'}));await screen.findByText(/Hasil asli ditemukan; laporan terkini telah berubah/);expect(JSON.parse(localStorage.getItem(key)!).id).toBe(original);expect(screen.queryByRole('button',{name:'Edit'})).toBeNull();
 fireEvent.click(screen.getByLabelText('Saya memahami keadaan terkini dapat berbeda dari hasil asli'));fireEvent.click(screen.getByRole('button',{name:'Terima hasil pencatatan asli'}));await screen.findByRole('button',{name:'Edit'});expect(localStorage.length).toBe(0);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(1);expect(f.requests.filter(r=>r.n==='pilot_co_import_reconcile_v1').every(r=>r.a.p_request_id===original)).toBe(true);
});
