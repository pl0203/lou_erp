import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchCOCustomers } from '../../../lib/co/catalog';
import { fetchCOCustomerStock } from '../../../lib/co/rpc';
import { formatCOReportMonth } from '../../../lib/co/presentation';
import { formatDisplayDate } from '../../../lib/displayDate';
import { coKeys } from '../../../lib/co/queryKeys';
import { isCOAuthorityError } from '../../../components/co/COReportWorkspace';
import { CO_INPUT, COFailure, COFreshness, COPagination, useCOActor, useCORead } from '../../../components/co/COShared';
import COStockHistory from '../../../components/co/COStockHistory';
import COReturnDialog from '../../../components/co/COReturnDialog';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Button } from '../../../components/ui/Button';
import { Field } from '../../../components/ui/Field';
import { FilterBar } from '../../../components/ui/FilterBar';
import { SummaryList } from '../../../components/ui/SummaryList';
import { EmptyState } from '../../../components/ui/Feedback';

function monthEnd(month: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    date.setUTCDate(0);
    return date.toISOString().slice(0, 10);
}
export default function COCustomerStock() {
    const [params, setParams] = useSearchParams();
    const customer = params.get('customer') ?? '';
    const sku = params.get('sku') ?? '';
    const period = params.get('month') ?? '';
    const search = params.get('search') ?? '';
    const [page, setPage] = useState(1);
    const [returning, setReturning] = useState(false);
    const [failure, setFailure] = useState<unknown>(null);
    const [error, setError] = useState('');
    const [epoch, setEpoch] = useState(0);
    const trigger = useRef<HTMLElement | null>(null);
    const actor = useCOActor(`stock:${customer}:${period}`);
    const asOf = period ? monthEnd(period) : null;
    const args = { p_customer_id: customer || null, p_as_of: asOf, p_search: search,
        p_expected_customer_version: null, p_page: page, p_page_size: 20 };
    const customers = useCORead(actor, 'customers', {}, fetchCOCustomers, !failure);
    const stock = useCORead(actor, 'customer-stock', { ...args, epoch }, o => fetchCOCustomerStock(args, o), !failure && (!period || !!asOf));
    const denied = useRef(false);
    function rejectAuthority(value: unknown) {
        if (!actor.isCurrent() || !isCOAuthorityError(value)) return;
        denied.current = true;
        setFailure(value);
        setReturning(false);
        const queryKey = coKeys.identity(actor.identity);
        void actor.client.cancelQueries({ queryKey });
        actor.client.removeQueries({ queryKey });
    }
    useEffect(() => {
        if (isCOAuthorityError(stock.error)) rejectAuthority(stock.error);
        if (isCOAuthorityError(customers.error)) rejectAuthority(customers.error);
    }, [stock.error, customers.error]);
    useEffect(() => { setPage(1); setReturning(false); }, [customer, period, search]);
    const update = (key: string, value: string) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value); else next.delete(key);
        if (key === 'customer') { next.delete('sku'); next.delete('co'); }
        setParams(next);
    };
    if (!actor.enabled) return null;
    if (failure) return <COFailure error={failure} retry={() => {
        denied.current = false;
        setFailure(null);
        setEpoch(n => n + 1);
    }}/>;
    const customerIdentity = (id: string) => {
        const canonical = !customers.isError ? customers.data?.find(row => row.id === id) : undefined;
        return canonical?.name ?? `Identitas pelanggan tidak tersedia (${id})`;
    };
    const blocked = stock.isFetching || stock.isError || !stock.data;
    const readFailure = stock.isError ? <COFailure error={stock.error} retry={() => void stock.refetch()}/> : null;
    return <div className="min-w-0 max-w-6xl mx-auto space-y-5">
        <PageHeader title="Stok pelanggan" description="Stok buku tercatat. Stok terkini memakai pergerakan bulan berjalan sampai cakupan server."/>
        <p className="text-base text-brand-secondary">Stok pelanggan mencakup semua CO pada cakupan dipilih. Retur berlaku untuk pelanggan.</p>
        <FilterBar label="Filter stok pelanggan">
            <Field id="co-stock-customer-filter" label="Pelanggan stok" className="flex-1 basis-56">{control => <select {...control} aria-label="Pelanggan stok" className={CO_INPUT} value={customer} onChange={e => update('customer', e.target.value)}>
                <option value="">Semua pelanggan</option>{customers.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>}</Field>
            <Field id="co-stock-search-filter" label="Cari SKU stok" className="flex-1 basis-56">{control => <input {...control} aria-label="Cari SKU stok" className={CO_INPUT} value={search} onChange={e => update('search', e.target.value)}/>}</Field>
            <Field id="co-stock-month-filter" label="Bulan akhir stok" className="flex-1 basis-56">{control => <input {...control} aria-label="Bulan akhir stok" className={CO_INPUT} type="month" value={period}
                max={(stock.data?.as_of ?? new Date().toISOString()).slice(0, 7)} onChange={e => {
                    const end = e.target.value ? monthEnd(e.target.value) : null;
                    const today = (stock.data?.as_of ?? new Date().toISOString()).slice(0, 10);
                    if (end && end > today) { setError('Pilih akhir bulan yang sudah selesai menurut tanggal UTC server.'); return; }
                    setError(''); update('month', e.target.value);
                }}/>}</Field>
        </FilterBar>
        <Button variant="secondary" onClick={() => update('month', '')}>Stok terkini</Button>
        {period && !asOf && <COFailure error={new Error('Bulan stok tidak valid. Pilih bulan kalender.')}/>}
        {error && <COFailure error={new Error(error)}/>}
        {customers.isError && <COFailure error={customers.error} retry={() => void customers.refetch()}/>}
        {customer && <Button variant="primary" disabled={blocked} onClick={e => { trigger.current = e.currentTarget; setReturning(true); }}>Retur barang belum terjual</Button>}
        {!returning && readFailure}
        {!stock.data && !stock.isError && <p role="status">Memuat stok…</p>}
        {stock.data && !stock.isError && <>
            <p className="text-sm">Periode {formatDisplayDate(stock.data.period_start)} sampai {formatDisplayDate(stock.data.coverage_date)} (tanggal UTC server) · {asOf ? 'Akhir bulan, riwayat efektif dinyatakan ulang' : 'Stok terkini, bulan berjalan'}</p>
            <p className="text-sm">Total seluruh hasil filter: {stock.data.summary.opening_quantity} + {stock.data.summary.delivered_quantity} − {stock.data.summary.sold_quantity} − {stock.data.summary.returned_quantity} = {stock.data.summary.recorded_quantity}</p>
            {stock.data.reporting_freshness && <COFreshness value={stock.data.reporting_freshness}/>}
            {!stock.data.reporting_freshness && <p className="text-[13px] text-brand-secondary">Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.</p>}
            {stock.data.rows.some(row => !row.has_delivery_history) && <p className="text-[13px] text-brand-secondary">Belum ada riwayat pengiriman pada barang bertanda Belum dikirim. Nol tercatat tidak membuktikan saldo fisik awal.</p>}
            <div role="region" aria-label="Daftar stok pelanggan" tabIndex={0} className="min-w-0 max-w-full overflow-x-auto rounded-[14px] focus-visible:outline-2 focus-visible:outline-brand-primary"><table aria-label="Stok pelanggan tercatat" className="block w-full md:table md:table-fixed md:border-collapse text-sm">
                <thead className="hidden md:table-header-group text-left text-brand-secondary">
                    <tr><th className="p-3 w-[28%]">Pelanggan / barang</th><th className="p-3 w-[24%]">Jumlah stok</th><th className="p-3 w-[28%]">Pelaporan</th><th className="p-3 w-[20%]">Riwayat</th></tr>
                </thead>
                <tbody className="block md:table-row-group">{stock.data.rows.map(row => <tr key={`${row.customer_id}:${row.id}`}
                    className="mb-3 block rounded-xl border border-brand-divider bg-brand-surface md:table-row md:rounded-none">
                    <td className="block p-3 align-top md:table-cell">
                        <p className="font-semibold break-words">{customerIdentity(row.customer_id)}</p>
                        <h3 className="font-medium break-words">{row.display_sku} · {row.product_name}</h3>
                        {!row.has_delivery_history && <p className="text-[13px] mt-2 text-brand-secondary">Belum dikirim</p>}
                    </td>
                    <td className="block p-3 align-top md:table-cell">
                        <SummaryList aria-label="Jumlah stok" className="tabular-nums [&_.ui-summary-list__item]:grid [&_.ui-summary-list__item]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&_dd]:text-right [&_dd]:font-medium [&_dd]:break-all" items={[
                            { label: 'Awal', value: row.opening_quantity }, { label: 'Dikirim', value: row.delivered_quantity },
                            { label: 'Terjual', value: row.sold_quantity }, { label: 'Retur', value: row.returned_quantity }, { label: 'Sisa tercatat', value: row.recorded_quantity },
                        ].map(item => ({ ...item, value: <span style={{ fontSize: '14px' }}>{item.value}</span> }))}/>
                        <p className="sr-only">{row.opening_quantity} + {row.delivered_quantity} − {row.sold_quantity} − {row.returned_quantity} = {row.recorded_quantity}</p>
                    </td>
                    <td className="block p-3 align-top md:table-cell">
                        <p className="text-[13px]">Laporan terakhir: {formatCOReportMonth(row.last_report_month)} · Cakupan sampai: {row.coverage_through_date ? formatDisplayDate(row.coverage_through_date) : 'Belum ada'} (UTC)
                            {row.coverage_through_date && row.coverage_through_date !== monthEnd(row.coverage_through_date.slice(0, 7)) ? ' · bulan parsial' : ''}</p>
                        <COFreshness value={row.reporting_freshness} compact/>
                    </td>
                    <td className="block p-3 align-top md:table-cell">
                        <Button variant="secondary" className="w-full px-2" aria-label={`Lihat pergerakan ${customerIdentity(row.customer_id)} · ${row.display_sku}`} onClick={() => {
                            const next = new URLSearchParams(params);
                            next.set('customer', row.customer_id); next.set('sku', row.id); setParams(next);
                        }}>Pergerakan</Button>
                    </td>
                </tr>)}</tbody>
            </table></div>
            {stock.data.total === '0' && <EmptyState title="Tidak ada kunci stok sesuai filter.">Saldo historis awal tidak diasumsikan.</EmptyState>}
            <COPagination page={page} total={stock.data.total} pending={stock.isFetching} onPage={setPage}/>
        </>}
        {customer && sku && <COStockHistory key={`${actor.scope}:${sku}:${asOf}`} customerId={customer} stockKeyId={sku} asOf={asOf} onAuthorityFailure={rejectAuthority}/>}
        {returning && stock.data && <COReturnDialog key={`${actor.scope}:${epoch}`} customerId={customer}
            customerVersion={stock.data.customer_version} returnFocus={trigger.current} onClose={() => setReturning(false)}
            blocked={blocked} readFailure={readFailure} onAuthorityFailure={rejectAuthority}
            onSaved={() => { void stock.refetch(); }}/>}
    </div>;
}
