import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchCOReportsPage, fetchCOReportMonths } from '../../../lib/co/rpc';
import { fetchCOCustomers } from '../../../lib/co/catalog';
import { formatDisplayDate } from '../../../lib/displayDate';
import { formatCOReportMonth } from '../../../lib/co/presentation';
import { CO_INPUT, CO_BUTTON, COFailure, COFreshness, COPagination, useCOActor, useCORead } from '../../../components/co/COShared';
import type { COReportHeader } from '../../../lib/co/validation';

export default function COMonthlyReports() {
    const [params] = useSearchParams();
    const initialMonth = params.get('month') ?? '';
    const [customer, setCustomer] = useState(params.get('customer') ?? '');
    const [month, setMonth] = useState(/^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : '');
    const [status, setStatus] = useState('all');
    const [page, setPage] = useState(1);
    const actor = useCOActor('reports');
    const customers = useCORead(actor, 'customers', {}, fetchCOCustomers);
    const args = { p_customer_id: customer || null, p_month: month ? `${month}-01` : null, p_status: status, p_page: page, p_page_size: 20 };
    const reports = useCORead(actor, 'reports', args, o => fetchCOReportsPage(args, o));
    const months = useCORead(actor, 'report-months', { customer }, o => fetchCOReportMonths(customer, o), !!customer);
    const nextMonth = months.data?.reporting_freshness.next_required_report_month;
    if (!actor.enabled) return null;
    return <div className="mx-auto max-w-6xl space-y-5">
        <h2 className="text-xl font-semibold">Laporan penjualan bulanan</h2>
        <p className="text-sm text-gray-700">Satu laporan pelanggan/periode mencakup semua CO. Draft belum mengubah stok, pendapatan atau kredit PIC.</p>
        <p className="text-sm">Pilih pelanggan dan bulan untuk membuka atau menyiapkan laporan. Di halaman laporan, pilih Siapkan / perbarui draft bila belum ada draft.</p>
        <div className="rounded-xl border border-gray-200 bg-white p-4 grid gap-3 sm:grid-cols-3">
            <label>Pelanggan<select aria-label="Pelanggan laporan" className={CO_INPUT} value={customer} onChange={e => { setCustomer(e.target.value); setPage(1); }}><option value="">Semua pelanggan</option>{customers.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Bulan<input aria-label="Bulan laporan" className={CO_INPUT} type="month" value={month} onChange={e => { setMonth(e.target.value); setPage(1); }}/></label>
            <label>Status<select aria-label="Status laporan" className={CO_INPUT} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">Semua</option><option value="draft">Draft</option><option value="posted">Diposting</option></select></label>
        </div>
        {customers.isError && <COFailure error={customers.error} retry={() => void customers.refetch()}/>}
        {months.isError && <COFailure error={months.error} retry={() => void months.refetch()}/>}
        {customer && months.data && !months.isError && <section className="rounded-xl border bg-white p-4 space-y-3" aria-label="Periode laporan pelanggan">
            <p className="text-sm">Rentang sumber pelanggan (semua CO): {formatCOReportMonth(months.data.first_month)} sampai {formatCOReportMonth(months.data.last_month)}. Batas periode mengikuti tanggal UTC server.</p>
            {!months.data.first_month && <p className="text-sm">Belum ada sumber aktivitas tercatat. Siapkan dan posting pengiriman terlebih dahulu; draft Surat Jalan belum menjadi sumber laporan.</p>}
            <COFreshness value={months.data.reporting_freshness}/>
            {!months.isFetching && nextMonth && <Link className={`${CO_BUTTON} inline-block`} to={`/athel/co/reports/${customer}/${nextMonth}`}>Buka periode berikutnya: {formatCOReportMonth(nextMonth)}</Link>}
            {!months.isFetching && month && <Link className={`${CO_BUTTON} inline-block`} to={`/athel/co/reports/${customer}/${month}-01`}>Buka / siapkan laporan</Link>}
        </section>}
        {reports.isError ? <COFailure error={reports.error} retry={() => void reports.refetch()}/> : !reports.data ? <p role="status">Memuat laporan…</p> : <>
            <p className="text-sm text-gray-700">Cakupan daftar: {customer ? 'pelanggan dipilih, semua CO' : 'semua pelanggan yang dapat diakses'} · {month ? formatCOReportMonth(month) : 'semua periode tercatat'} · {status === 'all' ? 'semua status' : status === 'posted' ? 'diposting' : 'draft'}. Daftar kosong berarti belum ada laporan sesuai filter, bukan penjualan terverifikasi nol.</p>
            <div className="space-y-3">{(reports.data.rows as COReportHeader[]).map(h => <Link key={h.id} className="block rounded-xl border border-gray-200 bg-white p-4 text-sm" to={`/athel/co/reports/${h.customer_id}/${h.report_month}`}>
                <p className="font-medium">{h.customer_name} · {formatCOReportMonth(h.report_month)}</p>
                <p>{h.status === 'draft' ? 'Draft' : 'Diposting'} {h.report_version && BigInt(h.report_version) > 1n ? `· Revisi ${h.report_version}` : ''}</p>
                <p>{h.entered_count}/{h.row_count} terisi · cakupan {formatDisplayDate(h.coverage_through_date)}{h.is_partial_month ? ' (bulan parsial)' : ''}</p>
            </Link>)}</div>
            {reports.data.total === '0' && <p>Belum ada laporan sesuai filter.</p>}
            <COPagination page={page} total={reports.data.total} pending={reports.isFetching} onPage={setPage}/>
        </>}
    </div>;
}
