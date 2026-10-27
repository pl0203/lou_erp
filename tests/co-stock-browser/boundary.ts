// Local synthetic transport only. No real account, hosted API, or credentials.
export const actor = '00000000-0000-0000-0000-000000000001';
export const customer = '00000000-0000-0000-0000-000000000002';
const profile={id:actor,role:'co_admin',is_active:true};
export const useAuth=()=>({user:{id:actor},profile,loading:false,error:null});
export const useBeforeSignOut=()=>{};
export const fixture={holdProducts:true,holdStock:false,holdMovements:false,failMovements:false,movementRelease:null as null|(()=>void),failProducts:false,calls:[] as any[],productRelease:null as null|(()=>void),stockRelease:null as null|(()=>void)};
const customers=[{id:customer,name:'Toko Contoh Nusantara',pricing_tier:'luar_kota',address:null,city:null,phone:null,email:null,customer_category:null,is_enabled:true,catalog_version:'1'}];
const products=Array.from({length:30},(_,i)=>({id:`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,name:`Produk contoh ${i+1}`,sku:`SKU-${i+1}`,size:null,harga_pokok:0,luar_kota:10000,dalam_kota:null,depo_bangunan:null,unit_price:null,is_enabled:true,catalog_version:'1'}));
const fresh={cutoff_date:'2026-10-09',next_required_report_month:'2026-09-01',pending_report_month_count:'2',overdue_report_month_count:'1',next_required_month_end:'2026-09-30',days_since_pending_month_end:'9',status:'missing_completed_period',zero_stock_reporting_pending:false};
const ok=(data:any)=>({data,error:null});
async function rpc(name:string,a:any){
 fixture.calls.push({name,args:a});
 if(name==='pilot_my_profile')return ok([profile]);
 if(name==='pilot_catalog_page_v1')return ok({version:1,actor_id:actor,role:'co_admin',kind:a.p_kind,purpose:a.p_purpose,status:a.p_status,search:a.p_search,page:a.p_page,page_size:a.p_page_size,total_count:'1',rows:customers});
 if(name==='pilot_co_customer_stock_v2'){
  if(fixture.holdStock)await new Promise<void>(r=>fixture.stockRelease=r);
  const row={id:stockKey,stock_key_id:stockKey,customer_id:customer,customer_name:customers[0].name,customer_version:'1',generation_id:generation,normalized_sku:'sku-1',display_sku:'SKU-1',product_name:'Produk contoh',product_id:null,opening_quantity:'20',delivered_quantity:'0',sold_quantity:'0',returned_quantity:'0',recorded_quantity:'20',has_delivery_history:true,last_report_month:null,coverage_through_date:null,reporting_freshness:fresh,unit:null,unit_basis:'unknown',unit_declaration:null,contract_stock_value:null,contract_currency:null,contract_unit_price:null,price_state:'unknown',valuation_basis:null};
  return ok({version:'2',as_of:'2026-10-09T00:00:00Z',customer_id:a.p_customer_id,customer_version:'1',generation_id:generation,sku:a.p_sku?.toLowerCase()??null,normalized_search:a.p_search.trim().toLowerCase(),stock_as_of:a.p_as_of,period_start:'2026-10-01',coverage_date:'2026-10-09',sort:a.p_sort,direction:a.p_direction,page:a.p_page,page_size:a.p_page_size,total:'1',rows:[row],reporting_freshness:fresh});
 }
 if(name==='pilot_co_stock_movements_v1'){
  if(fixture.holdMovements)await new Promise<void>(r=>fixture.movementRelease=r);
  if(fixture.failMovements)throw Error('Synthetic movement offline');
  const rows=Array.from({length:21},(_,i)=>({id:id(100+i),customer_id:customer,stock_key_id:stockKey,generation_id:generation,co_line_id:id(300),effective_date:'2026-10-09',kind:'sold',quantity_delta:'-1',co_id:id(400),batch_id:id(500),delivery_revision_line_id:null,return_revision_line_id:null,report_revision_line_id:id(600+i)}));
  return ok({version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',stock_key_id:stockKey,generation_id:generation,stock_as_of:a.p_as_of,page:a.p_page,page_size:a.p_page_size,total:'21',rows:rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size)});
 }
 throw Error(`Forbidden or unhandled local fixture RPC: ${name}`);
}
export const supabase={supabaseUrl:'http://synthetic.invalid',rest:{url:'http://synthetic.invalid/rest/v1',schemaName:'public'},rpc:(name:string,a:any)=>{const result=rpc(name,a);return Object.assign(result,{abortSignal:()=>result})},from:(table:string)=>{if(table!=='customers')throw Error('Unexpected fixture table');const q:any={select:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,then:(yes:any,no:any)=>Promise.resolve({data:customers,count:customers.length,error:null}).then(yes,no)};return q;}};

const id=(n:number)=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
export const stockKey=id(1001);const generation=id(8000);
