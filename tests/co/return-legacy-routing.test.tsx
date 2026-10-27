import React from 'react';
import {test,expect} from 'vitest';
import {screen,fireEvent,waitFor} from '@testing-library/react';
import {customer,id,mountApp,stockFixture} from './stock-ui-harness';
import App from '../../src/App';
import {createCOTransactionSender} from '../../src/lib/co/transactions';
import {CO_BACKEND} from '../../src/lib/co/queryKeys';
test('legacy lost save response has recovery-only stock entry and does not post a second return',async()=>{
 const s=stockFixture();let attempted=false;s.fail=async(n:string,a:any)=>{if(n!=='pilot_co_transaction_v1'||attempted)return null;attempted=true;await s.handle(n,a);return{data:null,error:{code:'08006',message:'Lost legacy response'}};};
 const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:'return',customerId:customer,storage:()=>localStorage,retainCommitted:true});
 await expect(sender('save_return_draft',{customer_id:customer,expected_customer_version:s.cv,return_date:'2026-10-09',reference:'OLD-RETURN',reason:'Unsold',notes:null,lines:[{batch_id:s.batches[0].id,quantity:5}]})).rejects.toThrow('Lost legacy response');
 const key=`co-request:${encodeURIComponent(CO_BACKEND)}:${id(1)}:${customer}:return`;expect(localStorage.getItem(key)).not.toBeNull();
 mountApp(<App/>,`/athel/co/stock?customer=${customer}`);fireEvent.click(await screen.findByRole('button',{name:'Pulihkan retur sebelumnya'}));
 expect(await screen.findByRole('heading',{name:'Pulihkan retur sebelumnya'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Simpan Draft retur'})).toBeNull();
 fireEvent.click(await screen.findByRole('button',{name:'Pulihkan hasil penyimpanan'}));fireEvent.click(await screen.findByRole('button',{name:'Lihat hasil tersimpan'}));
 await waitFor(()=>expect(localStorage.getItem(key)).toBeNull());expect(s.commands).toHaveLength(1);expect(s.batches[0].available_quantity).toBe('30');expect(screen.queryByRole('button',{name:'Simpan Draft retur'})).toBeNull();
});
test('new workspace recovers a lost legacy post after it depleted stock, without a new return command',async()=>{
 const s=stockFixture(1);s.draft=s.makeDraft([{batch_id:s.batches[0].id,quantity:30}]);let attempted=false;
 s.fail=async(n:string,a:any)=>{if(n==='pilot_co_returns_page_v1')return{data:{version:'1',as_of:new Date().toISOString(),page:a.p_page,page_size:a.p_page_size,total:'0',rows:[],customer_id:a.p_customer_id,date_from:a.p_date_from,date_to:a.p_date_to},error:null};if(n!=='pilot_co_transaction_v1'||attempted)return null;attempted=true;await s.handle(n,a);return{data:null,error:{code:'08006',message:'Lost posted response'}};};
 const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:'return',customerId:customer,storage:()=>localStorage,retainCommitted:true});
 await expect(sender('post_return',{customer_id:customer,expected_customer_version:s.cv,draft_id:id(20),expected_draft_version:'1',preview_fingerprint:'a'.repeat(64)})).rejects.toThrow('Lost posted response');expect(s.batches[0].available_quantity).toBe('0');
 const key=`co-request:${encodeURIComponent(CO_BACKEND)}:${id(1)}:${customer}:return`;
 mountApp(<App/>,'/athel/co/returns');fireEvent.click(await screen.findByRole('button',{name:'Pulihkan retur sebelumnya'}));
 fireEvent.click(await screen.findByRole('button',{name:'Pulihkan hasil penyimpanan'}));fireEvent.click(await screen.findByRole('button',{name:'Lihat hasil tersimpan'}));
 await waitFor(()=>expect(localStorage.getItem(key)).toBeNull());expect(s.commands).toHaveLength(1);expect(s.history).toHaveLength(1);expect(s.batches[0].available_quantity).toBe('0');expect(screen.queryByRole('button',{name:'Simpan Draft retur'})).toBeNull();
});
