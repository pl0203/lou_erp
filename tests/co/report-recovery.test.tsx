import { openCommitReview } from './import-commit-transport-harness';
import { expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { store, mount, wire, customer, draftId, id, month, hash } from './report-ui-harness';
import COCorrectionDialog from '../../src/components/co/COCorrectionDialog';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import { useCOTransactionSender } from '../../src/lib/co/transactions';

import {COReportFields,useCOReportWorkspace,type COReportWorkspace} from '../../src/components/co/COReportWorkspace';
import {COFailure,CORecoveryPanel} from '../../src/components/co/COShared';
// Public production workspace UNIT, not an invented initial manual route.
let ordinaryWork:COReportWorkspace;
function OrdinaryWorkspaceUnit(){
 ordinaryWork=useCOReportWorkspace(customer,month);
 return <>{ordinaryWork.header?<COReportFields work={ordinaryWork}/>:ordinaryWork.authorityError?<COFailure error={ordinaryWork.authorityError} retry={ordinaryWork.retryAuthority}/>:null}
 <CORecoveryPanel confirmed={!!ordinaryWork.confirmed} pending={ordinaryWork.pending} sender={ordinaryWork.sender} current={()=>ordinaryWork.current()&&!ordinaryWork.pending} accept={receipt=>ordinaryWork.acceptCanonical(receipt,true)}/></>;
}
async function invokeOrdinary(action:()=>Promise<unknown>){await act(async()=>{try{await action()}catch{/* Public workspace error/authority state asserted below. */}})}

const nestedMonth = '2026-08-01';
const denied = { data: null, error: { code: '42501', message: 'Report authority denied' } };
const offline = { data: null, error: { code: '08006', message: 'Canonical report offline' } };
const click = async (name: string) => {const button=await screen.findByRole('button',{name,exact:true});await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(false));fireEvent.click(button);};
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const privateQueries = (client: ReturnType<typeof mount>['client']) =>
    client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.state.data);

function Review() {
    const sender = useCOTransactionSender({ formScope: 'recovery-review', customerId: customer });
    return <COCorrectionDialog
        operation="correct_report"
        customerId={customer}
        selectedMonth={month}
        source={{
            draft_id: draftId, expected_draft_version: '1', expected_customer_version: '1',
            eligible_set_fingerprint: hash, report_head_id: id(4),
            original_revision_id: id(5), expected_report_version: '1',
        }}
        sender={sender}
        current={() => wire.actor}
        onAccepted={async () => true}
        onClose={() => {}}
        returnFocus={null}
    />;
}

async function openNested(primaryOwner = false) {
    const primary = store();
    primary.rows[0].sold_quantity = '70';
    primary.impacts.missing_month = [{
        report_month: nestedMonth, reason: 'missing', head_id: null, coverage_through_date: null,
    }];
    if (primaryOwner) {
        primary.metadata.notes = 'Primary private note';
        primary.effective = {
            ...primary.header(), id: id(4), status: 'posted', draft_id: null, draft_version: null,
            report_head_id: id(4), revision_id: id(5), report_version: '1',
            eligible_set_fingerprint: null, revenue: '700000',
        };
    }
    const nested = store(1, nestedMonth, id(50));
    let last = primary;
    const route = async (name: string, args: any) => {
        if(primaryOwner&&name==='pilot_co_report_allocations_v1'){
            expect(args).toMatchObject({p_customer_id:customer,p_month:month,p_revision_id:id(5),p_expected_customer_version:'1'});
            const rows=[{id:id(400),customer_id:customer,report_revision_id:id(5),report_month:month,stock_key_id:id(1001),batch_id:id(401),co_id:id(402),co_number:'HISTORICAL-CO',co_line_id:id(403),delivery_head_id:id(404),delivery_revision_id:id(405),sj_number:'HISTORICAL-SJ',sj_date:month,quantity:'70',unit_price:'10000',amount:'700000',sales_person_name:null,sales_person_id_at_creation:null,sales_assignment_source_id:null,sales_attributed_at:'2026-09-01T00:00:00Z',sales_attribution_state:'unassigned'}];
            return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'70',amount:'700000'},page:args.p_page,page_size:args.p_page_size,total:'1',rows:rows.slice((args.p_page-1)*args.p_page_size,args.p_page*args.p_page_size)},error:null};
        }
        if (name === 'pilot_co_transaction_v1') {
            last = args.p_payload.draft_id === id(50) || args.p_payload.report_month === nestedMonth
                ? nested : primary;
            return last.handle(name, args);
        }
        if (name === 'pilot_reconcile_co_v1') return last.handle(name, args);
        if (name === 'pilot_co_report_v1' || name === 'pilot_co_report_rows_v1') {
            return (args.p_month === nestedMonth ? nested : primary).handle(name, args);
        }
        return primary.handle(name, args);
    };
    wire.handler = route;
    const view = mount(primaryOwner ? <COMonthlyReport /> : <Review />);
    if (primaryOwner) {
        await screen.findByText('Alokasi sesuai jumlah');
        await click('Edit');
        const begin=await screen.findByRole('button',{name:'Mulai Edit dari laporan tercatat'});
        await waitFor(()=>expect(begin.hasAttribute('disabled')).toBe(false));
        expect(wire.rpc).toHaveBeenCalledWith('pilot_co_report_import_v1',{p_customer_id:customer,p_month:month,p_revision_id:id(5)});
        fireEvent.click(begin);await click('Ganti isian tersimpan');
        await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau perubahan'}).hasAttribute('disabled')).toBe(false));
        expect(screen.getByDisplayValue('Primary private note')).toBeTruthy();
        expect(primary.commands).toHaveLength(1);expect(primary.commands[0].payload).toMatchObject({action:'initialize',seed_effective_revision_id:id(5),expected_draft_version:'1',expected_customer_version:'1'});
        await click('Tinjau perubahan');
    }
    await screen.findByLabelText('Alasan perubahan');
    change('Alasan perubahan', 'Correct source');
    expect(screen.getByDisplayValue('Correct source')).toBeTruthy();
    await click('Tinjau semua dampak');
    await click('Lengkapi periode 2026-08');
    await waitFor(() => expect(screen.getByRole('button', {
        name: 'Perbarui periode terhadap sumber usulan',
    }).hasAttribute('disabled')).toBe(false));
    await click('Perbarui periode terhadap sumber usulan');
    const editor = primaryOwner
        ? within(screen.getByRole('dialog', { name: 'Tinjau perubahan tercatat' })) : screen;
    fireEvent.change(await editor.findByLabelText('Terjual Item 1'), { target: { value: '7' } });
    fireEvent.change(editor.getByLabelText('Catatan laporan'), { target: { value: 'Private unsent note' } });
    return { ...view, primary, nested, route };
}

test('nested known-committed retry preserves unsent metadata through repeated canonical failures', async () => {
    const { nested } = await openNested();
    nested.fail = (name: string) => name === 'pilot_co_report_v1'
        && nested.commands.some((c: any) => c.payload.action === 'upsert_lines') ? offline : null;
    await click('Lanjutkan peninjauan periode');
    await screen.findAllByText('Canonical report offline');
    expect(nested.commands).toHaveLength(2); // initialize and the committed row chunk
    expect(screen.getByRole('button', { name: 'Lanjutkan peninjauan periode' }).hasAttribute('disabled')).toBe(true);

    await click('Buka hasil laporan tersimpan');
    await waitFor(() => expect(screen.getByRole('button', {
        name: 'Buka hasil laporan tersimpan',
    }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByDisplayValue('Private unsent note')).toBeTruthy();
    expect(nested.commands).toHaveLength(2);

    nested.fail = null;
    await click('Buka hasil laporan tersimpan');
    await waitFor(() => expect(screen.getByRole('button', {
        name: 'Lanjutkan peninjauan periode',
    }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByDisplayValue('Private unsent note')).toBeTruthy();
    expect(screen.queryByText('Buang perubahan?')).toBeNull();
    await click('Lanjutkan peninjauan periode');
    await waitFor(() => expect(nested.commands).toHaveLength(3));
    expect(nested.commands[2].payload).toMatchObject({
        action: 'set_metadata', expected_draft_version: '3', notes: 'Private unsent note',
    });
});

test('nested uncertain save recovers its own request, retains Keep and failed imports, then awaits acknowledgement', async () => {
    const { nested, primary, route } = await openNested();
    let unknown = true;
    let loseResponse = true;
    let releaseAcknowledgement: (() => void) | undefined;
    let delayAcknowledgement = false;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_reconcile_co_v1' && unknown) return { data: { status: 'unknown' }, error: null };
        if (name === 'pilot_reconcile_co_v1' && delayAcknowledgement) {
            await new Promise<void>(resolve => { releaseAcknowledgement = resolve; });
        }
        const result = await route(name, args);
        if (name === 'pilot_co_transaction_v1' && loseResponse) {
            loseResponse = false;
            return offline;
        }
        return result;
    };
    await click('Lanjutkan peninjauan periode');
    await screen.findAllByText('Canonical report offline');
    const pending = JSON.parse(localStorage.getItem(localStorage.key(0)!)!);
    expect(pending.binding.draft_id).toBe(id(50));
    expect(primary.commands).toHaveLength(0);
    await click('Pulihkan hasil penyimpanan');
    await screen.findAllByText('Hasil belum dapat dipastikan. Jangan buat permintaan baru.');
    expect(screen.getByDisplayValue('Private unsent note')).toBeTruthy();

    unknown = false;
    await click('Pulihkan hasil penyimpanan');
    await click('Lihat hasil tersimpan');
    await click('Tetap mengedit');
    expect(screen.getByDisplayValue('Private unsent note')).toBeTruthy();
    expect(localStorage.length).toBe(1);

    nested.fail = (name: string) => name === 'pilot_co_report_v1' ? offline : null;
    await click('Lihat hasil tersimpan');
    await click('Buang perubahan');
    await screen.findAllByText('Canonical report offline');
    expect(screen.getByDisplayValue('Private unsent note')).toBeTruthy();
    expect(localStorage.length).toBe(1);

    nested.fail = null;
    delayAcknowledgement = true;
    await click('Lihat hasil tersimpan');
    await click('Buang perubahan');
    await waitFor(() => expect(releaseAcknowledgement).toBeTypeOf('function'));
    expect(screen.getByDisplayValue('Private unsent note')).toBeTruthy();
    expect(localStorage.length).toBe(1);
    delayAcknowledgement = false;
    await act(async () => releaseAcknowledgement!());
    await waitFor(() => expect(screen.queryByDisplayValue('Private unsent note')).toBeNull());
    expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('7');
    expect(localStorage.length).toBe(0);
    expect(nested.commands).toHaveLength(2);
    expect(wire.rpc.mock.calls.filter(([name, args]) => name === 'pilot_reconcile_co_v1'
        && args.p_abandon).every(([, args]) => args.p_request_id === pending.id)).toBe(true);
});

test('nested canonical authority denial clears private fields and cache until explicit retry', async () => {
    const { nested, client } = await openNested();
    let denials = 0;
    nested.fail = (name: string) => {
        if (name !== 'pilot_co_report_v1' || nested.commands.length < 2) return null;
        denials++;
        return denied;
    };
    await click('Lanjutkan peninjauan periode');
    await screen.findByText('Report authority denied');
    expect(screen.queryByLabelText('Catatan laporan')).toBeNull();
    expect(screen.queryByDisplayValue('Private unsent note')).toBeNull();
    expect(privateQueries(client)).toHaveLength(0);
    await act(async () => new Promise(resolve => setTimeout(resolve, 25)));
    expect(denials).toBe(1);
    nested.fail = null;
    await click('Coba lagi');
    await screen.findByLabelText('Catatan laporan');
    expect(screen.queryByDisplayValue('Private unsent note')).toBeNull();
});

test.each(['initialize', 'authorization', 'import', 'known-retry', 'transaction'])(
    'ordinary workspace UNIT %s authority denial clears private fields and cache instead of offering an offline state',
    async phase => {
        const s = store();
        const { client } = mount(<OrdinaryWorkspaceUnit />);
        await screen.findByLabelText('Terjual Item 1');
        change('Terjual Item 1', '7');
        change('Catatan laporan', 'Private unsent note');
        if (phase === 'initialize') {
            s.cv = '2';
            await client.invalidateQueries({ queryKey: ['co'] });
            await screen.findByText(/Versi atau sumber berubah/);
        }
        s.fail = (name: string) => {
            if (phase === 'authorization' && name === 'pilot_my_profile') return denied;
            if (phase === 'transaction' && name === 'pilot_co_transaction_v1') return denied;
            if (name !== 'pilot_co_report_v1') return null;
            if (phase === 'initialize') return denied;
            if (s.commands.length) return phase === 'known-retry' ? offline : denied;
            return null;
        };
        await invokeOrdinary(()=>phase==='initialize'?ordinaryWork.initialize():ordinaryWork.save());
        if (phase === 'known-retry') {
            await screen.findByText('Canonical report offline');
            s.fail = (name: string) => name === 'pilot_co_report_v1' ? denied : null;
            expect(ordinaryWork.confirmed).not.toBeNull();
            await invokeOrdinary(()=>ordinaryWork.acceptCanonical(ordinaryWork.confirmed!));
        }
        await screen.findByText('Report authority denied');
        expect(screen.queryByLabelText('Catatan laporan')).toBeNull();
        expect(screen.queryByDisplayValue('Private unsent note')).toBeNull();
        expect(privateQueries(client)).toHaveLength(0);
        s.fail = null;
        await click('Coba lagi');
        await screen.findByLabelText('Catatan laporan');
        expect(screen.queryByDisplayValue('Private unsent note')).toBeNull();
    },
);

// Current upload mapping of the same three authority boundaries. Manual draft
// save controls are retired; exact request identity remains tested through the
// real production import sender and shared durable transaction implementation.
test.each(['reconcile', 'recovered-import', 'acknowledge'])(
    'current upload %s authority denial latches without discarding original committed request identity',
    async phase => {
        const {f,record,client}=await openCommitReview();
        expect(screen.getByDisplayValue('PRIVATE COMMIT REVIEW')).toBeTruthy();
        expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');
        expect(screen.getAllByText('TEST ONLY MONTHLY QA').length).toBeGreaterThan(0);
        f.commitState.lostReply=true;fireEvent.click(record);await screen.findByText('Commit reply lost');
        const original=JSON.parse(localStorage.getItem(localStorage.key(0)!)!);
        expect(original.id).toBe(f.requestId);expect(original.binding.binding).toEqual(f.originalBinding);
        const base=wire.handler;let canonicalSeen=false,denialEntered=false;
        wire.handler=async(n:string,a:any)=>{
            if(phase==='reconcile'&&n==='pilot_co_import_reconcile_v1'||phase==='recovered-import'&&n==='pilot_co_import_read_v1'||phase==='acknowledge'&&canonicalSeen&&n==='pilot_my_profile'){
                denialEntered=true;return denied;
            }
            const result=await base(n,a);if(n==='pilot_co_report_v1')canonicalSeen=true;return result;
        };
        await click('Periksa hasil pencatatan');await screen.findByText('Report authority denied');expect(denialEntered).toBe(true);
        expect(screen.queryByDisplayValue('PRIVATE COMMIT REVIEW')).toBeNull();expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();expect(screen.queryAllByText('TEST ONLY MONTHLY QA')).toHaveLength(0);
        expect(screen.queryByRole('heading',{name:/Store A/})).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(privateQueries(client)).toHaveLength(0);
        const retained=JSON.parse(localStorage.getItem(localStorage.key(0)!)!);expect(retained.id).toBe(original.id);expect(retained.binding).toEqual(original.binding);
        if(phase!=='reconcile')expect(retained.committed).toEqual(f.receipt);
        expect(f.commitState.commitCalls).toHaveLength(1);expect(f.writes).toHaveLength(5);
        const count=wire.rpc.mock.calls.length;await act(async()=>{await client.invalidateQueries({queryKey:['co']});});expect(wire.rpc.mock.calls).toHaveLength(count);
    },
);


test('embedded nested authority denial also clears the primary report owner private snapshot', async () => {
    const { nested,primary,client } = await openNested(true);
    // Primary fields are intentionally replaced by review; its private source is
    // retained in checked cache. The primary reason was verified before entering
    // the nested pane; the nested private note is visible here.
    expect(JSON.stringify(privateQueries(client).map(q=>q.state.data))).toContain('Primary private note');
    expect(screen.getByDisplayValue('Private unsent note')).toBeTruthy();
    nested.fail = (name: string) => name === 'pilot_co_report_v1'
        && nested.commands.some((command: any) => command.payload.action === 'upsert_lines') ? denied : null;
    await click('Lanjutkan peninjauan periode');
    await screen.findByText('Report authority denied');
    expect(screen.queryByDisplayValue('Private unsent note')).toBeNull();
    expect(screen.queryByDisplayValue('Primary private note')).toBeNull();
    expect(screen.queryByDisplayValue('Correct source')).toBeNull();expect(privateQueries(client)).toHaveLength(0);
    expect(primary.commands).toHaveLength(1);expect(nested.commands).toHaveLength(2);
});

test.each([false, true])('nested SJ authority denial clears the complete source with standalone=%s', async standalone => {
    const { deliveryFixture } = await import('./report-ui-harness');
    const { default: CODetail } = await import('../../src/pages/athel/co/CODetail');
    const { default: CODeliveryDialog } = await import('../../src/components/co/CODeliveryDialog');
    const nested = store(1, nestedMonth, id(50));
    const source = deliveryFixture();
    source.co.notes = 'Private CO source note';
    const sourceHandler = wire.handler;
    let nestedCommand = false;
    wire.handler = async (name: string, args: any) => {
        if (name === 'pilot_co_transaction_v1' && args.p_operation === 'save_report_draft') {
            nestedCommand = true;
            return nested.handle(name, args);
        }
        if (name === 'pilot_reconcile_co_v1' && nestedCommand) return nested.handle(name, args);
        if ((name === 'pilot_co_report_v1' || name === 'pilot_co_report_rows_v1')
            && args.p_month === nestedMonth) return nested.handle(name, args);
        const result = await sourceHandler(name, args);
        if (name === 'pilot_co_preview_v1') {
            result.data.counts.missing_month = '1';
            result.data.can_post = false;
        }
        if (name === 'pilot_co_preview_labeled_impacts_v1' && args.p_kind === 'missing_month') {
            result.data.total = '1';
            result.data.rows = [{
                report_month: nestedMonth, reason: 'missing', head_id: null, coverage_through_date: null,
                labels:{sku:null,productName:null,coNumber:null,sjNumber:null,picName:null},
            }];
        }
        return result;
    };
    const { client } = mount(standalone ? <CODeliveryDialog
        co={source.co}
        correctionSource={{ headId: id(12), revisionId: id(13), version: '2', action: 'replace' }}
        onClose={() => {}}
        returnFocus={null}
    /> : <CODetail />, `/athel/co/${id(10)}`);
    if (!standalone) await click('Siapkan pengganti SJ');
    await screen.findByLabelText('Jumlah dikirim Item 1');
    await click('Simpan Draft SJ');
    await waitFor(() => expect(screen.getByRole('button', {
        name: 'Tinjau perubahan SJ',
    }).hasAttribute('disabled')).toBe(false));
    await click('Tinjau perubahan SJ');
    change('Alasan perubahan', 'Correct SJ source');
    await click('Tinjau semua dampak');
    await click('Lengkapi periode 2026-08');
    await waitFor(() => expect(screen.getByRole('button', {
        name: 'Perbarui periode terhadap sumber usulan',
    }).hasAttribute('disabled')).toBe(false));
    await click('Perbarui periode terhadap sumber usulan');
    await screen.findByLabelText('Terjual Item 1');
    change('Terjual Item 1', '7');
    change('Catatan laporan', 'Private nested note');
    expect(screen.getByDisplayValue('Private nested note')).toBeTruthy();
    expect(JSON.stringify(privateQueries(client).map(q=>q.state.data))).toContain('Private CO source note');
    expect(wire.rpc.mock.calls.filter(([n,a])=>n==='pilot_co_preview_labeled_impacts_v1'&&a.p_kind==='missing_month').length).toBeGreaterThan(0);
    for(const [,args] of wire.rpc.mock.calls.filter(([n,a])=>n==='pilot_co_preview_labeled_impacts_v1'&&a.p_kind==='missing_month'))expect(args).toMatchObject({p_operation:'correct_sj',p_customer_id:customer,p_expected_customer_version:'1',p_preview_fingerprint:'b'.repeat(64),p_payload:{delivery_head_id:id(12),original_revision_id:id(13),expected_delivery_version:'2'}});
    nested.fail = (name: string) => name === 'pilot_co_report_v1'
        && nested.commands.length > 1 ? denied : null;
    await click('Lanjutkan peninjauan periode');
    await screen.findByText('Report authority denied');
    expect(screen.queryByDisplayValue('Private nested note')).toBeNull();
    expect(screen.queryByText('Private CO source note')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(privateQueries(client)).toHaveLength(0);
    expect(source.commands).toHaveLength(1);expect(nested.commands).toHaveLength(2);
    nested.fail = null;
    await click('Coba lagi');
    if (standalone) {
        await screen.findByLabelText('Jumlah dikirim Item 1');
        expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();
        expect(screen.queryByLabelText('Catatan laporan')).toBeNull();
    } else {
        await screen.findByRole('heading',{name:'CO-1',exact:true});
        expect(JSON.stringify(privateQueries(client).map(q=>q.state.data))).toContain('Private CO source note');
        expect(screen.queryByRole('dialog')).toBeNull();
    }
});
