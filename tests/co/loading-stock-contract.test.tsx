import React from 'react';
import {act,fireEvent,screen,waitFor} from '@testing-library/react';
import {expect,test,vi} from 'vitest';
import {customer,id,mountApp,stockFixture,wire} from './stock-ui-harness';
import App from '../../src/App';
import COStockTable from '../../src/components/co/COStockTable';
import {fetchCOStockV2} from '../../src/lib/co/rpc';
import COStockHistory from '../../src/components/co/COStockHistory';
const props={customerId:customer,stockKeyId:id(1001),asOf:null,onAuthorityFailure:vi.fn(),onClose:vi.fn(),returnFocus:null,fallbackFocus:()=>null};
test('stock first pending read then transport failure never displays numeric rows or verified zero',async()=>{
 const s=stockFixture();let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string)=>{if(n==='pilot_co_customer_stock_v2'){await pending;return {data:null,error:{code:'08006',message:'Unavailable stock'}}}return null};
 mountApp(<App/>,`/athel/co/stock?customer=${customer}`);
 await screen.findByText('Memuat stok…');expect(screen.queryByRole('table',{name:'Stok pelanggan tercatat'})).toBeNull();
 await act(async()=>release());await screen.findByText('Unavailable stock');
 expect(screen.queryByText('Memuat stok…')).toBeNull();expect(document.querySelectorAll('td.co-stock-number')).toHaveLength(0);expect(s.commands).toHaveLength(0);
});
test('blocked movement owner neither reads nor displays stale movement rows',async()=>{
 stockFixture();mountApp(<COStockHistory {...props} blocked/>, '/athel/co/stock');
 await screen.findByText('Memuat riwayat stok…');expect(screen.queryByRole('table',{name:'Pergerakan stok tercatat'})).toBeNull();
 expect(wire.rpc.mock.calls.filter(([name])=>name==='pilot_co_stock_movements_v1')).toHaveLength(0);
});
test('movement refresh masks old rows and an error replaces pending rather than presenting zero',async()=>{
 const s=stockFixture();s.movements=[{id:id(50000),customer_id:customer,stock_key_id:id(1001),generation_id:s.generation,batch_id:id(2001),co_id:id(11),co_line_id:id(3001),kind:'delivery',quantity_delta:'17',effective_date:'2026-09-01',delivery_revision_line_id:id(51000),return_revision_line_id:null,report_revision_line_id:null}];const {client}=mountApp(<COStockHistory {...props}/>, '/athel/co/stock');
 await screen.findByRole('table',{name:'Pergerakan stok tercatat'});expect(screen.getByText('+17')).toBeTruthy();expect(screen.getByRole('link',{name:'Lihat CO sumber'}).getAttribute('href')).toBe(`/athel/co/${id(11)}`);
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string)=>{if(n==='pilot_co_stock_movements_v1'){await pending;return {data:null,error:{code:'08006',message:'Movement unavailable'}}}return null};
 act(()=>{void client.invalidateQueries()});await screen.findByText('Memuat riwayat stok…');
 expect(screen.queryByRole('table',{name:'Pergerakan stok tercatat'})).toBeNull();expect(screen.queryByText('+17')).toBeNull();
 await act(async()=>release());await screen.findByText('Movement unavailable');expect(screen.queryByText('+17')).toBeNull();expect(screen.queryByText('Memuat riwayat stok…')).toBeNull();expect(s.commands).toHaveLength(0);
});

test('batch-price pending and error gates never render unverified source batches',async()=>{
 const s=stockFixture();const filters={customerId:customer,sku:null,search:'',asOf:null,sort:'sku' as const,direction:'asc' as const,page:1,pageSize:25 as const};
 const result=await fetchCOStockV2(filters);result.rows[0].price_state='mixed';
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string)=>{if(n==='pilot_co_customer_batches_v2'){await pending;return {data:null,error:{code:'08006',message:'Batch prices unavailable'}}}return null};
 mountApp(<COStockTable result={result} filters={filters} onFiltersChange={()=>{}} onOpenMovement={()=>{}}/>, '/athel/co/stock');
 fireEvent.click(screen.getByLabelText('Tampilkan nilai CO'));fireEvent.click(screen.getByRole('button',{name:'Harga Beragam Store A · SKU-1'}));
 await screen.findByText('Memuat batch CO…');expect(screen.queryByText(/Batch tersisa ·/)).toBeNull();
 await act(async()=>release());await screen.findByText('Batch prices unavailable');expect(screen.queryByText('Memuat batch CO…')).toBeNull();expect(screen.queryByText(/Batch tersisa ·/)).toBeNull();expect(s.commands).toHaveLength(0);
});
