import { LoadingState } from '../../../components/ui/LoadingState'
import { PageHeader } from '../../../components/ui/PageHeader';
import { Field } from '../../../components/ui/Field';
import { FilterBar } from '../../../components/ui/FilterBar';
import { RecordList } from '../../../components/ui/RecordList';
import { SummaryList } from '../../../components/ui/SummaryList';
import { EmptyState } from '../../../components/ui/Feedback';
import { ActionLink } from '../../../components/ui/ActionLink';
import { useSearchParams, useLocation } from 'react-router-dom';
import { fetchCOPageV2 } from '../../../lib/co/rpc';
import { fetchCOCustomers } from '../../../lib/co/catalog';
import type { COOrderRecord } from '../../../lib/co/validation';
import type { COOrdersPageFilters } from '../../../lib/co/contracts';
import COSourceBoundary from '../../../components/co/COSourceBoundary';
import { formatDisplayDate } from '../../../lib/displayDate';
import { formatMoney } from '../../../lib/reads/money';
import { CO_INPUT, useCOActor, useCORead, COBadges, COPagination, COFailure, quantityText } from '../../../components/co/COShared';
export default function COOrders() {
    return <COSourceBoundary source="orders" check={options => fetchCOPageV2({ status: 'all', search: '', customerId: null, sort: 'order_date', direction: 'desc', page: 1, pageSize: 20 }, options)}><OrdersOwner/></COSourceBoundary>;
}
function OrdersOwner() {
    const actor = useCOActor('orders');
    const [params, setParams] = useSearchParams();
    const filters = { search: params.get('search') ?? '', status: ['all', 'active', 'closed', 'cancelled'].includes(params.get('status') ?? '') ? params.get('status')! : 'all', customer: params.get('customer') ?? '' };
    const rawPage = params.get('page') ?? '1';
    const page = /^[1-9]\d*$/.test(rawPage) && Number(rawPage) <= 2147483647 ? Number(rawPage) : 1;
    const setPage = (value: number) => setParams(previous => { const next = new URLSearchParams(previous); next.set('page', String(value)); return next; });
    const sort = params.get('sort') === 'co_number' ? 'co_number' : 'order_date';
    const direction = params.get('direction') === 'asc' ? 'asc' : 'desc';
    const args: COOrdersPageFilters = { status: filters.status as COOrdersPageFilters['status'], search: filters.search, customerId: filters.customer || null, sort, direction, page, pageSize: 20 };
    const query = useCORead(actor, 'orders', args, o => fetchCOPageV2(args, o));
    const customers = useCORead(actor, 'customers', {}, fetchCOCustomers);
    const update = (key: keyof typeof filters | 'sort' | 'direction', value: string) => setParams(previous => { const next = new URLSearchParams(previous); if (value && value !== 'all') next.set(key, value); else next.delete(key); next.set('page', '1'); return next; });
    const rows = (query.data?.rows ?? []) as (COOrderRecord & {sku_count:string})[];
    if (!actor.enabled)
        return null;
    return <div className="space-y-5">
    <PageHeader title="Pesanan CO" description={query.data ? `${quantityText(query.data.total)} pesanan` : 'Memuat pesanan…'} actions={<ActionLink to="/athel/co/new">Buat CO</ActionLink>}/>
    <p className="text-sm text-brand-secondary">Nilai CO · IDR · jumlah dipesan × harga kesepakatan CO, bukan pendapatan.</p>
    <FilterBar label="Filter pesanan CO">
    <Field id="co-filter-search" label="Cari CO" className="flex-1 basis-72">{control => <input {...control} className={CO_INPUT} aria-label="Cari CO" placeholder="Cari nomor CO atau pelanggan..." value={filters.search} onChange={e => update('search', e.target.value)}/>}</Field>
    <Field id="co-filter-status" label="Status CO" className="flex-1 basis-44">{control => <select {...control} aria-label="Status CO" className={CO_INPUT} value={filters.status} onChange={e => update('status', e.target.value)}>{[['all', 'Semua status'], ['active', 'Aktif'], ['closed', 'Ditutup'], ['cancelled', 'Dibatalkan']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>
    <Field id="co-filter-customer" label="Filter pelanggan" className="flex-1 basis-60">{control => <select {...control} aria-label="Filter pelanggan" className={CO_INPUT} disabled={!customers.data || customers.isFetching || customers.isError} value={filters.customer} onChange={e => update('customer', e.target.value)}>
    <option value="">Semua pelanggan</option>{customers.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
    <Field id="co-order-sort" label="Urutkan pesanan">{control => <select {...control} className={CO_INPUT} value={sort} onChange={e=>update('sort',e.target.value)}><option value="order_date">Tanggal CO</option><option value="co_number">Nomor CO (teks)</option></select>}</Field>
    <Field id="co-order-direction" label="Arah urutan pesanan">{control => <select {...control} className={CO_INPUT} value={direction} onChange={e=>update('direction',e.target.value)}><option value="asc">Naik</option><option value="desc">Turun</option></select>}</Field>
    </FilterBar>
    {customers.isError && <COFailure error={customers.error} retry={() => void customers.refetch()}/>}{query.isError ? <COFailure error={query.error} retry={() => void query.refetch()}/> : query.isPending ? <LoadingState title="Memuat pesanan…" shape="list" /> : <>
        <div className="hidden md:block min-w-0 overflow-x-auto rounded-[14px] border border-brand-divider bg-brand-surface" role="region" aria-label="Daftar CO" tabIndex={0}>
        <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-gray-50 text-brand-secondary">
        <tr>{['Nomor CO', 'Toko', 'Tanggal CO', 'Status / pengiriman', 'Jumlah SKU', 'Nilai CO', 'Aksi'].map(t => <th key={t} className="px-4 py-3 text-left font-medium">{t}</th>)}</tr>
        </thead>
        <tbody>{rows.map(co => <tr key={co.id} className="border-t border-brand-divider">
            <td className="px-4 py-3 font-medium">{co.co_number}</td>
            <td className="px-3 py-3">{co.customer_name}</td>
            <td className="px-3 py-3">{formatDisplayDate(co.order_date)}</td>
            <td className="px-3 py-3"><COBadges status={co.status} progress={co.summary.delivery_progress}/></td>
            <td className="px-3 py-3 text-right tabular-nums">{quantityText(co.sku_count)}</td>
            <td className="px-3 py-3 text-right tabular-nums">Rp {formatMoney(co.summary.planned_value, 'full')}</td>
            <td className="min-w-36 px-3 py-3">
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
                { label: 'Nilai CO', value: `Rp ${formatMoney(co.summary.planned_value, 'full')}` },
                { label: 'Jumlah SKU', value: quantityText(co.sku_count) },
            ]}/>
            <COOrderLinks co={co}/>
            </article></li>)}</RecordList>{rows.length === 0 && <EmptyState title="Tidak ada pesanan ditemukan."/>}<COPagination page={page} total={query.data?.total ?? '0'} pending={query.isFetching} onPage={setPage}/>
        </>}
  </div>;
}
function COOrderLinks({ co }: {
    co: COOrderRecord;
}) {
    const location = useLocation();
    const detailState = { coOrdersURL: `/athel/co${location.search}` };
    return <div className="flex flex-wrap items-center gap-2">
    <ActionLink variant="quiet" size="compact" to={`/athel/co/${co.id}`} state={detailState}>Lihat CO</ActionLink></div>;
}
