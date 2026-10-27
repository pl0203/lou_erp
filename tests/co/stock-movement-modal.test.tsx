import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { stockFixture, mountApp, wire, id, customer } from './stock-ui-harness';
import COCustomerStock from '../../src/pages/athel/co/COCustomerStock';
function setup() {
 const s=stockFixture(2);
 s.movements=[{id:id(91),customer_id:customer,stock_key_id:id(1001),generation_id:s.generation,co_line_id:id(3001),effective_date:'2026-09-30',kind:'sold',quantity_delta:'-7',co_id:id(11),batch_id:id(2001),delivery_revision_line_id:null,return_revision_line_id:null,report_revision_line_id:id(92)}];
 return s;
}
test('movement opens accessible modal with readable identity and table, never raw UUID text',async()=>{
 setup(); const {router}=mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&sku=SKU-1`);
 const trigger=await screen.findByRole('button',{name:'Lihat mutasi Store A · SKU-1'}); fireEvent.click(trigger);
 const modal=await screen.findByRole('dialog',{name:'Mutasi stok'});
 const table=await within(modal).findByRole('table',{name:'Pergerakan stok tercatat'});
 expect(modal.textContent).toContain('Store A');expect(modal.textContent).toContain('SKU-1');expect(modal.textContent).toContain('Item 1');
 for(const label of ['Tanggal (UTC)','Aktivitas','Perubahan','Sumber'])expect(within(table).getByRole('columnheader',{name:label})).toBeTruthy();
 expect(within(table).getByText('-7')).toBeTruthy();expect(within(table).getByText('Penjualan')).toBeTruthy();
 expect(within(table).getByRole('link',{name:'Lihat CO sumber'}).getAttribute('href')).toBe(`/athel/co/${id(11)}`);
 expect(modal.textContent).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-/i);
 fireEvent.keyDown(modal,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(router.state.location.search).toContain('sku=SKU-1');expect(router.state.location.search).not.toContain('stockKey');
 expect(document.activeElement).toBe(trigger);
});
test('movement modal loading is dismissible and a late response cannot reopen it',async()=>{
 setup();const original=wire.handler;let release!:()=>void;
 wire.handler=async(n,a)=>{if(n==='pilot_co_stock_movements_v1')await new Promise<void>(r=>release=r);return original(n,a)};
 const {router}=mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}`);
 fireEvent.click(await screen.findByRole('button',{name:'Lihat mutasi Store A · SKU-1'}));
 const modal=await screen.findByRole('dialog',{name:'Mutasi stok'});await within(modal).findByText('Memuat riwayat stok…');
 fireEvent.click(within(modal).getByRole('button',{name:'Tutup'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await act(async()=>release());expect(screen.queryByRole('dialog')).toBeNull();expect(router.state.location.search).not.toContain('stockKey');
});

test('movement signs and labels follow ledger deltas without changing source values',async()=>{
 const s=setup(), original=s.movements[0];
 s.movements=[{...original,id:id(93),kind:'delivery',quantity_delta:'12',delivery_revision_line_id:id(94),report_revision_line_id:null},{...original,id:id(95),kind:'return',quantity_delta:'-2',return_revision_line_id:id(96),report_revision_line_id:null},original];
 mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}&stockKey=${id(1001)}&movementCustomer=${customer}`);
 const modal=await screen.findByRole('dialog',{name:'Mutasi stok'});const t=await within(modal).findByRole('table',{name:'Pergerakan stok tercatat'});
 expect(within(t).getByText('+12')).toBeTruthy();expect(within(t).getByText('-2')).toBeTruthy();expect(within(t).getByText('-7')).toBeTruthy();
 expect(within(t).getByText('Pengiriman')).toBeTruthy();expect(within(t).getByText('Retur')).toBeTruthy();
 expect(s.commands).toEqual([]);
 const close=within(modal).getByRole('button',{name:'Tutup'});close.focus();fireEvent.keyDown(close,{key:'Tab',shiftKey:true});
 expect(modal.contains(document.activeElement)).toBe(true);
});

test('parent stock refresh retains dialog and focus, hides stale rows and preserves generation pin',async()=>{
 const s=setup();const {client}=mountApp(<COCustomerStock/>,`/athel/co/stock?customer=${customer}`);
 fireEvent.click(await screen.findByRole('button',{name:'Lihat mutasi Store A · SKU-1'}));
 const modal=await screen.findByRole('dialog',{name:'Mutasi stok'});
 await within(modal).findByRole('table',{name:'Pergerakan stok tercatat'});
 const close=within(modal).getByRole('button',{name:'Tutup'});close.focus();
 const original=wire.handler;let release!:()=>void;
 wire.handler=async(n,a)=>{if(n==='pilot_co_customer_stock_v2')await new Promise<void>(r=>release=r);return original(n,a)};
 let refreshing!:Promise<unknown>;
 await act(async()=>{refreshing=client.invalidateQueries({predicate:q=>q.queryKey[4]==='customer-stock-v2'});});
 await waitFor(()=>expect(within(modal).queryByRole('table')).toBeNull());
 expect(screen.getByRole('dialog',{name:'Mutasi stok'})).toBe(modal);expect(document.activeElement).toBe(close);
 s.generation=id(8001);s.movements=s.movements.map((row:any)=>({...row,generation_id:s.generation}));
 await act(async()=>{release();await refreshing;});
 await within(modal).findByText('Riwayat berubah di antara halaman. Muat ulang seluruh riwayat.');
 expect(screen.getByRole('dialog',{name:'Mutasi stok'})).toBe(modal);expect(within(modal).queryByRole('table')).toBeNull();
 fireEvent.click(within(modal).getByRole('button',{name:'Coba lagi'}));
 await within(modal).findByRole('table',{name:'Pergerakan stok tercatat'});
});
