import { expect, test } from 'vitest';
import { stockFixture, customer, id, wire } from './stock-ui-harness';
import { fetchCOStockV2 } from '../../src/lib/co/rpc';
import type { StockFilters } from '../../src/lib/co/contracts';
const filters: StockFilters = { customerId: customer, sku: null, search: '', asOf: null, sort: 'sku', direction: 'asc', page: 1, pageSize: 25 };
test('stock V2 strict decoder sees bounded pages with exact count and unknown valuation', async () => {
 stockFixture(26); const page = await fetchCOStockV2(filters);
 expect(page.version).toBe('2'); expect(page.total).toBe('26'); expect(page.rows).toHaveLength(25);
 expect(page.rows[0]).toMatchObject({unit:null,unit_basis:'unknown',contract_stock_value:null,price_state:'unknown'});
 const last=await fetchCOStockV2({...filters,page:2}); expect(last.total).toBe('26'); expect(last.rows).toHaveLength(1);
 const empty=await fetchCOStockV2({...filters,page:3});expect(empty.total).toBe('26');expect(empty.rows).toEqual([]);
 expect(wire.rpc.mock.calls.some(([name,args])=>name==='pilot_co_customer_stock_v2'&&args.p_page===2&&args.p_page_size===25)).toBe(true);
});
test('stock V2 binds exact SKU, search, customer and stable descending balance sort',async()=>{
 const s=stockFixture(3); s.batches[0].available_quantity='31';
 const exact=await fetchCOStockV2({...filters,sku:' SKU-2 '});expect(exact.total).toBe('1');expect(exact.rows[0].display_sku).toBe('SKU-2');
 const searched=await fetchCOStockV2({...filters,search:'item 3'});expect(searched.total).toBe('1');expect(searched.rows[0].product_name).toBe('Item 3');
 expect((await fetchCOStockV2({...filters,customerId:id(999)})).rows).toEqual([]);
 const sorted=await fetchCOStockV2({...filters,sort:'balance',direction:'desc'});expect(sorted.rows.map(r=>r.recorded_quantity)).toEqual(['31','30','30']);
});
test('stock V2 all-store and historical cutoff envelopes remain distinct',async()=>{
 stockFixture(); const all=await fetchCOStockV2({...filters,customerId:null});expect(all.customer_version).toBeNull();expect(all.reporting_freshness).toBeNull();
 const historic=await fetchCOStockV2({...filters,asOf:'2026-09-30'});expect(historic.coverage_date).toBe('2026-09-30');expect(historic.stock_as_of).toBe('2026-09-30');
 expect(historic.rows.every(r=>r.coverage_through_date===null||r.coverage_through_date<='2026-09-30')).toBe(true);
});
