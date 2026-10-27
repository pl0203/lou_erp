import { test, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { mount, store, wire, id, customer, month } from '../report-ui-harness';
import COMonthlyReport from '../../../src/pages/athel/co/COMonthlyReport';
function setup(coverage:string,partial:boolean,revision=id(5)){
 const s=store();s.rows[0].sold_quantity='0';s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'0',coverage_through_date:coverage,is_partial_month:partial};
 const base=s.handle;wire.handler=async(n,a)=>{
  if(n==='pilot_co_report_import_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,revision_id:revision,report_head_id:id(4),effective_revision_id:id(5),manifest:null,unit_declarations:{},source_amount:null,currency:null,source_filename:null,created_at:'2026-10-09T00:00:00Z',created_by:id(1),author_name:'Operator',reason:null,report_version:'1',previous_revision_id:null},error:null};
  if(n==='pilot_co_report_allocations_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:revision,generation_id:null,is_effective:revision===id(5),summary:{quantity:'0',amount:'0'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};
  if(n==='pilot_co_report_revision_delta_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,revision_id:revision,previous_revision_id:null,page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};
  const r=await base(n,a);if(n==='pilot_co_report_rows_v1')r.data.revision_id=revision;return r;
 };return s;
}
test.each([['2026-09-09',true,'9 September 2026'],['2026-09-30',false,'30 September 2026']] as const)('recorded selected effective revision discloses checked %s UTC coverage (partial:%s)',async(date,partial,label)=>{
 setup(date,partial);mount(<COMonthlyReport/>);
 const statement=await screen.findByText(new RegExp(`Cakupan tercatat sampai ${label}.*tanggal UTC server`));
 expect(statement.textContent?.includes('bulan parsial')).toBe(partial);
});
test('historical revision without checked coverage never borrows current effective cutoff',async()=>{
 setup('2026-09-30',false,id(6));mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?revision=${id(6)}`);
 await screen.findByText('Cakupan revisi ini belum tersedia pada data yang diperiksa.');
 expect(screen.queryByText(/Cakupan tercatat sampai 30 September/)).toBeNull();
});
