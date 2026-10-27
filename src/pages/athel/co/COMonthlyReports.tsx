import { POCustomerLookup } from '../../../components/POLookup';
import { LoadingState } from '../../../components/ui/LoadingState'
import { useSearchParams } from 'react-router-dom';
import { fetchCOReportsPageV2, fetchCOReportMonths } from '../../../lib/co/rpc';
import { fetchCOCustomers } from '../../../lib/co/catalog';
import { formatAuditTimestamp } from '../../../lib/displayDate';
import { formatCOReportMonth } from '../../../lib/co/presentation';
import { CO_INPUT, COFailure, COFreshness, COPagination, useCOActor, useCORead } from '../../../components/co/COShared';
import { ActionLink } from '../../../components/ui/ActionLink';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Field } from '../../../components/ui/Field';
import { FilterBar } from '../../../components/ui/FilterBar';
import { Section } from '../../../components/ui/Section';
import { EmptyState, StatusBadge } from '../../../components/ui/Feedback';

export default function COMonthlyReports() {
    const [params, setParams] = useSearchParams();
    const requestedMonth = params.get('month') ?? '';
    const customer = params.get('customer') ?? '';
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : '';
    function updateFilter(key: string, value: string) {
        if ((key === 'month' ? month : key === 'status' ? status : customer) === value) return;
        const next = new URLSearchParams(params);
        next.delete('page');
        if (value) next.set(key, value); else next.delete(key);
        setParams(next);
    }
    const status = ['posted','historical_pending'].includes(params.get('status') ?? '') ? params.get('status')! : 'all';
    const requestedPage = params.get('page') ?? '';
    const page = /^[1-9][0-9]*$/.test(requestedPage) && Number.isSafeInteger(Number(requestedPage)) && Number(requestedPage) <= 2147483647 ? Number(requestedPage) : 1;
    const setPage = (value:number) => { const next = new URLSearchParams(params); value === 1 ? next.delete('page') : next.set('page',String(value)); setParams(next); };
    const returnTo = encodeURIComponent(`/athel/co/reports?${params.toString()}`);
    const actor = useCOActor('reports');
    const customers = useCORead(actor, 'customers', {}, fetchCOCustomers);
    const args = { p_customer_id: customer || null, p_month: month ? `${month}-01` : null, p_status: status, p_page: page, p_page_size: 20 };
    const reports = useCORead(actor, 'reports', args, o => fetchCOReportsPageV2(args, o));
    const months = useCORead(actor, 'report-months', { customer }, o => fetchCOReportMonths(customer, o), !!customer);
    const nextMonth = months.data?.reporting_freshness.next_required_report_month;
    if (!actor.enabled) return null;
    return <div className="min-w-0 mx-auto max-w-6xl space-y-5">
        <PageHeader title="Laporan penjualan bulanan" description="Satu laporan per toko dan bulan. Upload PDF/XLSX, periksa sumber, lalu catat penjualan."/>
        <p className="text-sm">Cari toko dan pilih bulan laporan. Tidak perlu memilih nomor CO.</p>
        <FilterBar label="Filter laporan penjualan">
            <Field id="co-report-customer-filter" label="Toko laporan" className="flex-1 basis-56">{control => <POCustomerLookup {...control} customers={customers.data??[]} selectedId={customer} disabled={customers.isFetching||customers.isError} onSelect={c=>updateFilter('customer',c.id)}/>}</Field>
            <Field id="co-report-month-filter" label="Bulan laporan" className="flex-1 basis-56">{control => <input {...control} aria-label="Bulan laporan" className={CO_INPUT} type="month" value={month} onChange={e => { updateFilter('month', e.target.value); }}/>}</Field>
            <Field id="co-report-status-filter" label="Status laporan" className="flex-1 basis-56">{control => <select {...control} aria-label="Status laporan" className={CO_INPUT} value={status} onChange={e => { updateFilter('status', e.target.value); }}><option value="all">Semua</option><option value="historical_pending">Pekerjaan lama perlu diperiksa</option><option value="posted">Tercatat</option></select>}</Field>
        </FilterBar>
        {customers.isError && <COFailure error={customers.error} retry={() => void customers.refetch()}/>}
        {!customer && <p className="text-sm">Pilih toko dan periode untuk mengunggah laporan.</p>}
        {customer && <Section title="Periode laporan pelanggan" aria-label="Periode laporan pelanggan" aria-labelledby={undefined} className="space-y-3">
            {months.isFetching && <LoadingState title="Memeriksa periode laporan berikutnya…" shape="compact" />}
            {months.isError && <COFailure error={months.error} retry={() => void months.refetch()}/>}
            {months.data && !months.isError && <>
                <p className="text-sm">Rentang sumber pelanggan (semua CO): {formatCOReportMonth(months.data.first_month)} sampai {formatCOReportMonth(months.data.last_month)}. Batas periode mengikuti tanggal UTC server.</p>
                <COFreshness value={months.data.reporting_freshness}/>
                {!months.isFetching && (months.data.reporting_freshness.status === 'no_recorded_activity'
                    ? <p className="text-sm">Posting Surat Jalan terlebih dahulu agar ada sumber aktivitas laporan. Draft Surat Jalan belum menjadi sumber laporan.</p>
                    : nextMonth ? <>
                        <p className="text-sm">Periode berikutnya: <strong>{formatCOReportMonth(nextMonth)}</strong>. Unggah sumber, periksa semua barang, lalu konfirmasikan pencatatan.</p>
                    </> : <p className="text-sm">Tidak ada periode wajib yang perlu dilengkapi saat ini. Laporan historis tetap dapat dibuka melalui daftar atau filter bulan.</p>)}
            </>}
        </Section>}
        {customer && (month || !months.isFetching && !months.isError && nextMonth) && <ActionLink variant="primary" to={`/athel/co/reports/${customer}/${month ? `${month}-01` : nextMonth}?upload=1&returnTo=${returnTo}`}>Unggah laporan bulanan</ActionLink>}
        {reports.isError ? <COFailure error={reports.error} retry={() => void reports.refetch()}/> : !reports.data ? <LoadingState title="Memuat laporan…" shape="list" /> : <>
            <p className="text-sm text-brand-secondary">Cakupan daftar: {customer ? 'pelanggan dipilih, semua CO' : 'semua pelanggan yang dapat diakses'} · {month ? formatCOReportMonth(month) : 'semua periode tercatat'} · {status === 'all' ? 'semua status' : status === 'posted' ? 'tercatat' : 'pekerjaan lama perlu diperiksa'}. Daftar kosong berarti belum ada laporan sesuai filter, bukan penjualan terverifikasi nol.</p>
            <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Laporan penjualan pelanggan</caption><thead><tr>{['Toko','Periode','Status','Sumber','Waktu catatan (WIB)','Tindakan'].map(label=><th key={label} scope="col" className="p-3 border-b whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{reports.data.rows.map(h=><tr key={h.id}>
                <th scope="row" className="p-3 border-b font-medium">{h.customer_name}</th><td className="p-3 border-b whitespace-nowrap">{formatCOReportMonth(h.report_month)}</td>
                <td className="p-3 border-b"><StatusBadge tone={h.status==='posted'?'success':'warning'}>{h.status==='posted'?'Tercatat':'Pekerjaan lama · perlu diperiksa'}</StatusBadge></td>
                <td className="p-3 border-b">{h.source_filename??'Tidak tersedia'}</td><td className="p-3 border-b whitespace-nowrap">{formatAuditTimestamp(h.updated_at,'WIB')}</td>
                <td className="p-3 border-b"><ActionLink variant="quiet" size="compact" to={`/athel/co/reports/${h.customer_id}/${h.report_month}?returnTo=${returnTo}`}>Buka laporan</ActionLink>{h.legacy_pending&&<ActionLink variant="quiet" size="compact" to={`/athel/co/reports/${h.customer_id}/${h.report_month}?recovery=legacy&returnTo=${returnTo}`}>Periksa pekerjaan lama</ActionLink>}</td>
            </tr>)}</tbody></table></div>
            {reports.data.total === '0' && <EmptyState title="Belum ada laporan sesuai filter."/>}
            <COPagination page={page} total={reports.data.total} pending={reports.isFetching} onPage={setPage}/>
        </>}
    </div>;
}
