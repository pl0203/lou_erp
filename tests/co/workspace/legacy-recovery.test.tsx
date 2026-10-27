import {input} from '../import/reviewFixture';
import { expect, test } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { store, mount, wire, id, customer, month, hash } from '../report-ui-harness';
import COMonthlyReport from '../../../src/pages/athel/co/COMonthlyReport';

function fixture(){
 const s=store();s.rows[0].sold_quantity='7';s.draft=false;
 s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'3',eligible_set_fingerprint:null,revenue:'700'};
 const base=s.handle;let recoveryPatch:Record<string,unknown>|null=null;
 wire.handler=async(n,a)=>{
  if(n==='pilot_co_report_import_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,revision_id:a.p_revision_id,report_head_id:id(4),effective_revision_id:s.effective.revision_id,manifest:null,unit_declarations:{},source_amount:null,currency:null,source_filename:null,created_at:'2026-10-09T00:00:00Z',created_by:id(1),author_name:'Operator',reason:'Ledger correction',report_version:String(Number(a.p_revision_id.slice(-12))-2),previous_revision_id:null},error:null};
  if(n==='pilot_co_report_history_v1'){
   const rows=Array.from({length:Number(s.effective.report_version)-2},(_,i)=>Number(s.effective.report_version)-i).map(v=>({revision_id:id(v+2),report_version:String(v),created_at:'2026-10-09T00:00:00Z',created_by:id(1),author_name:'Operator',reason:'Correction',is_effective:String(v)===s.effective.report_version}));
   return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,page:a.p_page,page_size:a.p_page_size,total:String(rows.length),rows:rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size)},error:null};
  }
  if(n==='pilot_co_report_allocations_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:s.cv,report_month:month,revision_id:a.p_revision_id,generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};
  const result=await base(n,a);
  if(n==='pilot_co_transaction_v1'&&a.p_operation==='correct_report'){
   s.effective={...s.effective,revision_id:id(6),report_version:'4'};s.receipt={...s.receipt,version:'4'};
   return {data:null,error:{message:'Lost final correction response'}};
  }
  if(n==='pilot_reconcile_co_v1'&&recoveryPatch)result.data.receipt={...result.data.receipt,...recoveryPatch};
  if(n==='pilot_co_report_rows_v1'&&a.p_view==='revision')result.data.revision_id=a.p_revision_id;
  return result;
 };
 return {s,patch(p:Record<string,unknown>){recoveryPatch=p}};
}
async function commitLost(mounted=false,proposal=false){
 const f=fixture();
 if(proposal){f.s.draft=true;const base=wire.handler;wire.handler=async(n,a)=>n==='pilot_co_report_source_proposal_v1'?{data:{version:'1',customer_id:customer,report_month:month,draft_id:id(3),draft_version:'1',customer_version:'1',source_context:{operation:'correct_report',payload:{draft_id:id(3),expected_draft_version:'1',expected_customer_version:'1',eligible_set_fingerprint:hash,report_head_id:id(4),original_revision_id:id(5),expected_report_version:'3',reason:'Legacy correction'},source_context_fingerprint:'c'.repeat(64)},owner:{kind:'report',co_id:null,report_month:month}},error:null}:base(n,a);mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?proposalDraft=${id(3)}&proposalMonth=${month}&proposalDraftVersion=1&proposalCustomerVersion=1`);await screen.findByLabelText('Alasan perubahan');}
 else {mount(<COMonthlyReport/>);fireEvent.click(await screen.findByRole('button',{name:'Edit'}));fireEvent.click(await screen.findByRole('button',{name:'Mulai Edit dari laporan tercatat'}));
 await screen.findByLabelText('Terjual Item 1');fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));fireEvent.change(await screen.findByLabelText('Alasan perubahan'),{target:{value:'Legacy correction'}});}await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));fireEvent.click(await screen.findByRole('button',{name:'Simpan perubahan'}));
 await screen.findByText('Lost final correction response');const key=localStorage.key(0)!,saved=localStorage.getItem(key)!;expect(JSON.parse(saved).binding.operation).toBe('correct_report');expect(f.s.effective.report_version).toBe('4');
 const recoveryStart=wire.rpc.mock.calls.length;if(mounted)return {...f,key,saved,recoveryStart};cleanup();mount(<COMonthlyReport/>);fireEvent.click(await screen.findByRole('button',{name:'Periksa hasil pencatatan'}));return {...f,key,saved,recoveryStart};
}
async function recover(){fireEvent.click((await screen.findAllByRole('button',{name:'Pulihkan hasil penyimpanan'})).at(-1)!);fireEvent.click((await screen.findAllByRole('button',{name:'Lihat hasil tersimpan'})).at(-1)!)}

test('lost legacy final correction remount reconciles the same UUID, accepts canonical original, and restores Edit without another command',async()=>{
 const {s,key,saved,recoveryStart}=await commitLost();const count=s.commands.length;await recover();await screen.findByRole('button',{name:'Edit'});
 expect(localStorage.getItem(key)).toBeNull();expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(s.commands).toHaveLength(count);expect(s.commands.filter((c:any)=>c.op==='correct_report')).toHaveLength(1);
 const original=JSON.parse(saved).id,reconciles=wire.rpc.mock.calls.slice(recoveryStart).filter(([n])=>n==='pilot_reconcile_co_v1');expect(reconciles.length).toBeGreaterThanOrEqual(2);expect(reconciles.every(([,a])=>a.p_request_id===original)).toBe(true);expect(wire.rpc.mock.calls.some(([n])=>n==='pilot_co_import_commit_v1')).toBe(false);
});

test.each(['head','customer','version','current-head'] as const)('ordinary legacy recovery refuses mismatched %s without clearing original identity',async kind=>{
 const {s,key,saved,patch}=await commitLost();if(kind==='head')patch({id:id(99)});if(kind==='customer')patch({customer_id:id(99)});if(kind==='version')patch({version:'99'});if(kind==='current-head')s.effective.report_head_id=id(99);
 fireEvent.click(await screen.findByRole('button',{name:'Pulihkan hasil penyimpanan'}));
 if(kind==='version'||kind==='current-head')fireEvent.click(await screen.findByRole('button',{name:'Lihat hasil tersimpan'}));
 await screen.findByText(kind==='head'||kind==='customer'?/recovery receipt/:/original correction current scope/);expect(JSON.parse(localStorage.getItem(key)!).id).toBe(JSON.parse(saved).id);expect(screen.queryByRole('button',{name:'Edit'})).toBeNull();expect(s.commands.filter((c:any)=>c.op==='correct_report')).toHaveLength(1);
});

test('changed current state requires explicit original-result acceptance and reacquires consent if the displayed state changes again',async()=>{
 const {s,key,saved}=await commitLost();s.cv='3';s.effective={...s.effective,customer_version:'3',revision_id:id(7),report_version:'5'};await recover();
 const ack=await screen.findByRole('checkbox',{name:'Saya memahami keadaan terkini dapat berbeda dari hasil asli'});const accept=screen.getByRole('button',{name:'Terima hasil koreksi asli'});expect((accept as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(ack);s.cv='4';s.effective={...s.effective,customer_version:'4',revision_id:id(8),report_version:'6'};fireEvent.click(accept);
 await waitFor(()=>expect((ack as HTMLInputElement).checked).toBe(false));expect(JSON.parse(localStorage.getItem(key)!).id).toBe(JSON.parse(saved).id);
 fireEvent.click(ack);fireEvent.click(accept);await screen.findByRole('button',{name:'Edit'});expect(localStorage.getItem(key)).toBeNull();expect(s.commands.filter((c:any)=>c.op==='correct_report')).toHaveLength(1);
});


test.each([false,true])('R1 mounted proposal=%s recovery verifies original history and reacquires changed-state consent without a new command',async(proposal)=>{
 const {s,key,saved}=await commitLost(true,proposal);s.cv='103';s.effective={...s.effective,customer_version:'103',revision_id:id(107),report_version:'105'};await recover();
 const ack=await screen.findByRole('checkbox',{name:'Saya memahami keadaan terkini dapat berbeda dari hasil asli'});expect(localStorage.getItem(key)).not.toBeNull();
 expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_report_import_v1'&&a.p_revision_id===id(6))).toBe(true);
 expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_report_history_v1'&&a.p_page===2)).toBe(true);
 fireEvent.click(ack);s.cv='104';s.effective={...s.effective,customer_version:'104',revision_id:id(108),report_version:'106'};fireEvent.click(screen.getByRole('button',{name:'Terima hasil koreksi asli'}));
 await waitFor(()=>expect((ack as HTMLInputElement).checked).toBe(false));expect(JSON.parse(localStorage.getItem(key)!).id).toBe(JSON.parse(saved).id);
 await waitFor(()=>expect((ack as HTMLInputElement).disabled).toBe(false));fireEvent.click(ack);await waitFor(()=>expect(screen.getByRole('button',{name:'Terima hasil koreksi asli'}).matches(':disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Terima hasil koreksi asli'}));await screen.findByRole('button',{name:'Edit'});expect(localStorage.getItem(key)).toBeNull();expect(s.commands.filter((c:any)=>c.op==='correct_report')).toHaveLength(1);
});
test.each([[false,'canonical'],[false,'provenance'],[true,'canonical'],[true,'provenance']] as const)('R1 mounted proposal=%s retains original receipt after %s failure',async(proposal,kind)=>{
 const {s,key,saved}=await commitLost(true,proposal);s.cv='3';s.effective={...s.effective,customer_version:'3',revision_id:id(7),report_version:'5'};const base=wire.handler;
 wire.handler=async(n,a)=>{if(kind==='canonical'&&n==='pilot_co_report_v1')return {data:null,error:{message:'Canonical unavailable'}};const r=await base(n,a);if(kind==='provenance'&&n==='pilot_co_report_import_v1'&&a.p_revision_id===id(6))Object.assign(r.data,{manifest:{schemaVersion:1,evidenceId:id(8),digest:'a'.repeat(64),input:input({scope:{actorId:id(1),customerId:customer,reportMonth:month,epoch:0},mappings:[]})},source_amount:'64700',currency:'IDR',source_filename:'newer-import.pdf'});return r};await recover();
 await screen.findAllByText(kind==='canonical'?'Canonical unavailable':/original legacy correction scope/);expect(JSON.parse(localStorage.getItem(key)!).id).toBe(JSON.parse(saved).id);expect(s.commands.filter((c:any)=>c.op==='correct_report')).toHaveLength(1);
});


test('R1 mounted confirmed-result retry cannot substitute a newer head revision',async()=>{
 const f=fixture(),base=wire.handler;let fail=true;
 wire.handler=async(n,a)=>{if(n==='pilot_co_report_v1'&&f.s.commands.some((c:any)=>c.op==='correct_report')&&fail)return {data:null,error:{message:'Confirmed canonical offline'}};const r=await base(n,a);if(n==='pilot_co_transaction_v1'&&a.p_operation==='correct_report')return {data:f.s.receipt,error:null};return r};
 mount(<COMonthlyReport/>);fireEvent.click(await screen.findByRole('button',{name:'Edit'}));fireEvent.click(await screen.findByRole('button',{name:'Mulai Edit dari laporan tercatat'}));await screen.findByLabelText('Terjual Item 1');fireEvent.click(screen.getByRole('button',{name:'Tinjau perubahan'}));fireEvent.change(await screen.findByLabelText('Alasan perubahan'),{target:{value:'Confirmed correction'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));fireEvent.click(await screen.findByRole('button',{name:'Simpan perubahan'}));
 await screen.findByText('Confirmed canonical offline');fail=false;f.s.cv='3';f.s.effective={...f.s.effective,customer_version:'3',revision_id:id(7),report_version:'5'};fireEvent.click(await screen.findByRole('button',{name:'Buka hasil perubahan tersimpan'}));await screen.findByRole('checkbox',{name:'Saya memahami keadaan terkini dapat berbeda dari hasil asli'});expect(f.s.commands.filter((c:any)=>c.op==='correct_report')).toHaveLength(1);
});

test('R1 mounted original receipt remains recovery-owned through the confirmed retry control after canonical failure',async()=>{
 const {s,key}=await commitLost(true);const base=wire.handler;let fail=true;
 wire.handler=async(n,a)=>n==='pilot_co_report_v1'&&fail?{data:null,error:{message:'Retry canonical unavailable'}}:base(n,a);
 await recover();await screen.findAllByText('Retry canonical unavailable');fail=false;
 fireEvent.click(screen.getByRole('button',{name:'Kembali ke sumber'}));fireEvent.click(await screen.findByRole('button',{name:'Buka hasil Edit tersimpan'}));await screen.findByRole('button',{name:'Edit'});
 expect(localStorage.getItem(key)).toBeNull();expect(s.commands.filter((c:any)=>c.op==='correct_report')).toHaveLength(1);
});
