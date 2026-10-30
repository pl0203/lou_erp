import {productionImportFixture,uploadMonth,sourceSha} from './import-production-ports-harness';
import {openCommitReview,productionCommitFixture,committedHead} from './import-commit-transport-harness';
import { expect, test } from 'vitest';
import { screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react';
import { store, mount, reportImpact, allocation, wire, id, customer, month, draftId, hash, row, fingerprint } from './report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COMonthlyReports from '../../src/pages/athel/co/COMonthlyReports';
import COChangePreview from '../../src/components/co/COChangePreview';
import COAllocationDetails from '../../src/components/co/COAllocationDetails';
import {previewCOOperation} from '../../src/lib/co/rpc';
import COCorrectionDialog from '../../src/components/co/COCorrectionDialog';
import {useCOTransactionSender} from '../../src/lib/co/transactions';

import { useCOReportWorkspace, COReportFields, reportBinding, type COReportWorkspace } from '../../src/components/co/COReportWorkspace';
import { COFailure, CORecoveryPanel } from '../../src/components/co/COShared';
// UNIT composition of surviving exported workspace primitives, NOT the retired route.
// No test-owned save/post UI, authority mask, command result or receipt fabrication.
let work: COReportWorkspace;
function MonthlyWorkspaceUnit() {
    work = useCOReportWorkspace(customer, month);
    return <>
        {work.header ? <COReportFields work={work}/> : work.authorityError ? <COFailure error={work.authorityError}/> : null}
        <CORecoveryPanel confirmed={!!work.confirmed} pending={work.pending} sender={work.sender}
            current={() => work.current() && !work.pending} accept={receipt => work.acceptCanonical(receipt, true)}/>
    </>;
}
async function saveWorkspace() {
    // The production hook reports errors in COReportFields and rethrows them to its caller.
    await act(async () => { try { await work.save(); } catch { /* asserted through actual UI/state below */ } });
}


// Explicit real nested-period component owner, not the removed initial manual route.
function NestedPeriodReview(){
 const sender=useCOTransactionSender({formScope:'monthly-nested-zero',customerId:customer});
 return <COCorrectionDialog operation="correct_report" customerId={customer} selectedMonth={month}
  source={{draft_id:draftId,expected_draft_version:'1',expected_customer_version:'1',eligible_set_fingerprint:hash,report_head_id:id(4),original_revision_id:id(5),expected_report_version:'1'}}
  sender={sender} current={()=>wire.actor} onAccepted={async()=>true} onClose={()=>{}} returnFocus={null}/>;
}
// Recorded source/rows/allocations pass real decoders. Empty allocation evidence
// deliberately leaves the honest unmatched-allocation warning for persisted row7.
function recordedStore(){
 const s=store();s.rows[0].sold_quantity='7';s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'70000'};
 const base=s.handle;wire.handler=async(n:string,a:any)=>{
  if(n!=='pilot_co_report_allocations_v1')return base(n,a);
  if(a.p_customer_id!==customer||a.p_month!==month||a.p_revision_id!==id(5)||a.p_expected_customer_version!=='1')throw new Error('Synthetic allocation scope mismatch');
  return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0.00'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};
 };return s;
}


async function readyCurrentUpload(){const f=await productionImportFixture();f.state.incomplete=false;const mounted=f.mountRoute();await f.choose();await f.confirmDecisions();return {f,...mounted};}
async function currentReview(){const result=await readyCurrentUpload();fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Catat penjualan'}).matches(':disabled')).toBe(false));return result;}

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
    fireEvent.click(await screen.findByRole('button', { name }));
}
function queryPostAction() {
    const group = screen.queryByRole('group', { name: 'Tindakan posting laporan' });
    return group ? within(group).queryByRole('button', { name: 'Post laporan' }) : null;
}
test('UNIT saved blank/raw decisions and ordinary preview retain exact stored versions, selected revenue and original PIC',async()=>{
 const s=store();s.impacts.report=[reportImpact()];s.allocations=[allocation(1,'60','10000'),allocation(2,'10','12000')];mount(<MonthlyWorkspaceUnit/>);
 const input=await screen.findByLabelText('Terjual Item 1');expect((input as HTMLInputElement).value).toBe('');fireEvent.change(input,{target:{value:'70'}});expect(screen.getByText('Sisa provisional: 30')).toBeTruthy();
 let saved!:Awaited<ReturnType<typeof work.save>>;await act(async()=>{saved=await work.save()});expect(s.commands).toHaveLength(1);expect(s.commands[0].payload.lines).toEqual([{stock_key_id:id(1001),sold_quantity:70}]);expect(s.cv).toBe('1');
 const payload=reportBinding(saved!),header=await previewCOOperation('post_report',payload),snapshot:any={operation:'post_report',payload,header};expect(payload.expected_draft_version).toBe('2');cleanup();
 // Public production readers/components, not a fabricated initial-route Post owner.
 mount(<><COChangePreview snapshot={snapshot} selectedMonth={month}/><COAllocationDetails customerId={customer} month={month} customerVersion="1" snapshot={snapshot} stockKeyId={id(1001)}/></>);
 expect(await screen.findByText('Pendapatan periode dipilih: Rp 720.000')).toBeTruthy();expect(screen.getByText(/Seluruh riwayat pelanggan sesudah: Rp 1.720.000/)).toBeTruthy();expect(await screen.findByText(new RegExp(`PIC asli: PIC-1 · ${id(6001)}`))).toBeTruthy();expect(screen.getByText(new RegExp(`PIC asli: PIC-2 · ${id(6002)}`))).toBeTruthy();
 expect(s.commands).toHaveLength(1);expect(s.commands[0].op).toBe('save_report_draft');
 // Actual current final-post binding/receipt is independently tested in import-commit-recovery.
});

test('nested period bulk zero confirms600 unloaded entries and preserves the explicit7',async()=>{
 const primary=store();primary.rows[0].sold_quantity='70';
 const nestedMonth='2026-08-01';primary.impacts.missing_month=[{report_month:nestedMonth,reason:'missing',head_id:null,coverage_through_date:null}];
 const nested=store(601,nestedMonth,id(50));let last=primary;
 wire.handler=async(n:string,a:any)=>{
  if(n==='pilot_co_transaction_v1'){last=a.p_payload.draft_id===id(50)||a.p_payload.report_month===nestedMonth?nested:primary;return last.handle(n,a)}
  if(n==='pilot_reconcile_co_v1')return last.handle(n,a);
  if(n==='pilot_co_report_v1'||n==='pilot_co_report_rows_v1')return (a.p_month===nestedMonth?nested:primary).handle(n,a);
  return primary.handle(n,a);
 };
 mount(<NestedPeriodReview/>);
 fireEvent.change(await screen.findByLabelText('Alasan perubahan'),{target:{value:'Original correction source'}});
 await click('Tinjau semua dampak');await click('Lengkapi periode 2026-08');
 const prepare=await screen.findByRole('button',{name:'Perbarui periode terhadap sumber usulan'});
 await waitFor(()=>expect(prepare.matches(':disabled')).toBe(false));fireEvent.click(prepare);
 fireEvent.change(await soldInput(1),{target:{value:'7'}});
 await click('Isi sisa periode dengan nol');
 await screen.findByText(/600 baris kosong di seluruh periode, termasuk halaman belum dibuka/);
 expect(nested.commands).toHaveLength(2);
 expect(nested.commands[0].payload).toMatchObject({action:'initialize',expected_customer_version:'1',source_context:{operation:'correct_report',source_context_fingerprint:'c'.repeat(64),payload:{draft_id:draftId,expected_draft_version:'1',report_head_id:id(4),original_revision_id:id(5),expected_report_version:'1'}}});
 expect(nested.commands[1].payload.lines).toEqual([{stock_key_id:id(1001),sold_quantity:7}]);
 expect(nested.commands.some((c:any)=>c.payload.action==='fill_remaining_zero')).toBe(false);
 expect(nested.rows[600].sold_quantity).toBeNull();
 await click('Konfirmasi nol periode');await waitFor(()=>expect(nested.commands).toHaveLength(3));
 expect(nested.commands[2].payload).toMatchObject({action:'fill_remaining_zero',draft_id:id(50),expected_draft_version:'3',expected_customer_version:'1',eligible_set_fingerprint:hash});
 await waitFor(()=>expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).disabled).toBe(false));
 expect(nested.rows[600].sold_quantity).toBe('0');expect(nested.rows[0].sold_quantity).toBe('7');expect(nested.cv).toBe('1');expect(primary.commands).toHaveLength(0);
 for(let page=1;page<7;page++)await click('Berikutnya');expect((await soldInput(601) as HTMLInputElement).value).toBe('0');
});

test('source-context saved rows stay read-only and original destination comes only from full checked proposal binding',async()=>{
 const s=store();s.metadata.source_context_link={operation:'post_sj',target_id:null,draft_id:id(90),original_revision_id:null,expected_source_version:null,expected_co_version:'1',expected_customer_version:'1',expected_draft_version:'1'};s.metadata.source_context_fingerprint='c'.repeat(64);const base=s.handle;
 wire.handler=async(n:string,a:any)=>{if(n!=='pilot_co_report_source_proposal_v1')return base(n,a);expect(a).toEqual({p_customer_id:customer,p_month:month,p_draft_id:draftId,p_expected_draft_version:'1',p_expected_customer_version:'1'});return {data:{version:'1',customer_id:customer,report_month:month,draft_id:draftId,draft_version:'1',customer_version:'1',source_context:{operation:'post_sj',payload:{expected_customer_version:'1',expected_co_version:'1',reason:'Original delivery source',draft_id:id(90),expected_draft_version:'1'},source_context_fingerprint:'c'.repeat(64)},owner:{kind:'delivery',co_id:id(7),report_month:null}},error:null};};
 mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?recovery=legacy`);await screen.findByText('Laporan terikat ke perubahan sumber');expect(await screen.findByText('Belum diisi',{exact:true})).toBeTruthy();
 const original=await screen.findByRole('link',{name:'Tinjau usulan sumber asli'});const url=new URL(original.getAttribute('href')!,'https://test.invalid');expect(url.pathname).toBe(`/athel/co/${id(7)}`);expect(Object.fromEntries(url.searchParams)).toEqual({proposalDraft:draftId,proposalMonth:month,proposalDraftVersion:'1',proposalCustomerVersion:'1'});
 expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(s.commands).toHaveLength(0);expect(s.rows[0].sold_quantity).toBeNull();
});

test('current recorded reports list sends exact V2 customer/month posted filters without a draft status selector',async()=>{
 const s=recordedStore();mount(<COMonthlyReports/>,`/athel/co/reports?customer=${customer}`);
 await screen.findByRole('link',{name:'Buka laporan'});
 fireEvent.change(screen.getByLabelText('Bulan laporan'),{target:{value:'2026-09'}});
 await waitFor(()=>expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_reports_page_v2'&&a.p_customer_id===customer&&a.p_month===month&&a.p_status==='posted')).toBe(true));
 expect(await screen.findByText('Tercatat')).toBeTruthy();expect(screen.queryByLabelText('Status laporan')).toBeNull();expect(screen.queryByRole('option',{name:'Revised'})).toBeNull();expect(s.commands).toHaveLength(0);
});

test('UNIT workspace: all 601 rows save sequential500+101 and expose complete canonical version3 binding', async () => { const s = store(601); s.impacts.report = [{ ...reportImpact(), row_count: '601', after_sold_quantity: '601' }]; mount(<MonthlyWorkspaceUnit />); for (let p = 1; p <= 7; p++) {
    await soldInput((p - 1) * 100 + 1);
    for (const input of Array.from(document.querySelectorAll('input[aria-label^="Terjual "]')))
        await act(async () => { fireEvent.change(input, { target: { value: '1' } }); });
    if (p < 7)
        await click('Berikutnya');
} let saved!: Awaited<ReturnType<typeof work.save>>;
await act(async()=>{saved=await work.save()});
expect(s.commands).toHaveLength(2);expect(s.commands.map((c:any)=>c.payload.lines.length)).toEqual([500,101]);
expect(s.commands.map((c:any)=>c.payload.expected_draft_version)).toEqual(['1','2']);
expect(s.rows.every((r:any)=>r.sold_quantity==='1')).toBe(true);expect(s.cv).toBe('1');
expect(saved).toMatchObject({complete:true,row_count:'601',entered_count:'601',missing_count:'0',draft_version:'3'});
expect(reportBinding(saved!)).toEqual({draft_id:draftId,expected_draft_version:'3',expected_customer_version:'1',eligible_set_fingerprint:hash});
expect(s.commands.every((c:any)=>c.op==='save_report_draft')).toBe(true);
// Retired initial-route post_report assembly is NOT exercised here. Current upload
// final commit/receipt is a separate production-port integration, not upsert batching.
},60000);

test('current upload eligibility602 customer-version change invalidates preview and leaves only the new omission unconfirmed',async()=>{
 const f=await productionImportFixture();f.state.incomplete=false;f.s.rows=Array.from({length:601},(_,i)=>({...row(i+1,null,uploadMonth),eligible_quantity:'1'}));
 const original=wire.handler;wire.handler=async(n:string,a:any)=>{const result=await original(n,a);if(!result.error&&n==='pilot_co_stock_key_units_v1')result.data.rows=result.data.rows.map((unit:any)=>({...unit,declaration:{...unit.declaration,id:id(7000+Number(unit.stockKeyId.slice(-12)))}}));if(!result.error&&n==='pilot_co_import_impacts_v1'&&a.p_kind==='report')result.data.rows=result.data.rows.map((impact:any)=>({...impact,row_count:String(f.s.rows.length)}));return result;};
 const {client}=f.mountRoute();await f.choose();await f.confirmDecisions();
 const zeros=await screen.findAllByLabelText(/^Nol penjualan:/);expect(zeros).toHaveLength(600);for(const checkbox of zeros)fireEvent.click(checkbox);
 const review=screen.getByRole('button',{name:'Tinjau pencatatan'});await waitFor(()=>expect(review.matches(':disabled')).toBe(false));fireEvent.click(review);await waitFor(()=>expect(screen.getByRole('button',{name:'Catat penjualan'}).matches(':disabled')).toBe(false));
 expect(f.state.previewCount).toBe(1);const writes=f.writes.length;f.s.rows.push({...row(602,null,uploadMonth),eligible_quantity:'1'});f.s.cv='2';
 await act(async()=>{await client.invalidateQueries({predicate:q=>q.queryKey[4]==='report'});});await waitFor(()=>expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull());
 expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');fireEvent.click(screen.getByRole('button',{name:'Periksa ulang dampak'}));
 const newZero=await screen.findByLabelText('Nol penjualan: SKU-602 · Item 602') as HTMLInputElement;expect(newZero.checked).toBe(false);const retained=screen.getAllByLabelText(/^Nol penjualan:/) as HTMLInputElement[];expect(retained).toHaveLength(601);expect(retained.filter(c=>c.checked)).toHaveLength(600);
 expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(f.state.previewCount).toBe(1);expect(f.writes).toHaveLength(writes);expect(f.s.effective).toBeNull();
 const refreshed=wire.rpc.mock.calls.filter(([n,a])=>n==='pilot_co_import_eligible_v1'&&a.p_expected_customer_version==='2');expect(refreshed.map(([,a])=>a.p_page)).toEqual([1,2,3,4,5,6,7]);
},120000);

test('UNIT workspace: retained failed row refresh preserves mounted raw fields and freezes every write until retry', async () => { const s = store(); const { client } = mount(<MonthlyWorkspaceUnit />); const input = await screen.findByLabelText('Terjual Item 1'); fireEvent.change(input, { target: { value: '7' } }); s.fail = (n: string) => n === 'pilot_co_report_rows_v1' ? { data: null, error: { code: '08006', message: 'Rows offline' } } : null; await client.invalidateQueries({ queryKey: ['co'] }); await screen.findByText('Rows offline'); expect(screen.getByLabelText('Terjual Item 1')).toBe(input); expect((input as HTMLInputElement).disabled).toBe(true); expect(screen.getByLabelText('Catatan laporan').matches(':disabled')).toBe(true); s.fail = null; fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' })); await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false)); expect((input as HTMLInputElement).value).toBe('7'); });
test('current parsed zero source requires explicit review and Record despite nonzero customer history',async()=>{
 const f=await productionCommitFixture({zeroSource:true}),base=wire.handler;let allocations:any=null,previewHeader:any=null;
 wire.handler=async(n:string,a:any)=>{const result=await base(n,a);if(n==='pilot_co_import_preview_v1'&&!result.error){result.data.existingPreview.before={...result.data.existingPreview.before,sold_quantity:'700',revenue:'700000'};result.data.existingPreview.after={...result.data.existingPreview.after,sold_quantity:'700',revenue:'700000'};previewHeader=structuredClone(result.data.existingPreview);}if(n==='pilot_co_report_allocations_v1'&&!result.error)allocations=structuredClone(result.data);return result;};
 f.mountRoute();await f.choose();await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
 const sourceTable=within(screen.getByRole('region',{name:'Tabel pemeriksaan laporan'})).getByRole('table') as HTMLTableElement;
 expect(sourceTable.tBodies[0].rows[0].cells[2].textContent).toBe('0');expect(sourceTable.tBodies[0].rows[0].cells[4].textContent).toBe('Belum ditentukan');
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('region',{name:'Hal yang perlu diperiksa'})));
 expect(f.state.prepareCount).toBe(0);expect(f.state.previewCount).toBe(0);expect(f.commitState.commitCalls).toHaveLength(0);expect(f.s.effective).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 await f.confirmDecisions();expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('0');expect((screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini') as HTMLInputElement).checked).toBe(true);expect((screen.getByLabelText(/Semua barang dan bagian sumber sudah diperiksa/) as HTMLInputElement).checked).toBe(true);
 expect(f.commitState.commitCalls).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
 expect(await screen.findByText('Nilai alokasi CO periode dipilih: Rp 0')).toBeTruthy();const record=await screen.findByRole('button',{name:'Catat penjualan'});await waitFor(()=>expect(record.matches(':disabled')).toBe(false));
 fireEvent.click(screen.getByText('Detail teknis peninjauan'));expect(screen.getByText('Seluruh riwayat pelanggan sesudah: Rp 700.000')).toBeTruthy();expect(previewHeader).toMatchObject({before:{sold_quantity:'700',revenue:'700000',remaining_quantity:'1'},after:{sold_quantity:'700',revenue:'700000',remaining_quantity:'1'}});
 const prepared=f.writes.find(w=>w.name==='pilot_co_import_prepare_v1')!.args.p_payload.manifest;expect(prepared.input.extracted.sha256).toBe(f.sourceFixture.sha);expect(prepared.input.mappings[0]).toMatchObject({quantity:'0',confirmed:true});expect(f.commitState.commitCalls).toHaveLength(0);expect(f.s.effective).toBeNull();
 fireEvent.click(record);const recorded=await screen.findByRole('region',{name:'Laporan penjualan tercatat'});await within(recorded).findByText('Alokasi sesuai jumlah');expect(within(recorded).getByText('0')).toBeTruthy();expect(within(recorded).getByText(`Sumber: ${f.sourceFixture.filename}`)).toBeTruthy();await waitFor(()=>expect(localStorage.length).toBe(0));
 expect(f.commitState.commitCalls).toHaveLength(1);expect(f.writes).toHaveLength(5);expect(f.receipt).toEqual({id:committedHead,operation:'post_report',version:'1',customer_id:customer,customer_version:'2'});expect(f.s.rows[0]).toMatchObject({sold_quantity:'0',eligible_quantity:'1'});expect(f.s.effective.revenue).toBe('0');expect(allocations).toMatchObject({summary:{quantity:'0',amount:'0'},total:'0',rows:[]});
});

test('UNIT workspace: a rejected second chunk retains only unsaved entries and retries from the acknowledged version', async () => { const s = store(501); mount(<MonthlyWorkspaceUnit />); for (let p = 1; p <= 6; p++) {
    await soldInput((p - 1) * 100 + 1);
    for (const input of Array.from(document.querySelectorAll('input[aria-label^="Terjual "]')))
        await act(async () => { fireEvent.change(input, { target: { value: '2' } }); });
    if (p < 6)
        await click('Berikutnya');
} let rejects = true; s.fail = (n: string, a: any) => n === 'pilot_co_transaction_v1' && a.p_payload.action === 'upsert_lines' && a.p_payload.expected_draft_version === '2' && rejects ? { data: null, error: { code: '22023', message: 'Second chunk rejected' } } : null; await saveWorkspace(); await screen.findByText('Second chunk rejected'); expect(s.commands).toHaveLength(1); expect((screen.getByLabelText('Terjual Item 501') as HTMLInputElement).value).toBe('2'); expect(s.rows[499].sold_quantity).toBe('2'); expect(s.rows[500].sold_quantity).toBeNull(); rejects = false; await saveWorkspace(); await waitFor(() => expect(s.commands).toHaveLength(2)); expect(s.commands[1].payload.lines).toEqual([{ stock_key_id: id(1501), sold_quantity: 2 }]); expect(s.commands[1].payload.expected_draft_version).toBe('2'); expect(s.cv).toBe('1'); }, 60000);
test.each(['1e2', '-1', '1.5', '2147483648'])('UNIT workspace: invalid sold %s is retained and never sent as rounded or zero', async (value) => { const s = store(); mount(<MonthlyWorkspaceUnit />); const input = await screen.findByLabelText('Terjual Item 1'); fireEvent.change(input, { target: { value } }); await saveWorkspace(); await screen.findByRole('alert'); expect((input as HTMLInputElement).value).toBe(value); expect(s.commands).toHaveLength(0); });
test('current upload navigation and voluntary signout Keep retain raw decisions; Discard leaves the actual owner',async()=>{
 const {f,router}=await readyCurrentUpload();fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'),{target:{value:'3'}});const writes=f.writes.length;
 await act(()=>router.navigate('/outside'));fireEvent.click(await screen.findByRole('button',{name:'Tetap mengedit'}));expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('3');
 let decision!:Promise<boolean>;await act(async()=>{decision=wire.guard(new AbortController().signal)});fireEvent.click(await screen.findByRole('button',{name:'Tetap mengedit'}));expect(await decision).toBe(false);expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('3');
 await act(()=>router.navigate('/outside'));fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan'}));await screen.findByText('Destination');expect(router.state.location.pathname).toBe('/outside');expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();expect(f.writes).toHaveLength(writes);expect(f.s.effective).toBeNull();
});

test('current upload actor loss during delayed review cannot reinstate private fields or old bound preview',async()=>{
 const {f,router,client}=await readyCurrentUpload();const base=wire.handler;let release!:()=>void,entered=false;const gate=new Promise<void>(r=>release=r);
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_preview_v1'){entered=true;await gate;}return base(n,a)};
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(entered).toBe(true));const writes=f.writes.length;
 wire.actor=false;await act(()=>router.revalidate());await waitFor(()=>expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull());await act(async()=>release());
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(screen.queryByText(/Sidik peninjauan:/)).toBeNull();expect(f.writes).toHaveLength(writes);expect(f.s.effective).toBeNull();
 expect(client.getQueryCache().getAll().filter(q=>q.queryKey[0]==='co'&&q.state.data)).toHaveLength(0);
});

test('UNIT workspace: canonical read retry after an acknowledged chunk preserves metadata not yet sent', async () => { const s = store(); mount(<MonthlyWorkspaceUnit />); fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '70' } }); fireEvent.change(screen.getByLabelText('Catatan laporan'), { target: { value: 'Still unsent' } }); s.fail = (n: string) => n === 'pilot_co_report_v1' && s.commands.length ? { data: null, error: { code: '08006', message: 'Import offline' } } : null; await saveWorkspace(); await screen.findByText('Import offline'); expect(s.commands).toHaveLength(1); s.fail = null; await act(async () => { await work.acceptCanonical(work.confirmed!); }); await waitFor(() => expect(work.frozen).toBe(false)); expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Still unsent'); await saveWorkspace(); await waitFor(() => expect(s.commands).toHaveLength(2)); expect(s.commands[1].payload).toMatchObject({ action: 'set_metadata', notes: 'Still unsent', expected_draft_version: '2' }); });
test('UNIT workspace: authoritative row denial clears mounted private fields and cached data', async () => { const s = store(); const { client } = mount(<MonthlyWorkspaceUnit />); fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '7' } }); s.fail = (n: string) => n === 'pilot_co_report_rows_v1' ? { data: null, error: { code: '42501', message: 'Authority revoked' } } : null; await client.invalidateQueries({ queryKey: ['co'] }); await screen.findByText('Authority revoked'); expect(screen.queryByLabelText('Terjual Item 1')).toBeNull(); expect(client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.state.data)).toHaveLength(0); s.fail = null; await act(async () => work.retryAuthority()); expect((await screen.findByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe(''); });
test('UNIT workspace: Save focuses the invalid sold field even when it is on an earlier page', async () => { store(101); mount(<MonthlyWorkspaceUnit />); fireEvent.change(await soldInput(1), { target: { value: '1.5' } }); await click('Berikutnya'); await soldInput(101); await saveWorkspace(); await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Terjual Item 1')); });
test('historical revision evidence uses the explicit checked revision and never labels current rows as original', async () => { const s = store(); s.rows[0].sold_quantity = '7'; s.effective = { ...s.header(), id: id(4), status: 'posted', draft_id: null, draft_version: null, report_head_id: id(4), revision_id: id(5), report_version: '2', eligible_set_fingerprint: null, revenue: '70000' }; s.draft = false; const base = s.handle; wire.handler = async (n: string, a: any) => { const r = await base(n, a); if (n === 'pilot_co_report_rows_v1' && a.p_view === 'revision') {
    r.data.revision_id = a.p_revision_id;
    r.data.rows = [{ ...r.data.rows[0], sold_quantity: '0' }];
} return r; }; mount(<COMonthlyReport />, `/athel/co/reports/${customer}/${month}?revision=${id(6)}`); expect(await screen.findByText(`Bukti revisi historis ${id(6)}`)).toBeTruthy(); expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_report_rows_v1' && a.p_view === 'revision' && a.p_revision_id === id(6))).toBe(true); });
test('current final import fingerprint conflict keeps raw source and never auto-reposts',async()=>{
 const {f,record}=await openCommitReview();const base=wire.handler;let attempts=0;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_commit_v1'){attempts++;expect(a.p_payload.previewFingerprint).toBe(fingerprint);return {data:null,error:{code:'PT409',message:'Preview changed'}}}return base(n,a)};
 fireEvent.click(record);await screen.findByText(/Preview changed|CO berubah/);expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');expect(screen.getByDisplayValue('PRIVATE COMMIT REVIEW')).toBeTruthy();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(attempts).toBe(1);expect(f.s.effective).toBeNull();expect(f.commitState.commitCalls).toHaveLength(0);
 await act(async()=>{await new Promise(r=>setTimeout(r,20))});expect(attempts).toBe(1);
});

test('current upload role replacement during delayed review cannot reinstate private fields or old bound preview',async()=>{
 const {f,router,client}=await readyCurrentUpload();const base=wire.handler;let release!:()=>void,entered=false;const gate=new Promise<void>(r=>release=r);
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_preview_v1'){entered=true;await gate;}return base(n,a)};
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(entered).toBe(true));const writes=f.writes.length;
 wire.role='executive';await act(()=>router.revalidate());await waitFor(()=>expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull());await act(async()=>release());
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(screen.queryByText(/Sidik peninjauan:/)).toBeNull();expect(f.writes).toHaveLength(writes);expect(f.s.effective).toBeNull();
 expect(await screen.findByLabelText('Pilih PDF atau XLSX')).toBeTruthy();expect(client.getQueryCache().getAll().filter(q=>q.queryKey[0]==='co'&&q.queryKey[3]==='co_admin'&&q.state.data)).toHaveLength(0);
});

test('UNIT workspace: refresh freezes raw inputs until canonical hydration finishes', async () => { const s = store(); s.rows[0].sold_quantity = '70'; const { client } = mount(<MonthlyWorkspaceUnit />); const input = await screen.findByLabelText('Terjual Item 1'); s.cv = '2'; await client.invalidateQueries({ queryKey: ['co'] }); await screen.findByText(/Versi atau sumber berubah/); let finish!: (value: any) => void; s.fail = (n: string) => n === 'pilot_co_report_v1' ? new Promise(r => { finish = () => r(null); }) : null; let initializing!: Promise<unknown>; await act(async () => { initializing = work.initialize(); }); await waitFor(() => expect(finish).toBeTypeOf('function')); expect((input as HTMLInputElement).disabled).toBe(true); fireEvent.change(input, { target: { value: '99' } }); s.fail = null; await act(async () => { finish(null); await initializing; }); await waitFor(() => expect(work.frozen).toBe(false)); expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('70'); });
test('UNIT workspace: authority denial stops automatic private reads until an explicit retry', async () => { const s = store(); const { client } = mount(<MonthlyWorkspaceUnit />); fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '9' } }); let deniedReads = 0; s.fail = (n: string) => { if (n === 'pilot_co_report_v1') {
    deniedReads++;
    return { data: null, error: { code: '42501', message: 'Report access denied' } };
} return null; }; await client.invalidateQueries({ queryKey: ['co'] }); await screen.findByText('Report access denied'); await act(async () => new Promise(r => setTimeout(r, 50))); expect(deniedReads).toBe(1); expect(screen.queryByLabelText('Terjual Item 1')).toBeNull(); s.fail = null; await act(async () => work.retryAuthority()); expect((await screen.findByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe(''); });
test('one current upload Review binds actual source decisions and supporting versions to exactly one preview',async()=>{
 const {f}=await currentReview();expect(screen.getByRole('button',{name:'Catat penjualan'})).toBeTruthy();expect(f.writes).toHaveLength(4);expect(f.state.previewCount).toBe(1);
 const prepared=f.writes.find(w=>w.name==='pilot_co_import_prepare_v1')!.args.p_payload;expect(prepared).toMatchObject({expected_customer_version:'1',expected_draft_version:'3',expected_evidence_version:'2',manifest:{input:{scope:{customerId:customer,reportMonth:uploadMonth},extracted:{sha256:sourceSha},mappings:[{stockKeyId:id(1001),quantity:'1',confirmed:true}]}}});
 const preview=wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_import_preview_v1');expect(preview).toHaveLength(1);expect(preview[0][1]).toEqual({p_import_id:id(88),p_expected_version:'1',p_acknowledged_reopen_orders:[]});expect(f.s.effective).toBeNull();
});

test('UNIT workspace: same-version context diagnostics freeze the saved editor rather than trusting its old ready header',async()=>{const s=store();const {client}=mount(<MonthlyWorkspaceUnit/>);fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'7'}});s.metadata.context_issue='CO_ELIGIBLE_SET_STALE';await client.invalidateQueries({predicate:q=>q.queryKey[4]==='report'});await waitFor(()=>expect(work.frozen).toBe(true));expect(screen.getByLabelText('Terjual Item 1').matches(':disabled')).toBe(true);expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('7');});

test('current report entry offers the required month through the actual upload route',async()=>{
 const s=store();mount(<COMonthlyReports/>,`/athel/co/reports?customer=${customer}`);
 const link=await screen.findByRole('link',{name:'Unggah laporan bulanan'});const url=new URL(link.getAttribute('href')!,'https://test.invalid');
 expect(url.pathname).toBe(`/athel/co/reports/${customer}/2026-09-01`);expect(url.searchParams.get('upload')).toBe('1');expect(url.searchParams.get('returnTo')).toBe(`/athel/co/reports?customer=${customer}`);
 expect(screen.getByText('Periode berikutnya:',{exact:false})).toBeTruthy();expect(s.commands).toHaveLength(0);
});

test('current report upload preserves a lifecycle selected month distinct from the next required month',async()=>{
 const s=store();mount(<COMonthlyReports/>,`/athel/co/reports?customer=${customer}&month=2026-10`);
 const link=await screen.findByRole('link',{name:'Unggah laporan bulanan'});const url=new URL(link.getAttribute('href')!,'https://test.invalid');
 expect((screen.getByLabelText('Bulan laporan') as HTMLInputElement).value).toBe('2026-10');expect(url.pathname).toBe(`/athel/co/reports/${customer}/2026-10-01`);expect(url.searchParams.get('upload')).toBe('1');expect(url.searchParams.get('returnTo')).toBe(`/athel/co/reports?customer=${customer}&month=2026-10`);expect(s.commands).toHaveLength(0);
});

test('UNIT workspace: report save with durable identity stays neutral until canonical acknowledgment and never offers recovery in flight', async () => {
    const s = store(), base = wire.handler;
    let release!: () => void;
    wire.handler = async (name: string, args: any) => {
        const response = await base(name, args);
        if (name === 'pilot_co_transaction_v1') await new Promise<void>(resolve => { release = resolve; });
        return response;
    };
    mount(<MonthlyWorkspaceUnit/>);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '2' } });
    let saving!: Promise<unknown>; await act(async () => { saving = work.save(); });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(localStorage.length).toBe(1);
    const identity = JSON.parse(localStorage.getItem(localStorage.key(0)!)!).id;
    expect(identity).toBeTruthy();
    expect(screen.queryByText(/Hasil penyimpanan sebelumnya perlu dipulihkan/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull();
    await act(async () => { release(); await saving; });
    await waitFor(() => expect(localStorage.length).toBe(0));
    expect(s.commands).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull();
});

test('current recorded report coverage preserves the calendar date and UTC accounting boundary',async()=>{
 const s=recordedStore();mount(<COMonthlyReport/>);
 await screen.findByRole('table');expect(screen.getByText(/Cakupan tercatat sampai 30 September 2026.*UTC/)).toBeTruthy();
 expect(screen.getByRole('heading',{name:'Store A · September 2026'})).toBeTruthy();expect(screen.getByText('Alokasi perlu diperiksa')).toBeTruthy();expect(screen.queryByText(/Unhandled RPC/)).toBeNull();
 for(const endpoint of ['pilot_co_report_import_v1','pilot_co_report_rows_v1','pilot_co_report_allocations_v1'])expect(wire.rpc.mock.calls.some(([n])=>n===endpoint)).toBe(true);
 expect(s.commands).toHaveLength(0);
});

// Additive half only: original eligibility/review integration above remains red
// until version-specific current-upload preview invalidation is independently proved.
test('UNIT workspace: new eligibility602 locks old version and explicit refresh preserves601 while new row stays blank',async()=>{
 const s=store(601);s.rows.forEach((r:any)=>r.sold_quantity='1');const {client}=mount(<MonthlyWorkspaceUnit/>);
 await soldInput(1);s.rows.push({...s.rows[0],id:id(1602),stock_key_id:id(1602),display_sku:'SKU-602',product_name:'Item 602',sold_quantity:null});s.cv='2';
 await act(async()=>{await client.invalidateQueries({queryKey:['co']});});await screen.findByText(/Versi atau sumber berubah/);expect(work.frozen).toBe(true);expect(screen.getByLabelText('Terjual Item 1').matches(':disabled')).toBe(true);
 await act(async()=>{await work.initialize()});await waitFor(()=>expect(work.frozen).toBe(false));expect(s.commands).toHaveLength(1);expect(s.commands[0].payload).toMatchObject({action:'initialize',expected_customer_version:'2',expected_draft_version:'1'});
 for(let page=1;page<7;page++)await click('Berikutnya');expect((await soldInput(602) as HTMLInputElement).value).toBe('');expect(s.rows.slice(0,601).every((r:any)=>r.sold_quantity==='1')).toBe(true);expect(s.rows[601].sold_quantity).toBeNull();
 expect(work.header).toMatchObject({row_count:'602',entered_count:'601',missing_count:'1',complete:false,customer_version:'2'});
});
