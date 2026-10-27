import React from 'react';
import {test,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,within,cleanup} from '@testing-library/react';
vi.mock('../../src/lib/supabase',async()=>import('./boundary'));
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {AuthProvider} from '../../src/lib/AuthContext';
import COStockReturns from '../../src/pages/athel/co/COStockReturns';
import {fixture,stockItems} from './boundary';
test.each(['success','uncertain'])('production page/modal synthetic %s without hosted calls',async(scenario)=>{
 localStorage.clear();fixture.scenario=scenario;const before=fixture.commits;const available=stockItems[0].available_quantity;
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 const router=createMemoryRouter([{path:'/',element:<COStockReturns/>}],{initialEntries:['/']});
 render(<QueryClientProvider client={client}><AuthProvider><RouterProvider router={router}/></AuthProvider></QueryClientProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Create Stock Return'}));
 const dialog=await screen.findByRole('dialog');
 fireEvent.click(await within(dialog).findByRole('button',{name:'Toko Contoh Nusantara'}));
 const unknown=await within(dialog).findByRole('button',{name:'Tambah SEMEN-003'});expect((unknown as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(within(dialog).getByRole('button',{name:'Tambah CAT-001'}));fireEvent.click(await within(dialog).findByRole('button',{name:'Tambah KUAS-002'}));
 fireEvent.change(within(dialog).getByLabelText('Qty retur CAT-001'),{target:{value:'99'}});fireEvent.change(within(dialog).getByLabelText('Qty retur KUAS-002'),{target:{value:'2'}});
 fireEvent.change(within(dialog).getByLabelText('Tanggal retur'),{target:{value:new Date().toISOString().slice(0,10)}});fireEvent.change(within(dialog).getByLabelText('Alasan retur'),{target:{value:'Synthetic validation case'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Catat retur'}));await within(dialog).findByText(`Qty retur CAT-001 harus 1 sampai ${available}.`);expect(fixture.commits).toBe(before);
 fireEvent.change(within(dialog).getByLabelText('Qty retur CAT-001'),{target:{value:'3'}});fireEvent.click(within(dialog).getByRole('button',{name:'Catat retur'}));
 if(scenario==='uncertain'){fireEvent.click(await screen.findByRole('button',{name:'Periksa hasil'}));}
 await screen.findByText('Stock return berhasil dicatat.');expect(fixture.commits).toBe(before+1);expect(fixture.calls.some(c=>c.name==='pilot_co_return_v1')).toBe(true);
 cleanup();client.clear();
});
