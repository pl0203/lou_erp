import { beginIntegrated, readyPreview } from '../co/workspace/import-acceptance-harness';
import { mountNestedReport } from '../co/nested-report-harness';
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { allocation, customer, draftId, fingerprint, hash, id, month, mount, reportImpact, row, store, wire } from '../co/report-ui-harness';
import { choose, evidenceId, fixture } from '../co/evidence-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COMonthlyReports from '../../src/pages/athel/co/COMonthlyReports';
import COMonthlySalesGrid from '../../src/components/co/COMonthlySalesGrid';
import COReportRevisionEvidence from '../../src/components/co/COReportRevisionEvidence';
import COAllocationDetails from '../../src/components/co/COAllocationDetails';
import COEvidenceAttachment, { CORevisionAttachment } from '../../src/components/co/COEvidenceAttachment';
import { COReportFields, useCOReportWorkspace } from '../../src/components/co/COReportWorkspace';

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

test('report contains keyboard-scrollable sales rows with native labels and original focus IDs',async()=>{
 await beginIntegrated();const sold=screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement;
 const region=screen.getByRole('region',{name:'Tabel pemeriksaan laporan'});expect(region.tabIndex).toBe(0);expect(region.classList.contains('co-import__scroll')).toBe(true);expect(region.contains(sold)).toBe(true);expect(sold.labels?.[0].contains(sold)).toBe(true);expect(sold.classList.contains('ui-control')).toBe(true);
 const reason=screen.getByLabelText('Alasan perubahan (wajib untuk Edit)') as HTMLInputElement;expect(reason.labels?.[0].contains(reason)).toBe(true);
 expect(screen.getByRole('heading',{name:'Store A · September 2026'}).closest('.ui-page-header')).toBeTruthy();expect(screen.getByText(/Laporan penjualan bulanan mencakup semua CO toko/)).toBeTruthy();expect(document.querySelector('main,#main-content')).toBeNull();
});

test('partial coverage remains a date-only UTC server statement with customer-wide scope',async()=>{
 recordedFixture(id(5),true);mount(<COMonthlyReport/>);const statement=await screen.findByText(/Cakupan tercatat sampai 9 September 2026.*tanggal UTC server.*parsial/);expect(statement.textContent).not.toContain('WIB');const freshness=screen.getByText('Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.');expect(freshness.closest('[role="status"],[role="alert"],[aria-live]')).toBeNull();
});

test('draft and posting actions have separate native named groups with server-reviewed Post availability',async()=>{
 const {f}=await beginIntegrated();const reviewActions=screen.getByRole('group',{name:'Tindakan pemeriksaan laporan'});fireEvent.click(within(reviewActions).getByRole('button',{name:'Tinjau pencatatan'}));const finalActions=await screen.findByRole('group',{name:'Tindakan pencatatan laporan'});const post=within(finalActions).getByRole('button',{name:'Catat penjualan'});await waitFor(()=>expect(post.matches(':disabled')).toBe(false));expect(post.tagName).toBe('BUTTON');expect(f.requests.filter(r=>r.n==='pilot_co_import_preview_v1')).toHaveLength(1);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
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

test('report filters preserve customer and period payloads, accessible native fields and list scope',async()=>{
 listFixture();mount(<COMonthlyReports/>,`/athel/co/reports?customer=${customer}&month=2026-09`);const link=await screen.findByRole('link',{name:'Buka laporan'});expect(link.getAttribute('href')).toBe(`/athel/co/reports/${customer}/${month}?returnTo=${encodeURIComponent(`/athel/co/reports?customer=${customer}&month=2026-09`)}`);expect(screen.getByRole('table',{name:'Laporan penjualan pelanggan'}).contains(link)).toBe(true);const filters=screen.getByRole('region',{name:'Filter laporan penjualan'});expect(filters.className).toContain('ui-filter-bar');const period=within(filters).getByLabelText('Bulan laporan') as HTMLInputElement;expect(period.labels?.[0].htmlFor).toBe(period.id);fireEvent.change(within(filters).getByLabelText('Status laporan'),{target:{value:'posted'}});await waitFor(()=>expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_reports_page_v2'&&a.p_status==='posted'&&a.p_customer_id===customer&&a.p_month===month&&a.p_page===1)).toBe(true));expect(await screen.findByText(/pelanggan dipilih, semua CO.*September 2026/)).toBeTruthy();expect(screen.getByRole('region',{name:'Periode laporan pelanggan'}).className).toContain('ui-section');
});

test('empty filtered report list explicitly avoids a verified-zero interpretation',async()=>{listFixture(true);mount(<COMonthlyReports/>,'/athel/co/reports');expect(await screen.findByRole('heading',{name:'Belum ada laporan sesuai filter.'})).toBeTruthy();expect(screen.getByText(/Daftar kosong berarti belum ada laporan sesuai filter, bukan penjualan terverifikasi nol/)).toBeTruthy()});

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

test('save returns to an earlier page and focuses the unchanged invalid native sold input', async () => {
    const s = store(101); await mountNestedReport(s);
    fireEvent.change(await soldInput(1), { target: { value: '1.5' } });
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Halaman hasil' })).getByRole('button', { name: 'Berikutnya' }));
    await soldInput(101);
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan peninjauan periode' }));
    await waitFor(() => expect(document.activeElement?.id).toBe(`co-sold-${id(1001)}`));
    expect((document.activeElement as HTMLInputElement).value).toBe('1.5');
    expect(s.commands).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Baris penjualan laporan pelanggan' }).contains(document.activeElement)).toBe(true);
});

test('whole-report zero confirmation retains unopened-page count, native dialog and trigger focus', async () => {
    const s = store(601); await mountNestedReport(s);
    fireEvent.change(await soldInput(1), { target: { value: '7' } });
    const trigger = screen.getByRole('button', { name: 'Isi sisa periode dengan nol' }); trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Konfirmasi isi nol' });
    expect(dialog.tagName).toBe('DIALOG'); expect(dialog.className).toContain('ui-dialog');
    expect(within(dialog).getByText(/600 baris kosong di seluruh periode, termasuk halaman belum dibuka/)).toBeTruthy();
    await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Konfirmasi nol periode'}).matches(':disabled')).toBe(false));
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog',{name:'Konfirmasi isi nol'})).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(s.commands.map((c: any) => c.payload.action)).toEqual(['initialize','upsert_lines']);
    expect(s.rows[0].sold_quantity).toBe('7'); expect(s.rows[600].sold_quantity).toBeNull();
});

test('optional evidence error keeps named panel, raw fields and canonical-only retry without resending', async () => {
    const f = fixture(); f.selectionFail = true; await mountNestedReport(f.s);
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lanjutkan peninjauan periode' }).matches(':disabled')).toBe(true));
    expect(sold.matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Catatan laporan').matches(':disabled')).toBe(true);
    f.selectionFail = false;
    await act(async () => { fireEvent.click(within(evidence).getByRole('button', { name: 'Coba buka hasil lampiran' })); });
    await screen.findByRole('button', { name: `Unduh evidence-${evidenceId}.pdf` });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lanjutkan peninjauan periode' }).matches(':disabled')).toBe(false));
    expect(screen.getByLabelText('Terjual Item 1')).toBe(sold);
    expect((sold as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Keep raw');
    expect(f.commands.map(command => command.p_operation)).toEqual(['register_evidence', 'finalize_evidence']);
    expect(wire.invoke.mock.calls.filter(([name]) => name === 'co-evidence-upload')).toHaveLength(1);
    expect(f.s.commands).toHaveLength(1);
});

test('immutable historical evidence uses a shared named panel and original zero rows without importing a current draft',async()=>{
 const revision=id(6),s=recordedFixture(revision);mount(<COReportRevisionEvidence customerId={customer} month={month} customerVersion="1" revisionId={revision}/>);await screen.findByRole('columnheader',{name:'Jumlah terjual'});const panel=screen.getByRole('region',{name:`Bukti revisi historis ${revision}`});expect(panel.className).toContain('ui-section');expect(within(panel).getByText('0')).toBeTruthy();expect(within(panel).queryByRole('textbox')).toBeNull();expect(within(panel).getByText('Cakupan revisi ini belum tersedia pada data yang diperiksa.')).toBeTruthy();expect(s.rows[0].sold_quantity).toBe('7');expect(s.commands).toHaveLength(0);expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_report_rows_v1'&&a.p_view==='revision'&&a.p_revision_id===revision)).toBe(true);expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_evidence_selection_v1'&&a.p_revision_id===revision&&a.p_draft_id===null)).toBe(true);
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

function listFixture(empty=false){const s=store(),base=s.handle;wire.handler=async(n,a)=>n==='pilot_co_reports_page_v2'?{data:{version:'2',as_of:'2026-10-09T00:00:00Z',customer_id:a.p_customer_id,report_month:a.p_month,status:a.p_status,page:a.p_page,page_size:a.p_page_size,total:empty?'0':'1',rows:empty?[]:[{id:id(4),customer_id:customer,customer_name:'Store A',report_month:a.p_month??month,status:'posted',revision_id:id(5),report_head_id:id(4),legacy_pending:false,source_filename:'synthetic.pdf',updated_at:'2026-10-09T00:00:00Z'}]},error:null}:base(n,a);return s}
function recordedFixture(revision=id(5),partial=false){const s=store();s.rows[0].sold_quantity='7';s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'2',revenue:'0',eligible_set_fingerprint:null,coverage_through_date:partial?'2026-09-09':'2026-09-30',is_partial_month:partial};const base=s.handle;wire.handler=async(n,a)=>{
 if(n==='pilot_co_report_import_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,revision_id:revision,report_head_id:id(4),effective_revision_id:id(5),manifest:null,unit_declarations:{},source_amount:null,currency:null,source_filename:null,created_at:'2026-10-09T00:00:00Z',created_by:id(1),author_name:'Operator',reason:null,report_version:'1',previous_revision_id:null},error:null};
 if(n==='pilot_co_report_allocations_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:revision,generation_id:null,is_effective:revision===id(5),summary:{quantity:'0',amount:'0'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};
 if(n==='pilot_co_report_revision_delta_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,revision_id:revision,previous_revision_id:null,page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};
 const r=await base(n,a);if(n==='pilot_co_report_rows_v1'){r.data.revision_id=revision;r.data.rows=[{...s.rows[0],sold_quantity:'0'}]}return r};return s}
