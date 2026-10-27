import { expect, test } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { store, mount, wire, id, customer, month, row } from '../report-ui-harness';
import COMonthlyReport from '../../../src/pages/athel/co/COMonthlyReport';

function legacy(count=1,pending=false){
 const s=store(count), effectiveRows=Array.from({length:count},(_,i)=>row(i+1,i===1?'0':'7'));
 s.rows=effectiveRows.map(r=>({...r,sold_quantity:'99'}));s.draft=pending;
 s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'3',eligible_set_fingerprint:null,report_reference:'EFFECTIVE',notes:'Effective metadata',sold_quantity:String(7*(count-(count>1?1:0))),revenue:'700'};
 const base=s.handle;let afterConfirm:(()=>void)|null=null;
 wire.handler=async(n,a)=>{
  if(n==='pilot_co_report_import_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,revision_id:id(5),report_head_id:id(4),effective_revision_id:id(5),manifest:null,unit_declarations:{},source_amount:null,currency:null,source_filename:null,created_at:'2026-10-09T00:00:00Z',created_by:id(1),author_name:null,reason:null,report_version:'3',previous_revision_id:null},error:null};
  if(n==='pilot_co_report_allocations_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:s.cv,report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};
  if(n==='pilot_co_report_v1'&&afterConfirm){afterConfirm();afterConfirm=null}
  if(n==='pilot_co_transaction_v1'&&a.p_payload.seed_effective_revision_id){
   s.rows=[...effectiveRows.map(r=>({...r})),row(count+1,null)];s.metadata={report_reference:'EFFECTIVE',notes:'Effective metadata'};
  }
  const result=await base(n,a);
  if(n==='pilot_co_report_rows_v1'&&a.p_view!=='draft'){result.data.context_issue=null;result.data.source_context_link=null;result.data.source_context_fingerprint=null}
  if(n==='pilot_co_report_rows_v1'&&a.p_view==='revision'){
   result.data.rows=effectiveRows.slice((a.p_page-1)*100,a.p_page*100);result.data.total=String(count);
  }
  return result;
 };
 return {s,effectiveRows,changeOnNextRead(fn:()=>void){afterConfirm=fn}};
}
async function open(){mount(<COMonthlyReport/>);fireEvent.click(await screen.findByRole('button',{name:'Edit'}));await screen.findByText('Nilai awal dari laporan tercatat (ledger historis); sumber asli tidak tersedia');}
async function start(){fireEvent.click(await screen.findByRole('button',{name:'Mulai Edit dari laporan tercatat'}))}

test('no-manifest Edit reads every canonical revision page and seeds nonzero, explicit zero, and null new eligibility without source inventions',async()=>{
 const {s}=legacy(101);await open();await start();
 expect((await screen.findByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('7');
 expect((screen.getByLabelText('Terjual Item 2') as HTMLInputElement).value).toBe('0');
 expect((screen.getByLabelText('Referensi laporan') as HTMLInputElement).value).toBe('EFFECTIVE');
 fireEvent.click(screen.getAllByRole('button',{name:'Berikutnya'}).at(-1)!);
 expect((await screen.findByLabelText('Terjual Item 101') as HTMLInputElement).value).toBe('7');
 expect((screen.getByLabelText('Terjual Item 102') as HTMLInputElement).value).toBe('');
 expect(wire.rpc.mock.calls.filter(([n,a])=>n==='pilot_co_report_rows_v1'&&a.p_view==='revision').some(([,a])=>a.p_page===2)).toBe(true);
 const seed=s.commands[0];expect(seed.op).toBe('save_report_draft');expect(seed.payload.seed_effective_revision_id).toBe(id(5));expect(seed.payload.source_context).toBeUndefined();expect(seed.payload.lines).toBeUndefined();
 expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(screen.queryByRole('button',{name:/Simpan draf/i})).toBeNull();expect(screen.getByText(/Satuan, harga, dan nilai sumber asli tidak tersedia/)).toBeTruthy();
},15000);

test('pending replacement is explicit; declining sends nothing and stale pending values never become initial values',async()=>{
 const {s}=legacy(2,true);await open();await start();expect(s.commands).toHaveLength(0);
 fireEvent.click(await screen.findByRole('button',{name:'Batal penggantian'}));expect(s.commands).toHaveLength(0);
 await start();fireEvent.click(await screen.findByRole('button',{name:'Ganti isian tersimpan'}));
 expect((await screen.findByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('7');expect(s.commands[0].payload.expected_draft_version).toBe('1');
});

test.each(['draft','customer','effective'] as const)('replacement consent never adopts a changed %s baseline',async(kind)=>{
 const {s,changeOnNextRead}=legacy(1,true);await open();await start();
 changeOnNextRead(()=>{if(kind==='draft')s.version='2';if(kind==='customer'){s.cv='2';s.effective.customer_version='2'}if(kind==='effective')s.effective={...s.effective,revision_id:id(9)}});
 fireEvent.click(await screen.findByRole('button',{name:'Ganti isian tersimpan'}));
 await screen.findByText(/Dasar Edit berubah/);expect(s.commands).toHaveLength(0);expect(s.rows[0].sold_quantity).toBe('99');
});

test('legacy correction requires complete input, reason and existing whole-impact preview; failed edit preserves effective revision',async()=>{
 const {s}=legacy();await open();await start();await screen.findByLabelText('Terjual Item 1');
 fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));await screen.findByText(/Lengkapi semua baris/);expect(s.previewCount).toBe(0);
 fireEvent.change(screen.getByLabelText('Terjual Item 2'),{target:{value:'0'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));
 const reason=await screen.findByLabelText('Alasan perubahan');expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull();
 fireEvent.change(reason,{target:{value:'Koreksi ledger'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));
 const apply=await screen.findByRole('button',{name:'Simpan perubahan'});
 const preview=wire.rpc.mock.calls.find(([n])=>n==='pilot_co_preview_v1')![1];expect(preview.p_operation).toBe('correct_report');expect(preview.p_payload).toMatchObject({report_head_id:id(4),original_revision_id:id(5),expected_report_version:'3',reason:'Koreksi ledger'});
 s.fail=async(n:string,a:any)=>n==='pilot_co_transaction_v1'&&a.p_operation==='correct_report'?{data:null,error:{code:'PT409',message:'Late conflict'}}:null;
 fireEvent.click(apply);await screen.findByText('CO berubah. Muat ulang dan periksa perubahan sebelum melanjutkan.');expect(s.effective.revision_id).toBe(id(5));
});

test('account switch removes owned legacy inputs and dispatches no correction',async()=>{
 const {s}=legacy();await open();await start();await screen.findByLabelText('Terjual Item 1');wire.actor=false;
 await act(async()=>{window.dispatchEvent(new Event('focus'))});
 // Trigger the same mounted auth consumer through a query refresh.
 wire.active=false;fireEvent.change(screen.getByLabelText('Terjual Item 1'),{target:{value:'8'}});
 await waitFor(()=>expect(screen.queryByLabelText('Terjual Item 1')).toBeNull());expect(s.commands.every((c:any)=>c.op==='save_report_draft')).toBe(true);
});

test.each(['revision','count','duplicate','version'] as const)('legacy Edit refuses changed %s identity on later canonical pages before sending seed',async(kind)=>{
 const {s,effectiveRows}=legacy(101);const base=wire.handler;
 wire.handler=async(n:any,a:any)=>{const result=await base(n,a);if(n==='pilot_co_report_rows_v1'&&a.p_view==='revision'&&a.p_page===2){if(kind==='revision')result.data.revision_id=id(99);if(kind==='count')result.data.total='102';if(kind==='duplicate')result.data.rows=[effectiveRows[0]];if(kind==='version')result.data.customer_version='2'}return result};
 await open();await waitFor(()=>expect((screen.getByRole('button',{name:'Mulai Edit dari laporan tercatat'}) as HTMLButtonElement).disabled).toBe(true));
 await waitFor(()=>expect(screen.getAllByText(/Data CO|Baris laporan/).length).toBeGreaterThan(0));expect(s.commands).toHaveLength(0);expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();
});

test('legacy owner requires fresh exact reopen consent and routes all downstream periods through existing correction review',async()=>{
 const {s}=legacy();await open();await start();await screen.findByLabelText('Terjual Item 1');
 fireEvent.change(screen.getByLabelText('Terjual Item 2'),{target:{value:'0'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));
 fireEvent.change(await screen.findByLabelText('Alasan perubahan'),{target:{value:'Correct historic values'}});
 s.impacts.reopen=[91,92].map(n=>({co_id:id(n),expected_co_version:'2',remaining_quantity:'0',pending_quantity:'1',missing_month_count:'0',labels:{sku:null,productName:null,coNumber:`CO-legacy-${n}`,sjNumber:null,picName:null}}));
 fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('checkbox',{name:/Saya menyetujui pembukaan ulang tepat 2 CO/});expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull();expect(screen.getByText('CO-legacy-91 · versi 2')).toBeTruthy();expect(screen.getByText('CO-legacy-92 · versi 2')).toBeTruthy();
 fireEvent.click(screen.getByRole('checkbox',{name:/Saya menyetujui pembukaan ulang tepat 2 CO/}));expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('button',{name:'Simpan perubahan'});
 const previews=wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_preview_v1');expect(previews).toHaveLength(2);expect(previews[1][1].p_payload.acknowledged_reopen_orders).toEqual([{co_id:id(91),expected_co_version:'2'},{co_id:id(92),expected_co_version:'2'}]);
 // A newly required later period removes the final action even after reopening consent.
 s.impacts.missing_month=[{report_month:'2026-10-01',reason:'missing',head_id:null,coverage_through_date:null}];
 fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));await screen.findByRole('button',{name:'Lengkapi periode 2026-10'});expect(screen.queryByRole('button',{name:'Simpan perubahan'})).toBeNull();
});

test('confirmed legacy replacement can refresh stale pending eligibility without adopting pending quantities',async()=>{
 const {s}=legacy(1,true);s.metadata.context_issue='CO_ELIGIBLE_SET_STALE';await open();await start();
 fireEvent.click(await screen.findByRole('button',{name:'Ganti isian tersimpan'}));
 expect((await screen.findByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('7');expect(s.commands[0].payload.expected_draft_version).toBe('1');
});
