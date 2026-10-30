import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ids, mount, state } from './ui-harness';
import CODetail from '../../src/pages/athel/co/CODetail';
import * as rpc from '../../src/lib/co/rpc';
import * as auth from '../../src/lib/AuthContext';
import { coKeys } from '../../src/lib/co/queryKeys';

function seedAudit(count = 1) {
    state.sections.audit = Array.from({ length: count }, (_, i) => ({ id: `audit-${i}`, operation: 'edit_co', actor_id: ids.actor,
        created_at: '2026-10-10T23:10:00Z', reason: `Private audit ${i}` }));
}
async function openAudit() {
    const disclosure = await screen.findByText('Audit CO dan laporan pelanggan', { selector: 'summary' });
    fireEvent.click(disclosure);
    return disclosure.closest('details')!;
}

test('detail summary preserves exact authoritative quantities above safe integer without deriving stock', async () => {
    Object.assign(state.header.summary, { delivered_quantity: '9007199254740993', sold_quantity: '37', returned_quantity: '19', remaining_quantity: '57' });
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    const heading = await screen.findByRole('heading', { name: 'Ringkasan CO ini' });
    const summary = within(heading.closest('section')!);
    expect(summary.getByText('Jumlah terkirim').nextElementSibling?.textContent).toBe('9.007.199.254.740.993');
    expect(summary.getByText('Jumlah terjual').nextElementSibling?.textContent).toBe('37');
    expect(summary.getByText('Jumlah retur belum terjual').nextElementSibling?.textContent).toBe('19');
    expect(summary.getByText('Stok tercatat').nextElementSibling?.textContent).toBe('57');
    expect(summary.getByText(/Sejak pembuatan CO/)).toBeTruthy();
    expect(summary.getByText(/bukan verifikasi stok fisik/)).toBeTruthy();
});

test.each(['unassigned', 'assigned'] as const)('historical PIC with missing name is explicit, never current customer assignment: %s', async status => {
    state.header.sales_attribution_state = status;
    state.header.sales_person_name = null;
    state.customers[0].sales_person_name = 'Current unrelated PIC';
    if (status === 'unassigned') { state.header.sales_person_id_at_creation = null; state.header.sales_assignment_source_id = null; }
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    await screen.findByText(status === 'unassigned' ? 'Belum ditetapkan' : 'Nama PIC tidak tersedia');
    expect(screen.queryByText('Current unrelated PIC')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /PIC/ })).toBeNull();
});

test('audit history exposes bounded exact paging and source-bound change details', async () => {
    seedAudit(21);
    state.sections.audit_changes = [{ id: 'change-1', path: 'notes', side: 'before', value: 'Original private note' }];
    const read = vi.spyOn(rpc, 'fetchCODetailSection');
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    const panel = await openAudit();
    expect(within(panel).getByText(/laporan pelanggan yang sama \(semua CO\)/)).toBeTruthy();
    await within(panel).findByText('Alasan: Private audit 0');
    expect(within(panel).queryByText('Alasan: Private audit 20')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Berikutnya' }));
    await within(panel).findByText('Alasan: Private audit 20');
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ p_co_id: ids.co, p_section: 'audit', p_expected_version: '1', p_expected_customer_version: '1', p_page: 2, p_page_size: 20 }), expect.anything());
    fireEvent.click(within(panel).getByRole('button', { name: 'Lihat perubahan' }));
    await screen.findByText(/Original private note/);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ p_section: 'audit_changes', p_parent_id: 'audit-20', p_co_id: ids.co, p_expected_version: '1', p_expected_customer_version: '1' }), expect.anything());
    expect(state.commands).toHaveLength(0);
});

test('audit authority denial removes summary, historical PIC and private audit cache', async () => {
    seedAudit();
    const { client } = mount(<CODetail/>, `/athel/co/${ids.co}`);
    await openAudit(); await screen.findByText('Alasan: Private audit 0');
    await screen.findByText('Original PIC');
    const original = rpc.fetchCODetailSection;
    vi.spyOn(rpc, 'fetchCODetailSection').mockImplementation(async (args, options) => {
        if (args.p_section === 'audit') throw Object.assign(new Error('Audit authority denied'), { code: '42501' });
        return original(args, options);
    });
    await act(async () => { await client.invalidateQueries({ predicate: q => q.queryKey[4] === 'section:audit' }); });
    await screen.findByText('Audit authority denied');
    expect(screen.queryByText('Original PIC')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Ringkasan CO ini' })).toBeNull();
    expect(screen.queryByText('Alasan: Private audit 0')).toBeNull();
    expect(client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'co' && q.state.data)).toHaveLength(0);
});

test.each(['identity', 'role', 'deactivation'] as const)('restored summary and audit cannot survive actor %s', async loss => {
    seedAudit();
    const { client } = mount(<CODetail/>, `/athel/co/${ids.co}`);
    await openAudit(); await screen.findByText('Alasan: Private audit 0');
    const current = auth.useAuth(), nextId = '00000000-0000-0000-0000-000000000009';
    vi.spyOn(auth, 'useAuth').mockReturnValue({ ...current,
        user: loss === 'identity' ? { ...current.user!, id: nextId } : current.user,
        profile: { ...current.profile!, ...(loss === 'identity' ? { id: nextId } : loss === 'role' ? { role: 'executive' } : { is_active: false }) },
    });
    const original = rpc.fetchCODetail;
    vi.spyOn(rpc, 'fetchCODetail').mockImplementation(async (...args) => {
        if (auth.useAuth().user?.id !== ids.actor || auth.useAuth().profile?.role !== 'co_admin') throw Object.assign(new Error('New actor has no source access'), { code: '42501' });
        return original(...args);
    });
    await act(async () => { await client.invalidateQueries({ queryKey: coKeys.identity({ actorId: ids.actor, role: 'co_admin' }) }); });
    await waitFor(() => expect(screen.queryByText('Original PIC')).toBeNull());
    expect(screen.queryByText('Alasan: Private audit 0')).toBeNull();
    expect(client.getQueryCache().getAll().filter(q => q.queryKey[2] === ids.actor && q.state.data)).toHaveLength(0);
    expect(state.commands).toHaveLength(0);
});

test.each([['active', 'Aktif'], ['closed', 'Ditutup'], ['cancelled', 'Dibatalkan']] as const)('detail lifecycle %s is read from status, not delivery completion', async (status, label) => {
    state.header.status = status;
    state.header.summary.delivery_progress = 'complete';
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    const heading = await screen.findByRole('heading', { name: 'Ringkasan CO ini' });
    const summary = within(heading.closest('section')!);
    expect(summary.getByText('Status CO').nextElementSibling?.textContent).toBe(label);
    if (status !== 'active') expect(summary.queryByText('Aktif', { exact: true })).toBeNull();
    expect(state.commands).toHaveLength(0);
});

test('planned value and sold revenue retain distinct exact decimal strings above safe integer', async () => {
    state.header.summary.planned_value = '9007199254740993.25';
    state.header.summary.revenue = '370.09';
    mount(<CODetail/>, `/athel/co/${ids.co}`);
    const heading = await screen.findByRole('heading', { name: 'Ringkasan CO ini' });
    const summary = within(heading.closest('section')!);
    expect(summary.getByText('Nilai rencana CO').nextElementSibling?.textContent).toBe('Rp 9.007.199.254.740.993,25');
    expect(summary.getByText('Pendapatan terjual').nextElementSibling?.textContent).toBe('Rp 370,09');
    expect(state.commands).toHaveLength(0);
});

test.each(['planned_value', 'revenue'] as const)('null %s is refused by the existing detail decoder, not converted to zero', async field => {
    const { decodeCORead } = await import('../../src/lib/co/validation');
    const co = { ...state.header, sales_attributed_at: '2026-10-01T00:00:00Z', reporting_freshness: {
        ...state.header.reporting_freshness, cutoff_date: '2026-10-09', next_required_month_end: '2026-10-31', days_since_pending_month_end: '0',
    } };
    const args = { p_co_id: ids.co, p_expected_version: null };
    const value = { version: '1', as_of: '2026-10-09T00:00:00Z', co, allowed_operations: co.allowed_operations, close_blockers: co.close_blockers };
    expect(() => decodeCORead('pilot_co_detail_v1', args, value)).not.toThrow();
    expect(() => decodeCORead('pilot_co_detail_v1', args, { ...value, co: { ...co, summary: { ...co.summary, [field]: null } } })).toThrow(/summary/);
});
