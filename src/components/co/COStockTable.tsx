import { useState } from 'react';
import type { COStockPageV2, COStockRowV2, StockFilters } from '../../lib/co/contracts';
import { fetchCOCustomerBatchesV2 } from '../../lib/co/rpc';
import { assertCOBatchParent } from '../../lib/co/workspaceReads';
import { formatAuditTimestamp } from '../../lib/displayDate';
import { formatMoney } from '../../lib/reads/money';
import { Button } from '../ui/Button';
import { ActionLink } from '../ui/ActionLink';
import { EmptyState } from '../ui/Feedback';
import { LoadingState } from '../ui/LoadingState';
import { CO_INPUT, COFailure, COPagination, quantityText, useCOActor, useCORead } from './COShared';
import './COStockTable.css';

export default function COStockTable({ result, filters, onFiltersChange, onOpenMovement }: {
    result: COStockPageV2; filters: StockFilters; onFiltersChange: (next: StockFilters) => void;
    onOpenMovement: (customerId: string, stockKeyId: string, trigger?: HTMLElement) => void;
}) {
    const [showValue, setShowValue] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const selected = !!filters.customerId;
    const sort = (key: StockFilters['sort']) => onFiltersChange({ ...filters, sort: key, direction: filters.sort === key && filters.direction === 'asc' ? 'desc' : 'asc', page: 1 });
    const heading = (label: string, key: StockFilters['sort'], className = '') => <th scope="col" className={className} aria-sort={filters.sort === key ? filters.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><Button variant="quiet" size="compact" aria-label={`Urutkan ${label}`} onClick={() => sort(key)}>{label}<span aria-hidden="true"> {filters.sort === key ? filters.direction === 'asc' ? '↑' : '↓' : '↕'}</span></Button></th>;
    const stores = [...new Map(result.rows.map(row => [row.customer_id, row])).values()];
    return <div className="co-stock-results">
        <div className="co-stock-toolbar"><span>{quantityText(result.total)} baris toko/SKU</span><label><input type="checkbox" checked={showValue} onChange={e => setShowValue(e.target.checked)}/> Tampilkan nilai CO</label></div>
        {!selected && stores.length > 0 && <details className="co-stock-store-coverage"><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Cakupan laporan toko pada halaman ini</summary><ul>{stores.map(row => <li key={row.customer_id}>{row.customer_name}: {row.last_report_month ? `laporan ${row.last_report_month.slice(0,7)}, cakupan ${row.coverage_through_date}` : 'Belum ada laporan'} · {row.reporting_freshness.pending_report_month_count} periode belum lengkap · <ActionLink variant="quiet" size="compact" to={`/athel/co/reports?customer=${row.customer_id}`}>Catat penjualan {row.customer_name}</ActionLink></li>)}</ul></details>}
        {showValue && <p className="text-sm text-brand-secondary">Nilai stok tercatat · IDR · sisa batch × harga satuan CO tersimpan; bukan harga satuan laporan, biaya, piutang, atau pendapatan. Tidak tersedia berarti belum dapat ditetapkan.</p>}
        <div role="region" aria-label="Daftar stok pelanggan" tabIndex={0} className="co-stock-scroll overflow-x-auto">
            <table aria-label="Stok pelanggan tercatat" className={`co-stock-table ${selected ? 'co-stock-table--selected' : ''}`}>
                <thead><tr>{!selected && heading('Toko','customer','co-stock-identifier co-stock-store')}{heading('SKU','sku','co-stock-identifier co-stock-sku')}<th scope="col" className="co-stock-name">Nama</th><th scope="col">Satuan</th>{['Awal','Dikirim','Terjual','Retur'].map(label => <th scope="col" key={label} className="co-stock-number">{label}</th>)}{heading('Sisa tercatat','balance','co-stock-number')}{showValue && <><th scope="col" className="co-stock-number">Harga satuan CO</th><th scope="col" className="co-stock-number">Nilai stok tercatat</th></>}<th scope="col">Mutasi</th></tr></thead>
                <tbody>{result.rows.map(row => {
                    const identity = `${row.customer_id}:${row.stock_key_id}`;
                    return <StockRow key={identity} row={row} selected={selected} showValue={showValue} expanded={expanded === identity} onExpand={() => setExpanded(expanded === identity ? null : identity)} asOf={result.coverage_date} onOpenMovement={onOpenMovement}/>;
                })}</tbody>
            </table>
        </div>
        {result.total === '0' && <EmptyState title="Tidak ada kunci stok sesuai filter.">Saldo historis awal tidak diasumsikan.</EmptyState>}
        <div className="co-stock-toolbar"><label>Baris per halaman <select aria-label="Baris per halaman" className={CO_INPUT} value={filters.pageSize} onChange={e => onFiltersChange({...filters,pageSize:Number(e.target.value) as StockFilters['pageSize'],page:1})}>{[25,50,100].map(size => <option key={size} value={size}>{size}</option>)}</select></label></div>
        <COPagination page={filters.page} total={result.total} pageSize={filters.pageSize} pending={false} onPage={page => onFiltersChange({...filters,page})}/>
    </div>;
}
function StockRow({ row, selected, showValue, expanded, onExpand, asOf, onOpenMovement }: {row:COStockRowV2; selected:boolean; showValue:boolean; expanded:boolean; onExpand:()=>void; asOf:string; onOpenMovement:(customerId:string,stockKeyId:string,trigger?:HTMLElement)=>void}) {
    const unitLabel = row.unit ?? (row.unit_basis === 'declared_after_cutoff' ? 'Satuan belum tersedia pada tanggal acuan' : 'Belum tersedia');
    const provenance = row.unit_basis === 'declared_after_cutoff' && row.unit_declaration ? `Dikonfirmasi kemudian: ${row.unit_declaration.unit} · ${formatAuditTimestamp(row.unit_declaration.declared_at,'WIB')}. Bukan bukti satuan laporan historis.` : undefined;
    return <><tr>
        {!selected && <th scope="row" className="co-stock-identifier co-stock-store" title={row.customer_name}>{row.customer_name}</th>}
        <th scope="row" className="co-stock-identifier co-stock-sku">{row.display_sku}</th>
        <td className="co-stock-name" title={`${row.product_name}${!row.has_delivery_history ? ' · Belum dikirim; nol tercatat tidak membuktikan saldo fisik awal.' : ''}`}>{row.product_name}{!row.has_delivery_history && <span className="co-stock-undelivered"> · Belum dikirim</span>}</td>
        <td title={provenance}>{unitLabel}</td>
        {[row.opening_quantity,row.delivered_quantity,row.sold_quantity,row.returned_quantity,row.recorded_quantity].map((value,index) => <td key={index} className="co-stock-number">{quantityText(value)}</td>)}
        {showValue && <><td className="co-stock-number">{row.price_state === 'mixed' ? <Button variant="quiet" size="compact" className="co-stock-link" aria-expanded={expanded} onClick={onExpand} aria-label={`Harga Beragam ${row.customer_name} · ${row.display_sku}`}>Beragam</Button> : row.contract_unit_price === null ? 'Belum tersedia' : `Rp ${formatMoney(row.contract_unit_price,'full')}`}</td><td className="co-stock-number">{row.contract_stock_value === null ? 'Belum tersedia' : `Rp ${formatMoney(row.contract_stock_value,'full')}`}</td></>}
        <td><Button variant="quiet" size="compact" className="co-stock-link" aria-label={`Lihat mutasi ${row.customer_name} · ${row.display_sku}`} onClick={event => onOpenMovement(row.customer_id,row.stock_key_id,event.currentTarget)}>Lihat mutasi</Button></td>
    </tr>{showValue && expanded && <tr className="co-stock-detail"><td colSpan={(selected ? 9 : 10) + 2}><StockBatches key={`${row.customer_version}:${row.generation_id}:${asOf}`} row={row} asOf={asOf}/></td></tr>}</>;
}
function StockBatches({row,asOf}:{row:COStockRowV2;asOf:string}) {
    const actor=useCOActor(`stock-batches:${row.customer_id}:${row.stock_key_id}:${row.customer_version}:${row.generation_id}:${asOf}`);
    const [page,setPage]=useState(1);
    const args={p_customer_id:row.customer_id,p_stock_key_id:row.stock_key_id,p_expected_customer_version:row.customer_version,p_expected_generation_id:row.generation_id!,p_as_of:asOf,p_page:page,p_page_size:25};
    const read=useCORead(actor,'stock-price-batches',args,async options=>{
        const value=await fetchCOCustomerBatchesV2(args,options);
        assertCOBatchParent(value,row,asOf);
        return value;
    });
    if(read.isError) return <COFailure error={read.error} retry={()=>void read.refetch()}/>;
    if(!read.data || read.isFetching) return <LoadingState title="Memuat batch CO…" shape="list"/>;
    return <div><p>Rincian per tanggal acuan (UTC), berdasarkan riwayat efektif yang dinyatakan ulang</p><p>Tanggal acuan: {asOf}. Cakupan efektif saat ini; bukan rekaman pengetahuan atau kesegaran laporan saat itu.</p><h3>Batch tersisa · harga satuan CO tersimpan (IDR)</h3><ul>{read.data.rows.map(batch=><li key={batch.id}>{batch.co_number} · SJ {batch.sj_number ?? 'Belum tersedia'} · {batch.available_quantity} {row.unit ?? 'satuan belum tersedia'} × Rp {formatMoney(batch.unit_price,'full')} · <ActionLink variant="quiet" size="compact" to={`/athel/co/${batch.co_id}`}>Lihat CO sumber</ActionLink></li>)}</ul><COPagination page={page} total={read.data.total} pageSize={25} pending={read.isFetching} onPage={setPage}/><Button variant="quiet" size="compact" onClick={()=>void read.refetch()}>Muat ulang batch</Button></div>;
}
