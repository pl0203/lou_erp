import {expect,test} from 'vitest';
import {fireEvent,screen,waitFor} from '@testing-library/react';
import {store} from '../report-ui-harness';
import {mountNestedReport} from '../nested-report-harness';
test('R2 period review has one save-and-complete continuation, no independent saved-draft task',async()=>{
 const s=store();await mountNestedReport(s);
 expect(screen.queryByRole('button',{name:/Simpan Draft periode/i})).toBeNull();
 expect(screen.queryByRole('button',{name:/Gunakan draft/i})).toBeNull();
 fireEvent.change(screen.getByLabelText('Terjual Item 1'),{target:{value:'0'}});
 fireEvent.click(screen.getByRole('button',{name:'Lanjutkan peninjauan periode'}));
 await screen.findByText(/Periode telah diperiksa dalam paket/);
 expect(s.rows[0].sold_quantity).toBe('0');expect(s.commands.map((c:any)=>c.payload.action)).toEqual(['initialize','upsert_lines']);
 expect(screen.queryByText(/Draft periode siap|Simpan isian periode sebelum kembali/)).toBeNull();
 expect(screen.queryByRole('button',{name:'Terapkan perubahan'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));
 await waitFor(()=>expect(s.previewCount).toBe(2));expect(s.commands.every((c:any)=>c.op==='save_report_draft')).toBe(true);
});

import COMonthlyReport from '../../../src/pages/athel/co/COMonthlyReport';
import {mount,wire,id,customer,month,hash} from '../report-ui-harness';
test.each([false,true])('R2 actual mounted proposal=%s report completes downstream period without saved-draft workflow',async proposal=>{
 const primary=store();primary.rows[0].sold_quantity='7';primary.draft=proposal;primary.effective={...primary.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'3',eligible_set_fingerprint:null,revenue:'700'};
 const later='2026-10-01',downstream=store(2,later,id(30));downstream.draft=false;let last=primary;const core={draft_id:id(3),expected_draft_version:'1',expected_customer_version:'1',eligible_set_fingerprint:hash,report_head_id:id(4),original_revision_id:id(5),expected_report_version:'3',reason:'Correction'};
 wire.handler=async(n,a)=>{
  if(n==='pilot_co_report_source_proposal_v1')return {data:{version:'1',customer_id:customer,report_month:month,draft_id:id(3),draft_version:'1',customer_version:'1',source_context:{operation:'correct_report',payload:core,source_context_fingerprint:'c'.repeat(64)},owner:{kind:'report',co_id:null,report_month:month}},error:null};
  if(n==='pilot_co_report_allocations_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};
  if(n==='pilot_co_preview_v1')primary.impacts.missing_month=a.p_payload.completed_report_drafts.some((d:any)=>d.draft_id===id(30))?[]:[{report_month:later,reason:'missing',head_id:null,coverage_through_date:null}];
  if(n==='pilot_co_transaction_v1'){last=a.p_payload.report_month===later||a.p_payload.draft_id===id(30)?downstream:primary;return last.handle(n,a)}
  if(n==='pilot_reconcile_co_v1')return last.handle(n,a);
  if(['pilot_co_report_v1','pilot_co_report_rows_v1','pilot_co_evidence_selection_v1'].includes(n)&&(a.p_month===later||a.p_draft_id===id(30)))return downstream.handle(n,a);
  return primary.handle(n,a);
 };
 mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}${proposal?`?proposalDraft=${id(3)}&proposalMonth=${month}&proposalDraftVersion=1&proposalCustomerVersion=1`:''}`);
 if(!proposal){fireEvent.click(await screen.findByRole('button',{name:'Edit'}));fireEvent.click(await screen.findByRole('button',{name:'Mulai Edit dari laporan tercatat'}));await screen.findByLabelText('Terjual Item 1');fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));fireEvent.change(await screen.findByLabelText('Alasan perubahan'),{target:{value:'Correction'}})}
 const inspect=await screen.findByRole('button',{name:'Tinjau semua dampak'});await waitFor(()=>expect(inspect.matches(':disabled')).toBe(false));fireEvent.click(inspect);fireEvent.click(await screen.findByRole('button',{name:'Lengkapi periode 2026-10'}));const prepare=await screen.findByRole('button',{name:'Perbarui periode terhadap sumber usulan'});await waitFor(()=>expect(prepare.matches(':disabled')).toBe(false));fireEvent.click(prepare);
 const field=await screen.findByLabelText('Terjual Item 1');expect((field as HTMLInputElement).value).toBe('');expect(screen.queryByRole('button',{name:/Simpan Draft|Gunakan draft/i})).toBeNull();fireEvent.change(field,{target:{value:'7'}});fireEvent.click(screen.getByRole('button',{name:'Lanjutkan peninjauan periode'}));await screen.findByText('Lengkapi semua baris dengan konteks sumber terbaru.');expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Isi sisa periode dengan nol'}).matches(':disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Isi sisa periode dengan nol'}));await screen.findByText(/1 baris kosong di seluruh periode/);fireEvent.click(screen.getByRole('button',{name:'Konfirmasi nol periode'}));await waitFor(()=>expect(downstream.rows[1].sold_quantity).toBe('0'));await waitFor(()=>expect(screen.getByRole('button',{name:'Lanjutkan peninjauan periode'}).matches(':disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Lanjutkan peninjauan periode'}));await screen.findByText(/Periode telah diperiksa dalam paket: 2026-10/);expect(screen.queryByText(/Draft periode siap/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('button',{name:'Simpan perubahan'});
 const payload=wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_preview_v1').at(-1)![1].p_payload;expect(payload.completed_report_drafts).toEqual([{draft_id:id(30),expected_draft_version:downstream.version,eligible_set_fingerprint:hash}]);expect(downstream.metadata.source_context_fingerprint).toBe('c'.repeat(64));expect(downstream.rows.map((r:any)=>r.sold_quantity)).toEqual(['7','0']);expect(primary.commands.every((c:any)=>c.op==='save_report_draft')).toBe(true);
});
