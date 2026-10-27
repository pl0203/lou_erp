import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { mount, state, ids } from '../ui-harness';
import CODetail from '../../../src/pages/athel/co/CODetail';

test('detail puts exact order total with items and exposes occasional actions only on demand', async () => {
 mount(<CODetail/>,`/athel/co/${ids.co}`); await screen.findByText('CO-A');
 const actions=screen.getByRole('button',{name:'Actions'});
 expect(actions.getAttribute('aria-expanded')).toBe('false');
 expect(screen.queryByRole('button',{name:'Batalkan CO'})).toBeNull();
 fireEvent.click(actions);
 expect(actions.getAttribute('aria-expanded')).toBe('true');
 expect(screen.getByRole('button',{name:'Batalkan CO'})).toBeTruthy();
 fireEvent.keyDown(screen.getByRole('button',{name:'Batalkan CO'}),{key:'Escape'});
 expect(actions.getAttribute('aria-expanded')).toBe('false');
 expect(document.activeElement).toBe(actions);
 const section=await screen.findByRole('region',{name:'Barang pesanan'});
 expect(within(section).getByText(/Nilai CO:/).textContent).toContain('20');
 expect(screen.queryByText(/Nilai CO = jumlah dipesan/)).toBeNull();
});
test('detail action popup dismisses outside and keeps disabled command reasons',async()=>{
 state.header.allowed_operations=[];state.header.close_blockers={stock_remains:true,undelivered_remains:true,missing_month_count:'2'};
 mount(<CODetail/>,`/athel/co/${ids.co}`);await screen.findByText('CO-A');
 const actions=screen.getByRole('button',{name:'Actions'});fireEvent.click(actions);
 expect((screen.getByRole('button',{name:'Tutup CO'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText(/2 laporan bulan belum lengkap/)).toBeTruthy();
 fireEvent.pointerDown(document.body);
 expect(actions.getAttribute('aria-expanded')).toBe('false');
});

test('action dialog returns focus to durable trigger and tabbing outside dismisses the popup', async () => {
 mount(<CODetail/>,`/athel/co/${ids.co}`); await screen.findByText('CO-A');
 const actions=screen.getByRole('button',{name:'Actions'});
 fireEvent.click(actions);
 fireEvent.click(screen.getByRole('button',{name:'Batalkan CO'}));
 const dialog=await screen.findByRole('dialog',{name:'Batalkan CO?'});
 expect(actions.getAttribute('aria-expanded')).toBe('false');
 fireEvent.click(within(dialog).getByRole('button',{name:'Batal'}));
 expect(document.activeElement).toBe(actions);
 fireEvent.click(actions);
 fireEvent.blur(screen.getByRole('group',{name:'Actions CO'}),{relatedTarget:screen.getByRole('link',{name:'Lihat stok toko'})});
 expect(actions.getAttribute('aria-expanded')).toBe('false');
 expect(state.commands).toHaveLength(0);
});
