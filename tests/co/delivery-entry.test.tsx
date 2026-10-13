import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { mount, state, ids, uuid, change, line } from './ui-harness';
import { COConflictError } from '../../src/lib/co/rpc';
import CODeliveryDialog from '../../src/components/co/CODeliveryDialog';
function open(draftId?: string) { mount(<CODeliveryDialog co={state.header} draftId={draftId} onClose={() => { }} returnFocus={null}/>); }
async function fill() { await screen.findByLabelText('Jumlah dikirim Item 1'); change('Nomor SJ', 'SJ-A'); change('Jumlah dikirim Item 1', '1'); }
test('draft saves positive source quantities without stock, price or batch payload', async () => { open(); await fill(); change('Tanggal SJ', '2099-01-01'); change('Tanggal diterima', '2099-01-02'); fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft SJ' })); await waitFor(() => expect(state.commands).toHaveLength(1)); expect(state.commands[0].payload).toMatchObject({ sj_date: '2099-01-01', received_date: '2099-01-02', lines: [{ co_line_id: uuid(1), quantity: 1 }] }); expect(screen.getByText(/Draft tidak menambah stok atau pendapatan/)).toBeTruthy(); });
test.each(['', '1.5', '2147483648', '-1'])('invalid delivery quantity %s is not silently truncated or capped', async (value) => { open(); await fill(); change('Jumlah dikirim Item 1', value); fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft SJ' })); await screen.findByRole('alert'); expect(state.commands).toHaveLength(0); });
test('saved draft unavailable source is retained and requires explicit removal', async () => { state.drafts = [{ id: ids.draft, mode: 'new_delivery', sj_number: 'SJ-A', sj_date: '2026-10-09', received_date: null, notes: null, draft_version: '1', preparation_ready: true, bindings_current: true, consumed: false }]; state.draftLines = [{ id: uuid(9), co_line_id: uuid(9), quantity: '1', source_available: false, source_issue: 'CO_SJ_SOURCE_UNAVAILABLE', display_sku: null, product_name: null }]; open(ids.draft); await screen.findByText(/CO_SJ_SOURCE_UNAVAILABLE/); expect((screen.getByRole('button', { name: 'Post SJ' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByRole('button', { name: 'Hapus sumber tidak tersedia' })).toBeTruthy(); });
test('correction-bound draft cannot be saved as ordinary SJ', async () => { state.header.allowed_operations.push('correct_sj'); state.drafts = [{ id: ids.draft, mode: 'delivery_correction', bound_delivery_head_id: ids.head, bound_delivery_revision_id: uuid(99), bound_delivery_version: '2', sj_number: 'Correction', sj_date: '2026-10-01', draft_version: '1', preparation_ready: true, bindings_current: true, consumed: false }]; state.draftLines = [{ ...line(), co_line_id: uuid(1), quantity: '1', source_available: true }]; open(ids.draft); await screen.findByDisplayValue('Correction'); expect(screen.queryByRole('button', { name: 'Post SJ' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft SJ' })); await waitFor(() => expect(state.commands).toHaveLength(1)); expect(state.commands[0].payload).toMatchObject({delivery_head_id: ids.head, original_revision_id: uuid(99), expected_delivery_version: '2'}); });
test('future post server rejection retains restored draft work', async () => { state.drafts = [{ id: ids.draft, mode: 'new_delivery', sj_number: 'Future SJ', sj_date: '2099-01-01', received_date: null, notes: null, draft_version: '1', preparation_ready: true, bindings_current: true, consumed: false }]; state.draftLines = [{ ...line(), co_line_id: uuid(1), quantity: '1', source_available: true }]; state.send.mockRejectedValue(new Error('Future SJ date rejected')); open(ids.draft); await screen.findByDisplayValue('Future SJ'); fireEvent.click(screen.getByRole('button', { name: 'Post SJ' })); await screen.findByText('Future SJ date rejected'); expect(screen.getByDisplayValue('2099-01-01')).toBeTruthy(); expect(screen.getByDisplayValue('Future SJ')).toBeTruthy(); });
test('missing saved source can be explicitly removed then replaced from current CO lines', async () => { state.drafts = [{ id: ids.draft, mode: 'new_delivery', sj_number: 'SJ-A', sj_date: '2026-10-09', received_date: null, notes: null, draft_version: '1', preparation_ready: true, bindings_current: true, consumed: false }]; state.draftLines = [{ id: uuid(9), co_line_id: uuid(9), quantity: '1', source_available: false, source_issue: 'CO_SJ_SOURCE_UNAVAILABLE', display_sku: null, product_name: null }]; open(ids.draft); await screen.findByText(/CO_SJ_SOURCE_UNAVAILABLE/); fireEvent.click(screen.getByRole('button', { name: 'Hapus sumber tidak tersedia' })); fireEvent.change(screen.getByLabelText('Tambahkan sumber CO'), { target: { value: uuid(1) } }); await screen.findByLabelText('Jumlah dikirim Item 1'); change('Jumlah dikirim Item 1', '1'); fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft SJ' })); await waitFor(() => expect(state.commands).toHaveLength(1)); expect(state.commands[0].payload.lines).toEqual([{ co_line_id: uuid(1), quantity: 1 }]); });
test('confirmed saved draft with failed import blocks duplicate save and offers destination retry', async () => { open(); await fill(); state.failDraftRead = true; fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft SJ' })); await screen.findByText('Saved SJ read failed'); expect((screen.getByRole('button', { name: 'Simpan Draft SJ' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByRole('button', { name: 'Buka hasil SJ tersimpan' })).toBeTruthy(); expect(state.commands).toHaveLength(1); });
test('SJ Cancel keeps dirty fields and guarded dismissal restores no fake stock', async () => { open(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Batal' })); await screen.findByRole('button', { name: 'Tetap mengedit' }); fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' })); expect(screen.getByDisplayValue('SJ-A')).toBeTruthy(); expect(state.commands).toHaveLength(0); });
test('saved ordinary SJ posts using draft identity and delivery-head destination', async () => { open(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft SJ' })); await waitFor(() => expect((screen.getByRole('button', { name: 'Post SJ' }) as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByRole('button', { name: 'Post SJ' })); await waitFor(() => expect(state.commands).toHaveLength(2)); expect(state.commands[1]).toEqual({ op: 'post_sj', payload: { draft_id: ids.draft, expected_draft_version: '1', expected_co_version: '1', expected_customer_version: '2' } }); });
test('current server operations block SJ execution even with restored source data',async()=>{state.header.allowed_operations=[];open();await fill();expect((screen.getByRole('button',{name:'Simpan Draft SJ'}) as HTMLButtonElement).disabled).toBe(true);expect(state.commands).toHaveLength(0)})

test('stale SJ save freezes writes and explicitly reloads complete sources while retaining inputs', async () => {
    open(); await fill();
    change('Tanggal SJ', '2099-01-01');
    state.send.mockRejectedValueOnce(new COConflictError());
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft SJ' }));
    await screen.findByText(/CO berubah. Muat ulang/);
    expect((screen.getByRole('button', { name: 'Simpan Draft SJ' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByDisplayValue('SJ-A')).toBeTruthy();
    state.header = { ...state.header, co_version: '2', customer_version: '3' };
    state.complete.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Muat sumber SJ terbaru' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Simpan Draft SJ' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByDisplayValue('SJ-A')).toBeTruthy();
    expect(screen.getByDisplayValue('2099-01-01')).toBeTruthy();
    expect(state.complete.mock.calls.every(args => args[1] === '2' && args[2] === '3')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draft SJ' }));
    await waitFor(() => expect(state.commands).toHaveLength(1));
    expect(state.commands[0].payload).toMatchObject({ expected_co_version: '2', expected_customer_version: '3', sj_number: 'SJ-A', sj_date: '2099-01-01', lines: [{ co_line_id: uuid(1), quantity: 1 }] });
});

test('failed SJ preparation retry obtains a fresh header before completing source pages', async () => {
    state.failLines = true; open();
    await screen.findByText('CO changed during pages');
    state.header = { ...state.header, co_version: '2', customer_version: '3' };
    state.failLines = false; state.complete.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Muat sumber SJ terbaru' }));
    await screen.findByLabelText('Jumlah dikirim Item 1');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Simpan Draft SJ' }) as HTMLButtonElement).disabled).toBe(false));
    expect(state.complete.mock.calls.every(args => args[1] === '2' && args[2] === '3')).toBe(true);
});
