import {productionImportFixture} from '../co/import-production-ports-harness';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import COLayout from '../../src/pages/athel/co/COLayout';
import { allocation, customer, draftId, fingerprint, hash, id, month, mount, reportImpact, row, store, wire } from '../co/report-ui-harness';
import { choose, evidenceId, fixture } from '../co/evidence-ui-harness';
import COCorrectionDialog from '../../src/components/co/COCorrectionDialog';
import {useCOTransactionSender} from '../../src/lib/co/transactions';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COMonthlyReports from '../../src/pages/athel/co/COMonthlyReports';
import COMonthlySalesGrid from '../../src/components/co/COMonthlySalesGrid';
import COReportRevisionEvidence from '../../src/components/co/COReportRevisionEvidence';
import COAllocationDetails from '../../src/components/co/COAllocationDetails';
import COEvidenceAttachment, { CORevisionAttachment } from '../../src/components/co/COEvidenceAttachment';
import { COReportFields, useCOReportWorkspace } from '../../src/components/co/COReportWorkspace';


// Surviving production primitives: explicit UNIT composition, not manual route UI.
let workspace:ReturnType<typeof useCOReportWorkspace>;
function FieldsUnit({evidence=false}:{evidence?:boolean}){workspace=useCOReportWorkspace(customer,month);return workspace.header?<><COReportFields work={workspace}/>{evidence&&<COEvidenceAttachment work={workspace}/>}</>:null;}
function recordedFixture(metadata:Record<string,unknown>={}){
 const s=store();s.rows[0].sold_quantity='7';s.metadata=metadata;s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'70000'};
 const base=s.handle;wire.handler=async(n:string,a:any)=>{if(n!=='pilot_co_report_allocations_v1')return base(n,a);if(a.p_customer_id!==customer||a.p_month!==month||a.p_revision_id!==id(5)||a.p_expected_customer_version!=='1')throw new Error('Allocation scope mismatch');return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0.00'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null}};return s;
}
function NestedZeroReview(){const sender=useCOTransactionSender({formScope:'ui-nested-zero',customerId:customer});return <COCorrectionDialog operation="correct_report" customerId={customer} selectedMonth={month} source={{draft_id:draftId,expected_draft_version:'1',expected_customer_version:'1',eligible_set_fingerprint:hash,report_head_id:id(4),original_revision_id:id(5),expected_report_version:'1'}} sender={sender} current={()=>wire.actor} onAccepted={async()=>true} onClose={()=>{}} returnFocus={null}/>;}
async function openNestedZero(){
 const primary=store();primary.rows[0].sold_quantity='70';const nestedMonth='2026-08-01';primary.impacts.missing_month=[{report_month:nestedMonth,reason:'missing',head_id:null,coverage_through_date:null}];const nested=store(601,nestedMonth,id(50));let last=primary;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_transaction_v1'){last=a.p_payload.draft_id===id(50)||a.p_payload.report_month===nestedMonth?nested:primary;return last.handle(n,a)}if(n==='pilot_reconcile_co_v1')return last.handle(n,a);if(n==='pilot_co_report_v1'||n==='pilot_co_report_rows_v1')return (a.p_month===nestedMonth?nested:primary).handle(n,a);return primary.handle(n,a)};
 mount(<NestedZeroReview/>);fireEvent.change(await screen.findByLabelText('Alasan perubahan'),{target:{value:'Original correction source'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));fireEvent.click(await screen.findByRole('button',{name:'Lengkapi periode 2026-08'}));const prepare=await screen.findByRole('button',{name:'Perbarui periode terhadap sumber usulan'});await waitFor(()=>expect(prepare.matches(':disabled')).toBe(false));fireEvent.click(prepare);return {primary,nested};
}

// Explicit native label associations make document-wide scans costly on a 100-row page.
// Scope large-editor lookups to the server-keyed row while still querying its actual label.
async function soldInput(n: number) {
    return waitFor(() => {
        const region = screen.getByRole('region', { name: 'Baris penjualan laporan pelanggan' });
        const keyedRow = region.querySelector(`[data-co-report-row="${id(1000 + n)}"]`);
        expect(keyedRow).toBeTruthy();
        return within(keyedRow as HTMLElement).getByLabelText(`Terjual Item ${n}`);
    });
}

test('UNIT report Fields contain keyboard-scrollable sales rows with native labels and original focus IDs', async () => {
    store(); mount(<FieldsUnit/>);
    const sold = await screen.findByLabelText('Terjual Item 1') as HTMLInputElement;
    const region = screen.getByRole('region', { name: 'Baris penjualan laporan pelanggan' });
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain('overflow-x-auto');
    expect(region.className).toContain('min-w-0');
    expect(sold.id).toBe(`co-sold-${id(1001)}`);
    expect(sold.labels?.[0].htmlFor).toBe(sold.id);
    expect(sold.closest('.ui-field')).toBeTruthy();
    const notes = screen.getByLabelText('Catatan laporan') as HTMLInputElement;
    expect(notes.labels?.[0].htmlFor).toBe(notes.id);
    expect(document.querySelector('main, #main-content')).toBeNull();
});

test('partial coverage remains a date-only UTC server statement with customer-wide scope', async () => {
    recordedFixture({coverage_through_date:'2026-09-09',is_partial_month:true});
    mount(<COMonthlyReport/>);
    expect(await screen.findByText(/Cakupan tercatat sampai 9 September 2026.*tanggal UTC server.*parsial/)).toBeTruthy();
    expect(screen.queryByText(/WIB/)).toBeNull();
    const freshness = screen.getByText('Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.');
    expect(freshness.closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
});

test('current upload inspection and recording retain native named action groups and bound availability',async()=>{
 const f=await productionImportFixture();f.state.incomplete=false;f.mountRoute();await f.choose();await f.confirmDecisions();
 const inspect=screen.getByRole('group',{name:'Tindakan pemeriksaan laporan'});const review=within(inspect).getByRole('button',{name:'Tinjau pencatatan'});expect(review.tagName).toBe('BUTTON');fireEvent.click(review);
 const recording=await screen.findByRole('group',{name:'Tindakan pencatatan laporan'});const record=within(recording).getByRole('button',{name:'Catat penjualan'});await waitFor(()=>expect(record.matches(':disabled')).toBe(false));expect(record.tagName).toBe('BUTTON');expect(f.state.previewCount).toBe(1);expect(f.writes).toHaveLength(4);expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);expect(f.s.effective).toBeNull();
});

test('metadata and optional file labels stay unique when the same report appears in separate presentation panels', async () => {
    store();
    function Panels() {
        const work = useCOReportWorkspace(customer, month);
        return work.header ? <><COReportFields work={work}/><COEvidenceAttachment work={work}/><COReportFields work={work}/><COEvidenceAttachment work={work}/></> : null;
    }
    mount(<Panels/>);
    const fields = await screen.findAllByLabelText('Catatan laporan') as HTMLInputElement[];
    const files = screen.getAllByLabelText('Pilih lampiran') as HTMLInputElement[];
    expect(fields).toHaveLength(2); expect(files).toHaveLength(2);
    expect(new Set([...fields, ...files].map(control => control.id)).size).toBe(4);
    for (const control of [...fields, ...files]) {
        expect(control.labels).toHaveLength(1);
        expect(control.labels?.[0].htmlFor).toBe(control.id);
    }
});

test('report filters preserve customer and period payloads, accessible native fields and list scope', async () => {
    recordedFixture(); mount(<COMonthlyReports/>, `/athel/co/reports?customer=${customer}&month=2026-09`);
    const link = await screen.findByRole('link', { name: 'Buka laporan' });
    const url=new URL(link.getAttribute('href')!,'https://test.invalid');expect(url.pathname).toBe(`/athel/co/reports/${customer}/${month}`);expect(url.searchParams.get('returnTo')).toBe(`/athel/co/reports?customer=${customer}&month=2026-09`);
    expect(screen.getByRole('table', { name: 'Laporan penjualan pelanggan' }).contains(link)).toBe(true);
    const filters = screen.getByRole('region', { name: 'Filter laporan penjualan' });
    expect(filters.className).toContain('ui-filter-bar');
    const period = within(filters).getByLabelText('Bulan laporan') as HTMLInputElement;
    expect(period.labels?.[0].htmlFor).toBe(period.id);
    expect(within(filters).queryByLabelText('Status laporan')).toBeNull();
    await waitFor(() => expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_reports_page_v2' && a.p_status === 'posted' && a.p_customer_id === customer && a.p_month === month && a.p_page === 1)).toBe(true));
    expect(await screen.findByText(/Rentang sumber pelanggan \(semua CO\).*September 2026/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Periode laporan pelanggan' }).className).toContain('ui-section');
});

test('empty filtered report list explicitly avoids a verified-zero interpretation', async () => {
    const s = store();s.draft=false; const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        const response = await base(name, args);
        if (name === 'pilot_co_reports_page_v2') { response.data.rows = []; response.data.total = '0'; }
        return response;
    };
    mount(<COMonthlyReports/>, '/athel/co/reports');
    expect(await screen.findByRole('heading', { name: 'Belum ada laporan sesuai filter.' })).toBeTruthy();
    const table=screen.getByRole('table',{name:'Laporan penjualan pelanggan'});expect(table.querySelectorAll('tbody tr')).toHaveLength(0);expect(within(table).queryByText('Tercatat')).toBeNull();expect(within(table).queryByText(/Rp|penjualan.*nol|terverifikasi.*0/i)).toBeNull();expect(s.commands).toHaveLength(0);
});

test('blank, explicit zero and unavailable eligibility retain distinct quantities and raw input', async () => {
    store();
    mount(<COMonthlySalesGrid rows={[row(1), row(2, '0'), { ...row(3, '0'), eligible_quantity: null }]} entries={{}} editable disabled={false} onChange={() => {}} page={1} total="3" onPage={() => {}}/>);
    const region = screen.getByRole('region', { name: 'Baris penjualan laporan pelanggan' });
    const rows = region.querySelectorAll('[data-co-report-row]');
    expect(rows).toHaveLength(3);
    expect((within(rows[0] as HTMLElement).getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('');
    expect(within(rows[0] as HTMLElement).getByText('Sisa provisional: Belum tersedia')).toBeTruthy();
    expect((within(rows[1] as HTMLElement).getByLabelText('Terjual Item 2') as HTMLInputElement).value).toBe('0');
    expect(within(rows[1] as HTMLElement).getByText('Sisa provisional: 100')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Tersedia: Belum tersedia')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Sisa provisional: Belum tersedia')).toBeTruthy();
});

test('UNIT workspace save returns to an earlier page and focuses the unchanged invalid native sold input', async () => {
    const s = store(101); mount(<FieldsUnit/>);
    fireEvent.change(await soldInput(1), { target: { value: '1.5' } });
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Halaman hasil' })).getByRole('button', { name: 'Berikutnya' }));
    await soldInput(101);
    await act(async()=>{await expect(workspace.save()).rejects.toThrow()});
    await waitFor(() => expect(document.activeElement?.id).toBe(`co-sold-${id(1001)}`));
    expect((document.activeElement as HTMLInputElement).value).toBe('1.5');
    expect(s.commands).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Baris penjualan laporan pelanggan' }).contains(document.activeElement)).toBe(true);
});

test('nested-period zero confirmation retains unopened-page count, native dialog and trigger focus', async () => {
    const {nested:s,primary}=await openNestedZero();
    fireEvent.change(await soldInput(1), { target: { value: '7' } });
    const trigger = screen.getByRole('button',{name:'Isi sisa periode dengan nol'}); trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Konfirmasi isi nol' });
    expect(dialog.tagName).toBe('DIALOG'); expect(dialog.className).toContain('ui-dialog');
    expect(within(dialog).getByText(/600 baris kosong di seluruh periode, termasuk halaman belum dibuka/)).toBeTruthy();
    await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Konfirmasi nol periode'}).matches(':disabled')).toBe(false));
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog',{name:'Konfirmasi isi nol'})).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(s.commands.map((c: any) => c.payload.action)).toEqual(['initialize','upsert_lines']);expect(primary.commands).toHaveLength(0);
    expect(s.rows[0].sold_quantity).toBe('7'); expect(s.rows[600].sold_quantity).toBeNull();
});

test('UNIT optional evidence error keeps named panel, raw fields and canonical-only retry without resending', async () => {
    const f = fixture(); f.selectionFail = true; mount(<FieldsUnit evidence/>);
    const sold = await screen.findByLabelText('Terjual Item 1');
    fireEvent.change(sold, { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Catatan laporan'), { target: { value: 'Keep raw' } });
    await choose(); fireEvent.click(screen.getByRole('button', { name: 'Verifikasi dan pasang lampiran' }));
    await screen.findByRole('button', { name: 'Coba buka hasil lampiran' });
    const evidence = screen.getByRole('region', { name: 'Lampiran laporan opsional' });
    expect(evidence.className).toContain('ui-section');
    const contents = evidence.querySelector(':scope > .ui-section__content')?.firstElementChild as HTMLElement;
    expect(contents.classList.contains('space-y-2')).toBe(true);
    expect(contents.contains(within(evidence).getByLabelText('Pilih lampiran'))).toBe(true);
    expect(within(evidence).getAllByRole('alert').some(alert => alert.textContent?.includes('Lampiran sudah tersimpan'))).toBe(true);
    await waitFor(() => expect(workspace.frozen).toBe(true));
    expect(sold.matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Catatan laporan').matches(':disabled')).toBe(true);
    f.selectionFail = false;
    await act(async () => { fireEvent.click(within(evidence).getByRole('button', { name: 'Coba buka hasil lampiran' })); });
    await screen.findByRole('button', { name: `Unduh evidence-${evidenceId}.pdf` });
    await waitFor(() => expect(workspace.frozen).toBe(false));
    expect(screen.getByLabelText('Terjual Item 1')).toBe(sold);
    expect((sold as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Keep raw');
    expect(f.commands.map(command => command.p_operation)).toEqual(['register_evidence', 'finalize_evidence']);
    expect(wire.invoke.mock.calls.filter(([name]) => name === 'co-evidence-upload')).toHaveLength(1);
    expect(f.s.commands).toHaveLength(0);
});

test('immutable historical evidence uses a shared named panel and original zero rows without importing a current draft', async () => {
    const s = store(), revision = id(6); s.rows[0].sold_quantity = '7';
    s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'2',eligible_set_fingerprint:null,revenue:'70000'};
    const base = s.handle;
    wire.handler = async (name: string, args: any) => {
        if(name==='pilot_co_report_import_v1'){
            expect(args).toMatchObject({p_customer_id:customer,p_month:month,p_revision_id:revision});
            return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,revision_id:revision,report_head_id:id(4),effective_revision_id:id(5),manifest:null,unit_declarations:{},source_amount:null,currency:null,source_filename:'Original historical source',created_at:'2026-09-30T00:00:00Z',created_by:id(1),author_name:'Original author',reason:null,report_version:'1',previous_revision_id:null},error:null};
        }
        if(name==='pilot_co_report_allocations_v1'){
            expect(args).toMatchObject({p_customer_id:customer,p_month:month,p_revision_id:revision,p_expected_customer_version:'1'});
            return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:revision,generation_id:null,is_effective:false,summary:{quantity:'0',amount:'0.00'},page:args.p_page,page_size:args.p_page_size,total:'0',rows:[]},error:null};
        }
        const response = await base(name, args);
        if (name === 'pilot_co_report_rows_v1') { response.data.revision_id = revision; response.data.rows = [{ ...s.rows[0], sold_quantity: '0' }]; }
        return response;
    };
    mount(<COReportRevisionEvidence customerId={customer} month={month} customerVersion="1" revisionId={revision}/>);
    await screen.findByRole('table');expect(screen.getByText('Sumber: Original historical source')).toBeTruthy();
    const panel = screen.getByRole('region', { name: `Bukti revisi historis ${revision}` });
    expect(panel.className).toContain('ui-section');
    expect(within(panel).getByText('0')).toBeTruthy();
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(s.rows[0].sold_quantity).toBe('7'); expect(s.commands).toHaveLength(0);
    expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_report_rows_v1' && a.p_view === 'revision' && a.p_revision_id === revision)).toBe(true);
    expect(wire.rpc.mock.calls.some(([n, a]) => n === 'pilot_co_evidence_selection_v1' && a.p_revision_id === revision && a.p_draft_id === null)).toBe(true);
});

test('revision attachment keeps its descriptions inside the spaced local content wrapper', async () => {
    store(); mount(<CORevisionAttachment customerId={customer} revisionId={id(6)}/>);
    const description = await screen.findByText('Tidak ada lampiran untuk revisi ini.');
    const panel = screen.getByRole('region', { name: 'Lampiran revisi (opsional)' });
    const contents = panel.querySelector(':scope > .ui-section__content')?.firstElementChild as HTMLElement;
    expect(contents.classList.contains('space-y-2')).toBe(true);
    expect(contents.contains(description)).toBe(true);
});

test('selected-SKU allocation evidence retains every-page exact revenue and original PIC in a named source list', async () => {
    const s = store(); s.rows[0].sold_quantity = '101'; s.rows[0].eligible_quantity = '101';
    s.allocations = Array.from({ length: 101 }, (_, i) => allocation(i + 1, '1', '10'));
    const snapshot: any = { operation: 'post_report', payload: { draft_id: draftId, expected_customer_version: '1', expected_draft_version: '1', eligible_set_fingerprint: hash }, header: { preview_fingerprint: fingerprint } };
    mount(<COAllocationDetails customerId={customer} month={month} customerVersion="1" snapshot={snapshot} stockKeyId={id(1001)}/>);
    expect(await screen.findByText('Pendapatan SKU: Rp 1.010 · 101 teralokasi')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Bukti sumber alokasi' });
    const contents = list.closest('.ui-section__content')?.firstElementChild as HTMLElement;
    expect(contents.classList.contains('space-y-3')).toBe(true);
    expect(contents.contains(list)).toBe(true);
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    expect(within(list).getByText(new RegExp(`PIC asli: PIC-1 · ${id(6001)}`))).toBeTruthy();
    expect(wire.rpc.mock.calls.filter(([n, a]) => n === 'pilot_co_preview_allocations_v1' && a.p_page_size === 100).map(([, a]) => a.p_page)).toEqual([1, 2]);
});

// Actual current page shell remains separate from surviving manual Fields UNIT.
test('current report page retains customer-wide header and does not duplicate shell main',async()=>{
 store();const {default:ActualAthelNav}=await vi.importActual<typeof import('../../src/components/AthelNav')>('../../src/components/AthelNav');
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const router=createMemoryRouter([{path:'/athel/co',element:<><ActualAthelNav/><COLayout/></>,children:[{path:'reports/:customerId/:month',element:<COMonthlyReport/>}]}],{initialEntries:[`/athel/co/reports/${customer}/${month}`]});render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);
 expect((await screen.findByRole('heading',{name:'Store A · September 2026',level:1})).closest('.ui-page-header')).toBeTruthy();expect(screen.getByText('Laporan penjualan bulanan mencakup semua CO toko, tanpa memilih sumber CO.')).toBeTruthy();expect(screen.getAllByRole('main')).toHaveLength(1);expect(document.querySelectorAll('#main-content')).toHaveLength(1);expect(document.querySelectorAll('h1')).toHaveLength(1);expect(screen.getByRole('heading',{level:2,name:'Upload laporan penjualan'})).toBeTruthy();expect(screen.getByRole('main').contains(screen.getByRole('heading',{level:1}))).toBe(true);router.dispose();client.clear();
});
