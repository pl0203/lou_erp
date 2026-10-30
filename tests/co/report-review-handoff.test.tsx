import { productionCommitFixture } from './import-commit-transport-harness';
import { productionImportFixture, sourceSha } from './import-production-ports-harness';
import { expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { customer, draftId, id, wire } from './report-ui-harness';

function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

// Accepted no-draft upload translation: real production evidence/import senders,
// checked immutable import and canonical reads, NOT old upsert_lines semantics.
async function readyUpload(){
 const f=await productionImportFixture();f.state.incomplete=false;f.mountRoute();await f.choose();await f.confirmDecisions();
 expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');
 return f;
}
function assertPreparation(f:Awaited<ReturnType<typeof productionImportFixture>>){
 expect(f.writes.map(w=>[w.name,w.args.p_operation])).toEqual([
  ['pilot_co_transaction_v1','save_report_draft'],['pilot_co_evidence_transaction_v1','register_evidence'],['pilot_co_evidence_transaction_v1','finalize_evidence'],['pilot_co_import_prepare_v1',undefined],
 ]);
 expect(new Set(f.writes.map(w=>w.args.p_request_id)).size).toBe(4);
 expect(f.writes[1].args.p_payload).toMatchObject({sha256:sourceSha,expected_customer_version:'1',expected_draft_version:'2'});
 expect(f.writes[2].args.p_payload).toMatchObject({evidence_id:id(45),expected_evidence_version:'1',expected_customer_version:'1',expected_draft_version:'2'});
 expect(f.writes[3].args.p_payload).toMatchObject({expected_customer_version:'1',expected_draft_version:'3',expected_evidence_version:'2',manifest:{evidenceId:id(45),input:{scope:{customerId:customer},extracted:{sha256:sourceSha}}}});
 expect(f.s.version).toBe('4');expect(f.s.effective).toBeNull();
}
test('one upload Review intent survives canonical preparation before a delayed bound preview response',async()=>{
 const f=await readyUpload(),preview=gate();const base=wire.handler;let entered=false;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_preview_v1'){entered=true;await preview.promise;}return base(n,a);};
 const review=screen.getByRole('button',{name:'Tinjau pencatatan'});fireEvent.click(review);
 await waitFor(()=>expect(entered).toBe(true));assertPreparation(f);expect(localStorage.length).toBe(0);
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');
 expect(screen.queryByRole('button',{name:'Tinjau pencatatan'})).toBeNull();expect(f.writes).toHaveLength(4);
 await act(async()=>preview.release());await screen.findByRole('button',{name:'Catat penjualan'});
 const previews=wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_import_preview_v1');expect(previews).toHaveLength(1);
 expect(previews[0][1]).toMatchObject({p_import_id:id(88),p_expected_version:'1'});assertPreparation(f);
});

test('upload Review waits for finalized evidence canonical state and immutable import acknowledgment before preview',async()=>{
 const f=await readyUpload(),canonical=gate(),immutable=gate();const base=wire.handler;let canonicalEntered=false,immutableEntered=false;
 wire.handler=async(n:string,a:any)=>{
  if(n==='pilot_co_report_v1'&&f.s.version==='3'){canonicalEntered=true;await canonical.promise;}
  if(n==='pilot_co_import_read_v1'){immutableEntered=true;await immutable.promise;}
  return base(n,a);
 };
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
 await waitFor(()=>expect(canonicalEntered).toBe(true));expect(f.writes).toHaveLength(3);expect(f.state.prepareCount).toBe(0);expect(f.state.previewCount).toBe(0);
 const retained=JSON.parse(localStorage.getItem(localStorage.key(0)!)!);expect(retained.committed).toMatchObject({id:id(45),operation:'finalize_evidence',version:'2',customer_id:customer});
 await act(async()=>canonical.release());await waitFor(()=>expect(immutableEntered).toBe(true));assertPreparation(f);
 expect(wire.rpc.mock.calls.find(([n])=>n==='pilot_co_import_read_v1')![1]).toMatchObject({p_import_id:id(88),p_expected_version:'1'});
 expect(f.state.previewCount).toBe(0);expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_import_preview_v1')).toHaveLength(0);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 const prepared=JSON.parse(localStorage.getItem(localStorage.key(0)!)!);expect(prepared.committed).toMatchObject({importId:id(88),draftId,draftVersion:'4',customerVersion:'1'});
 await act(async()=>immutable.release());await screen.findByRole('button',{name:'Catat penjualan'});
 expect(f.state.previewCount).toBe(1);expect(localStorage.length).toBe(0);assertPreparation(f);
 expect(wire.rpc.mock.calls.find(([n])=>n==='pilot_co_import_preview_v1')![1]).toMatchObject({p_import_id:id(88),p_expected_version:'1'});
});

test.each(['reason', 'corrected quantity and reason'])('actual upload Review binds final %s in the immutable manifest and later edits invalidate confirmation',async kind=>{
 const f=await readyUpload(),preview=gate(),base=wire.handler;let entered=false;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_preview_v1'){entered=true;await preview.promise;}return base(n,a)};
 if(kind==='corrected quantity and reason'){
  fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'),{target:{value:'0'}});
  fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await act(async()=>{await Promise.resolve()});expect(f.state.prepareCount).toBe(0);expect(f.writes).toHaveLength(1);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'),{target:{value:'1'}});
  const confirm=screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini') as HTMLInputElement;if(!confirm.checked)fireEvent.click(confirm);
 }
 fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'),{target:{value:'Checked source decisions'}});
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(entered).toBe(true));assertPreparation(f);
 const manifest=f.writes[3].args.p_payload.manifest;expect(manifest.input.reason).toBe('Checked source decisions');expect(manifest.input.mappings).toHaveLength(1);expect(manifest.input.mappings[0]).toMatchObject({stockKeyId:id(1001),quantity:'1',confirmed:true});
 expect(manifest.input.extracted.sha256).toBe(sourceSha);expect(manifest.input.scope.customerId).toBe(customer);
 await act(async()=>preview.release());await screen.findByRole('button',{name:'Catat penjualan'});
 expect(wire.rpc.mock.calls.find(([n])=>n==='pilot_co_import_preview_v1')![1]).toMatchObject({p_import_id:id(88),p_expected_version:'1'});
 fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'),{target:{value:'Newer unsaved reason'}});
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(f.writes[3].args.p_payload.manifest.input.reason).toBe('Checked source decisions');assertPreparation(f);expect(f.state.previewCount).toBe(1);
});

test('failed immutable prepare read retains original identity and recovery alone cannot silently preview or commit',async()=>{
 const f=await readyUpload(),read=gate(),base=wire.handler;let fail=true,entered=false;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_read_v1'&&fail){entered=true;await read.promise;return {data:null,error:{code:'08006',message:'Prepared import offline'}}}return base(n,a)};
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(entered).toBe(true));assertPreparation(f);
 const key=localStorage.key(0)!,retained=JSON.parse(localStorage.getItem(key)!);expect(retained.committed).toMatchObject({importId:id(88),draftId,draftVersion:'4',customerVersion:'1'});
 await act(async()=>read.release());await screen.findByText('Prepared import offline');expect(f.state.previewCount).toBe(0);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(retained);
 fail=false;fireEvent.click(screen.getByRole('button',{name:'Periksa hasil pencatatan',exact:true}));await waitFor(()=>expect(localStorage.length).toBe(0));expect(f.state.previewCount).toBe(0);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();assertPreparation(f);
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await screen.findByRole('button',{name:'Catat penjualan'});assertPreparation(f);expect(f.state.previewCount).toBe(1);
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_import_read_v1').every(([,a])=>a.p_import_id===id(88)&&a.p_expected_version==='1')).toBe(true);
});

test.each(['canonical', 'eligible'])('%s authority denial during actual upload preparation clears private data and prevents queued preview',async source=>{
 const f=await productionImportFixture();f.state.incomplete=false;const {client}=f.mountRoute();await f.choose();await f.confirmDecisions();
 fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'),{target:{value:'PRIVATE PREPARATION NOTE'}});
 const response=gate(),base=wire.handler;let entered=false;
 wire.handler=async(n:string,a:any)=>{if(source==='canonical'?n==='pilot_co_report_v1'&&f.s.version==='3':n==='pilot_co_import_eligible_v1'){entered=true;await response.promise;return {data:null,error:{code:'42501',message:'Saved report authority denied'}}}return base(n,a)};
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(entered).toBe(true));expect(f.writes).toHaveLength(source==='canonical'?3:1);
 await act(async()=>response.release());await screen.findByText('Saved report authority denied');
 expect(screen.queryByDisplayValue('PRIVATE PREPARATION NOTE')).toBeNull();expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(f.state.previewCount).toBe(0);expect(f.state.prepareCount).toBe(0);expect(f.s.effective).toBeNull();
 expect(client.getQueryCache().getAll().filter(q=>q.queryKey[0]==='co'&&q.state.data)).toHaveLength(0);
});

test.each(['navigate away', 'replace role'])('%s during immutable import acknowledgment cannot revive the departed upload Review intent',async interruption=>{
 const f=await productionImportFixture();f.state.incomplete=false;const {router}=f.mountRoute();await f.choose();await f.confirmDecisions();
 const immutable=gate(),base=wire.handler;let entered=false;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_read_v1'){entered=true;const result=await base(n,a);await immutable.promise;return result;}return base(n,a)};
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(entered).toBe(true));assertPreparation(f);
 const key=localStorage.key(0)!;const retained=JSON.parse(localStorage.getItem(key)!);expect(retained.committed).toMatchObject({importId:id(88),importVersion:'1',draftId,draftVersion:'4',customerVersion:'1'});
 expect(f.state.previewCount).toBe(0);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 if(interruption==='navigate away'){await act(()=>router.navigate('/away'));fireEvent.click(await screen.findByRole('button',{name:'Tetap mengedit'}));expect(router.state.location.pathname).not.toBe('/away');expect(JSON.parse(localStorage.getItem(key)!)).toEqual(retained);await act(()=>router.navigate('/away'));fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan',exact:true}));await screen.findByText('Destination')}else{wire.role='executive';await act(()=>router.revalidate());}
 await act(async()=>{immutable.release();await Promise.resolve()});
 expect(screen.queryByRole('heading',{name:'Konfirmasi pencatatan'})).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 expect(f.state.previewCount).toBe(0);expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_import_preview_v1')).toHaveLength(0);assertPreparation(f);
 expect(JSON.parse(localStorage.getItem(key)!)).toEqual(retained);expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);
});

// Unchanged-version refresh also requires explicit re-review.
test('unchanged-version root refresh preserves acknowledged upload input and requires explicit Review without duplicate preparation',async()=>{
 const f=await productionImportFixture();f.state.incomplete=false;const {client}=f.mountRoute();await f.choose();await f.confirmDecisions();
 fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'),{target:{value:'ACKNOWLEDGED UNCHANGED INPUT'}});
 const immutable=gate(),root=gate(),base=wire.handler;let immutableEntered=false,refreshRoot=false,rootEntered=false;
 wire.handler=async(n:string,a:any)=>{
  if(n==='pilot_co_import_read_v1'){immutableEntered=true;const result=await base(n,a);await immutable.promise;return result}
  if(n==='pilot_co_report_v1'&&refreshRoot){rootEntered=true;const result=await base(n,a);await root.promise;return result}
  return base(n,a);
 };
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(immutableEntered).toBe(true));assertPreparation(f);
 const key=localStorage.key(0)!,original=JSON.parse(localStorage.getItem(key)!);expect(original.committed).toMatchObject({importId:id(88),importVersion:'1',draftId,draftVersion:'4',customerVersion:'1'});
 refreshRoot=true;let refreshed!:Promise<void>;await act(async()=>{refreshed=client.invalidateQueries({predicate:q=>q.queryKey[4]==='report'})});await waitFor(()=>expect(rootEntered).toBe(true));
 await act(async()=>immutable.release());expect(f.state.previewCount).toBe(0);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 await act(async()=>{root.release();await refreshed});refreshRoot=false;
 expect(f.s.cv).toBe('1');expect(f.s.version).toBe('4');expect(screen.getByDisplayValue('ACKNOWLEDGED UNCHANGED INPUT')).toBeTruthy();expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');
 expect(f.state.previewCount).toBe(0);expect(screen.queryByRole('heading',{name:'Konfirmasi pencatatan'})).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);assertPreparation(f);
 // A committed supporting receipt is checked explicitly before a new preview intent.
 const recover=screen.getByRole('button',{name:'Periksa hasil pencatatan',exact:true});await waitFor(()=>expect(recover.matches(':disabled')).toBe(false));fireEvent.click(recover);await waitFor(()=>expect(localStorage.length).toBe(0));
 expect(screen.getByDisplayValue('ACKNOWLEDGED UNCHANGED INPUT')).toBeTruthy();expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');expect(f.state.previewCount).toBe(0);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();assertPreparation(f);
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));const record=await screen.findByRole('button',{name:'Catat penjualan'});await waitFor(()=>expect(record.matches(':disabled')).toBe(false));
 expect(f.state.previewCount).toBe(1);expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_import_preview_v1').map(([,a])=>a)).toEqual([{p_import_id:id(88),p_expected_version:'1',p_acknowledged_reopen_orders:[]}]);assertPreparation(f);expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);
});

test('source version change while a captured upload preview is in flight cannot restore stale confirmation',async()=>{
 const f=await productionImportFixture();f.state.incomplete=false;const {client}=f.mountRoute();await f.choose();await f.confirmDecisions();
 const preview=gate(),base=wire.handler;let entered=false,captured:any;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_preview_v1'){captured=await base(n,a);entered=true;await preview.promise;return captured}return base(n,a)};
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(entered).toBe(true));assertPreparation(f);
 expect(captured.data.binding).toMatchObject({importId:id(88),importVersion:'1',customerVersion:'1',draftId,draftVersion:'4'});expect(localStorage.length).toBe(0);
 f.s.version='5';f.s.cv='2';await act(async()=>{await client.invalidateQueries({predicate:q=>q.queryKey[4]==='report'})});
 await act(async()=>{preview.release();await Promise.resolve()});
 expect(screen.queryByRole('heading',{name:'Konfirmasi pencatatan'})).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 expect(f.state.previewCount).toBe(1);expect(f.writes).toHaveLength(4);expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);expect(f.s.effective).toBeNull();
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_import_preview_v1').map(([,a])=>a)).toEqual([{p_import_id:id(88),p_expected_version:'1',p_acknowledged_reopen_orders:[]}]);
});

test('pending upload blocks source replacement and explicit Cancel Keep/Discard cannot revive late prepare acknowledgment',async()=>{
 const f=await readyUpload(),immutable=gate(),base=wire.handler;let entered=false;
 fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'),{target:{value:'PRIVATE PENDING SOURCE'}});
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_read_v1'){entered=true;const result=await base(n,a);await immutable.promise;return result}return base(n,a)};
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(entered).toBe(true));assertPreparation(f);
 const file=screen.getByLabelText('Ganti file');expect(file.matches(':disabled')).toBe(true);
 const reads=wire.rpc.mock.calls.length;fireEvent.drop(file.closest('.co-import__drop')!,{dataTransfer:{files:[new File(['not parsed'],'replacement.pdf',{type:'application/pdf'})]}});await act(async()=>{await Promise.resolve()});expect(wire.rpc.mock.calls.length).toBe(reads);assertPreparation(f);
 const key=localStorage.key(0)!,original=JSON.parse(localStorage.getItem(key)!);expect(original.committed).toMatchObject({importId:id(88),draftId,draftVersion:'4',customerVersion:'1'});
 // Do not force change on a disabled native input: the supported action is Cancel.
 fireEvent.click(screen.getByRole('button',{name:'Batal',exact:true}));fireEvent.click(await screen.findByRole('button',{name:'Tetap mengedit'}));
 expect(screen.getByDisplayValue('PRIVATE PENDING SOURCE')).toBeTruthy();expect(file.matches(':disabled')).toBe(true);expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);assertPreparation(f);
 fireEvent.click(screen.getByRole('button',{name:'Batal',exact:true}));fireEvent.click(await screen.findByRole('button',{name:'Buang perubahan',exact:true}));
 await waitFor(()=>expect(screen.queryByDisplayValue('PRIVATE PENDING SOURCE')).toBeNull());expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);
 await act(async()=>{immutable.release();await Promise.resolve()});expect(screen.queryByRole('heading',{name:'Konfirmasi pencatatan'})).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(screen.queryByDisplayValue('PRIVATE PENDING SOURCE')).toBeNull();
 expect(f.state.previewCount).toBe(0);assertPreparation(f);expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);
});

test('failed root refetch cancels pending upload Review and read retry cannot silently preview or commit',async()=>{
 const f=await productionImportFixture();f.state.incomplete=false;const {client}=f.mountRoute();await f.choose();await f.confirmDecisions();
 const immutable=gate(),root=gate(),base=wire.handler;let immutableEntered=false,failRoot=false,rootEntered=false;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_read_v1'){immutableEntered=true;const result=await base(n,a);await immutable.promise;return result}if(n==='pilot_co_report_v1'&&failRoot){rootEntered=true;await root.promise;return {data:null,error:{code:'08006',message:'Saved header offline'}}}return base(n,a)};
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(immutableEntered).toBe(true));assertPreparation(f);
 const key=localStorage.key(0)!,retained=JSON.parse(localStorage.getItem(key)!);failRoot=true;let refresh!:Promise<void>;
 await act(async()=>{refresh=client.invalidateQueries({predicate:q=>q.queryKey[4]==='report'})});await waitFor(()=>expect(rootEntered).toBe(true));
 await act(async()=>immutable.release());expect(f.state.previewCount).toBe(0);await act(async()=>{root.release();await refresh});await screen.findByText('Saved header offline');
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(retained);
 failRoot=false;fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await waitFor(()=>expect(screen.queryByText('Saved header offline')).toBeNull());expect(f.state.previewCount).toBe(0);assertPreparation(f);expect(JSON.parse(localStorage.getItem(key)!)).toEqual(retained);
 fireEvent.click(screen.getByRole('button',{name:'Periksa hasil pencatatan',exact:true}));await waitFor(()=>expect(localStorage.length).toBe(0));expect(f.state.previewCount).toBe(0);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();assertPreparation(f);
 const fresh=screen.getByRole('button',{name:'Tinjau pencatatan'});expect(fresh.matches(':disabled')).toBe(false);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(f.state.previewCount).toBe(0);assertPreparation(f);fireEvent.click(fresh);const record=await screen.findByRole('button',{name:'Catat penjualan'});await waitFor(()=>expect(record.matches(':disabled')).toBe(false));assertPreparation(f);expect(f.state.previewCount).toBe(1);expect(wire.rpc.mock.calls.find(([n])=>n==='pilot_co_import_preview_v1')![1]).toMatchObject({p_import_id:id(88),p_expected_version:'1'});
});

test('actual parsed zero requires explicit source decision and final recording confirmation without duplicate commit',async()=>{
 const f=await productionCommitFixture({zeroSource:true});f.mountRoute();await f.choose();await f.confirmDecisions();
 expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('0');expect(f.s.effective).toBeNull();expect(f.commitState.commitCalls).toHaveLength(0);
 const decision=screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini');fireEvent.click(decision);fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await act(async()=>{await Promise.resolve()});expect(f.state.prepareCount).toBe(0);expect(f.writes).toHaveLength(1);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 fireEvent.click(decision);fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));const record=await screen.findByRole('button',{name:'Catat penjualan'});await waitFor(()=>expect(record.matches(':disabled')).toBe(false));await screen.findByRole('heading',{name:'Konfirmasi pencatatan'});
 const prepared=f.writes.find(w=>w.name==='pilot_co_import_prepare_v1')!;expect(prepared.args.p_payload.manifest.input.extracted.sha256).toBe(f.sourceFixture.sha);expect(prepared.args.p_payload.manifest.input.extracted.sourceRows[0].quantity.decimal).toBe('0');expect(prepared.args.p_payload.manifest.input.mappings[0]).toMatchObject({quantity:'0',stockKeyId:id(1001),confirmed:true});expect(prepared.args.p_payload).toMatchObject({expected_draft_version:'3',expected_customer_version:'1'});
 expect(f.commitState.commitCalls).toHaveLength(0);expect(f.s.effective).toBeNull();fireEvent.click(record);fireEvent.click(record);
 const table=await screen.findByRole('region',{name:'Laporan penjualan tercatat'});await within(table).findByText('Alokasi sesuai jumlah');
 expect(f.commitState.commitCalls).toHaveLength(1);expect(f.commitState.commitCalls[0]).toMatchObject({p_request_id:f.requestId,p_payload:{binding:{importId:id(88),importVersion:'1',draftId,draftVersion:'4',customerVersion:'1'},previewFingerprint:'b'.repeat(64)}});
 expect(f.s.rows[0].sold_quantity).toBe('0');expect(f.s.effective.revenue).toBe('0');expect(f.writes).toHaveLength(5);expect(localStorage.length).toBe(0);
});

// Successful recovery readiness must never apply to changed, hostile, denied or departed owners.
test.each(['changed selection','wrong immutable binding','authority denied','departed actor'])('prepare recovery never enables an old Review after %s',async failure=>{
 const f=await productionImportFixture();f.state.incomplete=false;const {router}=f.mountRoute();await f.choose();await f.confirmDecisions();
 const base=wire.handler,late=gate();let first=true,recoveryEntered=false;
 wire.handler=async(n:string,a:any)=>{
  if(n==='pilot_co_import_read_v1'){
   if(first)return {data:null,error:{code:'08006',message:'Original prepare unreadable'}};
   recoveryEntered=true;const result=await base(n,a);
   if(failure==='authority denied')return {data:null,error:{code:'42501',message:'Recovery source denied'}};
   if(failure==='wrong immutable binding')return {data:{...result.data,binding:{...result.data.binding,importId:id(999)}},error:null};
   if(failure==='departed actor')await late.promise;
   return result;
  }
  const result=await base(n,a);if(!first&&failure==='changed selection'&&n==='pilot_co_import_selection_v1')return {data:{...result.data,selectionId:id(777),importId:id(778)},error:null};return result;
 };
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await screen.findByText('Original prepare unreadable');assertPreparation(f);
 const key=localStorage.key(0)!,original=JSON.parse(localStorage.getItem(key)!);first=false;
 fireEvent.click(screen.getByRole('button',{name:'Periksa hasil pencatatan',exact:true}));await waitFor(()=>expect(recoveryEntered).toBe(true));
 if(failure==='departed actor'){wire.actor=false;await act(()=>router.revalidate());await act(async()=>late.release());}
 else if(failure==='changed selection')await screen.findByText('Hasil asli ditemukan; konteks sudah berubah');
 else if(failure==='authority denied')await screen.findByText('Recovery source denied');
 else await waitFor(()=>expect(screen.queryByRole('button',{name:'Periksa hasil pencatatan',exact:true})?.matches(':disabled')).toBe(false));
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(screen.queryByRole('heading',{name:'Konfirmasi pencatatan'})).toBeNull();expect(f.state.previewCount).toBe(0);assertPreparation(f);
 expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);
 if(failure==='authority denied'||failure==='departed actor')expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();
});

test('root version drift during immutable prepare acknowledgment cannot rebind queued Review or discard the original receipt',async()=>{
 const f=await productionImportFixture();f.state.incomplete=false;const {client}=f.mountRoute();await f.choose();await f.confirmDecisions();
 const immutable=gate(),base=wire.handler;let entered=false;
 wire.handler=async(n:string,a:any)=>{if(n==='pilot_co_import_read_v1'){entered=true;const result=await base(n,a);await immutable.promise;return result}return base(n,a)};
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(entered).toBe(true));assertPreparation(f);
 const key=localStorage.key(0)!,original=JSON.parse(localStorage.getItem(key)!);expect(original.committed).toMatchObject({importId:id(88),draftId,draftVersion:'4',customerVersion:'1'});
 f.s.cv='2';f.s.version='5';await act(async()=>{await client.invalidateQueries({predicate:q=>q.queryKey[4]==='report'})});await act(async()=>immutable.release());
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(f.state.previewCount).toBe(0);expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);
 fireEvent.click(screen.getByRole('button',{name:'Periksa hasil pencatatan',exact:true}));await screen.findByText('Hasil asli ditemukan; konteks sudah berubah');
 const acknowledge=screen.getByRole('button',{name:'Akui hasil asli dan buka keadaan terkini'});expect(acknowledge.matches(':disabled')).toBe(true);expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(f.state.previewCount).toBe(0);expect(f.writes).toHaveLength(4);expect(f.s.effective).toBeNull();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);
});
