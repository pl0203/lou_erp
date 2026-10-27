import COSourceProposalResume from '../../../components/co/COSourceProposalResume';
import { coSourceProposalRequest } from '../../../lib/co/workspaceReads';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchCOCustomers } from '../../../lib/co/catalog';
import { fetchCOStockV2 } from '../../../lib/co/rpc';
import type { COStockPageV2, StockFilters } from '../../../lib/co/contracts';
import { formatCOReportMonth } from '../../../lib/co/presentation';
import { formatDisplayDate } from '../../../lib/displayDate';
import { CO_INPUT, COFailure, COFreshness, useCOActor, useCORead } from '../../../components/co/COShared';
import COSourceBoundary from '../../../components/co/COSourceBoundary';
import COStockTable from '../../../components/co/COStockTable';
import COStockHistory from '../../../components/co/COStockHistory';
import COReturnDialog from '../../../components/co/COReturnDialog';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Button } from '../../../components/ui/Button';
import { ActionLink } from '../../../components/ui/ActionLink';
import { Field } from '../../../components/ui/Field';
import { FilterBar } from '../../../components/ui/FilterBar';
import { LoadingState } from '../../../components/ui/LoadingState';

function monthEnd(month: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0);
    return date.toISOString().slice(0, 10);
}
function stockFilters(params: URLSearchParams): StockFilters {
    const raw = params.get('page') ?? '1';
    return { customerId: params.get('customer') || null, sku: params.get('sku')?.trim() || null, search: params.get('search') ?? '', asOf: monthEnd(params.get('month') ?? ''),
        sort: params.get('sort') === 'customer' ? 'customer' : params.get('sort') === 'balance' ? 'balance' : 'sku', direction: params.get('direction') === 'desc' ? 'desc' : 'asc',
        page: /^[1-9]\d*$/.test(raw) && Number(raw) <= 2147483647 ? Number(raw) : 1, pageSize: params.get('pageSize') === '100' ? 100 : params.get('pageSize') === '50' ? 50 : 25 };
}
export default function COCustomerStock() {
    const [params] = useSearchParams();
    let request;try{request=coSourceProposalRequest(params,params.get('customer')??'')}catch(error){return <COFailure error={error}/>;}
    return <COSourceBoundary source="stock" check={options => fetchCOStockV2(stockFilters(params), options)}>{request?<COSourceProposalResume key={JSON.stringify(request)} request={request} owner={{kind:'return'}}/>:<StockOwner/>}</COSourceBoundary>;
}
function StockOwner() {
    const [params, setParams] = useSearchParams();
    const filters = stockFilters(params);
    const period = params.get('month') ?? '';
    const invalidMonth = !!period && !filters.asOf;
    const actor = useCOActor(`stock:${JSON.stringify(filters)}`);
    const [returning, setReturning] = useState(false);
    const [error, setError] = useState('');
    const trigger = useRef<HTMLElement | null>(null);
    const movementTrigger = useRef<HTMLElement | null>(null);
    const directoryActor = useCOActor('stock-directory');
    const customers = useCORead(directoryActor, 'customers', {}, fetchCOCustomers);
    const stock = useCORead(actor, 'customer-stock-v2', filters, async options => await fetchCOStockV2(filters, options) as COStockPageV2, !invalidMonth);
    const result = stock.data;
    const serverAsOf = useRef<string | null>(null);
    if (result) serverAsOf.current = result.as_of;
    const update = (next: StockFilters) => {
        const url = new URLSearchParams(params);
        for (const [key,value] of Object.entries({customer:next.customerId,sku:next.sku,search:next.search,month:next.asOf?.slice(0,7),sort:next.sort,direction:next.direction,page:String(next.page),pageSize:String(next.pageSize)})) {
            if (value) url.set(key,value); else url.delete(key);
        }
        url.delete('stockKey'); url.delete('movementCustomer'); url.delete('movementPage');
        setReturning(false); setParams(url);
    };
    const setFilter = (change: Partial<StockFilters>) => update({...filters,...change,page:1});
    const selectedName = result?.rows[0]?.customer_name ?? customers.data?.find(c => c.id === filters.customerId)?.name;
    const stockKey = params.get('stockKey');
    const movementCustomer = params.get('movementCustomer');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const movementValid = !!stockKey && !!movementCustomer && uuid.test(stockKey) && uuid.test(movementCustomer);
    const movementRow = result?.rows.find(row => row.customer_id === movementCustomer && row.stock_key_id === stockKey);
    const closeMovement = () => {const next=new URLSearchParams(params);next.delete('stockKey');next.delete('movementCustomer');next.delete('movementPage');setParams(next);};
    const blocked = stock.isFetching || stock.isError || !result || !!filters.asOf;
    if (!actor.enabled) return null;
    return <div className="min-w-0 max-w-7xl mx-auto space-y-3">
        <PageHeader title="Stok Pelanggan" description={filters.customerId ? `${selectedName ?? 'Toko dipilih'} · stok seluruh CO pelanggan` : 'Stok seluruh CO · filter toko dan SKU dapat digabung.'}/>
        <FilterBar label="Filter stok pelanggan">
            <Field id="co-stock-customer-filter" label="Pelanggan stok" className="flex-1 basis-44">{control => <select {...control} aria-label="Pelanggan stok" className={CO_INPUT} value={filters.customerId ?? ''} disabled={customers.isError} onChange={e => setFilter({customerId:e.target.value || null})}><option value="">Semua pelanggan</option>{customers.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
            <Field id="co-stock-sku-filter" label="SKU tepat" className="flex-1 basis-36">{control => <input {...control} aria-label="SKU tepat" className={CO_INPUT} placeholder="Semua SKU" value={params.get('sku') ?? ''} onChange={e => setFilter({sku:e.target.value || null})}/>}</Field>
            <Field id="co-stock-search-filter" label="Cari SKU stok" className="flex-1 basis-44">{control => <input {...control} aria-label="Cari SKU stok" placeholder="SKU / nama barang" className={CO_INPUT} value={filters.search} onChange={e => setFilter({search:e.target.value})}/>}</Field>
            <Field id="co-stock-month-filter" label="Bulan akhir stok" className="flex-1 basis-40">{control => <input {...control} aria-label="Bulan akhir stok" className={CO_INPUT} type="month" value={period} max={serverAsOf.current?.slice(0,7)} onChange={e => {
                const end = monthEnd(e.target.value), today = serverAsOf.current?.slice(0,10);
                if (end && today && end > today) { setError('Pilih akhir bulan yang sudah selesai menurut tanggal UTC server.'); return; }
                setError(''); setFilter({asOf:end});
            }}/>}</Field>
        </FilterBar>
        <div className="flex flex-wrap items-center gap-3"><Button variant="quiet" size="compact" disabled={stock.isFetching || invalidMonth} onClick={() => void stock.refetch()}>Muat ulang stok</Button><Button variant="quiet" size="compact" onClick={() => {setError('');setFilter({asOf:null});}}>Stok terkini</Button>{filters.customerId && <><ActionLink variant="primary" size="compact" to={`/athel/co/reports?customer=${filters.customerId}`}>Catat penjualan</ActionLink><div role="group" aria-label="Pengembalian barang"><Button variant="quiet" size="compact" disabled={blocked} onClick={e => {trigger.current=e.currentTarget;setReturning(true);}}>Retur barang belum terjual</Button></div></>}</div>
        {invalidMonth && <COFailure error={new Error('Bulan stok tidak valid. Pilih bulan kalender.')}/>}
        {error && <COFailure error={new Error(error)}/>}
        {customers.isError && <COFailure error={customers.error} retry={() => void customers.refetch()}/>}
        {stock.isError ? <COFailure error={stock.error} retry={() => void stock.refetch()}/> : !invalidMonth && (!result || stock.isFetching) ? <LoadingState title="Memuat stok…" shape="list"/> : result && !invalidMonth ? <>
            <p className="text-[13px] text-brand-secondary">Pergerakan periode {formatDisplayDate(result.period_start)}–{formatDisplayDate(result.coverage_date)} (UTC): Dikirim, Terjual, Retur. Awal = saldo sebelum periode. Saldo tercatat per {formatDisplayDate(result.coverage_date)} (UTC). {filters.asOf ? 'Akhir bulan, riwayat efektif dinyatakan ulang.' : 'Bulan berjalan sampai cakupan server.'}</p>
            {result.reporting_freshness ? <div className="co-stock-freshness" role="note" aria-label="Cakupan pelaporan toko">{result.rows[0] && <p>Laporan terakhir: {formatCOReportMonth(result.rows[0].last_report_month)} · Cakupan sampai: {result.rows[0].coverage_through_date ? formatDisplayDate(result.rows[0].coverage_through_date) : 'Belum ada'} (tanggal UTC)</p>}<COFreshness value={result.reporting_freshness} compact/><p>Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.</p></div> : <p className="text-[13px] text-brand-secondary">Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.</p>}
            <COStockTable key={`${actor.scope}:table`} result={result} filters={filters} onFiltersChange={update} onOpenMovement={(customerId,stockKeyId,element) => {
                movementTrigger.current = element ?? null;
                const next = new URLSearchParams(params); next.set('movementCustomer',customerId); next.set('stockKey',stockKeyId); next.delete('movementPage'); setParams(next);
            }}/>
        </> : null}
        {movementValid && !stock.isError && <COStockHistory key={`${actor.scope}:${movementCustomer}:${stockKey}`} customerId={movementCustomer} stockKeyId={stockKey} asOf={filters.asOf} blocked={stock.isFetching || !result} context={movementRow} customerName={customers.data?.find(c=>c.id===movementCustomer)?.name} onClose={closeMovement} returnFocus={movementTrigger.current} fallbackFocus={()=>document.getElementById('co-stock-sku-filter')} onAuthorityFailure={actor.rejectAuthority}/>}

        {returning && result && filters.customerId && !filters.asOf && <COReturnDialog key={`${actor.scope}:return`} customerId={filters.customerId} customerVersion={result.customer_version!} returnFocus={trigger.current} onClose={() => setReturning(false)} blocked={blocked} readFailure={stock.isError ? <COFailure error={stock.error}/> : null} onAuthorityFailure={actor.rejectAuthority} onSaved={() => {void stock.refetch();}}/>}
    </div>;
}
