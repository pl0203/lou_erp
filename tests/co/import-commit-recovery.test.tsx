import { committedHead, committedRevision, openCommitReview } from './import-commit-transport-harness';
import { customer, draftId, id, wire } from './report-ui-harness';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { test, expect } from 'vitest';
const pending=()=>JSON.parse(localStorage.getItem(localStorage.key(0)!)!);
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release}};
function assertOriginal(f:Awaited<ReturnType<typeof openCommitReview>>['f']){
 expect(f.commitState.commitCalls).toHaveLength(1);const call=f.commitState.commitCalls[0];
 expect(call.p_request_id).toBe(f.requestId);expect(call.p_payload).toMatchObject({requestId:f.requestId,mode:'post',previewFingerprint:'b'.repeat(64),binding:{importId:id(88),importVersion:'1',customerVersion:'1',draftId,draftVersion:'4'},acknowledgedReopenOrders:[],reason:'PRIVATE COMMIT REVIEW'});
 expect(f.receipt).toEqual({id:committedHead,operation:'post_report',version:'1',customer_id:customer,customer_version:'2'});
 expect(f.commitState.reconcileCalls.length).toBeGreaterThan(0);expect(f.commitState.reconcileCalls.every(a=>a.p_request_id===f.requestId)).toBe(true);
 expect(f.writes).toHaveLength(5);expect(f.s.rows[0].sold_quantity).toBe('1');
}
async function recorded(){
 const table=await screen.findByRole('region',{name:'Laporan penjualan tercatat'});
 await within(table).findByText('Alokasi sesuai jumlah');await within(table).findByText('Sumber: TEST_ONLY_MONTHLY_CO_20261029.xlsx');
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(localStorage.length).toBe(0);
}
test('current import successful commit waits for canonical acknowledgment before recorded route and cleared recovery',async()=>{
 const {f,record}=await openCommitReview(),canonical=gate();const base=wire.handler;let entered=false;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_report_v1'&&f.receipt){entered=true;await canonical.promise;}return base(n,a);};
 fireEvent.click(record);await waitFor(()=>expect(entered).toBe(true));
 expect(pending()).toMatchObject({id:f.requestId,committed:f.receipt});expect(screen.queryByRole('region',{name:'Laporan penjualan tercatat'})).toBeNull();
 expect(screen.getByDisplayValue('PRIVATE COMMIT REVIEW')).toBeTruthy();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();assertOriginal(f);
 await act(async()=>canonical.release());await recorded();assertOriginal(f);
 expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_report_rows_v1'&&a.p_revision_id===committedRevision&&a.p_expected_customer_version==='2')).toBe(true);
});
test('lost current import commit reply recovers identical request without redispatch or duplicate sale',async()=>{
 const {f,record}=await openCommitReview();f.commitState.lostReply=true;f.commitState.unknownRecovery=true;
 fireEvent.click(record);await screen.findByText('Commit reply lost');const original=pending();
 expect(original).toMatchObject({id:f.requestId,uncertain:true,binding:{family:'commit',customerId:customer,binding:f.originalBinding}});
 expect(screen.getByDisplayValue('PRIVATE COMMIT REVIEW')).toBeTruthy();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Periksa hasil pencatatan',exact:true}));await screen.findByText('Hasil belum dapat dipastikan. Jangan buat permintaan baru.');
 expect(pending()).toEqual(original);expect(f.commitState.commitCalls).toHaveLength(1);
 f.commitState.unknownRecovery=false;fireEvent.click(screen.getByRole('button',{name:'Periksa hasil pencatatan',exact:true}));await recorded();assertOriginal(f);
 expect(f.commitState.reconcileCalls.some(a=>a.p_abandon===true)).toBe(true); // Existing committed receipt wins; never a new transaction.
});
test('newer canonical report requires explicit original-result consent without changing original commit identity',async()=>{
 const {f,record}=await openCommitReview();const base=wire.handler;
 wire.handler=async(n:string,a:any)=>{const result=await base(n,a);if(n==='pilot_co_import_commit_v1'&&!result.error)f.newerCanonical();return result;};
 fireEvent.click(record);const accept=await screen.findByRole('button',{name:'Terima hasil pencatatan asli'});
 expect(accept.matches(':disabled')).toBe(true);expect(pending()).toMatchObject({id:f.requestId,committed:f.receipt});
 expect(f.s.cv).toBe('3');expect(f.receipt.customer_version).toBe('2');expect(f.receipt.version).toBe('1');expect(f.s.effective.report_version).toBe('2');
 fireEvent.click(accept);expect(localStorage.length).toBe(1);expect(f.commitState.commitCalls).toHaveLength(1);
 fireEvent.click(screen.getByLabelText('Saya memahami keadaan terkini dapat berbeda dari hasil asli'));fireEvent.click(accept);await recorded();assertOriginal(f);
});
