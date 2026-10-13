import { beforeEach, expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mock.rpc } }));
import { createTransactionSender } from '../../src/lib/orderTransactions';
import { createCOTransactionSender } from '../../src/lib/co/transactions';
import { coError } from '../../src/lib/co/rpc';

beforeEach(() => { localStorage.clear(); mock.rpc.mockReset(); });
const options = { storage: () => localStorage, storageKey: 'mapped-errors' };
const saved = () => JSON.parse(localStorage.getItem(options.storageKey)!);

test('default legacy sender retains its existing plain-error and conflict behavior', async () => {
    const send = createTransactionSender(options);
    mock.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Denied' } });
    await expect(send('save', {})).rejects.toMatchObject({ message: 'Denied' });
    try { await send('save', {}); } catch (error) { expect(error).not.toHaveProperty('code'); }
    expect(saved().uncertain).toBe(false);
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'Conflict' } });
    await expect(send('save', {})).rejects.toMatchObject({ name: 'POConflictError' });
});

test.each(['42501', 'PT409', '08006'])('opt-in send preserves %s after unchanged refusal/ambiguity bookkeeping', async code => {
    let mappedUncertainty: boolean | undefined;
    const send = createTransactionSender({
        ...options,
        mapError: (error: unknown) => { mappedUncertainty = saved().uncertain; return coError(error); },
    } as any);
    mock.rpc.mockResolvedValue({ data: null, error: { code, message: 'Mapped failure' } });
    await expect(send('save', {})).rejects.toMatchObject({ code });
    expect(mappedUncertainty).toBe(code === '08006');
    expect(saved().uncertain).toBe(code === '08006');
    expect(send.hasUnresolved()).toBe(code === '08006');
});

test('opt-in reconcile preserves authority code and the unresolved request identity', async () => {
    const send = createTransactionSender({ ...options, mapError: coError } as any);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'Lost' } });
    await expect(send('save', {})).rejects.toThrow('Lost');
    const before = localStorage.getItem(options.storageKey);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Revoked' } });
    await expect(send.reconcile()).rejects.toMatchObject({ code: '42501' });
    expect(localStorage.getItem(options.storageKey)).toBe(before);
});

test('actual CO sender opts into SQLSTATE preservation for command and recovery errors', async () => {
    const actor = '00000000-0000-0000-0000-000000000001';
    const customer = '00000000-0000-0000-0000-000000000002';
    let code = '42501';
    mock.rpc.mockImplementation(async name => name === 'pilot_my_profile'
        ? { data: [{ id: actor, role: 'co_admin', is_active: true }], error: null }
        : { data: null, error: { code, message: 'CO failure' } });
    const send = createCOTransactionSender({
        actorId: actor, customerId: customer, role: 'co_admin', scope: 'report', storage: () => localStorage,
    });
    await expect(send('save_report_draft', { customer_id: customer })).rejects.toMatchObject({ code: '42501' });
    code = '08006';
    await expect(send('save_report_draft', { customer_id: customer })).rejects.toMatchObject({ code });
    code = '42501';
    await expect(send.reconcile()).rejects.toMatchObject({ code });
    expect(send.hasUnresolved()).toBe(true);
});

test.each([[],[{id:'00000000-0000-0000-0000-000000000001',role:'co_admin',is_active:false}],[{id:'00000000-0000-0000-0000-000000000001',role:'po_admin',is_active:true}],[{id:'00000000-0000-0000-0000-000000000099',role:'co_admin',is_active:true}]])('current profile data rejection is a typed authority failure: %j',async data=>{
 mock.rpc.mockResolvedValue({data,error:null});const send=createCOTransactionSender({actorId:'00000000-0000-0000-0000-000000000001',customerId:'00000000-0000-0000-0000-000000000002',role:'co_admin',scope:'profile-proof',storage:()=>localStorage});await expect(send('create_co',{})).rejects.toMatchObject({code:'42501'});expect(mock.rpc.mock.calls.map(([n])=>n)).toEqual(['pilot_my_profile']);expect(localStorage.length).toBe(0);
});
test('an obsolete business owner remains an identity failure, not a current-authority denial',async()=>{const send=createCOTransactionSender({actorId:'00000000-0000-0000-0000-000000000001',customerId:'00000000-0000-0000-0000-000000000002',role:'co_admin',scope:'obsolete-proof',storage:()=>localStorage,isCurrent:()=>false});try{await send('create_co',{});throw new Error('must reject');}catch(e){expect(e).toMatchObject({code:'CO_READ_INVALID'});}expect(mock.rpc).not.toHaveBeenCalled();});
test('an obsolete owner during the profile read cannot turn its late profile rejection into current denial',async()=>{let live=true;mock.rpc.mockImplementation(async()=>{live=false;return {data:[],error:null};});const send=createCOTransactionSender({actorId:'00000000-0000-0000-0000-000000000001',customerId:'00000000-0000-0000-0000-000000000002',role:'co_admin',scope:'late-profile',storage:()=>localStorage,isCurrent:()=>live});await expect(send('create_co',{})).rejects.toMatchObject({code:'CO_READ_INVALID'});expect(mock.rpc.mock.calls.map(([n])=>n)).toEqual(['pilot_my_profile']);});
