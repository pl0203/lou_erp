import { useState } from 'react';
import { Link } from 'react-router-dom';
import { completeCORead, fetchCOReportAllocations, fetchCOPreviewAllocations } from '../../lib/co/rpc';
import { minorUnits, invalid } from '../../lib/co/validation';
import { formatCOMinorUnits } from '../../lib/co/catalog';
import { formatMoney } from '../../lib/reads/money';
import { isCOAuthorityError } from './COReportWorkspace';
import type { COReviewSnapshot } from './COChangePreview';
import { COFailure, COPagination, useCOActor, useCORead } from './COShared';
export default function COAllocationDetails({ customerId, month, customerVersion, revisionId, snapshot, stockKeyId, onAuthorityFailure }: {
    customerId: string;
    month: string;
    customerVersion: string;
    revisionId?: string;
    snapshot?: COReviewSnapshot;
    stockKeyId?: string;
    onAuthorityFailure?: (error: unknown) => void;
}) {
    const actor = useCOActor(`allocations:${customerId}:${month}:${customerVersion}:${stockKeyId}:${revisionId ?? snapshot?.header.preview_fingerprint}`), [page, setPage] = useState(1);
    async function guarded<T>(read: () => Promise<T>) {
        const notify = onAuthorityFailure;
        try { return await read(); }
        catch (error) {
            if (actor.isCurrent() && isCOAuthorityError(error)) notify?.(error);
            throw error;
        }
    }
    const read = useCORead(actor, 'report-allocations', { customerId, month, customerVersion, revisionId, snapshot, stockKeyId, page }, o => guarded(() => snapshot ? fetchCOPreviewAllocations({ p_operation: snapshot.operation, p_payload: snapshot.payload, p_preview_fingerprint: snapshot.header.preview_fingerprint, p_report_month: month, p_stock_key_id: stockKeyId ?? null, p_page: page, p_page_size: 20 }, o) : fetchCOReportAllocations({ p_customer_id: customerId, p_month: month, p_expected_customer_version: customerVersion, p_revision_id: revisionId!, p_page: page, p_page_size: 20 }, o)), !!revisionId || !!snapshot);
    const total = useCORead(actor, 'report-sku-amount', { customerId, month, customerVersion, snapshot, stockKeyId }, o => guarded(async () => {
        let selection: string | undefined, sold: string | null = null, complete = false;
        const rows = await completeCORead(async (p) => { const result = await fetchCOPreviewAllocations({ p_operation: snapshot!.operation, p_payload: snapshot!.payload, p_preview_fingerprint: snapshot!.header.preview_fingerprint, p_report_month: month, p_stock_key_id: stockKeyId!, p_page: p, p_page_size: 100 }, o); const binding = JSON.stringify([result.report_ref, result.selected_row, result.report_complete]); if (selection !== undefined && selection !== binding)
            invalid('changed allocation selection'); selection = binding; sold = result.selected_row.sold_quantity; complete = result.report_complete; return result; }, r => r.allocation_ref);
        const quantity = rows.reduce((sum, r) => sum + BigInt(r.quantity), 0n);
        if (complete && sold !== null && quantity !== BigInt(sold))
            invalid('incomplete SKU allocation');
        return { sold, complete, quantity: quantity.toString(), amount: formatCOMinorUnits(rows.reduce((sum, r) => sum + minorUnits(r.amount), 0n)) };
    }), !!snapshot && !!stockKeyId);
    if (!revisionId && !snapshot)
        return <p className="text-xs">Tinjau laporan untuk melihat alokasi harga/PIC dari server.</p>;
    return <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-3 text-xs">{snapshot && stockKeyId && (total.isError ? <COFailure error={total.error} retry={() => void total.refetch()}/> : !total.data ? <p>Memeriksa pendapatan di semua halaman alokasi SKU…</p> : total.data.sold === null ? <p>Pendapatan SKU belum tersedia: jumlah terjual belum diisi.</p> : <p>Pendapatan SKU{total.data.complete ? '' : ' provisional'}: Rp {formatMoney(total.data.amount, 'full')} · {total.data.quantity} teralokasi</p>)}<p>{snapshot && stockKeyId ? 'Alokasi SKU dipilih' : 'Alokasi seluruh laporan (semua SKU), halaman bukti sumber'}</p>{read.isError ? <COFailure error={read.error} retry={() => void read.refetch()}/> : !read.data ? <p role="status">Memuat alokasi…</p> : <>{read.data.summary && <p>Total seluruh laporan: {read.data.summary.quantity} · Rp {formatMoney(read.data.summary.amount, 'full')}</p>}{read.data.selected_row?.sold_quantity === null && <p>SKU belum diisi; tidak ada jumlah nol yang disimpulkan.</p>}{read.data.selected_row?.sold_quantity === '0' && <p>SKU dikonfirmasi terjual 0.</p>}{read.data.rows.map((r: Record<string, any>) => <div key={r.id ?? r.allocation_ref} className="border-b border-gray-200 pb-2"><p>{r.source_state === 'proposed' ? 'Sumber usulan · ' : ''}<Link to={`/athel/co/${r.co_id}`}>{r.co_number}</Link> · {r.sj_number} · {r.sj_date}</p><p>{r.quantity} × Rp {formatMoney(r.unit_price, 'full')} = Rp {formatMoney(r.amount, 'full')}</p><p>PIC asli: {r.sales_person_name ?? 'Unassigned'} · {r.sales_person_id_at_creation ?? 'Unassigned'}</p>{r.source_state === 'proposed' && <p className="break-all">{r.source_batch_ref} · {r.delivery_ref}</p>}</div>)}<COPagination page={page} total={read.data.total} pending={read.isFetching} onPage={setPage}/></>}</div>;
}
