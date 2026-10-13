import { beforeEach, expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mock.rpc } }));
import { createCOTransactionSender, validateCOReceipt } from '../../src/lib/co/transactions';
const actor = '11111111-1111-4111-8111-111111111111', customer = '22222222-2222-4222-8222-222222222222', co = '33333333-3333-4333-8333-333333333333';
const receipt = { id: co, customer_id: customer, operation: 'edit_co', version: '2', customer_version: '3' };
const options = { actorId: actor, role: 'co_admin', scope: 'editor', customerId: customer, coId: co, storage: () => localStorage };
let current = true, authorized = true, lost = false, writeResult: any, canonicalResult: any, writes: any[];
beforeEach(() => { localStorage.clear(); mock.rpc.mockReset(); current = true; authorized = true; lost = false; writeResult = receipt; canonicalResult = { status: 'committed', operation: 'edit_co', receipt }; writes = []; mock.rpc.mockImplementation(async (name, args) => { if (!authorized)
    return { data: null, error: { code: '42501', message: 'authority revoked' } }; if (name === 'pilot_my_profile')
    return { data: [{ id: actor, role: 'co_admin', is_active: true }], error: null }; if (name === 'pilot_reconcile_co_v1')
    return { data: canonicalResult, error: null }; writes.push(args); return lost ? { data: null, error: { message: 'response lost' } } : { data: writeResult, error: null }; }); });
const payload = { co_id: co, expected_co_version: '1', expected_customer_version: '2', lines: [], notes: 'private typed note' };
test('CO receipts reject wrong operation customer target and absent bigint versions', () => { expect(validateCOReceipt(receipt, 'edit_co', { co_id: co, customer_id: customer })).toBe(true); for (const bad of [{ ...receipt, operation: 'close_co' }, { ...receipt, customer_id: co }, { ...receipt, version: 2 }, { ...receipt, customer_version: undefined }, { ...receipt, id: customer }])
    expect(validateCOReceipt(bad, 'edit_co', { co_id: co, customer_id: customer })).toBe(false); expect(validateCOReceipt({ ...receipt, operation: 'attach_evidence' })).toBe(false); });
test('successful response is canonically validated before metadata clears', async () => { const send = createCOTransactionSender(options); expect(await send('edit_co', payload)).toEqual(receipt); expect(mock.rpc.mock.calls.filter(c => c[0] === 'pilot_reconcile_co_v1')[0][1].p_abandon).toBe(false); expect(send.hasUnresolved()).toBe(false); });
test('lost committed response reload recovers the original UUID without another execution or saved contents', async () => { lost = true; await expect(createCOTransactionSender(options)('edit_co', payload)).rejects.toThrow('response lost'); const saved = localStorage.getItem(localStorage.key(0)!)!; expect(saved).not.toMatch(/private typed|lines|expected_co_version|price/); expect(JSON.parse(saved).binding).toEqual({ operation: 'edit_co', customer_id: customer, co_id: co, target_id: co }); lost = false; const send = createCOTransactionSender(options); expect(await send('edit_co', payload)).toEqual(receipt); expect(writes).toHaveLength(1); const recoveryCalls = mock.rpc.mock.calls.filter(c => c[0] === 'pilot_reconcile_co_v1'); expect(recoveryCalls.every(c => c[1].p_request_id === writes[0].p_request_id)).toBe(true); });
test('changed payload after ambiguous outcome stays blocked until explicit recovered acknowledgement', async () => { lost = true; const send = createCOTransactionSender(options); await expect(send('edit_co', payload)).rejects.toThrow(); lost = false; await expect(send('edit_co', { ...payload, notes: 'new work' })).rejects.toThrow(/belum terkonfirmasi/); expect(writes).toHaveLength(1); expect(send.hasUnresolved()).toBe(true); await send.acknowledgeRecovered(); expect(send.hasUnresolved()).toBe(false); });
test.each([{ ...receipt, version: '99' }, { ...receipt, customer_version: '99' }, { ...receipt, operation: 'close_co' }, { ...receipt, customer_id: co }, { ...receipt, id: customer }])('mismatched live receipt retains recoverable identity', async (bad) => { writeResult = bad; const send = createCOTransactionSender(options); await expect(send('edit_co', payload)).rejects.toThrow(); expect(send.hasUnresolved()).toBe(true); expect(await send.reconcile()).toEqual({ status: 'committed', operation: 'edit_co', receipt }); });
test('wrong recovered operation cannot validate itself against only the response', async () => { lost = true; const send = createCOTransactionSender(options); await expect(send('edit_co', payload)).rejects.toThrow(); canonicalResult = { status: 'committed', operation: 'close_co', receipt: { ...receipt, operation: 'close_co' } }; await expect(send.reconcile()).rejects.toThrow(); expect(send.hasUnresolved()).toBe(true); });
test('role revocation denies recovery without clearing metadata or exposing a receipt', async () => { lost = true; const send = createCOTransactionSender(options); await expect(send('edit_co', payload)).rejects.toThrow(); const saved = localStorage.getItem(localStorage.key(0)!); authorized = false; await expect(send.reconcile()).rejects.toThrow(); expect(localStorage.getItem(localStorage.key(0)!)).toBe(saved); expect(send.hasUnresolved()).toBe(true); });
test('identity change while canonical validation is pending cannot confirm a command', async () => { let resolve!: (v: any) => void; mock.rpc.mockImplementation(async (name) => name === 'pilot_my_profile' ? { data: [{ id: actor, role: 'co_admin', is_active: true }], error: null } : name === 'pilot_co_transaction_v1' ? { data: receipt, error: null } : new Promise(r => { resolve = r; })); const send = createCOTransactionSender({ ...options, isCurrent: () => current }); const p = send('edit_co', payload); await vi.waitFor(() => expect(resolve).toBeTypeOf('function')); expect(send.hasUnresolved()).toBe(true); current = false; resolve({ data: canonicalResult, error: null }); await expect(p).rejects.toThrow(); expect(send.hasUnresolved()).toBe(true); });
test('unknown recovery keeps the same pending identity; abandoned recovery is terminal', async () => { lost = true; const send = createCOTransactionSender(options); await expect(send('edit_co', payload)).rejects.toThrow(); canonicalResult = { status: 'unknown' }; await expect(send.reconcile()).rejects.toThrow(); expect(send.hasUnresolved()).toBe(true); canonicalResult = { status: 'abandoned' }; expect(await send.reconcile()).toEqual({ status: 'abandoned' }); expect(send.hasUnresolved()).toBe(false); });
test('old canonical committed versions remain valid after live state advanced', async () => { lost = true; const send = createCOTransactionSender(options); await expect(send('edit_co', payload)).rejects.toThrow(); expect(await send.reconcile()).toEqual({ status: 'committed', operation: 'edit_co', receipt }); });
test('new generated delivery head is not compared with its draft or containing CO', async () => { const draft = '44444444-4444-4444-8444-444444444444', head = '55555555-5555-4555-8555-555555555555'; writeResult = { ...receipt, id: head, operation: 'post_sj', version: '1' }; canonicalResult = { status: 'committed', operation: 'post_sj', receipt: writeResult }; const send = createCOTransactionSender(options); expect(await send('post_sj', { draft_id: draft, expected_draft_version: '1', expected_co_version: '2', expected_customer_version: '2' })).toEqual(writeResult); });
test('failed asynchronous canonical read keeps request identity for recovery instead of confirming or sending again', async () => { mock.rpc.mockImplementation(async (name) => name === 'pilot_my_profile' ? { data: [{ id: actor, role: 'co_admin', is_active: true }], error: null } : name === 'pilot_reconcile_co_v1' ? { data: null, error: { message: 'canonical read unavailable' } } : { data: receipt, error: null }); const send = createCOTransactionSender(options); await expect(send('edit_co', payload)).rejects.toThrow('canonical read unavailable'); expect(send.hasUnresolved()).toBe(true); const id = JSON.parse(localStorage.getItem(localStorage.key(0)!)!).id; await expect(send('edit_co', payload)).rejects.toThrow('canonical read unavailable'); expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).id).toBe(id); expect(mock.rpc.mock.calls.filter(c => c[0] === 'pilot_co_transaction_v1')).toHaveLength(1); });
test('identity loss while hashing cannot dispatch a command under the replacement actor', async () => { const original = crypto.subtle.digest.bind(crypto.subtle); const hashing = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => { const result = await original(...args); current = false; return result; }); try {
    const send = createCOTransactionSender({ ...options, isCurrent: () => current });
    await expect(send('edit_co', payload)).rejects.toThrow();
    expect(mock.rpc.mock.calls.filter(c => c[0] === 'pilot_co_transaction_v1')).toHaveLength(0);
}
finally {
    hashing.mockRestore();
} });

test.each(['id','operation','version','customer_id','customer_version'] as const)('retained committed %s cannot change on acknowledgement or subsequent retry',async(field)=>{
 lost=true;const original={...receipt,operation:'create_co',version:'1'},send=createCOTransactionSender({...options,coId:undefined});canonicalResult={status:'committed',operation:'create_co',receipt:original};
 await expect(send('create_co',{customer_id:customer})).rejects.toThrow();expect((await send.reconcile()).status).toBe('committed');const key=localStorage.key(0)!,saved=localStorage.getItem(key)!;
 const changed={...original,[field]:field==='operation'?'edit_co':field==='version'||field==='customer_version'?'99':actor};canonicalResult={status:'committed',operation:changed.operation,receipt:changed};
 await expect(send.acknowledgeRecovered()).rejects.toThrow();expect(localStorage.getItem(key)).toBe(saved);
 await expect(send.reconcile()).rejects.toThrow();expect(localStorage.getItem(key)).toBe(saved);
 // A failed same-key reuse must not downgrade the pinned receipt to unpinned uncertainty.
 await expect(send('create_co',{customer_id:customer})).rejects.toThrow();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(JSON.parse(saved));
 await expect(send.acknowledgeRecovered()).rejects.toThrow();expect(JSON.parse(localStorage.getItem(key)!)).toEqual(JSON.parse(saved));
 canonicalResult={status:'committed',operation:'create_co',receipt:original};await send.acknowledgeRecovered();expect(send.hasUnresolved()).toBe(false);expect(writes).toHaveLength(1);
});
test('a retained committed receipt cannot become an abandoned tombstone response',async()=>{lost=true;const send=createCOTransactionSender(options);await expect(send('edit_co',payload)).rejects.toThrow();await send.reconcile();const key=localStorage.key(0)!,saved=localStorage.getItem(key);canonicalResult={status:'abandoned'};await expect(send.acknowledgeRecovered()).rejects.toThrow();expect(localStorage.getItem(key)).toBe(saved);canonicalResult={status:'committed',operation:'edit_co',receipt};await send.acknowledgeRecovered();expect(send.hasUnresolved()).toBe(false);});

test('opted-in known success pins exact receipt and source through failed or obsolete acknowledgement', async () => {
    const send = createCOTransactionSender({ ...options, retainCommitted: true } as any);
    expect(await send('edit_co', payload)).toEqual(receipt);
    expect(send.hasUnresolved()).toBe(true);
    const key = localStorage.key(0)!, before = localStorage.getItem(key);
    expect((send as any).getCommittedIdentity(receipt)).toEqual({ operation: 'edit_co', customer_id: customer, co_id: co, target_id: co });
    expect(() => (send as any).getCommittedIdentity({ ...receipt, version: '99' })).toThrow();
    canonicalResult = { status: 'committed', operation: 'edit_co', receipt: { ...receipt, customer_version: '99' } };
    await expect(send.acknowledgeRecovered()).rejects.toThrow();
    expect(localStorage.getItem(key)).toBe(before);
    canonicalResult = { status: 'committed', operation: 'edit_co', receipt };
    await expect((send.acknowledgeRecovered as any)(() => false)).rejects.toThrow();
    expect(localStorage.getItem(key)).toBe(before);
    await send.acknowledgeRecovered(); expect(send.hasUnresolved()).toBe(false); expect(writes).toHaveLength(1);
});

test('generation replacement during acknowledgement retains the original committed success', async () => {
    let owner = true;
    const send = createCOTransactionSender({ ...options, retainCommitted: true });
    await send('edit_co', payload);
    const key = localStorage.key(0)!, before = localStorage.getItem(key), original = mock.rpc.getMockImplementation()!;
    let release!: () => Promise<void>;
    mock.rpc.mockImplementation(async (name, args) => name === 'pilot_reconcile_co_v1'
        ? new Promise(resolve => { release = async () => resolve(await original(name, args)); }) : original(name, args));
    const acknowledgement = send.acknowledgeRecovered(() => owner);
    await vi.waitFor(() => expect(release).toBeTypeOf('function')); owner = false; await release();
    await expect(acknowledgement).rejects.toThrow('recovery owner changed'); expect(localStorage.getItem(key)).toBe(before);
});
