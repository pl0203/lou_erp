import { expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mock.rpc } }));
import { createTransactionSender } from '../../src/lib/orderTransactions';
test('shared sender awaits opt-in asynchronous validation before clearing request identity', async () => { localStorage.clear(); let finish!: (ok: boolean) => void; const validation = new Promise<boolean>(r => { finish = r; }); const send = createTransactionSender({ storage: () => localStorage, storageKey: 'co-async-test', validateResult: () => validation } as any); mock.rpc.mockResolvedValue({ data: { id: 'saved' }, error: null }); const pending = send('create_co', {}); await vi.waitFor(() => expect(mock.rpc).toHaveBeenCalled()); expect(send.hasUnresolved()).toBe(true); finish(false); await expect(pending).rejects.toThrow(); expect(send.hasUnresolved()).toBe(true); });
test('shared sender decodes opted-in CO recovery before validating and retaining the committed result', async () => { const send = createTransactionSender({ decodeRecovery: (r: any) => ({ state: r.status, operation: r.operation, result: r.receipt }), validateResult: async (r: any) => r.id === 'saved' } as any); mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'lost' } }).mockResolvedValueOnce({ data: { status: 'committed', operation: 'create_co', receipt: { id: 'saved' } }, error: null }); await expect(send('create_co', {})).rejects.toThrow('lost'); expect(await send.reconcile()).toMatchObject({ state: 'committed', result: { id: 'saved' } }); expect(send.hasUnresolved()).toBe(true); });
test('same-key committed reuse awaits rejected validation without losing its original UUID', async () => { localStorage.clear(); let accept = true; const send = createTransactionSender({ storage: () => localStorage, storageKey: 'async-reuse', validateResult: async () => { if (!accept)
        throw new Error('canonical unavailable'); return true; } }); mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'lost' } }).mockResolvedValueOnce({ data: { state: 'committed', operation: 'edit_po', result: { id: 'saved' } }, error: null }); await expect(send('edit_po', {})).rejects.toThrow(); const id = JSON.parse(localStorage.getItem('async-reuse')!).id; await send.reconcile(); accept = false; await expect(send('edit_po', {})).rejects.toThrow('canonical unavailable'); expect(send.hasUnresolved()).toBe(true); expect(JSON.parse(localStorage.getItem('async-reuse')!).id).toBe(id); });
test.each([['pilot_order_transaction', 'pilot_reconcile_request'], ['pilot_finalize_visit', 'pilot_reconcile_visit'], ['leave_transaction_v1', 'leave_reconcile_request_v1'], ['pilot_promotion_transaction_v1', 'pilot_reconcile_promotion_v1'], ['pilot_schedule_transaction_v1', 'pilot_reconcile_schedule_v1']])('legacy %s preserves default envelopes and synchronous callbacks', async (rpc, recovery) => { mock.rpc.mockClear(); const send = createTransactionSender({ rpcName: rpc, recoveryRpcName: recovery, validateResult: (v: any) => v.id === 'saved' } as any); mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'lost' } }).mockResolvedValueOnce({ data: { state: 'committed', operation: 'legacy', result: { id: 'saved' } }, error: null }); await expect(send('legacy', { a: 1 })).rejects.toThrow(); expect(await send.reconcile()).toEqual({ state: 'committed', operation: 'legacy', result: { id: 'saved' } }); expect(await send('legacy', { a: 1 })).toEqual({ id: 'saved' }); expect(mock.rpc.mock.calls.map(c => c[0])).toEqual([rpc, recovery]); expect(send.hasUnresolved()).toBe(false); });

test('opted-in success stays durable until explicit acknowledgement; default success still clears', async () => {
    localStorage.clear();
    mock.rpc.mockResolvedValue({ data: { id: 'saved' }, error: null });
    const retained = createTransactionSender({ storage: () => localStorage, storageKey: 'retained', retainCommitted: true } as any);
    expect(await retained('save', {})).toEqual({ id: 'saved' });
    expect(retained.hasUnresolved()).toBe(true);
    expect(JSON.parse(localStorage.getItem('retained')!).committed).toEqual({ id: 'saved' });
    retained.acknowledgeRecovered();
    expect(localStorage.getItem('retained')).toBeNull();
    const normal = createTransactionSender({ storage: () => localStorage, storageKey: 'normal' });
    await normal('save', {});
    expect(localStorage.getItem('normal')).toBeNull();
});
