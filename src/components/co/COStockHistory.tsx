import { useEffect, useRef, useState } from 'react';
import { ActionLink } from '../ui/ActionLink';
import { fetchCOStockMovements } from '../../lib/co/rpc';
import { isCOAuthorityError } from './COReportWorkspace';
import { COCard, COFailure, COPagination, useCOActor, useCORead } from './COShared';
import { RecordList } from '../ui/RecordList';
import { EmptyState } from '../ui/Feedback';

export default function COStockHistory({ customerId, stockKeyId, asOf, onAuthorityFailure }: {
    customerId: string;
    stockKeyId: string;
    asOf: string | null;
    onAuthorityFailure: (error: unknown) => void;
}) {
    const actor = useCOActor(`movements:${customerId}:${stockKeyId}:${asOf}`);
    const [page, setPage] = useState(1);
    const [epoch, setEpoch] = useState(0);
    const binding = useRef<string | null>(null);
    const args = { p_customer_id: customerId, p_stock_key_id: stockKeyId, p_as_of: asOf, p_page: page, p_page_size: 20 };
    const read = useCORead(actor, 'stock-movements', { ...args, epoch }, async options => {
        const value = await fetchCOStockMovements(args, options);
        const next = JSON.stringify([value.customer_version, value.generation_id]);
        if (binding.current !== null && binding.current !== next) {
            throw new Error('Riwayat berubah di antara halaman. Muat ulang seluruh riwayat.');
        }
        binding.current = next;
        return value;
    });
    useEffect(() => {
        if (read.isError && isCOAuthorityError(read.error)) onAuthorityFailure(read.error);
    }, [read.error]);
    const reload = () => { binding.current = null; setPage(1); setEpoch(n => n + 1); };
    return <COCard title="Riwayat stok pelanggan/SKU">
        <p className="text-[13px] break-all">Pelanggan {customerId} · kunci SKU {stockKeyId} · {asOf ?? 'Current'}</p>
        <p className="text-sm my-3">Riwayat efektif yang telah dinyatakan ulang. Penjualan dicatat pada batas cakupan laporan, bukan tanggal penjualan harian.</p>
        {read.isError ? <COFailure error={read.error} retry={reload}/> : !read.data ? <p role="status">Memuat riwayat stok…</p> : <>
            <RecordList label="Pergerakan stok tercatat">{read.data.rows.map(row => <li key={row.id} className="border-b border-brand-divider py-3 text-sm break-words">
                <p>{row.effective_date} · {row.kind === 'sold' ? 'Penjualan pada checkpoint laporan' : row.kind === 'return' ? 'Retur belum terjual' : 'Pengiriman'} · {row.quantity_delta}</p>
                <ActionLink variant="quiet" size="compact" to={`/athel/co/${row.co_id}`}>Bukti CO sumber</ActionLink>
                <p className="text-[13px] break-all">Batch asli {row.batch_id} · baris revisi {row.delivery_revision_line_id ?? row.return_revision_line_id ?? row.report_revision_line_id}</p>
            </li>)}</RecordList>
            {read.data.total === '0' && <EmptyState title="Belum ada pergerakan tercatat pada cakupan ini."/>}
            <COPagination page={page} total={read.data.total} pending={read.isFetching} onPage={setPage}/>
        </>}
    </COCard>;
}
