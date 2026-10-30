import React from 'react';
import {act,screen,within} from '@testing-library/react';
import {expect,test,vi} from 'vitest';
import {store,mount,customer,id,month,wire,draftId,hash,fingerprint} from './report-ui-harness';
import CORecordedReportTable from '../../src/components/co/CORecordedReportTable';
import COLegacyReportEdit from '../../src/components/co/COLegacyReportEdit';
import COChangePreview from '../../src/components/co/COChangePreview';
import COReportRevisionEvidence from '../../src/components/co/COReportRevisionEvidence';
function fixture(){const s=store();s.rows[0].sold_quantity='7';s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'70000'};const base=s.handle;s.handle=async(n:string,a:any)=>{if(n!=='pilot_co_report_allocations_v1')return base(n,a);if(s.fail){const failure=await s.fail(n,a);if(failure)return failure;}if(a.p_customer_id!==customer||a.p_month!==month||a.p_revision_id!==id(5)||a.p_expected_customer_version!=='1')throw new Error('Synthetic allocation scope mismatch');return {data:{version:'1',as_of:'2026-10-29T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0.00'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null}};wire.handler=s.handle;return s;}
test('all three verified recorded reads render the nonempty persisted row without inventing FIFO allocations',async()=>{
 const s=fixture();
 mount(<CORecordedReportTable customerId={customer} month={month} customerVersion="1" revisionId={id(5)} showEvidence={false}/>);
 const table=await screen.findByRole('table');
 expect(within(table).getByText(s.rows[0].product_name)).toBeTruthy();
 expect(within(table).getByText('7')).toBeTruthy();
 expect(within(table).getByText('Alokasi perlu diperiksa')).toBeTruthy();
 expect(screen.queryByText('Memuat laporan tercatat…')).toBeNull();
 expect(screen.queryByText(/Unhandled RPC/)).toBeNull();expect(s.commands).toHaveLength(0);
});
test.each(['pilot_co_report_import_v1','pilot_co_report_rows_v1','pilot_co_report_allocations_v1'])('recorded report waits for mandatory %s and presents its error without fabricated data',async resource=>{
 const s=fixture();let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string)=>{if(n===resource){await pending;return {data:null,error:{code:'08006',message:'Original evidence unavailable'}}}return null};
 mount(<CORecordedReportTable customerId={customer} month={month} customerVersion="1" revisionId={id(5)} showEvidence={false}/>);
 await screen.findByText('Memuat laporan tercatat…');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))});expect(screen.getByText('Memuat laporan tercatat…')).toBeTruthy();expect(screen.queryByText(/Unhandled RPC/)).toBeNull();expect(screen.queryByRole('table')).toBeNull();
 await act(async()=>release());await screen.findByText('Original evidence unavailable');expect(screen.queryByText('Memuat laporan tercatat…')).toBeNull();expect(screen.queryByRole('table')).toBeNull();expect(s.commands).toHaveLength(0);
});
test('historical delta failure is not loading or an empty successful delta',async()=>{
 const s=fixture();let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string)=>{if(n==='pilot_co_report_revision_delta_v1'){await pending;return {data:null,error:{code:'08006',message:'Delta unavailable'}}}return null};
 mount(<COReportRevisionEvidence customerId={customer} month={month} customerVersion="1" revisionId={id(5)}/>);
 await screen.findByText('Memuat perubahan baris…');await act(async()=>release());await screen.findByText('Delta unavailable');
 expect(screen.queryByText('Memuat perubahan baris…')).toBeNull();expect(screen.queryByText(/Tidak ada perubahan jumlah/)).toBeNull();expect(s.commands).toHaveLength(0);
});

test('legacy Edit initial and canonical pending gates keep initialization disabled, then show canonical error',async()=>{
 const s=fixture();let rootRelease!:()=>void,canonicalRelease!:()=>void;
 const rootPending=new Promise<void>(resolve=>rootRelease=resolve),canonicalPending=new Promise<void>(resolve=>canonicalRelease=resolve);
 s.fail=async(n:string,a:any)=>{if(n==='pilot_co_report_v1')await rootPending;if(n==='pilot_co_report_rows_v1'&&a.p_view==='revision'){await canonicalPending;return {data:null,error:{code:'08006',message:'Canonical original unavailable'}}}return null};
 mount(<COLegacyReportEdit customerId={customer} month={month} customerVersion="1" revisionId={id(5)} onRecorded={()=>{}} onExit={()=>{}}/>);
 await screen.findByText('Memuat dasar Edit…');expect(screen.queryByRole('button',{name:'Mulai Edit dari laporan tercatat'})).toBeNull();
 await act(async()=>rootRelease());await screen.findByText('Memuat semua nilai laporan tercatat…');
 expect((screen.getByRole('button',{name:'Mulai Edit dari laporan tercatat'}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>canonicalRelease());await screen.findAllByText('Canonical original unavailable');
 expect(screen.queryByText('Memuat semua nilai laporan tercatat…')).toBeNull();expect((screen.getByRole('button',{name:'Mulai Edit dari laporan tercatat'}) as HTMLButtonElement).disabled).toBe(true);expect(s.commands).toHaveLength(0);
});
test('legacy Edit authority denial takes precedence over missing accepted-data loading',async()=>{
 const s=fixture();s.fail=(n:string)=>n==='pilot_co_report_v1'?{data:null,error:{code:'42501',message:'Legacy source denied'}}:null;
 mount(<COLegacyReportEdit customerId={customer} month={month} customerVersion="1" revisionId={id(5)} onRecorded={()=>{}} onExit={()=>{}}/>);
 await screen.findByText('Legacy source denied');expect(screen.queryByText('Memuat dasar Edit…')).toBeNull();expect(screen.queryByRole('button',{name:'Mulai Edit dari laporan tercatat'})).toBeNull();expect(s.commands).toHaveLength(0);
});
test('import reopen identity loading and failure cannot report preview readiness',async()=>{
 const s=fixture(),ready=vi.fn();let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 const binding={importId:id(88),importVersion:'1',customerVersion:'1',draftId,draftVersion:'1',manifestDigest:hash};
 const header={version:'1',as_of:'2026-10-29T00:00:00Z',operation:'post_report',customer_id:customer,customer_version:'1',draft_version:'1',preview_fingerprint:fingerprint,can_post:true,before:{sold_quantity:'0',revenue:'0',remaining_quantity:'10',complete:true},after:{sold_quantity:'1',revenue:'1',remaining_quantity:'9',complete:true},counts:{report:'0',stock:'0',revenue:'0',credit:'0',reopen:'1',issue:'0',missing_month:'0'}};
 wire.handler=async(name:string,a:any)=>{if(name!=='pilot_co_import_impacts_v1')return s.handle(name,a);if(a.p_kind==='reopen'){await pending;return {data:null,error:{code:'08006',message:'Reopen identities unavailable'}}}return {data:{version:'1',as_of:header.as_of,binding,preview_fingerprint:fingerprint,acknowledged_reopen_orders:[],kind:a.p_kind,page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null}};
 mount(<COChangePreview importSnapshot={{binding,previewFingerprint:fingerprint,acknowledgedReopenOrders:[],header} as any} onReadyChange={ready}/>);
 await screen.findByText('Memeriksa identitas pesanan terdampak…');expect(ready.mock.calls.some(([value])=>value===true)).toBe(false);
 await act(async()=>release());await screen.findByText('Reopen identities unavailable');expect(screen.queryByText('Memeriksa identitas pesanan terdampak…')).toBeNull();expect(ready.mock.calls.some(([value])=>value===true)).toBe(false);expect(s.commands).toHaveLength(0);
});
