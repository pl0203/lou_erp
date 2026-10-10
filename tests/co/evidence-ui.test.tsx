import {expect,test,vi} from 'vitest';
import {act,cleanup,fireEvent,screen,waitFor} from '@testing-library/react';
import {store,mount,wire,customer,month,draftId,id} from './report-ui-harness';
import { evidenceId, fixture, choose } from './evidence-ui-harness';
import COEvidenceAttachment, { CORevisionAttachment } from '../../src/components/co/COEvidenceAttachment';
import {useCOReportWorkspace,COReportFields} from '../../src/components/co/COReportWorkspace';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
let workspace:any;
function Probe(){const work=useCOReportWorkspace(customer,month);workspace=work;return work.header?<COReportFields work={work}/>:null;}
function binding(work:any){return {customerId:customer,month,draftId,previousDraftVersion:work.header.draft_version,customerVersion:work.header.customer_version,generation:work.generation};}
test('finalized exact draft transition preserves raw fields and saved baseline without another write',async()=>{
 const s=store();mount(<Probe/>);const input=await screen.findByLabelText('Terjual Item 1');fireEvent.change(input,{target:{value:'7'}});fireEvent.change(screen.getByLabelText('Catatan laporan'),{target:{value:'unsent'}});
 const b=binding(workspace);s.version='2';let called=false;let ok:any;
 await act(async()=>{ok=await workspace.rebindDraftAfterEvidence(b,async(fresh:any,live:any)=>{expect(live()).toBe(true);expect(fresh.draft.draft_version).toBe('2');called=true;});});
 expect(ok).toBe(true);expect(called).toBe(true);expect(screen.getByLabelText('Terjual Item 1')).toBe(input);expect((input as HTMLInputElement).value).toBe('7');expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('unsent');expect(workspace.dirty).toBe(true);expect(workspace.header.draft_version).toBe('2');expect(s.commands).toHaveLength(0);
});
test.each(['version','customer','context'])('never adopts concurrent %s drift while retaining an older overlay',async(kind)=>{
 const s=store();mount(<Probe/>);fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'9'}});const b=binding(workspace);s.version=kind==='version'?'3':'2';if(kind==='customer')s.cv='2';if(kind==='context')s.metadata.source_context_fingerprint='c'.repeat(64);
 let called=false;await act(async()=>{await expect(workspace.rebindDraftAfterEvidence(b,async()=>{called=true;})).rejects.toThrow();});
 expect(called).toBe(false);expect(workspace.header.draft_version).toBe('1');expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('9');expect(workspace.stale).toBe(true);
});
test('failed confirmation keeps old binding and a later identical finalized import is idempotent',async()=>{
 const s=store();mount(<Probe/>);await screen.findByLabelText('Terjual Item 1');const b=binding(workspace);s.version='2';
 await act(async()=>{await expect(workspace.rebindDraftAfterEvidence(b,async()=>{throw new Error('sidecar unavailable');})).rejects.toThrow('sidecar unavailable');});expect(workspace.header.draft_version).toBe('1');
 await act(async()=>{expect(await workspace.rebindDraftAfterEvidence(b,async()=>{})).toBe(true);});
 await act(async()=>{expect(await workspace.rebindDraftAfterEvidence(b,async()=>{})).toBe(true);});expect(workspace.header.draft_version).toBe('2');expect(s.commands).toHaveLength(0);
});
test('authority failure during evidence import clears the source and cannot restore private fields',async()=>{
 const s=store();mount(<Probe/>);await screen.findByLabelText('Terjual Item 1');const b=binding(workspace);s.version='2';await act(async()=>{await expect(workspace.rebindDraftAfterEvidence(b,async()=>{throw {code:'42501',message:'denied'};})).rejects.toMatchObject({code:'42501'});});expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();expect(workspace.denied).toBe(true);
});
test('optional evidence is present in standalone report and a sidecar authority denial clears the full source',async()=>{
 const s=store(),base=s.handle;wire.handler=async(n:string,a:any)=>n==='pilot_co_evidence_selection_v1'?{data:null,error:{code:'42501',message:'Evidence denied'}}:base(n,a);mount(<COMonthlyReport/>);await screen.findByText('Evidence denied');expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();
});

function AttachmentProbe(){const work=useCOReportWorkspace(customer,month);workspace=work;return work.header?<><COReportFields work={work}/><COEvidenceAttachment work={work}/></>:null;}

test('optional upload finalizes exact draft, preserves dirty quantities and metadata, and clears its own guard',async()=>{
 const f=fixture();mount(<AttachmentProbe/>);fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'8'}});fireEvent.change(screen.getByLabelText('Catatan laporan'),{target:{value:'Keep raw'}});await choose();await waitFor(()=>expect(workspace.evidenceState.dirty).toBe(true));
 fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);await waitFor(()=>expect(workspace.evidenceState).toEqual({dirty:false,pending:false,unresolved:false}));expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('8');expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Keep raw');expect(workspace.dirty).toBe(true);expect(workspace.header.draft_version).toBe('2');expect(f.commands.map(x=>x.p_operation)).toEqual(['register_evidence','finalize_evidence']);expect(f.s.commands).toHaveLength(0);expect(localStorage.length).toBe(0);
});
test('known committed import failure blocks writes and retries only canonical reads',async()=>{
 const f=fixture();f.selectionFail=true;mount(<AttachmentProbe/>);await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText('Coba buka hasil lampiran');await waitFor(()=>expect(workspace.evidenceState.unresolved).toBe(true));expect(workspace.header.draft_version).toBe('1');await act(async()=>{await workspace.save();});expect(f.s.commands).toHaveLength(0);f.selectionFail=false;fireEvent.click(screen.getByText('Coba buka hasil lampiran'));await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);await waitFor(()=>expect(workspace.evidenceState.unresolved).toBe(false));expect(f.commands).toHaveLength(2);
});
test.each(['register_evidence','finalize_evidence'])('lost %s recovers before any repetition and keeps input until explicit import',async(operation)=>{
 const f=fixture();f.lost=operation;mount(<AttachmentProbe/>);await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText('Pulihkan permintaan lampiran');await waitFor(()=>expect(workspace.evidenceState.unresolved).toBe(true));fireEvent.click(screen.getByText('Pulihkan permintaan lampiran'));await screen.findByText('Buka hasil lampiran tersimpan');expect(localStorage.length).toBe(1);fireEvent.click(screen.getByText('Pertahankan isian lampiran'));expect(localStorage.length).toBe(1);fireEvent.click(screen.getByText('Pulihkan permintaan lampiran'));await screen.findByText('Buka hasil lampiran tersimpan');fireEvent.click(screen.getByText('Buka hasil lampiran tersimpan'));
 if(operation==='register_evidence'){await screen.findByText('Unggahan belum terverifikasi. Periksa lalu lanjutkan dengan berkas yang sama.');f.lost=null;fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));}
 await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);expect(f.commands.filter(c=>c.p_operation===operation)).toHaveLength(1);expect(localStorage.length).toBe(0);
});
test('late download after identity replacement cannot create or retain a browser capability',async()=>{
 const f=fixture();mount(<AttachmentProbe/>);await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));const button=await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);let release:any;wire.invoke.mockImplementation(()=>new Promise(resolve=>{release=resolve}));const create=vi.fn(),revoke=vi.fn();vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=revoke;});await waitFor(()=>{expect(workspace.evidenceState.pending).toBe(false);expect((screen.getByText(`Unduh evidence-${evidenceId}.pdf`) as HTMLButtonElement).disabled).toBe(false);});fireEvent.click(screen.getByText(`Unduh evidence-${evidenceId}.pdf`));await waitFor(()=>expect(release).toBeTypeOf('function'));wire.role='po_admin';await act(async()=>{workspace.setPage(2);});await act(async()=>{release({data:new Blob(['%PDF-1.7\n%%EOF\n']),error:null});});expect(create).not.toHaveBeenCalled();expect(screen.queryByText(`Unduh evidence-${evidenceId}.pdf`)).toBeNull();
});
test('historical sidecar is pinned to the supplied immutable revision and download denial propagates',async()=>{
 const f=fixture();mount(<AttachmentProbe/>);await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);
 const denied=vi.fn();const rev=id(80);mount(<CORevisionAttachment customerId={customer} revisionId={rev} onAuthorityFailure={denied}/>);await waitFor(()=>expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_evidence_selection_v1'&&a.p_revision_id===rev&&a.p_draft_id===null)).toBe(true));wire.invoke.mockResolvedValue({data:null,error:{code:'42501',message:'Download denied'}});await waitFor(()=>expect(screen.getAllByText(`Unduh evidence-${evidenceId}.pdf`)).toHaveLength(2));fireEvent.click(screen.getAllByText(`Unduh evidence-${evidenceId}.pdf`)[1]);await waitFor(()=>expect(denied).toHaveBeenCalled());
});
test('lost upload response checks canonical verification before retrying bytes or finalization',async()=>{
 const f=fixture();const real=wire.invoke.getMockImplementation()!;let calls=0;wire.invoke.mockImplementation(async(...args)=>{const r=await real(...args);if(++calls===1)throw new Error('Upload response lost');return r;});mount(<AttachmentProbe/>);await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findAllByText('Upload response lost');await waitFor(()=>expect(workspace.evidenceState.pending).toBe(false));fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);expect(wire.invoke).toHaveBeenCalledTimes(1);expect(f.commands).toHaveLength(2);
});
test('download is explicit and immediately releases its temporary browser URL',async()=>{
 const f=fixture();mount(<AttachmentProbe/>);await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);await waitFor(()=>expect(workspace.evidenceState.pending).toBe(false));const create=vi.fn(()=> 'blob:synthetic'),revoke=vi.fn(),click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=revoke;});fireEvent.click(await screen.findByText(`Unduh evidence-${evidenceId}.pdf`));await waitFor(()=>expect(click).toHaveBeenCalledOnce());expect(revoke).toHaveBeenCalledWith('blob:synthetic');expect(document.querySelector('iframe,embed,object,img')).toBeNull();click.mockRestore();
});
test('a failed finalized-draft import after concurrent report change preserves the old overlay and does not acknowledge recovery',async()=>{
 const f=fixture();f.lost='finalize_evidence';mount(<AttachmentProbe/>);fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'12'}});await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText('Pulihkan permintaan lampiran');await waitFor(()=>expect(workspace.evidenceState.pending).toBe(false));f.s.version='3';fireEvent.click(screen.getByText('Pulihkan permintaan lampiran'));fireEvent.click(await screen.findByText('Buka hasil lampiran tersimpan'));await screen.findByText('Coba buka hasil lampiran');await waitFor(()=>expect(workspace.stale).toBe(true));expect(workspace.header.draft_version).toBe('1');expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('12');expect(localStorage.length).toBe(1);expect(workspace.evidenceState.unresolved).toBe(true);expect(f.commands).toHaveLength(2);
});
test('a retained historical download cannot report denial to a replacement owner callback',async()=>{
 const f=fixture();mount(<AttachmentProbe/>);await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);await waitFor(()=>expect(workspace.evidenceState.pending).toBe(false));
 const first=vi.fn(),second=vi.fn();let replace!:()=>void;const {useState}=await import('react');function Owner(){const [changed,set]=useState(false);replace=()=>set(true);return <CORevisionAttachment customerId={customer} revisionId={id(90)} onAuthorityFailure={changed?second:first}/>;}
 mount(<Owner/>);await waitFor(()=>expect(screen.getAllByText(`Unduh evidence-${evidenceId}.pdf`)).toHaveLength(2));let release:any;wire.invoke.mockImplementation(()=>new Promise(resolve=>{release=resolve}));fireEvent.click(screen.getAllByText(`Unduh evidence-${evidenceId}.pdf`)[1]);await waitFor(()=>expect(release).toBeTypeOf('function'));await act(async()=>replace());await act(async()=>release({data:null,error:{code:'42501',message:'Old denial'}}));expect(second).not.toHaveBeenCalled();expect(first).toHaveBeenCalledOnce();
});
test('unmount during recovered-finalization acknowledgement retains the original supporting recovery record',async()=>{
 const f=fixture();f.lost='finalize_evidence';const {router}=mount(<AttachmentProbe/>);await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText('Pulihkan permintaan lampiran');await waitFor(()=>expect(workspace.evidenceState.pending).toBe(false));fireEvent.click(screen.getByText('Pulihkan permintaan lampiran'));await screen.findByText('Buka hasil lampiran tersimpan');const before=localStorage.getItem(localStorage.key(0)!);const base=wire.handler;let release:any;wire.handler=async(n:string,a:any)=>n==='pilot_reconcile_co_evidence_v1'?new Promise(resolve=>{release=async()=>resolve(await base(n,a));}):base(n,a);fireEvent.click(screen.getByText('Buka hasil lampiran tersimpan'));await waitFor(()=>expect(release).toBeTypeOf('function'));await act(async()=>{await router.navigate('/destination');});await act(async()=>{await release();});expect(localStorage.getItem(localStorage.key(0)!)).toBe(before);
});

async function enterFinalizationConflict(reload=false, operation='finalize_evidence'){
 const f=fixture();f.lost=operation;mount(<COMonthlyReport/>);
 fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'12'}});
 await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));
 await screen.findByText('Pulihkan permintaan lampiran');
 await waitFor(()=>expect((screen.getByText('Pulihkan permintaan lampiran') as HTMLButtonElement).disabled).toBe(false));
 f.s.version='3';f.s.rows[0].sold_quantity='4';f.s.metadata.notes='Latest operator note';
 if(reload){cleanup();mount(<COMonthlyReport/>);await screen.findByLabelText('Terjual Item 1');}
 fireEvent.click(await screen.findByText('Pulihkan permintaan lampiran'));
 fireEvent.click(await screen.findByText('Buka hasil lampiran tersimpan'));
 await screen.findByText('Coba buka hasil lampiran');
 await waitFor(()=>expect((screen.getByText('Coba buka hasil lampiran') as HTMLButtonElement).disabled).toBe(false));
 return f;
}
test.each([false,true])('explicit evidence conflict Keep/Discard resolves and permits the next business write (reload=%s)',async(reload)=>{
 const f=await enterFinalizationConflict(reload),key=localStorage.key(0)!,before=localStorage.getItem(key);
 fireEvent.click(screen.getByText('Selesaikan konflik lampiran'));
 fireEvent.click(await screen.findByText('Tetap mengedit'));
 expect(localStorage.getItem(key)).toBe(before);expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe(reload?'4':'12');expect(f.s.commands).toHaveLength(0);
 await waitFor(()=>expect((screen.getByText('Selesaikan konflik lampiran') as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByText('Selesaikan konflik lampiran'));fireEvent.click(await screen.findByText('Buang perubahan'));
 await waitFor(()=>expect(localStorage.length).toBe(0));
 await waitFor(()=>expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).disabled).toBe(false));
 expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('4');expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Latest operator note');
 fireEvent.change(screen.getByLabelText('Terjual Item 1'),{target:{value:'5'}});fireEvent.click(screen.getByText('Simpan Draft'));
 await waitFor(()=>expect(f.s.commands).toHaveLength(1));expect(f.s.commands[0].payload).toMatchObject({action:'upsert_lines',expected_draft_version:'3',lines:[{stock_key_id:id(1001),sold_quantity:5}]});expect(f.commands).toHaveLength(2);
});
test.each(['register_evidence','finalize_evidence'])('explicit %s conflict interrupted during acknowledgement preserves the original receipt and replacement owner',async(operation)=>{
 await enterFinalizationConflict(false,operation);const key=localStorage.key(0)!,before=localStorage.getItem(key),base=wire.handler;let release:any;
 wire.handler=(n:string,a:any)=>n==='pilot_reconcile_co_evidence_v1'?new Promise(resolve=>{release=async()=>resolve(await base(n,a));}):base(n,a);
 fireEvent.click(screen.getByText('Selesaikan konflik lampiran'));fireEvent.click(await screen.findByText('Buang perubahan'));
 await waitFor(()=>expect(release).toBeTypeOf('function'));cleanup();mount(<COMonthlyReport/>);await screen.findByLabelText('Terjual Item 1');
 await act(async()=>{await release();});expect(localStorage.getItem(key)).toBe(before);expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('4');expect(screen.queryByText('Buang perubahan')).toBeNull();
});
test.each([['receipt','register_evidence'],['authority','register_evidence'],['receipt','finalize_evidence'],['authority','finalize_evidence']])('explicit conflict %s / %s failure never discards the original recovery or stale overlay',async(kind,operation)=>{
 await enterFinalizationConflict(false,operation);const key=localStorage.key(0)!,before=localStorage.getItem(key),base=wire.handler;
 wire.handler=async(n:string,a:any)=>{const result=await base(n,a);if(kind==='receipt'&&n==='pilot_reconcile_co_evidence_v1')result.data.receipt={...result.data.receipt,version:'99'};if(kind==='authority'&&n==='pilot_co_evidence_v1')return {data:null,error:{code:'42501',message:'Conflict authority denied'}};return result;};
 fireEvent.click(screen.getByText('Selesaikan konflik lampiran'));fireEvent.click(await screen.findByText('Buang perubahan'));
 if(kind==='authority'){await screen.findByText('Conflict authority denied');expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();}
 else {await waitFor(()=>expect((screen.getByText('Selesaikan konflik lampiran') as HTMLButtonElement).disabled).toBe(false));expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('12');}
 expect(localStorage.getItem(key)).toBe(before);
});
test.each(['register_evidence','finalize_evidence'])('nested %s conflict uses the source discard dialog and retains pending ownership until acknowledged',async(operation)=>{
 const {default:COCorrectionDialog}=await import('../../src/components/co/COCorrectionDialog');const {useCOTransactionSender}=await import('../../src/lib/co/transactions');
 const f=fixture();f.lost=operation;f.s.impacts.missing_month=[{report_month:month,reason:'missing',head_id:null,coverage_through_date:null}];const pending=vi.fn();
 function Owner(){const sender=useCOTransactionSender({formScope:'nested-conflict',customerId:customer});return <COCorrectionDialog operation="correct_report" customerId={customer} selectedMonth="2026-08-01" source={{draft_id:draftId,expected_draft_version:'1',expected_customer_version:'1',eligible_set_fingerprint:'a'.repeat(64),report_head_id:id(4),original_revision_id:id(5),expected_report_version:'1'}} sender={sender} current={()=>wire.actor} onAccepted={async()=>true} onClose={()=>{}} onPendingChange={pending} returnFocus={null}/>;}
 mount(<Owner/>);fireEvent.change(await screen.findByLabelText('Alasan perubahan'),{target:{value:'Keep source reason'}});fireEvent.click(screen.getByText('Tinjau semua dampak'));fireEvent.click(await screen.findByText('Lengkapi periode 2026-09'));const refresh=await screen.findByText('Perbarui periode terhadap sumber usulan');await waitFor(()=>expect((refresh as HTMLButtonElement).disabled).toBe(false));fireEvent.click(refresh);fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'12'}});
 await choose();fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));await screen.findByText('Pulihkan permintaan lampiran');await waitFor(()=>expect((screen.getByText('Pulihkan permintaan lampiran') as HTMLButtonElement).disabled).toBe(false));
 f.s.version='4';f.s.rows[0].sold_quantity='4';fireEvent.click(screen.getByText('Pulihkan permintaan lampiran'));fireEvent.click(await screen.findByText('Buka hasil lampiran tersimpan'));await screen.findByText('Coba buka hasil lampiran');await waitFor(()=>expect((screen.getByText('Selesaikan konflik lampiran') as HTMLButtonElement).disabled).toBe(false));expect(pending).toHaveBeenLastCalledWith(true);expect((screen.getByText('Kembali ke sumber') as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByText('Selesaikan konflik lampiran'));fireEvent.click(await screen.findByText('Tetap mengedit'));expect(localStorage.length).toBe(1);await waitFor(()=>expect((screen.getByText('Selesaikan konflik lampiran') as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByText('Selesaikan konflik lampiran'));fireEvent.click(await screen.findByText('Buang perubahan'));
 await waitFor(()=>expect(localStorage.length).toBe(0));await waitFor(()=>expect(pending).toHaveBeenLastCalledWith(false));expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('4');fireEvent.change(screen.getByLabelText('Terjual Item 1'),{target:{value:'5'}});fireEvent.click(screen.getByText('Simpan Draft periode'));await waitFor(()=>expect(f.s.commands).toHaveLength(2));expect(f.s.commands[1].payload.expected_draft_version).toBe('4');expect(f.commands).toHaveLength(operation==='register_evidence'?1:2);
});

test.each(['pending', 'verified'])('another actor’s %s duplicate is an actionable conflict preserving dirty report fields', async () => {
    const f = fixture(), base = wire.handler;
    wire.handler = async (name: string, args: any) => name === 'pilot_co_evidence_transaction_v1'
        ? { data: null, error: { code: 'PT409', message: 'CO_EVIDENCE_REGISTERED_BY_OTHER_ACTOR' } } : base(name, args);
    mount(<COMonthlyReport/>);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Catatan laporan'), { target: { value: 'Keep authorized dirty note' } });
    await choose(); fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));
    await screen.findAllByText(/Berkas yang sama telah didaftarkan operator lain/);
    expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('Catatan laporan') as HTMLTextAreaElement).value).toBe('Keep authorized dirty note');
    expect(wire.invoke).not.toHaveBeenCalled(); expect(f.commands).toHaveLength(0);
    fireEvent.click(screen.getByText('Batalkan pilihan lampiran'));
    await waitFor(() => expect((screen.getByText('Simpan Draft') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Simpan Draft'));
    await waitFor(() => expect(f.s.commands).toHaveLength(2));
});

async function enterRegistrationConflict(lost: boolean, reload = false, advanceCustomer = false, sameTarget = true) {
    const f = fixture(); if (lost) f.lost = 'register_evidence';
    const base = wire.handler; let firstRead = true;
    wire.handler = async (name: string, args: any) => {
        if (!lost && name === 'pilot_co_evidence_v1' && firstRead) {
            firstRead = false;
            return { data: null, error: { code: '08006', message: 'Registration import unavailable' } };
        }
        return base(name, args);
    };
    mount(<COMonthlyReport/>);
    fireEvent.change(await screen.findByLabelText('Terjual Item 1'), { target: { value: '12' } });
    await choose(); fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));
    await screen.findByText(lost ? 'Pulihkan permintaan lampiran' : 'Coba buka hasil lampiran');
    await waitFor(() => expect((screen.getByText(lost ? 'Pulihkan permintaan lampiran' : 'Coba buka hasil lampiran') as HTMLButtonElement).disabled).toBe(false));
    if (sameTarget) f.s.version = '2'; if (advanceCustomer) f.s.cv = '3';
    f.s.rows[0].sold_quantity = '4'; f.s.metadata.notes = 'Current canonical note';
    if (reload) { cleanup(); mount(<COMonthlyReport/>); await screen.findByLabelText('Terjual Item 1'); }
    if (lost || reload) {
        fireEvent.click(await screen.findByText('Pulihkan permintaan lampiran'));
        fireEvent.click(await screen.findByText('Buka hasil lampiran tersimpan'));
        await screen.findByText('Coba buka hasil lampiran');
    }
    return f;
}
test.each([[false,false,false,true],[true,false,false,true],[false,true,true,true],[true,true,true,true],[false,false,true,false],[true,true,true,false]])('registration recovery known/lost=%s reload=%s customer advance=%s same-target=%s preserves exact receipt until deliberate discard', async (lost,reload,customerAdvance,sameTarget) => {
    const f = await enterRegistrationConflict(lost,reload,customerAdvance,sameTarget);
    const key = localStorage.key(0)!, before = localStorage.getItem(key);
    expect(JSON.parse(before!).committed).toMatchObject({ operation: 'register_evidence', version: '1', customer_version: '1' });
    fireEvent.click(await screen.findByText('Selesaikan konflik lampiran'));
    fireEvent.click(await screen.findByText('Tetap mengedit'));
    expect(localStorage.getItem(key)).toBe(before);
    expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe(reload ? '4' : '12');
    await waitFor(() => expect((screen.getByText('Selesaikan konflik lampiran') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Selesaikan konflik lampiran')); fireEvent.click(await screen.findByText('Buang perubahan'));
    await waitFor(() => expect(localStorage.length).toBe(0));
    await screen.findByLabelText('Terjual Item 1');
    expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Catatan laporan') as HTMLTextAreaElement).value).toBe('Current canonical note');
    await waitFor(() => expect(screen.getByLabelText('Terjual Item 1').matches(':disabled')).toBe(false));
    fireEvent.change(screen.getByLabelText('Terjual Item 1'), { target: { value: '5' } });
    await waitFor(() => expect((screen.getByText('Simpan Draft') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Simpan Draft'));
    await waitFor(() => expect(f.s.commands).toHaveLength(1));
    expect(f.s.commands[0].payload.expected_draft_version).toBe(sameTarget ? '2' : '1'); expect(f.commands).toHaveLength(1);
});

test('registration conflict retains receipt and dirty fields if a later canonical row page cannot be checked', async () => {
    const f = await enterRegistrationConflict(true), key = localStorage.key(0)!, before = localStorage.getItem(key);
    f.s.rows.push(...Array.from({ length: 100 }, (_, index) => ({ ...f.s.rows[0], id: id(1002 + index), stock_key_id: id(1002 + index), product_name: `Item ${index + 2}`, display_sku: `SKU-${index + 2}` })));
    const base = wire.handler; let failed = true;
    wire.handler = async (name: string, args: any) => failed && name === 'pilot_co_report_rows_v1' && args.p_page === 2
        ? { data: null, error: { code: '08006', message: 'Later canonical page unavailable' } } : base(name, args);
    fireEvent.click(await screen.findByText('Selesaikan konflik lampiran')); fireEvent.click(await screen.findByText('Buang perubahan'));
    await screen.findAllByText('Later canonical page unavailable');
    expect(localStorage.getItem(key)).toBe(before);
    expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('12');
    failed = false;
    await waitFor(() => expect((screen.getByText('Selesaikan konflik lampiran') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Selesaikan konflik lampiran')); fireEvent.click(await screen.findByText('Buang perubahan'));
    await waitFor(() => expect(localStorage.length).toBe(0));
    await waitFor(() => expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('4'));
    expect(f.commands).toHaveLength(1);
});
