import { expect, test } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { store, mount, wire, id, customer, month, hash } from '../report-ui-harness';
import * as reads from '../../../src/lib/co/workspaceReads';
import COCorrectionDialog from '../../../src/components/co/COCorrectionDialog';
import { createCOTransactionSender } from '../../../src/lib/co/transactions';

const args={p_customer_id:customer,p_month:month,p_draft_id:id(3),p_expected_draft_version:'1',p_expected_customer_version:'1'};
const fp='c'.repeat(64);
function proposal(operation='post_sj',action?:string){
 const payload:any={expected_customer_version:'1',reason:'  exact stored reason\n'};
 const kind=operation.includes('sj')?'delivery':operation.includes('return')?'return':'report';
 if(kind==='delivery')payload.expected_co_version='1';
 if(operation.startsWith('correct_'))Object.assign(payload,{[kind==='delivery'?'delivery_head_id':kind==='return'?'return_head_id':'report_head_id']:id(40),original_revision_id:id(41),[`expected_${kind==='delivery'?'delivery':kind==='return'?'return':'report'}_version`]:'1',...(action?{action}:{})});
 if(!operation.startsWith('correct_')||kind==='report'||action==='replace'&&kind==='delivery')Object.assign(payload,{draft_id:id(90),expected_draft_version:'1'});
 if(kind==='report')payload.eligible_set_fingerprint=hash;
 if(kind==='return'&&action==='replace')Object.assign(payload,{return_date:'2026-09-02',reference:' retained ',notes:null,lines:[{batch_id:id(70),quantity:2}]});
 return {version:'1',customer_id:customer,report_month:month,draft_id:id(3),draft_version:'1',customer_version:'1',source_context:{operation,payload,source_context_fingerprint:fp},owner:{kind,co_id:kind==='delivery'?id(20):null,report_month:kind==='report'?'2026-08-01':null}};
}

test.each([['post_sj'],['correct_sj','replace'],['correct_sj','void'],['post_return'],['correct_return','replace'],['correct_return','void'],['correct_report']])('checked %s %s routes exact source operation/core without a replacement command',(operation,action)=>{
 const value=proposal(operation,action),checked=reads.decodeCOReportSourceProposal(value,args);
 expect(checked.source_context).toEqual(value.source_context);
 const url=new URL(reads.coSourceProposalURL(checked),'https://local.invalid');
 expect(url.pathname).toBe(value.owner.kind==='delivery'?`/athel/co/${id(20)}`:value.owner.kind==='return'?'/athel/co/stock':`/athel/co/reports/${customer}/2026-08-01`);
 expect(url.searchParams.get('proposalDraft')).toBe(id(3));expect(url.searchParams.get('proposalMonth')).toBe(month);
 expect(url.search).not.toMatch(/reason|payload|fingerprint|token/);
});
test.each(['customer','draft','month','version','core','consent','owner','unsupported','lines'])('strict checked proposal rejects tampered %s',kind=>{
 const v:any=proposal('correct_return','replace');
 if(kind==='customer')v.customer_id=id(99);if(kind==='draft')v.draft_id=id(99);if(kind==='month')v.report_month='2026-08-01';if(kind==='version')v.customer_version='2';if(kind==='core')v.source_context.payload.expected_customer_version='2';if(kind==='consent')v.source_context.payload.acknowledged_reopen_orders=[];if(kind==='owner')v.owner.co_id=id(1);if(kind==='unsupported')v.source_context.operation='post_report';if(kind==='lines')v.source_context.payload.lines=Array.from({length:1001},()=>({batch_id:id(70),quantity:2}));
 expect(()=>reads.decodeCOReportSourceProposal(v,args)).toThrow();
});

test('resume fixes byte-for-byte reason and starts without preview or old consent',async()=>{
 const s=store();s.rows[0].sold_quantity='1';wire.handler=s.handle;
 const value=proposal();const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:`sj:${id(20)}`,customerId:customer,coId:id(20),storage:()=>localStorage});
 mount(<COCorrectionDialog {...({operation:'post_sj',customerId:customer,source:value.source_context.payload,resumeContext:value.source_context,sender,current:()=>true,onAccepted:async()=>true,onClose:()=>{},returnFocus:null} as any)}/>);
 const reason=await screen.findByLabelText('Alasan perubahan') as HTMLTextAreaElement;
 expect(reason.value).toBe(value.source_context.payload.reason);expect(reason.disabled).toBe(true);
 expect(s.previewCount).toBe(0);expect(screen.queryByRole('button',{name:'Catat pengiriman'})).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('button',{name:'Catat pengiriman'});
 const p=wire.rpc.mock.calls.find(([n])=>n==='pilot_co_preview_v1')![1].p_payload;
 expect(p.reason).toBe(value.source_context.payload.reason);expect(p.completed_report_drafts).toEqual([]);expect(p.acknowledged_reopen_orders).toEqual([]);expect(s.commands).toHaveLength(0);
});

import COMonthlyReport from '../../../src/pages/athel/co/COMonthlyReport';
import CODetail from '../../../src/pages/athel/co/CODetail';
import COCustomerStock from '../../../src/pages/athel/co/COCustomerStock';
import { deliveryFixture } from '../report-ui-harness';
import { stockFixture } from '../stock-ui-harness';
const query=()=>`proposalDraft=${id(3)}&proposalMonth=${month}&proposalDraftVersion=1&proposalCustomerVersion=1`;
function checkedWire(v:any){const base=wire.handler;wire.handler=async(n:any,a:any)=>n==='pilot_co_report_source_proposal_v1'?{data:v,error:null}:base(n,a)}
test('source-bound monthly notice offers only checked exact owner destination, not context-link routing',async()=>{
 const s=store();s.metadata={source_context_link:{operation:'post_sj',target_id:null,draft_id:id(90),original_revision_id:null,expected_source_version:null,expected_co_version:'1',expected_customer_version:'1',expected_draft_version:'1'},source_context_fingerprint:fp};wire.handler=s.handle;
 const v=proposal('correct_return','replace');checkedWire(v);mount(<COMonthlyReport/>);
 const link=await screen.findByRole('link',{name:'Tinjau usulan sumber asli'});expect(link.getAttribute('href')).toBe(reads.coSourceProposalURL(reads.decodeCOReportSourceProposal(v,args)));expect(s.commands).toHaveLength(0);
});
function checkedImpactRoute(){
 const base=wire.handler,labels={sku:'SKU-PCS',productName:'Product PCS',coNumber:'CO-Original-91',sjNumber:'SJ-original-source',picName:'Original PIC'};
 const rows:any={reopen:[91,92].map(n=>({co_id:id(n),expected_co_version:'2',remaining_quantity:'13',pending_quantity:'7',missing_month_count:'0',labels:{...labels,coNumber:`CO-Original-${n}`}})),stock:[{stock_key_id:id(1001),batch_id:id(70),before_quantity:'7',after_quantity:'6',labels}],credit:[{report_month:month,sales_person_id_at_creation:id(77),before_amount:'0',after_amount:'100',labels}]};
 wire.handler=async(n,a)=>{const r=await base(n,a);if(n==='pilot_co_preview_v1')for(const kind of Object.keys(rows))r.data.counts[kind]=String(rows[kind].length);if(n==='pilot_co_preview_labeled_impacts_v1'&&rows[a.p_kind]){r.data.total=String(rows[a.p_kind].length);r.data.rows=rows[a.p_kind]}return r};
}
async function inspectRouteLabels(){await screen.findByText('CO-Original-91 · versi 2');expect(screen.getByText('CO-Original-92 · versi 2')).toBeTruthy();expect((screen.getByRole('checkbox',{name:/Saya menyetujui pembukaan ulang tepat 2 CO/}) as HTMLInputElement).checked).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Stok (1)'}));await screen.findByText(/SKU-PCS.*SJ-original-source/);fireEvent.click(screen.getByRole('button',{name:'Kredit PIC (1)'}));await screen.findByText(/PIC asli Original PIC/)}
test.each([['post_sj',undefined],['correct_sj','replace'],['correct_sj','void']] as const)('delivery route mounts one existing owner and reviews retained %s %s without save',async(operation,action)=>{
 const s=deliveryFixture();const base=wire.handler,v:any=proposal(operation,action);v.owner.co_id=id(10);
 if(operation==='correct_sj')Object.assign(v.source_context.payload,{delivery_head_id:id(12),original_revision_id:id(13),expected_delivery_version:'2'});
 wire.handler=async(n,a)=>{
  if(n==='pilot_co_report_source_proposal_v1')return {data:v,error:null};
  if(n==='pilot_co_detail_section_v1'&&a.p_section==='sj_drafts')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',co_id:id(10),customer_id:customer,co_version:'1',customer_version:'1',section:a.p_section,parent_id:a.p_parent_id,page:1,page_size:100,total:'1',rows:[{id:id(90),co_id:id(10),customer_id:customer,mode:action==='replace'?'delivery_correction':'new_delivery',bound_delivery_head_id:action==='replace'?id(12):null,bound_delivery_revision_id:action==='replace'?id(13):null,bound_delivery_version:action==='replace'?'2':null,sj_number:'SJ-retained',sj_date:'2026-09-01',received_date:null,notes:null,draft_version:'1',bound_co_version:'1',bound_customer_version:'1',bindings_current:true,consumed:false,preparation_ready:true,line_count:'1',posted_delivery_head_id:null}]},error:null};
  if(n==='pilot_co_detail_section_v1'&&a.p_section==='sj_draft_lines')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',co_id:id(10),customer_id:customer,co_version:'1',customer_version:'1',section:a.p_section,parent_id:a.p_parent_id,draft_id:id(90),draft_version:'1',page:1,page_size:100,total:'1',rows:[{id:id(100),co_id:id(10),customer_id:customer,draft_id:id(90),co_line_id:id(100),stock_key_id:id(1001),display_sku:'SKU-1',product_name:'Item 1',quantity:'1',unit_price:'10000',source_available:true,source_issue:null}]},error:null};
  return base(n,a);
 };
 checkedImpactRoute();mount(<CODetail/>,`/athel/co/${id(10)}?${query()}`);
 const reason=await screen.findByLabelText('Alasan perubahan') as HTMLTextAreaElement;expect(reason.value).toBe(v.source_context.payload.reason);expect(screen.queryByRole('button',{name:'Simpan Draft SJ'})).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('region',{name:'Peninjauan dampak'});await inspectRouteLabels();
 const call=wire.rpc.mock.calls.find(([n])=>n==='pilot_co_preview_v1')![1];expect(call.p_operation).toBe(operation);expect(call.p_payload).toMatchObject(v.source_context.payload);expect(s.commands).toHaveLength(0);
});
test.each([['post_return',undefined],['correct_return','replace'],['correct_return','void']] as const)('stock route resumes exact %s %s without reselecting or saving return lines',async(operation,action)=>{
 const s=stockFixture(),v:any=proposal(operation,action);if(operation==='post_return'){s.draft=s.makeDraft([{batch_id:s.batches[0].id,quantity:2}]);v.source_context.payload.draft_id=id(20);}
 s.effective={...s.makeDraft([{batch_id:s.batches[0].id,quantity:1}]),lines:s.makeDraft([{batch_id:s.batches[0].id,quantity:1}]).lines.map((l:any)=>({...l,draft_id:null,revision_id:id(41)})),header:{...s.makeDraft([]).header,id:id(41),head_id:id(40),revision_id:id(41),head_version:'1',target_kind:'revision',draft_version:null,revision_no:'1',line_count:'1',is_void:false}};
 checkedWire(v);checkedImpactRoute();mount(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&${query()}`);
 const reason=await screen.findByLabelText('Alasan perubahan') as HTMLTextAreaElement;expect(reason.value).toBe(v.source_context.payload.reason);expect(screen.queryByLabelText('Jumlah retur SJ-1 Item 1')).toBeNull();expect(screen.queryByRole('button',{name:'Simpan Draft retur'})).toBeNull();expect(screen.queryByRole('button',{name:'Muat sumber retur terbaru'})).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('region',{name:'Peninjauan dampak'});await inspectRouteLabels();
 const p=wire.rpc.mock.calls.find(([n])=>n==='pilot_co_preview_v1')![1].p_payload;expect(p).toMatchObject(v.source_context.payload);await waitFor(()=>expect(wire.rpc.mock.calls.some(([n])=>n==='pilot_co_return_v1')).toBe(true));expect(screen.queryByRole('button',{name:'Muat sumber retur terbaru'})).toBeNull();expect(s.commands).toHaveLength(0);
});
test('primary monthly owner resumes exact retained report without legacy seeding or upload owner',async()=>{
 const s=store(),v:any=proposal('correct_report');v.owner.report_month=month;v.source_context.payload.draft_id=id(3);s.rows[0].sold_quantity='1';
 s.effective={...s.header(),id:id(40),draft_id:null,draft_version:null,status:'posted',report_head_id:id(40),revision_id:id(41),report_version:'1',eligible_set_fingerprint:null,source_context_fingerprint:null,source_context_link:null};wire.handler=s.handle;checkedWire(v);
 checkedImpactRoute();mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?${query()}`);
 expect((await screen.findByLabelText('Alasan perubahan') as HTMLTextAreaElement).value).toBe(v.source_context.payload.reason);expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(screen.queryByRole('button',{name:'Mulai Edit dari laporan tercatat'})).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('region',{name:'Peninjauan dampak'});await inspectRouteLabels();fireEvent.click(screen.getByRole('checkbox',{name:/Saya menyetujui pembukaan ulang tepat 2 CO/}));fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('button',{name:'Simpan perubahan'});expect(s.commands).toHaveLength(0);
});

test('new preview fingerprint mismatch refuses the original proposal instead of adopting a replacement identity',async()=>{
 const s=store();s.rows[0].sold_quantity='1';const value=proposal();value.source_context.source_context_fingerprint='f'.repeat(64);wire.handler=s.handle;
 const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:`sj:${id(20)}`,customerId:customer,coId:id(20),storage:()=>localStorage});
 mount(<COCorrectionDialog operation="post_sj" customerId={customer} source={value.source_context.payload} resumeContext={value.source_context as any} sender={sender} current={()=>true} onAccepted={async()=>true} onClose={()=>{}} returnFocus={null}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Tinjau semua dampak'}));await screen.findByText('Usulan sumber tidak tersedia: sidik sumber berubah.');expect(screen.queryByRole('button',{name:'Catat pengiriman'})).toBeNull();expect(s.commands).toHaveLength(0);
});
test('retained source reacquires exact reopen consent and refuses incomplete later periods',async()=>{
 const s=store();s.rows[0].sold_quantity='1';wire.handler=s.handle;const value=proposal();
 s.impacts.reopen=[{co_id:id(99),expected_co_version:'2',remaining_quantity:'0',pending_quantity:'1',missing_month_count:'0'}];
 const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:`sj:${id(20)}`,customerId:customer,coId:id(20),storage:()=>localStorage});
 mount(<COCorrectionDialog operation="post_sj" customerId={customer} source={value.source_context.payload} resumeContext={value.source_context as any} sender={sender} current={()=>true} onAccepted={async()=>true} onClose={()=>{}} returnFocus={null}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Tinjau semua dampak'}));const ack=await screen.findByRole('checkbox',{name:/Saya menyetujui pembukaan ulang tepat 1 CO/});expect((ack as HTMLInputElement).checked).toBe(false);expect(screen.queryByRole('button',{name:'Catat pengiriman'})).toBeNull();
 fireEvent.click(ack);expect(screen.queryByRole('button',{name:'Catat pengiriman'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('button',{name:'Catat pengiriman'});
 s.impacts.missing_month=[{report_month:'2026-10-01',reason:'missing',head_id:null,coverage_through_date:null}];fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('button',{name:'Lengkapi periode 2026-10'});expect(screen.queryByRole('button',{name:'Catat pengiriman'})).toBeNull();expect(s.commands).toHaveLength(0);
});
test.each(['stale','consumed','other-actor','unsupported'] as const)('checked unavailable %s proposal does not mount an alternate source owner',async kind=>{
 const s=store();wire.handler=async(n,a)=>n==='pilot_co_report_source_proposal_v1'?{data:null,error:{code:'PT409',message:`CO_SOURCE_PROPOSAL_UNAVAILABLE ${kind}`}}:s.handle(n,a);
 mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?${query()}`);
 await screen.findByText('Usulan sumber asli tidak tersedia. Tidak ada sumber pengganti yang dibuat.');expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(s.commands).toHaveLength(0);
});
test('tampered proposal URL cannot mount a sender or be decoded as authority',async()=>{
 const s=store();wire.handler=s.handle;mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?${query()}&proposalDraft=${id(99)}`);await screen.findByText(/source proposal URL/);expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_source_proposal_v1')).toHaveLength(0);expect(s.commands).toHaveLength(0);
});
test('in-flight checked response after authority loss cannot reveal retained core',async()=>{
 const s=store(),value:any=proposal('correct_report');value.owner.report_month=month;let resolve!:(v:any)=>void;
 wire.handler=async(n,a)=>n==='pilot_co_report_source_proposal_v1'?new Promise(r=>resolve=r):s.handle(n,a);
 const {client}=mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?${query()}`);await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 wire.active=false;await import('@testing-library/react').then(async({act})=>{await act(async()=>{resolve({data:value,error:null});await client.invalidateQueries()})});
 expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(s.commands).toHaveLength(0);
});

test('resumed post_return uses the original return sender, verifies consumed draft/result and sends no replacement',async()=>{
 const s=stockFixture(),v:any=proposal('post_return');s.draft=s.makeDraft([{batch_id:s.batches[0].id,quantity:2}]);v.source_context.payload.draft_id=id(20);checkedWire(v);
 const {router}=mount(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&${query()}`);
 const review=await screen.findByRole('button',{name:'Tinjau semua dampak'});await waitFor(()=>expect(review.matches(':disabled')).toBe(false));fireEvent.click(review);fireEvent.click(await screen.findByRole('button',{name:'Terapkan perubahan'}));
 await waitFor(()=>expect(router.state.location.search).toBe(`?customer=${customer}`));
 expect(s.commands).toEqual([{op:'post_return',payload:{...v.source_context.payload,completed_report_drafts:[],acknowledged_reopen_orders:[],preview_fingerprint:'b'.repeat(64)}}]);
 expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_return_v1'&&a.p_view==='draft'&&a.p_target_id===id(20)&&a.p_expected_draft_version==='2')).toBe(true);expect(s.draft.header.consumed).toBe(true);expect(localStorage.length).toBe(0);
});
test('pending original report correction recovery takes precedence over a now-unavailable source proposal',async()=>{
 const s=store();wire.handler=async(n,a)=>n==='pilot_co_transaction_v1'?{data:null,error:{message:'Lost original response'}}:s.handle(n,a);
 const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:`report:${month}`,customerId:customer,storage:()=>localStorage});await expect(sender('correct_report',{report_head_id:id(4),original_revision_id:id(5),expected_report_version:'1',expected_customer_version:'1'})).rejects.toThrow('Lost original response');
 const key=localStorage.key(0)!,saved=localStorage.getItem(key)!;s.draft=false;s.effective={...s.header(),id:id(4),draft_id:null,draft_version:null,status:'posted',report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null};wire.handler=s.handle;
 mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?${query()}`);
 await screen.findByRole('region',{name:'Pemulihan koreksi laporan'});expect(await screen.findByRole('button',{name:'Pulihkan hasil penyimpanan'})).toBeTruthy();expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_source_proposal_v1')).toHaveLength(0);expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(localStorage.getItem(key)).toBe(saved);
});
test('import-origin primary without original immutable import binding is honestly unavailable, never re-prepared',async()=>{
 const s=store();wire.handler=async(n,a)=>n==='pilot_co_report_source_proposal_v1'?{data:null,error:{code:'PT409',message:'CO_SOURCE_PROPOSAL_UNAVAILABLE'}}:s.handle(n,a);
 mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?${query()}`);await screen.findByText(/Usulan impor yang memerlukan ikatan pencatatan impor asli tidak dapat dilanjutkan dari sini/);expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(wire.rpc.mock.calls.some(([n])=>n==='pilot_co_import_prepare_v1')).toBe(false);expect(s.commands).toHaveLength(0);
});
test('resumed ordinary report correction exits only after existing canonical verifier accepts its result',async()=>{
 const s=store(),v:any=proposal('correct_report');v.owner.report_month=month;Object.assign(v.source_context.payload,{draft_id:id(3),report_head_id:id(4),original_revision_id:id(5)});s.rows[0].sold_quantity='1';s.effective={...s.header(),id:id(4),draft_id:null,draft_version:null,status:'posted',report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,source_context_fingerprint:null,source_context_link:null};wire.handler=s.handle;checkedWire(v);
 const {router}=mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?${query()}`);const review=await screen.findByRole('button',{name:'Tinjau semua dampak'});await waitFor(()=>expect(review.matches(':disabled')).toBe(false));fireEvent.click(review);fireEvent.click(await screen.findByRole('button',{name:'Simpan perubahan'}));await waitFor(()=>expect(router.state.location.search).toBe(''));expect(s.commands.map((c:any)=>c.op)).toEqual(['correct_report']);
});
test('background checked-read refresh does not remount the source owner or erase a newly reviewed preview',async()=>{
 const s=stockFixture(),v:any=proposal('post_return');s.draft=s.makeDraft([{batch_id:s.batches[0].id,quantity:2}]);v.source_context.payload.draft_id=id(20);checkedWire(v);
 const {client}=mount(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&${query()}`);const review=await screen.findByRole('button',{name:'Tinjau semua dampak'});await waitFor(()=>expect(review.matches(':disabled')).toBe(false));fireEvent.click(review);await screen.findByRole('button',{name:'Terapkan perubahan'});
 const base=wire.handler;let resolve!:(v:any)=>void;wire.handler=async(n,a)=>n==='pilot_co_report_source_proposal_v1'?new Promise(r=>resolve=r):base(n,a);
 const {act}=await import('@testing-library/react');let refreshed!:Promise<void>;await act(async()=>{refreshed=client.invalidateQueries({predicate:q=>q.queryKey[4]==='source-proposal'});await Promise.resolve()});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Terapkan perubahan'}).matches(':disabled')).toBe(true));
 await act(async()=>{resolve({data:v,error:null});await refreshed});await waitFor(()=>expect(screen.getByRole('button',{name:'Terapkan perubahan'}).matches(':disabled')).toBe(false));expect(s.report.previewCount).toBe(1);expect(s.commands).toHaveLength(0);
});
test('delivery original correction recovery remains reachable before an unavailable proposal without reconstructing its old source',async()=>{
 const s=deliveryFixture(),base=wire.handler,receipt={id:id(12),operation:'correct_sj',version:'2',customer_id:customer,customer_version:'1'};
 wire.handler=async(n,a)=>n==='pilot_co_transaction_v1'?{data:null,error:{message:'Lost correction response'}}:base(n,a);
 const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:`sj:${id(10)}`,customerId:customer,coId:id(10),storage:()=>localStorage});await expect(sender('correct_sj',{delivery_head_id:id(12),original_revision_id:id(13),expected_delivery_version:'1',expected_co_version:'1',expected_customer_version:'1',action:'void',reason:'original'})).rejects.toThrow();
 const key=localStorage.key(0)!,original=JSON.parse(localStorage.getItem(key)!).id;
 wire.handler=async(n,a)=>n==='pilot_reconcile_co_v1'?{data:{status:'committed',operation:'correct_sj',receipt},error:null}:base(n,a);
 const {router}=mount(<CODetail/>,`/athel/co/${id(10)}?${query()}`);fireEvent.click(await screen.findByRole('button',{name:'Pulihkan hasil penyimpanan'}));fireEvent.click(await screen.findByRole('button',{name:'Lihat hasil tersimpan'}));await waitFor(()=>expect(localStorage.getItem(key)).toBeNull());await waitFor(()=>expect(router.state.location.search).toBe(''));
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_source_proposal_v1')).toHaveLength(0);expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_reconcile_co_v1').every(([,a])=>a.p_request_id===original)).toBe(true);expect(s.commands).toHaveLength(0);
});

test.each(['proposal','stock'] as const)('R1 dirty retained period survives %s 08006 and keeps guarded exit without writes',async gate=>{
 const s=stockFixture(),v:any=proposal('post_return');s.draft=s.makeDraft([{batch_id:s.batches[0].id,quantity:2}]);v.source_context.payload.draft_id=id(20);s.report.impacts.missing_month=[{report_month:month,reason:'missing',head_id:null,coverage_through_date:null}];checkedWire(v);
 const {client}=mount(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&${query()}`);const inspect=await screen.findByRole('button',{name:'Tinjau semua dampak'});await waitFor(()=>expect(inspect.matches(':disabled')).toBe(false));fireEvent.click(inspect);fireEvent.click(await screen.findByRole('button',{name:'Lengkapi periode 2026-09'}));const prepare=await screen.findByRole('button',{name:'Perbarui periode terhadap sumber usulan'});await waitFor(()=>expect(prepare.matches(':disabled')).toBe(false));fireEvent.click(prepare);
 const input=await screen.findByLabelText('Terjual Item 1');fireEvent.change(input,{target:{value:'7'}});const count=s.report.commands.length,base=wire.handler;
 wire.handler=async(n,a)=>(gate==='proposal'?n==='pilot_co_report_source_proposal_v1':n==='pilot_co_customer_stock_v1')?{data:null,error:{code:'08006',message:`${gate} read offline`}}:base(n,a);
 const {act}=await import('@testing-library/react');await act(()=>client.invalidateQueries({predicate:q=>q.queryKey[4]===(gate==='proposal'?'source-proposal':'source-return-current')}));await screen.findAllByText(`${gate} read offline`);
 expect(screen.getByLabelText('Terjual Item 1')).toBe(input);expect((input as HTMLInputElement).value).toBe('7');expect(screen.getByRole('button',{name:'Lanjutkan peninjauan periode'}).matches(':disabled')).toBe(true);expect(s.report.commands).toHaveLength(count);fireEvent.click(screen.getByRole('button',{name:'Kembali ke sumber'}));await screen.findByRole('button',{name:'Tetap mengedit'});expect(screen.getByLabelText('Terjual Item 1')).toBe(input);fireEvent.click(screen.getByRole('button',{name:'Tetap mengedit'}));wire.handler=base;fireEvent.click(screen.getAllByRole('button',{name:'Coba lagi'})[0]);await waitFor(()=>expect(screen.getByRole('button',{name:'Lanjutkan peninjauan periode'}).matches(':disabled')).toBe(false));expect(screen.getByLabelText('Terjual Item 1')).toBe(input);expect((input as HTMLInputElement).value).toBe('7');expect(s.commands).toHaveLength(0);
});
test.each(['report','return'] as const)('R2 exact %s proposal reaches one owner under real root StrictMode',async kind=>{
 let v:any;if(kind==='report'){const s=store();v=proposal('correct_report');v.owner.report_month=month;v.source_context.payload.draft_id=id(3);s.rows[0].sold_quantity='1';s.effective={...s.header(),id:id(40),draft_id:null,draft_version:null,status:'posted',report_head_id:id(40),revision_id:id(41),report_version:'1',eligible_set_fingerprint:null};wire.handler=s.handle;checkedWire(v);mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?${query()}`,true)}else{const s=stockFixture();v=proposal('post_return');v.source_context.payload.draft_id=id(20);s.draft=s.makeDraft([{batch_id:s.batches[0].id,quantity:2}]);checkedWire(v);mount(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&${query()}`,true)}
 expect((await screen.findByLabelText('Alasan perubahan') as HTMLTextAreaElement).value).toBe(v.source_context.payload.reason);await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(false));expect(screen.getAllByLabelText('Alasan perubahan')).toHaveLength(1);expect(wire.rpc.mock.calls.some(([n])=>n==='pilot_co_transaction_v1')).toBe(false);
});
test.each(['error','drift'] as const)('R1 delivery parent %s preserves the same source owner and freezes review',async mode=>{
 const s=deliveryFixture(),v:any=proposal('correct_sj','void');v.owner.co_id=id(10);Object.assign(v.source_context.payload,{delivery_head_id:id(12),original_revision_id:id(13),expected_delivery_version:'2'});checkedWire(v);
 const {client}=mount(<CODetail/>,`/athel/co/${id(10)}?${query()}`);const reason=await screen.findByLabelText('Alasan perubahan'),review=screen.getByRole('button',{name:'Tinjau semua dampak'});await waitFor(()=>expect(review.matches(':disabled')).toBe(false));const base=wire.handler;
 wire.handler=async(n,a)=>{if(n==='pilot_co_detail_v1'){if(mode==='error')return {data:null,error:{code:'08006',message:'parent delivery offline'}};const r=await base(n,a);return {...r,data:{...r.data,co:{...r.data.co,customer_version:'2'}}}}return base(n,a)};
 const {act}=await import('@testing-library/react');await act(()=>client.invalidateQueries({predicate:q=>q.queryKey[4]==='detail'}));await waitFor(()=>expect(review.matches(':disabled')).toBe(true));expect(screen.getByLabelText('Alasan perubahan')).toBe(reason);expect(s.commands).toHaveLength(0);
});
test.each(['stale-proposal','stock-customer-drift'] as const)('R1 lost final response retains original UUID recovery after %s',async gate=>{
 const s=stockFixture(),v:any=proposal('post_return');s.draft=s.makeDraft([{batch_id:s.batches[0].id,quantity:2}]);v.source_context.payload.draft_id=id(20);checkedWire(v);const base=wire.handler;
 wire.handler=async(n,a)=>{const r=await base(n,a);if(n==='pilot_co_transaction_v1'&&a.p_operation==='post_return')return {data:null,error:{code:'08006',message:'Lost resumed final response'}};return r};
 const {client,router}=mount(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&${query()}`);const reason=await screen.findByLabelText('Alasan perubahan'),review=screen.getByRole('button',{name:'Tinjau semua dampak'});await waitFor(()=>expect(review.matches(':disabled')).toBe(false));fireEvent.click(review);fireEvent.click(await screen.findByRole('button',{name:'Terapkan perubahan'}));await screen.findAllByText('Lost resumed final response');
 const key=localStorage.key(0)!,saved=JSON.parse(localStorage.getItem(key)!),after=wire.handler;let canonicalAvailable=false;wire.handler=async(n,a)=>{if(!canonicalAvailable&&n==='pilot_co_return_v1'&&a.p_view==='effective')return {data:null,error:{code:'08006',message:'Canonical return offline'}};return gate==='stale-proposal'&&n==='pilot_co_report_source_proposal_v1'?{data:null,error:{code:'PT409',message:'Consumed retained proposal'}}:after(n,a)};
 const {act}=await import('@testing-library/react');await act(()=>client.invalidateQueries({predicate:q=>q.queryKey[4]===(gate==='stale-proposal'?'source-proposal':'source-return-current')}));expect(screen.getByLabelText('Alasan perubahan')).toBe(reason);expect(JSON.parse(localStorage.getItem(key)!).id).toBe(saved.id);
 fireEvent.click(screen.getAllByRole('button',{name:'Pulihkan hasil penyimpanan'})[0]);fireEvent.click(await screen.findByRole('button',{name:'Lihat hasil tersimpan'}));fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan'}));await screen.findAllByText('Canonical return offline');expect(JSON.parse(localStorage.getItem(key)!).id).toBe(saved.id);expect(s.commands.map((c:any)=>c.op)).toEqual(['post_return']);canonicalAvailable=true;fireEvent.click(await screen.findByRole('button',{name:'Buka hasil retur tersimpan'}));await waitFor(()=>expect(localStorage.getItem(key)).toBeNull());await waitFor(()=>expect(router.state.location.search).toBe(`?customer=${customer}`));expect(s.commands.map((c:any)=>c.op)).toEqual(['post_return']);expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_reconcile_co_v1').every(([,a])=>a.p_request_id===saved.id)).toBe(true);
});
test('R2 pre-existing original monthly recovery remains first under root StrictMode',async()=>{
 const s=store();wire.handler=async(n,a)=>n==='pilot_co_transaction_v1'?{data:null,error:{message:'Lost strict original'}}:s.handle(n,a);const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:`report:${month}`,customerId:customer,storage:()=>localStorage});await expect(sender('correct_report',{report_head_id:id(4)})).rejects.toThrow();wire.handler=s.handle;
 mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?${query()}`,true);await screen.findByRole('region',{name:'Pemulihan koreksi laporan'});expect(screen.getAllByRole('button',{name:'Pulihkan hasil penyimpanan'})).toHaveLength(1);expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_source_proposal_v1')).toHaveLength(0);
});
test.each(['newer-core','authority-loss'] as const)('R1 mounted owner never adopts %s from proposal refetch',async mode=>{
 const s=stockFixture(),v:any=proposal('post_return');s.draft=s.makeDraft([{batch_id:s.batches[0].id,quantity:2}]);v.source_context.payload.draft_id=id(20);checkedWire(v);const {client}=mount(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&${query()}`);const reason=await screen.findByLabelText('Alasan perubahan'),base=wire.handler;
 wire.handler=async(n,a)=>{if(n==='pilot_co_report_source_proposal_v1'){if(mode==='authority-loss')return {data:null,error:{code:'42501',message:'Source access denied'}};const changed=structuredClone(v);changed.source_context.payload.reason='Different newer proposal';changed.source_context.source_context_fingerprint='f'.repeat(64);return {data:changed,error:null}}return base(n,a)};
 const {act}=await import('@testing-library/react');await act(()=>client.invalidateQueries({predicate:q=>q.queryKey[4]==='source-proposal'}));if(mode==='authority-loss'){await waitFor(()=>expect(screen.queryByLabelText('Alasan perubahan')).toBeNull())}else{await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(true));expect(screen.getByLabelText('Alasan perubahan')).toBe(reason);expect((reason as HTMLTextAreaElement).value).toBe(v.source_context.payload.reason)}expect(s.commands).toHaveLength(0);
});
test('R1-F1 abandoned original return recovery keeps all new actions frozen during failed outer stock freshness',async()=>{
 const s=stockFixture(),base=wire.handler;wire.handler=async(n,a)=>n==='pilot_co_transaction_v1'?{data:null,error:{code:'08006',message:'Original return request lost'}}:base(n,a);
 const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:'return',customerId:customer,storage:()=>localStorage,retainCommitted:true});await expect(sender('save_return_draft',{customer_id:customer,expected_customer_version:'1',return_date:'2026-09-02',reference:'original',lines:[{batch_id:s.batches[0].id,quantity:1}]})).rejects.toThrow();
 wire.handler=async(n,a)=>n==='pilot_reconcile_co_v1'?{data:{status:'abandoned'},error:null}:base(n,a);const {client}=mount(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&${query()}`);fireEvent.click(await screen.findByRole('button',{name:'Pulihkan hasil penyimpanan'}));await screen.findByText('Pemeriksaan selesai. Permintaan sebelumnya tidak tersimpan.');await waitFor(()=>expect(localStorage.length).toBe(0));const {act}=await import('@testing-library/react');await act(()=>client.invalidateQueries({predicate:q=>q.queryKey[4]==='return-preparation'}));
 const input=await screen.findByLabelText('Jumlah retur SJ-1 Item 1');await waitFor(()=>expect(input.matches(':disabled')).toBe(false));fireEvent.change(input,{target:{value:'1'}});fireEvent.change(screen.getByLabelText('Referensi retur'),{target:{value:'retained unsubmitted'}});
 const save=screen.getByRole('button',{name:'Simpan Draft retur'}),refresh=screen.getByRole('button',{name:'Muat sumber retur terbaru'});let resolve!:(v:any)=>void;const after=wire.handler;wire.handler=async(n,a)=>n==='pilot_co_customer_stock_v1'?new Promise(r=>resolve=r):after(n,a);
 let pending!:Promise<void>;await act(async()=>{pending=client.invalidateQueries({predicate:q=>q.queryKey[4]==='source-return-current'});await Promise.resolve()});await waitFor(()=>expect(save.matches(':disabled')).toBe(true));expect(refresh.matches(':disabled')).toBe(true);expect(input.matches(':disabled')).toBe(true);
 await act(async()=>{resolve({data:null,error:{code:'08006',message:'Abandoned owner stock offline'}});await pending});await screen.findByText('Abandoned owner stock offline');expect(screen.getByLabelText('Jumlah retur SJ-1 Item 1')).toBe(input);expect((input as HTMLInputElement).value).toBe('1');expect(save.matches(':disabled')).toBe(true);fireEvent.click(save);fireEvent.click(refresh);expect(s.commands).toHaveLength(0);expect(screen.getByRole('button',{name:'Tinjau / post retur'}).matches(':disabled')).toBe(true);expect(screen.getByRole('button',{name:'Tutup retur'}).matches(':disabled')).toBe(false);
});
test('R1-F1 pending source-refresh discard rechecks the latest external freshness gate before any new read',async()=>{
 const {useState}=await import('react'),{default:ReturnDialog}=await import('../../../src/components/co/COReturnDialog');const s=stockFixture();s.draft=s.makeDraft([{batch_id:s.batches[0].id,quantity:1}]);
 function Owner(){const [blocked,setBlocked]=useState(false);return <><button onClick={()=>setBlocked(true)}>External stock became unavailable</button><ReturnDialog customerId={customer} customerVersion="1" selection={{view:'draft',id:id(20),draftVersion:'1'}} resumeBlocked={blocked} returnFocus={null} onClose={()=>{}}/></>}
 mount(<Owner/>);const review=await screen.findByRole('button',{name:'Tinjau / post retur'});await waitFor(()=>expect(review.matches(':disabled')).toBe(false));fireEvent.click(review);fireEvent.change(await screen.findByLabelText('Alasan perubahan'),{target:{value:'Keep this review'}});fireEvent.click(screen.getByRole('button',{name:'Muat sumber retur terbaru'}));await screen.findByRole('button',{name:'Buang perubahan'});const count=wire.rpc.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'External stock became unavailable'}));fireEvent.click(screen.getByRole('button',{name:'Buang perubahan'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'Tetap mengedit'})).toBeNull());expect((screen.getByLabelText('Alasan perubahan') as HTMLTextAreaElement).value).toBe('Keep this review');expect(wire.rpc.mock.calls.slice(count).some(([n])=>n==='pilot_co_customer_stock_v1'||n==='pilot_co_customer_batches_v1')).toBe(false);expect(s.commands).toHaveLength(0);
});
