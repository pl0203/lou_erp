import { beginIntegrated, integratedServer, readyPreview, deferred } from './workspace/import-acceptance-harness';
import { expect, test } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { store, mount, reportImpact, allocation, wire, id, customer, month, row } from './report-ui-harness';
import { fetchCOReport } from '../../src/lib/co/rpc';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COMonthlyReports from '../../src/pages/athel/co/COMonthlyReports';
import { mountNestedReport } from './nested-report-harness';
async function mountNested(s:any){const view=await mountNestedReport(s);expect(s.commands[0].payload.action).toBe('initialize');return view;}
// Native Field associations make whole-document label scans expensive on 100-row pages.
// Keep the real label query and all command assertions, scoped to its stable stock-key row.
async function soldInput(n: number) { return waitFor(() => {
    const region = screen.getByRole('region', { name: 'Baris penjualan laporan pelanggan' });
    const keyedRow = region.querySelector(`[data-co-report-row="${id(1000 + n)}"]`);
    expect(keyedRow).toBeTruthy();
    return within(keyedRow as HTMLElement).getByLabelText(`Terjual Item ${n}`);
}); }
const draftActions = ['Simpan Draft', 'Isi sisa kosong dengan nol', 'Tinjau laporan', 'Siapkan / perbarui draft'];
async function reportAction(name: string) {
    const group = await screen.findByRole('group', { name: name === 'Post laporan' ? 'Tindakan posting laporan' : 'Tindakan draft laporan' });
    return within(group).findByRole('button', { name });
}
async function click(name: string) {
    if (name === 'Post laporan' || draftActions.includes(name)) return fireEvent.click(await reportAction(name));
    if (['Berikutnya', 'Sebelumnya'].includes(name)) return fireEvent.click(await within(await screen.findByRole('navigation', { name: 'Halaman hasil' })).findByRole('button', { name }));
    if (name === 'Konfirmasi nol') return fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name }));
    const button=await screen.findByRole('button',{name});await waitFor(()=>expect(button.matches(':disabled')).toBe(false));fireEvent.click(button);
}
function queryPostAction() {
    const group = screen.queryByRole('group', { name: 'Tindakan posting laporan' });
    return group ? within(group).queryByRole('button', { name: 'Post laporan' }) : null;
}
test('blank stays unanswered, explicit sold quantity saves via the real sender and review uses stored bindings',async()=>{
 const {f}=await beginIntegrated();const qty=screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement;
 fireEvent.change(qty,{target:{value:''}});expect(qty.value).toBe('');fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(0);
 fireEvent.change(qty,{target:{value:'70'}});fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));await readyPreview();expect(await screen.findByText('Nilai alokasi CO periode dipilih: Rp 720.000')).toBeTruthy();expect(screen.getByText(/Harga satuan CO mengikuti sumber alokasi FIFO/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Catat penjualan'}));await screen.findByRole('button',{name:'Edit'});await screen.findByRole('columnheader',{name:'Harga CO'});fireEvent.click(screen.getByText('Bukti alokasi FIFO dan PIC asli'));await screen.findByText(/PIC-1/);expect(screen.getByText(/PIC-2/)).toBeTruthy();expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(1);const payload=f.requests.find(r=>r.n==='pilot_co_import_commit_v1')!.a.p_payload;expect(Object.keys(payload).sort()).toEqual(['acknowledgedReopenOrders','binding','mode','previewFingerprint','reason','requestId']);expect(payload.binding.draftVersion).toBe('3');expect(payload.previewFingerprint).toBe('f'.repeat(64));expect(payload).not.toHaveProperty('lines');expect(payload).not.toHaveProperty('allocations');expect(f.s.commands).toHaveLength(0);
});

test('bulk zero confirms the complete count including unloaded rows and preserves entered values', async () => { const s = store(601); await mountNested(s); fireEvent.change(await soldInput(1), { target: { value: '7' } }); await click('Isi sisa periode dengan nol'); expect(await screen.findByText(/600 baris kosong di seluruh periode, termasuk halaman belum dibuka/)).toBeTruthy(); expect(s.commands[1].payload.lines[0].sold_quantity).toBe(7); await click('Konfirmasi nol periode'); await waitFor(() => expect(s.commands.some((c: any) => c.payload.action === 'fill_remaining_zero')).toBe(true)); expect(s.rows[600].sold_quantity).toBe('0'); expect(s.rows[0].sold_quantity).toBe('7'); expect(s.cv).toBe('1'); });
test('source-context draft retains rows and explicitly returns to original preparation without invented routing', async () => {
    const s=store();s.rows[0].sold_quantity='7';s.metadata.notes='Retained original proposal';
    s.metadata.source_context_link={operation:'post_sj',target_id:null,draft_id:id(90),original_revision_id:null,expected_source_version:null,expected_co_version:'1',expected_customer_version:'1',expected_draft_version:'1'};
    s.metadata.source_context_fingerprint='c'.repeat(64);
    mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?recovery=legacy`);
    const pending=await screen.findByRole('region',{name:'Pekerjaan laporan tersimpan'});
    expect(await within(pending).findByText('7')).toBeTruthy();expect(within(pending).getByText(/Retained original proposal/)).toBeTruthy();
    expect(screen.getByRole('link',{name:'Kembali ke Pesanan CO'}).getAttribute('href')).toBe('/athel/co');
    expect(screen.queryByRole('button',{name:'Tinjau laporan'})).toBeNull();expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(s.commands).toHaveLength(0);
});
function listContext(){const s=store(),base=s.handle;wire.handler=async(n,a)=>n==='pilot_co_reports_page_v2'?{data:{version:'2',as_of:'2026-10-09T00:00:00Z',customer_id:a.p_customer_id,report_month:a.p_month,status:a.p_status,page:a.p_page,page_size:a.p_page_size,total:'1',rows:[{id:id(4),customer_id:customer,customer_name:'Store A',report_month:a.p_month??month,status:'posted',revision_id:id(5),report_head_id:id(4),legacy_pending:true,source_filename:'synthetic.pdf',updated_at:'2026-10-09T00:00:00Z'}]},error:null}:base(n,a);return s}
test('reports list applies real customer month and posted filters with revised a badge', async () => {
    const s=listContext();mount(<COMonthlyReports/>,`/athel/co/reports?customer=${customer}&month=2026-09`);
    await screen.findByRole('link',{name:'Buka laporan'});
    await waitFor(()=>expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_reports_page_v2'&&a.p_status==='posted'&&a.p_customer_id===customer&&a.p_month===month)).toBe(true));
    expect(await screen.findAllByRole('link',{name:'Buka laporan'})).toHaveLength(1);expect(screen.queryByRole('link',{name:'Periksa pekerjaan lama'})).toBeNull();expect(screen.queryByRole('option',{name:'Revised'})).toBeNull();expect(s.commands).toHaveLength(0);
});
test('all 601 stored rows save in sequential 500+101 chunks and post only complete draft bindings', async () => { const s = store(601); s.impacts.report = [{ ...reportImpact(), row_count: '601', after_sold_quantity: '601' }]; await mountNested(s); for (let p = 1; p <= 7; p++) {
    await soldInput((p - 1) * 100 + 1);
    for (const input of Array.from(document.querySelectorAll('input[aria-label^="Terjual "]')))
        await act(async () => { fireEvent.change(input, { target: { value: '1' } }); });
    if (p < 7)
        await click('Berikutnya');
} await click('Lanjutkan peninjauan periode'); await waitFor(() => expect(s.commands).toHaveLength(3));
expect(s.commands.slice(1).map((c: any) => c.payload.lines.length)).toEqual([500,101]);
expect(s.commands.slice(1).map((c: any) => c.payload.expected_draft_version)).toEqual(['2','3']);
await screen.findByRole('button',{name:'Lengkapi periode 2026-09'});
expect(s.rows.every((r: any) => r.sold_quantity === '1')).toBe(true);
expect(s.version).toBe('4');
await click('Tinjau semua dampak');
await waitFor(()=>expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_preview_v1').at(-1)![1].p_payload.completed_report_drafts).toEqual([{draft_id:id(3),expected_draft_version:'4',eligible_set_fingerprint:'a'.repeat(64)}]));
expect(s.commands.every((c: any) => c.op==='save_report_draft')).toBe(true);
}, 60000);
test('new eligibility 602 invalidates review, refresh preserves entered values and leaves the new row blank',async()=>{
 const f=integratedServer();f.s.rows=Array.from({length:601},(_,i)=>row(i+1));const {client}=await beginIntegrated(f,'1');for(const zero of screen.getAllByLabelText(/^Nol penjualan:/))fireEvent.click(zero);await readyPreview();f.s.rows.push(row(602));f.s.cv='2';const key=client.getQueryCache().getAll().find(q=>q.queryKey[4]==='report')!.queryKey;const checked=await fetchCOReport(customer,month);await act(()=>client.setQueryData(key,checked));await waitFor(()=>expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull());fireEvent.click(await screen.findByRole('button',{name:'Periksa ulang dampak'}));const added=await screen.findByLabelText('Nol penjualan: SKU-602 · Item 602') as HTMLInputElement;expect(added.checked).toBe(false);expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(f.s.rows[601].sold_quantity).toBeNull();expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(1);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
},60000);

test('retained failed row refresh preserves mounted raw fields and freezes every write until retry', async () => { const s = store(); const { client } = await mountNested(s); const input = await screen.findByLabelText('Terjual Item 1'); fireEvent.change(input, { target: { value: '7' } }); s.fail = (n: string) => n === 'pilot_co_report_rows_v1' ? { data: null, error: { code: '08006', message: 'Rows offline' } } : null; await client.invalidateQueries({ queryKey: ['co'] }); await screen.findByText('Rows offline'); expect(screen.getByLabelText('Terjual Item 1')).toBe(input); expect((input as HTMLInputElement).disabled).toBe(true); expect(screen.getByLabelText('Catatan laporan').matches(':disabled')).toBe(true); s.fail = null; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' })); await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false)); expect((input as HTMLInputElement).value).toBe('7'); });
test('zero-sales confirmation is based on selected statement even when customer history has sales',async()=>{
 const {f}=await beginIntegrated(integratedServer(),'0'),base=wire.handler;wire.handler=async(n,a)=>{const r=await base(n,a);if(n==='pilot_co_import_preview_v1')r.data.existingPreview.after.sold_quantity='700';return r};await readyPreview();expect(await screen.findByText('Nilai alokasi CO periode dipilih: Rp 0')).toBeTruthy();expect((screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini') as HTMLInputElement).checked).toBe(true);expect((screen.getByLabelText(/Semua barang dan bagian sumber/) as HTMLInputElement).checked).toBe(true);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Catat penjualan'}));await screen.findByRole('button',{name:'Edit'});expect(f.s.effective.sold_quantity).toBe('0');expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(1);
});

test('a rejected second chunk retains only unsaved entries and retries from the acknowledged version', async () => { const s = store(501); await mountNested(s); for (let p = 1; p <= 6; p++) {
    await soldInput((p - 1) * 100 + 1);
    for (const input of Array.from(document.querySelectorAll('input[aria-label^="Terjual "]')))
        await act(async () => { fireEvent.change(input, { target: { value: '2' } }); });
    if (p < 6)
        await click('Berikutnya');
} let rejects = true; s.fail = (n: string, a: any) => n === 'pilot_co_transaction_v1' && a.p_payload.action === 'upsert_lines' && a.p_payload.expected_draft_version === '3' && rejects ? { data: null, error: { code: '22023', message: 'Second chunk rejected' } } : null; await click('Lanjutkan peninjauan periode'); await screen.findByText('Second chunk rejected'); expect(s.commands).toHaveLength(2); expect((screen.getByLabelText('Terjual Item 501') as HTMLInputElement).value).toBe('2'); expect(s.rows[499].sold_quantity).toBe('2'); expect(s.rows[500].sold_quantity).toBeNull(); rejects = false; await click('Lanjutkan peninjauan periode'); await waitFor(() => expect(s.commands).toHaveLength(3)); expect(s.commands[2].payload.lines).toEqual([{ stock_key_id: id(1501), sold_quantity: 2 }]); expect(s.commands[2].payload.expected_draft_version).toBe('3'); expect(s.cv).toBe('1'); }, 60000);
test.each(['1e2', '-1', '1.5', '2147483648'])('invalid sold %s is retained and never sent as rounded or zero', async (value) => { const s = store(); await mountNested(s); const input = await screen.findByLabelText('Terjual Item 1'); fireEvent.change(input, { target: { value } }); await click('Lanjutkan peninjauan periode'); await screen.findByRole('alert'); expect((input as HTMLInputElement).value).toBe(value); expect(s.commands).toHaveLength(1); });
test('navigation and voluntary signout Keep retain dirty report; discard follows destination',async()=>{
 const {router}=await beginIntegrated();const qty=screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement;fireEvent.change(qty,{target:{value:'3'}});await act(()=>router.navigate('/away'));fireEvent.click(await screen.findByRole('button',{name:'Tetap mengedit'}));expect(qty.value).toBe('3');let decision!:Promise<boolean>;await act(async()=>{decision=wire.guard(new AbortController().signal)});fireEvent.click(await screen.findByRole('button',{name:'Tetap mengedit'}));expect(await decision).toBe(false);await act(()=>router.navigate('/away'));fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan'}));await screen.findByText('Destination');expect(router.state.location.pathname).toBe('/away');
});

test('canonical read retry after an acknowledged chunk preserves metadata not yet sent', async () => { const s = store(); await mountNested(s); fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } }); fireEvent.change(screen.getByLabelText('Catatan laporan'), { target: { value: 'Still unsent' } }); s.fail = (n: string) => n === 'pilot_co_report_v1' && s.commands.length > 1 ? { data: null, error: { code: '08006', message: 'Import offline' } } : null; await click('Lanjutkan peninjauan periode'); await screen.findByText('Import offline'); expect(s.commands).toHaveLength(2); s.fail = null; await click('Buka hasil laporan tersimpan'); await waitFor(() => expect((screen.getByRole('button', { name: 'Lanjutkan peninjauan periode' }) as HTMLButtonElement).disabled).toBe(false)); expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Still unsent'); await click('Lanjutkan peninjauan periode'); await waitFor(() => expect(s.commands).toHaveLength(3)); expect(s.commands[2].payload).toMatchObject({ action: 'set_metadata', notes: 'Still unsent', expected_draft_version: '3' }); });
test('authoritative row denial clears mounted private fields and cached data', async () => { const s = store(); const { client } = await mountNested(s); fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '7' } }); s.fail = (n: string) => n === 'pilot_co_report_rows_v1' ? { data: null, error: { code: '42501', message: 'Authority revoked' } } : null; await client.invalidateQueries({ queryKey: ['co'] }); await screen.findByText('Authority revoked'); expect(screen.queryByLabelText('Terjual Item 1')).toBeNull(); expect(client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.state.data)).toHaveLength(0); s.fail = null; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' })); expect((await screen.findByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe(''); });
test('Save focuses the invalid sold field even when it is on an earlier page', async () => { const s = store(101); await mountNested(s); fireEvent.change(await soldInput(1), { target: { value: '1.5' } }); await click('Berikutnya'); await soldInput(101); await click('Lanjutkan peninjauan periode'); await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Terjual Item 1')); });
test('historical revision evidence uses the explicit checked revision and never labels current rows as original', async () => { const s = store(); s.rows[0].sold_quantity = '7'; s.effective = { ...s.header(), id: id(4), status: 'posted', draft_id: null, draft_version: null, report_head_id: id(4), revision_id: id(5), report_version: '2', eligible_set_fingerprint: null, revenue: '70000' }; s.draft = false; const base = s.handle; wire.handler = async (n: string, a: any) => { const r = await base(n, a); if (n === 'pilot_co_report_rows_v1' && a.p_view === 'revision') {
    r.data.revision_id = a.p_revision_id;
    r.data.rows = [{ ...r.data.rows[0], sold_quantity: '0' }];
} return r; }; mount(<COMonthlyReport />, `/athel/co/reports/${customer}/${month}?revision=${id(6)}`); expect(await screen.findByText(`Bukti revisi historis ${id(6)}`)).toBeTruthy(); await waitFor(() => expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_report_rows_v1' && a.p_view === 'revision' && a.p_revision_id === id(6))).toBe(true)); });
test('refresh freezes raw inputs until canonical hydration finishes',async()=>{
 const {f,client}=await beginIntegrated(),qty=screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement;f.s.cv='2';const key=client.getQueryCache().getAll().find(q=>q.queryKey[4]==='report')!.queryKey;const checked=await fetchCOReport(customer,month);await act(()=>client.setQueryData(key,checked));await screen.findByRole('button',{name:'Periksa ulang dampak'});const gate=deferred();let held=false;wire.handler=async(n,a)=>{if(n==='pilot_co_report_v1'){held=true;await gate.promise}return f.server(n,a)};fireEvent.click(screen.getByRole('button',{name:'Periksa ulang dampak'}));await waitFor(()=>expect(held).toBe(true));expect(qty.matches(':disabled')).toBe(true);fireEvent.change(qty,{target:{value:'99'}});await act(async()=>gate.resolve());await waitFor(()=>expect(qty.matches(':disabled')).toBe(false));expect(qty.value).toBe('70');expect(f.requests.find(r=>r.n==='pilot_co_import_prepare_v1')!.a.p_payload.manifest.input.mappings[0].quantity).toBe('70');expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(1);
});

test('authority denial stops automatic private reads until an explicit retry', async () => { const s = store(); const { client } = await mountNested(s); fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '9' } }); let deniedReads = 0; s.fail = (n: string) => { if (n === 'pilot_co_report_v1') {
    deniedReads++;
    return { data: null, error: { code: '42501', message: 'Report access denied' } };
} return null; }; await client.invalidateQueries({ queryKey: ['co'] }); await screen.findByText('Report access denied'); await act(async () => new Promise(r => setTimeout(r, 50))); expect(deniedReads).toBe(1); expect(screen.queryByLabelText('Terjual Item 1')).toBeNull(); s.fail = null; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' })); expect((await screen.findByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe(''); });
test('Review saves staged input and leaves the newly bound preview available in one action',async()=>{const {f}=await beginIntegrated();await readyPreview();expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(1);expect(f.requests.filter(r=>r.n==='pilot_co_import_preview_v1')).toHaveLength(1);expect(f.requests.find(r=>r.n==='pilot_co_import_impacts_v1')!.a.p_binding).toMatchObject({customerVersion:'1',draftVersion:'3'});expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0)});

test('same-version context diagnostics freeze the saved editor rather than trusting its old ready header',async()=>{const s=store();const {client}=await mountNested(s);fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'7'}});s.metadata.context_issue='CO_ELIGIBLE_SET_STALE';await client.invalidateQueries({predicate:q=>q.queryKey[4]==='report'});await waitFor(()=>expect((screen.getByRole('button',{name:'Lanjutkan peninjauan periode'}) as HTMLButtonElement).disabled).toBe(true));expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('7');});

test('customer report entry offers the required month before requiring an unexplained filter choice', async () => {
    const s=listContext();mount(<COMonthlyReports/>,`/athel/co/reports?customer=${customer}`);
    const next=await screen.findByRole('link',{name:'Unggah laporan bulanan'});
    expect(next.getAttribute('href')).toBe(`/athel/co/reports/${customer}/2026-09-01?upload=1&returnTo=${encodeURIComponent(`/athel/co/reports?customer=${customer}`)}`);expect(s.commands).toHaveLength(0);
});
test('report entry preserves a month provided by the CO lifecycle handoff', async () => {
    const s=listContext();mount(<COMonthlyReports/>,`/athel/co/reports?customer=${customer}&month=2026-08`);
    const selected=await screen.findByRole('link',{name:'Unggah laporan bulanan'});
    expect((screen.getByLabelText('Bulan laporan') as HTMLInputElement).value).toBe('2026-08');expect(selected.getAttribute('href')).toBe(`/athel/co/reports/${customer}/2026-08-01?upload=1&returnTo=${encodeURIComponent(`/athel/co/reports?customer=${customer}&month=2026-08`)}`);expect(s.commands).toHaveLength(0);
});
