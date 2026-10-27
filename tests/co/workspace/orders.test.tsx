import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { mountRoutes, state } from '../ui-harness';
import COOrders from '../../../src/pages/athel/co/COOrders';
import * as rpc from '../../../src/lib/co/rpc';
afterEach(()=>vi.restoreAllMocks());
test('orders consume authoritative distinct SKU count and URL date/number sort without per-order detail reads',async()=>{
    const list=vi.spyOn(rpc,'fetchCOPageV2').mockImplementation(async filters=>({version:'2',rows:[{...state.header,sku_count:'9007199254740993'}],total:'1',page:filters.page,page_size:filters.pageSize}));
    const details=vi.spyOn(rpc,'fetchCODetail');
    const {router}=mountRoutes([{path:'*',element:<COOrders/>}],'/athel/co?sort=co_number&direction=asc');
    await screen.findAllByText('9.007.199.254.740.993');
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({sort:'co_number',direction:'asc'}),expect.anything());
    expect(details).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Urutkan pesanan'),{target:{value:'order_date'}});
    await waitFor(()=>expect(list).toHaveBeenLastCalledWith(expect.objectContaining({sort:'order_date',direction:'asc',page:1}),expect.anything()));
    fireEvent.change(screen.getByLabelText('Arah urutan pesanan'),{target:{value:'desc'}});
    await waitFor(()=>expect(list).toHaveBeenLastCalledWith(expect.objectContaining({direction:'desc'}),expect.anything()));
    await act(async()=>{await router.navigate(-1)});
    await waitFor(()=>expect(list).toHaveBeenLastCalledWith(expect.objectContaining({sort:'order_date',direction:'asc'}),expect.anything()));
    expect(screen.queryByText('Belum tersedia')).toBeNull();
});

test('order SKU movement link keeps exact SKU text distinct from stock-key UUID',async()=>{
    const {default:CODetail}=await import('../../../src/pages/athel/co/CODetail');
    mountRoutes([{path:'/athel/co/:id',element:<CODetail/>}],`/athel/co/${state.header.id}`);
    const link=await screen.findByRole('link',{name:'Lihat mutasi SKU-1'});
    const url=new URL(link.getAttribute('href')!,'https://local.test');
    expect(url.searchParams.get('sku')).toBe('SKU-1');
    expect(url.searchParams.get('stockKey')).toBe(state.lines[0].stock_key_id);
    expect(url.searchParams.get('movementCustomer')).toBe(state.header.customer_id);
});
