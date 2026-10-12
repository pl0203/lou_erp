import { PageHeader } from '../../../components/ui/PageHeader';
import { Field } from '../../../components/ui/Field';
import { FilterBar } from '../../../components/ui/FilterBar';
import { RecordList } from '../../../components/ui/RecordList';
import { SummaryList } from '../../../components/ui/SummaryList';
import { EmptyState } from '../../../components/ui/Feedback';
import { ActionLink } from '../../../components/ui/ActionLink';
import { useState } from 'react';
import { fetchCOPage, fetchCODetail } from '../../../lib/co/rpc';
import { fetchCOCustomers } from '../../../lib/co/catalog';
import type { COOrderRecord } from '../../../lib/co/validation';
import COSourceBoundary from '../../../components/co/COSourceBoundary';
import { formatDisplayDate } from '../../../lib/displayDate';
import { formatCOReportMonth } from '../../../lib/co/presentation';
import { formatMoney } from '../../../lib/reads/money';
import { CO_INPUT, useCOActor, useCORead, COBadges, COPagination, COFailure, quantityText } from '../../../components/co/COShared';
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
    <PageHeader title="Pesanan Konsinyasi" description={query.data ? `${quantityText(query.data.total)} pesanan` : 'Memuat pesanan…'} actions={<ActionLink to="/athel/co/new">+ CO Baru</ActionLink>}/>
    <FilterBar label="Filter pesanan CO">
    <Field id="co-filter-search" label="Cari CO">{control => <input {...control} className={CO_INPUT} aria-label="Cari CO" placeholder="Cari nomor CO atau pelanggan..." value={filters.search} onChange={e => update('search', e.target.value)}/>}</Field>
    <Field id="co-filter-status" label="Status CO">{control => <select {...control} aria-label="Status CO" className={CO_INPUT} value={filters.status} onChange={e => update('status', e.target.value)}>{[['all', 'Semua status'], ['active', 'Aktif'], ['closed', 'Ditutup'], ['cancelled', 'Dibatalkan']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>
    <Field id="co-filter-customer" label="Filter pelanggan">{control => <select {...control} aria-label="Filter pelanggan" className={CO_INPUT} disabled={!customers.data || customers.isFetching || customers.isError} value={filters.customer} onChange={e => update('customer', e.target.value)}>
    <option value="">Semua pelanggan</option>{customers.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
    </FilterBar>
    {customers.isError && <COFailure error={customers.error} retry={() => void customers.refetch()}/>}{query.isError ? <COFailure error={query.error} retry={() => void query.refetch()}/> : query.isPending ? <p role="status">Memuat pesanan…</p> : <>
        <div className="hidden md:block min-w-0 overflow-x-auto rounded-[14px] border border-brand-divider bg-brand-surface" role="region" aria-label="Daftar CO" tabIndex={0}>
        <table className="w-full min-w-[70rem] text-sm">
        <thead className="bg-gray-50 text-brand-secondary">
        <tr>{['Nomor / tanggal CO', 'Pelanggan', 'Status / pengiriman', 'Nilai rencana', 'Terjual / pendapatan', 'Stok tercatat', 'Laporan pelanggan (semua CO)', 'Aksi'].map(t => <th key={t} className="px-4 py-3 text-left font-medium">{t}</th>)}</tr>
        </thead>
        <tbody>{rows.map(co => <tr key={co.id} className="border-t border-brand-divider">
            <td className="px-4 py-4">{co.co_number}<p className="text-[13px] text-brand-secondary">{formatDisplayDate(co.order_date)}</p>
            </td>
            <td>{co.customer_name}</td>
            <td>
            <COBadges status={co.status} progress={co.summary.delivery_progress}/>
            </td>
            <td>Rp {formatMoney(co.summary.planned_value, 'full')}</td>
            <td>{quantityText(co.summary.sold_quantity)}<p>Rp {formatMoney(co.summary.revenue, 'full')}</p>
            </td>
            <td>{quantityText(co.summary.remaining_quantity)}</td>
            <td>{formatCOReportMonth(co.last_report_month)}</td>
            <td>
            <COOrderLinks co={co}/>
            </td>
            </tr>)}</tbody>
        </table>
        </div>
    <RecordList label="Ringkasan pesanan CO" className="md:hidden">{rows.map(co => <li key={co.id}><article className="rounded-[14px] border border-brand-divider bg-brand-surface p-4 space-y-3">
            <div className="break-words">
            <h3 className="font-semibold">{co.co_number}</h3>
            <p className="text-base text-brand-secondary">{co.customer_name} · {formatDisplayDate(co.order_date)}</p>
            </div>
            <COBadges status={co.status} progress={co.summary.delivery_progress}/>
            <SummaryList items={[
                { label: 'Nilai rencana', value: `Rp ${formatMoney(co.summary.planned_value, 'full')}` },
                { label: 'Jumlah terjual', value: quantityText(co.summary.sold_quantity) },
                { label: 'Pendapatan terjual', value: `Rp ${formatMoney(co.summary.revenue, 'full')}` },
                { label: 'Stok tercatat', value: quantityText(co.summary.remaining_quantity) },
                { label: 'Laporan pelanggan (semua CO)', value: formatCOReportMonth(co.last_report_month) },
            ]}/>
            <COOrderLinks co={co}/>
            </article></li>)}</RecordList>{rows.length === 0 && <EmptyState title="Tidak ada pesanan ditemukan."/>}<COPagination page={page} total={query.data?.total ?? '0'} pending={query.isFetching} onPage={setPage}/>
        </>}
  </div>;
}
function COOrderLinks({ co }: {
    co: COOrderRecord;
}) {
    const actor = useCOActor(`order-actions:${co.id}`);
    const authority = useCORead(actor, 'order-actions', { id: co.id, version: co.co_version }, o => fetchCODetail(co.id, co.co_version, o));
    return <div className="flex flex-wrap gap-3">
    <ActionLink variant="secondary" to={`/athel/co/${co.id}`}>Lihat</ActionLink>{!authority.isFetching && !authority.isError && authority.data?.allowed_operations.includes('edit_co') && <ActionLink variant="secondary" to={`/athel/co/${co.id}/edit`}>Ubah</ActionLink>}</div>;
}
