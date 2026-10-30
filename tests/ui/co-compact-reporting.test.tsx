import {productionImportFixture} from '../co/import-production-ports-harness';
import React from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { allocation, customer, month, mount, reportImpact, store, wire, id, draftId, hash, fingerprint } from '../co/report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COAllocationDetails from '../../src/components/co/COAllocationDetails';
import COMonthlyReports from '../../src/pages/athel/co/COMonthlyReports';

async function preparedUpload(){const f=await productionImportFixture();f.state.incomplete=false;f.mountRoute();await f.choose();await f.confirmDecisions();return f;}
async function reviewedUpload(){const f=await preparedUpload();fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Catat penjualan'}).matches(':disabled')).toBe(false));return f;}
const variant = (node: HTMLElement, value: string) => expect(node.classList.contains(`ui-action--${value}`)).toBe(true);

test('current upload emphasis keeps Review primary through raw decisions and Record primary only after bound review',async()=>{
 const f=await preparedUpload();const sold=screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)');
 const inspect=screen.getByRole('group',{name:'Tindakan pemeriksaan laporan'});const review=within(inspect).getByRole('button',{name:'Tinjau pencatatan'});
 variant(review,'primary');variant(within(inspect).getByRole('button',{name:'Batal'}),'secondary');expect(screen.queryByRole('button',{name:'Simpan Draft'})).toBeNull();
 fireEvent.change(sold,{target:{value:'0'}});variant(review,'primary');expect((sold as HTMLInputElement).value).toBe('0');expect(f.writes).toHaveLength(1);expect(f.writes[0].args.p_payload.action).toBe('initialize');
 fireEvent.change(sold,{target:{value:'1'}});fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));
 await waitFor(()=>expect(review.matches(':disabled')).toBe(false));fireEvent.click(review);
 const posting=await screen.findByRole('group',{name:'Tindakan pencatatan laporan'});const record=within(posting).getByRole('button',{name:'Catat penjualan'});await waitFor(()=>expect(record.matches(':disabled')).toBe(false));
 variant(record,'primary');variant(within(posting).getByRole('button',{name:'Batal'}),'secondary');expect(within(posting).queryByRole('button',{name:'Tinjau pencatatan'})).toBeNull();
 expect(f.state.previewCount).toBe(1);expect(f.writes).toHaveLength(4);expect(f.writes.at(-1)!.args.p_payload.manifest.input.mappings[0].quantity).toBe('1');expect(f.s.effective).toBeNull();
});

test('report impact selectors are quiet compact commands retaining pressed state and server read selection', async () => {
    const f=await reviewedUpload();
    const region = await screen.findByRole('region', { name: 'Peninjauan dampak' });
    const selector = within(region).getByRole('button', { name: 'Stok (0)' });
    variant(selector, 'quiet'); expect(selector.classList.contains('ui-action--compact')).toBe(true);
    expect(selector.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(selector); expect(selector.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(wire.rpc.mock.calls.some(([name, args]) => name === 'pilot_co_import_impacts_v1' && args.p_kind === 'stock')).toBe(true));
    expect(f.writes).toHaveLength(4);expect(f.s.effective).toBeNull();
});

test('impact selection moves a visible tinted border between compact quiet selectors', async () => {
    const f=await reviewedUpload();
    const region = await screen.findByRole('region', { name: 'Peninjauan dampak' });
    const selectors = Array.from(region.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
    expect(selectors).toHaveLength(7);
    const issue = within(region).getByRole('button', { name: 'Penghalang (0)' });
    const stock = within(region).getByRole('button', { name: 'Stok (0)' });
    const visibleSelection = (selected: HTMLElement) => {
        for (const button of selectors) {
            variant(button, 'quiet'); expect(button.classList.contains('ui-action--compact')).toBe(true);
            expect(button.classList.contains('bg-brand-tint')).toBe(button === selected);
            expect(button.classList.contains('border-brand-primary')).toBe(button === selected);
            expect(button.getAttribute('aria-pressed')).toBe(button === selected ? 'true' : 'false');
        }
    };
    visibleSelection(issue);
    fireEvent.click(stock); visibleSelection(stock);
    fireEvent.click(issue); visibleSelection(issue);
    expect(f.writes).toHaveLength(4);expect(f.s.effective).toBeNull();
});

test('allocation component preserves exact native quiet destinations and current report Back remains quiet',async()=>{
 const f=await productionImportFixture();f.mountRoute();variant(await screen.findByRole('link',{name:'← Laporan bulanan'}),'quiet');expect(f.writes).toHaveLength(0);cleanup();
 const s=store();s.rows[0].sold_quantity='70';s.allocations=[allocation(1,'70','10')];
 const snapshot:any={operation:'post_report',payload:{draft_id:draftId,expected_customer_version:'1',expected_draft_version:'1',eligible_set_fingerprint:hash},header:{preview_fingerprint:fingerprint}};
 mount(<COAllocationDetails customerId={customer} month={month} customerVersion="1" snapshot={snapshot} stockKeyId={id(1001)}/>);
 const link=await screen.findByRole('link',{name:'CO-1'});variant(link,'quiet');expect(link.classList.contains('ui-action--compact')).toBe(true);expect(link.getAttribute('href')).toBe(`/athel/co/${s.allocations[0].co_id}`);expect(s.commands).toHaveLength(0);
});

test('guided period action retains the authoritative customer and month destination', async () => {
    store();
    mount(<COMonthlyReports/>, `/athel/co/reports?customer=${customer}&month=2026-09`);
    const next = await screen.findByRole('link', { name: 'Unggah laporan bulanan' });
    variant(next, 'primary');
    const url=new URL(next.getAttribute('href')!,'https://test.invalid');expect(url.pathname).toBe(`/athel/co/reports/${customer}/${month}`);expect(url.searchParams.get('upload')).toBe('1');expect(url.searchParams.get('returnTo')).toBe(`/athel/co/reports?customer=${customer}&month=2026-09`);
});

test('absent report requires explicit native source selection and never initializes on route load',async()=>{
 const f=await productionImportFixture();f.mountRoute();const file=await screen.findByLabelText('Pilih PDF atau XLSX') as HTMLInputElement;
 expect(file.type).toBe('file');expect(file.labels).toHaveLength(1);expect(file.labels![0].contains(file)).toBe(true);expect(file.disabled).toBe(false);
 expect(f.writes).toHaveLength(0);expect(screen.queryByRole('button',{name:'Simpan Draft'})).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
});

// The removed report-metadata disclosure had only generic native-disclosure
// assertions, now preserved on the real preview below. Normal recorded content
// instead exposes business fields and opens checked revision history deliberately.
test('normal recorded report hides raw identities while explicit history preserves exact original revision access',async()=>{
 const s=store();s.rows[0].sold_quantity='7';s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'2',eligible_set_fingerprint:null,revenue:'70000'};
 const base=s.handle;wire.handler=async(n:string,a:any)=>{
  if(n==='pilot_co_report_allocations_v1'){
   expect(a).toMatchObject({p_customer_id:customer,p_month:month,p_revision_id:id(5),p_expected_customer_version:'1'});
   return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0.00'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};
  }
  if(n==='pilot_co_report_history_v1'){
   expect(a).toEqual({p_customer_id:customer,p_month:month,p_page:1,p_page_size:20});
   return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,page:1,page_size:20,total:'1',rows:[{revision_id:id(6),report_version:'1',created_at:'2026-09-30T23:10:00Z',created_by:id(9),author_name:'Original reviewer',reason:'Original recorded source',is_effective:false}]},error:null};
  }
  return base(n,a);
 };
 mount(<COMonthlyReport/>);const table=await screen.findByRole('table');expect(within(table).getByText('7')).toBeTruthy();expect(within(table).getByText('Alokasi perlu diperiksa')).toBeTruthy();
 expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);expect(document.body.textContent).not.toContain(fingerprint);expect(document.body.textContent).not.toContain(hash);
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_history_v1')).toHaveLength(0);
 const summary=screen.getByText('Riwayat perubahan',{exact:true});expect(summary.tagName).toBe('SUMMARY');expect((summary.parentElement as HTMLDetailsElement).open).toBe(false);fireEvent.click(summary);
 const original=await screen.findByRole('link',{name:'Buka bukti dan perubahan baris'});expect(original.getAttribute('href')).toBe(`/athel/co/reports/${customer}/${month}?revision=${id(6)}`);expect(screen.getByText('Versi riwayat 1')).toBeTruthy();expect(screen.getByText(/Original reviewer/)).toBeTruthy();expect(screen.getByText('Original recorded source')).toBeTruthy();expect(s.commands).toHaveLength(0);
 // History is intentionally lazy-read, not falsely claimed to be the old no-RPC panel.
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_history_v1')).toHaveLength(1);
});

// Current native disclosure, not a rename of the retired report-metadata panel.
test('current technical preview retains native disclosure, focus, mounted children and no extra requests',async()=>{
 const f=await reviewedUpload();const sold=screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)');
 const summary=screen.getByText('Detail teknis peninjauan'),details=summary.parentElement as HTMLDetailsElement;
 expect(summary.tagName).toBe('SUMMARY');expect(details.tagName).toBe('DETAILS');
 for(const token of ['ui-action','ui-action--quiet','ui-action--compact','list-item'])expect(summary.classList.contains(token),token).toBe(true);
 expect(summary.getAttribute('role')).toBeNull();expect(summary.getAttribute('tabindex')).toBeNull();expect(summary.classList.contains('outline-none')).toBe(false);
 const contents=summary.nextElementSibling;expect(contents).not.toBeNull();expect(details.open).toBe(false);expect(contents?.textContent).toContain('Sidik peninjauan:');
 const reads=wire.rpc.mock.calls.length,writes=f.writes.length;summary.focus();expect(document.activeElement).toBe(summary);fireEvent.click(summary);expect(details.open).toBe(true);expect(summary.nextElementSibling).toBe(contents);fireEvent.click(summary);expect(details.open).toBe(false);expect(summary.nextElementSibling).toBe(contents);expect(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBe(sold);
 await act(async()=>{});expect(wire.rpc.mock.calls).toHaveLength(reads);expect(f.writes).toHaveLength(writes);expect(f.s.effective).toBeNull();
});
