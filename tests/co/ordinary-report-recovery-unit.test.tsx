/** Endpoint-specific preservation of the original ordinary draft recovery guards.
 * Public production workspace/Fields/RecoveryPanel/authority composition; not the
 * retired initial monthly route and not evidence that import uses ordinary RPCs. */
import {customer,draftId,id,month,mount,store,wire} from './report-ui-harness';
import {act,fireEvent,screen} from '@testing-library/react';
import {expect,test} from 'vitest';
import {COReportFields,useCOReportWorkspace,type COReportWorkspace} from '../../src/components/co/COReportWorkspace';
import {COFailure,CORecoveryPanel} from '../../src/components/co/COShared';
import COSourceBoundary from '../../src/components/co/COSourceBoundary';
import {fetchCOReport} from '../../src/lib/co/rpc';
let work:COReportWorkspace;
function Workspace(){
 work=useCOReportWorkspace(customer,month);
 return <>{work.header?<COReportFields work={work}/>:work.authorityError?<COFailure error={work.authorityError} retry={work.retryAuthority}/>:null}<CORecoveryPanel confirmed={!!work.confirmed} pending={work.pending} sender={work.sender} current={()=>work.current()&&!work.pending} accept={receipt=>work.acceptCanonical(receipt,true)}/></>;
}
function Unit(){return <COSourceBoundary source="ordinary-report-recovery-unit" check={o=>fetchCOReport(customer,month,null,o)}><Workspace/></COSourceBoundary>}
const readPending=()=>JSON.parse(localStorage.getItem(localStorage.key(0)!)!);
test.each(['reconcile','recovered-import','acknowledge'])('ordinary workspace UNIT %s authority denial retains original ordinary endpoint request',async phase=>{
 const s=store(),base=s.handle;let lost=true,denialEntered=false;
 wire.handler=async(n:string,a:any)=>{const result=await base(n,a);if(n==='pilot_co_transaction_v1'&&lost){lost=false;return {data:null,error:{code:'08006',message:'Ordinary reply lost'}};}return result;};
 const {client}=mount(<Unit/>);fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'7'}});fireEvent.change(screen.getByLabelText('Catatan laporan'),{target:{value:'PRIVATE ORDINARY RECOVERY'}});
 expect(screen.getByDisplayValue('PRIVATE ORDINARY RECOVERY')).toBeTruthy();
 await act(async()=>{try{await work.save()}catch{/* Actual work.error is asserted below. */}});await screen.findByText('Ordinary reply lost');
 const pending=readPending();expect(pending.binding).toMatchObject({operation:'save_report_draft',customer_id:customer,draft_id:draftId});
 expect(s.commands).toHaveLength(1);expect(s.commands[0]).toMatchObject({op:'save_report_draft',payload:{action:'upsert_lines',expected_draft_version:'1',lines:[{stock_key_id:id(1001),sold_quantity:7}]}});
 if(phase==='reconcile')s.fail=(n:string)=>{if(n!=='pilot_reconcile_co_v1')return null;denialEntered=true;return {data:null,error:{code:'42501',message:'Ordinary recovery denied'}}};
 fireEvent.click(screen.getByRole('button',{name:'Pulihkan hasil penyimpanan'}));
 if(phase!=='reconcile'){
  const accept=await screen.findByRole('button',{name:'Lihat hasil tersimpan'});
  s.fail=(n:string)=>{if(n!==(phase==='acknowledge'?'pilot_my_profile':'pilot_co_report_v1'))return null;denialEntered=true;return {data:null,error:{code:'42501',message:'Ordinary recovery denied'}}};
  fireEvent.click(accept);
 }
 await screen.findByText('Ordinary recovery denied');expect(denialEntered).toBe(true);
 expect(screen.queryByDisplayValue('PRIVATE ORDINARY RECOVERY')).toBeNull();expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();
 expect(client.getQueryCache().getAll().filter(q=>q.queryKey[0]==='co'&&q.state.data)).toHaveLength(0);
 expect(readPending().id).toBe(pending.id);expect(readPending().binding).toEqual(pending.binding);expect(s.commands).toHaveLength(1);
 const reconciles=wire.rpc.mock.calls.filter(([n])=>n==='pilot_reconcile_co_v1');expect(reconciles.length).toBeGreaterThan(0);expect(reconciles.every(([,a])=>a.p_request_id===pending.id)).toBe(true);
 const count=wire.rpc.mock.calls.length;await act(async()=>{await client.invalidateQueries({queryKey:['co']});});expect(wire.rpc.mock.calls).toHaveLength(count);
});
