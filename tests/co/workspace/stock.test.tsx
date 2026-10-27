import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
afterEach(()=>vi.restoreAllMocks());
import { stockFixture, mountApp, wire, id, customer } from '../stock-ui-harness';
import * as catalog from '../../../src/lib/co/catalog';
import COCustomerStock from '../../../src/pages/athel/co/COCustomerStock';

// Transport fixture exercises the real v2 request and decoder, not a component mock.
function fixture(count = 100) {
    const s = stockFixture(count), original = s.handle;
    s.failStock = null;
    wire.handler = async (name: string, a: any) => {
        if (name === 'pilot_co_customer_batches_v2') {
            if(s.batchFailure)return s.batchFailure;
            const rows=(s.detailRowsForCutoff?.(a.p_as_of)??s.detailRows??[]).map((b:any)=>({id:b.id,co_id:b.co_id,co_number:b.co_number,delivery_head_id:b.delivery_head_id,delivery_revision_id:b.delivery_revision_id,sj_number:b.sj_number,sj_date:b.sj_date,available_quantity:b.available_quantity,unit_price:b.unit_price,contract_value:b.contract_value}));
            const data={version:'2',as_of:'2026-10-09T00:00:00Z',customer_id:a.p_customer_id,stock_key_id:a.p_stock_key_id,customer_version:s.cv,generation_id:s.generation,stock_as_of:a.p_as_of,coverage_date:a.p_as_of,page:a.p_page,page_size:a.p_page_size,total:String(rows.length),recorded_quantity:s.detailQuantityForCutoff?.(a.p_as_of)??s.detailQuantity??'9',contract_stock_value:s.detailValueForCutoff?.(a.p_as_of)??s.detailValue??'1400',contract_currency:'IDR',rows:rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size)};
            return {data:s.detailTransform?s.detailTransform(data):data,error:null};
        }
        if (name !== 'pilot_co_customer_stock_v2') return original(name, a);
        if (s.failStock) return s.failStock;
        const cutoff = a.p_as_of ?? '2026-10-09';
        const f = { ...s.stockRows()[0]?.reporting_freshness, cutoff_date: cutoff, ...(cutoff === '2026-09-30' ? {pending_report_month_count:'1',days_since_pending_month_end:'0'} : {}) };
        const all = s.stockRows().map((r: any, i: number) => ({ ...r, customer_name: r.customer_id === customer ? 'Store A' : 'Store B', stock_key_id: r.id,
            product_name: i === 0 ? 'Nama barang sangat panjang untuk pengujian kepadatan tanpa paragraf berulang' : r.product_name,
            unit: i % 3 === 0 ? null : i % 3 === 1 ? 'PCS' : 'BOX', unit_basis: i % 3 === 0 ? 'unknown' : 'declared_by_cutoff',
            unit_declaration: i % 3 === 0 ? null : { id: id(20000 + i), version: '1', unit: i % 3 === 1 ? 'PCS' : 'BOX', declared_at: '2026-08-01T00:00:00Z' },
            last_report_month: null, coverage_through_date: null, reporting_freshness: f,
            contract_stock_value: i % 3 === 0 ? null : String(BigInt(r.recorded_quantity) * 10000n), contract_currency: i % 3 === 0 ? null : 'IDR',
            contract_unit_price: i % 3 === 0 ? null : '10000', price_state: i % 3 === 0 ? 'unknown' : 'single', valuation_basis: i % 3 === 0 ? null : 'retained_co_batch',
        }));
        const enriched = s.transform ? all.map((r:any,i:number)=>s.transform(r,i,a)) : all;
        const rows = enriched.filter((r: any) => (!a.p_customer_id || r.customer_id === a.p_customer_id) && (!a.p_sku || r.normalized_sku === a.p_sku.toLowerCase()) && (!a.p_search || `${r.display_sku} ${r.product_name}`.toLowerCase().includes(a.p_search.toLowerCase())));
        rows.sort((x: any, y: any) => { const key = a.p_sort === 'customer' ? 'customer_name' : a.p_sort === 'balance' ? 'recorded_quantity' : 'normalized_sku'; const v = key === 'recorded_quantity' ? (BigInt(x[key]) < BigInt(y[key]) ? -1 : BigInt(x[key]) > BigInt(y[key]) ? 1 : 0) : x[key] < y[key] ? -1 : x[key] > y[key] ? 1 : 0; return v * (a.p_direction === 'asc' ? 1 : -1) || x.customer_id.localeCompare(y.customer_id) || x.id.localeCompare(y.id); });
        return { error: null, data: { version: '2', as_of: '2026-10-09T00:00:00Z', customer_id: a.p_customer_id, customer_version: a.p_customer_id ? s.cv : null, generation_id: a.p_customer_id ? s.generation : null,
            sku: a.p_sku?.toLowerCase() ?? null, normalized_search: a.p_search.trim().toLowerCase(), stock_as_of: a.p_as_of, period_start: cutoff.slice(0,7) + '-01', coverage_date: cutoff,
            sort: a.p_sort, direction: a.p_direction, page: a.p_page, page_size: a.p_page_size, total: String(rows.length), rows: rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size), reporting_freshness: a.p_customer_id ? f : null } };
    };
    return s;
}
const table = () => screen.findByRole('table', { name: 'Stok pelanggan tercatat' });
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const latest = () => wire.rpc.mock.calls.filter(([n]) => n === 'pilot_co_customer_stock_v2').at(-1)?.[1];

test('100 mixed-unit SKUs use compact semantic columns and authoritative 25/50/100 pagination, no scalar sum', async () => {
    fixture(); mountApp(<COCustomerStock/>, '/athel/co/stock');
    const t = await table(); expect(t.querySelectorAll('tbody tr')).toHaveLength(25);
    for (const label of ['Toko','SKU','Nama','Satuan','Awal','Dikirim','Terjual','Retur','Sisa tercatat']) expect(within(t).getByRole('columnheader', { name: new RegExp(label) })).toBeTruthy();
    expect(screen.queryByText(/Total seluruh hasil filter/)).toBeNull();
    expect(screen.getByText(/Pergerakan periode/)).toBeTruthy(); expect(screen.getByText(/Saldo tercatat per/)).toBeTruthy();
    expect(within(t).getAllByText('Belum tersedia').length).toBeGreaterThan(0);
    expect(screen.getByText('Halaman 1 dari 4')).toBeTruthy();
    change('Baris per halaman', '100'); await waitFor(() => expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(100));
    expect(latest()).toMatchObject({ p_page_size: 100, p_page: 1 });
});
test('exact SKU and toko are independent and combined; customer changes preserve SKU and reset page', async () => {
    fixture(); const { router } = mountApp(<COCustomerStock/>, '/athel/co/stock?page=3'); await table();
    change('SKU tepat', 'SKU-2'); await waitFor(() => expect(latest()).toMatchObject({p_sku:'SKU-2',p_customer_id:null,p_page:1}));
    change('Pelanggan stok', customer); await waitFor(() => expect(latest()).toMatchObject({p_sku:'SKU-2',p_customer_id:customer}));
    expect(router.state.location.search).toContain('sku=SKU-2'); expect(within(await table()).queryByRole('columnheader',{name:'Toko'})).toBeNull();
    change('Pelanggan stok',''); await waitFor(() => expect(latest()).toMatchObject({p_sku:'SKU-2',p_customer_id:null}));
    change('SKU tepat',''); await waitFor(() => expect(latest()).toMatchObject({p_sku:null,p_customer_id:null}));
});
test('Back/Forward restores month, sort, direction, page, pageSize and filters from URL', async () => {
    fixture(); const { router } = mountApp(<COCustomerStock/>, '/athel/co/stock?month=2026-09&sort=balance&direction=desc&page=2&pageSize=25'); await table();
    expect(latest()).toMatchObject({p_as_of:'2026-09-30',p_sort:'balance',p_direction:'desc',p_page:2,p_page_size:25});
    change('Cari SKU stok','SKU-2'); await waitFor(() => expect(latest()).toMatchObject({p_search:'SKU-2',p_page:1}));
    await act(async () => { await router.navigate(-1); }); await waitFor(() => expect(latest()).toMatchObject({p_search:'',p_page:2,p_sort:'balance'}));
    await act(async () => { await router.navigate(1); }); await waitFor(() => expect(latest()).toMatchObject({p_search:'SKU-2',p_page:1}));
});
test('all-store same SKU identifies toko; movement UUID is separate from exact SKU and preserves filters', async () => {
    const s = fixture(1), rows = s.stockRows(); rows.push({...rows[0],id:id(999),customer_id:id(99)}); s.stockRows=()=>rows;
    const { router } = mountApp(<COCustomerStock/>, '/athel/co/stock?sku=SKU-1'); const t=await table();
    expect(t.textContent).toContain('Store A'); expect(t.textContent).toContain('Store B');
    expect(wire.rpc.mock.calls.some(([n])=>n==='pilot_co_stock_movements_v1')).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Lihat mutasi Store B · SKU-1'}));
    await waitFor(()=>expect(router.state.location.search).toContain(`stockKey=${id(999)}`));
    expect(router.state.location.search).toContain('sku=SKU-1'); expect(router.state.location.search).toContain(`movementCustomer=${id(99)}`);
    await screen.findByRole('heading',{name:'Mutasi stok'});
    expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_stock_movements_v1' && a.p_stock_key_id===id(999) && a.p_customer_id===id(99))).toBe(true);
});
test('selected toko has one freshness notice, null unit/value is not zero, zero quantity remains explicit', async () => {
    const s=fixture(3), rows=s.stockRows(); Object.assign(rows[0],{opening_quantity:'0',recorded_quantity:'0',has_delivery_history:false}); s.stockRows=()=>rows;
    mountApp(<COCustomerStock/>, `/athel/co/stock?customer=${customer}`); const t=await table();
    expect(screen.getAllByText('Angka tercatat berdasarkan laporan, bukan verifikasi stok fisik saat ini.')).toHaveLength(1);
    expect(within(t).queryByText(/Laporan bulan selesai belum lengkap/)).toBeNull();
    expect(t.querySelector('tbody tr')?.textContent).toContain('Belum tersedia');
    expect(t.querySelector('tbody tr')?.textContent).toContain('0');
});
test('sort headers expose aria-sort and send server sort rather than sorting loaded rows', async () => {
    fixture(); mountApp(<COCustomerStock/>, '/athel/co/stock'); await table();
    fireEvent.click(screen.getByRole('button',{name:'Urutkan Sisa tercatat'})); await waitFor(()=>expect(latest()).toMatchObject({p_sort:'balance',p_direction:'asc',p_page:1}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Urutkan Sisa tercatat'}).closest('th')?.getAttribute('aria-sort')).toBe('ascending'));
    fireEvent.click(screen.getByRole('button',{name:'Urutkan Sisa tercatat'})); await waitFor(()=>expect(latest()).toMatchObject({p_direction:'desc'}));
});
test('loading, empty, ordinary error and denied teardown are distinct; private cached rows vanish', async () => {
    const s=fixture(1); const {client}=mountApp(<COCustomerStock/>, `/athel/co/stock?customer=${customer}`);
    expect(screen.getByText('Memuat stok…')).toBeTruthy(); await table();
    s.failStock={data:null,error:{code:'08006',message:'Stock offline'}};
    await act(async()=>{await client.invalidateQueries({predicate:q=>q.queryKey[4]==='customer-stock-v2'});});
    await screen.findByText('Stock offline'); expect(screen.queryByRole('table')).toBeNull();
    s.failStock={data:null,error:{code:'42501',message:'Stock denied'}}; fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));
    await screen.findByText('Stock denied'); expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByLabelText('Pelanggan stok')).toBeNull();
    await waitFor(()=>expect(client.getQueriesData({queryKey:['co']}).filter(([,d])=>d!==undefined)).toEqual([]));
});
test('no-match empty state never invents historical keys', async()=>{fixture();mountApp(<COCustomerStock/>, '/athel/co/stock?sku=NO-MATCH');await screen.findByRole('heading',{name:'Tidak ada kunci stok sesuai filter.'});expect(screen.queryByRole('button',{name:/Lihat mutasi/})).toBeNull();});


function mixedFixture(historical=false){
    const s=fixture(2),stockRows=s.stockRows();s.stockRows=()=>stockRows;
    s.transform=(r:any,i:number)=>i===1?{...r,opening_quantity:'9',recorded_quantity:'9',price_state:'mixed',contract_unit_price:null,contract_stock_value:'1400'}:historical?{...r,unit_declaration:{id:id(990),version:'1',unit:'BOX',declared_at:'2026-10-01T00:00:00Z'},unit_basis:'declared_after_cutoff'}:r;
    s.detailRows=[{...s.batches[1],id:id(991),available_quantity:'4',unit_price:'100',contract_value:'400',sj_number:'RETAINED-SJ-100'},{...s.batches[1],id:id(992),available_quantity:'5',unit_price:'200',contract_value:'1000',sj_number:'RETAINED-SJ-200'}];return s;
}
async function openMixed(){fireEvent.click(screen.getByLabelText('Tampilkan nilai CO'));fireEvent.click(screen.getByRole('button',{name:'Harga Beragam Store A · SKU-2'}));}
test.each([false,true])('mixed prices show the same pinned restated composition as parent, historical=%s',async historical=>{
    mixedFixture(historical);mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}${historical?'&month=2026-09':''}`);await table();
    expect(wire.rpc.mock.calls.some(([n])=>n==='pilot_co_customer_batches_v2')).toBe(false);await openMixed();
    await screen.findByRole('heading',{name:'Batch tersisa · harga satuan CO tersimpan (IDR)'});
    expect(screen.getByText('Rincian per tanggal acuan (UTC), berdasarkan riwayat efektif yang dinyatakan ulang')).toBeTruthy();
    expect(screen.getAllByRole('link',{name:'Lihat CO sumber'})).toHaveLength(2);expect(screen.getByText(/RETAINED-SJ-100/)).toBeTruthy();
    const calls=wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_customer_batches_v2');expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({p_customer_id:customer,p_stock_key_id:id(1002),p_as_of:historical?'2026-09-30':'2026-10-09',p_expected_customer_version:'1',p_expected_generation_id:id(8000),p_page:1,p_page_size:25});
    expect(wire.rpc.mock.calls.some(([n])=>n==='pilot_co_customer_batches_v1')).toBe(false);
    if(historical){const unavailable=within(await table()).getByText('Satuan belum tersedia pada tanggal acuan');expect(unavailable.title).toContain('Dikonfirmasi kemudian: BOX');expect(unavailable.title).toContain('07.00.00 WIB');}
});
test.each(['customer_id','stock_key_id','customer_version','generation_id','stock_as_of','coverage_date','recorded_quantity','contract_stock_value','page'])('table refuses mismatched %s before displaying any batch',async key=>{
    const s=mixedFixture(true);s.detailTransform=(p:any)=>({...p,[key]:key==='page'?2:key==='recorded_quantity'?'10':key==='contract_stock_value'?'1400.01':key.endsWith('_id')?id(999):key==='customer_version'?'2':'2026-10-09'});
    mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&month=2026-09`);await table();await openMixed();await screen.findByRole('alert');expect(screen.queryByRole('link',{name:'Lihat CO sumber'})).toBeNull();expect(screen.getByRole('button',{name:'Muat ulang stok'})).toBeTruthy();
});
test('historical first batch survives despite being exhausted in current composition, no current substitution',async()=>{
    const s=mixedFixture(true);s.batches=[{...s.batches[1],id:id(992),available_quantity:'5',unit_price:'200'}];
    mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&month=2026-09&sku=SKU-2`);await table();await openMixed();await screen.findByText(/RETAINED-SJ-100/);
    expect(screen.getByText(/RETAINED-SJ-200/)).toBeTruthy();expect(screen.getByText('Rp 1.400')).toBeTruthy();
    expect(wire.rpc.mock.calls.some(([n])=>n==='pilot_co_customer_batches_v1')).toBe(false);
});
test('missing retained SJ labels are explicitly unavailable and do not use current SJ',async()=>{
    const s=mixedFixture();Object.assign(s.detailRows[1],{delivery_revision_id:null,sj_number:null,sj_date:null});
    mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}`);await table();await openMixed();await screen.findByText(/SJ Belum tersedia/);expect(screen.getAllByRole('link',{name:'Lihat CO sumber'})).toHaveLength(2);
});
test('detail uses full prepage totals across price pages and rejects a stale second-page generation',async()=>{
    const s=mixedFixture();s.detailRows=Array.from({length:26},(_,i)=>({...s.detailRows[i%2],id:id(30000+i),available_quantity:'1',unit_price:i%2?'200':'100',contract_value:i%2?'200':'100'}));s.detailQuantity='26';s.detailValue='3900';
    s.transform=(r:any,i:number)=>i===1?{...r,opening_quantity:'26',recorded_quantity:'26',price_state:'mixed',contract_unit_price:null,contract_stock_value:'3900'}:r;
    mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}`);await table();await openMixed();await screen.findByText('Halaman 1 dari 2');expect(screen.getAllByRole('link',{name:'Lihat CO sumber'})).toHaveLength(25);
    s.detailTransform=(p:any)=>({...p,generation_id:id(999)});const detail=screen.getByRole('heading',{name:'Batch tersisa · harga satuan CO tersimpan (IDR)'}).parentElement!;fireEvent.click(within(detail).getByRole('button',{name:'Berikutnya'}));await screen.findByRole('alert');expect(screen.queryByRole('link',{name:'Lihat CO sumber'})).toBeNull();
});
test('detail authority denial tears down private stock rather than keeping expanded cached labels',async()=>{
    const s=mixedFixture();s.batchFailure={data:null,error:{code:'42501',message:'Batch denied'}};mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}`);await table();await openMixed();await screen.findByText('Batch denied');expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByLabelText('Pelanggan stok')).toBeNull();
});

test('a directory response remains usable when independent stock filters change while it loads',async()=>{
    fixture(); let resolve!:(value:any)=>void;
    vi.spyOn(catalog,'fetchCOCustomers').mockImplementation(options=>new Promise<any>(yes=>{resolve=yes}).then(rows=>{if(options?.isCurrent&&!options.isCurrent())throw new Error('catalog identity');return rows}));
    mountApp(<COCustomerStock/>, '/athel/co/stock');await table();
    change('Cari SKU stok','SKU-2');
    await act(async()=>{resolve([{id:customer,name:'Store A',pricing_tier:'others'}]);});
    await waitFor(()=>expect(screen.getByRole('option',{name:'Store A'})).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
});

test('switching restated historical to current table replaces composition and cutoff without reusing an exhausted batch',async()=>{
    const s=mixedFixture(true),historical=s.detailRows,current=[historical[1],{...historical[1],id:id(993),sj_number:'NEW-CURRENT-SJ',sj_date:'2026-10-01',available_quantity:'1',unit_price:'300',contract_value:'300'}];
    s.detailRowsForCutoff=(cutoff:string)=>cutoff==='2026-09-30'?historical:current;
    s.detailQuantityForCutoff=(cutoff:string)=>cutoff==='2026-09-30'?'9':'6';s.detailValueForCutoff=(cutoff:string)=>cutoff==='2026-09-30'?'1400':'1300';
    s.transform=(r:any,i:number,a:any)=>i===1?{...r,opening_quantity:a.p_as_of?'9':'6',recorded_quantity:a.p_as_of?'9':'6',price_state:'mixed',contract_unit_price:null,contract_stock_value:a.p_as_of?'1400':'1300'}:r;
    const {router}=mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&month=2026-09&sku=SKU-2`);await table();await openMixed();await screen.findByText(/RETAINED-SJ-100/);
    fireEvent.click(screen.getByRole('button',{name:'Stok terkini'}));await waitFor(()=>expect(latest()).toMatchObject({p_as_of:null,p_sku:'SKU-2',p_customer_id:customer}));await table();await openMixed();await screen.findByText(/NEW-CURRENT-SJ/);
    expect(screen.queryByText(/RETAINED-SJ-100/)).toBeNull();expect(screen.getByText('Rp 1.300')).toBeTruthy();expect(router.state.location.search).toContain('sku=SKU-2');expect(router.state.location.search).not.toContain('month=');
    expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_customer_batches_v2').map(([,a])=>a.p_as_of)).toEqual(['2026-09-30','2026-10-09']);
});
