import React,{useEffect,useSyncExternalStore} from 'react';
import {afterEach,beforeEach,vi} from 'vitest';
import {cleanup,render} from '@testing-library/react';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {transferableAbortController} from 'node:util';
export const id=(n:number)=>`72000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const customer=id(2),otherCustomer=id(3),generation=id(4);
const wire=vi.hoisted(()=>({actor:'72000000-0000-4000-8000-000000000001',active:true,role:'co_admin',rpc:vi.fn(),handler:null as any,guard:null as any,listeners:new Set<()=>void>()}));
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>{useSyncExternalStore(listener=>{wire.listeners.add(listener);return()=>{wire.listeners.delete(listener)}},()=>`${wire.actor}:${wire.active}:${wire.role}`);return ({user:{id:wire.actor},profile:{id:wire.actor,role:wire.role,is_active:wire.active,full_name:'Synthetic Operator'},loading:false,error:null,signOut:vi.fn()})},useBeforeSignOut:(guard:any)=>useEffect(()=>{wire.guard=guard;return()=>{wire.guard=null}},[guard])}));
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:(name:string,args:any)=>{let signal:AbortSignal|undefined;const result=Promise.resolve().then(()=>{signal?.throwIfAborted();return wire.rpc(name,args)});return Object.assign(result,{abortSignal:(value:AbortSignal)=>{signal=value;return result}})}}}));
export {wire};
const clients:QueryClient[]=[];
beforeEach(()=>{wire.actor=id(1);wire.active=true;wire.role='co_admin';wire.rpc.mockReset().mockImplementation((name,args)=>wire.handler(name,args));wire.handler=()=>{throw new Error('Unhandled workspace RPC')};localStorage.clear();vi.stubGlobal('AbortController',class {constructor(){return transferableAbortController()}});});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());localStorage.clear();});
export function mountWorkspace(node:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});clients.push(client);const router=createMemoryRouter([{path:'*',element:node}],{initialEntries:['/athel/co/returns']});return {...render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>),client,router};}

export function fixture(){
 const state:any={commands:[],recoveries:0,loseResponse:false,reject:null,badScope:false,includeZero:false,fail:null,receipt:null,payload:null,canonicalWrong:false,
  items:[{stock_key_id:id(11),display_sku:'SKU-A',product_name:'Item A',available_quantity:'30',unit:'pcs',unit_version:'1',unit_id:id(21)},
   {stock_key_id:id(12),display_sku:'SKU-B',product_name:'Item B',available_quantity:'9',unit:'box',unit_version:'1',unit_id:id(22)},
   {stock_key_id:id(13),display_sku:'SKU-UNKNOWN',product_name:'Unverified item',available_quantity:'5',unit:null,unit_version:null,unit_id:null}],
 };
 const root={version:'1',as_of:'2026-10-30T00:00:00Z'};
 const freshness={cutoff_date:'2026-10-09',next_required_report_month:'2026-09-01',pending_report_month_count:'2',overdue_report_month_count:'1',next_required_month_end:'2026-09-30',days_since_pending_month_end:'9',status:'missing_completed_period',zero_stock_reporting_pending:false};
 wire.handler=async(name:string,a:any)=>{
  if(!wire.active||!['co_admin','executive'].includes(wire.role))return{data:null,error:{code:'42501',message:'Access denied'}};
  if(state.fail){const failed=await state.fail(name,a);if(failed)return failed;}
  const ok=(data:any)=>({data,error:null});const page=(rows:any[])=>({...root,page:a.p_page,page_size:a.p_page_size,total:String(rows.length),rows:rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size)});
  if(name==='pilot_co_return_customers_v1'||name==='pilot_co_return_history_customers_v1')return ok({...page([{customer_id:customer,customer_name:'Store A'},{customer_id:otherCustomer,customer_name:'Store B'}].filter(r=>r.customer_name.toLowerCase().includes(a.p_search.toLowerCase()))),search:a.p_search});
  if(name==='pilot_co_return_items_v1'){
   if(a.p_expected_customer_version!==null&&a.p_expected_customer_version!=='1')return{data:null,error:{code:'PT409',message:'CO_VERSION_CONFLICT'}};
   let rows=a.p_customer_id===customer?state.items:a.p_customer_id===otherCustomer?[{...state.items[0],stock_key_id:id(14),display_sku:'SKU-OTHER',product_name:'Other customer item'}]:[];
   if(state.includeZero)rows=[...rows,{...state.items[0],stock_key_id:id(15),display_sku:'SKU-ZERO',available_quantity:'0'}];
   rows=rows.filter((r:any)=>(r.display_sku+' '+r.product_name).toLowerCase().includes(a.p_search.toLowerCase()));
   return ok({...page(rows),customer_id:state.badScope?otherCustomer:a.p_customer_id,customer_version:'1',generation_id:generation,search:a.p_search});
  }
  if(name==='pilot_co_returns_page_v1'){
   const p=state.payload,receipt=state.receipt;
   const rows=receipt&&(!a.p_customer_id||a.p_customer_id===p.customer_id)&&(!a.p_date_from||p.return_date>=a.p_date_from)&&(!a.p_date_to||p.return_date<=a.p_date_to)?[{id:receipt.head_id,revision_id:receipt.revision_id,customer_id:p.customer_id,customer_name:'Store A',return_date:p.return_date,reference:p.reference,reason:p.reason,is_void:false,item_count:String(p.items.length),quantities:p.items.map((i:any)=>({unit:i.unit,quantity:String(i.quantity)}))}]:[];
   return ok({...page(rows),customer_id:a.p_customer_id,date_from:a.p_date_from,date_to:a.p_date_to});
  }
  if(name==='pilot_co_return_create_v1'){
   state.commands.push(structuredClone(a));if(state.reject)return{data:null,error:state.reject};
   state.payload=structuredClone(a.p_payload);state.receipt={version:'1',request_id:a.p_request_id,customer_id:a.p_payload.customer_id,head_id:id(31),revision_id:id(32),customer_version:'2',return_version:'1'};
   if(state.loseResponse)throw new Error('Synthetic response lost');return ok(state.receipt);
  }
  if(name==='pilot_co_return_create_result_v1'){state.recoveries++;return ok({version:'1',status:state.receipt?'committed':'not_found',result:state.receipt});}
  if(name==='pilot_co_customer_stock_v1')return ok({...page([]),customer_id:a.p_customer_id,customer_version:'2',generation_id:generation,stock_as_of:a.p_as_of,normalized_search:a.p_search,reporting_freshness:freshness,period_start:'2026-10-01',coverage_date:'2026-10-09',summary:{opening_quantity:'0',delivered_quantity:'0',sold_quantity:'0',returned_quantity:'0',recorded_quantity:'0'}});
  if(name==='pilot_co_return_v1'){
   const p=state.payload,r=state.receipt;if(!p||!r||a.p_target_id!==r.revision_id||a.p_expected_customer_version!=='2'||a.p_customer_id!==p.customer_id)throw new Error('Synthetic canonical scope mismatch');
   const rows=p.items.map((i:any,n:number)=>({id:id(100+n),customer_id:p.customer_id,co_id:id(200+n),co_number:`Original CO-${n+1}`,co_line_id:id(300+n),stock_key_id:i.stock_key_id,batch_id:id(400+n),revision_id:r.revision_id,draft_id:null,quantity:String(i.quantity+(state.canonicalWrong?1:0)),unit_price:'9007199254740993.01',display_sku:state.items.find((v:any)=>v.stock_key_id===i.stock_key_id).display_sku,product_name:'Original product'}));
   return ok({...page(rows),customer_id:p.customer_id,customer_version:'2',target_id:r.revision_id,view:'revision',draft_version:null,header:{id:r.revision_id,customer_id:p.customer_id,target_kind:'revision',draft_version:null,head_id:r.head_id,head_version:'1',revision_id:r.revision_id,revision_no:'1',return_date:p.return_date,reference:p.reference,reason:p.reason,notes:p.notes,consumed:true,bound_customer_version:'2',bindings_current:true,line_count:String(rows.length),is_void:false}});
  }
  throw new Error(`Unhandled workspace RPC ${name}`);
 };
 return state;
}
