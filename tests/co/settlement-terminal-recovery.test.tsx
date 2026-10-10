import React from 'react';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { stockFixture, mountApp, wire, id } from './stock-ui-harness';
import App from '../../src/App';
const pending = () => Object.keys(localStorage).filter(k => k.startsWith('co-request:'));
const path = `/athel/co/${id(11)}`;
async function click(name: string) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.matches(':disabled')).toBe(false)); fireEvent.click(button);
}
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
type Operation = 'resolve_undelivered' | 'close_co';
async function begin(operation: Operation, lost: boolean, newer: boolean) {
    const s = stockFixture();
    s.co.summary.remaining_quantity = '0'; s.co.summary.sold_quantity = '70';
    s.batches.forEach((b: any) => { b.available_quantity = '0'; }); s.blockers.stock_remains = false;
    if (operation === 'close_co') {
        s.co.summary.pending_quantity = s.lines[0].pending_quantity = '0';
        s.co.summary.resolved_undelivered_quantity = s.lines[0].resolved_undelivered_quantity = '30';
        s.blockers.undelivered_remains = false;
    }
    // The real detail SQL removes resolve when pending reaches zero, and both actions when closed.
    let executed = false, rejectInitialImport = false;
    s.fail = async (name: string, args: any) => {
        if (name === 'pilot_co_detail_v1') {
            s.allowed = s.co.status === 'closed' ? [] : [...(s.co.summary.pending_quantity !== '0' ? ['resolve_undelivered'] : []), ...(s.co.summary.pending_quantity === '0' && !s.blockers.stock_remains && s.blockers.missing_month_count === '0' ? ['close_co'] : [])];
            if (rejectInitialImport && args.p_expected_version) { rejectInitialImport = false; return { data: null, error: { code: '08006', message: 'Canonical read unavailable' } }; }
        }
        if (name === 'pilot_co_transaction_v1' && !executed) {
            executed = true; const result = await s.handle(name, args);
            if (newer) s.cv = '2';
            else if (!lost) rejectInitialImport = true;
            return lost ? { data: null, error: { code: '08006', message: 'Committed reply lost' } } : result;
        }
        return null;
    };
    const owner = mountApp(<App/>, path);
    await click(operation === 'close_co' ? 'Tutup CO' : 'Selesaikan sisa belum dikirim');
    const label = operation === 'close_co' ? 'penutupan' : 'penyelesaian';
    await screen.findByLabelText(`Alasan ${label}`);
    if (operation === 'resolve_undelivered') { await screen.findByLabelText('Jumlah dibatalkan Item 1'); change('Jumlah dibatalkan Item 1', '30'); }
    change(`Alasan ${label}`, 'Original authorized settlement');
    await click(`Konfirmasi ${label}`);
    await screen.findByText(lost ? 'Committed reply lost' : newer ? 'Hasil kanonis CO belum sesuai.' : 'Canonical read unavailable');
    expect(s.commands).toHaveLength(1); expect(pending()).toHaveLength(1);
    return { s, label, ...owner };
}
async function reopen(departure: 'reload' | 'reopen', client: ReturnType<typeof mountApp>['client']) {
    if (departure === 'reload') { cleanup(); mountApp(<App/>, path); }
    else { await click('Batal'); await click('Buang perubahan'); await act(async () => { await client.invalidateQueries({ queryKey: ['co'] }); }); }
    await screen.findByRole('heading', { name: 'CO-1' });
    expect(screen.getByRole('button', { name: 'Selesaikan sisa belum dikirim' }).matches(':disabled')).toBe(true);
    await click('Pulihkan penyelesaian CO');
    await click('Pulihkan hasil penyimpanan'); await click('Lihat hasil tersimpan');
}
for (const operation of ['resolve_undelivered', 'close_co'] as const) {
    for (const departure of ['reload', 'reopen'] as const) {
        test.each([[false, false], [true, false], [false, true], [true, true]])(`${operation}: ${departure} recovers original terminal outcome (lost=%s, newer=%s)`, async (lost, newer) => {
            const { s, client } = await begin(operation, lost, newer);
            const key = pending()[0], original = JSON.parse(localStorage.getItem(key)!);
            await reopen(departure, client);
            if (newer) {
                await screen.findByText('Hasil kanonis CO belum sesuai.');
                expect(JSON.parse(localStorage.getItem(key)!).binding).toEqual(original.binding);
                expect(JSON.parse(localStorage.getItem(key)!).committed).toEqual(s.receipt);
                await click('Selesaikan konflik penyelesaian');
            }
            await waitFor(() => expect(pending()).toHaveLength(0));
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
            expect(s.commands).toHaveLength(1);
            expect(screen.queryByRole('button', { name: 'Pulihkan penyelesaian CO' })).toBeNull();
            expect(screen.getByRole('button', { name: 'Selesaikan sisa belum dikirim' }).matches(':disabled')).toBe(true);
            if (operation === 'close_co') expect(screen.getByRole('button', { name: 'Tutup CO' }).matches(':disabled')).toBe(true);
            else {
                await click('Tutup CO'); await screen.findByLabelText('Alasan penutupan');
                change('Alasan penutupan', 'Next legitimate close'); await click('Konfirmasi penutupan');
                await waitFor(() => expect(s.commands).toHaveLength(2));
                await waitFor(() => expect(pending()).toHaveLength(0));
                expect(s.commands.map((c: any) => c.op)).toEqual(['resolve_undelivered', 'close_co']);
                expect(s.commands[1].payload.expected_customer_version).toBe(newer ? '2' : '1');
                expect(s.co.status).toBe('closed');
            }
        });
    }
    test.each(['ack failure', 'authority denial', 'late owner', 'incomplete lines', 'backward version'] as const)(`${operation}: terminal recovery preserves original receipt on %s`, async failure => {
        const { client, s } = await begin(operation, false, true);
        await reopen('reload', client);
        const key = pending()[0], before = localStorage.getItem(key), base = wire.handler;
        let release!: () => Promise<void>;
        wire.handler = async (name: string, args: any) => {
            if (name === 'pilot_reconcile_co_v1') {
                if (failure === 'ack failure') return { data: null, error: { code: '08006', message: 'Ack unavailable' } };
                if (failure === 'authority denial') return { data: null, error: { code: '42501', message: 'Authority removed' } };
                if (failure === 'late owner') return new Promise(resolve => { release = async () => resolve(await base(name, args)); });
            }
            if (failure === 'incomplete lines' && name === 'pilot_co_detail_section_v1' && args.p_section === 'lines') return { data: null, error: { code: '08006', message: 'Complete lines unavailable' } };
            if (failure === 'backward version' && name === 'pilot_co_detail_v1') {
                const result = await base(name, args); return { ...result, data: { ...result.data, co: { ...result.data.co, co_version: '1' } } };
            }
            return base(name, args);
        };
        await click('Selesaikan konflik penyelesaian');
        if (failure === 'late owner') {
            await waitFor(() => expect(release).toBeTypeOf('function'));
            cleanup(); mountApp(<App/>, path); await screen.findByRole('heading', { name: 'CO-1' });
            await act(async () => release());
        } else await screen.findAllByText(failure === 'ack failure' ? 'Ack unavailable' : failure === 'authority denial' ? 'Authority removed' : failure === 'incomplete lines' ? 'Complete lines unavailable' : 'CO terkini mendahului tanda terima asli.');
        expect(localStorage.getItem(key)).toBe(before); expect(s.commands).toHaveLength(1);
        if (failure === 'authority denial') expect(screen.queryByText('Private order note')).toBeNull();
    });
}
test('next close opener recovers a prior resolve by original operation and Keep preserves its dirty fields', async () => {
    const { s, client } = await begin('resolve_undelivered', false, true);
    const key = pending()[0], before = localStorage.getItem(key);
    await click('Selesaikan konflik penyelesaian'); await click('Tetap mengedit');
    expect(screen.getByDisplayValue('Original authorized settlement')).toBeTruthy(); expect(localStorage.getItem(key)).toBe(before);
    await click('Batal'); await click('Buang perubahan'); await act(async () => { await client.invalidateQueries({ queryKey: ['co'] }); });
    await click('Tutup CO'); await click('Pulihkan hasil penyimpanan'); await click('Lihat hasil tersimpan');
    await screen.findByText('Hasil kanonis CO belum sesuai.'); await click('Selesaikan konflik penyelesaian');
    await waitFor(() => expect(pending()).toHaveLength(0)); expect(s.commands).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await click('Tutup CO'); await screen.findByLabelText('Alasan penutupan');
    await waitFor(() => expect(screen.getByLabelText('Alasan penutupan').matches(':disabled')).toBe(false));
});

test.each(['resolve_undelivered', 'close_co'] as const)('%s: exact old-outcome recovery checks complete source before acknowledgement',async operation=>{
 const {s}=await begin(operation,false,false);
 const key=pending()[0],before=localStorage.getItem(key),base=wire.handler;
 cleanup();mountApp(<App/>,path);await click('Pulihkan penyelesaian CO');await click('Pulihkan hasil penyimpanan');
 wire.handler=async(n:string,a:any)=>n==='pilot_co_detail_section_v1'&&a.p_section==='lines'?{data:null,error:{code:'08006',message:'Exact lines unavailable'}}:base(n,a);
 await click('Lihat hasil tersimpan');await screen.findAllByText('Exact lines unavailable');
 expect(localStorage.getItem(key)).toBe(before);expect(s.commands).toHaveLength(1);
 wire.handler=base;await click('Buka hasil penyelesaian tersimpan');await waitFor(()=>expect(pending()).toHaveLength(0));
 expect(s.commands).toHaveLength(1);
});

test.each(['resolve_undelivered', 'close_co'] as const)('%s: deliberate newer-order review accepts original receipt without requiring old terminal state',async operation=>{
 const {s}=await begin(operation,false,true);
 const key=pending()[0],before=localStorage.getItem(key);
 // A later authorized correction advances the same order; a closed order may be reopened.
 s.co.co_version='3';s.co.status='active';
 cleanup();mountApp(<App/>,path);await click('Pulihkan penyelesaian CO');
 await click('Pulihkan hasil penyimpanan');await click('Lihat hasil tersimpan');
 await screen.findByRole('button',{name:'Selesaikan konflik penyelesaian'});
 expect(localStorage.getItem(key)).toBe(before);
 await click('Selesaikan konflik penyelesaian');await waitFor(()=>expect(pending()).toHaveLength(0));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(s.commands).toHaveLength(1);expect(s.co.co_version).toBe('3');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Tutup CO'}).matches(':disabled')).toBe(false));
});
