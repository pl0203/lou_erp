import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCOPage, fetchCODetail } from '../../../lib/co/rpc';
import { fetchCOCustomers } from '../../../lib/co/catalog';
import type { COOrderRecord } from '../../../lib/co/validation';
import COSourceBoundary from '../../../components/co/COSourceBoundary';
import { formatMoney } from '../../../lib/reads/money';
import { CO_INPUT, CO_PRIMARY, useCOActor, useCORead, COBadges, COPagination, COFailure, quantityText } from '../../../components/co/COShared';
export default function COOrders() {
    return <COSourceBoundary source="orders" check={options => fetchCOPage({ p_status: 'all', p_search: '', p_customer_id: null, p_page: 1, p_page_size: 20 }, options)}><OrdersOwner/></COSourceBoundary>;
}
function OrdersOwner() {
    const actor = useCOActor('orders');
    const [filters, setFilters] = useState({ search: '', status: 'all', customer: '' });
    const [page, setPage] = useState(1);
    const args = { p_status: filters.status, p_search: filters.search, p_customer_id: filters.customer || null, p_page: page, p_page_size: 20 };
    const query = useCORead(actor, 'orders', args, o => fetchCOPage(args, o));
    const customers = useCORead(actor, 'customers', {}, fetchCOCustomers);
    const update = (key: keyof typeof filters, value: string) => { setFilters(f => ({ ...f, [key]: value })); setPage(1); };
    const rows = (query.data?.rows ?? []) as COOrderRecord[];
    if (!actor.enabled)
        return null;
    return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3">
    <div>
    <h2 className="text-lg font-semibold">Pesanan Konsinyasi</h2>
    <p className="text-sm text-gray-500">{query.data ? `${quantityText(query.data.total)} pesanan` : 'Memuat pesanan…'}</p>
    </div>
    <Link to="/athel/co/new" className={CO_PRIMARY}>+ CO Baru</Link>
    </div>
    <div className="flex flex-col gap-2 sm:flex-row">
    <input className={CO_INPUT} aria-label="Cari CO" placeholder="Cari nomor CO atau pelanggan..." value={filters.search} onChange={e => update('search', e.target.value)}/>
    <select aria-label="Status CO" className={CO_INPUT} value={filters.status} onChange={e => update('status', e.target.value)}>{[['all', 'Semua status'], ['active', 'Aktif'], ['closed', 'Ditutup'], ['cancelled', 'Dibatalkan']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    <select aria-label="Filter pelanggan" className={CO_INPUT} disabled={!customers.data || customers.isFetching || customers.isError} value={filters.customer} onChange={e => update('customer', e.target.value)}>
    <option value="">Semua pelanggan</option>{customers.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    </div>
    {customers.isError && <COFailure error={customers.error} retry={() => void customers.refetch()}/>}{query.isError ? <COFailure error={query.error} retry={() => void query.refetch()}/> : query.isPending ? <p role="status">Memuat pesanan…</p> : <>
        <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white" role="region" aria-label="Daftar CO" tabIndex={0}>
        <table className="w-full min-w-[70rem] text-sm">
        <thead className="bg-gray-50 text-gray-500">
        <tr>{['Nomor / tanggal CO', 'Pelanggan', 'Status / pengiriman', 'Nilai rencana', 'Terjual / pendapatan', 'Stok tercatat', 'Laporan terakhir', 'Aksi'].map(t => <th key={t} className="px-4 py-3 text-left font-medium">{t}</th>)}</tr>
        </thead>
        <tbody>{rows.map(co => <tr key={co.id} className="border-t border-gray-100">
            <td className="px-4 py-4">{co.co_number}<p className="text-xs text-gray-500">{co.order_date}</p>
            </td>
            <td>{co.customer_name}</td>
            <td>
            <COBadges status={co.status} progress={co.summary.delivery_progress}/>
            </td>
            <td>Rp {formatMoney(co.summary.planned_value, 'full')}</td>
            <td>{quantityText(co.summary.sold_quantity)}<p>Rp {formatMoney(co.summary.revenue, 'full')}</p>
            </td>
            <td>{quantityText(co.summary.remaining_quantity)}</td>
            <td>{co.last_report_month?.slice(0, 7) ?? 'Belum ada'}</td>
            <td>
            <COOrderLinks co={co}/>
            </td>
            </tr>)}</tbody>
        </table>
        </div>
    <div className="md:hidden space-y-3">{rows.map(co => <article key={co.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="break-words">
            <h3 className="font-semibold">{co.co_number}</h3>
            <p className="text-sm text-gray-500">{co.customer_name} · {co.order_date}</p>
            </div>
            <COBadges status={co.status} progress={co.summary.delivery_progress}/>
            <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
            <dt>Nilai rencana</dt>
            <dd className="break-words">Rp {formatMoney(co.summary.planned_value, 'full')}</dd>
            </div>
            <div>
            <dt>Jumlah terjual</dt>
            <dd>{quantityText(co.summary.sold_quantity)}</dd>
            </div>
            <div>
            <dt>Pendapatan terjual</dt>
            <dd className="break-words">Rp {formatMoney(co.summary.revenue, 'full')}</dd>
            </div>
            <div>
            <dt>Stok tercatat</dt>
            <dd>{quantityText(co.summary.remaining_quantity)}</dd>
            </div>
            <div>
            <dt>Laporan terakhir</dt>
            <dd>{co.last_report_month?.slice(0, 7) ?? 'Belum ada'}</dd>
            </div>
            </dl>
            <COOrderLinks co={co}/>
            </article>)}</div>{rows.length === 0 && <p>Tidak ada pesanan ditemukan.</p>}<COPagination page={page} total={query.data?.total ?? '0'} pending={query.isFetching} onPage={setPage}/>
        </>}
  </div>;
}
function COOrderLinks({ co }: {
    co: COOrderRecord;
}) {
    const actor = useCOActor(`order-actions:${co.id}`);
    const authority = useCORead(actor, 'order-actions', { id: co.id, version: co.co_version }, o => fetchCODetail(co.id, co.co_version, o));
    return <div className="flex flex-wrap gap-3">
    <Link className="text-brand-primary" to={`/athel/co/${co.id}`}>Lihat</Link>{!authority.isFetching && !authority.isError && authority.data?.allowed_operations.includes('edit_co') && <Link className="text-gray-600" to={`/athel/co/${co.id}/edit`}>Ubah</Link>}</div>;
}
