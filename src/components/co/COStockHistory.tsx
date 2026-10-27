import { LoadingState } from '../ui/LoadingState'
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDisplayDate } from '../../lib/displayDate';
import { ActionLink } from '../ui/ActionLink';
import { fetchCOStockMovements } from '../../lib/co/rpc';
import { isCOAuthorityError } from './COReportWorkspace';
import { COFailure, COPagination, quantityText, useCOActor, useCORead } from './COShared';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import type { COStockRowV2 } from '../../lib/co/contracts';
import './COStockHistory.css';
import { EmptyState } from '../ui/Feedback';

export default function COStockHistory({ customerId, stockKeyId, asOf, onAuthorityFailure, context, customerName, onClose, returnFocus, fallbackFocus, blocked = false }: {
    blocked?: boolean;
    context?: COStockRowV2;
    customerName?: string;
    onClose: () => void;
    returnFocus: HTMLElement | null;
    fallbackFocus: () => HTMLElement | null;
    customerId: string;
    stockKeyId: string;
    asOf: string | null;
    onAuthorityFailure: (error: unknown) => void;
}) {
    const actor = useCOActor(`movements:${customerId}:${stockKeyId}:${asOf}`);
    const [params,setParams] = useSearchParams();
    const rawPage=params.get('movementPage') ?? '1';
    const page=/^[1-9]\d*$/.test(rawPage) && Number(rawPage)<=2147483647 ? Number(rawPage) : 1;
    const setPage=(value:number)=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('movementPage',String(value));return next;});
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
    }, !blocked);
    useEffect(() => {
        if (read.isError && isCOAuthorityError(read.error)) onAuthorityFailure(read.error);
    }, [read.error]);
    const reload = () => { binding.current = null; setPage(1); setEpoch(n => n + 1); };
    return <Dialog labelledBy="co-movement-title" className="co-movement-dialog" pending={false} onClose={onClose} returnFocus={returnFocus} fallbackFocus={fallbackFocus}>
        <header className="co-movement-heading"><div><h2 id="co-movement-title" className="ui-dialog__title">Mutasi stok</h2>
            <p className="co-movement-store">{context?.customer_name ?? customerName ?? 'Toko dipilih'}</p>
            <p className="co-movement-product">{context ? <><strong>{context.display_sku}</strong><span aria-hidden="true"> · </span>{context.product_name}</> : 'Barang dipilih'}</p>
        </div><Button variant="secondary" size="compact" onClick={onClose}>Tutup</Button></header>
        <p className="co-movement-cutoff">{asOf ? `Sampai ${formatDisplayDate(asOf)} (UTC)` : 'Riwayat terkini'}{context?.unit ? ` · Satuan: ${context.unit}` : ''}</p>
        {blocked ? <LoadingState title="Memuat riwayat stok…" shape="list" /> : read.isError ? <COFailure error={read.error} retry={reload}/> : !read.data || read.isFetching ? <LoadingState title="Memuat riwayat stok…" shape="list" /> : <>
            <div className="co-movement-scroll" role="region" aria-label="Tabel mutasi stok" tabIndex={0}>
                <table className="co-movement-table" aria-label="Pergerakan stok tercatat"><thead><tr><th scope="col">Tanggal (UTC)</th><th scope="col">Aktivitas</th><th scope="col" className="co-movement-number">Perubahan</th><th scope="col">Sumber</th></tr></thead>
                <tbody>{read.data.rows.map(row => <tr key={row.id}>
                    <td>{formatDisplayDate(row.effective_date)}</td>
                    <td><span className={`co-movement-kind co-movement-kind--${row.kind}`}>{row.kind === 'sold' ? 'Penjualan' : row.kind === 'return' ? 'Retur' : 'Pengiriman'}</span></td>
                    <td className="co-movement-number">{BigInt(row.quantity_delta) > 0n ? '+' : ''}{quantityText(row.quantity_delta)}</td>
                    <td><ActionLink variant="secondary" size="compact" to={`/athel/co/${row.co_id}`}>Lihat CO sumber</ActionLink></td>
                </tr>)}</tbody></table>
            </div>
            {read.data.total === '0' && <EmptyState title="Belum ada pergerakan tercatat pada cakupan ini."/>}
            <COPagination page={page} total={read.data.total} pending={read.isFetching} onPage={setPage}/>
        </>}
        <p className="co-movement-note">Riwayat mengikuti koreksi yang berlaku. Tanggal penjualan adalah batas cakupan laporan, bukan tanggal transaksi harian. Retur hanya untuk barang belum terjual.</p>
    </Dialog>;
}
