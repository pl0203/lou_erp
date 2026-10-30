import React from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { customer, id, mountApp, stockFixture } from './stock-ui-harness';
import { createCOTransactionSender } from '../../src/lib/co/transactions';
import App from '../../src/App';
const keys = () => Object.keys(localStorage).filter(k => k.startsWith('co-request:'));
async function click(name: string) {
    const node = await screen.findByRole('button', { name, exact: true });
    await waitFor(() => expect(node.matches(':disabled')).toBe(false));
    fireEvent.click(node);
}

test.each([[false, false], [true, false], [false, true], [true, true]])(
    'retained legacy route reconciles exact draft receipt without new legacy write (lost=%s, newer draft=%s)',
    async (lost, newerDraft) => {
        const s = stockFixture();
        const sender = createCOTransactionSender({ actorId: id(1), role: 'co_admin', scope: 'return', customerId: customer, storage: () => localStorage, retainCommitted: true });
        let executed = false;
        s.fail = async (name: string, args: any) => {
            if (name !== 'pilot_co_transaction_v1' || executed) return null;
            executed = true;
            const result = await s.handle(name, args);
            return lost ? { data: null, error: { code: '08006', message: 'Legacy response lost' } } : result;
        };
        const save = sender('save_return_draft', { customer_id: customer, expected_customer_version: '1', expected_draft_version: null,
            return_date: '2026-10-09', reference: 'ORIGINAL LEGACY', reason: null, notes: null,
            lines: [{ batch_id: id(2001), quantity: 5 }] });
        if (lost) await expect(save).rejects.toThrow('Legacy response lost'); else await save;
        const key = keys()[0], original = localStorage.getItem(key)!;
        s.cv = '9';
        if (newerDraft) { s.draft.header.draft_version = '2'; s.draft.header.reference = 'NEWER LEGACY'; }
        mountApp(<App/>, '/athel/co/returns');
        await screen.findByRole('heading', { name: 'Stock Return', exact: true });
        await click('Pulihkan retur sebelumnya');
        await click('Pulihkan hasil penyimpanan');
        await click('Lihat hasil tersimpan');
        // The production recovery sender must pin the original canonical receipt,
        // not replace it with the newer customer/draft readback before acknowledgement.
        expect(JSON.parse(localStorage.getItem(key)!).binding).toEqual(JSON.parse(original).binding);
        expect(JSON.parse(localStorage.getItem(key)!).committed).toEqual({
            id: id(20), operation: 'save_return_draft', version: '1', customer_id: customer, customer_version: '1',
        });
        expect(screen.queryByRole('button', { name: 'Simpan Draft retur' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Tinjau / post retur' })).toBeNull();
        await click('Selesaikan konflik retur');
        await waitFor(() => expect(keys()).toHaveLength(0));
        expect(s.commands).toHaveLength(1);
        expect(s.commands[0].op).toBe('save_return_draft');
        expect(JSON.parse(original).binding.operation).toBe('save_return_draft');
        expect((await screen.findByRole('button', { name: 'Create Stock Return' })).matches(':disabled')).toBe(false);
        cleanup(); mountApp(<App/>, '/athel/co/returns');
        await screen.findByRole('heading', { name: 'Stock Return', exact: true });
        expect(screen.queryByRole('button', { name: 'Pulihkan retur sebelumnya' })).toBeNull();
        expect(s.commands).toHaveLength(1);
    });

test.each([false, true])('retained route checks consumed-draft linkage against later return head (wrong linkage=%s)', async wrongLinkage => {
    const s = stockFixture();
    const options = { actorId: id(1), role: 'co_admin', scope: 'return', customerId: customer, storage: () => localStorage };
    await createCOTransactionSender(options)('save_return_draft', { customer_id: customer, expected_customer_version: '1', expected_draft_version: null,
        return_date: '2026-10-09', reference: 'POST ORIGINAL', reason: null, notes: null, lines: [{ batch_id: id(2001), quantity: 5 }] });
    let posted = false;
    s.fail = async (name: string, args: any) => {
        if (name !== 'pilot_co_transaction_v1' || args.p_operation !== 'post_return' || posted) return null;
        posted = true;
        await s.handle(name, args);
        await s.handle(name, { p_request_id: id(888), p_operation: 'correct_return', p_payload: { action: 'void' } });
        if (wrongLinkage) s.draft.header.head_id = id(999);
        return { data: null, error: { code: '08006', message: 'Original post response lost' } };
    };
    await expect(createCOTransactionSender({ ...options, retainCommitted: true })('post_return', {
        customer_id: customer, draft_id: id(20), expected_draft_version: '1', expected_customer_version: '1',
        reason: 'Original return reason',
    })).rejects.toThrow('Original post response lost');
    mountApp(<App/>, '/athel/co/returns');
    await screen.findByRole('heading', { name: 'Stock Return', exact: true });
    await click('Pulihkan retur sebelumnya'); await click('Pulihkan hasil penyimpanan'); await click('Lihat hasil tersimpan');
    const key = keys()[0], before = localStorage.getItem(key)!;
    expect(JSON.parse(before).binding.draft_id).toBe(id(20));
    expect(JSON.parse(before).committed).toMatchObject({ operation: 'post_return', id: id(21), version: '1' });
    await click('Selesaikan konflik retur');
    if (wrongLinkage) {
        await screen.findByText('Draft asal tidak terhubung ke hasil retur yang diterima.');
        expect(localStorage.getItem(key)).toBe(before);
    } else await waitFor(() => expect(keys()).toHaveLength(0));
    expect(s.commands.filter((command: any) => command.op === 'post_return')).toHaveLength(1);
});
