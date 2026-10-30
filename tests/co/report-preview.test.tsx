import { openCurrentUploadReview } from './current-upload-review-harness';
import { expect, test } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { store, mount, reportImpact, wire, customer, month, draftId, hash, fingerprint, id } from './report-ui-harness';
import COChangePreview from '../../src/components/co/COChangePreview';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
const snapshot = (s: any) => ({ operation: 'post_report' as const, payload: { draft_id: draftId, expected_customer_version: '1', expected_draft_version: '1', eligible_set_fingerprint: hash }, header: { version: '1', as_of: '2026-10-09T00:00:00Z', operation: 'post_report', customer_id: customer, customer_version: '1', draft_version: '1', preview_fingerprint: fingerprint, can_post: true, before: { sold_quantity: '0', revenue: '1000000', remaining_quantity: '100', complete: true }, after: { sold_quantity: '70', revenue: '1720000', remaining_quantity: '30', complete: true }, counts: Object.fromEntries(Object.entries(s.impacts).map(([k, v]: any) => [k, String(v.length)])) } } as any);
test('selected month is found beyond the first page and all seven kinds stay pinned', async () => { const s = store(); s.impacts.report = Array.from({ length: 101 }, (_, i) => ({ ...reportImpact(i === 100 ? month : `${2000 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`), ref: `r:${i}` })); s.impacts.stock = [{ stock_key_id: id(1001), batch_id: id(90), before_quantity: '100', after_quantity: '30' }]; mount(<COChangePreview snapshot={snapshot(s)} selectedMonth={month}/>); expect(await screen.findByText('Pendapatan periode dipilih: Rp 720.000')).toBeTruthy(); expect(wire.rpc.mock.calls.filter(([n, a]) => n === 'pilot_co_preview_labeled_impacts_v1' && a.p_kind === 'report').some(([, a]) => a.p_page === 2)).toBe(true); for (const label of ['Laporan', 'Stok', 'Pendapatan', 'Kredit PIC', 'CO dibuka ulang', 'Penghalang', 'Periode wajib'])
    expect(screen.getByRole('button', { name: new RegExp(`^${label} \\(`) })).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: /^Stok \(/ })); await screen.findByText(/100 → 30/); expect(wire.rpc.mock.calls.filter(([n]) => n === 'pilot_co_preview_labeled_impacts_v1').every(([, a]) => a.p_preview_fingerprint === fingerprint)).toBe(true); });
test.each(['quantity', 'reason'] as const)('editing %s after review removes Post and stale review cannot restore it', async edit => {
    // Accepted no-draft interface: map the same invalidation invariant to upload→review.
    const { ports, controller, client, delayImpacts, delayedImpactRead } = await openCurrentUploadReview();
    const post = await screen.findByRole('button', {name:'Catat penjualan'});
    await waitFor(() => expect((post as HTMLButtonElement).disabled).toBe(false));
    let release!:()=>void; const pending=new Promise<void>(resolve=>{release=resolve});delayImpacts(pending);
    let refresh!:Promise<void>;
    await act(async()=>{refresh=client.invalidateQueries({predicate:q=>q.queryKey[4]==='preview-impact'||q.queryKey[4]==='preview-selected-report'});});
    await waitFor(()=>expect(delayedImpactRead).toHaveBeenCalled());
    await waitFor(()=>expect((post as HTMLButtonElement).disabled).toBe(true));
    if(edit==='quantity')fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'),{target:{value:'2'}});
    else fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'),{target:{value:'Verified source review note'}});
    expect(controller.getSnapshot().validation?.canConfirm).toBe(edit==='reason');
    expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
    expect(controller.getSnapshot().preview).toBeNull();
    await act(async()=>{release();await refresh});
    expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
    expect(controller.getSnapshot().preview).toBeNull();
    expect(ports.commit).not.toHaveBeenCalled();expect(ports.acceptReceipt).not.toHaveBeenCalled();
});
test('successful recovery acceptance clears only on explicit true, while Keep retains the result', async () => { const { CORecoveryPanel } = await import('../../src/components/co/COShared'); let unresolved = true, accepted = false; const receipt = { id: draftId, operation: 'save_report_draft', version: '1', customer_id: customer, customer_version: '1' } as any; const sender = Object.assign(async () => receipt, { hasUnresolved: () => unresolved, reconcile: async () => ({ status: 'committed' as const, operation: 'save_report_draft' as const, receipt }), acknowledgeRecovered: async () => { unresolved = false; } }); mount(<CORecoveryPanel sender={sender} current={() => true} accept={async () => { if (!accepted)
    return false; await sender.acknowledgeRecovered(); return true; }}/>); fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); fireEvent.click(await screen.findByRole('button', { name: 'Lihat hasil tersimpan' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Lihat hasil tersimpan' }).hasAttribute('disabled')).toBe(false)); accepted = true; fireEvent.click(screen.getByRole('button', { name: 'Lihat hasil tersimpan' })); await waitFor(() => expect(screen.queryByRole('button', { name: 'Lihat hasil tersimpan' })).toBeNull()); });
test('SKU revenue uses every pinned allocation page rather than the visible twenty rows', async () => { const { allocation } = await import('./report-ui-harness'); const { default: COAllocationDetails } = await import('../../src/components/co/COAllocationDetails'); const s = store(); s.rows[0].sold_quantity = '101'; s.rows[0].eligible_quantity = '101'; s.allocations = Array.from({ length: 101 }, (_, i) => allocation(i + 1, '1', '10')); mount(<COAllocationDetails customerId={customer} month={month} customerVersion="1" snapshot={snapshot(s)} stockKeyId={id(1001)}/>); expect(await screen.findByText('Pendapatan SKU: Rp 1.010 · 101 teralokasi')).toBeTruthy(); expect(wire.rpc.mock.calls.filter(([n, a]) => n === 'pilot_co_preview_allocations_v1' && a.p_page_size === 100).map(([, a]) => a.p_page)).toEqual([1, 2]); });
