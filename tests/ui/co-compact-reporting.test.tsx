import { beginIntegrated, readyPreview } from '../co/workspace/import-acceptance-harness';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { customer, id, month, mount, store, wire } from '../co/report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COMonthlyReports from '../../src/pages/athel/co/COMonthlyReports';
const variant=(node:HTMLElement,value:string)=>expect(node.classList.contains(`ui-action--${value}`)).toBe(true);
function listFixture(){const s=store(),base=wire.handler;wire.handler=async(n,a)=>n==='pilot_co_reports_page_v2'?{data:{version:'2',as_of:'2026-10-09T00:00:00Z',customer_id:a.p_customer_id,report_month:a.p_month,status:a.p_status,page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null}:base(n,a);return s}

test('guided report emphasis keeps Review primary through dirty entry and Post primary after review',async()=>{
 const {f}=await beginIntegrated();const review=screen.getByRole('button',{name:'Tinjau pencatatan'});variant(review,'primary');
 const quantity=screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement;
 fireEvent.change(quantity,{target:{value:'69'}});variant(review,'primary');expect(quantity.value).toBe('69');
 expect(screen.queryByRole('button',{name:'Simpan Draft'})).toBeNull();expect(f.s.commands).toHaveLength(0);
 // Unchanged source70 cannot authorize mapping69; correct the intent before obtaining a checked binding.
 fireEvent.click(review);expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(0);
 fireEvent.change(quantity,{target:{value:'70'}});fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));
 await readyPreview();variant(screen.getByRole('button',{name:'Catat penjualan'}),'primary');
 expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(1);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
});
test('report impact selectors are quiet compact commands retaining pressed state and server read selection',async()=>{
 const {f}=await beginIntegrated();await readyPreview();const region=screen.getByRole('region',{name:'Peninjauan dampak'});
 const selector=within(region).getByRole('button',{name:'Stok (1)'});variant(selector,'quiet');expect(selector.classList.contains('ui-action--compact')).toBe(true);expect(selector.getAttribute('aria-pressed')).toBe('false');
 fireEvent.click(selector);expect(selector.getAttribute('aria-pressed')).toBe('true');await waitFor(()=>expect(f.requests.some(r=>r.n==='pilot_co_import_impacts_v1'&&r.a.p_kind==='stock')).toBe(true));expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
});
test('impact selection moves a visible tinted border between compact quiet selectors',async()=>{
 const {f}=await beginIntegrated();await readyPreview();const region=screen.getByRole('region',{name:'Peninjauan dampak'}),selectors=Array.from(region.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
 expect(selectors).toHaveLength(7);const issue=within(region).getByRole('button',{name:'Penghalang (0)'}),stock=within(region).getByRole('button',{name:'Stok (1)'});
 const selected=(target:HTMLElement)=>{for(const b of selectors){variant(b,'quiet');expect(b.classList.contains('ui-action--compact')).toBe(true);expect(b.classList.contains('bg-brand-tint')).toBe(b===target);expect(b.classList.contains('border-brand-primary')).toBe(b===target);expect(b.getAttribute('aria-pressed')).toBe(b===target?'true':'false')}};
 selected(issue);fireEvent.click(stock);selected(stock);fireEvent.click(issue);selected(issue);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
});
test('report allocation links keep exact native destinations with quiet compact affordance',async()=>{
 await beginIntegrated();await readyPreview();fireEvent.click(screen.getByRole('button',{name:'Catat penjualan'}));await screen.findByRole('button',{name:'Edit'});await screen.findByRole('columnheader',{name:'Harga CO'});
 fireEvent.click(screen.getByText('Bukti alokasi FIFO dan PIC asli'));const link=await screen.findByRole('link',{name:'CO-1'});variant(link,'quiet');expect(link.classList.contains('ui-action--compact')).toBe(true);expect(link.getAttribute('href')).toBe(`/athel/co/${id(4001)}`);variant(screen.getByRole('link',{name:'← Laporan bulanan'}),'quiet');
});
test('guided period action retains the authoritative customer and month destination',async()=>{const s=listFixture();mount(<COMonthlyReports/>,`/athel/co/reports?customer=${customer}&month=2026-09`);const next=await screen.findByRole('link',{name:'Unggah laporan bulanan'});variant(next,'primary');expect(next.getAttribute('href')).toBe(`/athel/co/reports/${customer}/${month}?upload=1&returnTo=${encodeURIComponent(`/athel/co/reports?customer=${customer}&month=2026-09`)}`);expect(s.commands).toHaveLength(0)});
test('an absent report emphasizes explicit preparation without initializing on route load',async()=>{const s=store();s.draft=false;mount(<COMonthlyReport/>);const file=await screen.findByLabelText('Pilih PDF atau XLSX');expect(file.tagName).toBe('INPUT');expect(file.getAttribute('type')).toBe('file');expect(s.commands).toHaveLength(0);expect(screen.queryByRole('button',{name:'Simpan Draft'})).toBeNull()});

test.each(['Detail teknis laporan','Detail teknis peninjauan'])('%s uses shared responsive targets while retaining native disclosure and mounted children',async oldLabel=>{
 const {f}=await beginIntegrated();const sold=screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)');await readyPreview();
 // The removed primary technical report header is now the review's native unit/conversion disclosure.
 const summary=screen.getByText(oldLabel==='Detail teknis laporan'?'Atur satuan':'Detail teknis peninjauan'),details=summary.parentElement as HTMLDetailsElement;
 expect(summary.tagName).toBe('SUMMARY');expect(details.tagName).toBe('DETAILS');for(const token of ['ui-action','ui-action--quiet','ui-action--compact','list-item'])expect(summary.classList.contains(token)).toBe(true);
 expect(summary.getAttribute('role')).toBeNull();expect(summary.getAttribute('tabindex')).toBeNull();expect(summary.classList.contains('outline-none')).toBe(false);
 const contents=summary.nextElementSibling;expect(contents).not.toBeNull();expect(details.open).toBe(false);const reads=wire.rpc.mock.calls.length;
 summary.focus();expect(document.activeElement).toBe(summary);fireEvent.click(summary);expect(details.open).toBe(true);expect(summary.nextElementSibling).toBe(contents);fireEvent.click(summary);expect(details.open).toBe(false);expect(summary.nextElementSibling).toBe(contents);expect(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBe(sold);expect(wire.rpc.mock.calls).toHaveLength(reads);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
});
