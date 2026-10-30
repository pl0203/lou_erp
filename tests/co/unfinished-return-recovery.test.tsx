import React from 'react';
import {act,fireEvent,screen,waitFor} from '@testing-library/react';
import {expect,test} from 'vitest';
import {stockFixture,mountApp,id,wire,customer} from './stock-ui-harness';
import App from '../../src/App';
const title='Pemulihan draft retur lama (semua sumber pelanggan)';
async function discover(){fireEvent.click(await screen.findByText(title));return screen.findByRole('button',{name:'Pulihkan draft retur lama'});}
function fixture(){const s=stockFixture();s.draft=s.makeDraft([{batch_id:id(2001),quantity:5}], '7');return s;}
test('existing unfinished draft is discovered read-only and explicit save retains draft ID and version',async()=>{
 const s=fixture();mountApp(<App/>,`/athel/co/${s.co.id}`);
 const open=await discover();expect(s.commands).toHaveLength(0);
 expect(screen.queryByRole('button',{name:'Retur barang belum terjual'})).toBeNull();
 fireEvent.click(open);const quantity=await screen.findByLabelText('Jumlah retur SJ-1 Item 1');
 expect((quantity as HTMLInputElement).value).toBe('5');expect(s.commands).toHaveLength(0);
 expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_return_v1'&&a.p_target_id===id(20)&&a.p_view==='draft'&&a.p_expected_draft_version==='7'&&a.p_customer_id===customer)).toBe(true);
 fireEvent.change(screen.getByLabelText('Referensi retur'),{target:{value:'RECOVERED OLD'}});
 fireEvent.click(screen.getByRole('button',{name:'Simpan Draft retur'}));
 await waitFor(()=>expect(s.commands).toHaveLength(1));
 expect(s.commands[0]).toMatchObject({op:'save_return_draft',payload:{draft_id:id(20),expected_draft_version:'7',expected_customer_version:'1',customer_id:customer,lines:[{batch_id:id(2001),quantity:5}]}});
});
test('consumed historical draft cannot start unfinished recovery',async()=>{
 const s=fixture();s.draft.header.consumed=true;mountApp(<App/>,`/athel/co/${s.co.id}`);
 const open=await discover();expect(open.matches(':disabled')).toBe(true);fireEvent.click(open);
 expect(screen.queryByRole('dialog')).toBeNull();expect(s.commands).toHaveLength(0);
 expect(wire.rpc.mock.calls.some(([n])=>n==='pilot_co_return_v1')).toBe(false);
});
test.each(['42501','PT409'])('selected draft read %s never falls back to creating a fresh draft',async code=>{
 const s=fixture();s.fail=(n:string)=>n==='pilot_co_return_v1'?{data:null,error:{code,message:'Selected old draft unavailable'}}:null;
 mountApp(<App/>,`/athel/co/${s.co.id}`);fireEvent.click(await discover());
 if(code==='42501') await screen.findAllByText('Selected old draft unavailable');
 else await screen.findByText(/Sumber berubah\. Isian tetap disimpan/);
 expect(screen.queryByLabelText('Jumlah retur SJ-1 Item 1')).toBeNull();
 const save=screen.queryByRole('button',{name:'Simpan Draft retur'});expect(!save||save.matches(':disabled')).toBe(true);
 expect(s.commands).toHaveLength(0);
});
test.each(['signout','role'] as const)('%s authority loss removes opened old draft fields and cannot dispatch retained work',async loss=>{
 const s=fixture();const {router}=mountApp(<App/>,`/athel/co/${s.co.id}`);fireEvent.click(await discover());
 await screen.findByLabelText('Jumlah retur SJ-1 Item 1');
 fireEvent.change(screen.getByLabelText('Referensi retur'),{target:{value:'OLD PRIVATE'}});
 if(loss==='signout') wire.actor=false;else wire.role='po_admin';await act(async()=>{await router.navigate(`/athel/co/${s.co.id}?actor=changed`);});
 await waitFor(()=>expect(screen.queryByDisplayValue('OLD PRIVATE')).toBeNull());
 expect(screen.queryByRole('button',{name:'Simpan Draft retur'})).toBeNull();expect(s.commands).toHaveLength(0);
});
