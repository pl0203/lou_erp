import { openCommitReview } from './import-commit-transport-harness';
import { productionImportFixture, uploadMonth, sourceSha } from './import-production-ports-harness';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { customer, draftId, freshness, id, month, mount, store, wire } from './report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COMonthlyReports from '../../src/pages/athel/co/COMonthlyReports';
import { COFreshness } from '../../src/components/co/COShared';

const primary = (element: HTMLElement) => expect(element.classList.contains('ui-action--primary')).toBe(true);
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { release, promise }; }
function noRequired(status: 'complete' | 'no_recorded_activity') {
    return { ...freshness, status, next_required_report_month: null, pending_report_month_count: '0', overdue_report_month_count: '0', next_required_month_end: null, days_since_pending_month_end: null };
}

test('single upload action uses authoritative next month by default and explicit historical selection without writes', async () => {
 const s=store();const {router}=mount(<COMonthlyReports/>, `/athel/co/reports?customer=${customer}`);
 let upload=await screen.findByRole('link',{name:'Unggah laporan bulanan'});primary(upload);
 expect(new URL(upload.getAttribute('href')!,'https://test.invalid').pathname).toBe(`/athel/co/reports/${customer}/${month}`);
 await act(()=>router.navigate(`/athel/co/reports?customer=${customer}&month=2025-02`));
 upload=await screen.findByRole('link',{name:'Unggah laporan bulanan'});primary(upload);
 expect(screen.getAllByRole('link',{name:'Unggah laporan bulanan'})).toHaveLength(1);
 const url=new URL(upload.getAttribute('href')!,'https://test.invalid');expect(url.pathname).toBe(`/athel/co/reports/${customer}/2025-02-01`);expect(url.searchParams.get('upload')).toBe('1');expect(url.searchParams.get('returnTo')).toBe(`/athel/co/reports?customer=${customer}&month=2025-02`);
 expect(s.commands).toHaveLength(0);
});

test('query navigation and Back/Forward keep the chooser customer in sync without commands', async () => {
    const s = store(); const { router } = mount(<COMonthlyReports/>, '/athel/co/reports');
    await screen.findByLabelText('Toko laporan');
    await act(() => router.navigate(`/athel/co/reports?customer=${customer}&month=2025-02`));
    expect((screen.getByLabelText('Toko laporan') as HTMLSelectElement).value).toBe('Store A');
    expect((screen.getByLabelText('Bulan laporan') as HTMLInputElement).value).toBe('2025-02');
    const selected = await screen.findByRole('link', { name: 'Unggah laporan bulanan' });
    const destination = new URL(selected.getAttribute('href')!, 'https://test.invalid');
    expect(destination.pathname).toBe(`/athel/co/reports/${customer}/2025-02-01`);
    expect(destination.searchParams.get('upload')).toBe('1');
    expect(destination.searchParams.get('returnTo')).toBe(`/athel/co/reports?customer=${customer}&month=2025-02`);
    await act(() => router.navigate(-1));
    expect((screen.getByLabelText('Toko laporan') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('link', { name: /Unggah laporan bulanan/ })).toBeNull();
    await act(() => router.navigate(1));
    await screen.findByRole('link', { name: 'Unggah laporan bulanan' });
    expect(s.commands).toHaveLength(0);
});

test('refreshing and failed month authority never offer a cached next-month action', async () => {
    const s = store(); const { client } = mount(<COMonthlyReports/>, `/athel/co/reports?customer=${customer}`);
    await screen.findByRole('link', { name: 'Unggah laporan bulanan' });
    const pending = gate();
    s.fail = async (name: string) => { if (name === 'pilot_co_report_months_v1') { await pending.promise; return { data: null, error: { code: '08006', message: 'Months offline' } }; } return null; };
    let refreshed!: Promise<void>;
    await act(async () => { refreshed = client.invalidateQueries({ predicate: query => query.queryKey[4] === 'report-months' }); });
    await screen.findByText('Memeriksa periode laporan berikutnya…');
    expect(screen.queryByRole('link', { name: /Unggah laporan bulanan/ })).toBeNull();
    await act(async () => { pending.release(); await refreshed; });
    await screen.findByText('Months offline');
    expect(screen.queryByRole('link', { name: /Unggah laporan bulanan/ })).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test.each(['complete', 'no_recorded_activity'] as const)('chooser describes %s with no invented next period', async status => {
    const s = store(), base = s.handle;
    wire.handler = async (name: string, args: any) => { const result = await base(name, args); if (name === 'pilot_co_report_months_v1') Object.assign(result.data, { reporting_freshness: noRequired(status), ...(status === 'no_recorded_activity' ? { first_month: null, last_month: null } : {}) }); return result; };
    mount(<COMonthlyReports/>, `/athel/co/reports?customer=${customer}`);
    await screen.findByText(status === 'complete' ? /Tidak ada periode wajib yang perlu dilengkapi saat ini\./ : /Posting Surat Jalan terlebih dahulu/);
    expect(screen.queryByRole('link', { name: /Unggah laporan bulanan/ })).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test('actual upload mount and navigation do not write; explicit source selection initializes using latest customer version',async()=>{
 const f=await productionImportFixture();const {router}=f.mountRoute(true);
 await screen.findByLabelText('Pilih PDF atau XLSX');expect(f.writes).toHaveLength(0);
 await act(()=>router.navigate(`/athel/co/reports/${customer}/${uploadMonth}?upload=1`));
 await act(()=>router.navigate('/away'));await act(()=>router.navigate(-1));
 await screen.findByLabelText('Pilih PDF atau XLSX');expect(f.writes).toHaveLength(0);
 f.s.cv='2';await f.choose();await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
 expect(f.writes).toHaveLength(1);expect(f.writes[0]).toMatchObject({name:'pilot_co_transaction_v1',args:{p_operation:'save_report_draft',p_payload:{action:'initialize',customer_id:customer,report_month:uploadMonth,expected_customer_version:'2'}}});
 expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_import_eligible_v1'&&a.p_expected_customer_version==='2'&&a.p_expected_draft_version==='2')).toBe(true);
 expect(f.s.effective).toBeNull();expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);
});

test('historical saved input compatibility preserves exact quantities, unknown row and metadata without a draft write',async()=>{
 const s=store(2);s.rows[0].sold_quantity='7';s.metadata.notes='Saved note';
 const {router}=mount(<COMonthlyReport/>);const link=await screen.findByRole('link',{name:'Periksa isian tersimpan'});
 expect(s.commands).toHaveLength(0);await act(()=>router.navigate(link.getAttribute('href')!));
 const region=await screen.findByRole('region',{name:'Pekerjaan laporan tersimpan'});await within(region).findByText('7');
 expect(within(region).getByText('Belum diisi')).toBeTruthy();expect(within(region).getByText('Catatan: Saved note')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Simpan Draft'})).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_report_rows_v1'&&a.p_view==='draft'&&a.p_expected_draft_version==='1'&&a.p_expected_customer_version==='1')).toBe(true);expect(s.commands).toHaveLength(0);
});

test('real evidence/import senders retain version/source bindings and server incomplete blockers prevent commit',async()=>{
 const f=await productionImportFixture();f.mountRoute();await f.choose();await f.confirmDecisions();
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
 await screen.findByRole('heading',{name:'Konfirmasi pencatatan'});
 expect((await screen.findAllByText('CO_REPORT_INCOMPLETE')).some(n=>n.closest('details')===null)).toBe(true);
 expect(screen.getByText(/Provisional: laporan belum lengkap/).closest('details')).toBeNull();
 expect(screen.getByRole('button',{name:'Periode wajib (0)'}).closest('details')).toBeNull();
 const detail=screen.getByText('Detail teknis peninjauan').closest('details')!;expect(detail.open).toBe(false);expect(detail.textContent).toContain('b'.repeat(64));
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 const evidence=f.writes.find(w=>w.args.p_operation==='register_evidence')!;
 expect(evidence.args.p_payload).toMatchObject({expected_customer_version:'1',expected_draft_version:'2',sha256:sourceSha});
 const prepare=f.writes.find(w=>w.name==='pilot_co_import_prepare_v1')!;
 expect(prepare.args.p_payload).toMatchObject({expected_customer_version:'1',expected_draft_version:'3',expected_evidence_version:'2',manifest:{input:{scope:{customerId:customer,reportMonth:uploadMonth,actorId:id(1)},extracted:{sha256:sourceSha},omittedZeroStockKeyIds:[]}}});
 expect(f.writes.map(w=>w.name==='pilot_co_import_prepare_v1'?'prepare_import':w.args.p_operation)).toEqual(['save_report_draft','register_evidence','finalize_evidence','prepare_import']);
 expect(new Set(f.writes.map(w=>w.args.p_request_id)).size).toBe(4);expect(localStorage.length).toBe(0);
 expect(f.state.prepareCount).toBe(1);expect(f.state.previewCount).toBe(1);expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);expect(f.s.effective).toBeNull();
});

test('actual import review prepares once with bound versions and visible period values; disclosure does not refetch',async()=>{
 const f=await productionImportFixture();f.mountRoute();await f.choose();await f.confirmDecisions();
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
 const amount=await screen.findByText(/Nilai alokasi CO periode dipilih: Rp 10.000/);expect(amount.closest('details')).toBeNull();
 expect(screen.getByText(/Cakupan periode dipilih: 29 Oktober 2026.*UTC/).closest('details')).toBeNull();
 expect(screen.getByText(/Jumlah antar-SKU atau satuan berbeda tidak dijumlahkan/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Stok (0)'})).toBeTruthy();
 const detail=screen.getByText('Detail teknis peninjauan').closest('details')!;expect(screen.getByText(/Seluruh riwayat pelanggan sesudah:/).closest('details')).toBe(detail);
 const before=wire.rpc.mock.calls.length;fireEvent.click(detail.querySelector('summary')!);expect(detail.open).toBe(true);fireEvent.click(detail.querySelector('summary')!);expect(detail.open).toBe(false);await act(async()=>{await Promise.resolve()});expect(wire.rpc.mock.calls.length).toBe(before);
 expect(f.state.prepareCount).toBe(1);expect(f.state.previewCount).toBe(1);expect(f.writes.filter(w=>w.name==='pilot_co_import_prepare_v1')).toHaveLength(1);
 expect(f.writes.find(w=>w.name==='pilot_co_import_prepare_v1')!.args.p_payload).toMatchObject({expected_customer_version:'1',expected_draft_version:'3',expected_evidence_version:'2'});
 expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);expect(f.s.effective).toBeNull();
});

test('actual import stock link waits for failed canonical readback recovery without repeating the original commit',async()=>{
 const {f,record}=await openCommitReview();const pending=gate(),base=wire.handler;let failed=true,entered=false;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_report_v1'&&f.receipt&&failed){entered=true;await pending.promise;return {data:null,error:{code:'08006',message:'Posted readback offline'}}}return base(n,a)};
 fireEvent.click(record);await waitFor(()=>expect(entered).toBe(true));expect(screen.queryByRole('link',{name:'Lihat stok toko'})).toBeNull();
 await act(async()=>pending.release());await screen.findByText('Posted readback offline');expect(screen.queryByRole('link',{name:'Lihat stok toko'})).toBeNull();
 const original=JSON.parse(localStorage.getItem(localStorage.key(0)!)!);expect(original).toMatchObject({id:f.requestId,committed:f.receipt});expect(f.commitState.commitCalls).toHaveLength(1);
 failed=false;fireEvent.click(screen.getByRole('button',{name:'Periksa hasil pencatatan',exact:true}));
 const table=await screen.findByRole('region',{name:'Laporan penjualan tercatat'});await within(table).findByText('Alokasi sesuai jumlah');
 expect(screen.getByRole('link',{name:'Lihat stok toko'}).getAttribute('href')).toBe(`/athel/co/stock?customer=${customer}`);
 expect(f.commitState.commitCalls).toHaveLength(1);expect(f.commitState.commitCalls[0]).toMatchObject({p_request_id:original.id,p_payload:{previewFingerprint:'b'.repeat(64),binding:f.originalBinding}});expect(f.writes).toHaveLength(5);expect(localStorage.length).toBe(0);
});

test('no-activity detail exposes neutral recorded-activity status without inventing sales or writing on mount',async()=>{
 const s=store();s.draft=false;const base=s.root;s.root=()=>({...base(),reporting_freshness:noRequired('no_recorded_activity')});mount(<COMonthlyReport/>);
 await screen.findByText('Belum ada aktivitas stok tercatat');await screen.findByLabelText('Pilih PDF atau XLSX');
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(screen.queryByRole('button',{name:'Mulai laporan'})).toBeNull();expect(s.commands).toHaveLength(0);expect(s.effective).toBeNull();
});

test('actual source selection exposes initialization refusal and retries context only deliberately',async()=>{
 const f=await productionImportFixture(),base=wire.handler;let refuse=true,attempts=0;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_transaction_v1'){attempts++;if(refuse)return {data:null,error:{code:'22023',message:'Source not ready'}}}return base(n,a)};
 f.mountRoute();await screen.findByLabelText('Pilih PDF atau XLSX');expect(attempts).toBe(0);await f.choose();await screen.findByText('Source not ready');
 expect(attempts).toBe(1);expect(f.writes).toHaveLength(0);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 refuse=false;fireEvent.click(screen.getByRole('button',{name:'Muat konteks barang'}));await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
 expect(attempts).toBe(2);expect(f.writes).toHaveLength(1);expect(f.writes[0].args.p_payload).toMatchObject({action:'initialize',customer_id:customer,report_month:uploadMonth,expected_customer_version:'1'});expect(f.s.effective).toBeNull();
});

test.each([['complete', 'success'], ['no_recorded_activity', 'neutral'], ['missing_completed_period', 'warning'], ['current_unreported', 'warning'], ['current_partial', 'warning']] as const)('freshness %s has its existing semantic tone', async (status, tone) => {
    store(); mount(<COFreshness value={{ ...freshness, status } as any} compact/>);
    const badge = document.querySelector('.ui-status-badge')!;
    expect(badge.classList.contains(`ui-status-badge--${tone}`)).toBe(true);
    expect(badge.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
});

test('actual upload background canonical read failure disables source selection until explicit read retry without writes',async()=>{
 const f=await productionImportFixture();const {client}=f.mountRoute();const file=await screen.findByLabelText('Pilih PDF atau XLSX');expect(file.matches(':disabled')).toBe(false);
 const pending=gate(),base=wire.handler;let fail=true,entered=false;wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_report_v1'&&fail){entered=true;await pending.promise;return {data:null,error:{code:'08006',message:'Preparation source offline'}}}return base(n,a)};
 let refresh!:Promise<void>;await act(async()=>{refresh=client.invalidateQueries({predicate:q=>q.queryKey[4]==='report'})});await waitFor(()=>expect(entered).toBe(true));await waitFor(()=>expect(file.matches(':disabled')).toBe(true));
 await act(async()=>{pending.release();await refresh});await screen.findByText('Preparation source offline');expect(file.matches(':disabled')).toBe(true);expect(f.writes).toHaveLength(0);
 fail=false;fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await waitFor(()=>expect(file.matches(':disabled')).toBe(false));expect(f.writes).toHaveLength(0);
});

test('actual legacy Edit preserves pending input until explicit replacement and saves changed effective-first values on inspect',async()=>{
 const s=store();s.rows[0].sold_quantity='7';s.metadata.notes='Existing correction draft';
 s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'50000',notes:'Effective note'};
 // Transport fixture keeps immutable posted rows separate from pending input. Only the exact
 // explicit seed command replaces pending values; this is not a SQL implementation test.
 const base=s.handle;wire.handler=async(n:string,a:any)=>{
  if(n==='pilot_co_transaction_v1'&&a.p_payload.seed_effective_revision_id){expect(a.p_payload).toMatchObject({draft_id:draftId,expected_draft_version:'1',seed_effective_revision_id:id(5),expected_customer_version:'1'});s.rows[0].sold_quantity='5';s.metadata.notes='Effective note';}
  const result=await base(n,a);if(n==='pilot_co_report_rows_v1'&&a.p_view==='revision')result.data.rows=result.data.rows.map((r:any)=>({...r,sold_quantity:'5'}));return result;
 };
 mount(<COMonthlyReport/>);fireEvent.click(await screen.findByRole('button',{name:'Edit',exact:true}));const begin=await screen.findByRole('button',{name:'Mulai Edit dari laporan tercatat'});await waitFor(()=>expect(begin.matches(':disabled')).toBe(false));expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();expect(s.commands).toHaveLength(0);
 fireEvent.click(begin);await screen.findByRole('heading',{name:'Ganti isian laporan tersimpan?'});fireEvent.click(screen.getByRole('button',{name:'Batal penggantian'}));expect(s.rows[0].sold_quantity).toBe('7');expect(s.metadata.notes).toBe('Existing correction draft');expect(s.commands).toHaveLength(0);
 fireEvent.click(begin);fireEvent.click(await screen.findByRole('button',{name:'Ganti isian tersimpan'}));const sold=await screen.findByLabelText('Terjual Item 1');expect((sold as HTMLInputElement).value).toBe('5');expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Effective note');expect(s.commands).toHaveLength(1);
 fireEvent.change(sold,{target:{value:'8'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));await screen.findByLabelText('Alasan perubahan');expect(s.commands).toHaveLength(2);expect(s.commands[1].payload).toMatchObject({action:'upsert_lines',draft_id:draftId,expected_draft_version:'2',lines:[{stock_key_id:id(1001),sold_quantity:8}]});expect(screen.queryByRole('button',{name:'Simpan Draft'})).toBeNull();expect(s.commands.some((c:any)=>c.op==='correct_report')).toBe(false);
});
