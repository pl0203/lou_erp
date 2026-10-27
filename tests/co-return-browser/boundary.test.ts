import {test,expect,vi} from 'vitest';
vi.mock('../../src/lib/supabase',()=>({supabase:{}}));
import {fixtureRPC,fixture,id,customer,stockItems,generation} from './boundary';
import {decodeReturnCustomers,decodeReturnItems,decodeReturnPage,decodeReturnCreate} from '../../src/lib/co/returnWorkspace';
import {decodeCORead} from '../../src/lib/co/validation';
import {verifyReturnReadback} from '../../src/lib/co/returnForm';
test('fixture envelopes decode through real production contracts and canonical readback',async()=>{
 const ca={p_search:'',p_page:1,p_page_size:10};expect(decodeReturnCustomers((await fixtureRPC('pilot_co_return_customers_v1',ca)).data,ca).rows).toHaveLength(1);
 const ia={...ca,p_customer_id:customer,p_expected_customer_version:null};expect(decodeReturnItems((await fixtureRPC('pilot_co_return_items_v1',ia)).data,ia).rows).toHaveLength(3);
 const la={p_customer_id:null,p_date_from:null,p_date_to:null,p_page:1,p_page_size:20};expect(decodeReturnPage((await fixtureRPC('pilot_co_returns_page_v1',la)).data,la).rows).toHaveLength(1);
 const payload={customer_id:customer,expected_customer_version:fixture.version,expected_generation_id:generation,return_date:new Date().toISOString().slice(0,10),reason:'Synthetic return',reference:null,notes:null,items:stockItems.slice(0,2).map(s=>({stock_key_id:s.stock_key_id,quantity:1,unit:s.unit!,unit_id:s.unit_id!,unit_version:s.unit_version!}))};
 const request=id(900);fixture.scenario='uncertain';await expect(fixtureRPC('pilot_co_return_create_v1',{p_request_id:request,p_payload:payload})).rejects.toThrow('lost after commit');
 const recovery=(await fixtureRPC('pilot_co_return_create_result_v1',{p_request_id:request})).data;const receipt=decodeReturnCreate(recovery.result,request,customer);expect(fixture.commits).toBe(1);
 const retry=(await fixtureRPC('pilot_co_return_create_v1',{p_request_id:request,p_payload:payload})).data;expect(retry).toEqual(receipt);expect(fixture.commits).toBe(1);
 const sa={p_customer_id:customer,p_expected_customer_version:null,p_as_of:null,p_search:'',p_page:1,p_page_size:1};decodeCORead('pilot_co_customer_stock_v1',sa,(await fixtureRPC('pilot_co_customer_stock_v1',sa)).data);
 const ra={p_customer_id:customer,p_target_id:receipt.revision_id,p_view:'revision' as const,p_expected_customer_version:fixture.version,p_expected_draft_version:null,p_page:1,p_page_size:100};const saved=decodeCORead('pilot_co_return_v1',ra,(await fixtureRPC('pilot_co_return_v1',ra)).data);verifyReturnReadback(receipt,payload,{header:saved.header,lines:saved.rows});
 await expect(fixtureRPC('unapproved_real_rpc')).rejects.toThrow('Forbidden/unhandled');
});
